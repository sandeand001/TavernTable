// TerrainMeshBuilder.js - Phase 2 scaffold
// Responsible for constructing a heightfield mesh (initially flat) from grid elevation data.
// Future: will incorporate smoothing, normals, materials, biome-driven vertex color.

export class TerrainMeshBuilder {
  constructor(opts = {}) {
    this.tileWorldSize = opts.tileWorldSize || 1.0; // world units per tile (X/Z)
    this.elevationUnit = opts.elevationUnit || 0.5; // world Y per elevation level
    // When true, attempts to sample biome palette for vertex coloring.
    this.enableBiomeVertexColors = opts.enableBiomeVertexColors !== false; // default on
    // Hard edges mode: duplicate vertices per tile so each tile is a flat-colored quad (no interpolation)
    this.hardEdges = !!opts.hardEdges;
    // Force the advanced per-tile + wall geometry path even if legacy path available.
    this.forceAdvanced = !!opts.forceAdvanced;
  }

  build({ cols, rows, getHeight, three, getBiomeColor, getWallColor }) {
    if (!three) throw new Error('Three namespace required');
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
      throw new Error('cols/rows must be integers');
    }
    // Legacy shared-vertex plane path (used by older tests expecting (cols+1)*(rows+1) vertices).
    const canLegacy =
      !this.forceAdvanced &&
      !this.hardEdges &&
      typeof getWallColor !== 'function' &&
      three.PlaneGeometry;
    if (canLegacy) {
      const ts = this.tileWorldSize;
      const plane = new three.PlaneGeometry(cols * ts, rows * ts, cols, rows);
      if (plane.rotateX) plane.rotateX(-Math.PI / 2); // make Y up
      const pos = plane.attributes.position;
      const vertsPerRow = cols + 1;
      const getElev = (x, y) => (typeof getHeight === 'function' ? getHeight(x, y) : 0);
      for (let zi = 0; zi <= rows; zi++) {
        for (let xi = 0; xi <= cols; xi++) {
          const sampleX = xi < cols ? xi : cols - 1;
          const sampleZ = zi < rows ? zi : rows - 1;
          const h = getElev(sampleX, sampleZ) * this.elevationUnit;
          const idx = zi * vertsPerRow + xi;
          if (typeof pos.setY === 'function') pos.setY(idx, h);
          else if (pos.array) pos.array[idx * 3 + 1] = h;
        }
      }
      if (pos.needsUpdate !== undefined) pos.needsUpdate = true;
      return plane;
    }

    // Revised: still build per-tile hard-edge top quads, but now also generate vertical "wall" faces
    // wherever a neighboring tile is lower (or missing / out of bounds). This removes the floating
    // sheet look by visually connecting height steps and perimeter edges down to the neighbor level.
    // Data is accumulated in dynamic JS arrays for clarity, then packed into typed arrays at the end.

    const wantsColors =
      this.enableBiomeVertexColors && typeof getBiomeColor === 'function' && three?.Color;
    const hasWallColor = typeof getWallColor === 'function';
    const positions = [];
    const colors = wantsColors ? [] : null;
    const indices = [];
    const ts = this.tileWorldSize;
    const getElev = (x, y) => (typeof getHeight === 'function' ? getHeight(x, y) : 0);
    // Pre-cache heights for neighbor lookups.
    const heightGrid = new Array(rows);
    for (let gy = 0; gy < rows; gy++) {
      const row = new Array(cols);
      for (let gx = 0; gx < cols; gx++) row[gx] = getElev(gx, gy);
      heightGrid[gy] = row;
    }

    const pushColor4 = (r, g, b) => {
      if (!colors) return;
      // push same color for 4 vertices
      colors.push(r, g, b, r, g, b, r, g, b, r, g, b);
    };
    const pushFaceColor4 = (r, g, b) => {
      if (!colors) return;
      colors.push(r, g, b, r, g, b, r, g, b, r, g, b);
    };

