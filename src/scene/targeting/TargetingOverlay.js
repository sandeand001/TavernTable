import { targetRelation, areaPlacement } from '../../rules/targeting/geometry.js';
import { targetStatus, affectedAreaTargets } from '../../rules/targeting/assessment.js';

const COLORS = { friendly: 0x60a5fa, hostile: 0xf87171, neutral: 0xfacc15, self: 0x60a5fa };

export default class TargetingOverlay {
  constructor(three, scene) {
    this.three = three;
    this.scene = scene;
    this.group = new three.Group();
    this.group.name = 'TargetingAndSpellAreas';
    this.group.renderOrder = 6;
    this.group.traverse((node) => {
      node.raycast = () => {};
    });
    scene.add(this.group);
    this.signature = '';
  }

  setViewTransform(transform = null) {
    if (transform) {
      this.group.position.set(transform.position.x, transform.position.y, transform.position.z);
      this.group.rotation.y = transform.yaw;
      this.group.scale.setScalar(transform.scale);
    } else {
      this.group.position.set(0, 0, 0);
      this.group.rotation.y = 0;
      this.group.scale.setScalar(1);
    }
    this.group.updateMatrixWorld(true);
  }

  update(board, actor, profile, selection, effects) {
    const signature = JSON.stringify({
      actor,
      profile,
      selection,
      effects,
      tokens: board?.tokens,
      cover: board?.coverKey,
    });
    if (signature === this.signature) return;
    this.signature = signature;
    this.clear();
    for (const effect of effects || []) {
      if (effect.kind === 'flight') {
        const indicators = new this.three.Group();
        indicators.name = 'FlightEffectIndicators';
        // Transparent portrait tokens do not write depth, so draw beneath them.
        indicators.renderOrder = -1;
        indicators.raycast = () => {};
        this.group.add(indicators);
        for (const token of board?.tokens || []) {
          if (effect.targetTokenIds.includes(token.id))
            this.ring(token.groundWorld || token.world, board.tileSize * 0.52, 0x67e8f9, {
              depthTest: true,
              group: indicators,
              yOffset: token.groundWorld ? board.tileSize * 0.015 : 0.025,
            });
        }
        continue;
      }
      let area = effect.area;
      if (effect.followCaster) {
        const caster = board?.tokens.find((token) => token.id === effect.casterTokenId);
        if (!caster) continue;
        area = { ...area, origin: { ...caster.world } };
      }
      this.area(area, spellColor(effect.sourceId), 0.13);
    }
    if (!actor || !profile || profile.kind === 'manual') return;
    const mode = profile.modes?.find((entry) => entry.id === selection?.mode);
    const maximum = mode?.long ?? profile.rangeFeet;
    if (maximum > 0) {
      this.range(actor.world, (maximum * board.tileSize) / 5, 0x67e8f9);
      if (mode && mode.normal < mode.long)
        this.range(actor.world, (mode.normal * board.tileSize) / 5, 0x34d399);
    }
    const selected = new Set((selection?.targets || []).map((target) => target.tokenId));
    const previewArea =
      profile.kind === 'area' && (profile.anchor === 'caster' || selection?.origin)
        ? areaPlacement(profile, actor, selection || {}, board.tileSize)
        : null;
    const affected = previewArea
      ? new Set(
          affectedAreaTargets(board, actor, profile, previewArea, selection?.exclusions).map(
            (token) => token.id
          )
        )
      : null;
    const excluded = new Set(selection?.exclusions || []);
    for (const token of board.tokens) {
      const viable =
        profile.kind === 'tokens'
          ? targetStatus(board, actor, token, profile, selection?.mode).allowed
          : affected
            ? affected.has(token.id)
            : true;
      this.ring(
        token.world,
        board.tileSize * 0.36,
        selected.has(token.id)
          ? 0x34d399
          : excluded.has(token.id)
            ? 0xa78bfa
            : viable
              ? COLORS[targetRelation(actor, token)]
              : 0x64748b
      );
    }
    if (previewArea) this.area(previewArea, 0xfbbf24, 0.18);
  }

