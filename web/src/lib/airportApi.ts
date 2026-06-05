import {
  airportConfigPatch,
  getAirport,
  registerAirport,
  type AirportCatalogEntry,
  type NearbyAirportSummary,
} from "@shared/airport-resolve.js";

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

export async function selectAirport(icao: string): Promise<{
  airportIcao: string;
  centerLat: number;
  centerLon: number;
}> {
  await ensureAirport(icao);
  return airportConfigPatch(icao);
}
