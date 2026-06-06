import { useEffect, useRef } from "react";
import type { Aircraft, Config } from "@shared/index.js";
import { llToMeters, metersToMiles, rangeMeters } from "@shared/geo.js";
import { playOverheadPass } from "./overheadSound.js";

/** Horizontal distance (mi) counted as "directly overhead". */
const OVERHEAD_RADIUS_MI = 0.2;
/** Ignore traffic above this (ft) — too high to feel "overhead". */
const OVERHEAD_MAX_ALT_FT = 15000;
/** Minimum gap between alerts for the same aircraft. */
const RE_ALERT_MS = 90_000;

interface TrackState {
  inside: boolean;
  alertedAt: number;
}

function isOverheadCandidate(
  ac: Aircraft,
  cfg: Config,
): { overhead: boolean } | null {
  if (ac.lat == null || ac.lon == null || ac.onGround) return null;
  const alt = ac.altBaro ?? ac.altGeom;
  if (alt != null && alt < cfg.minAltitudeFt) return null;
  if (alt != null && alt > OVERHEAD_MAX_ALT_FT) return null;

  const m = llToMeters(ac.lat, ac.lon, cfg.centerLat, cfg.centerLon);
  const mi = metersToMiles(rangeMeters(m));
  return { overhead: mi <= OVERHEAD_RADIUS_MI };
}

/**
 * Watch live traffic and play a jet pass when a plane enters the overhead zone.
 * Only active in position mode with overheadAlert enabled.
 */
export function useOverheadAlert(cfg: Config | undefined, aircraft: Aircraft[]): void {
  const tracksRef = useRef<Map<string, TrackState>>(new Map());

  useEffect(() => {
    if (!cfg?.overheadAlert || cfg.locationMode !== "position") {
      tracksRef.current.clear();
      return;
    }

    const now = Date.now();
    const tracks = tracksRef.current;
    const seen = new Set<string>();

    for (const ac of aircraft) {
      const hit = isOverheadCandidate(ac, cfg);
      if (!hit) continue;

      seen.add(ac.hex);
      const prev = tracks.get(ac.hex) ?? { inside: false, alertedAt: 0 };

      if (hit.overhead && !prev.inside && now - prev.alertedAt >= RE_ALERT_MS) {
        playOverheadPass();
        prev.alertedAt = now;
      }

      prev.inside = hit.overhead;
      tracks.set(ac.hex, prev);
    }

    for (const hex of tracks.keys()) {
      if (!seen.has(hex)) tracks.delete(hex);
    }
  }, [cfg, aircraft]);
}
