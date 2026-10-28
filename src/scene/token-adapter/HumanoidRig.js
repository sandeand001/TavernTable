const HIPS = 'mixamorigHips';
const REQUIRED_BONES = [
  HIPS,
  'mixamorigSpine',
  'mixamorigSpine1',
  'mixamorigSpine2',
  'mixamorigNeck',
  'mixamorigHead',
  ...['Left', 'Right'].flatMap((side) =>
    ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase'].map(
      (part) => `mixamorig${side}${part}`
    )
  ),
];

function cloneTransforms(source, three) {
  const node = source.isBone ? new three.Bone() : new three.Group();
  node.name = source.name;
  node.position.copy(source.position);
  node.quaternion.copy(source.quaternion);
  node.scale.copy(source.scale);
  node.matrixAutoUpdate = source.matrixAutoUpdate;
  node.matrix.copy(source.matrix);
  for (const child of source.children) node.add(cloneTransforms(child, three));
  return node;
}

export function cloneHumanoidRig(source, three) {
  if (!source?.isObject3D) throw new Error('A complete humanoid hierarchy is required');
  const root = cloneTransforms(source, three);
  const bones = new Map();
  root.traverse((node) => {
    if (!node.isBone) return;
    const driver = bones.get(node.name);
    if (!driver) {
      bones.set(node.name, node);
      return;
    }
    // FBXLoader adds same-named bind copies underneath the animation-driving bone.
    let ancestor = node.parent;
    while (ancestor && ancestor !== driver) ancestor = ancestor.parent;
    if (!ancestor) throw new Error(`Ambiguous humanoid bone: ${node.name}`);
  });
  const missing = REQUIRED_BONES.filter((name) => !bones.has(name));
  if (missing.length) {
    throw new Error(`Humanoid rig is missing required Mixamo bones: ${missing.join(', ')}`);
  }
  root.updateMatrixWorld(true);
  root.skeleton = new three.Skeleton([...bones.values()]);
  return root;
}

export function retargetHumanoidClip(clip, sourceRig, targetRig, three, skeletonUtils) {
  if (!skeletonUtils?.retargetClip) throw new Error('Humanoid retargeting is unavailable');
  if (!(clip?.duration > 0) || !clip.tracks?.length) {
    throw new Error('A non-empty humanoid animation clip is required');
  }
  const source = cloneHumanoidRig(sourceRig, three);
  const target = cloneHumanoidRig(targetRig, three);
  const sourceBones = new Map(source.skeleton.bones.map((bone) => [bone.name, bone]));
  const sourceHip = sourceBones.get(HIPS).getWorldPosition(new three.Vector3());
  const targetHip = target.skeleton.getBoneByName(HIPS).getWorldPosition(new three.Vector3());
  const scale = targetHip.y / sourceHip.y;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid humanoid hip scale');

  const names = {};
  const localOffsets = {};
  for (const bone of target.skeleton.bones) {
    const sourceBone = sourceBones.get(bone.name);
    if (!sourceBone) continue;
    names[bone.name] = sourceBone.name;
    localOffsets[bone.name] = new three.Matrix4()
      .extractRotation(sourceBone.matrixWorld)
      .invert()
      .multiply(new three.Matrix4().extractRotation(bone.matrixWorld));
  }
  const converted = skeletonUtils.retargetClip(target, source, clip, {
    names,
    localOffsets,
    hip: HIPS,
    scale,
    hipPosition: targetHip.clone().divideScalar(scale).sub(sourceHip),
    useFirstFramePosition: false,
    preserveBonePositions: true,
  });
  for (const track of converted.tracks) {
    const binding = /^\.bones\[(.+)\]\.(position|quaternion)$/.exec(track.name);
    if (!binding || !Array.from(track.values).every(Number.isFinite)) {
      throw new Error(`Invalid retargeted humanoid track: ${track.name}`);
    }
    track.name = `${binding[1]}.${binding[2]}`;
  }
  if (!converted.tracks.some((track) => track.name === `${HIPS}.position`)) {
    throw new Error('Retargeted humanoid animation has no hip position track');
  }
  if (Math.abs(converted.duration - clip.duration) > 1e-5) {
    throw new Error('Retargeting changed the authored animation duration');
  }
  return converted;
}
