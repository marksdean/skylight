// Runtime airport registry + lookup (static catalog + dynamically loaded airports).

import {
  AIRPORT_CATALOG,
  AIRPORT_GROUPS,
  DEFAULT_AIRPORT_ICAO,
  type AirportCatalogEntry,
  type AirportGroup,
} from "./airports.js";
import { greatCircleMiles } from "./geo.js";

export type { AirportCatalogEntry, AirportGroup, Runway } from "./airports.js";
export { AIRPORT_CATALOG, AIRPORT_GROUPS, DEFAULT_AIRPORT_ICAO };

const runtime = new Map<string, AirportCatalogEntry>();

export interface NearbyAirportSummary {
  icao: string;
  iata: string;
  name: string;
  label: string;
  centerLat: number;
  centerLon: number;
  distanceMi: number;
}

export function registerAirport(entry: AirportCatalogEntry): void {
  runtime.set(entry.icao, entry);
}

export function getAirport(icao: string): AirportCatalogEntry | undefined {
  return runtime.get(icao) ?? AIRPORT_CATALOG[icao];
}

export function listAirportGroups(): AirportGroup[] {
  return AIRPORT_GROUPS;
}

export function airportLabel(entry: Pick<AirportCatalogEntry, "iata" | "name" | "icao">): string {
  return entry.iata ? `${entry.iata} — ${entry.name}` : entry.name;
}

/** Config patch when the user picks a new home airport. */
export function airportConfigPatch(icao: string): {
  airportIcao: string;
  centerLat: number;
  centerLon: number;
} {
  const ap = getAirport(icao);
  if (!ap) throw new Error(`Unknown airport: ${icao}`);
  return { airportIcao: icao, centerLat: ap.centerLat, centerLon: ap.centerLon };
}

/** Pick the nearest known airport to a lat/lon (static + runtime catalog). */
export function nearestAirportIcao(lat: number, lon: number): string {
  let best = DEFAULT_AIRPORT_ICAO;
  let bestDist = Infinity;
  for (const ap of [...runtime.values(), ...Object.values(AIRPORT_CATALOG)]) {
    const dist = greatCircleMiles(lat, lon, ap.centerLat, ap.centerLon);
    if (dist < bestDist) {
      bestDist = dist;
      best = ap.icao;
    }
  }
  return best;
}
