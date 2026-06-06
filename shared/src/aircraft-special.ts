// Detect rare / iconic aircraft worth calling out on the ceiling.

import type { Aircraft } from "./aircraft.js";

/** ICAO type codes for standout airframes: superjumbos, quad heavies, classic
 *  widebodies, and big military transports. */
const RARE_TYPE_CODES = new Set<string>([
  // Superjumbo / quad heavies
  "A388", // Airbus A380
  "B748", // Boeing 747-8
  "B744", // Boeing 747-400
  "B742", // Boeing 747-200
  "B743", // Boeing 747-300
  "BLCF", // 747 Dreamlifter
  // Cargo giants
  "A124", // Antonov An-124
  "A225", // Antonov An-225 (gone, but keep for the dream)
  "AN24",
  // Classic / unusual widebodies
  "MD11", // McDonnell Douglas MD-11
  "A346", // A340-600
  "A343", // A340-300
  "B703", // 707
  "CONC", // Concorde
  // Big military transports / specials
  "C5M", // Lockheed C-5
  "C17", // Boeing C-17
  "A400", // Airbus A400M
  "C130", // C-130 Hercules
  "K35R", // KC-135
  "B52", // B-52
  "E3TF", // E-3 Sentry (AWACS)
  "E6", // E-6 Mercury
]);

/** Military squawk-ish heuristics are unreliable; rely on type for now. */
export function isRareAircraft(ac: Pick<Aircraft, "typeCode">): boolean {
  if (!ac.typeCode) return false;
  return RARE_TYPE_CODES.has(ac.typeCode.toUpperCase());
}
