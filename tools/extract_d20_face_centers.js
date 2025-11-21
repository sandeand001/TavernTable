/*
 * Generates precomputed centroids for each D20 face based on the embossed numerals.
 * The output feeds the dice highlight logic so the glow sits over the printed number.
 */

const fs = require('fs');
const path = require('path');

const ROOT_ITEMS_DIR = path.resolve('assets', 'Items');
const D20_MODEL_FILENAME = 'd20-gold.glb';
const OUTPUT_PATH = path.resolve('src', 'systems', 'dice', 'd20FaceCenters.generated.js');

const COMPONENT_INFO = {
  5120: { Constructor: Int8Array, bytes: 1 },
  5121: { Constructor: Uint8Array, bytes: 1 },
  5122: { Constructor: Int16Array, bytes: 2 },
  5123: { Constructor: Uint16Array, bytes: 2 },
  5125: { Constructor: Uint32Array, bytes: 4 },
  5126: { Constructor: Float32Array, bytes: 4 },
};

const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

const D20_NUMBER_TO_FACE_INDEX = {
  1: 712,
  2: 695,
  3: 188,
  4: 604,
  5: 615,
  6: 179,
  7: 709,
  8: 238,
  9: 2093,
  10: 270,
  11: 476,
  12: 697,
  13: 717,
  14: 699,
  15: 3623,
  16: 229,
  17: 280,
  18: 638,
  19: 254,
  20: 265,
};

function readGLB(buffer) {
  const magic = buffer.toString('utf8', 0, 4);
  if (magic !== 'glTF') {
    throw new Error(`Unexpected magic ${magic}`);
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) {
    throw new Error(`Unsupported glTF version ${version}`);
  }
  const length = buffer.readUInt32LE(8);
  if (length !== buffer.length) {
    throw new Error(`Length mismatch: header=${length} actual=${buffer.length}`);
  }
  let offset = 12;
  const chunks = [];
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const chunkBuffer = buffer.slice(dataStart, dataEnd);
    chunks.push({ chunkType, data: chunkBuffer });
    offset = dataEnd;
  }
  const JSON_TYPE = 0x4e4f534a;
  const BIN_TYPE = 0x004e4942;
  const jsonChunk = chunks.find((chunk) => chunk.chunkType === JSON_TYPE);
  const binChunk = chunks.find((chunk) => chunk.chunkType === BIN_TYPE);
  if (!jsonChunk) throw new Error('No JSON chunk found');
  const jsonText = jsonChunk.data.toString('utf8');
  const json = JSON.parse(jsonText);
  return { json, binary: binChunk?.data || null };
}

function getAccessorArray(glb, accessorIndex) {
  const accessor = glb.json.accessors?.[accessorIndex];
  if (!accessor) return null;
  const info = COMPONENT_INFO[accessor.componentType];
  if (!info) return null;
  const componentCount = TYPE_COMPONENTS[accessor.type];
  if (!componentCount) return null;
  const view = glb.json.bufferViews?.[accessor.bufferView];
  if (!view) return null;
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const byteLength = (accessor.count || 0) * componentCount * info.bytes;
  const slice = glb.binary.subarray(byteOffset, byteOffset + byteLength);
  const array = new info.Constructor(slice.buffer, slice.byteOffset, slice.byteLength / info.bytes);
  return { array, accessor, componentCount };
}

