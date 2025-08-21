// src/terrain/biome-painter/fields.js
// Pure helpers to compute terrain derivative fields used by the painter.

/**
 * Compute per-tile slope magnitude and aspect (downhill direction angle in radians)
 * using simple central differences. Aspect is atan2(dzdy, dzdx).
 * @param {{cols:number, rows:number}} gameManager - Provides grid dimensions
 * @param {number[][]} heights - Grid of heights
 * @returns {{slope:number[][], aspect:number[][]}}
 */
export function computeSlopeAspect(gameManager, heights) {
  const cols = gameManager.cols;
  const rows = gameManager.rows;
  const slope = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const aspect = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const hC = Number.isFinite(heights?.[y]?.[x]) ? heights[y][x] : 0;
      const hL = Number.isFinite(heights?.[y]?.[x - 1]) ? heights[y][x - 1] : hC;
      const hR = Number.isFinite(heights?.[y]?.[x + 1]) ? heights[y][x + 1] : hC;
      const hU = Number.isFinite(heights?.[y - 1]?.[x]) ? heights[y - 1][x] : hC;
      const hD = Number.isFinite(heights?.[y + 1]?.[x]) ? heights[y + 1][x] : hC;
      const dzdx = (hR - hL) * 0.5;
      const dzdy = (hD - hU) * 0.5;
      const s = Math.hypot(dzdx, dzdy);
      const a = Math.atan2(dzdy, dzdx);
      slope[y][x] = s;
      aspect[y][x] = a;
    }
  }
  return { slope, aspect };
}

/**
 * Compute multi-source BFS distance (in tiles) to nearest source cell matching predicate.
 * @param {{cols:number, rows:number}} gameManager
 * @param {number[][]} heights
 * @param {(x:number,y:number)=>boolean} isSourceFn
 * @returns {number[][]}
 */
export function computeDistanceField(gameManager, heights, isSourceFn) {
  const cols = gameManager.cols;
  const rows = gameManager.rows;
  const dist = Array.from({ length: rows }, () => new Array(cols).fill(Infinity));
  const q = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isSourceFn(x, y)) { dist[y][x] = 0; q.push([x, y]); }
    }
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < q.length; i++) {
    const [cx, cy] = q[i];
    const cd = dist[cy][cx];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nd = cd + 1;
      if (nd < dist[ny][nx]) { dist[ny][nx] = nd; q.push([nx, ny]); }
    }
  }
  return dist;
}

/**
 * Moisture field 0..1, decaying with distance from negative-height (depressions) as proxy for water.
 * @param {{cols:number, rows:number}} gameManager
 * @param {number[][]} heights
 * @returns {number[][]}
 */
export function computeMoistureField(gameManager, heights) {
  const rows = gameManager.rows;
  const cols = gameManager.cols;
  const dist = computeDistanceField(gameManager, heights, (x, y) => (Number.isFinite(heights?.[y]?.[x]) ? heights[y][x] : 0) < 0);
  const moisture = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const lambda = 0.35; // decay per tile
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const d = dist[y][x];
      if (!isFinite(d)) { moisture[y][x] = 0; continue; }
      const m = Math.exp(-lambda * d);
      moisture[y][x] = Math.max(0, Math.min(1, m));
    }
  }
  return moisture;
}
