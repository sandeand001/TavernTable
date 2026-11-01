function finitePoint(point) {
  return point && ['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis]));
}

function cloneBounds(bounds) {
  return { min: { ...bounds.min }, max: { ...bounds.max } };
}

function mergeSpans(spans) {
  spans.sort((a, b) => a.bottom - b.bottom || b.top - a.top);
  const merged = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (!previous || span.bottom > previous.top) {
      merged.push({ ...span });
    } else if (span.top > previous.top) {
      previous.top = span.top;
      previous.id = span.id;
      previous.layerId = span.layerId;
    }
  }
  return merged;
}

export class TerrainGeometry {
  constructor({ widthFeet, depthFeet, getTerrainHeightFeet, terrainThicknessFeet = null }) {
    if (
      !(widthFeet > 0) ||
      !Number.isFinite(widthFeet) ||
      !(depthFeet > 0) ||
      !Number.isFinite(depthFeet) ||
      typeof getTerrainHeightFeet !== 'function'
    ) {
      throw new TypeError('Map geometry requires finite dimensions and a terrain-height query');
    }
    if (
      terrainThicknessFeet !== null &&
      (!Number.isFinite(terrainThicknessFeet) || terrainThicknessFeet <= 0)
    )
      throw new RangeError('A floor slab requires a positive finite thickness');
    this.widthFeet = widthFeet;
    this.depthFeet = depthFeet;
    this.terrainThicknessFeet = terrainThicknessFeet;
    this._getTerrainHeightFeet = getTerrainHeightFeet;
    this._operations = new Map();
  }

  addSolid(solid) {
    this._addOperation(solid, 'add');
  }

  carve(volume) {
    this._addOperation(volume, 'subtract');
  }

