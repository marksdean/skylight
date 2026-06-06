// Major annual meteor showers with approximate active windows and radiant
// positions (J2000). Dates are month/day; windows that span year-end wrap.

export interface MeteorShower {
  id: string;
  name: string;
  /** Active window start [month, day] (1-based month). */
  start: [number, number];
  /** Active window end [month, day]. */
  end: [number, number];
  /** Peak [month, day]. */
  peak: [number, number];
  /** Radiant right ascension / declination, degrees (J2000). */
  ra: number;
  dec: number;
  /** Zenithal hourly rate at peak (rough). */
  zhr: number;
}

export const METEOR_SHOWERS: MeteorShower[] = [
  { id: "qua", name: "Quadrantids", start: [12, 28], end: [1, 12], peak: [1, 3], ra: 230, dec: 49, zhr: 110 },
  { id: "lyr", name: "Lyrids", start: [4, 16], end: [4, 25], peak: [4, 22], ra: 271, dec: 34, zhr: 18 },
  { id: "eta", name: "Eta Aquariids", start: [4, 19], end: [5, 28], peak: [5, 6], ra: 338, dec: -1, zhr: 50 },
  { id: "del", name: "Delta Aquariids", start: [7, 12], end: [8, 23], peak: [7, 30], ra: 340, dec: -16, zhr: 25 },
  { id: "per", name: "Perseids", start: [7, 17], end: [8, 24], peak: [8, 12], ra: 48, dec: 58, zhr: 100 },
  { id: "ori", name: "Orionids", start: [10, 2], end: [11, 7], peak: [10, 21], ra: 95, dec: 16, zhr: 20 },
  { id: "leo", name: "Leonids", start: [11, 6], end: [11, 30], peak: [11, 17], ra: 152, dec: 22, zhr: 15 },
  { id: "gem", name: "Geminids", start: [12, 4], end: [12, 17], peak: [12, 14], ra: 112, dec: 33, zhr: 150 },
  { id: "urs", name: "Ursids", start: [12, 17], end: [12, 26], peak: [12, 22], ra: 217, dec: 76, zhr: 10 },
];

function dayOfYear(month: number, day: number): number {
  // Non-leap reference is fine for ~1-day window matching.
  const cumulative = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cumulative[month - 1] + day;
}

function inWindow(now: number, start: number, end: number): boolean {
  // Handles year-end wrap (e.g. Quadrantids Dec 28 -> Jan 12).
  if (start <= end) return now >= start && now <= end;
  return now >= start || now <= end;
}

/** Showers active on the given date (defaults to now). */
export function activeMeteorShowers(date = new Date()): MeteorShower[] {
  const now = dayOfYear(date.getMonth() + 1, date.getDate());
  return METEOR_SHOWERS.filter((s) =>
    inWindow(now, dayOfYear(...s.start), dayOfYear(...s.end)),
  );
}

/** How close (in days) the date is to a shower's peak; negative = before. */
export function daysFromPeak(s: MeteorShower, date = new Date()): number {
  const now = dayOfYear(date.getMonth() + 1, date.getDate());
  let peak = dayOfYear(...s.peak);
  let cur = now;
  // Normalize across year wrap.
  if (s.start[0] === 12 && date.getMonth() === 0) cur += 365;
  if (s.peak[0] === 12 && date.getMonth() === 0) peak += 0;
  if (s.peak[0] === 1 && date.getMonth() === 11) peak += 365;
  return cur - peak;
}