    let vertCount = 0;
    const addQuad = (v0, v1, v2, v3) => {
      // v*: [x,y,z]
      positions.push(
        v0[0],
        v0[1],
        v0[2],
        v1[0],
        v1[1],
        v1[2],
        v2[0],
        v2[1],
        v2[2],
        v3[0],
        v3[1],
        v3[2]
      );
      indices.push(
        vertCount + 0,
        vertCount + 1,
        vertCount + 2,
        vertCount + 0,
        vertCount + 2,
        vertCount + 3
      );
      vertCount += 4;
    };

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const baseX = gx * ts;
        const baseZ = gy * ts;
        const elev = heightGrid[gy][gx];
        const topY = elev * this.elevationUnit;
        // Color for tile top
        const hex = wantsColors ? getBiomeColor(gx, gy, elev) || 0x777766 : 0;
        let r = ((hex >> 16) & 0xff) / 255;
        let g = ((hex >> 8) & 0xff) / 255;
        let b = (hex & 0xff) / 255;
        if (wantsColors) {
          try {
            const linearize =
              (typeof window !== 'undefined' && window.__TT_LINEARIZE_VERTEX_COLORS__) || false;
            if (linearize && three?.Color) {
              const c = new three.Color(r, g, b);
              if (c.convertSRGBToLinear) c.convertSRGBToLinear();
              r = c.r;
              g = c.g;
              b = c.b;
            }
          } catch (_) {
            /* ignore */
          }
        }
        // TOP QUAD (order: BL, BR, TR, TL)
        addQuad(
          [baseX, topY, baseZ],
          [baseX + ts, topY, baseZ],
          [baseX + ts, topY, baseZ + ts],
          [baseX, topY, baseZ + ts]
        );
        pushColor4(r, g, b);

        // Helper to add a vertical wall if neighbor lower (or OOB -> treat neighbor elev = 0)
        const neighborOr0 = (nx, ny) => {
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return 0;
          return heightGrid[ny][nx];
        };
        // Precompute wall color (could be same as top if no override)
        let wr = r,
          wg = g,
          wb = b;
        if (hasWallColor) {
          const wHex = getWallColor(gx, gy, elev, hex);
          if (Number.isFinite(wHex)) {
            wr = ((wHex >> 16) & 0xff) / 255;
            wg = ((wHex >> 8) & 0xff) / 255;
            wb = (wHex & 0xff) / 255;
          }
        }
        // West edge (gx-1)
        const wH = neighborOr0(gx - 1, gy) * this.elevationUnit;
        if (wH < topY) {
          addQuad(
            [baseX, wH, baseZ + ts],
            [baseX, wH, baseZ],
            [baseX, topY, baseZ],
            [baseX, topY, baseZ + ts]
          );
          pushFaceColor4(wr, wg, wb);
        }
        // East edge (gx+1)
        const eH = neighborOr0(gx + 1, gy) * this.elevationUnit;
        if (eH < topY) {
          addQuad(
            [baseX + ts, eH, baseZ],
            [baseX + ts, eH, baseZ + ts],
            [baseX + ts, topY, baseZ + ts],
            [baseX + ts, topY, baseZ]
          );
          pushFaceColor4(wr, wg, wb);
        }
        // North edge (gy-1)
        const nH = neighborOr0(gx, gy - 1) * this.elevationUnit;
        if (nH < topY) {
          addQuad(
            [baseX + ts, nH, baseZ],
            [baseX, nH, baseZ],
            [baseX, topY, baseZ],
            [baseX + ts, topY, baseZ]
          );
          pushFaceColor4(wr, wg, wb);
        }
        // South edge (gy+1)
        const sH = neighborOr0(gx, gy + 1) * this.elevationUnit;
        if (sH < topY) {
          addQuad(
            [baseX, sH, baseZ + ts],
            [baseX + ts, sH, baseZ + ts],
            [baseX + ts, topY, baseZ + ts],
            [baseX, topY, baseZ + ts]
          );
          pushFaceColor4(wr, wg, wb);
        }
      }
    }

    const geo = new three.BufferGeometry();
    geo.setAttribute('position', new three.BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(new three.BufferAttribute(new Uint32Array(indices), 1));
    if (colors) geo.setAttribute('color', new three.BufferAttribute(new Float32Array(colors), 3));
    // Still unlit flat colors -> normals omitted.
    return geo;
  }
}
