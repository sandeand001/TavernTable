import { CAVERN_FLOOR_MAX_LEVEL } from '../../terrain/generation/CavernInteriors.js';

const FLOOR_SAMPLES = [
  [0.02, 0.02],
  [0.98, 0.02],
  [0.5, 0.5],
  [0.02, 0.98],
  [0.98, 0.98],
];
const EPSILON = 1e-8;
const TOP_DOWN_DIRECTION_Y = -Math.sin((80 * Math.PI) / 180);

export function dungeonBoundaryWalls({ geometry, cols, rows, tileWorldSize }) {
  const cells = new Uint8Array(cols * rows);
  const tops = new Float64Array(cols * rows);
  const volumeIds = new Set();
  const structureIds = new Set();
  const lintels = new Map();
  const width = cols * 5;
  const depth = rows * 5;
  const volumes = geometry.save().volumes;
  const volumesById = new Map(volumes.map((volume) => [volume.id, volume]));
  for (const volume of volumes) {
    if (
      volume.operation !== 'add' ||
      (volume.source !== undefined && volume.source !== 'generated') ||
      !/^generated-dungeon-\d+-\d+-wall$/.test(volume.id)
    )
      continue;
    const id = volume.id.slice(0, -'-wall'.length);
    const opening = volumesById.get(`${id}-door`);
    if (opening?.operation === 'subtract' && opening.bounds.max.y < volume.bounds.max.y - EPSILON)
      lintels.set(id, {
        bounds: opening.bounds,
        bottom: opening.bounds.max.y,
        top: volume.bounds.max.y,
      });
    const { min, max } = volume.bounds;
    const vertical = (min.x <= EPSILON || max.x >= width - EPSILON) && max.x - min.x <= 3;
    const horizontal = (min.z <= EPSILON || max.z >= depth - EPSILON) && max.z - min.z <= 3;
    if (!vertical && !horizontal) continue;
    volumeIds.add(volume.id);
    structureIds.add(volume.structureId || volume.id.slice(0, -'-wall'.length));
    const firstX = Math.max(0, Math.floor((min.x + EPSILON) / 5));
    const lastX = Math.min(cols - 1, Math.floor((max.x - EPSILON) / 5));
    const firstZ = Math.max(0, Math.floor((min.z + EPSILON) / 5));
    const lastZ = Math.min(rows - 1, Math.floor((max.z - EPSILON) / 5));
    for (let z = firstZ; z <= lastZ; z++)
      for (let x = firstX; x <= lastX; x++) {
        const index = z * cols + x;
        cells[index] = 1;
        tops[index] = Math.max(tops[index], (max.y * tileWorldSize) / 5);
      }
  }
  if (!volumeIds.size && !lintels.size) return null;
  return {
    cells,
    tops,
    structureIds,
    lintels,
    includesSpan: (span) =>
      !!span && (volumeIds.has(span.id) || structureIds.has(span.structureId)),
    lintelBoundsFor(span) {
      const id = span?.structureId || span?.id?.replace(/-wall$/, '');
      const lintel = lintels.get(id);
      const bottom = span?.bounds?.min.y ?? span?.bottom;
      return lintel && Number.isFinite(bottom) && bottom >= lintel.bottom - EPSILON
        ? lintel.bounds
        : null;
    },
  };
}