  _addOperation({ id, layerId = 'ground', bounds }, operation) {
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      id === 'terrain' ||
      typeof layerId !== 'string' ||
      !layerId.trim()
    ) {
      throw new TypeError('Map solids require a unique ID and a level layer');
    }
    if (this._operations.has(id)) throw new Error(`Map volume "${id}" already exists`);
    if (
      !finitePoint(bounds?.min) ||
      !finitePoint(bounds?.max) ||
      ['x', 'y', 'z'].some((axis) => bounds.min[axis] >= bounds.max[axis]) ||
      bounds.min.x < 0 ||
      bounds.min.z < 0 ||
      bounds.max.x > this.widthFeet ||
      bounds.max.z > this.depthFeet
    ) {
      throw new RangeError('Map solid bounds must be finite, ordered and inside the board');
    }
    this._operations.set(id, { id, layerId, bounds: cloneBounds(bounds), operation });
  }

  getSolidSpansAt(x, z) {
    this._validatePosition(x, z);
    const terrainHeight = this._getTerrainHeightFeet(x, z);
    if (!Number.isFinite(terrainHeight)) throw new Error('The terrain support height is invalid');
    let spans = [
      {
        bottom:
          this.terrainThicknessFeet === null
            ? -Infinity
            : terrainHeight - this.terrainThicknessFeet,
        top: terrainHeight,
        id: 'terrain',
        layerId: 'ground',
      },
    ];
    for (const volume of this._operations.values()) {
      const { min, max } = volume.bounds;
      if (x >= min.x && x < max.x && z >= min.z && z < max.z) {
        if (volume.operation === 'add') {
          spans = mergeSpans([
            ...spans,
            { bottom: min.y, top: max.y, id: volume.id, layerId: volume.layerId },
          ]);
        } else {
          spans = spans.flatMap((span) => {
            if (max.y <= span.bottom || min.y >= span.top) return [span];
            const result = [];
            if (min.y > span.bottom)
              result.push({
                ...span,
                top: min.y,
                id: `${volume.id}:floor`,
                layerId: volume.layerId,
              });
            if (max.y < span.top) result.push({ ...span, bottom: max.y });
            return result;
          });
        }
      }
    }
    return spans;
  }

  getSurfacesAt(x, z) {
    const spans = this.getSolidSpansAt(x, z);
    return spans.map((span, index) => ({
      id: span.id,
      heightFeet: span.top,
      ceilingFeet: spans[index + 1]?.bottom ?? null,
      layerId: span.layerId,
    }));
  }

  findSupport(x, z, { belowFeet = Infinity, clearanceFeet = 0, surfaceId = null } = {}) {
    if (
      (!Number.isFinite(belowFeet) && belowFeet !== Infinity) ||
      !Number.isFinite(clearanceFeet) ||
      clearanceFeet < 0 ||
      (surfaceId !== null && typeof surfaceId !== 'string')
    ) {
      throw new RangeError('Support requires a valid elevation, clearance and optional surface ID');
    }
    return (
      this.getSurfacesAt(x, z)
        .reverse()
        .find(
          (surface) =>
            surface.heightFeet <= belowFeet + 1e-7 &&
            (surfaceId === null || surface.id === surfaceId) &&
            (surface.ceilingFeet === null ||
              surface.ceilingFeet - surface.heightFeet >= clearanceFeet - 1e-7)
        ) ?? null
    );
  }

  isSpaceClear(bounds) {
    if (
      !finitePoint(bounds?.min) ||
      !finitePoint(bounds?.max) ||
      ['x', 'y', 'z'].some((axis) => bounds.min[axis] >= bounds.max[axis])
    ) {
      throw new RangeError('Clearance requires finite, ordered volume bounds');
    }
    if (
      bounds.min.x < 0 ||
      bounds.min.z < 0 ||
      bounds.max.x > this.widthFeet ||
      bounds.max.z > this.depthFeet
    )
      return false;
    const axes = this.getPartition();
    const samples = (cuts, min, max) => {
      const sorted = [min, ...cuts.filter((cut) => cut > min && cut < max), max];
      return sorted.slice(1).map((value, index) => (sorted[index] + value) / 2);
    };
    for (const x of samples(axes.x, bounds.min.x, bounds.max.x)) {
      for (const z of samples(axes.z, bounds.min.z, bounds.max.z)) {
        if (
          this.getSolidSpansAt(x, z).some(
            (span) => span.top > bounds.min.y + 1e-7 && span.bottom < bounds.max.y - 1e-7
          )
        )
          return false;
      }
    }
    return true;
  }

  getPartition() {
    const cuts = (extent) => {
      const values = new Set([0, extent]);
      for (let value = 5; value < extent; value += 5) values.add(value);
      return values;
    };
    const x = cuts(this.widthFeet);
    const z = cuts(this.depthFeet);
    for (const { bounds } of this._operations.values()) {
      x.add(bounds.min.x);
      x.add(bounds.max.x);
      z.add(bounds.min.z);
      z.add(bounds.max.z);
    }
    return { x: [...x].sort((a, b) => a - b), z: [...z].sort((a, b) => a - b) };
  }

  get hasVolumes() {
    return this._operations.size > 0;
  }

  save() {
    return {
      version: 1,
      volumes: [...this._operations.values()].map((volume) => ({
        ...volume,
        bounds: cloneBounds(volume.bounds),
      })),
    };
  }

  load(snapshot) {
    if (
      snapshot?.version !== 1 ||
      !Array.isArray(snapshot.volumes) ||
      snapshot.volumes.length > 2000
    ) {
      throw new Error('Unsupported or invalid map-geometry snapshot');
    }
    const restored = new TerrainGeometry({
      widthFeet: this.widthFeet,
      depthFeet: this.depthFeet,
      getTerrainHeightFeet: this._getTerrainHeightFeet,
      terrainThicknessFeet: this.terrainThicknessFeet,
    });
    for (const volume of snapshot.volumes) {
      if (!volume || !['add', 'subtract'].includes(volume.operation)) {
        throw new Error('Saved map volumes require an Add or Subtract operation');
      }
      restored._addOperation(volume, volume.operation);
    }
    this._operations = restored._operations;
  }

  _validatePosition(x, z) {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      x < 0 ||
      z < 0 ||
      x >= this.widthFeet ||
      z >= this.depthFeet
    ) {
      throw new RangeError('The geometry query is outside the board');
    }
  }
}
