/**
 * CanvasShapeUtils
 * Shared helpers for drawing common shapes on CanvasRenderingContext2D.
 */

/**
 * Trace an isometric diamond (rhombus) path centered at (cx, cy) with tile width/height.
 * Does not call beginPath/closePath; callers manage path lifecycle.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx - center x
 * @param {number} cy - center y
 * @param {number} w - tile width
 * @param {number} h - tile height
 */
export function traceDiamondFacePath2D(ctx, cx, cy, w, h) {
    ctx.moveTo(cx, cy + h / 2);
    ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy - h / 2);
    ctx.lineTo(cx - w / 2, cy);
}
