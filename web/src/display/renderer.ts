// Canvas renderer — the art piece.
//
// Motion model: every fix is stamped with its local arrival time and pushed to a
// per-aircraft history. We render the world RENDER_DELAY_MS in the past and
// *interpolate* between the two surrounding real fixes (rather than extrapolating
// into the future). Interpolating between known points is buttery smooth and
// removes the once-per-second "snap" you get from naive dead-reckoning. The small
// added latency is irrelevant for an ambient ceiling piece.
//
// Visual language: pure black, luminous altitude-graded glyphs, comet trails that
// taper and fade, and restrained typography that fades in only for the nearest few.

import {
  llToMeters,
  project,
  pxPerMeter,
  deadReckon,
  rangeMeters,
  metersToMiles,
  EMERGENCY_SQUAWKS,
  isRareAircraft,
  activeMeteorShowers,
  daysFromPeak,
  type Aircraft,
  type Config,
  type Meters,
  type Point,
} from "@shared/index.js";
import { getAirport } from "@shared/airport-resolve.js";
import { carrierIata } from "@shared/carriers.js";
import {
  carrierBadge,
  carrierHue,
  drawAircraftGlyph,
  GLYPH_SCALE,
  resolveSilhouette,
  type SilhouetteKind,
} from "./aircraftGlyph.js";
import tzlookup from "tz-lookup";
import { carrierLogos } from "../lib/carrierLogos.js";
import { airportPhotos } from "../lib/airportPhotos.js";
import type { WeatherSnapshot } from "../lib/airportApi.js";
import { computeSky, equatorialToHorizontal, type Sky, type Tle } from "./celestial.js";
import { ASTERISMS } from "./stars.js";

/** How far in the past we render, ms. Just over the ~1 Hz fix interval. */
const RENDER_DELAY_MS = 1150;

interface Sample {
  t: number; // performance.now() at arrival
  m: Meters;
  track?: number;
  gs?: number;
}

interface Track {
  ac: Aircraft;
  history: Sample[];
  firstSeen: number;
  lastSeen: number;
  hasPos: boolean;
  /** Smoothed appearance alpha (fade in on spawn, out when stale). */
  life: number;
}

type ProjOpts = Parameters<typeof project>[1];

// Altitude colour ramp — warm low, cool high. Tuned to glow on black.
const ALT_STOPS: [number, [number, number, number]][] = [
  [0, [255, 138, 61]], // amber (ground / pattern)
  [4000, [255, 198, 92]], // gold
  [10000, [120, 224, 196]], // teal
  [20000, [110, 178, 255]], // sky blue
  [30000, [150, 150, 255]], // periwinkle
  [40000, [232, 236, 255]], // near-white
];

