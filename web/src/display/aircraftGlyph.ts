// Type-aware top-down aircraft silhouettes. ICAO type codes map to plan-view
// profiles with distinctive engine placement, wing position, and tail shape.

import type { Aircraft } from "@shared/index.js";
import { withGlyphBuffer } from "./glyphBuffer.js";

export type SilhouetteKind =
  | "superjumbo" // A380 — very wide quad
  | "hump-quad" // B747 — upper-deck hump + quad
  | "quad-jet" // A340, IL-96, etc.
  | "wide-twin" // B777, A330, A350, B787
  | "narrow-long" // B757
  | "a220" // Airbus A220
  | "narrow-twin" // B737, A320 family
  | "embraer" // E-Jets
  | "regional-t-tail" // CRJ, ERJ — aft engines, T-tail
  | "md-rear" // MD-80/90, 717 — aft engines, T-tail
  | "turboprop-high" // Dash 8, ATR — high wing
  | "turboprop-single" // Caravan, PC-12
  | "cargo-turboprop" // C-130 — high wing quad prop
  | "bizjet" // Citations, Gulfstreams
  | "ga-twin" // light twins
  | "ga-single" // C172, Piper, etc.
  | "helicopter";

/** @deprecated Use SilhouetteKind — kept for compatibility. */
export type GlyphKind =
  | "light"
  | "turboprop"
  | "airliner"
  | "widebody"
  | "quadjet"
  | "helicopter";

export const GLYPH_SCALE: Record<SilhouetteKind, number> = {
  superjumbo: 1.55,
  "hump-quad": 1.48,
  "quad-jet": 1.42,
  "wide-twin": 1.28,
  "narrow-long": 1.12,
  a220: 0.94,
  "narrow-twin": 1.0,
  embraer: 0.9,
  "regional-t-tail": 0.78,
  "md-rear": 0.96,
  "turboprop-high": 0.86,
  "turboprop-single": 0.72,
  "cargo-turboprop": 1.08,
  bizjet: 0.68,
  "ga-twin": 0.64,
  "ga-single": 0.58,
  helicopter: 0.82,
};

const HELI = new Set([
  "EC20", "EC25", "EC30", "EC35", "EC45", "EC55", "AS50", "AS55", "AS65", "AS32",
  "A109", "A119", "A139", "A169", "A189", "B06", "B06T", "B407", "B412", "B427",
  "B429", "B430", "B505", "S76", "S92", "S61", "S64", "H60", "H500", "MD52",
  "MD60", "R22", "R44", "R66", "EXEC", "EXPL", "GAZL", "LYNX", "NH90", "PUMA",
  "SCAV", "UH1", "B105", "B212", "B214", "B222", "AC", "H47", "H64",
]);

