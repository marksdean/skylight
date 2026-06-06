// Rank major airports by live ADS-B traffic via airplanes.live point queries.
// Results are cached and refreshed in the background (API is rate-limited to ~1 req/s).

import { ACTIVITY_AIRPORT_ICAOS } from "@shared/airport-candidates.js";
import { airportLabel, type ActiveAirportSummary, type ActiveAirportsResponse } from "@shared/airport-resolve.js";
import type { AirportLookup } from "./airport-lookup.js";

const CACHE_TTL_MS = 5 * 60_000;
const RATE_LIMIT_MS = 1100;

// Common rotorcraft type codes, in case a feed omits the A7 emitter category.
const HELI_TYPES = new Set([
  "EC20", "EC25", "EC30", "EC35", "EC45", "EC55", "AS50", "AS55", "AS65", "A109",
  "A119", "A139", "A169", "A189", "B06", "B407", "B412", "B429", "B505", "S76",
  "S92", "R22", "R44", "R66", "H60", "H47", "H64", "UH1", "B212", "B222",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FeedAircraft {
  lat?: number;
  category?: string;
  t?: string;
  type?: string;
}

function isHelicopter(ac: FeedAircraft): boolean {
  if (ac.category === "A7") return true;
  const code = (ac.t ?? ac.type ?? "").toUpperCase();
  return code !== "" && HELI_TYPES.has(code);
}

async function countAircraftNear(
  apiBase: string,
  lat: number,
  lon: number,
  radiusNm: number,
  helicoptersOnly: boolean,
): Promise<number> {
  const url = `${apiBase}/point/${lat}/${lon}/${radiusNm}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { aircraft?: FeedAircraft[]; ac?: FeedAircraft[] };
  const list = (json.aircraft ?? json.ac ?? []).filter((ac) => ac.lat != null);
  return helicoptersOnly ? list.filter(isHelicopter).length : list.length;
}

export interface ActivityOptions {
  apiBase?: string;
  /** Provider for the ICAO/ident keys to scan (defaults to major airports). */
  candidates?: () => string[] | Promise<string[]>;
  /** Count only helicopters (ADS-B category A7 / rotor type codes). */
  helicoptersOnly?: boolean;
  /** Point-query radius in nautical miles. */
  radiusNm?: number;
}

export class AirportActivityStore {
  private airports: ActiveAirportSummary[] = [];
  private updatedAt: number | null = null;
  private refreshing: Promise<void> | null = null;
  private apiBase: string;
  private candidates: () => string[] | Promise<string[]>;
  private helicoptersOnly: boolean;
  private radiusNm: number;

  constructor(private lookup: AirportLookup, opts: ActivityOptions = {}) {
    this.apiBase = opts.apiBase ?? "https://api.airplanes.live/v2";
    this.candidates = opts.candidates ?? (() => [...ACTIVITY_AIRPORT_ICAOS]);
    this.helicoptersOnly = opts.helicoptersOnly ?? false;
    this.radiusNm = opts.radiusNm ?? 18;
  }

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
    const candidates = await this.candidates();
    const hits: ActiveAirportSummary[] = [];

    for (const icao of candidates) {
      const ap = await this.lookup.getAirport(icao);
      if (!ap) continue;
      try {
        const aircraftCount = await countAircraftNear(
          this.apiBase,
          ap.centerLat,
          ap.centerLon,
          this.radiusNm,
          this.helicoptersOnly,
        );
        hits.push({
          icao: ap.icao,
          iata: ap.iata,
          name: ap.name,
          label: airportLabel(ap),
          centerLat: ap.centerLat,
          centerLon: ap.centerLon,
          aircraftCount,
        });
        // Publish partial results so long heliport scans show progress.
        this.publish(hits);
      } catch {
        /* skip unreachable airports this cycle */
      }
      await sleep(RATE_LIMIT_MS);
    }

    this.publish(hits);
    this.updatedAt = Date.now();
  }

  private publish(hits: ActiveAirportSummary[]): void {
    this.airports = [...hits].sort(
      (a, b) =>
        b.aircraftCount - a.aircraftCount ||
        a.label.localeCompare(b.label) ||
        a.icao.localeCompare(b.icao),
    );
  }
}
