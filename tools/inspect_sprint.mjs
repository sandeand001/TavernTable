import fs from 'fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

globalThis.THREE = THREE;

const toArrayBuffer = (buffer) =>
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const loadFbx = (path) => {
    const data = fs.readFileSync(path);
    const loader = new FBXLoader();
    return loader.parse(toArrayBuffer(data), path);
};

const summarizeClip = (clip, label) => {
    if (!clip) {
        console.log(`${label}: <no clip>`);
        return;
    }
    console.log(`${label}: duration=${clip.duration.toFixed(3)}s tracks=${clip.tracks.length}`);
    const sampleNames = clip.tracks.slice(0, 10).map((track) => track.name);
    console.log(`  sample tracks:`, sampleNames);
};

const basePath =
    'c:/Users/Andre/OneDrive/Desktop/Code/Taverntable/Taverntable/assets/animated-sprites';
const standing = loadFbx(`${basePath}/Standing Idle.fbx`);
const sprint = loadFbx(`${basePath}/Sprint.fbx`);
const running = loadFbx(`${basePath}/running.fbx`);

summarizeClip(standing.animations?.[0], 'Standing Idle');
summarizeClip(sprint.animations?.[0], 'Sprint');
summarizeClip(running.animations?.[0], 'Running');
console.log(
    'Sprint clips:',
    sprint.animations?.map((clip) => ({
        name: clip.name,
        duration: clip.duration,
        tracks: clip.tracks.length,
    }))
);

const findFirstSkinnedMesh = (root) => {
    if (!root) return null;
    if (root.isSkinnedMesh) return root;
    for (const child of root.children || []) {
        const result = findFirstSkinnedMesh(child);
        if (result) return result;
    }
    return null;
};

const standingSkinned = findFirstSkinnedMesh(standing);
const sprintSkinned = findFirstSkinnedMesh(sprint);

if (standingSkinned && sprintSkinned) {
    const retargeted = SkeletonUtils.retargetClip(
        SkeletonUtils.clone ? SkeletonUtils.clone(standingSkinned) : standingSkinned.clone(true),
        SkeletonUtils.clone ? SkeletonUtils.clone(sprintSkinned) : sprintSkinned.clone(true),
        sprint.animations?.[0],
        { useFirstFramePosition: true }
    );
    summarizeClip(retargeted, 'Retargeted Sprint');
    const trackSet = new Set(retargeted?.tracks?.map((track) => track.name));
    console.log('Contains Hips quaternion:', trackSet.has('.bones[mixamorig:Hips].quaternion'));
}
