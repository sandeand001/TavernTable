import {
  ensureAuthoritativeBlueprint,
  cloneDice,
  applyCriticalRollTint,
} from './DiceModelManager.js';
import { FACE_INDEX_TO_NUMBER, resolveUpFacingFace } from './DiceState.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const point = (value, fields) =>
  object(value) && fields.every((field) => Number.isFinite(value[field]));
const invalid = () => {
  throw new Error('The host supplied an invalid physical dice replay');
};

export function validateAuthoritativeRoll(roll) {
  if (
    !object(roll) ||
    typeof roll.mapId !== 'string' ||
    !roll.mapId ||
    typeof roll.expression !== 'string' ||
    typeof roll.label !== 'string' ||
    typeof roll.text !== 'string' ||
    !['normal', 'advantage', 'disadvantage'].includes(roll.mode)
  )
    invalid();
  const expression = roll.expression.toLowerCase().replace(/\s+/g, '');
  let physicalCount = [...expression.matchAll(/(?:^|[+-])(\d*)d20(?=[+-]|$)/g)].reduce(
    (count, match) => count + Number(match[1] || 1),
    0
  );
  if (roll.mode !== 'normal') physicalCount *= 2;
  const physics = roll.physics || [];
  if (
    !Array.isArray(physics) ||
    physics.length > 100 ||
    (physicalCount > 0 && (roll.physical !== true || !physics.length)) ||
    (roll.rerollRequired ? physics.length > physicalCount : physics.length !== physicalCount)
  )
    invalid();
  if (roll.rerollRequired) {
    if (
      roll.cancelled !== true ||
      Object.hasOwn(roll, 'total') ||
      Object.hasOwn(roll, 'summary') ||
      !physics.at(-1)?.cocked
    )
      invalid();
  } else if (!Number.isFinite(roll.total) || !Array.isArray(roll.values)) invalid();
  for (const die of physics) {
    if (
      !object(die) ||
      die.version !== 1 ||
      die.type !== 'physical-d20' ||
      !/^[a-f0-9]{64}$/.test(die.geometryKey) ||
      !(Number.isFinite(die.scale) && die.scale > 0) ||
      typeof die.cocked !== 'boolean' ||
      !Array.isArray(die.frames) ||
      die.frames.length < 2 ||
      die.frames.length > 15000 ||
      (die.cocked
        ? die.value !== null || die.faceIndex !== null
        : !Number.isInteger(die.value) || FACE_INDEX_TO_NUMBER[die.faceIndex] !== die.value)
    )
      invalid();
    let previousTime = -1;
    for (const frame of die.frames) {
      if (
        !object(frame) ||
        !Number.isFinite(frame.timeSeconds) ||
        frame.timeSeconds < 0 ||
        frame.timeSeconds <= previousTime ||
        !point(frame.position, ['x', 'y', 'z']) ||
        !point(frame.quaternion, ['x', 'y', 'z', 'w']) ||
        Math.abs(
          Math.hypot(
            frame.quaternion.x,
            frame.quaternion.y,
            frame.quaternion.z,
            frame.quaternion.w
          ) - 1
        ) > 0.0001
      )
        invalid();
      previousTime = frame.timeSeconds;
    }
    if (die.frames[0].timeSeconds !== 0) invalid();
  }
  return roll;
}

export default class AuthoritativeDiceReplay {
  constructor({ gameManager }) {
    this.gameManager = gameManager;
    this.generation = 0;
    this.seen = new Set();
  }

  preload(geometryKey) {
    return ensureAuthoritativeBlueprint(geometryKey);
  }