const SUPERJUMBO = new Set(["A388"]);
const HUMP_QUAD = new Set(["B741", "B742", "B743", "B744", "B748", "B74S", "B74R", "B74D"]);
const QUAD_JET = new Set([
  "A342", "A343", "A345", "A346", "A124", "C5M", "A225", "IL96", "A140", "B52",
]);
const WIDE_TWIN = new Set([
  "A306", "A30B", "A310", "A332", "A333", "A338", "A339", "A359", "A35K", "A337",
  "B762", "B763", "B764", "B772", "B77L", "B773", "B77W", "B778", "B779",
  "B788", "B789", "B78X", "MD11", "IL86", "DC10", "L101",
]);
const NARROW_LONG = new Set(["B752", "B753"]);
const A220 = new Set(["BCS1", "BCS3"]);
const NARROW_TWIN = new Set([
  "A318", "A319", "A320", "A321", "A19N", "A20N", "A21N",
  "B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739",
  "B37M", "B38M", "B39M", "B3XM", "B722", "B721",
]);
const EMBRAER = new Set([
  "E170", "E75S", "E75L", "E190", "E195", "E290", "E295", "E390", "E395",
]);
const REGIONAL_T = new Set(["CRJ2", "CRJ7", "CRJ9", "CRJX", "E135", "E145", "E35L", "E50P"]);
const MD_REAR = new Set([
  "MD81", "MD82", "MD83", "MD87", "MD88", "MD90", "B712", "DC91", "DC92", "DC93",
  "DC94", "DC95", "DC96", "RJ85", "RJ1H",
]);
const TPROP_HIGH = new Set([
  "DH8A", "DH8B", "DH8C", "DH8D", "AT43", "AT44", "AT45", "AT46", "AT72", "AT73",
  "AT75", "AT76", "SF34", "SB20", "JS31", "JS32", "JS41", "D228", "D328", "F50",
  "F27", "ATP", "DHC6", "DHC7", "SH36", "CVLT", "SAAB", "AN26", "AN32",
]);
const TPROP_SINGLE = new Set([
  "C208", "C212", "C408", "PC12", "PC6", "B190", "BE20", "TBM7", "TBM8", "TBM9",
  "TBM0", "C441", "C425", "E110", "E120",
]);
const CARGO_TPROP = new Set(["C130", "C30J", "AN12", "P3", "C160"]);
const BIZJET = new Set([
  "C25A", "C25B", "C25C", "C25M", "C500", "C510", "C525", "C550", "C560", "C56X",
  "C680", "C700", "C750", "GLF2", "GLF3", "GLF4", "GLF5", "GLF6", "GLEX", "GALX",
  "LJ35", "LJ45", "LJ60", "LJ75", "FA50", "FA7X", "FA8X", "CL30", "CL35", "CL60",
  "H25B", "E50P", "E55P", "SF50",
]);
const GA_TWIN = new Set([
  "BE58", "BE76", "BE99", "PA34", "PA44", "DA42", "DA62", "C310", "C337", "C402",
  "C414", "C421", "P68", "BN2P",
]);
const GA_SINGLE = new Set([
  "C150", "C152", "C162", "C172", "C72R", "C175", "C177", "C180", "C182", "C185",
  "C188", "C206", "C207", "C210", "SR20", "SR22", "S22T", "PA18", "PA24", "PA28",
  "P28A", "P28B", "P28R", "PA32", "P32R", "PA38", "PA46", "DA20", "DA40", "BE33",
  "BE35", "BE36", "BE19", "BE23", "BE24", "M20P", "M20T", "AA1", "AA5", "GLAS",
  "COL4", "RV4", "RV6", "RV7", "RV8", "RV9", "RV10", "RV14", "GA8", "G115", "BL8",
  "CH7",
]);

const AIRLINE_SUFFIX = /^(air|airline|airlines|airways)$/i;

export function carrierCodeFromCallsign(flight?: string): string | undefined {
  const cs = flight?.trim().toUpperCase();
  if (!cs || cs.length < 4) return undefined;
  const prefix = cs.slice(0, 3);
  if (!/^[A-Z]{3}$/.test(prefix) || !/\d/.test(cs[3])) return undefined;
  return prefix;
}

export function carrierBadge(ac: Aircraft): string | undefined {
  const fromCallsign = carrierCodeFromCallsign(ac.flight);
  if (fromCallsign) return fromCallsign;
  if (!ac.airline) return undefined;
  const words = ac.airline
    .trim()
    .split(/\s+/)
    .filter((w) => w && !AIRLINE_SUFFIX.test(w));
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  const word = words[0] ?? ac.airline.trim();
  return word.slice(0, 3).toUpperCase();
}

