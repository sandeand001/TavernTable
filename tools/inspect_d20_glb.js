const fs = require('fs');
const path = require('path');

const rootDir = path.resolve('assets', 'Items');
const target = path.join(rootDir, 'd20-gold.glb');

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
  const JSON_TYPE = 0x4e4f534a; // 'JSON'
  const BIN_TYPE = 0x004e4942; // 'BIN\0'
  const jsonChunk = chunks.find((chunk) => chunk.chunkType === JSON_TYPE);
  const binChunk = chunks.find((chunk) => chunk.chunkType === BIN_TYPE);
  if (!jsonChunk) throw new Error('No JSON chunk found');
  const jsonText = jsonChunk.data.toString('utf8');
  const json = JSON.parse(jsonText);
  return { json, binary: binChunk?.data || null };
}

function formatNode(nodeIndex, nodes, indent = 0) {
  const node = nodes[nodeIndex];
  const prefix = ' '.repeat(indent * 2);
  const name = node.name || `Node_${nodeIndex}`;
  const meshInfo = node.mesh != null ? ` mesh=${node.mesh}` : '';
  const extras = node.extras ? ` extras=${JSON.stringify(node.extras)}` : '';
  console.log(`${prefix}- [${nodeIndex}] ${name}${meshInfo}${extras}`);
  if (Array.isArray(node.children)) {
    node.children.forEach((childIndex) => formatNode(childIndex, nodes, indent + 1));
  }
}

function getAccessorArray({ json, binary }, accessorIndex) {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) return null;
  const info = COMPONENT_INFO[accessor.componentType];
  if (!info) return null;
  const componentCount = TYPE_COMPONENTS[accessor.type];
  if (!componentCount) return null;
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) return null;
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const byteLength = (accessor.count || 0) * componentCount * info.bytes;
  const slice = binary.subarray(byteOffset, byteOffset + byteLength);
  const array = new info.Constructor(slice.buffer, slice.byteOffset, slice.byteLength / info.bytes);
  return { array, accessor, componentCount };
}

function analyzeLetters(glb) {
  const mesh = glb.json.meshes?.[1];
  if (!mesh?.primitives?.length) return;
  const primitive = mesh.primitives[0];
  const indicesInfo = getAccessorArray(glb, primitive.indices);
  const positionInfo = getAccessorArray(glb, primitive.attributes.POSITION);
  const colorInfo = getAccessorArray(glb, primitive.attributes.COLOR_0);
  if (!indicesInfo || !positionInfo) return;
  const indices = indicesInfo.array;
  const positions = positionInfo.array;
  const colors = colorInfo?.array || null;
  const posStride = positionInfo.componentCount;
  const colorStride = colorInfo?.componentCount || 0;
  const groups = new Map();
  const centroid = [0, 0, 0];
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];
    const ax = positions[i0 * posStride];
    const ay = positions[i0 * posStride + 1];
    const az = positions[i0 * posStride + 2];
    const bx = positions[i1 * posStride];
    const by = positions[i1 * posStride + 1];
    const bz = positions[i1 * posStride + 2];
    const cx = positions[i2 * posStride];
    const cy = positions[i2 * posStride + 1];
    const cz = positions[i2 * posStride + 2];
    centroid[0] = (ax + bx + cx) / 3;
    centroid[1] = (ay + by + cy) / 3;
    centroid[2] = (az + bz + cz) / 3;
    let key = 'no-color';
    if (colors) {
      const r = colors[i0 * colorStride]?.toFixed(3);
      const g = colors[i0 * colorStride + 1]?.toFixed(3);
      const b = colors[i0 * colorStride + 2]?.toFixed(3);
      key = `${r}_${g}_${b}`;
    }
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { count: 0, maxY: -Infinity, minY: Infinity };
      groups.set(key, bucket);
    }
    bucket.count += 1;
    bucket.maxY = Math.max(bucket.maxY, centroid[1]);
    bucket.minY = Math.min(bucket.minY, centroid[1]);
  }
  console.log('Letter color buckets:', groups.size);
  Array.from(groups.entries())
    .sort((a, b) => b[1].maxY - a[1].maxY)
    .slice(0, 10)
    .forEach(([key, stats]) => {
      console.log(
        `  ${key}: count=${stats.count} maxY=${stats.maxY.toFixed(3)} minY=${stats.minY.toFixed(3)}`
      );
    });
}

function main() {
  const buffer = fs.readFileSync(target);
  const glb = readGLB(buffer);
  const { json } = glb;
  const nodes = json.nodes || [];
  const scenes = json.scenes || [];
  console.log(`Nodes: ${nodes.length}`);
  scenes.forEach((scene, sceneIndex) => {
    console.log(`Scene ${sceneIndex}: ${scene.name || '(unnamed)'}`);
    (scene.nodes || []).forEach((nodeIndex) => formatNode(nodeIndex, nodes, 1));
  });
  const meshes = json.meshes || [];
  meshes.slice(0, 40).forEach((mesh, idx) => {
    const name = mesh.name || `Mesh_${idx}`;
    const primitiveCount = Array.isArray(mesh.primitives) ? mesh.primitives.length : 0;
    console.log(`Mesh[${idx}] ${name} primitives=${primitiveCount}`);
    if (Array.isArray(mesh.primitives)) {
      mesh.primitives.forEach((primitive, primIdx) => {
        const attribs = Object.keys(primitive.attributes || {});
        console.log(
          `  primitive[${primIdx}] mode=${primitive.mode} material=${primitive.material} attributes=${attribs.join(',')}`
        );
        if (primitive.indices != null) {
          console.log(`    indices accessor=${primitive.indices}`);
        }
        if (primitive.extras) {
          console.log(`    extras=${JSON.stringify(primitive.extras)}`);
        }
      });
    }
  });
  analyzeLetters(glb);
}

main();