function altRamp(alt: number): [number, number, number] {
  if (alt <= ALT_STOPS[0][0]) return ALT_STOPS[0][1];
  for (let i = 1; i < ALT_STOPS.length; i++) {
    if (alt <= ALT_STOPS[i][0]) {
      const [a0, c0] = ALT_STOPS[i - 1];
      const [a1, c1] = ALT_STOPS[i];
      const f = (alt - a0) / (a1 - a0);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return ALT_STOPS[ALT_STOPS.length - 1][1];
}

const rgba = (c: [number, number, number], a: number) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

interface Visible {
  tr: Track;
  m: Meters;
  p: Point;
  heading: number;
  rangeMi: number;
  alpha: number;
  color: [number, number, number];
  emergency: boolean;
  rare: boolean;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private tracks = new Map<string, Track>();
  private raf = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private prevFrame = 0;
  /** When the next frame is due (ms, rAF clock), for the maxFps cap.
   *  0 = uninitialized; set on the first capped frame. */
  private nextFrameDue = 0;
  /** Current frame time in seconds, for animating props/rotors. */
  private frameT = 0;

  // Sky layer state.
  private tles: Tle[] = [];
  private sky: Sky = { stars: [], sats: [] };
  private skyComputedAt = 0;
  private skyOffsetUsed = NaN;
  private plaqueIcao = "";
  private weather: WeatherSnapshot | null = null;
  private tickerOffset = 0;
  /** Cached auto-fit radius (miles) per airport, so we don't remeasure each frame. */
  private zoomCache: { icao: string; radius: number } | null = null;
  /** Current frame's pixels-per-meter, for sizing glyphs against the ground. */
  private pxPerM = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private getConfig: () => Config,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  start(): void {
    void this.fetchTles();
    setInterval(() => void this.fetchTles(), 3600_000);
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      // Cap to maxFps via an accumulator: advance a running "due" time by whole
      // frame intervals so the cadence stays anchored to a schedule (even
      // pacing, no drift) rather than to actual draw timestamps. fps <= 0 means
      // uncapped — draw on every rAF tick.
      const fps = this.getConfig().maxFps;
      if (fps > 0) {
        const interval = 1000 / fps;
        if (this.nextFrameDue === 0) this.nextFrameDue = now;
        if (now < this.nextFrameDue) return; // not due yet — skip this tick
        this.nextFrameDue += interval;
        // If we've fallen more than a frame behind (e.g. tab was backgrounded
        // or a draw stalled), resync to avoid a burst of catch-up frames.
        if (now - this.nextFrameDue > interval) this.nextFrameDue = now + interval;
      } else {
        this.nextFrameDue = 0; // reset so re-enabling the cap starts clean
      }
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private async fetchTles(): Promise<void> {
    try {
      const res = await fetch("/api/tle");
      if (res.ok) this.tles = (await res.json()) as Tle[];
    } catch {
      /* keep whatever we had */
    }
  }
  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Feed a fresh snapshot. Stamps each fix with local arrival time. */
  update(aircraft: Aircraft[]): void {
    const cfg = this.getConfig();
    const now = performance.now();
    for (const ac of aircraft) {
      if (!this.passesFilter(ac, cfg)) continue;
      const hasPos = ac.lat != null && ac.lon != null;
      const m = hasPos
        ? llToMeters(ac.lat!, ac.lon!, cfg.centerLat, cfg.centerLon)
        : { east: 0, north: 0 };
      let tr = this.tracks.get(ac.hex);
      if (!tr) {
        tr = { ac, history: [], firstSeen: now, lastSeen: now, hasPos, life: 0 };
        this.tracks.set(ac.hex, tr);
      }
      tr.ac = ac;
      tr.lastSeen = now;
      tr.hasPos = hasPos;
      if (hasPos) {
        const last = tr.history[tr.history.length - 1];
        // Dedup identical fixes (source sometimes repeats a position).
        if (!last || last.m.east !== m.east || last.m.north !== m.north) {
          tr.history.push({ t: now, m, track: ac.track, gs: ac.gs });
        }
      }
    }
  }

  private passesFilter(ac: Aircraft, cfg: Config): boolean {
    if (cfg.hideOnGround && ac.onGround) return false;
    const alt = ac.altBaro ?? ac.altGeom;
    if (alt != null) {
      if (alt < cfg.minAltitudeFt) return false;
      if (alt > cfg.maxAltitudeFt) return false;
    }
    return true;
  }

  /** Interpolate a track's position at render time `tt` (perf clock). */
  private sampleAt(tr: Track, tt: number, cfg: Config): Meters | null {
    const h = tr.history;
    if (h.length === 0) return null;
    if (tt <= h[0].t) return h[0].m;
    const lastS = h[h.length - 1];
    if (tt >= lastS.t) {
      // Beyond newest fix — extrapolate gently, capped.
      const dt = Math.min((tt - lastS.t) / 1000, cfg.maxExtrapolationSec);
      return cfg.interpolate ? deadReckon(lastS.m, lastS.track, lastS.gs, dt) : lastS.m;
    }
    // Find the bracketing pair.
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= tt && tt <= h[i].t) {
        const a = h[i - 1];
        const b = h[i];
        const f = (tt - a.t) / Math.max(1, b.t - a.t);
        return {
          east: a.m.east + (b.m.east - a.m.east) * f,
          north: a.m.north + (b.m.north - a.m.north) * f,
        };
      }
    }
    return lastS.m;
  }

  /** Smallest field radius (miles) that frames every runway with a margin. */
  private autoZoomRadius(cfg: Config): number {
    // Tour mode always frames each airport; the manual toggle covers static views.
    const wantZoom = cfg.autoZoomAirport || cfg.airportTour;
    if (!wantZoom || cfg.locationMode !== "airport") return cfg.radiusMiles;
    const ap = getAirport(cfg.airportIcao);
    if (!ap?.runways.length) return cfg.radiusMiles;
    if (this.zoomCache?.icao === ap.icao) return this.zoomCache.radius;

    let maxMeters = 0;
    for (const r of ap.runways) {
      for (const [lat, lon] of [r.le, r.he]) {
        const m = llToMeters(lat, lon, cfg.centerLat, cfg.centerLon);
        maxMeters = Math.max(maxMeters, rangeMeters(m));
      }
    }
    // 12% breathing room so runway-end labels aren't clipped; floor for tiny fields.
    const radius = Math.max(0.5, metersToMiles(maxMeters) * 1.12);
    this.zoomCache = { icao: ap.icao, radius };
    return radius;
  }

  private draw(): void {
    const base = this.getConfig();
    const fitRadius = this.autoZoomRadius(base);
    const cfg: Config = fitRadius === base.radiusMiles ? base : { ...base, radiusMiles: fitRadius };
    const ctx = this.ctx;
    const now = performance.now();
    const frameDt = this.prevFrame ? (now - this.prevFrame) / 1000 : 0.016;
    this.prevFrame = now;
    this.frameT = now / 1000;

    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h) {
      this.resize();
    }

    ctx.fillStyle = cfg.palette.bg;
    ctx.fillRect(0, 0, this.w, this.h);

    const pxPerM = pxPerMeter(this.w, this.h, cfg.radiusMiles);
    this.pxPerM = pxPerM;
    const proj: ProjOpts = {
      rotationDeg: cfg.rotationDeg,
      mirrorX: cfg.mirrorX,
      mirrorY: cfg.mirrorY,
      pxPerM,
      screenW: this.w,
      screenH: this.h,
    };

    // "basic" theme: bare glyphs + flight number only — skip every other layer.
    const basic = cfg.theme === "basic";

    if (!basic) {
      this.updateSky(cfg, now);
      this.drawTint(cfg);
      this.drawSky(cfg, proj);
      if (cfg.showMeteorShowers) this.drawMeteorShowers(cfg, proj);
      this.drawOverlays(cfg, proj);
    }
    // Runways are kept in basic mode for spatial context.
    if (cfg.showAirport) this.drawAirport(cfg, proj);

    const tt = now - RENDER_DELAY_MS;
    const visible: Visible[] = [];

    for (const [hex, tr] of this.tracks) {
      const stale = (now - tr.lastSeen) / 1000;
      if (stale > cfg.staleSec) {
        this.tracks.delete(hex);
        continue;
      }
      // Trim history to the trail window (+ a little headroom for interp).
      const keep = Math.max(cfg.trailSeconds, 6) * 1000 + 4000;
      while (tr.history.length > 2 && now - tr.history[0].t > keep) tr.history.shift();

      // Fade in on spawn, fade out as it goes stale.
      const target = stale > cfg.staleSec * 0.5 ? 0 : 1;
      tr.life += (target - tr.life) * Math.min(1, frameDt * 3.5);

      if (!tr.hasPos) continue;
      const m = this.sampleAt(tr, tt, cfg);
      if (!m) continue;

      const rangeMi = metersToMiles(rangeMeters(m));
      if (rangeMi > cfg.radiusMiles * 1.08) continue;

      const p = project(m, proj);
      const heading = this.screenHeading(tr, tt, proj);
      const edgeFade = clamp01((cfg.radiusMiles - rangeMi) / (cfg.radiusMiles * 0.14));
      const alpha = clamp01(edgeFade) * tr.life * cfg.brightness;
      const alt = tr.ac.altBaro ?? tr.ac.altGeom ?? 0;
      const color = tr.ac.onGround
        ? hexToRgb(cfg.palette.ground)
        : cfg.altitudeColor
          ? altRamp(alt)
          : hexToRgb(cfg.palette.glyph);
      const emergency = cfg.highlightEmergency && !!tr.ac.squawk && EMERGENCY_SQUAWKS.has(tr.ac.squawk);
      const rare = cfg.highlightRare && isRareAircraft(tr.ac);

      visible.push({ tr, m, p, heading, rangeMi, alpha, color, emergency, rare });
    }

    // Nearest last so it paints on top.
    visible.sort((a, b) => b.rangeMi - a.rangeMi);

    // Trails + glyphs for everyone.
    if (!basic) {
      if (cfg.showDestArc) for (const v of visible) this.drawDestArc(cfg, proj, v);
      for (const v of visible) this.drawTrail(cfg, proj, v, tt);
    }
    for (const v of visible) this.drawGlyph(cfg, v);

    // Labels: nearest are at the END after the sort.
    const byNear = [...visible].reverse(); // nearest first
    this.drawLabels(cfg, byNear);

    if (cfg.showAirport) this.drawAirportPlaque(cfg);
    if (!basic) {
      if (cfg.theme === "focus" && byNear.length) this.drawDetailPanel(cfg, byNear[0]);
      if (cfg.showWeather) this.drawWeather(cfg);
      if (cfg.showDestTicker) this.drawDestTicker(cfg, byNear, frameDt);
    }
  }

  /** Display feeds live weather here (fetched over REST). */
  setWeather(w: WeatherSnapshot | null): void {
    this.weather = w;
  }

  /** Subtle background wash driven by the real sun altitude. Opt-in: pure black
   *  stays the default so projector blacks remain deep. */
  private drawTint(cfg: Config): void {
    if (!cfg.dayNightTint) return;
    const alt = this.sky.sun?.alt;
    if (alt == null) return;

    // Map sun altitude to a soft sky color + strength.
    let rgb: [number, number, number];
    let strength: number;
    if (alt > 6) {
      rgb = [40, 78, 140]; // daylight blue
      strength = 0.16;
    } else if (alt > -0.5) {
      rgb = [210, 120, 70]; // sunrise/sunset gold
      strength = 0.18;
    } else if (alt > -6) {
      rgb = [120, 80, 120]; // civil twilight
      strength = 0.14;
    } else if (alt > -12) {
      rgb = [50, 50, 100]; // nautical twilight
      strength = 0.1;
    } else if (alt > -18) {
      rgb = [24, 28, 60]; // astronomical twilight
      strength = 0.06;
    } else {
      return; // true night — leave it black
    }

    const ctx = this.ctx;
    // Cloud cover deepens / greys the wash a touch when weather is shown.
    const cloud = cfg.showWeather && this.weather ? this.weather.cloudPct / 100 : 0;
    const a = strength * cfg.brightness * (1 - cloud * 0.4);
    const g = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      0,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.7,
    );
    g.addColorStop(0, rgba(rgb, a));
    g.addColorStop(1, rgba(rgb, a * 0.25));
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  /** Active meteor-shower radiants placed on the sky field. */
  private drawMeteorShowers(cfg: Config, proj: ProjOpts): void {
    const showers = activeMeteorShowers();
    if (!showers.length) return;
    const date = new Date(Date.now() + cfg.skyTimeOffsetMin * 60000);
    const ctx = this.ctx;

    for (const s of showers) {
      const { az, alt } = equatorialToHorizontal(s.ra, s.dec, date, cfg.centerLat, cfg.centerLon);
      if (alt < 0) continue; // radiant below horizon
      const p = this.projectSky(az, alt, cfg, proj);
      const near = Math.abs(daysFromPeak(s)) <= 1;
      const baseA = (near ? 0.85 : 0.5) * cfg.brightness;
      const rgb: [number, number, number] = [180, 210, 255];

      // A few faint streaks radiating outward (animated shimmer by frame time).
      ctx.save();
      const streaks = near ? 6 : 4;
      for (let i = 0; i < streaks; i++) {
        const ang = (i / streaks) * Math.PI * 2 + this.frameT * 0.15;
        const len = 10 + ((i * 7 + Math.floor(this.frameT * 2)) % 14);
        ctx.strokeStyle = rgba(rgb, 0.12 * baseA);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(ang) * len, p.y + Math.sin(ang) * len);
        ctx.stroke();
      }
      // Radiant core.
      ctx.fillStyle = rgba(rgb, 0.5 * baseA);
      ctx.beginPath();
      ctx.arc(p.x, p.y, near ? 2.6 : 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const label = near ? `${s.name} ✦ peak` : s.name;
      this.skyLabel(p, label, cfg, 0.7 * baseA, "#B4D2FF");
    }
  }

  /** Slow marquee of where overhead planes are headed. */
  private drawDestTicker(cfg: Config, nearestFirst: Visible[], frameDt: number): void {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const v of nearestFirst) {
      const ac = v.tr.ac;
      if (!ac.destination || !routePlausible(ac, cfg)) continue;
      const key = ac.destination;
      if (seen.has(key)) continue;
      seen.add(key);
      const city = ac.destName ?? "";
      const local = ac.destLat != null && ac.destLon != null ? localTime(ac.destLat, ac.destLon) : "";
      const bits = [ac.destination, city, local ? `${local} local` : ""].filter(Boolean);
      items.push(bits.join(" "));
    }
    if (!items.length) {
      this.tickerOffset = 0;
      return;
    }

    const ctx = this.ctx;
    const text = items.join("      ·      ") + "      ·      ";
    const y = this.h - 16;
    ctx.save();
    ctx.font = `300 13px ${cfg.fonts.label}`;
    try {
      ctx.letterSpacing = "1px";
    } catch {
      /* noop */
    }
    const unit = ctx.measureText(text).width;
    this.tickerOffset = (this.tickerOffset + frameDt * 38) % unit;
    ctx.fillStyle = rgba(hexToRgb(cfg.palette.text), 0.55 * cfg.brightness);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // Repeat to fill the width seamlessly.
    for (let x = -this.tickerOffset; x < this.w; x += unit) {
      ctx.fillText(text, x, y);
    }
    try {
      ctx.letterSpacing = "0px";
    } catch {
      /* noop */
    }
    ctx.restore();
  }

  /** Small live weather readout, tucked top-left under the HUD area. */
  private drawWeather(cfg: Config): void {
    const w = this.weather;
    if (!w) return;
    const ctx = this.ctx;
    const text = `${w.tempC}°C · ${w.label} · ${w.cloudPct}% cloud · ${w.windKph} km/h`;
    ctx.save();
    ctx.font = `300 12px ${cfg.fonts.label}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = rgba(hexToRgb(cfg.palette.text), 0.5 * cfg.brightness);
    ctx.fillText(text, 16, cfg.showHud ? 40 : 14);
    ctx.restore();
  }

  /**
   * Run `draw` with the canvas rotated by `labelRotationDeg` around an anchor,
   * so text reads upright from where the viewer lies without moving the field.
   */
  private withLabelRotation(cfg: Config, ax: number, ay: number, draw: () => void): void {
    if (!cfg.labelRotationDeg) {
      draw();
      return;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate((cfg.labelRotationDeg * Math.PI) / 180);
    ctx.translate(-ax, -ay);
    draw();
    ctx.restore();
  }

  private screenHeading(tr: Track, tt: number, proj: ProjOpts): number {
    const a = this.sampleAt(tr, tt - 400, this.getConfig());
    const b = this.sampleAt(tr, tt + 400, this.getConfig());
    if (a && b) {
      const pa = project(a, proj);
      const pb = project(b, proj);
      if (Math.hypot(pb.x - pa.x, pb.y - pa.y) > 0.5) {
        return Math.atan2(pb.y - pa.y, pb.x - pa.x);
      }
    }
    // Fallback: use reported track through the projection.
    const m = this.sampleAt(tr, tt, this.getConfig());
    if (m && tr.ac.track != null) {
      const ahead = deadReckon(m, tr.ac.track, 120, 1);
      const p0 = project(m, proj);
      const p1 = project(ahead, proj);
      return Math.atan2(p1.y - p0.y, p1.x - p0.x);
    }
    return 0;
  }

  // --- overlays: whisper-quiet rings + compass ---
  private drawOverlays(cfg: Config, proj: ProjOpts): void {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;

    if (cfg.rangeRings) {
      ctx.save();
      for (let mi = 1; mi <= Math.floor(cfg.radiusMiles); mi++) {
        const r = mi * 1609.34 * proj.pxPerM;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(hexToRgb(cfg.palette.grid), 0.5 * cfg.brightness);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 7]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // Center mark.
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = rgba(hexToRgb(cfg.palette.grid), 0.7 * cfg.brightness);
      ctx.fill();
      ctx.restore();
    }

    if (cfg.compass) {
      ctx.save();
      const R = (Math.min(this.w, this.h) / 2) * 0.965;
      ctx.font = `300 12px ${cfg.fonts.label}`;
      ctx.fillStyle = rgba(hexToRgb(cfg.palette.text), 0.32 * cfg.brightness);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      try {
        ctx.letterSpacing = "3px";
      } catch {
        /* older browsers */
      }
      for (const [label, deg] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as [string, number][]) {
        const dir: Meters = {
          east: Math.sin((deg * Math.PI) / 180) * 1e6,
          north: Math.cos((deg * Math.PI) / 180) * 1e6,
        };
        const p = project(dir, { ...proj, pxPerM: R / 1e6 });
        this.withLabelRotation(cfg, p.x, p.y, () => ctx.fillText(label, p.x, p.y));
      }
      try {
        ctx.letterSpacing = "0px";
      } catch {
        /* noop */
      }
      ctx.restore();
    }
  }

  // --- airport: runways at true geographic position ---
  private drawAirport(cfg: Config, proj: ProjOpts): void {
    if (cfg.locationMode === "position") return;
    const ap = getAirport(cfg.airportIcao);
    if (!ap) return;

    const ctx = this.ctx;
    const rwyRgb: [number, number, number] = [150, 180, 220];

    // Heliports carry no runway geometry — mark the pad with a circled "H".
    if (!ap.runways.length) {
      this.drawHeliportPad(cfg, proj, ap, rwyRgb);
      return;
    }

    for (const r of ap.runways) {
      const a = this.toScreen(r.le, cfg, proj);
      const b = this.toScreen(r.he, cfg, proj);
      // True runway width in px, nudged up a touch so it stays legible.
      const wpx = Math.max(2.5, r.widthFt * 0.3048 * proj.pxPerM * 1.4);

      ctx.save();
      ctx.lineCap = "butt";
      // Asphalt body.
      ctx.strokeStyle = rgba(rwyRgb, 0.16 * cfg.brightness);
      ctx.lineWidth = wpx;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // Dashed centerline.
      ctx.strokeStyle = rgba([210, 226, 255], 0.22 * cfg.brightness);
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Circled "H" pad marker for heliports (no runway geometry to draw). */
  private drawHeliportPad(
    cfg: Config,
    proj: ProjOpts,
    ap: { centerLat: number; centerLon: number },
    rgb: [number, number, number],
  ): void {
    const ctx = this.ctx;
    const c = this.toScreen([ap.centerLat, ap.centerLon], cfg, proj);
    const r = 18;
    ctx.save();
    ctx.fillStyle = rgba(rgb, 0.1 * cfg.brightness);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(rgb, 0.55 * cfg.brightness);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = rgba([210, 226, 255], 0.85 * cfg.brightness);
    ctx.font = `600 ${Math.round(r * 1.1)}px ${cfg.fonts.label}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("H", c.x, c.y + 1);
    ctx.restore();
  }

  /** Fixed corner plaque — top-right, away from focus detail panel and traffic labels. */
  private airportPlaqueLayout(cfg: Config): {
    x: number;
    y: number;
    w: number;
    h: number;
    photoSize: number;
    gap: number;
    innerPad: number;
    textW: number;
  } | null {
    if (!cfg.showAirport || cfg.locationMode === "position") return null;
    if (!getAirport(cfg.airportIcao)) return null;

    const margin = 16;
    const photoSize = 48;
    const gap = 10;
    const innerPad = 10;
    const textW = Math.min(220, this.w * 0.28);
    const plaqueW = innerPad + photoSize + gap + textW + innerPad;
    const plaqueH = innerPad * 2 + photoSize;
    return {
      x: this.w - margin - plaqueW,
      y: margin,
      w: plaqueW,
      h: plaqueH,
      photoSize,
      gap,
      innerPad,
      textW,
    };
  }

  private drawAirportPlaque(cfg: Config): void {
    if (cfg.locationMode === "position") return;
    const ap = getAirport(cfg.airportIcao);
    const layout = this.airportPlaqueLayout(cfg);
    if (!ap || !layout) return;
    if (this.plaqueIcao !== ap.icao) {
      airportPhotos.forgetExcept(ap.icao);
      this.plaqueIcao = ap.icao;
    }

    const ctx = this.ctx;
    const accent: [number, number, number] = [150, 180, 220];
    const textRgb = hexToRgb(cfg.palette.text);
    const { x, y, w: plaqueW, h: plaqueH, photoSize, gap, innerPad, textW } = layout;

    const code = ap.iata || ap.icao.replace(/^[A-Z]/, "");
    ctx.save();
    ctx.globalAlpha = cfg.brightness;

    // Panel backdrop.
    ctx.fillStyle = rgba([8, 10, 14], 0.82);
    ctx.strokeStyle = rgba(accent, 0.34);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, plaqueW, plaqueH, 12);
    ctx.fill();
    ctx.stroke();

    const photoX = x + innerPad;
    const photoY = y + innerPad;
    const photo = airportPhotos.request(ap.icao);
    if (photo) {
      ctx.save();
      ctx.fillStyle = rgba([255, 255, 255], 0.96);
      ctx.beginPath();
      ctx.roundRect(photoX, photoY, photoSize, photoSize, 8);
      ctx.fill();
      const pad = Math.max(2, photoSize * 0.08);
      ctx.beginPath();
      ctx.roundRect(photoX + pad, photoY + pad, photoSize - pad * 2, photoSize - pad * 2, 6);
      ctx.clip();
      ctx.drawImage(photo, photoX + pad, photoY + pad, photoSize - pad * 2, photoSize - pad * 2);
      ctx.restore();
      ctx.strokeStyle = rgba(accent, 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(photoX, photoY, photoSize, photoSize, 8);
      ctx.stroke();
    } else {
      this.drawAirportPhotoFallback(cfg, photoX, photoY, photoSize, accent);
    }

    const textX = photoX + photoSize + gap;
    const textCenterY = y + plaqueH / 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `600 22px ${cfg.fonts.label}`;
    ctx.fillStyle = rgba(accent, 0.96);
    try {
      ctx.letterSpacing = "5px";
    } catch {
      /* noop */
    }
    ctx.fillText(code, textX, textCenterY - 10);
    try {
      ctx.letterSpacing = "0px";
    } catch {
      /* noop */
    }

    ctx.font = `300 12px ${cfg.fonts.label}`;
    ctx.fillStyle = rgba(textRgb, 0.78);
    const name = this.wrapPlaqueText(ap.name, textW, 2);
    const nameLines = name.split("\n");
    const lineH = 14;
    const nameTop = textCenterY + 4;
    for (let i = 0; i < nameLines.length; i++) {
      ctx.fillText(nameLines[i], textX, nameTop + i * lineH + lineH / 2);
    }

    ctx.restore();
  }

  private drawAirportPhotoFallback(
    cfg: Config,
    x: number,
    y: number,
    size: number,
    accent: [number, number, number],
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = rgba([18, 24, 34], 0.95);
    ctx.strokeStyle = rgba(accent, 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 8);
    ctx.fill();
    ctx.stroke();

    const cx = x + size / 2;
    const cy = y + size / 2;
    const rwyLen = size * 0.34;
    const rwyGap = size * 0.11;
    ctx.lineCap = "butt";
    for (const offset of [-rwyGap, rwyGap]) {
      ctx.strokeStyle = rgba(accent, 0.42 * cfg.brightness);
      ctx.lineWidth = Math.max(2, size * 0.055);
      ctx.beginPath();
      ctx.moveTo(cx - rwyLen, cy + offset);
      ctx.lineTo(cx + rwyLen, cy + offset);
      ctx.stroke();
      ctx.strokeStyle = rgba([210, 226, 255], 0.24 * cfg.brightness);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(cx - rwyLen * 0.85, cy + offset);
      ctx.lineTo(cx + rwyLen * 0.85, cy + offset);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private wrapPlaqueText(text: string, maxWidth: number, maxLines: number): string {
    const ctx = this.ctx;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (lines.length === maxLines && words.length > 0) {
      let last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}…`;
    }
    return lines.join("\n");
  }

  private toScreen(ll: [number, number], cfg: Config, proj: ProjOpts): Point {
    return project(llToMeters(ll[0], ll[1], cfg.centerLat, cfg.centerLon), proj);
  }

  // --- sky layer (sun / moon / stars / satellites) ---
  private updateSky(cfg: Config, now: number): void {
    // The day/night tint needs the sun even when the sun glyph is hidden.
    const needSun = cfg.showSun || cfg.dayNightTint;
    const want = cfg.showStars || needSun || cfg.showMoon || cfg.showSatellites;
    if (!want) {
      this.sky = { stars: [], sats: [] };
      return;
    }
    if (now - this.skyComputedAt < 300 && this.skyOffsetUsed === cfg.skyTimeOffsetMin) return;
    this.skyComputedAt = now;
    this.skyOffsetUsed = cfg.skyTimeOffsetMin;
    const date = new Date(Date.now() + cfg.skyTimeOffsetMin * 60000);
    this.sky = computeSky(date, cfg.centerLat, cfg.centerLon, {
      sun: needSun,
      moon: cfg.showMoon,
      stars: cfg.showStars,
      satellites: cfg.showSatellites,
      magLimit: cfg.starMagLimit,
      tles: this.tles,
    });
  }

  /** Place an (azimuth, altitude) sky point on the field. Zenith=center, horizon=edge. */
  private projectSky(az: number, alt: number, cfg: Config, proj: ProjOpts): Point {
    const R = cfg.radiusMiles * 1609.34;
    const r = (1 - Math.max(0, alt) / 90) * R;
    const a = (az * Math.PI) / 180;
    return project({ east: Math.sin(a) * r, north: Math.cos(a) * r }, proj);
  }

  private drawSky(cfg: Config, proj: ProjOpts): void {
    const ctx = this.ctx;
    const b = cfg.brightness;

    // Asterism lines (faint) — need star screen points by id.
    if (cfg.showStars && this.sky.stars.length) {
      const pts = new Map<string, Point>();
      for (const s of this.sky.stars) {
        if (s.id) pts.set(s.id, this.projectSky(s.az, s.alt, cfg, proj));
      }
      ctx.save();
      ctx.strokeStyle = `rgba(150,170,220,${0.14 * b})`;
      ctx.lineWidth = 1;
      for (const [a, c] of ASTERISMS) {
        const pa = pts.get(a);
        const pc = pts.get(c);
        if (pa && pc) {
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pc.x, pc.y);
          ctx.stroke();
        }
      }
      ctx.restore();

      // Stars themselves, sized + twinkling by magnitude.
      for (const s of this.sky.stars) {
        const p = pts.get(s.id!)!;
        const mag = s.mag ?? 2;
        const size = Math.max(0.6, 2.6 - mag * 0.7);
        const tw = 0.78 + 0.22 * Math.sin(this.frameT * 3 + s.az);
        const a = clamp01((2.8 - mag) / 3) * b * tw;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(214,224,255,${a})`;
        if (mag < 0.6) {
          ctx.shadowColor = `rgba(200,215,255,${a})`;
          ctx.shadowBlur = size * 3;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        if (mag < 0.3 && s.name) this.skyLabel(p, s.name, cfg, 0.5 * b);
      }
    }

    if (cfg.showMoon && this.sky.moon && this.sky.moon.alt > -2) {
      this.drawMoon(this.projectSky(this.sky.moon.az, this.sky.moon.alt, cfg, proj),
        this.sky.moon.illum ?? 1, this.sky.moon.waning ?? false, b);
    }
    if (cfg.showSun && this.sky.sun && this.sky.sun.alt > -2) {
      this.drawSun(this.projectSky(this.sky.sun.az, this.sky.sun.alt, cfg, proj), b);
    }
    if (cfg.showSatellites && this.sky.sats.length) {
      for (const sat of this.sky.sats) {
        const p = this.projectSky(sat.az, sat.alt, cfg, proj);
        const iss = sat.kind === "iss";
        ctx.beginPath();
        ctx.arc(p.x, p.y, iss ? 3 : 1.6, 0, Math.PI * 2);
        if (iss) {
          ctx.fillStyle = `rgba(140,255,214,${0.95 * b})`;
          ctx.shadowColor = `rgba(140,255,214,${b})`;
          ctx.shadowBlur = 10;
        } else {
          ctx.fillStyle = `rgba(170,205,255,${0.65 * b})`;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        if (iss) this.skyLabel({ x: p.x + 6, y: p.y - 6 }, "ISS", cfg, 0.9 * b, "#8CFFD6");
      }
    }
  }

  private drawSun(p: Point, b: number): void {
    const ctx = this.ctx;
    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 26);
    g.addColorStop(0, `rgba(255,210,120,${0.9 * b})`);
    g.addColorStop(0.4, `rgba(255,180,80,${0.4 * b})`);
    g.addColorStop(1, "rgba(255,170,70,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,224,150,${b})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawMoon(p: Point, illum: number, waning: boolean, b: number): void {
    const ctx = this.ctx;
    const r = 8;
    ctx.save();
    // Soft glow.
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.6);
    g.addColorStop(0, `rgba(220,228,245,${0.35 * b})`);
    g.addColorStop(1, "rgba(220,228,245,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    // Dim full disc (earthshine).
    ctx.fillStyle = `rgba(64,72,90,${0.55 * b})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Lit region: bright limb semicircle + elliptical terminator.
    ctx.translate(p.x, p.y);
    ctx.scale(waning ? -1 : 1, 1); // bright limb on the right (waxing) / left (waning)
    const rx = r * (1 - 2 * illum); // >0 crescent, <0 gibbous, 0 = half
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(0, 0, Math.abs(rx), r, 0, Math.PI / 2, -Math.PI / 2, rx > 0);
    ctx.closePath();
    ctx.fillStyle = `rgba(232,238,250,${b})`;
    ctx.fill();
    ctx.restore();
  }

  private skyLabel(p: Point, text: string, cfg: Config, alpha: number, color = "#AEB6C6"): void {
    const ctx = this.ctx;
    this.withLabelRotation(cfg, p.x, p.y, () => {
      ctx.save();
      ctx.font = `300 10px ${cfg.fonts.label}`;
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      try {
        ctx.letterSpacing = "1px";
      } catch {
        /* noop */
      }
      ctx.fillText(text, p.x + 5, p.y);
      try {
        ctx.letterSpacing = "0px";
      } catch {
        /* noop */
      }
      ctx.restore();
    });
  }

  // --- window to elsewhere: faint great-circle arc toward destination ---
  private drawDestArc(cfg: Config, proj: ProjOpts, v: Visible): void {
    const ac = v.tr.ac;
    if (ac.lat == null || ac.lon == null || ac.destLat == null || ac.destLon == null) return;
    if (!routePlausible(ac, cfg)) return;
    const brg = bearing(ac.lat, ac.lon, ac.destLat, ac.destLon) * (Math.PI / 180);
    const stepM = cfg.radiusMiles * 1609.34 * 0.5;
    const ahead = project(
      { east: v.m.east + Math.sin(brg) * stepM, north: v.m.north + Math.cos(brg) * stepM },
      proj,
    );
    const dx = ahead.x - v.p.x;
    const dy = ahead.y - v.p.y;
    const len = Math.hypot(dx, dy) || 1;
    const L = Math.min(this.w, this.h) * 0.24;
    const ex = v.p.x + (dx / len) * L;
    const ey = v.p.y + (dy / len) * L;
    const ctx = this.ctx;
    ctx.save();
    const grad = ctx.createLinearGradient(v.p.x, v.p.y, ex, ey);
    grad.addColorStop(0, rgba(v.color, 0.32 * v.alpha));
    grad.addColorStop(1, rgba(v.color, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(v.p.x, v.p.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
  }

  // --- comet trail ---
  private drawTrail(cfg: Config, proj: ProjOpts, v: Visible, tt: number): void {
    if (cfg.trailSeconds <= 0) return;
    const ctx = this.ctx;
    const h = v.tr.history;
    if (h.length < 2) return;

    // Build the polyline from real fixes within the window, ending at the head.
    const windowMs = cfg.trailSeconds * 1000;
    const pts: { p: Point; age: number }[] = [];
    for (const s of h) {
      if (s.t < tt - windowMs || s.t > tt) continue;
      pts.push({ p: project(s.m, proj), age: (tt - s.t) / windowMs });
    }
    pts.push({ p: v.p, age: 0 });
    if (pts.length < 2) return;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const trailRgb = v.emergency ? hexToRgb(cfg.palette.warn) : hexToRgb(cfg.palette.trail);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const f = 1 - b.age; // 1 at head, 0 at tail
      ctx.strokeStyle = rgba(trailRgb, 0.55 * f * v.alpha);
      ctx.lineWidth = 0.7 + 2.2 * f * (cfg.glyphSizePx / 14);
      ctx.beginPath();
      ctx.moveTo(a.p.x, a.p.y);
      ctx.lineTo(b.p.x, b.p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Glyph half-size in px. Wide views keep the configured (exaggerated) size for
   * visibility. Zoomed in to airport scale, fixed-px glyphs would be drawn far
   * larger than the real aircraft and overhang the runway, so we blend toward a
   * footprint that matches the plane's true length — keeping it sitting on the
   * runway instead of spilling across it.
   */
  private glyphSize(cfg: Config, kind: SilhouetteKind): number {
    const fixed = cfg.glyphSizePx * GLYPH_SCALE[kind];
    if (this.pxPerM <= 0) return fixed;
    // Nominal real length (m) per family; the drawn silhouette spans ~2.2·s.
    const lengthM = 34 * GLYPH_SCALE[kind];
    const FOOTPRINT = 2.2;
    const physical = (lengthM * this.pxPerM) / FOOTPRINT;
    // Allow a small exaggeration over true size; never vanish entirely.
    const cap = Math.max(physical * 1.6, 6);
    // Blend in the cap only at airport scale (~under 2.4 mi radius).
    const blend = clamp01((2.4 - cfg.radiusMiles) / 1.2);
    return fixed + (Math.min(fixed, cap) - fixed) * blend;
  }

  // --- glyph: type-aware luminous silhouette ---
  private drawGlyph(cfg: Config, v: Visible): void {
    const ctx = this.ctx;
    const color = v.emergency ? hexToRgb(cfg.palette.warn) : v.color;
    const silhouette = resolveSilhouette(v.tr.ac);
    const s = this.glyphSize(cfg, silhouette);

    ctx.save();
    ctx.translate(v.p.x, v.p.y);
    ctx.rotate(v.heading + Math.PI / 2);

    // Soft halo — restrained so the silhouette reads as an aircraft.
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 1.7);
    halo.addColorStop(0, rgba(color, 0.16 * v.alpha));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.7, 0, Math.PI * 2);
    ctx.fill();

    // Rare / iconic aircraft get a warm pulsing ring so they stand out.
    if (v.rare && !v.emergency) {
      const pulse = 0.5 + 0.5 * Math.sin(this.frameT * 2.2 + hexSeed(v.tr.ac.hex));
      const ringRgb: [number, number, number] = [255, 209, 102];
      ctx.strokeStyle = rgba(ringRgb, (0.35 + 0.35 * pulse) * v.alpha);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, s * (1.9 + 0.12 * pulse), 0, Math.PI * 2);
      ctx.stroke();
    }

    drawAircraftGlyph(
      ctx, silhouette, s, color, v.alpha, this.frameT, hexSeed(v.tr.ac.hex),
      cfg.glyphStyle,
    );
    ctx.restore();

    if (cfg.theme !== "basic" && cfg.showCarrierBadge && cfg.glyphSizePx >= 10) {
      this.drawCarrierBadge(cfg, v, s);
    }
  }

  /** Small upright carrier badge (code or logo) tucked under the glyph. */
  private drawCarrierBadge(cfg: Config, v: Visible, glyphScale: number): void {
    const code = carrierBadge(v.tr.ac);
    if (!code) return;

    const ctx = this.ctx;
    const a = v.alpha;
    if (a < 0.08) return;

    const iata = carrierIata(v.tr.ac);
    if (cfg.carrierBadgeStyle === "logo" && iata) {
      const img = carrierLogos.request(iata);
      if (img) {
        const size = Math.max(14, Math.min(22, cfg.glyphSizePx * 0.82));
        const y = v.p.y + glyphScale * 1.02 + size * 0.45;
        this.withLabelRotation(cfg, v.p.x, y, () => {
          const x = v.p.x - size / 2;
          const top = y - size / 2;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.fillStyle = rgba([255, 255, 255], 0.94);
          ctx.beginPath();
          ctx.roundRect(x, top, size, size, 4);
          ctx.fill();
          ctx.strokeStyle = rgba([255, 255, 255], 0.28);
          ctx.lineWidth = 1;
          ctx.stroke();
          const pad = Math.max(2, size * 0.12);
          ctx.drawImage(img, x + pad, top + pad, size - pad * 2, size - pad * 2);
          ctx.restore();
        });
        return;
      }
    }

    const fontSize = Math.max(8, Math.min(11, cfg.glyphSizePx * 0.42));
    const padX = 4;
    const padY = 2;
    const y = v.p.y + glyphScale * 1.05 + fontSize * 0.35;

    this.withLabelRotation(cfg, v.p.x, y, () => {
      ctx.font = `600 ${fontSize}px ${cfg.fonts.mono}`;
      const w = ctx.measureText(code).width + padX * 2;
      const h = fontSize + padY * 2;
      const x = v.p.x - w / 2;
      const top = y - h / 2;

      ctx.fillStyle = `hsla(${carrierHue(code)}, 52%, 38%, ${0.88 * a})`;
      ctx.beginPath();
      ctx.roundRect(x, top, w, h, 3);
      ctx.fill();

      ctx.strokeStyle = rgba([255, 255, 255], 0.22 * a);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = rgba([255, 255, 255], 0.92 * a);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(code, v.p.x, y);
    });
  }

  // --- labels: restrained typography, nearest only ---
  private placedBoxes: { x: number; y: number; w: number; h: number }[] = [];

  private drawLabels(cfg: Config, nearestFirst: Visible[]): void {
    const limit =
      cfg.theme === "basic" || cfg.labelDensity === "all"
        ? nearestFirst.length
        : cfg.labelDensity === "nearestN"
          ? cfg.nearestN
          : 1;
    this.placedBoxes = [];
    const plaque = this.airportPlaqueLayout(cfg);
    if (plaque) {
      // Keep aircraft labels out of the airport plaque zone.
      this.placedBoxes.push({
        x: plaque.x - 10,
        y: plaque.y - 10,
        w: plaque.w + 20,
        h: plaque.h + 20,
      });
    }
    if (cfg.theme === "focus") {
      // Focus theme detail readout sits bottom-left.
      this.placedBoxes.push({ x: 24, y: this.h - 140, w: this.w * 0.55, h: 72 });
    }
    for (let i = 0; i < Math.min(limit, nearestFirst.length); i++) {
      // Nearest labels brightest; gently dim further ones (but keep readable).
      const prom = 1 - i / Math.max(1, nearestFirst.length);
      // Basic theme dims flight numbers so the planes stay the focus.
      const strength = cfg.theme === "basic" ? 0.4 : 0.7 + 0.3 * prom;
      this.drawLabel(cfg, nearestFirst[i], strength);
    }
  }

  private measureLabel(
    cfg: Config,
    lines: { text: string; kind: "title" | "sub" }[],
  ): { w: number; lh: number; h: number } {
    const ctx = this.ctx;
    const lh = 16;
    let w = 0;
    for (const ln of lines) {
      ctx.font = ln.kind === "title" ? `500 14px ${cfg.fonts.label}` : `400 11px ${cfg.fonts.label}`;
      try {
        ctx.letterSpacing = ln.kind === "title" ? "1.5px" : "0.5px";
      } catch {
        /* noop */
      }
      w = Math.max(w, ctx.measureText(ln.text).width);
    }
    try {
      ctx.letterSpacing = "0px";
    } catch {
      /* noop */
    }
    return { w: w + 2, lh, h: lines.length * lh };
  }

  private collides(b: { x: number; y: number; w: number; h: number }): boolean {
    const pad = 3;
    for (const p of this.placedBoxes) {
      if (
        b.x - pad < p.x + p.w &&
        b.x + b.w + pad > p.x &&
        b.y - pad < p.y + p.h &&
        b.y + b.h + pad > p.y
      ) {
        return true;
      }
    }
    return false;
  }

  private labelLines(cfg: Config, ac: Aircraft): { text: string; kind: "title" | "sub" }[] {
    // Basic theme: just the flight number (fall back to hex), nothing else.
    if (cfg.theme === "basic") {
      const id = ac.flight?.trim() || ac.hex.toUpperCase();
      return id ? [{ text: id, kind: "title" }] : [];
    }
    const f = cfg.showFields;
    const out: { text: string; kind: "title" | "sub" }[] = [];
    const title = f.flight ? ac.flight ?? ac.hex.toUpperCase() : ac.airline;
    if (title) out.push({ text: title, kind: "title" });

    const sub: string[] = [];
    if (f.type && (ac.typeName || ac.typeCode)) sub.push(ac.typeName ?? ac.typeCode!);
    const alt = ac.altBaro ?? ac.altGeom;
    if (f.altitude) {
      if (ac.onGround) sub.push("GND");
      else if (alt != null) sub.push(`${alt.toLocaleString("en-US")} ft`);
    }
    if (f.speed && ac.gs != null) sub.push(`${Math.round(ac.gs)} kt`);
    if (sub.length) out.push({ text: sub.join("   "), kind: "sub" });

    if (f.destination && ac.destination && routePlausible(ac, cfg)) {
      const head = ac.origin ? `${ac.origin} → ${ac.destination}` : `→ ${ac.destination}`;
      out.push({ text: ac.destName ? `${head}   ${ac.destName}` : head, kind: "sub" });
      if (cfg.showRouteDetail && ac.destLat != null && ac.destLon != null) {
        const bits: string[] = [`${localTime(ac.destLat, ac.destLon)} local`];
        if (ac.lat != null && ac.lon != null) {
          const mi = Math.round(greatCircleMiles(ac.lat, ac.lon, ac.destLat, ac.destLon));
          if (mi > 1) bits.push(`${mi.toLocaleString("en-US")} mi to go`);
        }
        out.push({ text: bits.join("   ·   "), kind: "sub" });
      }
    }
    if (f.registration && ac.registration) out.push({ text: ac.registration, kind: "sub" });
    return out;
  }

  private drawLabel(cfg: Config, v: Visible, strength: number): void {
    const ctx = this.ctx;
    const lines = this.labelLines(cfg, v.tr.ac);
    if (!lines.length) return;
    const a = v.alpha * strength;
    if (a < 0.04) return;

    const { w, lh, h } = this.measureLabel(cfg, lines);
    const gap = cfg.glyphSizePx * 0.7 + 9;
    const onScreen = (b: { x: number; y: number; w: number; h: number }) =>
      b.x >= 6 && b.x + b.w <= this.w - 6 && b.y >= 6 && b.y + b.h <= this.h - 6;

    // Try four quadrants, then nudge downward, to avoid overlapping other labels.
    const candidates = [
      { x: v.p.x + gap, y: v.p.y - gap - h },
      { x: v.p.x + gap, y: v.p.y + gap },
      { x: v.p.x - gap - w, y: v.p.y - gap - h },
      { x: v.p.x - gap - w, y: v.p.y + gap },
    ];
    let box: { x: number; y: number; w: number; h: number } | null = null;
    for (const c of candidates) {
      const b = { x: c.x, y: c.y, w, h };
      if (onScreen(b) && !this.collides(b)) {
        box = b;
        break;
      }
    }
    if (!box) {
      let b = { x: v.p.x + gap, y: v.p.y - gap - h, w, h };
      for (let k = 0; k < 9 && (this.collides(b) || !onScreen(b)); k++) {
        b = { ...b, y: b.y + lh + 2 };
      }
      box = b;
    }
    box.x = Math.max(6, Math.min(box.x, this.w - 6 - w));
    box.y = Math.max(6, Math.min(box.y, this.h - 6 - h));
    this.placedBoxes.push(box);

    // Hairline leader from glyph to the nearest edge of the label.
    const anchorX = box.x + w / 2 < v.p.x ? box.x + w : box.x;
    const anchorY = Math.max(box.y, Math.min(v.p.y, box.y + h));
    // Rotate the whole label (leader + text) around the glyph so it reads
    // upright from where you lie, without disturbing the field.
    this.withLabelRotation(cfg, v.p.x, v.p.y, () => {
      ctx.save();
      ctx.strokeStyle = rgba(hexToRgb(cfg.palette.text), 0.24 * a);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(v.p.x, v.p.y);
      ctx.lineTo(anchorX, anchorY);
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 6;
      let y = box.y;
      for (const ln of lines) {
        if (ln.kind === "title") {
          ctx.font = `500 14px ${cfg.fonts.label}`;
          ctx.fillStyle = rgba([245, 247, 255], a);
          try {
            ctx.letterSpacing = "1.5px";
          } catch {
            /* noop */
          }
        } else {
          ctx.font = `400 11px ${cfg.fonts.label}`;
          ctx.fillStyle = rgba(hexToRgb(cfg.palette.text), 0.82 * a);
          try {
            ctx.letterSpacing = "0.5px";
          } catch {
            /* noop */
          }
        }
        ctx.fillText(ln.text, box.x, y);
        y += lh;
      }
      try {
        ctx.letterSpacing = "0px";
      } catch {
        /* noop */
      }
      ctx.restore();
    });
  }

  private drawDetailPanel(cfg: Config, v: Visible): void {
    const ac = v.tr.ac;
    const x = 40;
    const y = this.h - 120;
    this.withLabelRotation(cfg, x, y, () => this.drawDetailPanelText(cfg, v, ac, x, y));
  }

  private drawDetailPanelText(cfg: Config, v: Visible, ac: Aircraft, x: number, y: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 10;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    try {
      ctx.letterSpacing = "2px";
    } catch {
      /* noop */
    }
    ctx.font = `300 34px ${cfg.fonts.label}`;
    ctx.fillStyle = rgba([245, 247, 255], v.alpha);
    ctx.fillText(ac.flight ?? ac.hex.toUpperCase(), x, y);
    try {
      ctx.letterSpacing = "0.5px";
    } catch {
      /* noop */
    }
    ctx.font = `400 15px ${cfg.fonts.label}`;
    ctx.fillStyle = rgba(hexToRgb(cfg.palette.text), 0.85 * v.alpha);
    const dpAlt = ac.altBaro ?? ac.altGeom;
    const bits = [
      ac.airline,
      ac.typeName ?? ac.typeCode,
      ac.onGround ? "on ground" : dpAlt != null ? `${dpAlt.toLocaleString("en-US")} ft` : null,
      ac.gs != null ? `${Math.round(ac.gs)} kt` : null,
      ac.origin && ac.destination && routePlausible(ac, cfg) ? `${ac.origin} → ${ac.destination}` : null,
    ].filter(Boolean);
    ctx.fillText(bits.join("    ·    "), x, y + 26);
    try {
      ctx.letterSpacing = "0px";
    } catch {
      /* noop */
    }
    ctx.restore();
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Stable per-aircraft phase offset (0..2π) so props/rotors aren't all in sync. */
function hexSeed(hex: string): number {
  let n = 0;
  for (let i = 0; i < hex.length; i++) n = (n * 31 + hex.charCodeAt(i)) % 360;
  return (n / 360) * Math.PI * 2;
}

const DEG = Math.PI / 180;

/** Initial great-circle bearing (deg from North) from point 1 to point 2. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * DEG;
  const φ2 = lat2 * DEG;
  const Δλ = (lon2 - lon1) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Great-circle distance in statute miles. */
function greatCircleMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * DEG;
  const φ2 = lat2 * DEG;
  const dφ = (lat2 - lat1) * DEG;
  const dλ = (lon2 - lon1) * DEG;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// lat,lon (rounded) -> IANA timezone name ("" if lookup failed).
const tzNameCache = new Map<string, string>();
// timezone -> { minute stamp, formatted HH:MM } so we format at most once/min/zone.
const tzTimeCache = new Map<string, { min: number; text: string }>();

/** Wall-clock time at a place, DST-correct via a tz lookup, as HH:MM. Falls
 *  back to longitude-based mean solar time if the lookup fails. */
function localTime(lat: number, lon: number): string {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let tz = tzNameCache.get(key);
  if (tz === undefined) {
    try {
      tz = tzlookup(lat, lon);
    } catch {
      tz = "";
    }
    tzNameCache.set(key, tz);
  }
  if (!tz) return solarTimeAt(lon);

  const min = Math.floor(Date.now() / 60000);
  const cached = tzTimeCache.get(tz);
  if (cached && cached.min === min) return cached.text;
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  tzTimeCache.set(tz, { min, text });
  return text;
}

/** Longitude-based mean solar time (no DST/tz db) as HH:MM — last-resort fallback. */
function solarTimeAt(lon: number): string {
  const now = new Date();
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  let m = (utcMin + (lon / 15) * 60) % 1440;
  if (m < 0) m += 1440;
  const hh = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Cross-track distance (miles) of a point from the great circle p1→p2. */
function crossTrackMiles(
  lat: number, lon: number,
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 3958.8;
  const d13 = greatCircleMiles(lat1, lon1, lat, lon) / R; // angular (rad)
  const θ13 = bearing(lat1, lon1, lat, lon) * DEG;
  const θ12 = bearing(lat1, lon1, lat2, lon2) * DEG;
  return Math.asin(Math.sin(d13) * Math.sin(θ13 - θ12)) * R;
}

/**
 * Is the adsbdb route consistent with where the plane actually is and what it's
 * doing? adsbdb returns the scheduled route for a callsign, which is sometimes
 * the wrong leg. We reject a route if:
 *  (a) it's geographically impossible — the plane is neither near an endpoint
 *      nor roughly on the great-circle path; or
 *  (b) the plane's vertical trend disagrees — a climbing plane near you just
 *      departed the local airport (so that should be the origin); a descending
 *      one is arriving (the destination).
 */
function routePlausible(ac: Aircraft, cfg: Config): boolean {
  if (ac.lat == null || ac.lon == null) return true;
  const haveCoords = ac.originLat != null || ac.destLat != null;
  if (!haveCoords) return true; // legacy cache without coords — don't hide

  // (a) geographic consistency
  const nearPlane = (la?: number, lo?: number) =>
    la != null && lo != null && greatCircleMiles(ac.lat!, ac.lon!, la, lo) < 80;
  let geomOk = nearPlane(ac.originLat, ac.originLon) || nearPlane(ac.destLat, ac.destLon);
  if (
    !geomOk &&
    ac.originLat != null && ac.originLon != null &&
    ac.destLat != null && ac.destLon != null
  ) {
    geomOk = Math.abs(crossTrackMiles(ac.lat, ac.lon, ac.originLat, ac.originLon, ac.destLat, ac.destLon)) < 130;
  } else if (!geomOk && (ac.originLat == null || ac.destLat == null)) {
    geomOk = true; // only one endpoint known and not near — can't judge, allow
  }
  if (!geomOk) return false;

  // (b) vertical-trend consistency for low, nearby traffic
  const alt = ac.altBaro ?? ac.altGeom;
  const localTraffic = greatCircleMiles(ac.lat, ac.lon, cfg.centerLat, cfg.centerLon) < 30;
  const localAirport = (la?: number, lo?: number) =>
    la != null && lo != null && greatCircleMiles(cfg.centerLat, cfg.centerLon, la, lo) < 45;
  if (localTraffic && alt != null && alt < 12000 && ac.baroRate != null && Math.abs(ac.baroRate) > 250) {
    if (ac.baroRate > 0) {
      if (ac.originLat != null && !localAirport(ac.originLat, ac.originLon)) return false; // departing
    } else {
      if (ac.destLat != null && !localAirport(ac.destLat, ac.destLon)) return false; // arriving
    }
  }
  return true;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}