export function carrierHue(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function resolveSilhouette(ac: Aircraft): SilhouetteKind {
  const code = (ac.typeCode || "").toUpperCase();
  const cat = ac.category;
  if (cat === "A7" || HELI.has(code)) return "helicopter";
  if (SUPERJUMBO.has(code)) return "superjumbo";
  if (HUMP_QUAD.has(code)) return "hump-quad";
  if (QUAD_JET.has(code)) return "quad-jet";
  if (WIDE_TWIN.has(code) || cat === "A5") return "wide-twin";
  if (NARROW_LONG.has(code)) return "narrow-long";
  if (A220.has(code)) return "a220";
  if (NARROW_TWIN.has(code)) return "narrow-twin";
  if (EMBRAER.has(code)) return "embraer";
  if (REGIONAL_T.has(code)) return "regional-t-tail";
  if (MD_REAR.has(code)) return "md-rear";
  if (CARGO_TPROP.has(code)) return "cargo-turboprop";
  if (TPROP_HIGH.has(code)) return "turboprop-high";
  if (TPROP_SINGLE.has(code)) return "turboprop-single";
  if (BIZJET.has(code)) return "bizjet";
  if (GA_TWIN.has(code)) return "ga-twin";
  if (GA_SINGLE.has(code) || cat === "A1") return "ga-single";
  // Family-prefix fallbacks for unlisted variants.
  if (code.startsWith("B73") || code.startsWith("B38") || code.startsWith("B39")) return "narrow-twin";
  if (code.startsWith("A32") || code.startsWith("A20") || code.startsWith("A21")) return "narrow-twin";
  if (code.startsWith("B77") || code.startsWith("B78") || code.startsWith("A33") || code.startsWith("A35")) {
    return "wide-twin";
  }
  if (code.startsWith("CRJ") || code.startsWith("E1") && code.length === 3) return "regional-t-tail";
  if (code.startsWith("DH8") || code.startsWith("AT7")) return "turboprop-high";
  return "narrow-twin";
}

/** Legacy classifier — maps silhouette families to coarse kinds. */
export function classifyGlyph(ac: Aircraft): GlyphKind {
  const k = resolveSilhouette(ac);
  if (k === "helicopter") return "helicopter";
  if (k === "superjumbo" || k === "hump-quad" || k === "quad-jet") return "quadjet";
  if (k === "wide-twin") return "widebody";
  if (k.startsWith("turboprop") || k === "cargo-turboprop") return "turboprop";
  if (k === "ga-single" || k === "ga-twin" || k === "bizjet") return "light";
  return "airliner";
}

type RGB = [number, number, number];
const col = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export function drawAircraftGlyph(
  ctx: CanvasRenderingContext2D,
  kind: SilhouetteKind,
  s: number,
  color: RGB,
  alpha: number,
  t: number,
  seed: number,
): void {
  withGlyphBuffer(ctx, s, alpha, (bctx) => {
    bctx.shadowColor = col(color, 0.85);
    bctx.shadowBlur = s * 0.7;

    switch (kind) {
      case "superjumbo":
        drawLowWingJet(bctx, s, color, {
          fw: 0.26, nose: -1.22, tail: 1.1, span: 1.34, sweep: 0.58,
          engines: [0.38, 0.62, 0.84],
        });
        core(bctx, s, 0.1);
        break;
      case "hump-quad":
        drawLowWingJet(bctx, s, color, {
          fw: 0.23, nose: -1.2, tail: 1.08, span: 1.22, sweep: 0.54,
          engines: [0.34, 0.55, 0.76, 0.96], hump: true,
        });
        core(bctx, s, 0.1);
        break;
      case "quad-jet":
        drawLowWingJet(bctx, s, color, {
          fw: 0.22, nose: -1.18, tail: 1.06, span: 1.18, sweep: 0.52,
          engines: [0.34, 0.55, 0.74, 0.94],
        });
        core(bctx, s, 0.1);
        break;
      case "wide-twin":
        drawLowWingJet(bctx, s, color, {
          fw: 0.22, nose: -1.14, tail: 1.04, span: 1.14, sweep: 0.5,
          engines: [0.4, 0.64], wingTip: true,
        });
        core(bctx, s, 0.1);
        break;
      case "narrow-long":
        drawLowWingJet(bctx, s, color, {
          fw: 0.18, nose: -1.18, tail: 1.08, span: 0.98, sweep: 0.46,
          engines: [0.44],
        });
        core(bctx, s, 0.09);
        break;
      case "a220":
        drawLowWingJet(bctx, s, color, {
          fw: 0.17, nose: -1.02, tail: 0.94, span: 0.96, sweep: 0.48,
          engines: [0.42], wingTip: true,
        });
        core(bctx, s, 0.09);
        break;
      case "narrow-twin":
        drawLowWingJet(bctx, s, color, {
          fw: 0.2, nose: -1.06, tail: 0.98, span: 1.02, sweep: 0.52,
          engines: [0.46],
        });
        core(bctx, s, 0.1);
        break;
      case "embraer":
        drawLowWingJet(bctx, s, color, {
          fw: 0.17, nose: -0.96, tail: 0.9, span: 0.9, sweep: 0.44,
          engines: [0.4],
        });
        core(bctx, s, 0.08);
        break;
      case "regional-t-tail":
        drawRearEngineJet(bctx, s, color, { fw: 0.14, nose: -0.88, tail: 0.86, span: 0.72, sweep: 0.32 });
        core(bctx, s, 0.07);
        break;
      case "md-rear":
        drawRearEngineJet(bctx, s, color, { fw: 0.17, nose: -1.02, tail: 0.98, span: 0.92, sweep: 0.42 });
        core(bctx, s, 0.09);
        break;
      case "turboprop-high":
        drawHighWingProps(bctx, s, color, t, seed, { span: 1.02, straight: true, twin: true });
        core(bctx, s, 0.08);
        break;
      case "turboprop-single":
        drawHighWingProps(bctx, s, color, t, seed, { span: 0.92, straight: true, twin: false });
        break;
      case "cargo-turboprop":
        drawHighWingProps(bctx, s, color, t, seed, { span: 1.12, straight: true, twin: true, quad: true });
        core(bctx, s, 0.09);
        break;
      case "bizjet":
        drawLowWingJet(bctx, s, color, {
          fw: 0.13, nose: -0.82, tail: 0.76, span: 0.68, sweep: 0.36,
          engines: [0.34],
        });
        break;
      case "ga-twin":
        drawGaLowWing(bctx, s, color, true);
        break;
      case "ga-single":
        drawGaLowWing(bctx, s, color, false);
        bctx.shadowBlur = 0;
        propDisc(bctx, 0, -0.92 * s, 0.3 * s, color, t * 11 + seed);
        break;
      case "helicopter":
        fillHeliSilhouette(bctx, s, color);
        bctx.shadowBlur = 0;
        propDisc(bctx, 0.04 * s, 1.18 * s, 0.22 * s, color, t * 16 + seed, false, 2);
        mainRotor(bctx, s, color, t * 6 + seed);
        break;
    }
  });
}

// --- drawing primitives ---

function fillSilhouette(ctx: CanvasRenderingContext2D, color: RGB): void {
  ctx.fillStyle = col(color, 1);
  ctx.fill();
}

interface LowWingJetOpts {
  fw: number;
  nose: number;
  tail: number;
  span: number;
  sweep: number;
  engines: number[];
  hump?: boolean;
  wingTip?: boolean;
}

function drawLowWingJet(
  ctx: CanvasRenderingContext2D,
  s: number,
  color: RGB,
  o: LowWingJetOpts,
): void {
  const { fw, nose, tail, span, sweep } = o;
  // Wings.
  ctx.beginPath();
  ctx.moveTo(-0.09 * s, -0.02 * s);
  ctx.lineTo(-span * s, sweep * s);
  ctx.lineTo(-(span - 0.1) * s, (sweep + 0.06) * s);
  if (o.wingTip) {
    ctx.lineTo(-(span - 0.04) * s, (sweep + 0.1) * s);
  }
  ctx.lineTo(-0.09 * s, 0.3 * s);
  ctx.lineTo(0.09 * s, 0.3 * s);
  if (o.wingTip) {
    ctx.lineTo((span - 0.04) * s, (sweep + 0.1) * s);
  }
  ctx.lineTo((span - 0.1) * s, (sweep + 0.06) * s);
  ctx.lineTo(span * s, sweep * s);
  ctx.lineTo(0.09 * s, -0.02 * s);
  ctx.closePath();
  fillSilhouette(ctx, color);

  // Fuselage.
  ctx.beginPath();
  ctx.roundRect((-fw * s) / 2, nose * s, fw * s, (tail - nose) * s, (fw * s) / 2);
  fillSilhouette(ctx, color);

  // B747 upper deck hump.
  if (o.hump) {
    ctx.beginPath();
    ctx.roundRect(-0.14 * s, nose * s, 0.28 * s, (tail - nose) * 0.38 * s, 0.08 * s);
    fillSilhouette(ctx, color);
  }

  // Tailplane.
  const ty = tail - 0.24;
  ctx.beginPath();
  ctx.moveTo(-0.08 * s, ty * s);
  ctx.lineTo(-0.44 * s, (ty + 0.23) * s);
  ctx.lineTo(-0.37 * s, (ty + 0.27) * s);
  ctx.lineTo(-0.08 * s, (ty + 0.12) * s);
  ctx.lineTo(0.08 * s, (ty + 0.12) * s);
  ctx.lineTo(0.37 * s, (ty + 0.27) * s);
  ctx.lineTo(0.44 * s, (ty + 0.23) * s);
  ctx.lineTo(0.08 * s, ty * s);
  ctx.closePath();
  fillSilhouette(ctx, color);

  // Underwing engines.
  for (const ex of o.engines) {
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sign * ex * s, 0.24 * s, 0.07 * s, 0.13 * s, 0, 0, Math.PI * 2);
      fillSilhouette(ctx, color);
    }
  }
}

