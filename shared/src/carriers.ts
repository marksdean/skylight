import type { Aircraft } from "./aircraft.js";
import CARRIER_DATA from "./carriers.json" with { type: "json" };

export interface CarrierEntry {
  name: string;
  iata: string;
}

export const CARRIERS = CARRIER_DATA as Record<string, CarrierEntry>;

/** ICAO telephony prefix from callsign (e.g. UAL123 → UAL). */
export function carrierIcaoFromCallsign(flight?: string): string | undefined {
  const cs = flight?.trim().toUpperCase();
  if (!cs || cs.length < 4) return undefined;
  const prefix = cs.slice(0, 3);
  if (!/^[A-Z]{3}$/.test(prefix) || !/\d/.test(cs[3])) return undefined;
  return prefix;
}

export function lookupCarrier(icao: string): CarrierEntry | undefined {
  return CARRIERS[icao.toUpperCase()];
}

export function lookupAirlineFromCallsign(callsign: string | undefined): string | undefined {
  const icao = carrierIcaoFromCallsign(callsign);
  return icao ? CARRIERS[icao]?.name : undefined;
}

/** IATA code for logo lookup (e.g. UA, BA, EK). */
export function carrierIata(ac: Aircraft): string | undefined {
  const icao = carrierIcaoFromCallsign(ac.flight);
  if (icao) return CARRIERS[icao]?.iata;
  return undefined;
}
