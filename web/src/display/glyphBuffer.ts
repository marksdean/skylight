let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

/**
 * Draw glyph parts to an offscreen buffer, then blit once at `alpha`.
 * Prevents overlapping semi-transparent fills from stacking to darker patches.
 */
export function withGlyphBuffer(
  ctx: CanvasRenderingContext2D,
  s: number,
  alpha: number,
  draw: (bctx: CanvasRenderingContext2D) => void,
): void {
  const pad = Math.ceil(s * 2.8);
  const size = pad * 2;
  if (!scratch) {
    scratch = document.createElement("canvas");
    scratchCtx = scratch.getContext("2d")!;
  }
  if (scratch.width !== size) {
    scratch.width = size;
    scratch.height = size;
  }
  const bctx = scratchCtx!;
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, size, size);
  bctx.save();
  bctx.translate(pad, pad);
  draw(bctx);
  bctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha;
  // Copy only the size×size region we drew — not the full scratch bitmap (which
  // may be larger from a previous glyph and would shift/scale the silhouette).
  ctx.drawImage(scratch, 0, 0, size, size, -pad, -pad, size, size);
  ctx.restore();
}
