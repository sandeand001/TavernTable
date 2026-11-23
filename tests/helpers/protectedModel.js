function syntheticGlb(json = {}) {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4));
  const uvs = Buffer.alloc(24);
  [0, 0, 1, 0, 0, 1].forEach((value, index) => uvs.writeFloatLE(value, index * 4));
  const binary = Buffer.concat([positions, uvs]);
  const text = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      ],
      bufferViews: [
        { buffer: 0, byteLength: positions.length },
        { buffer: 0, byteOffset: positions.length, byteLength: uvs.length },
      ],
      buffers: [{ byteLength: binary.length }],
      ...json,
    })
  );
  const padded = Math.ceil(text.length / 4) * 4;
  const result = Buffer.alloc(20 + padded + 8 + binary.length, 0x20);
  result.write('glTF', 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  text.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + padded);
  result.writeUInt32LE(0x004e4942, 24 + padded);
  binary.copy(result, 28 + padded);
  return result;
}

module.exports = { syntheticGlb };
