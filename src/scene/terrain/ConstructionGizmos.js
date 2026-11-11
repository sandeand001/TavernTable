import {
  buildingLocalToFeet,
  buildingDimensions,
  buildingWindows,
  buildingLevelElevation,
  buildingLevels,
} from '../../terrain/BuildingModel.js';
import { isRoundStructure } from '../../terrain/ConstructionBlueprints.js';
import { buildingFeatureHandlePoints } from '../../terrain/ConstructionHandles.js';
import { wallStairLayout } from '../../terrain/WallStairs.js';

export class ConstructionGizmos {
  constructor(gameManager) {
    this.gm = gameManager;
    this.root = null;
    this.handles = new Map();
  }

  _displayPoints(spec, points, scale = 1) {
    const three = this.gm.threeSceneManager?.three,
      scene = this.gm.threeSceneManager?.scene;
    if (!three || !scene) return;
    if (!this.root) {
      this.root = new three.Group();
      this.root.name = 'ConstructionHandles';
      this.geometry = new three.SphereGeometry(this.gm.spatial.tileWorldSize * 0.16, 8, 6);
      this.material = new three.MeshBasicMaterial({
        color: 0x9bdcff,
        depthTest: false,
        depthWrite: false,
      });
      scene.add(this.root);
    }
    this.root.visible = true;
    if (this.frame) this.frame.visible = false;
    if (this.floorOutline) this.floorOutline.visible = false;
    for (const mesh of this.handles.values()) mesh.visible = false;
    const unit = this.gm.spatial.tileWorldSize / 5;
    for (const [key, local] of Object.entries(points)) {
      let mesh = this.handles.get(key);
      if (!mesh) {
        mesh = new three.Mesh(this.geometry, this.material);
        mesh.userData.constructionHandle = key;
        mesh.renderOrder = 30;
        this.root.add(mesh);
        this.handles.set(key, mesh);
      }
      const p = buildingLocalToFeet(spec, local);
      mesh.position.set(p.x * unit, p.y * unit, p.z * unit);
      mesh.scale.setScalar(scale);
      mesh.visible = true;
    }
    this.root.updateMatrixWorld(true);
    return true;
  }

  show(spec, { levelId = null } = {}) {
    const round = isRoundStructure(spec);
    const { length, width } = buildingDimensions(spec);
    const actualLength = round ? spec.diameterFeet : length;
    const actualWidth = round ? spec.diameterFeet : width;
    const floor =
      spec.kind === 'cellar'
        ? buildingLevelElevation(spec, levelId ?? buildingLevels(spec).at(-1).id)
        : spec.kind === 'stalactite'
          ? spec.heightFeet
          : 0;
    const points = {
      west: { x: -actualLength / 2, y: floor + 0.2, z: 0 },
      east: { x: actualLength / 2, y: floor + 0.2, z: 0 },
    };
    if (spec.kind !== 'wall')
      Object.assign(points, {
        north: { x: 0, y: floor + 0.2, z: -actualWidth / 2 },
        south: { x: 0, y: floor + 0.2, z: actualWidth / 2 },
      });
    if (!round && spec.kind !== 'wall')
      Object.assign(points, {
        'north-west': { x: -actualLength / 2, y: floor + 0.2, z: -actualWidth / 2 },
        'north-east': { x: actualLength / 2, y: floor + 0.2, z: -actualWidth / 2 },
        'south-west': { x: -actualLength / 2, y: floor + 0.2, z: actualWidth / 2 },
        'south-east': { x: actualLength / 2, y: floor + 0.2, z: actualWidth / 2 },
      });
    const roofRise =
      spec.building && !['none', 'flat', 'battlement'].includes(spec.building.roof)
        ? spec.building.roofRiseFeet
        : 0;
    points.height = {
      x: 0,
      y:
        spec.kind === 'cellar'
          ? -spec.heightFeet - 2
          : spec.kind === 'stalactite'
            ? -2
            : spec.heightFeet + roofRise + 2,
      z: 0,
    };
    points[spec.kind === 'cellar' ? 'cellar-position' : 'structure-position'] = {
      x: 0,
      y: floor + 0.3,
      z: 0,
    };
    if (spec.kind === 'wall' && spec.wallStairs)
      points['stairs-position'] = wallStairLayout(spec).center;
    this._displayPoints(spec, points);
  }

