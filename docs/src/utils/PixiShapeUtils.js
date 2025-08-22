/**
 * traceDiamondPath - traces an isometric diamond path on a PIXI.Graphics-like object.
 * Does not call beginFill or endFill; callers control styling/fill lifecycle.
 * @param {object} g - PIXI.Graphics-like with moveTo/lineTo methods
 * @param {number} w - tile width
 * @param {number} h - tile height
 */
export function traceDiamondPath(g, w, h) {
    g.moveTo(0, h / 2);
    g.lineTo(w / 2, 0);
    g.lineTo(w, h / 2);
    g.lineTo(w / 2, h);
    g.lineTo(0, h / 2);
}
