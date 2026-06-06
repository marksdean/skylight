import { DEFAULT_AIRPORT_ICAO, airportConfigPatch } from "./airport-resolve.js";

// Central, fully-adjustable configuration for the ceiling tracker.
// This object is the single source of truth shared between the display
// (projector) and the control panel (phone). Everything here is live-tunable
// and persisted server-side so changes survive reboots.

export type Theme = "ambient" | "telemetry" | "focus";
export type LabelDensity = "all" | "nearestN" | "nearestOnly";
export type DataSource = "radio" | "api";

export interface Palette {
  bg: string;
  glyph: string;
  /** Aircraft on the ground (taxi / ramp). */
  ground: string;
  trail: string;
  accent: string;
  warn: string;
  /** Range rings / compass ticks. */
  grid: string;
  /** Label / card text. */
  text: string;
}

export interface Fonts {
  label: string;
  mono: string;
}

export interface ShowFields {
  airline: boolean;
  flight: boolean;
  type: boolean;
  altitude: boolean;
  speed: boolean;
  verticalRate: boolean;
  destination: boolean;
  registration: boolean;
}

export type LocationMode = "airport" | "position";

export interface Config {
  // --- location & scope ---
  /** Airport for runway overlay; nearest field when locationMode is "position". */
  airportIcao: string;
  /** Map center — airport field or your GPS position. */
  centerLat: number;
  centerLon: number;
  /** When "position", centerLat/Lon are the observer (not an airport field). */
  locationMode: LocationMode;
  /** Play a jet pass sound when traffic crosses overhead (position mode only). */
  overheadAlert: boolean;
  radiusMiles: number;
  /** Auto-fit the zoom so the airport's runways fill the screen (airport mode). */
  autoZoomAirport: boolean;

  // --- calibration (tune against a real overhead pass) ---
  /** Rotate the whole field, degrees. */
  rotationDeg: number;
  /** Horizontal flip for the looking-up problem. */
  mirrorX: boolean;
  /** Vertical flip (rarely needed; available for awkward mounts). */
  mirrorY: boolean;
  /** Rotate only the text labels (so they read right-side-up from where you
   *  lie), independent of the field rotation. Degrees. */
  labelRotationDeg: number;

  // --- filtering ---
  minAltitudeFt: number;
  maxAltitudeFt: number;
  hideOnGround: boolean;

  // --- motion ---
  /** Display interpolation toggle (server poll cadence is separate). */
  interpolate: boolean;
  maxExtrapolationSec: number;
  staleSec: number;
  /** Ease factor toward each fresh fix (0 = snap, 1 = never move). */
  smoothing: number;
  /** Cap the render loop, frames per second. 0 = uncapped (use display
   *  refresh rate). Lower this to cut GPU/CPU load (and laptop fan noise). */
  maxFps: number;

  // --- visuals ---
  theme: Theme;
  palette: Palette;
  fonts: Fonts;
  glyphSizePx: number;
  /** Aircraft glyph rendering: solid fill, per-part outline, or single contour. */
  glyphStyle: "filled" | "outline" | "contour";
  /** Show a small carrier code badge on each aircraft glyph. */
  showCarrierBadge: boolean;
  /** Carrier badge style: ICAO code text or airline logo icon. */
  carrierBadgeStyle: "code" | "logo";
  /** Color the glyph by altitude. */
  altitudeColor: boolean;
  trailSeconds: number;
  /** Global brightness 0..1 (helps keep projector blacks deep). */
  brightness: number;

  // --- labels ---
  labelDensity: LabelDensity;
  nearestN: number;
  showFields: ShowFields;

  // --- overlays ---
  rangeRings: boolean;
  compass: boolean;
  highlightEmergency: boolean;
  /** Draw the airport (runways) at its true geographic position. */
  showAirport: boolean;
  /** Show the on-screen calibration HUD on the display. */
  showHud: boolean;

