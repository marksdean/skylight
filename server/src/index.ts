// Entry point. Wires the config store, data poller, WebSocket hub, REST API,
// and (in production) serves the built web app. Binds 0.0.0.0 so the control
// panel is reachable from your phone on the LAN.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import type { DataSource } from "@shared/index.js";
import { ConfigStore } from "./config-store.js";
import { RouteEnricher } from "./enrich/routes.js";
import { Poller } from "./datasource.js";
import { Hub } from "./hub.js";
import { TleStore } from "./tle.js";
import { AirportLookup } from "./airport-lookup.js";
import { fetchCarrierLogo } from "./carrier-logos.js";
import { fetchAirportPhoto } from "./airport-photos.js";
import { AirportActivityStore } from "./airport-activity.js";
import { TourController } from "./airport-tour.js";
import { PresetStore } from "./preset-store.js";
import { WeatherStore } from "./weather-store.js";
import { presetVisualPatch } from "@shared/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const WEB_DIST = resolve(__dirname, "../../web/dist");

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const SOURCE = (process.env.DATA_SOURCE as DataSource) ?? "radio";
const RADIO_URL =
  process.env.AIRCRAFT_JSON_URL ?? "http://localhost:8080/data/aircraft.json";
const API_URL =
  process.env.API_URL ?? "https://api.airplanes.live/v2/point/{lat}/{lon}/{r}";
const POLL_MS = Number(process.env.POLL_MS ?? 1000);
const ROUTE_CACHE_HOURS = Number(process.env.ROUTE_CACHE_HOURS ?? 12);
// When on radio, also poll the API and merge (keeps landing aircraft alive).
const SUPPLEMENT_API = (process.env.SUPPLEMENT_API ?? "1") !== "0";
const API_POLL_MS = Number(process.env.API_POLL_MS ?? 4000);

