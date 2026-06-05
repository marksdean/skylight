// Static, instant enrichment from bundled tables. adsbdb (routes.ts) layers
// on top for anything these miss.

import { lookupAirlineFromCallsign } from "@shared/carriers.js";
import types from "./types.json" with { type: "json" };

const TYPES = types as Record<string, string>;

/** Map an ICAO type code (e.g. "B738") to a human name. */
export function lookupType(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return TYPES[code.toUpperCase()];
}

/**
 * Map a callsign to an airline name via its 3-letter ICAO prefix.
 * Only airline-style callsigns resolve; GA tail numbers (e.g. "N123AB") won't.
 */
export function lookupAirline(callsign: string | undefined): string | undefined {
  return lookupAirlineFromCallsign(callsign);
}
