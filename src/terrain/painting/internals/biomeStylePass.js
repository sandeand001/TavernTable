import { getBiomeColorHex } from '../../../config/biome/BiomePalettes.js';

export function applyBiomeStylePass(painter, params) {
  const {
    style,
    ctx,
    canvas,
    biomeKey,
    d,
    heights,
    slope,
    aspect,
    moisture,
    rows,
    cols,
    w,
    h,
    perf,
    densityMul,
    seed,
    mapFreq,
    shorelineSandStrength,
  } = params;
  const longCount = Math.floor(12 * perf * densityMul);
  const bandOrient = painter._bandOrientationForDepth(
    d,
    heights,
    slope,
    aspect,
    null,
    painter._slopeGainForStroke
  );
  const avgSlope = painter._bandAverage(slope, d);
  if (style === 'plains') {
    const col = getBiomeColorHex(biomeKey, 0, 0, 0, {
      moisture: painter._bandAverage(moisture, d),
      slope: avgSlope,
      aspectRad: bandOrient,
      seed,
      mapFreq,
    });
    const avgMoist = painter._bandAverage(moisture, d);
    const density = (rows + cols) * (0.6 + avgMoist * 0.6) * perf;
    painter._scatterTuftsGlobal(
      ctx,
      canvas,
      Math.floor(density),
      Math.min(w, h) * 0.35,
      painter._shadeHex(col, 0.75),
      0.18,
      0.12
    );
  } else if (style === 'arid') {
    const col = getBiomeColorHex(biomeKey, 2, 0, 0, {
      moisture: painter._bandAverage(moisture, d),
      slope: avgSlope,
      aspectRad: bandOrient,
      seed,
      mapFreq,
    });
    if (/salt|flat/i.test(String(biomeKey))) {
      painter._globalCracks(ctx, canvas, col, 0.22, 8 + Math.floor(4 * densityMul));
    } else {
      painter._ribbonAlongFlow = false;
      painter._globalRibbons(
        ctx,
        canvas,
        longCount,
        Math.max(2, h * 0.18),
        col,
        0.1,
        bandOrient + Math.PI
      );
      if (/savanna|steppe|prairie|grass/i.test(String(biomeKey))) {
        painter._scatterTuftsGlobal(
          ctx,
          canvas,
          Math.floor((rows + cols) * 0.4 * perf),
          Math.min(w, h) * 0.3,
          painter._shadeHex(col, 0.7),
          0.16,
          0.15
        );
      }
    }
  } else if (style === 'forest') {
    const col = getBiomeColorHex(biomeKey, 0, 0, 0, {
      moisture: painter._bandAverage(moisture, d),
      slope: avgSlope,
      aspectRad: bandOrient,
      seed,
      mapFreq,
    });
    const avgMoist = painter._bandAverage(moisture, d);
    const count = (rows + cols) * (0.7 + avgMoist * 0.8) * perf;
    painter._scatterBlobsGlobal(
      ctx,
      canvas,
      Math.floor(count),
      Math.min(w, h) * 0.26,
      0.7,
      painter._shadeHex(col, 0.85),
      0.16,
      0.08,
      18
    );
  } else if (style === 'wetland') {
    ctx.save();
    painter._applyFaceClip(
      ctx,
      painter.bounds,
      heights,
      (gx, gy) => gx + gy === d && (heights[gy][gx] || 0) < 0
    );
    const wetOrient = painter._bandOrientationForDepth(
      d,
      heights,
      slope,
      aspect,
      (x, y) => (heights[y][x] || 0) < 0,
      painter._slopeGainForStroke
    );
    const negMoist = painter._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) < 0);
    const negSlope = painter._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) < 0);
    const waterCol = getBiomeColorHex(biomeKey, -2, 0, 0, {
      moisture: negMoist,
      slope: negSlope,
      aspectRad: wetOrient,
      seed,
      mapFreq,
    });
    painter._ribbonAlongFlow = true;
    painter._globalRibbons(
      ctx,
      canvas,
      longCount + 4,
      Math.max(2, h * 0.16),
      waterCol,
      0.1,
      wetOrient + Math.PI
    );
    ctx.restore();
    ctx.save();
    painter._applyFaceClip(
      ctx,
      painter.bounds,
      heights,
      (gx, gy) => gx + gy === d && (heights[gy][gx] || 0) >= 0
    );
    const reedCol = getBiomeColorHex(biomeKey, 0, 0, 0, {
      moisture: painter._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) >= 0),
      slope: painter._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) >= 0),
      aspectRad: bandOrient,
      seed,
      mapFreq,
    });
    const bandMoist = painter._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) >= 0);
    const reedCount = (rows + cols) * (0.6 + bandMoist * 0.8) * perf;
    painter._scatterTuftsGlobal(
      ctx,
      canvas,
      Math.floor(reedCount),
      Math.min(w, h) * 0.32,
      painter._shadeHex(reedCol, 0.6),
      0.18,
      0.08
    );
    ctx.restore();
  } else if (style === 'alpine') {
    const midCol = getBiomeColorHex(biomeKey, 0, 0, 0, {
      moisture: painter._bandAverage(moisture, d),
      slope: avgSlope,
      aspectRad: bandOrient,
      seed,
      mapFreq,
    });
    painter._globalStriations(
      ctx,
      canvas,
      midCol,
      0.14,
      bandOrient + Math.PI / 2,
      Math.max(28, Math.floor(h * 0.7))
    );
    ctx.save();
    painter._applyFaceClip(
      ctx,
      painter.bounds,
      heights,
      (gx, gy) => gx + gy === d && (heights[gy][gx] || 0) > 1
    );
    painter._globalStriations(
      ctx,
      canvas,
      0xffffff,
      0.1,
      bandOrient - Math.PI / 3,
      Math.max(36, Math.floor(h * 0.8))
    );
    ctx.restore();
  } else if (style === 'water') {
    const waterCol = getBiomeColorHex(biomeKey, -2, 0, 0, {
      moisture: painter._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) < 0),
      slope: painter._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) < 0),
      aspectRad: bandOrient,
      seed,
      mapFreq,
    });
    ctx.save();
    painter._applyFaceClip(
      ctx,
      painter.bounds,
      heights,
      (gx, gy) => gx + gy === d && (heights[gy][gx] || 0) < 0
    );
    painter._ribbonAlongFlow = true;
    painter._globalRibbons(
      ctx,
      canvas,
      longCount + 6,
      Math.max(2, h * 0.16),
      waterCol,
      0.1,
      bandOrient + Math.PI
    );
    ctx.restore();

    if (/coast|beach|shore/i.test(String(biomeKey))) {
      const sandCol = getBiomeColorHex('beach', 2, 0, 0, {
        moisture: painter._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) >= 0),
        slope: painter._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) >= 0),
        aspectRad: bandOrient,
        seed,
        mapFreq,
      });
      ctx.save();
      painter._applyFaceClip(
        ctx,
        painter.bounds,
        heights,
        (gx, gy) => gx + gy === d && (heights[gy][gx] || 0) >= 0
      );
      const landCount = Math.floor((rows + cols) * 0.35 * perf * shorelineSandStrength);
      const landAlpha = 0.1 * Math.min(1.5, Math.max(0.4, shorelineSandStrength));
      painter._scatterBlobsGlobal(
        ctx,
        canvas,
        landCount,
        Math.min(w, h) * 0.18,
        0.5,
        sandCol,
        landAlpha,
        0.04,
        14
      );
      ctx.restore();

      const wetSandCol = getBiomeColorHex('beach', 0, 0, 0, {
        moisture: painter._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) < 0),
        slope: painter._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) < 0),
        aspectRad: bandOrient,
        seed,
        mapFreq,
      });
      ctx.save();
      painter._applyFaceClip(
        ctx,
        painter.bounds,
        heights,
        (gx, gy) => gx + gy === d && (heights[gy][gx] || 0) < 0 && (heights[gy][gx] || 0) > -2
      );
      const waterCount = Math.floor((rows + cols) * 0.15 * perf * shorelineSandStrength);
      const waterAlpha = 0.06 * Math.min(1.5, Math.max(0.4, shorelineSandStrength));
      painter._scatterBlobsGlobal(
        ctx,
        canvas,
        waterCount,
        Math.min(w, h) * 0.14,
        0.4,
        wetSandCol,
        waterAlpha,
        0.03,
        12
      );
      ctx.restore();
    }
  } else if (style === 'volcanic') {
    const col = getBiomeColorHex(biomeKey, -1, 0, 0, {
      moisture: painter._bandAverage(moisture, d),
      slope: avgSlope,
      aspectRad: bandOrient,
      seed,
      mapFreq,
    });
    painter._globalCracks(ctx, canvas, col, 0.24, 10 + Math.floor(4 * densityMul));
  } else if (style === 'arcane') {
    const col = getBiomeColorHex(biomeKey, 0, 0, 0, {
      moisture: painter._bandAverage(moisture, d),
      slope: avgSlope,
      aspectRad: bandOrient,
      seed,
      mapFreq,
    });
    painter._globalRibbons(
      ctx,
      canvas,
      Math.floor(longCount * 0.7),
      Math.max(2, h * 0.14),
      col,
      0.1,
      0.2
    );
  } else {
    const col = getBiomeColorHex(biomeKey, 0, 0, 0, {
      moisture: painter._bandAverage(moisture, d),
      slope: avgSlope,
      aspectRad: bandOrient,
      seed,
      mapFreq,
    });
    painter._scatterBlobsGlobal(
      ctx,
      canvas,
      Math.floor((rows + cols) * 0.3 * perf),
      Math.min(w, h) * 0.2,
      0.5,
      col,
      0.1,
      0.05,
      14
    );
  }
}