  _outline(spec, feature, kind, points) {
    if (kind === 'window')
      return [
        'feature-bottom-west',
        'feature-bottom-east',
        'feature-top-east',
        'feature-top-west',
      ].map((key) => points[key]);
    const west = { ...points['feature-west'] },
      east = { ...points['feature-east'] };
    const axis = ['north', 'south'].includes(feature.side) ? 'z' : 'x';
    const sign = ['east', 'south'].includes(feature.side) ? 1 : -1;
    west[axis] -= sign * (feature.depthFeet / 2 + 1);
    east[axis] -= sign * (feature.depthFeet / 2 + 1);
    return [west, east, points['feature-depth-east'], points['feature-depth-west']];
  }

  showFeature(spec, feature, kind) {
    const points = buildingFeatureHandlePoints(spec, feature, kind);
    const size = Math.min(
      feature.widthFeet,
      kind === 'window' ? feature.heightFeet : feature.depthFeet
    );
    if (!this._displayPoints(spec, points, Math.min(1, Math.max(0.3, size / 3)))) return;
    const three = this.gm.threeSceneManager.three,
      unit = this.gm.spatial.tileWorldSize / 5;
    if (!this.frame) {
      this.frame = new three.LineLoop(
        new three.BufferGeometry(),
        new three.LineBasicMaterial({
          color: 0x9bdcff,
          depthTest: false,
          depthWrite: false,
        })
      );
      this.frame.name = 'ConstructionFeatureOutline';
      this.frame.renderOrder = 31;
      this.root.add(this.frame);
    }
    const geometry = new three.BufferGeometry().setFromPoints(
      this._outline(spec, feature, kind, points).map((local) => {
        const p = buildingLocalToFeet(spec, local);
        return new three.Vector3(p.x * unit, p.y * unit, p.z * unit);
      })
    );
    this.frame.geometry.dispose();
    this.frame.geometry = geometry;
    this.frame.visible = true;
    this.root.updateMatrixWorld(true);
  }

  pickFeature(event, canvas, spec, kind) {
    const ray = this.ray(event, canvas);
    if (!ray) return null;
    const three = this.gm.threeSceneManager.three,
      unit = this.gm.spatial.tileWorldSize / 5;
    const hit = this.gm.pickingService?.pickGroundSync(event.clientX, event.clientY, canvas);
    const p = hit?.surface?.point;
    const limit = p
      ? ray.ray.origin.distanceTo(new three.Vector3(p.x, p.y, p.z)) + unit * 0.3
      : Infinity;
    const features = kind === 'window' ? buildingWindows(spec) : spec.building.balconies;
    let closest = null;
    for (const feature of features) {
      const points = buildingFeatureHandlePoints(spec, feature, kind);
      const vertices = [
        ...Object.values(points),
        ...this._outline(spec, feature, kind, points),
      ].map((local) => {
        const point = buildingLocalToFeet(spec, local);
        return new three.Vector3(point.x * unit, point.y * unit, point.z * unit);
      });
      const box = new three.Box3().setFromPoints(vertices).expandByScalar(unit * 0.25);
      if (kind === 'balcony') {
        box.min.y -= unit * 0.5;
        box.max.y += unit * 3;
      }
      const point = ray.ray.intersectBox(box, new three.Vector3());
      if (!point) continue;
      const distance = point.distanceTo(ray.ray.origin);
      if (distance <= limit && (!closest || distance < closest.distance))
        closest = { feature, distance };
    }
    return closest?.feature || null;
  }