interface RearJetOpts {
  fw: number;
  nose: number;
  tail: number;
  span: number;
  sweep: number;
}

/** CRJ / ERJ / MD-80 — aft fuselage engines + T-tail. */
function drawRearEngineJet(
  ctx: CanvasRenderingContext2D,
  s: number,
  color: RGB,
  o: RearJetOpts,
): void {
  const { fw, nose, tail, span, sweep } = o;
  // Low swept wings.
  ctx.beginPath();
  ctx.moveTo(-0.08 * s, 0.04 * s);
  ctx.lineTo(-span * s, (sweep + 0.04) * s);
  ctx.lineTo(-(span - 0.08) * s, (sweep + 0.1) * s);
  ctx.lineTo(-0.08 * s, 0.28 * s);
  ctx.lineTo(0.08 * s, 0.28 * s);
  ctx.lineTo((span - 0.08) * s, (sweep + 0.1) * s);
  ctx.lineTo(span * s, (sweep + 0.04) * s);
  ctx.lineTo(0.08 * s, 0.04 * s);
  ctx.closePath();
  fillSilhouette(ctx, color);

  // Fuselage.
  ctx.beginPath();
  ctx.roundRect((-fw * s) / 2, nose * s, fw * s, (tail - nose) * s, (fw * s) / 2);
  fillSilhouette(ctx, color);

  // Aft-mounted engines.
  const ey = (tail - 0.18) * s;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sign * 0.12 * s, ey, 0.06 * s, 0.11 * s, 0, 0, Math.PI * 2);
    fillSilhouette(ctx, color);
  }

  // Vertical stabilizer.
  ctx.beginPath();
  ctx.moveTo(-0.05 * s, (tail - 0.32) * s);
  ctx.lineTo(-0.05 * s, tail * s);
  ctx.lineTo(0.05 * s, tail * s);
  ctx.lineTo(0.05 * s, (tail - 0.32) * s);
  ctx.closePath();
  fillSilhouette(ctx, color);

  // T-tail horizontal stabilizer (elevated).
  const hty = (tail - 0.28) * s;
  ctx.beginPath();
  ctx.moveTo(-0.34 * s, hty);
  ctx.lineTo(-0.3 * s, (tail - 0.08) * s);
  ctx.lineTo(0.3 * s, (tail - 0.08) * s);
  ctx.lineTo(0.34 * s, hty);
  ctx.closePath();
  fillSilhouette(ctx, color);
}

