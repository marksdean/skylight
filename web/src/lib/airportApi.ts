import {
  airportConfigPatch,
  getAirport,
  nearestAirportIcao,
  registerAirport,
  type AirportCatalogEntry,
  type ActiveAirportsResponse,
  type AirportSearchResult,
  type NearbyAirportSummary,
} from "@shared/airport-resolve.js";
import type { Config } from "@shared/index.js";

export type GeolocationResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; error: string };

const GEO_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 60000,
};

export function getCurrentPosition(): Promise<GeolocationResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ ok: false, error: "Geolocation is not available in this browser." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ ok: true, lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) =>
        resolve({
          ok: false,
          error:
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied."
              : "Could not determine your location.",
        }),
      GEO_OPTS,
    );
  });
}

export interface WeatherSnapshot {
  tempC: number;
  windKph: number;
  cloudPct: number;
  code: number;
  isDay: boolean;
  label: string;
  lat: number;
  lon: number;
  updatedAt: number;
}

export async function fetchWeather(): Promise<WeatherSnapshot | null> {
  try {
    const res = await fetch("/api/weather");
    if (!res.ok) return null;
    return (await res.json()) as WeatherSnapshot;
  } catch {
    return null;
  }
}

export async function fetchActiveAirports(
  limit = 12,
  refresh = false,
  kind: AirportSearchKind = "airport",
): Promise<ActiveAirportsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (refresh) params.set("refresh", "1");
  if (kind !== "airport") params.set("kind", kind);
  const res = await fetch(`/api/airports/active?${params}`);
  if (!res.ok) throw new Error(`Active airports failed (${res.status})`);
  return res.json() as Promise<ActiveAirportsResponse>;
}

export type AirportSearchKind = "airport" | "heliport";

export async function fetchSearchAirports(
  q: string,
  limit = 15,
  kind: AirportSearchKind = "airport",
): Promise<AirportSearchResult[]> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (kind !== "airport") params.set("kind", kind);
  const res = await fetch(`/api/airports/search?${params}`);
  if (!res.ok) throw new Error(`Airport search failed (${res.status})`);
  return res.json() as Promise<AirportSearchResult[]>;
}

export async function fetchNearbyAirports(
  lat: number,
  lon: number,
  limit = 12,
): Promise<NearbyAirportSummary[]> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    limit: String(limit),
  });
  const res = await fetch(`/api/airports/nearby?${params}`);
  if (!res.ok) throw new Error(`Nearby airports failed (${res.status})`);
  return res.json() as Promise<NearbyAirportSummary[]>;
}

export async function fetchAirport(icao: string): Promise<AirportCatalogEntry> {
  const res = await fetch(`/api/airports/${encodeURIComponent(icao)}`);
  if (!res.ok) throw new Error(`Airport lookup failed (${res.status})`);
  const entry = (await res.json()) as AirportCatalogEntry;
  registerAirport(entry);
  return entry;
}

/** Ensure runway geometry is available locally (catalog or API). */
export async function ensureAirport(icao: string): Promise<AirportCatalogEntry> {
  const cached = getAirport(icao);
  if (cached) return cached;
  return fetchAirport(icao);
}

export async function selectAirport(icao: string): Promise<
  Pick<Config, "airportIcao" | "centerLat" | "centerLon" | "locationMode" | "showAirport">
> {
  await ensureAirport(icao);
  return { ...airportConfigPatch(icao), locationMode: "airport", showAirport: true };
}

/** Center the overhead view on a GPS position instead of an airport field. */
export async function selectPosition(
  lat: number,
  lon: number,
): Promise<Pick<Config, "airportIcao" | "centerLat" | "centerLon" | "locationMode" | "showAirport">> {
  let airportIcao = nearestAirportIcao(lat, lon);
  try {
    const hits = await fetchNearbyAirports(lat, lon, 1);
    if (hits[0]) {
      await ensureAirport(hits[0].icao);
      airportIcao = hits[0].icao;
    }
  } catch {
    /* fall back to bundled nearest */
  }
  return {
    locationMode: "position",
    centerLat: Math.round(lat * 1e6) / 1e6,
    centerLon: Math.round(lon * 1e6) / 1e6,
    airportIcao,
    showAirport: false,
  };
}