  // --- sky layer (sun / moon / stars / satellites at true positions) ---
  showStars: boolean;
  showSun: boolean;
  showMoon: boolean;
  showSatellites: boolean; // includes the ISS
  /** Faintest star magnitude to draw (higher = more stars). */
  starMagLimit: number;
  /** Offset the sky clock for testing/scrubbing, minutes (0 = live). */
  skyTimeOffsetMin: number;

  // --- "window to elsewhere" ---
  /** Faint great-circle arc toward each plane's destination. */
  showDestArc: boolean;
  /** Add destination local time + distance-to-go to labels. */
  showRouteDetail: boolean;
  /** Slow ticker of overhead destinations along the bottom edge. */
  showDestTicker: boolean;

  // --- ambient extras ---
  /** Tint the background subtly with the real sun altitude (day/twilight/night). */
  dayNightTint: boolean;
  /** Glow rare/iconic aircraft (A380, 747, heavies, military transports). */
  highlightRare: boolean;
  /** Draw active meteor-shower radiants when one is peaking. */
  showMeteorShowers: boolean;
  /** Show a small live weather readout (and faint cloud dimming). */
  showWeather: boolean;

  // --- airport tour ---
  /** Auto-cycle the view through the busiest airports right now. */
  airportTour: boolean;
  /** Seconds between airport tour hops. */
  airportTourIntervalSec: number;
}

const defaultAirport = airportConfigPatch(DEFAULT_AIRPORT_ICAO);

export const DEFAULT_CONFIG: Config = {
  airportIcao: defaultAirport.airportIcao,
  centerLat: defaultAirport.centerLat,
  centerLon: defaultAirport.centerLon,
  locationMode: "airport",
  overheadAlert: false,
  radiusMiles: 3,
  autoZoomAirport: false,

  rotationDeg: 0,
  mirrorX: true,
  mirrorY: false,
  labelRotationDeg: 0,

  minAltitudeFt: 100,
  maxAltitudeFt: 60000,
  hideOnGround: true,

  interpolate: true,
  maxExtrapolationSec: 5,
  staleSec: 20,
  smoothing: 0.18,
  maxFps: 0,

  theme: "ambient",
  palette: {
    bg: "#000000",
    glyph: "#E8ECFF",
    ground: "#9AB88C",
    trail: "#6B7280",
    accent: "#9B7ECF",
    warn: "#FF5A47",
    grid: "#3A4256",
    text: "#AEB6C6",
  },
  fonts: {
    label: "Inter, system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  glyphSizePx: 22,
  glyphStyle: "filled",
  showCarrierBadge: true,
  carrierBadgeStyle: "code",
  altitudeColor: true,
  trailSeconds: 45,
  brightness: 1,

  labelDensity: "all",
  nearestN: 5,
  showFields: {
    airline: true,
    flight: true,
    type: true,
    altitude: true,
    speed: true,
    verticalRate: false,
    destination: true,
    registration: false,
  },

  rangeRings: true,
  compass: true,
  highlightEmergency: true,
  showAirport: true,
  showHud: false,

  showStars: true,
  showSun: true,
  showMoon: true,
  showSatellites: true,
  starMagLimit: 2.6,
  skyTimeOffsetMin: 0,

  showDestArc: true,
  showRouteDetail: true,
  showDestTicker: false,

  dayNightTint: false,
  highlightRare: true,
  showMeteorShowers: true,
  showWeather: false,

  airportTour: false,
  airportTourIntervalSec: 10,
};

/**
 * Deep-merge a partial config onto a base, so persisted/partial payloads
 * never drop nested keys (palette, showFields, fonts).
 */
export function mergeConfig(base: Config, patch: Partial<Config>): Config {
  return {
    ...base,
    ...patch,
    palette: { ...base.palette, ...(patch.palette ?? {}) },
    fonts: { ...base.fonts, ...(patch.fonts ?? {}) },
    showFields: { ...base.showFields, ...(patch.showFields ?? {}) },
  };
}
