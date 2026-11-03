import { openingFrame } from '../../campaigns/CampaignOpeningClimb.js';

function clearOpeningHoldVisual(token) {
  if (token.__threeMesh) delete token.__threeMesh.userData.__ttOpeningGripOffset;
  const data = this._tokenAnimationData.get(token);
  if (data) {
    delete data.openingPoseKey;
    delete data.openingHoldClip;
    delete data.gripBlending;
    delete data.gripBlendFromGround;
  }
}

function syncOpeningHoldVisual(token) {
  if (!token.openingHold || !token.__threeMesh) return false;
  const gm = this.gameManager;
  const data = this._tokenAnimationData.get(token);
  if (!data) throw new Error('The opening hold animations are not ready');
  const key = JSON.stringify([
    gm.campaignMapId,
    gm.spatial.tileWorldSize,
    token.mapId,
    token.world,
    token.openingHold.openingId,
  ]);
  if (data.openingPoseKey === key) return true;
  const connection = gm.campaignWorld
    .getConnections()
    .find((entry) => entry.id === token.openingHold.openingId);
  if (!connection) throw new Error('The held opening no longer exists');
  const frame = openingFrame(gm.campaignWorld, connection, {
    mapId: gm.campaignMapId,
    geometry: gm.terrainEngine.geometry,
  });
  const physical = gm.campaignWorld.toCampaignPosition(token.mapId, token.world);
  const atEdge =
    Math.abs(physical.y - frame.grip.y) < 1e-4 &&
    physical[frame.wide] >= frame.bounds.min[frame.wide] - 1e-6 &&
    physical[frame.wide] <= frame.bounds.max[frame.wide] + 1e-6;
  const clip = atEdge ? 'ledgeHang' : 'climbWall';
  poseGrip.call(this, token, clip, 0);
  data.openingPoseKey = key;
  return true;
}

function syncSurfaceGripVisual(
  token,
  clip = null,
  time = null,
  gripHeight = null,
  fadeSeconds = 0
) {
  if (!token.surfaceHold || !token.__threeMesh) return false;
  const data = this._tokenAnimationData.get(token);
  const key = clip || data.openingHoldClip || 'climbWall';
  const sampleTime = time ?? data.actions[key]?.time ?? 0;
  const signature = JSON.stringify([
    this.gameManager.campaignMapId,
    token.mapId,
    token.world,
    key,
    sampleTime,
    gripHeight,
    data.gripBlending ? data.actions[key]?.getEffectiveWeight() : null,
  ]);
  if (data.openingPoseKey === signature) return true;
  poseGrip.call(this, token, key, sampleTime, gripHeight, fadeSeconds);
  data.openingPoseKey = signature;
  return true;
}

function poseGrip(token, clip, time, gripHeight = null, fadeSeconds = 0) {
  const gm = this.gameManager;
  const data = this._tokenAnimationData.get(token);
  if (!data.actions[clip]) throw new Error(`The ${clip} holding animation is unavailable`);
  const mesh = token.__threeMesh;
  delete mesh.userData.__ttOpeningGripOffset;
  const point = this.getTokenViewPosition(token);
  this._applyMeshWorldPosition(mesh, point);
  if (data.current !== clip) {
    data.gripBlending = fadeSeconds > 0;
    data.gripBlendFromGround =
      fadeSeconds > 0 &&
      !['climbWall', 'climbWallDown', 'ledgeHang', 'climb'].includes(data.current);
  }
  data.openingHoldClip = clip;
  this._setAnimation(token, clip, {
    force: data.current !== clip,
    fadeIn: fadeSeconds,
    fadeOut: fadeSeconds,
  });
  data.actions[clip].time = time;
  data.actions[clip].paused = true;
  data.mixer.update(0);
  this._neutralizeRootMotion(token);
  mesh.updateMatrixWorld(true);
  const hands = new Map();
  this._rootBones.get(token)?.[0]?.bone.traverse((node) => {
    if (node.isBone && /(LeftHand|RightHand)$/.test(node.name) && !hands.has(node.name))
      hands.set(node.name, node);
  });
  if (hands.size !== 2) throw new Error('The opening hold requires a supported two-hand rig');
  const position = new gm.threeSceneManager.three.Vector3();
  const handY =
    [...hands.values()].reduce((total, bone) => total + bone.getWorldPosition(position).y, 0) /
    hands.size;
  // The saved feet proxy sits five feet below the physical grip.
  const weight = Math.max(0, Math.min(1, data.actions[clip].getEffectiveWeight()));
  mesh.userData.__ttOpeningGripOffset =
    ((gripHeight ?? point.y + gm.spatial.tileWorldSize) - handY) *
    (data.gripBlendFromGround ? weight : 1);
  if (weight >= 1) {
    delete data.gripBlending;
    delete data.gripBlendFromGround;
  }
  this._applyMeshWorldPosition(mesh, point);
  mesh.updateMatrixWorld(true);
}

export function installOpeningHoldVisualMethods(prototype) {
  prototype.clearOpeningHoldVisual = clearOpeningHoldVisual;
  prototype.syncOpeningHoldVisual = syncOpeningHoldVisual;
  prototype.syncSurfaceGripVisual = syncSurfaceGripVisual;
}