interface HighWingOpts {
  span: number;
  straight: boolean;
  twin: boolean;
  quad?: boolean;
}

/** Dash 8 / ATR / C-130 — high-mounted straight wing. */
function drawHighWingProps(
  ctx: CanvasRenderingContext2D,
  s: number,
  color: RGB,
  t: number,
  seed: number,
  o: HighWingOpts,
): void {
  const wingY = -0.22 * s;
  const sweep = o.straight ? 0.06 : 0.2;
  // High wings.
  ctx.beginPath();
  ctx.moveTo(-0.08 * s, wingY);
  ctx.lineTo(-o.span * s, wingY + sweep * s);
  ctx.lineTo(-o.span * s, wingY + (sweep + 0.08) * s);
  ctx.lineTo(-0.08 * s, wingY + 0.1 * s);
  ctx.lineTo(0.08 * s, wingY + 0.1 * s);
  ctx.lineTo(o.span * s, wingY + (sweep + 0.08) * s);
  ctx.lineTo(o.span * s, wingY + sweep * s);
  ctx.lineTo(0.08 * s, wingY);
  ctx.closePath();
  fillSilhouette(ctx, color);

  // Fuselage below wing.
  ctx.beginPath();
  ctx.roundRect(-0.1 * s, -0.78 * s, 0.2 * s, 1.62 * s, 0.1 * s);
  fillSilhouette(ctx, color);

  // Tailplane.
  ctx.beginPath();
  ctx.moveTo(-0.34 * s, 0.72 * s);
  ctx.lineTo(-0.28 * s, 0.84 * s);
  ctx.lineTo(0.28 * s, 0.84 * s);
  ctx.lineTo(0.34 * s, 0.72 * s);
  ctx.closePath();
  fillSilhouette(ctx, color);

  ctx.shadowBlur = 0;
  const props = o.quad
    ? [-0.72, -0.28, 0.28, 0.72]
    : o.twin
      ? [-0.5, 0.5]
      : [0];
  const py = wingY + 0.04 * s;
  props.forEach((px, i) => {
    propDisc(ctx, px * s, py, 0.24 * s, color, t * 9 + seed + i * 1.7, true);
  });
}

