// Search OurAirports CSV dumps for nearby airports and runway geometry on demand.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AIRPORT_CATALOG,
  airportLabel,
  type AirportCatalogEntry,
  type AirportSearchResult,
  type NearbyAirportSummary,
  type Runway,
} from "@shared/airport-resolve.js";
import { greatCircleMiles } from "@shared/geo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = resolve(__dirname, "../../data");

interface AirportRow {
  icao: string;
  iata: string;
  name: string;
  type: string;
  centerLat: number;
  centerLon: number;
  scheduled: boolean;
  wikipediaLink: string;
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      cols.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  cols.push(cur);
  return cols;
}

async function loadCsv(path: string): Promise<Record<string, string>[]> {
  const { readFile } = await import("node:fs/promises");
  const raw = (await readFile(path, "utf8")).trim();
  const lines = raw.split("\n");
  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""]));
  });
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function entryFromRow(row: AirportRow, runways: Runway[]): AirportCatalogEntry {
  return {
    icao: row.icao,
    iata: row.iata,
    name: row.name,
    label: airportLabel({ icao: row.icao, iata: row.iata, name: row.name }),
    centerLat: row.centerLat,
    centerLon: row.centerLon,
    ...(row.wikipediaLink ? { wikipediaLink: row.wikipediaLink } : {}),
    runways,
  };
}

export class AirportLookup {
  private airports: AirportRow[] = [];
  private runwaysByIcao = new Map<string, Runway[]>();
  private ready: Promise<void>;

  constructor(
    private airportsPath = resolve(DATA_ROOT, "airports.csv"),
    private runwaysPath = resolve(DATA_ROOT, "runways.csv"),
  ) {
    this.ready = this.load();
  }

  async load(): Promise<void> {
    const airportRows = await loadCsv(this.airportsPath);
    this.airports = [];
    for (const row of airportRows) {
      const icao = row.icao_code || row.gps_code || row.ident;
      if (!icao || row.scheduled_service !== "yes") continue;
      if (!["large_airport", "medium_airport"].includes(row.type)) continue;
      const centerLat = +row.latitude_deg;
      const centerLon = +row.longitude_deg;
      if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) continue;
      this.airports.push({
        icao,
        iata: row.iata_code ?? "",
        name: row.name,
        type: row.type,
        centerLat: round6(centerLat),
        centerLon: round6(centerLon),
        scheduled: true,
        wikipediaLink: row.wikipedia_link ?? "",
      });
    }

    const runwayRows = await loadCsv(this.runwaysPath);
    this.runwaysByIcao.clear();
    for (const row of runwayRows) {
      const ident = row.airport_ident;
      if (!ident || row.closed === "1") continue;
      const leLat = row.le_latitude_deg;
      const leLon = row.le_longitude_deg;
      const heLat = row.he_latitude_deg;
      const heLon = row.he_longitude_deg;
      if (!leLat || !leLon || !heLat || !heLon) continue;
      const rwy: Runway = {
        leIdent: row.le_ident,
        heIdent: row.he_ident,
        le: [round6(+leLat), round6(+leLon)],
        he: [round6(+heLat), round6(+heLon)],
        widthFt: +row.width_ft || 100,
      };
      const list = this.runwaysByIcao.get(ident) ?? [];
      list.push(rwy);
      this.runwaysByIcao.set(ident, list);
    }

    // Drop airports with no drawable runways.
    this.airports = this.airports.filter((ap) => (this.runwaysByIcao.get(ap.icao)?.length ?? 0) > 0);
    console.log(`[airports] indexed ${this.airports.length} scheduled airports with runways`);
  }

  async search(query: string, limit = 15): Promise<AirportSearchResult[]> {
    await this.ready;
    const q = query.trim();
    if (q.length < 2) return [];

    const qUpper = q.toUpperCase();
    const qLower = q.toLowerCase();
    const looksLikeCode = /^[a-z0-9]{2,4}$/i.test(q);
    const hits: { ap: AirportRow; score: number }[] = [];

    for (const ap of this.airports) {
      let score = 0;
      if (ap.icao === qUpper) score = 100;
      else if (ap.iata === qUpper) score = 95;
      else if (ap.icao.startsWith(qUpper)) score = 80;
      else if (ap.iata.startsWith(qUpper)) score = 75;
      else if (!looksLikeCode && ap.name.toLowerCase().includes(qLower)) score = 50;
      else continue;
      hits.push({ ap, score });
    }

    hits.sort(
      (a, b) => b.score - a.score || a.ap.name.localeCompare(b.ap.name) || a.ap.icao.localeCompare(b.ap.icao),
    );

    return hits.slice(0, limit).map(({ ap }) => ({
      icao: ap.icao,
      iata: ap.iata,
      name: ap.name,
      label: airportLabel(ap),
      centerLat: ap.centerLat,
      centerLon: ap.centerLon,
    }));
  }

  async findNearby(
    lat: number,
    lon: number,
    limit = 12,
    maxRadiusMi = 120,
  ): Promise<NearbyAirportSummary[]> {
    await this.ready;
    const hits: NearbyAirportSummary[] = [];
    for (const ap of this.airports) {
      const distanceMi = greatCircleMiles(lat, lon, ap.centerLat, ap.centerLon);
      if (distanceMi > maxRadiusMi) continue;
      hits.push({
        icao: ap.icao,
        iata: ap.iata,
        name: ap.name,
        label: airportLabel(ap),
        centerLat: ap.centerLat,
        centerLon: ap.centerLon,
        distanceMi: Math.round(distanceMi * 10) / 10,
      });
    }
    hits.sort((a, b) => a.distanceMi - b.distanceMi);
    return hits.slice(0, limit);
  }

  async getAirport(icao: string): Promise<AirportCatalogEntry | undefined> {
    await this.ready;
    const bundled = AIRPORT_CATALOG[icao];
    if (bundled) return bundled;

    const row = this.airports.find((ap) => ap.icao === icao);
    if (!row) return undefined;
    const runways = this.runwaysByIcao.get(icao);
    if (!runways?.length) return undefined;
    return entryFromRow(row, runways);
  }
}