export class BoundaryWallCutaway {
  constructor({ cols, rows, getHeight, tileWorldSize, elevationUnit, three, boundary = null }) {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols <= 0 ||
      rows <= 0 ||
      typeof getHeight !== 'function' ||
      !(tileWorldSize > 0) ||
      !(elevationUnit > 0) ||
      !three
    )
      throw new Error('A boundary cutaway requires a valid terrain grid and scale');
    this.cols = cols;
    this.rows = rows;
    this.tile = tileWorldSize;
    this.elevationUnit = elevationUnit;
    this.three = three;
    this.heights = new Float64Array(cols * rows);
    this.wallCells = new Uint8Array(cols * rows);
    this.wallTops = new Float64Array(cols * rows);
    this.floors = [];
    const queue = [];
    if (
      boundary &&
      (boundary.cells?.length !== cols * rows ||
        boundary.tops?.length !== cols * rows ||
        typeof boundary.includesSpan !== 'function')
    )
      throw new Error('The boundary wall provenance is invalid');
    this.includesSpan = boundary ? boundary.includesSpan : (span) => !span || span.id === 'terrain';
    this.lintels = boundary?.lintels ?? new Map();
    this.stopAtFloor = boundary
      ? (index) => !this.wallCells[index]
      : (index) => this.heights[index] <= CAVERN_FLOOR_MAX_LEVEL;
    for (let z = 0; z < rows; z++)
      for (let x = 0; x < cols; x++) {
        const index = z * cols + x;
        const height = getHeight(x, z);
        if (!Number.isFinite(height)) throw new Error('A boundary terrain height is invalid');
        this.heights[index] = height;
        this.wallTops[index] = boundary ? boundary.tops[index] : height * elevationUnit;
        if (boundary) {
          this.wallCells[index] = boundary.cells[index];
          this.floors.push(index);
        } else if (height <= CAVERN_FLOOR_MAX_LEVEL) this.floors.push(index);
        else if (x === 0 || z === 0 || x === cols - 1 || z === rows - 1) {
          this.wallCells[index] = 1;
          queue.push(index);
        }
      }
    for (let head = 0; !boundary && head < queue.length; head++) {
      const index = queue[head];
      const x = index % cols;
      const z = Math.floor(index / cols);
      for (const [nx, nz] of [
        [x - 1, z],
        [x + 1, z],
        [x, z - 1],
        [x, z + 1],
      ]) {
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const neighbor = nz * cols + nx;
        if (this.wallCells[neighbor] || this.heights[neighbor] <= CAVERN_FLOOR_MAX_LEVEL) continue;
        this.wallCells[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    if (boundary && !this.wallCells.some((value) => value)) this.floors.length = 0;
    this.hidden = new Uint8Array(cols * rows);
    this.nextHidden = new Uint8Array(cols * rows);
    this.raycaster = new three.Raycaster();
    this.screen = new three.Vector2();
    this.floorPoint = new three.Vector3();
    this.worldPoint = new three.Vector3();
    this.projected = new three.Vector3();
    this.origin = new three.Vector3();
    this.cameraPlane = new three.Vector3();
    this.cameraDirection = new three.Vector3();
    this.inverseWorld = new three.Matrix4();
    this.wallModels = [];
    this.hideLintels = false;
    this.lastMatrices = null;
  }

  boundaryCell(x, z, span = null) {
    if (!this.includesSpan(span) || x < 0 || z < 0 || x >= this.cols || z >= this.rows) return 0;
    const index = z * this.cols + x;
    return this.wallCells[index] ? index + 1 : 0;
  }

  attach(mesh) {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    const cells = geometry.getAttribute('boundaryWallCell');
    const lintels = geometry.getAttribute('dungeonLintel');
    if (!positions || !cells || cells.count !== positions.count)
      throw new Error('The boundary geometry is missing its wall provenance');
    if (lintels && lintels.count !== positions.count)
      throw new Error('The Dungeon geometry has invalid doorway provenance');
    const original = geometry.getIndex();
    this.indices = original
      ? Uint32Array.from(original.array)
      : Uint32Array.from({ length: positions.count }, (_, index) => index);
    if (this.indices.length % 3 || geometry.groups.length)
      throw new Error('The boundary geometry has an unsupported draw layout');
    this.triangleCells = new Uint32Array(this.indices.length / 3);
    this.triangleLintels = new Uint8Array(this.indices.length / 3);
    for (let offset = 0; offset < this.indices.length; offset += 3) {
      this.triangleCells[offset / 3] = cells.getX(this.indices[offset]);
      if (lintels) this.triangleLintels[offset / 3] = lintels.getX(this.indices[offset]) ? 1 : 0;
    }
    geometry.deleteAttribute('boundaryWallCell');
    geometry.deleteAttribute('dungeonLintel');
    const index = new this.three.BufferAttribute(Uint32Array.from(this.indices), 1);
    index.setUsage(this.three.DynamicDrawUsage);
    geometry.setIndex(index);
    this.mesh = mesh;
  }

  attachWallModels(group, structureIds) {
    if (!group || (!structureIds?.size && !this.lintels.size)) return;
    this.mesh.updateWorldMatrix(true, false);
    group.updateWorldMatrix(true, true);
    const inverse = new this.three.Matrix4().copy(this.mesh.matrixWorld).invert();
    const matrix = new this.three.Matrix4();
    const cellsFor = (bounds) => {
      const cells = [];
      const firstX = Math.max(0, Math.floor(bounds.min.x / this.tile));
      const lastX = Math.min(this.cols - 1, Math.floor(bounds.max.x / this.tile));
      const firstZ = Math.max(0, Math.floor(bounds.min.z / this.tile));
      const lastZ = Math.min(this.rows - 1, Math.floor(bounds.max.z / this.tile));
      for (let z = firstZ; z <= lastZ; z++)
        for (let x = firstX; x <= lastX; x++) {
          const index = z * this.cols + x;
          if (this.wallCells[index]) cells.push(index);
        }
      return cells;
    };
    const isLintel = (id, bounds) => {
      const lintel = this.lintels.get(id);
      if (!lintel) return false;
      const scale = this.tile / 5;
      const tolerance = Math.max(1e-6, this.tile * 1e-5);
      return (
        bounds.min.y >= lintel.bottom * scale - tolerance &&
        bounds.max.y > lintel.bottom * scale + tolerance &&
        bounds.min.x < lintel.bounds.max.x * scale - tolerance &&
        bounds.max.x > lintel.bounds.min.x * scale + tolerance &&
        bounds.min.z < lintel.bounds.max.z * scale - tolerance &&
        bounds.max.z > lintel.bounds.min.z * scale + tolerance
      );
    };
    group.traverseVisible((object) => {
      if (!object.isMesh) return;
      const ids = object.isInstancedMesh ? object.userData.structureIds : null;
      const id = object.userData.structureId || object.parent?.userData.structureId;
      if (
        object.isInstancedMesh
          ? !ids?.some((entry) => structureIds?.has(entry) || this.lintels.has(entry))
          : !structureIds?.has(id) && !this.lintels.has(id)
      )
        return;
      const geometry = object.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (!geometry.boundingBox || geometry.boundingBox.isEmpty())
        throw new Error('A boundary wall model has no measurable geometry');
      if (object.isInstancedMesh) {
        const instances = [];
        for (let index = 0; index < object.count; index++) {
          if (!structureIds?.has(ids[index]) && !this.lintels.has(ids[index])) continue;
          object.getMatrixAt(index, matrix);
          matrix.premultiply(object.matrixWorld).premultiply(inverse);
          const bounds = geometry.boundingBox.clone().applyMatrix4(matrix);
          const cells = structureIds?.has(ids[index]) ? cellsFor(bounds) : [];
          const lintel = isLintel(ids[index], bounds);
          if (cells.length || lintel) instances.push({ index, cells, lintel });
        }
        if (instances.length)
          this.wallModels.push({
            object,
            instances,
            original: Float32Array.from(object.instanceMatrix.array),
          });
      } else {
        matrix.copy(inverse).multiply(object.matrixWorld);
        const bounds = geometry.boundingBox.clone().applyMatrix4(matrix);
        const cells = structureIds?.has(id) ? cellsFor(bounds) : [];
        const lintel = isLintel(id, bounds);
        if (cells.length || lintel)
          this.wallModels.push({ object, cells, lintel, visible: object.visible });
      }
    });
  }

  _updateWallModels(hidden, hideLintels = false) {
    const zero = new this.three.Matrix4().makeScale(0, 0, 0);
    for (const model of this.wallModels) {
      if (model.instances) {
        for (const instance of model.instances) {
          if ((hideLintels && instance.lintel) || instance.cells.some((index) => hidden[index]))
            model.object.setMatrixAt(instance.index, zero);
          else
            model.object.instanceMatrix.array.set(
              model.original.subarray(instance.index * 16, instance.index * 16 + 16),
              instance.index * 16
            );
        }
        model.object.instanceMatrix.needsUpdate = true;
        model.object.boundingSphere = null;
        model.object.boundingBox = null;
      } else
        model.object.visible =
          model.visible &&
          !(hideLintels && model.lintel) &&
          !model.cells.some((index) => hidden[index]);
    }
  }

  restore() {
    this._updateWallModels(new Uint8Array(this.wallCells.length));
    if (this.mesh) {
      const geometry = this.mesh.geometry;
      const index = geometry.getIndex();
      index.array.set(this.indices);
      index.needsUpdate = true;
      geometry.setDrawRange(0, this.indices.length);
    }
    this.hidden.fill(0);
    this.hideLintels = false;
    this.lastMatrices = null;
  }

  update(camera) {
    if (!this.mesh || !camera) return;
    camera.updateMatrixWorld();
    this.mesh.updateWorldMatrix(true, false);
    const matrices = [
      ...camera.matrixWorld.elements,
      ...camera.projectionMatrix.elements,
      ...this.mesh.matrixWorld.elements,
    ];
    if (this.lastMatrices && matrices.every((value, index) => value === this.lastMatrices[index]))
      return;
    this.lastMatrices = matrices;
    this.nextHidden.fill(0);
    this.inverseWorld.copy(this.mesh.matrixWorld).invert();
    this.raycaster.setFromCamera(this.screen.set(0, 0), camera);
    this.cameraPlane.copy(this.raycaster.ray.origin);
    this.cameraDirection.copy(this.raycaster.ray.direction);
    const hideLintels = this.lintels.size > 0 && this.cameraDirection.y <= TOP_DOWN_DIRECTION_Y;
    for (const index of this.floors) {
      const x = index % this.cols;
      const z = Math.floor(index / this.cols);
      for (const [offsetX, offsetZ] of FLOOR_SAMPLES) {
        this.floorPoint.set(
          (x + offsetX) * this.tile,
          this.heights[index] * this.elevationUnit,
          (z + offsetZ) * this.tile
        );
        this.worldPoint.copy(this.floorPoint).applyMatrix4(this.mesh.matrixWorld);
        this.projected.copy(this.worldPoint).project(camera);
        if (
          this.projected.x < -1 ||
          this.projected.x > 1 ||
          this.projected.y < -1 ||
          this.projected.y > 1 ||
          this.projected.z < -1 ||
          this.projected.z > 1
        )
          continue;
        if (camera.isOrthographicCamera) {
          const distance = this.origin
            .subVectors(this.cameraPlane, this.worldPoint)
            .dot(this.cameraDirection);
          this.origin.copy(this.worldPoint).addScaledVector(this.cameraDirection, distance);
        } else this.origin.copy(this.cameraPlane);
        this.origin.applyMatrix4(this.inverseWorld);
        this._markObstructions(this.origin, this.floorPoint);
      }
    }
    if (
      hideLintels === this.hideLintels &&
      this.nextHidden.every((value, index) => value === this.hidden[index])
    )
      return;
    this.hidden.set(this.nextHidden);
    this.hideLintels = hideLintels;
    this._updateWallModels(this.hidden, hideLintels);
    const geometry = this.mesh.geometry;
    const destination = geometry.getIndex();
    let written = 0;
    for (let offset = 0; offset < this.indices.length; offset += 3) {
      const cell = this.triangleCells[offset / 3];
      if (cell && this.hidden[cell - 1]) continue;
      if (hideLintels && this.triangleLintels[offset / 3]) continue;
      destination.array[written++] = this.indices[offset];
      destination.array[written++] = this.indices[offset + 1];
      destination.array[written++] = this.indices[offset + 2];
    }
    destination.needsUpdate = true;
    geometry.setDrawRange(0, written);
  }

  _markObstructions(origin, target) {
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    let start = 0;
    let end = 1;
    for (const [coordinate, delta, limit] of [
      [origin.x, dx, this.cols * this.tile],
      [origin.z, dz, this.rows * this.tile],
    ]) {
      if (Math.abs(delta) < EPSILON) {
        if (coordinate < 0 || coordinate >= limit) return;
        continue;
      }
      const first = -coordinate / delta;
      const last = (limit - coordinate) / delta;
      start = Math.max(start, Math.min(first, last));
      end = Math.min(end, Math.max(first, last));
    }
    if (start >= end) return;
    const initial = Math.min(end, start + EPSILON);
    let x = Math.min(this.cols - 1, Math.max(0, Math.floor((origin.x + dx * initial) / this.tile)));
    let z = Math.min(this.rows - 1, Math.max(0, Math.floor((origin.z + dz * initial) / this.tile)));
    const stepX = Math.sign(dx);
    const stepZ = Math.sign(dz);
    let entry = start;
    while (entry < end && x >= 0 && z >= 0 && x < this.cols && z < this.rows) {
      const nextX = stepX ? ((stepX > 0 ? x + 1 : x) * this.tile - origin.x) / dx : Infinity;
      const nextZ = stepZ ? ((stepZ > 0 ? z + 1 : z) * this.tile - origin.z) / dz : Infinity;
      const exit = Math.min(end, nextX, nextZ);
      const index = z * this.cols + x;
      if (this.stopAtFloor(index)) break;
      const lowestY = Math.min(
        origin.y + (target.y - origin.y) * entry,
        origin.y + (target.y - origin.y) * exit
      );
      if (this.wallCells[index] && lowestY <= this.wallTops[index] + EPSILON)
        this.nextHidden[index] = 1;
      if (exit >= end) break;
      if (nextX <= nextZ + EPSILON) x += stepX;
      if (nextZ <= nextX + EPSILON) z += stepZ;
      entry = exit;
    }
  }
}
