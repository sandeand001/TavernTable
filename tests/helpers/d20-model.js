import { readFileSync } from 'fs';
import { join } from 'path';
import { BufferAttribute, BufferGeometry, Box3, Group, Matrix4, Mesh } from 'three';

const buffer = readFileSync(join(__dirname, '..', '..', 'assets', 'Items', 'd20-gold.glb'));
const jsonLength = buffer.readUInt32LE(12);
const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
const binaryOffset = 20 + jsonLength + 8;

function readAccessor(index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const components = accessor.type === 'VEC3' ? 3 : 1;
  const reader = {
    5123: { bytes: 2, read: (offset) => buffer.readUInt16LE(offset), Array: Uint16Array },
    5125: { bytes: 4, read: (offset) => buffer.readUInt32LE(offset), Array: Uint32Array },
    5126: { bytes: 4, read: (offset) => buffer.readFloatLE(offset), Array: Float32Array },
  }[accessor.componentType];
  if (!reader) throw new Error(`Unsupported d20 accessor type ${accessor.componentType}`);
  const values = new reader.Array(accessor.count * components);
  const start = binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || components * reader.bytes;
  for (let i = 0; i < accessor.count; i += 1) {
    for (let component = 0; component < components; component += 1) {
      values[i * components + component] = reader.read(
        start + i * stride + component * reader.bytes
      );
    }
  }
  return new BufferAttribute(values, components);
}

export function loadD20Model() {
  const buildNode = (index) => {
    const node = gltf.nodes[index];
    let object;
    if (node.mesh != null) {
      const primitive = gltf.meshes[node.mesh].primitives[0];
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', readAccessor(primitive.attributes.POSITION));
      geometry.setIndex(readAccessor(primitive.indices));
      object = new Mesh(geometry);
    } else {
      object = new Group();
    }
    object.name = node.name || '';
    if (node.matrix) {
      object.applyMatrix4(new Matrix4().fromArray(node.matrix));
    } else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    for (const child of node.children || []) object.add(buildNode(child));
    return object;
  };
  const root = new Group();
  for (const node of gltf.scenes[gltf.scene || 0].nodes) root.add(buildNode(node));
  root.userData.groundLiftBase = -new Box3().setFromObject(root).min.y;
  return root;
}
