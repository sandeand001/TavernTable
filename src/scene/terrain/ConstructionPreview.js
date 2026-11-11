import { structureVolumes, structureBounds } from '../../terrain/ConstructionBlueprints.js';
import { volumeCell } from '../../terrain/TerrainVolumeShape.js';
import { TerrainGeometry } from '../../terrain/TerrainGeometry.js';
import { TerrainVolumeMeshBuilder } from './TerrainVolumeMeshBuilder.js';
import { clipCellToBounds } from '../../terrain/ConvexGeometry.js';

export class ConstructionPreview {
  constructor(gameManager) {
    this.gm = gameManager;
    this.mesh = null;
    this.signature = null;
  }

  show(spec, { wireframe = false } = {}) {
    if (spec.kind === 'cellar') wireframe = true;
    const signature = JSON.stringify([spec, wireframe]);
    if (signature === this.signature) return;
    this.clear();
    const three = this.gm.threeSceneManager?.three;
    const scene = this.gm.threeSceneManager?.scene;
    if (!three || !scene) throw new Error('The structure preview renderer is not ready');
    const bounds = structureBounds(spec);
    const valid =
      bounds.min.x >= 0 &&
      bounds.min.z >= 0 &&
      bounds.max.x <= this.gm.cols * 5 &&
      bounds.max.z <= this.gm.rows * 5;
    const positions = [];
    const unit = this.gm.spatial.tileWorldSize / 5;
    for (const volume of structureVolumes(spec)) {
      if (
        volume.operation !== 'add' &&
        !(wireframe && spec.building && /-window-|-(entry|balcony.*)-door$/.test(volume.id))
      )
        continue;
      const cell = volumeCell(volume);
      for (const face of cell?.faces || [])
        for (let i = 1; i < face.vertices.length - 1; i++)
          for (const p of [face.vertices[0], face.vertices[i], face.vertices[i + 1]])
            positions.push(p.x * unit, p.y * unit, p.z * unit);
    }
    const geometry = new three.BufferGeometry();
    geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
    if (wireframe) {
      const edges = new three.EdgesGeometry(geometry, 12);
      geometry.dispose();
      this.mesh = new three.LineSegments(
        edges,
        new three.LineBasicMaterial({
          color: valid ? 0x73c7ff : 0xff6666,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          depthTest: false,
        })
      );
    } else {
      const material = new three.MeshBasicMaterial({
        color: valid ? 0x73c7ff : 0xff6666,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: three.DoubleSide,
      });
      this.mesh = new three.Mesh(geometry, material);
    }
    this.mesh.name = 'ConstructionPreview';
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    this.signature = signature;
    return valid;
  }

  showSnap(preview) {
    const signature = JSON.stringify(preview.geometry);
    if (signature === this.signature) return true;
    this.clear();
    const three = this.gm.threeSceneManager?.three,
      scene = this.gm.threeSceneManager?.scene;
    if (!three || !scene) throw new Error('The structure preview renderer is not ready');
    const parts = preview.geometry.structures.filter((spec) =>
      [preview.structure.id, preview.targetId].includes(spec.id)
    );
    const boxes = parts.map(structureBounds);
    const bounds = {
      min: {
        x: Math.min(...boxes.map((box) => box.min.x)),
        y: Math.min(...parts.map((part) => part.baseFeet)) + 1e-5,
        z: Math.min(...boxes.map((box) => box.min.z)),
      },
      max: {
        x: Math.max(...boxes.map((box) => box.max.x)),
        y: Math.max(...boxes.map((box) => box.max.y)),
        z: Math.max(...boxes.map((box) => box.max.z)),
      },
    };
    const unit = this.gm.spatial.tileWorldSize / 5;
    const geometry = new TerrainGeometry({
      widthFeet: this.gm.cols * 5,
      depthFeet: this.gm.rows * 5,
      terrainThicknessFeet: this.gm.terrainEngine.geometry.terrainThicknessFeet,
      getTerrainHeightFeet: (x, z) =>
        (this.gm.terrainEngine.getHeightAt(Math.floor(x / 5), Math.floor(z / 5)) *
          this.gm.spatial.elevationUnit) /
        unit,
    });
    geometry.load(preview.geometry);
    const query = {
      hasCurves: true,
      getSolidCells: () =>
        geometry.getSolidCells().flatMap((cell) => {
          const clipped = clipCellToBounds(cell, bounds);
          return clipped ? [clipped] : [];
        }),
    };
    const solid = new TerrainVolumeMeshBuilder().build({
      geometry: query,
      three,
      worldUnitsPerFoot: unit,
    });
    const edges = new three.EdgesGeometry(solid, 12);
    solid.dispose();
    this.mesh = new three.LineSegments(
      edges,
      new three.LineBasicMaterial({
        color: 0x73c7ff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.mesh.name = 'ConstructionPreview';
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    this.signature = signature;
    return true;
  }

  clear() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh.removeFromParent();
    }
    this.mesh = null;
    this.signature = null;
  }

  dispose() {
    this.clear();
  }
}