  ray(event, canvas) {
    const three = this.gm.threeSceneManager?.three,
      camera = this.gm.threeSceneManager?.camera;
    if (!three || !camera) return null;
    const rect = canvas.getBoundingClientRect();
    const ray = new three.Raycaster();
    ray.setFromCamera(
      new three.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2
      ),
      camera
    );
    return ray;
  }

  pick(event, canvas) {
    if (!this.root?.visible) return null;
    const ray = this.ray(event, canvas);
    return (
      ray?.intersectObjects([...this.handles.values()].filter((mesh) => mesh.visible))[0]?.object
        .userData.constructionHandle || null
    );
  }

  point(
    event,
    canvas,
    { heightFeet = 0, vertical = false, center = null, normalFeet = null } = {}
  ) {
    const ray = this.ray(event, canvas);
    if (!ray) return null;
    const three = this.gm.threeSceneManager.three,
      unit = this.gm.spatial.tileWorldSize / 5;
    const normal = new three.Vector3(0, 1, 0);
    const anchor = new three.Vector3(0, heightFeet * unit, 0);
    if (normalFeet) {
      anchor.set(center.x * unit, center.y * unit, center.z * unit);
      normal.set(normalFeet.x, normalFeet.y, normalFeet.z).normalize();
    } else if (vertical) {
      anchor.set(center.x * unit, center.y * unit, center.z * unit);
      normal.copy(this.gm.threeSceneManager.camera.position).sub(anchor);
      normal.y = 0;
      normal.normalize();
    }
    const point = ray.ray.intersectPlane(
      new three.Plane().setFromNormalAndCoplanarPoint(normal, anchor),
      new three.Vector3()
    );
    return point ? { x: point.x / unit, y: point.y / unit, z: point.z / unit } : null;
  }

  clear() {
    if (this.root) this.root.visible = false;
  }

  showFloor(spec, level) {
    const { length, width } = buildingDimensions(spec),
      y = level.elevationFeet + 0.05;
    const points = {
      'floor-north-west': { x: -length / 2, y, z: -width / 2 },
      'floor-north-east': { x: length / 2, y, z: -width / 2 },
      'floor-south-east': { x: length / 2, y, z: width / 2 },
      'floor-south-west': { x: -length / 2, y, z: width / 2 },
    };
    if (!this._displayPoints(spec, points, 0.5)) return;
    const three = this.gm.threeSceneManager.three,
      unit = this.gm.spatial.tileWorldSize / 5;
    if (!this.floorOutline) {
      this.floorOutline = new three.LineSegments(
        new three.BufferGeometry(),
        new three.LineBasicMaterial({
          color: 0xffcc66,
          depthTest: false,
          depthWrite: false,
        })
      );
      this.floorOutline.name = 'ConstructionFloorOutline';
      this.floorOutline.renderOrder = 31;
      this.root.add(this.floorOutline);
    }
    const positions = [];
    const box = (x0, z0, x1, z1) => {
      const corners = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ].map(([x, z]) => buildingLocalToFeet(spec, { x, y, z }));
      for (let i = 0; i < 4; i++)
        for (const p of [corners[i], corners[(i + 1) % 4]])
          positions.push(p.x * unit, p.y * unit, p.z * unit);
    };
    box(-length / 2, -width / 2, length / 2, width / 2);
    for (const hole of level.openings || [])
      box(
        hole.xFeet - length / 2,
        hole.zFeet - width / 2,
        hole.xFeet + hole.lengthFeet - length / 2,
        hole.zFeet + hole.widthFeet - width / 2
      );
    const geometry = new three.BufferGeometry();
    geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
    this.floorOutline.geometry.dispose();
    this.floorOutline.geometry = geometry;
    this.floorOutline.visible = true;
    this.root.updateMatrixWorld(true);
  }

  dispose() {
    this.root?.removeFromParent();
    this.geometry?.dispose();
    this.material?.dispose();
    this.frame?.geometry.dispose();
    this.frame?.material.dispose();
    this.floorOutline?.geometry.dispose();
    this.floorOutline?.material.dispose();
    this.root = null;
    this.frame = null;
    this.handles.clear();
  }
}