  async play(input, { commandId }) {
    validateAuthoritativeRoll(input);
    if (this.seen.has(commandId)) return { completed: false, reason: 'duplicate' };
    if (this.destroyed) throw new Error('The physical dice presentation is closed');
    this.cancel();
    const generation = this.generation;
    const roll = JSON.parse(JSON.stringify(input));
    if (!roll.physics?.length) return { completed: true };
    const gm = this.gameManager;
    const world = gm.campaignWorld;
    const sourceMap = world.getMap(roll.mapId);
    const viewMap = world.getMap(gm.campaignMapId);
    if (!world.sharesLocation(roll.mapId, gm.campaignMapId))
      throw new Error('The physical dice roll is outside the authorized location');
    const three = gm.threeSceneManager.three;
    const roots = await Promise.all(
      roll.physics.map((die) => ensureAuthoritativeBlueprint(die.geometryKey))
    );
    if (this.destroyed || generation !== this.generation)
      return { completed: false, reason: 'presentation-replaced' };
    const group = new three.Group();
    group.name = 'authoritative-dice-roll';
    group.userData.commandId = commandId;
    const yaw = new three.Quaternion().setFromAxisAngle(
      new three.Vector3(0, 1, 0),
      ((viewMap.quarterTurns - sourceMap.quarterTurns) * Math.PI) / 2
    );
    const scale = viewMap.grid.tileWorldSize / sourceMap.grid.tileWorldSize;
    const dice = roll.physics.map((descriptor, index) => {
      const mesh = cloneDice(roots[index]);
      mesh.scale.setScalar(descriptor.scale * scale);
      group.add(mesh);
      return { mesh, descriptor, index: 0 };
    });
    this.group = group;
    gm.threeSceneManager.scene.add(group);
    this.seen.add(commandId);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
    let resolve;
    let reject;
    const done = new Promise((accepted, failed) => {
      resolve = accepted;
      reject = failed;
    });
    this.job = { dice, elapsed: 0, roll, yaw, resolve, reject };
    this.advance(0);
    let lastTime = performance.now();
    this.frame = () => {
      const now = performance.now();
      try {
        this.advance(Math.max(0, (now - lastTime) / 1000));
      } catch (error) {
        this._finish(error);
        GameErrors.rendering(error, { component: 'AuthoritativeDiceReplay', operation: 'frame' });
      }
      lastTime = now;
    };
    if (typeof gm.threeSceneManager.addAnimationCallback !== 'function') {
      this._finish(new Error('The native physical dice animation loop is unavailable'));
    } else gm.threeSceneManager.addAnimationCallback(this.frame);
    return done;
  }

  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error('Physical dice replay time is invalid');
    const job = this.job;
    if (!job) return;
    job.elapsed += seconds;
    const gm = this.gameManager;
    const three = gm.threeSceneManager.three;
    let settled = true;
    for (const die of job.dice) {
      const frames = die.descriptor.frames;
      while (die.index < frames.length - 1 && frames[die.index + 1].timeSeconds <= job.elapsed)
        die.index++;
      const from = frames[die.index];
      const to = frames[Math.min(die.index + 1, frames.length - 1)];
      const fraction =
        from === to ? 0 : (job.elapsed - from.timeSeconds) / (to.timeSeconds - from.timeSeconds);
      const position = new three.Vector3(from.position.x, from.position.y, from.position.z).lerp(
        new three.Vector3(to.position.x, to.position.y, to.position.z),
        fraction
      );
      const projected =
        job.roll.mapId === gm.campaignMapId
          ? position
          : gm.campaignWorld.toMapPosition(
              gm.campaignMapId,
              gm.campaignWorld.toCampaignPosition(job.roll.mapId, position)
            );
      die.mesh.position.set(projected.x, projected.y, projected.z);
      die.mesh.quaternion
        .set(from.quaternion.x, from.quaternion.y, from.quaternion.z, from.quaternion.w)
        .slerp(
          new three.Quaternion(to.quaternion.x, to.quaternion.y, to.quaternion.z, to.quaternion.w),
          fraction
        )
        .premultiply(job.yaw);
      die.mesh.updateMatrixWorld(true);
      if (die.index !== frames.length - 1) settled = false;
      else if (!die.descriptor.cocked) {
        const face = resolveUpFacingFace(die.mesh, three);
        if (face?.value !== die.descriptor.value || face.faceIndex !== die.descriptor.faceIndex)
          throw new Error('The visible physical die does not match the host-settled face');
        applyCriticalRollTint(die.mesh, die.descriptor.value);
      }
    }
    if (settled) this._finish();
  }

  _finish(error = null, reason = null) {
    const job = this.job;
    this.job = null;
    if (this.frame) this.gameManager.threeSceneManager.removeAnimationCallback(this.frame);
    this.frame = null;
    if (!job) return;
    if (error) job.reject(error);
    else job.resolve(reason ? { completed: false, reason } : { completed: true });
  }

  cancel() {
    this.generation++;
    this._finish(null, 'presentation-replaced');
    if (!this.group) return;
    this.group.removeFromParent();
    this.group.traverse((node) => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        material?.dispose();
    });
    this.group = null;
  }

  destroy() {
    this.destroyed = true;
    this.cancel();
  }
}