async function main(): Promise<void> {
  const store = new ConfigStore(resolve(DATA_DIR, "config.json"));
  const enricher = new RouteEnricher(
    resolve(DATA_DIR, "route-cache.json"),
    ROUTE_CACHE_HOURS,
  );
  const tleStore = new TleStore(resolve(DATA_DIR, "tle-cache.json"));
  const airportLookup = new AirportLookup(
    resolve(__dirname, "../../data/airports.csv"),
    resolve(__dirname, "../../data/runways.csv"),
  );
  const airportActivity = new AirportActivityStore(airportLookup);
  const heliportActivity = new AirportActivityStore(airportLookup, {
    helicoptersOnly: true,
    radiusNm: 8,
    candidates: () => airportLookup.candidateHeliports(),
  });
  const presets = new PresetStore(resolve(DATA_DIR, "presets.json"));
  const weather = new WeatherStore();
  const tour = new TourController(store, airportActivity, airportLookup);

  await Promise.all([store.load(), enricher.load(), tleStore.load(), presets.load()]);
  airportActivity.start();
  tour.start();

  const app = express();
  app.use(express.json());

  const server = createServer(app);
  const hub = new Hub(server, {
    store,
    getSnapshot: () => poller.getSnapshot(),
    getStatus: () => poller.getStatus(),
  });

  const poller = new Poller({
    source: SOURCE,
    radioUrl: RADIO_URL,
    apiUrlTemplate: API_URL,
    pollMs: POLL_MS,
    supplementApi: SUPPLEMENT_API,
    apiPollMs: API_POLL_MS,
    getConfig: () => store.get(),
    enricher,
    onSnapshot: (now, aircraft) => hub.broadcastAircraft(now, aircraft),
    onStatus: (status) => hub.broadcastStatus(status),
  });

  // --- REST API (handy for debugging + non-WS clients) ---
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/config", (_req, res) => res.json(store.get()));
  app.post("/api/config", (req, res) => res.json(store.patch(req.body)));
  app.post("/api/config/reset", (_req, res) => res.json(store.reset()));
  app.get("/api/aircraft", (_req, res) => res.json(poller.getSnapshot()));
  app.get("/api/status", (_req, res) => res.json(poller.getStatus()));
  app.get("/api/tle", async (_req, res) => res.json(await tleStore.get()));
  app.get("/api/airports/nearby", async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const limit = Number(req.query.limit ?? 12);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: "lat and lon are required numbers" });
    }
    const nearby = await airportLookup.findNearby(
      lat,
      lon,
      Number.isFinite(limit) ? Math.min(30, Math.max(1, limit)) : 12,
    );
    res.json(nearby);
  });
  app.get("/api/airports/search", async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const limit = Number(req.query.limit ?? 15);
    if (q.length < 2) return res.status(400).json({ error: "q must be at least 2 characters" });
    const kind = req.query.kind === "heliport" ? "heliport" : "airport";
    const hits = await airportLookup.search(
      q,
      Number.isFinite(limit) ? Math.min(30, Math.max(1, limit)) : 15,
      kind,
    );
    res.json(hits);
  });
  app.get("/api/airports/active", async (req, res) => {
    const limit = Number(req.query.limit ?? 12);
    const refresh = req.query.refresh === "1";
    const capped = Number.isFinite(limit) ? Math.min(30, Math.max(1, limit)) : 12;
    const activity = req.query.kind === "heliport" ? heliportActivity : airportActivity;
    if (refresh) {
      res.json(await activity.refreshNow(capped));
      return;
    }
    res.json(activity.get(capped));
  });
  app.get("/api/airports/:icao", async (req, res) => {
    const ap = await airportLookup.getAirport(String(req.params.icao).toUpperCase());
    if (!ap) return res.status(404).json({ error: "airport not found" });
    res.json(ap);
  });
  app.get("/api/airport-photo/:icao", async (req, res) => {
    const ap = await airportLookup.getAirport(String(req.params.icao).toUpperCase());
    if (!ap?.wikipediaLink) return res.status(404).end();
    const photo = await fetchAirportPhoto(ap.wikipediaLink);
    if (!photo) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=604800");
    res.type(photo.contentType).send(photo.body);
  });
  app.get("/api/weather", async (_req, res) => {
    const cfg = store.get();
    const snap = await weather.get(cfg.centerLat, cfg.centerLon);
    if (!snap) return res.status(503).json({ error: "weather unavailable" });
    res.json(snap);
  });
  app.get("/api/presets", (_req, res) => res.json(presets.list()));
  app.post("/api/presets", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    presets.add(name, store.get());
    res.json(presets.list());
  });
  app.post("/api/presets/:id/apply", (req, res) => {
    const preset = presets.get(String(req.params.id));
    if (!preset) return res.status(404).json({ error: "preset not found" });
    const config = store.patch(presetVisualPatch(preset));
    res.json(config);
  });
  app.delete("/api/presets/:id", (req, res) => {
    presets.remove(String(req.params.id));
    res.json(presets.list());
  });
  app.get("/api/carrier-logo/:iata", async (req, res) => {
    const logo = await fetchCarrierLogo(String(req.params.iata));
    if (!logo) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=604800");
    res.type(logo.contentType).send(logo.body);
  });
  app.post("/api/source", (req, res) => {
    const s = req.body?.source;
    if (s !== "radio" && s !== "api") {
      return res.status(400).json({ error: "source must be 'radio' or 'api'" });
    }
    poller.setSource(s);
    res.json(poller.getStatus());
  });

  // --- static web (production build) ---
  if (existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get("/control", (_req, res) => res.sendFile(resolve(WEB_DIST, "control.html")));
    app.get("/", (_req, res) => res.sendFile(resolve(WEB_DIST, "index.html")));
  } else {
    app.get("/", (_req, res) =>
      res
        .type("text/plain")
        .send("Web build not found. Run `npm run build`, or use the Vite dev server."),
    );
  }

  poller.start();

  server.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT}`);
    console.log(`[server] data source: ${SOURCE} (${SOURCE === "radio" ? RADIO_URL : API_URL})`);
    console.log(`[server] control panel: http://<this-host>:${PORT}/control`);
  });
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