function vec(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

function clone(v) {
  return { x: v.x, y: v.y, z: v.z };
}

function add(a, b) {
  a.x += b.x;
  a.y += b.y;
  a.z += b.z;
  return a;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(v) {
  return Math.sqrt(dot(v, v));
}

function normalize(v) {
  const len = length(v);
  if (len === 0) return vec(0, 0, 0);
  return scale(v, 1 / len);
}

function centroid(a, b, c) {
  return vec((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
}

function gatherTriangles(glb, mesh) {
  if (!mesh?.primitives?.length) return [];
  const prim = mesh.primitives[0];
  const indexInfo = getAccessorArray(glb, prim.indices);
  const positionInfo = getAccessorArray(glb, prim.attributes.POSITION);
  if (!positionInfo) return [];
  const indices = indexInfo?.array;
  const positions = positionInfo.array;
  const stride = positionInfo.componentCount;
  const triangles = [];
  const indexArray = indices || positions.map((_, i) => i);
  const triCount = indices ? indices.length : positions.length / stride;
  const fetchVertex = (idx) => {
    const base = idx * stride;
    return vec(positions[base], positions[base + 1], positions[base + 2]);
  };
  for (let i = 0; i < triCount; i += 3) {
    const i0 = indices ? indexArray[i] : i;
    const i1 = indices ? indexArray[i + 1] : i + 1;
    const i2 = indices ? indexArray[i + 2] : i + 2;
    const v0 = fetchVertex(i0);
    const v1 = fetchVertex(i1);
    const v2 = fetchVertex(i2);
    const ab = sub(v1, v0);
    const ac = sub(v2, v0);
    const normalRaw = cross(ab, ac);
    const area = length(normalRaw) * 0.5;
    const normal = normalize(normalRaw);
    const center = centroid(v0, v1, v2);
    const plane = dot(normal, center);
    triangles.push({
      index: i,
      indices: [i0, i1, i2],
      v0,
      v1,
      v2,
      normal,
      plane,
      centroid: center,
      area,
    });
  }
  return triangles;
}

function buildFaceGroups(baseTriangles) {
  const keyScale = 1000;
  const map = new Map();
  const groups = [];
  for (let i = 0; i < baseTriangles.length; i += 1) {
    const tri = baseTriangles[i];
    const key = [
      Math.round(tri.normal.x * keyScale),
      Math.round(tri.normal.y * keyScale),
      Math.round(tri.normal.z * keyScale),
      Math.round(tri.plane * keyScale),
    ].join(':');
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        normal: normalize(clone(tri.normal)),
        plane: tri.plane,
        indices: [],
        baseArea: 0,
        baseSum: vec(0, 0, 0),
        letterArea: 0,
        letterSum: vec(0, 0, 0),
      };
      map.set(key, group);
      groups.push(group);
    }
    group.indices.push(i);
    const area = tri.area > 0 ? tri.area : 1e-6;
    group.baseArea += area;
    add(group.baseSum, scale(tri.centroid, area));
  }
  return groups;
}

function assignLettersToGroups(letterTriangles, groups) {
  const distanceTolerance = 0.015;
  const minDot = 0.7;
  for (const tri of letterTriangles) {
    if (!tri || !(tri.area > 0)) continue;
    let bestGroup = null;
    let bestScore = -Infinity;
    for (const group of groups) {
      const dotScore = dot(tri.normal, group.normal);
      if (dotScore < minDot) continue;
      const planeDistance = Math.abs(dot(group.normal, tri.centroid) - group.plane);
      if (planeDistance > distanceTolerance) continue;
      const score = dotScore - planeDistance * 25;
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }
    if (!bestGroup) continue;
    const projected = (() => {
      const centroidDot = dot(bestGroup.normal, tri.centroid);
      const delta = centroidDot - bestGroup.plane;
      return {
        x: tri.centroid.x - bestGroup.normal.x * delta,
        y: tri.centroid.y - bestGroup.normal.y * delta,
        z: tri.centroid.z - bestGroup.normal.z * delta,
      };
    })();
    const area = tri.area > 0 ? tri.area : 1e-6;
    bestGroup.letterArea += area;
    add(bestGroup.letterSum, scale(projected, area));
  }
}

function computeGroupCenters(groups) {
  return groups.map((group) => {
    let center = null;
    if (group.letterArea > 0.00001) {
      center = scale(group.letterSum, 1 / group.letterArea);
    } else if (group.baseArea > 0.00001) {
      center = scale(group.baseSum, 1 / group.baseArea);
    } else {
      center = vec(0, 0, 0);
    }
    return {
      key: group.key,
      normal: group.normal,
      plane: group.plane,
      indices: group.indices.slice(),
      center,
    };
  });
}

function main() {
  const modelPath = path.join(ROOT_ITEMS_DIR, D20_MODEL_FILENAME);
  const buffer = fs.readFileSync(modelPath);
  const glb = readGLB(buffer);
  if (!glb.binary) {
    throw new Error('GLB missing binary chunk');
  }
  const meshes = glb.json.meshes || [];
  const baseMesh = meshes[0];
  const letterMesh = meshes[1];
  if (!baseMesh || !letterMesh) {
    throw new Error('Unexpected GLB structure: missing base or letter mesh');
  }

  const baseTriangles = gatherTriangles(glb, baseMesh);
  const letterTriangles = gatherTriangles(glb, letterMesh);
  const groups = buildFaceGroups(baseTriangles);
  const baseCount = baseTriangles.length;
  assignLettersToGroups(letterTriangles, groups);
  const groupCenters = computeGroupCenters(groups);

  const faceIndexToCenter = {};
  const indexToGroup = new Map();
  groupCenters.forEach((group) => {
    for (const idx of group.indices) {
      indexToGroup.set(idx, group);
    }
  });

  const missing = [];
  Object.entries(D20_NUMBER_TO_FACE_INDEX).forEach(([valueString, faceIndexRaw]) => {
    const faceIndex = Number(faceIndexRaw);
    const value = Number(valueString);
    let group = indexToGroup.get(faceIndex) || null;
    if (!group) {
      let tri = baseTriangles[faceIndex];
      if (!tri && faceIndex >= baseCount) {
        const letterIdx = faceIndex - baseCount;
        if (letterIdx >= 0 && letterIdx < letterTriangles.length) {
          tri = letterTriangles[letterIdx];
        }
      }
      if (tri) {
        let best = null;
        let bestScore = -Infinity;
        for (const candidate of groupCenters) {
          const dotScore = Math.abs(dot(tri.normal, candidate.normal));
          const planeDistance = Math.abs(dot(candidate.normal, tri.centroid) - candidate.plane);
          const score = dotScore - planeDistance * 25;
          if (score > bestScore) {
            bestScore = score;
            best = candidate;
          }
        }
        if (best) {
          group = best;
          indexToGroup.set(faceIndex, group);
        }
      }
    }
    if (!group) {
      missing.push({ value, faceIndex });
      return;
    }
    const center = group.center;
    faceIndexToCenter[faceIndex] = [
      Number(center.x.toFixed(6)),
      Number(center.y.toFixed(6)),
      Number(center.z.toFixed(6)),
    ];
    if (Number.isFinite(value)) {
      faceIndexToCenter[value] = faceIndexToCenter[faceIndex];
    }
  });

  const sortedEntries = Object.entries(faceIndexToCenter)
    .filter(([key]) => !Number.isNaN(Number(key)))
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  if (missing.length) {
    const summary = missing.map((entry) => `${entry.value}->${entry.faceIndex}`).join(', ');
    console.warn(`Missing face centers for: ${summary}`);
  }

  const lines = [
    '// Auto-generated by tools/extract_d20_face_centers.js',
    '// Do not edit manually.',
    'export const D20_FACE_CENTERS = {',
    ...sortedEntries.map(([key, value]) => `  ${key}: [${value.join(', ')}],`),
    '};',
    '',
    'export default D20_FACE_CENTERS;',
    '',
  ];

  const content = `${lines.join('\n')}`;

  fs.writeFileSync(OUTPUT_PATH, content, 'utf8');
  console.log(`Wrote ${sortedEntries.length} face center entries to ${OUTPUT_PATH}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