  range(origin, distance, color) {
    const three = this.three;
    const points = [
      [-distance, -distance],
      [distance, -distance],
      [distance, distance],
      [-distance, distance],
    ].map(([x, z]) => new three.Vector3(origin.x + x, origin.y + 0.025, origin.z + z));
    const geometry = new three.BufferGeometry().setFromPoints(points);
    const line = new three.LineLoop(
      geometry,
      new three.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        toneMapped: false,
      })
    );
    line.raycast = () => {};
    this.group.add(line);
  }

  ring(origin, radius, color, { depthTest = false, group = this.group, yOffset = 0.025 } = {}) {
    const three = this.three;
    const geometry = new three.RingGeometry(radius * 0.86, radius, 32);
    const mesh = new three.Mesh(
      geometry,
      new three.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: three.DoubleSide,
        depthWrite: false,
        depthTest,
        toneMapped: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(origin.x, origin.y + yOffset, origin.z);
    mesh.raycast = () => {};
    group.add(mesh);
  }

  area(area, color, opacity) {
    const three = this.three;
    let geometry,
      offset = { x: 0, y: 0, z: 0 },
      rotation = null;
    const direction = new three.Vector3(area.direction.x, area.direction.y, area.direction.z);
    if (area.shape === 'sphere' || area.shape === 'emanation')
      geometry = new three.SphereGeometry(area.size, 28, 16);
    else if (area.shape === 'cylinder') {
      geometry = new three.CylinderGeometry(area.size, area.size, area.height, 32);
      offset.y = area.height / 2;
    } else if (area.shape === 'square') {
      geometry = new three.PlaneGeometry(area.size, area.size);
      rotation = new three.Quaternion().setFromAxisAngle(new three.Vector3(1, 0, 0), -Math.PI / 2);
      offset.y = 0.025;
    } else if (area.shape === 'cube') {
      geometry = new three.BoxGeometry(area.size, area.size, area.size);
      offset = {
        x: (direction.x * area.size) / 2,
        y: area.size / 2,
        z: (direction.z * area.size) / 2,
      };
      rotation = new three.Quaternion().setFromAxisAngle(
        new three.Vector3(0, 1, 0),
        Math.atan2(direction.x, direction.z)
      );
    } else if (area.shape === 'cone') {
      geometry = new three.ConeGeometry(area.size / 2, area.size, 32);
      rotation = new three.Quaternion().setFromUnitVectors(new three.Vector3(0, -1, 0), direction);
      offset = {
        x: (direction.x * area.size) / 2,
        y: (direction.y * area.size) / 2,
        z: (direction.z * area.size) / 2,
      };
    } else if (area.shape === 'line') {
      geometry = new three.BoxGeometry(area.width, area.width, area.size);
      rotation = new three.Quaternion().setFromUnitVectors(new three.Vector3(0, 0, 1), direction);
      offset = {
        x: (direction.x * area.size) / 2,
        y: (direction.y * area.size) / 2,
        z: (direction.z * area.size) / 2,
      };
    } else throw new Error('The spell overlay has an unsupported area shape');
    const mesh = new three.Mesh(
      geometry,
      new three.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: three.DoubleSide,
        toneMapped: false,
      })
    );
    mesh.position.set(area.origin.x + offset.x, area.origin.y + offset.y, area.origin.z + offset.z);
    if (rotation) mesh.quaternion.copy(rotation);
    mesh.raycast = () => {};
    const edges = new three.LineSegments(
      new three.EdgesGeometry(geometry),
      new three.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        toneMapped: false,
      })
    );
    edges.raycast = () => {};
    mesh.add(edges);
    this.group.add(mesh);
  }

  clear() {
    for (const child of [...this.group.children]) {
      child.traverse((node) => {
        node.geometry?.dispose();
        if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose());
        else node.material?.dispose();
      });
      this.group.remove(child);
    }
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}

function spellColor(sourceId) {
  if (['spell:fireball', 'spell:burning-hands', 'spell:flame-strike'].includes(sourceId))
    return 0xfb923c;
  if (sourceId === 'spell:fog-cloud') return 0xcbd5e1;
  if (sourceId === 'spell:darkness') return 0xa78bfa;
  if (sourceId === 'spell:ice-storm') return 0x7dd3fc;
  return 0x86efac;
}