function drawGaLowWing(
  ctx: CanvasRenderingContext2D,
  s: number,
  color: RGB,
  twin: boolean,
): void {
  ctx.beginPath();
  ctx.moveTo(-0.1 * s, -0.32 * s);
  ctx.lineTo(-0.92 * s, -0.14 * s);
  ctx.lineTo(-0.92 * s, 0.02 * s);
  ctx.lineTo(-0.1 * s, -0.06 * s);
  ctx.lineTo(0.1 * s, -0.06 * s);
  ctx.lineTo(0.92 * s, 0.02 * s);
  ctx.lineTo(0.92 * s, -0.14 * s);
  ctx.lineTo(0.1 * s, -0.32 * s);
  ctx.closePath();
  fillSilhouette(ctx, color);

  ctx.beginPath();
  ctx.roundRect(-0.1 * s, -0.82 * s, 0.2 * s, 1.58 * s, 0.1 * s);
  fillSilhouette(ctx, color);

  ctx.beginPath();
  ctx.moveTo(-0.36 * s, 0.58 * s);
  ctx.lineTo(-0.32 * s, 0.72 * s);
  ctx.lineTo(0.32 * s, 0.72 * s);
  ctx.lineTo(0.36 * s, 0.58 * s);
  ctx.closePath();
  fillSilhouette(ctx, color);

  if (twin) {
    ctx.shadowBlur = 0;
    propDisc(ctx, -0.38 * s, -0.04 * s, 0.18 * s, color, 0, true);
    propDisc(ctx, 0.38 * s, -0.04 * s, 0.18 * s, color, 0, true);
  }
}

function fillHeliSilhouette(
  ctx: CanvasRenderingContext2D,
  s: number,
  color: RGB,
): void {
  ctx.beginPath();
  ctx.ellipse(0, -0.15 * s, 0.34 * s, 0.55 * s, 0, 0, Math.PI * 2);
  fillSilhouette(ctx, color);

  ctx.beginPath();
  ctx.moveTo(-0.07 * s, 0.3 * s);
  ctx.lineTo(-0.05 * s, 1.12 * s);
  ctx.lineTo(0.05 * s, 1.12 * s);
  ctx.lineTo(0.07 * s, 0.3 * s);
  ctx.closePath();
  fillSilhouette(ctx, color);

  ctx.beginPath();
  ctx.moveTo(-0.05 * s, 1.0 * s);
  ctx.lineTo(-0.22 * s, 1.22 * s);
  ctx.lineTo(-0.05 * s, 1.22 * s);
  ctx.closePath();
  fillSilhouette(ctx, color);
}

function propDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: RGB,
  spin: number,
  hub = true,
  blades = 4,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin);
  ctx.fillStyle = col(color, 0.14);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col(color, 0.7);
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.lineCap = "round";
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }
  if (hub) {
    ctx.fillStyle = col([255, 255, 255], 0.7);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function mainRotor(
  ctx: CanvasRenderingContext2D,
  s: number,
  color: RGB,
  spin: number,
): void {
  const r = 1.15 * s;
  ctx.save();
  ctx.translate(0, -0.15 * s);
  ctx.rotate(spin);
  ctx.fillStyle = col(color, 0.08);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col(color, 0.55);
  ctx.lineWidth = Math.max(1.2, r * 0.06);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.stroke();
  ctx.fillStyle = col([255, 255, 255], 0.85);
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function core(ctx: CanvasRenderingContext2D, s: number, r: number): void {
  ctx.shadowBlur = 0;
  ctx.fillStyle = col([255, 255, 255], 0.75);
  ctx.beginPath();
  ctx.arc(0, 0, s * r, 0, Math.PI * 2);
  ctx.fill();
}
