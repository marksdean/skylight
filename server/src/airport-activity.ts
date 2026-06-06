// Rank major airports by live ADS-B traffic via airplanes.live point queries.
// Results are cached and refreshed in the background (API is rate-limited to ~1 req/s).

import { ACTIVITY_AIRPORT_ICAOS } from "@shared/airport-candidates.js";
import { airportLabel, type ActiveAirportSummary, type ActiveAirportsResponse } from "@shared/airport-resolve.js";
import type { AirportLookup } from "./airport-lookup.js";

const CACHE_TTL_MS = 5 * 60_000;
const RADIUS_NM = 18;
const RATE_LIMIT_MS = 1100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countAircraftNear(
  apiBase: string,
  lat: number,
  lon: number,
): Promise<number> {
  const url = `${apiBase}/point/${lat}/${lon}/${RADIUS_NM}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { aircraft?: { lat?: number }[]; ac?: { lat?: number }[] };
  const list = json.aircraft ?? json.ac ?? [];
  return list.filter((ac) => ac.lat != null).length;
}

export class AirportActivityStore {
  private airports: ActiveAirportSummary[] = [];
  private updatedAt: number | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(
    private lookup: AirportLookup,
    private apiBase = "https://api.airplanes.live/v2",
  ) {}

  get(limit = 12): ActiveAirportsResponse {
    if (this.shouldRefresh()) void this.refresh();
    return {
      airports: this.airports.slice(0, Math.min(30, Math.max(1, limit))),
      updatedAt: this.updatedAt,
      refreshing: this.refreshing != null,
    };
  }

  /** Force a refresh and wait for it (first load / manual reload). */
  async refreshNow(limit = 12): Promise<ActiveAirportsResponse> {
    await this.refresh();
    return this.get(limit);
  }

  start(): void {
    void this.refresh();
  }

  private shouldRefresh(): boolean {
    if (this.refreshing) return false;
    if (!this.updatedAt) return true;
    return Date.now() - this.updatedAt > CACHE_TTL_MS;
  }

  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.scan().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async scan(): Promise<void> {
    const hits: ActiveAirportSummary[] = [];

    for (const icao of ACTIVITY_AIRPORT_ICAOS) {
      const ap = await this.lookup.getAirport(icao);
      if (!ap) continue;
      try {
        const aircraftCount = await countAircraftNear(this.apiBase, ap.centerLat, ap.centerLon);
        hits.push({
          icao: ap.icao,
          iata: ap.iata,
          name: ap.name,
          label: airportLabel(ap),
          centerLat: ap.centerLat,
          centerLon: ap.centerLon,
          aircraftCount,
        });
      } catch {
        /* skip unreachable airports this cycle */
      }
      await sleep(RATE_LIMIT_MS);
    }

    hits.sort(
      (a, b) =>
        b.aircraftCount - a.aircraftCount ||
        a.label.localeCompare(b.label) ||
        a.icao.localeCompare(b.icao),
    );
    this.airports = hits;
    this.updatedAt = Date.now();
  }
}
