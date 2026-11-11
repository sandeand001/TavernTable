const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomInt, createHash } = require('node:crypto');

function geometryOnlyGLB(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2)
    throw new Error('The physical d20 requires its supported GLB asset');
  const jsonLength = buffer.readUInt32LE(12);
  const data = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
  if (data.buffers?.length !== 1 || data.buffers[0].uri)
    throw new Error('The physical d20 asset must embed its geometry');
  delete data.images;
  delete data.textures;
  delete data.materials;
  for (const mesh of data.meshes || [])
    for (const primitive of mesh.primitives) delete primitive.material;
  const json = Buffer.from(JSON.stringify(data));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const binaryOffset = 20 + jsonLength;
  const binaryLength = buffer.readUInt32LE(binaryOffset);
  const binary = buffer.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength);
  const result = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + padded.length);
  result.writeUInt32LE(0x004e4942, 24 + padded.length);
  binary.copy(result, 28 + padded.length);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}

class PhysicalDice {
  constructor({ root, random = () => randomInt(0x100000000) / 0x100000000 }) {
    this.root = root;
    this.random = random;
    this.asset = null;
  }

  async load() {
    if (!this.asset) {
      this.asset = this._load().catch((error) => {
        this.asset = null;
        throw error;
      });
    }
    return this.asset;
  }

  async _load() {
    const [three, { GLTFLoader }, state, dynamics] = await Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import(pathToFileURL(path.join(this.root, 'src', 'systems', 'dice', 'DiceState.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'systems', 'dice', 'D20Dynamics.js')).href),
    ]);
    const bytes = await fs.readFile(path.join(this.root, 'assets', 'Items', 'd20-gold.glb'));
    const loaded = await new GLTFLoader().parseAsync(geometryOnlyGLB(bytes), '');
    const model = loaded.scene;
    if (!model) throw new Error('The physical d20 asset has no model');
    model.updateMatrixWorld(true);
    const geometry = state.getD20ColliderData(model, three);
    return {
      three,
      state,
      dynamics,
      model,
      geometry,
      geometryKey: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  async d20({ metrics, groundHeights, obstacles = [] }) {
    const asset = await this.load();
    const scale = Math.min(
      asset.state.DEFAULT_SCALE,
      (Math.min(metrics.cols, metrics.rows) * metrics.tileSize * 0.4) / asset.geometry.radius
    );
    const simulation = asset.dynamics.createD20Simulation({
      geometry: asset.geometry,
      scale,
      metrics,
      groundHeights,
      obstacles,
      random: this.random,
    });
    const frames = [];
    const capture = () =>
      frames.push({
        timeSeconds: simulation.world.time,
        position: {
          x: simulation.body.position.x,
          y: simulation.body.position.y,
          z: simulation.body.position.z,
        },
        quaternion: {
          x: simulation.body.quaternion.x,
          y: simulation.body.quaternion.y,
          z: simulation.body.quaternion.z,
          w: simulation.body.quaternion.w,
        },
      });
    capture();
    while (!simulation.finished) {
      simulation.advance(asset.dynamics.D20_FIXED_STEP);
      capture();
    }
    let face = null;
    if (!simulation.cocked) {
      const model = asset.model.clone(true);
      model.position.copy(simulation.body.position);
      model.quaternion.copy(simulation.body.quaternion);
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      face = asset.state.resolveUpFacingFace(model, asset.three);
      if (!Number.isInteger(face?.value) || face.value < 1 || face.value > 20)
        throw new Error('The physical d20 has no readable settled face');
    }
    return {
      version: 1,
      type: 'physical-d20',
      geometryKey: asset.geometryKey,
      scale,
      frames,
      cocked: simulation.cocked,
      value: face?.value ?? null,
      faceIndex: face?.faceIndex ?? null,
    };
  }

  async roll(request, context) {
    const { rollDiceExpression } = await import(
      pathToFileURL(path.join(this.root, 'src', 'systems', 'dice', 'dice.js')).href
    );
    const physics = [];
    try {
      const result = await rollDiceExpression(request, {
        random: this.random,
        physicalAllD20: true,
        physicalRoll: async () => {
          const rolled = await this.d20(context);
          physics.push(rolled);
          return rolled.cocked ? { reason: 'cocked' } : { success: true, value: rolled.value };
        },
      });
      return { ...result, physics };
    } catch (error) {
      if (!physics.at(-1)?.cocked) throw error;
      return {
        expression: request.expression,
        label: request.label,
        mode: request.mode,
        physical: true,
        rerollRequired: true,
        cancelled: true,
        physics,
        text: `${request.label}: the physical d20 is cocked; reroll required. No result was selected.`,
      };
    }
  }
}

module.exports = { PhysicalDice };
