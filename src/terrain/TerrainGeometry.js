import { normalizeVolumeShape, volumeCell, volumeIntervalAt } from './TerrainVolumeShape.js';
import { createStructure } from './ConstructionBlueprints.js';
import { wallStairLayout } from './WallStairs.js';
import { CONSTRUCTION_MATERIALS } from '../config/biome/ConstructionPalettes.js';
import { FootprintIndex } from './FootprintIndex.js';
import {
  createBoxCell,
  subtractCell,
  boundsOverlap,
  boundsIntersectSolid,
  clipCellToBounds,
  sweptBodyCell,
  cellIntersectsSolid,
} from './ConvexGeometry.js';

function finitePoint(point) {
  return point && ['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis]));
}

function cloneBounds(bounds) {
  return { min: { ...bounds.min }, max: { ...bounds.max } };
}

function terrainCuts(extent) {
  const values = new Set([0, extent]);
  for (let value = 5; value < extent; value += 5) values.add(value);
  return values;
}

function freezeCells(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value) || Object.isFrozen(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) freezeCells(child, seen);
  Object.freeze(value);
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
      if (span.structureId) {
        previous.structureId = span.structureId;
      } else {
        delete previous.structureId;
      }
      for (const key of ['materialRole', 'materialColor', 'materialStyle', 'source'])
        if (span[key] !== undefined) previous[key] = span[key];
        else delete previous[key];
    } else if (span.top === previous.top && span.materialColor !== undefined) {
      for (const key of ['materialRole', 'materialColor', 'materialStyle', 'source'])
        if (span[key] !== undefined) previous[key] = span[key];
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
    this._terrainThicknessFeet = terrainThicknessFeet;
    this._getTerrainHeightFeet = getTerrainHeightFeet;
    this._operations = new Map();
    this._structures = new Map();
    this._cells = new Map();
    this._solidCells = null;
    this._volumeIndex = null;
    this._solidCellIndex = null;
  }

  addSolid(solid) {
    this._addOperation(solid, 'add');
  }

  carve(volume) {
    this._addOperation(volume, 'subtract');
  }

  _addOperation(
    {
      id,
      layerId = 'ground',
      bounds,
      shape,
      structureId,
      materialRole,
      materialColor,
      materialStyle,
      source,
    },
    operation
  ) {
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
    const normalized = normalizeVolumeShape(shape, bounds);
    if (
      structureId !== undefined &&
      (!this._structures.has(structureId) || materialRole === undefined)
    )
      throw new Error('A constructed volume must reference a saved structure and material role');
    if (
      (materialRole !== undefined &&
        !['masonry', 'roof', 'rock', 'trim', 'accent', 'paving', 'timber', 'grass'].includes(
          materialRole
        )) ||
      (materialColor !== undefined &&
        (!Number.isInteger(materialColor) || materialColor < 0 || materialColor > 0xffffff)) ||
      (materialStyle !== undefined && !Object.hasOwn(CONSTRUCTION_MATERIALS, materialStyle)) ||
      (source !== undefined && !['manual', 'generated'].includes(source))
    )
      throw new Error('Map volume appearance or ownership metadata is invalid');
    const volume = {
      id,
      layerId,
      bounds: cloneBounds(bounds),
      operation,
      ...(normalized ? { shape: normalized } : {}),
      ...(structureId ? { structureId } : {}),
      ...(materialRole !== undefined ? { materialRole } : {}),
      ...(materialColor !== undefined ? { materialColor } : {}),
      ...(materialStyle !== undefined ? { materialStyle } : {}),
      ...(source !== undefined ? { source } : {}),
    };
    const cell = volumeCell(volume);
    this._operations.set(id, volume);
    this._cells.set(id, cell);
    this.invalidate();
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
    this._volumeIndex ??= new FootprintIndex(this._operations.values());
    const volumes = this._volumeIndex.atPoint(x, z);
    for (const volume of volumes) {
      const interval = volumeIntervalAt(volume, this._cells.get(volume.id), x, z);
      if (interval) {
        const { bottom, top } = interval;
        if (volume.operation === 'add') {
          spans = mergeSpans([
            ...spans,
            {
              bottom,
              top,
              id: volume.id,
              layerId: volume.layerId,
              ...(volume.structureId ? { structureId: volume.structureId } : {}),
              ...(volume.materialRole !== undefined ? { materialRole: volume.materialRole } : {}),
              ...(volume.materialColor !== undefined
                ? { materialColor: volume.materialColor }
                : {}),
              ...(volume.materialStyle !== undefined
                ? { materialStyle: volume.materialStyle }
                : {}),
              ...(volume.source !== undefined ? { source: volume.source } : {}),
            },
          ]);
        } else {
          spans = spans.flatMap((span) => {
            if (top <= span.bottom || bottom >= span.top) return [span];
            const result = [];
            if (bottom > span.bottom)
              result.push({
                ...span,
                top: bottom,
                id: `${volume.id}:floor`,
                layerId: volume.layerId,
              });
            if (top < span.top) result.push({ ...span, bottom: top });
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
    if (this.hasCurves) {
      const floorFeet = Math.min(-1000000, bounds.min.y - 5);
      return !this._solidCellsInBounds(bounds, floorFeet).some(
        (cell) =>
          boundsOverlap(bounds, cell.bounds) &&
          boundsIntersectSolid(bounds, { ...cell.bounds, planes: cell.planes })
      );
    }
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

  isSweptSpaceClear(start, end, radius, bottom, top) {
    if (
      !finitePoint(start) ||
      !finitePoint(end) ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      !Number.isFinite(bottom) ||
      !Number.isFinite(top) ||
      top <= bottom
    )
      throw new RangeError('Swept clearance requires finite endpoints and valid body dimensions');
    const body = sweptBodyCell(start, end, radius, bottom + 1e-6, top - 1e-6);
    if (
      !body ||
      body.bounds.min.x < 0 ||
      body.bounds.min.z < 0 ||
      body.bounds.max.x > this.widthFeet ||
      body.bounds.max.z > this.depthFeet
    )
      return false;
    return !this._solidCellsInBounds(body.bounds, Math.min(-1000000, bottom - 5)).some(
      (cell) =>
        boundsOverlap(body.bounds, cell.bounds) &&
        cellIntersectsSolid(body, { ...cell.bounds, planes: cell.planes })
    );
  }

  isCurvedSupport(surfaceId) {
    let volume = this._operations.get(surfaceId);
    const carved = !volume && typeof surfaceId === 'string' && surfaceId.endsWith(':floor');
    if (carved) volume = this._operations.get(surfaceId.slice(0, -6));
    if (!volume?.shape) return false;
    if (volume.shape.kind === 'prism') return false;
    if (volume.shape.kind === 'polyhedron') return !carved;
    if (volume.shape.kind === 'cylinder' && volume.shape.axis === 'y') return false;
    return !carved || volume.bounds.min.y < volume.shape.center.y - 1e-7;
  }

  isGroundSpaceClear(bounds, belowFeet) {
    if (!Number.isFinite(belowFeet))
      throw new RangeError('Ground clearance requires a finite support limit');
    if (this.isSpaceClear(bounds)) return true;
    let floor = bounds.min.y;
    const footprint = {
      min: { ...bounds.min, y: -Infinity },
      max: { ...bounds.max, y: Infinity },
    };
    for (const cell of this._solidCellsInBounds(footprint)) {
      if (
        cell.bounds.max.y <= floor ||
        cell.bounds.min.y > belowFeet ||
        !boundsOverlap(cell.bounds, footprint)
      )
        continue;
      const clipped = clipCellToBounds(cell, footprint);
      if (clipped && clipped.bounds.max.y <= belowFeet + 1e-7)
        floor = Math.max(floor, clipped.bounds.max.y);
    }
    // Clear the supporting slope without lowering the required headroom.
    return this.isSpaceClear({
      min: { ...bounds.min, y: floor },
      max: { ...bounds.max, y: bounds.max.y + floor - bounds.min.y },
    });
  }

  getPartition() {
    const x = terrainCuts(this.widthFeet);
    const z = terrainCuts(this.depthFeet);
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

  get hasCurves() {
    return [...this._operations.values()].some((volume) => volume.shape);
  }

  getStructures() {
    return JSON.parse(JSON.stringify([...this._structures.values()]));
  }

  structureAt(point) {
    if (!finitePoint(point)) throw new TypeError('Structure selection requires a physical point');
    const inset = 0.02;
    for (const volume of [...this._operations.values()].reverse()) {
      if (!volume.structureId || volume.operation !== 'add') continue;
      const { min, max } = volume.bounds;
      if (
        point.x < min.x - inset ||
        point.x > max.x + inset ||
        point.y < min.y - inset ||
        point.y > max.y + inset ||
        point.z < min.z - inset ||
        point.z > max.z + inset
      )
        continue;
      const cell = this._cells.get(volume.id);
      if (
        cell?.planes.every(
          ({ normal, distance }) =>
            normal.x * point.x + normal.y * point.y + normal.z * point.z <= distance + inset
        )
      )
        return JSON.parse(JSON.stringify(this._structures.get(volume.structureId)));
    }
    return null;
  }

  get terrainThicknessFeet() {
    return this._terrainThicknessFeet;
  }

  set terrainThicknessFeet(value) {
    if (value !== null && (!Number.isFinite(value) || value <= 0))
      throw new RangeError('A floor slab requires a positive finite thickness');
    if (this._terrainThicknessFeet === value) return;
    this._terrainThicknessFeet = value;
    this.invalidate();
  }

  invalidate() {
    this._solidCells = null;
    this._navigationPoints = null;
    this._volumeIndex = null;
    this._solidCellIndex = null;
  }

  _solidCellsInBounds(bounds, floorFeet = -1000000) {
    const cells = this.getSolidCells({ floorFeet });
    if (floorFeet !== -1000000) return cells;
    this._solidCellIndex ??= new FootprintIndex(cells);
    return this._solidCellIndex.inBounds(bounds);
  }

  getNavigationPoints() {
    if (!this._navigationPoints) {
      const points = [];
      for (const spec of this._structures.values()) {
        if (spec.kind !== 'wall' || !spec.wallStairs) continue;
        const layout = wallStairLayout(spec);
        const c = Math.cos(spec.angleRadians),
          s = Math.sin(spec.angleRadians);
        const transform = (p) => ({
          x: spec.xFeet + p.x * c - p.z * s,
          y: spec.baseFeet + p.y,
          z: spec.zFeet + p.x * s + p.z * c,
        });
        const path = [layout.entry, ...layout.path];
        points.push(transform(path[0]));
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1],
            b = path[i],
            count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5));
          for (let sample = 1; sample <= count; sample++) {
            const ratio = sample / count;
            points.push(
              transform({
                x: a.x + (b.x - a.x) * ratio,
                y: a.y + (b.y - a.y) * ratio,
                z: a.z + (b.z - a.z) * ratio,
              })
            );
          }
        }
      }
      this._navigationPoints = points;
    }
    return this._navigationPoints.map((point) => ({ ...point }));
  }

  getSolidCells({ partition = null, floorFeet = -1000000 } = {}) {
    if (!Number.isFinite(floorFeet)) throw new RangeError('The geometry floor must be finite');
    if (
      partition &&
      ['x', 'z'].some((axis) => {
        const cuts = partition[axis];
        const extent = axis === 'x' ? this.widthFeet : this.depthFeet;
        return (
          !Array.isArray(cuts) ||
          cuts.length < 2 ||
          cuts[0] !== 0 ||
          cuts.at(-1) !== extent ||
          cuts.some((value, i) => !Number.isFinite(value) || (i > 0 && value <= cuts[i - 1])) ||
          [...terrainCuts(extent)].some(
            (value) => !cuts.some((cut) => Math.abs(cut - value) < 1e-7)
          )
        );
      })
    )
      throw new RangeError('A geometry partition must refine the board terrain columns');
    if (!partition && floorFeet === -1000000 && this._solidCells) return this._solidCells;
    const axes = partition || {
      x: [...terrainCuts(this.widthFeet)].sort((a, b) => a - b),
      z: [...terrainCuts(this.depthFeet)].sort((a, b) => a - b),
    };
    let cells = [];
    for (let i = 1; i < axes.x.length; i++)
      for (let j = 1; j < axes.z.length; j++) {
        const height = this._getTerrainHeightFeet(
          (axes.x[i - 1] + axes.x[i]) / 2,
          (axes.z[j - 1] + axes.z[j]) / 2
        );
        if (!Number.isFinite(height)) throw new Error('The terrain support height is invalid');
        const bottom =
          this.terrainThicknessFeet === null
            ? Math.min(floorFeet, height - 5)
            : height - this.terrainThicknessFeet;
        const cell = createBoxCell(
          {
            min: {
              x: axes.x[i - 1],
              y: bottom,
              z: axes.z[j - 1],
            },
            max: { x: axes.x[i], y: height, z: axes.z[j] },
          },
          {
            id: 'terrain',
            layerId: 'ground',
            ...(this.terrainThicknessFeet === null ? { unboundedBottomFeet: bottom } : {}),
          }
        );
        if (cell) cells.push(cell);
      }
    for (const volume of this._operations.values()) {
      const cell = this._cells.get(volume.id);
      if (!cell) continue;
      // Disjoint cells keep overlapping additions from rendering coplanar faces twice.
      const remaining = [];
      for (const solid of cells) {
        if (boundsOverlap(solid.bounds, cell.bounds)) remaining.push(...subtractCell(solid, cell));
        else remaining.push(solid);
      }
      cells = remaining;
      if (volume.operation === 'add') cells.push(cell);
      if (cells.length > 50000)
        throw new RangeError('The constructed geometry has too many solid fragments');
    }
    freezeCells(cells);
    if (!partition && floorFeet === -1000000) this._solidCells = cells;
    return cells;
  }

  save() {
    return {
      version: this._structures.size ? 3 : this.hasCurves ? 2 : 1,
      ...(this._structures.size ? { structures: this.getStructures() } : {}),
      volumes: [...this._operations.values()].map((volume) => ({
        ...volume,
        bounds: cloneBounds(volume.bounds),
        ...(volume.shape
          ? {
              shape: JSON.parse(JSON.stringify(volume.shape)),
            }
          : {}),
      })),
    };
  }

  load(snapshot) {
    if (
      ![1, 2, 3].includes(snapshot?.version) ||
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
    if (snapshot.structures !== undefined) {
      if (
        snapshot.version !== 3 ||
        !Array.isArray(snapshot.structures) ||
        snapshot.structures.length > 256
      )
        throw new Error('Unsupported or invalid saved construction records');
      for (const saved of snapshot.structures) {
        const spec = createStructure(saved, { legacy: true });
        if (restored._structures.has(spec.id))
          throw new Error('Saved structure IDs must be unique');
        restored._structures.set(spec.id, spec);
      }
    }
    for (const volume of snapshot.volumes) {
      if (!volume || !['add', 'subtract'].includes(volume.operation)) {
        throw new Error('Saved map volumes require an Add or Subtract operation');
      }
      if (snapshot.version === 1 && volume.shape !== undefined)
        throw new Error('Curved volumes require a version-2 geometry snapshot');
      restored._addOperation(volume, volume.operation);
    }
    for (const spec of restored._structures.values())
      if (
        ![...restored._operations.values()].some(
          (volume) => volume.structureId === spec.id && volume.operation === 'add'
        )
      )
        throw new Error('Every saved structure must own physical geometry');
    this._operations = restored._operations;
    this._cells = restored._cells;
    this._structures = restored._structures;
    this.invalidate();
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
