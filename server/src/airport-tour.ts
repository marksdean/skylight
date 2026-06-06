// Auto-cycle the view through the busiest airports right now. Server-driven so
// every connected display stays in sync (it just patches the shared config).

import type { ConfigStore } from "./config-store.js";
import type { AirportActivityStore } from "./airport-activity.js";
import type { AirportLookup } from "./airport-lookup.js";

const CHECK_MS = 2_000;

export class TourController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private index = 0;
  private lastHopAt = 0;

  constructor(
    private store: ConfigStore,
    private activity: AirportActivityStore,
    private lookup: AirportLookup,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const cfg = this.store.get();
    if (!cfg.airportTour) {
      this.lastHopAt = 0;
      return;
    }
    const intervalMs = Math.max(1, cfg.airportTourIntervalSec) * 1_000;
    const now = Date.now();
    if (this.lastHopAt && now - this.lastHopAt < intervalMs) return;

    const list = this.activity.get(15).airports;
    if (list.length === 0) return;

    this.index = (this.index + 1) % list.length;
    const next = list[this.index];
    const ap = await this.lookup.getAirport(next.icao);
    if (!ap) return;

    this.lastHopAt = now;
    this.store.patch({
      airportIcao: ap.icao,
      centerLat: ap.centerLat,
      centerLon: ap.centerLon,
      locationMode: "airport",
      showAirport: true,
    });
  }
}
