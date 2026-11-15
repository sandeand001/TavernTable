const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { Token3DAdapter } = require('../src/scene/Token3DAdapter.js');
const { CHARACTER_DEFINITIONS } = require('../src/config/CharacterCatalog.js');
const { TOKEN_3D_MODELS } = require('../src/config/token-adapter/MannequinConfig.js');
const { getManualAction } = require('../src/config/HumanoidActionCatalog.js');

async function measureCoverPoses(root = path.resolve(__dirname, '..')) {
  const three = await import('three');
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const browser = new JSDOM('', { url: 'https://native-cover.invalid/' });
  const previous = { window: globalThis.window, document: globalThis.document };
  const urls = [];
  browser.window.URL.createObjectURL = (blob) => {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };
  globalThis.window = browser.window;
  globalThis.document = browser.window.document;
  const inputs = new Map();
  class LocalFBXLoader extends FBXLoader {
    load(url, onLoad, _progress, onError) {
      const relative = decodeURIComponent(url).replace(/^[/\\]+/, '');
      const filename = path.resolve(root, ...relative.split(/[/\\]/));
      if (!filename.startsWith(root + path.sep)) {
        onError(new Error('Native cover inputs must remain inside the project'));
        return;
      }
      void fs
        .readFile(filename)
        .then((bytes) => {
          inputs.set(
            relative.replace(/\\/g, '/'),
            createHash('sha256').update(bytes).digest('hex')
          );
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          onLoad(this.parse(buffer, path.dirname(filename) + path.sep));
        })
        .catch(onError);
    }
  }
  class CoverAdapter extends Token3DAdapter {
    _getFBXLoaderCtor() {
      return Promise.resolve(LocalFBXLoader);
    }
  }
  const metrics = {};
  const models = new Map();
  const clips = new Map();
  const sources = new Map();
  try {
    for (const { id } of CHARACTER_DEFINITIONS) {
      const token = {
        id: 'native-cover-' + id,
        type: id,
        gridX: 5,
        gridY: 4,
        facingAngle: 0,
        world: { x: 5.5, y: 0, z: 4.5 },
        movementSettings: { speed: 30, mode: 'walk', type: 'default' },
      };
      const scene = new three.Scene();
      const game = {
        cols: 12,
        rows: 8,
        placedTokens: [token],
        is3DModeActive: () => true,
        getTerrainHeight: (x) => (x >= 6 ? 4 : 0),
        threeSceneManager: { scene, three },
        spatial: {
          tileWorldSize: 1,
          elevationUnit: 0.3,
          gridToWorld: (x, y, height) => ({ x, y: height * 0.3, z: y }),
          worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
        },
      };
      const adapter = new CoverAdapter(game);
      game.token3DAdapter = adapter;
      adapter._modelCache = models;
      adapter._animationClipCache = clips;
      adapter._animationSourceCache = sources;
      try {
        const config = TOKEN_3D_MODELS[id];
        const model = await adapter._create3DToken(token, scene, {
          ...config,
          animations: { idle: config.animations.idle },
        });
        if (!model) throw new Error('Native cover model could not load: ' + id);
        await adapter.playTokenAction(token, 'action-cover');
        const sampled = adapter._tokenAnimationData.get(token).coverMetrics;
        if (
          !(sampled?.height > 0) ||
          !(sampled.back > 0) ||
          ![sampled.height, sampled.back].every(Number.isFinite)
        )
          throw new Error('Native cover measurements are invalid: ' + id);
        metrics[id] = { height: sampled.height, back: sampled.back };
      } finally {
        adapter.disposeMovementRange();
      }
    }
    const cover = getManualAction('action-cover');
    if (!inputs.has(cover.animation.path))
      throw new Error('The authored cover clip was not sampled');
    return { version: 1, inputs: Object.fromEntries([...inputs].sort()), metrics };
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
    browser.window.close();
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
    if (previous.document === undefined) delete globalThis.document;
    else globalThis.document = previous.document;
  }
}

async function main() {
  const mode = process.argv[2];
  if (!['--check', '--write'].includes(mode))
    throw new Error('Use --check or --write for deterministic native cover measurements');
  const measured = await measureCoverPoses();
  const filename = path.resolve(
    __dirname,
    '..',
    'src',
    'config',
    'token-adapter',
    'CoverMetrics.js'
  );
  const prettier = require('prettier');
  const source = await prettier.format(
    '// Generated by node tools/measure-cover-poses.js --write.\n' +
      'export const COVER_POSES = ' +
      JSON.stringify(measured, null, 2) +
      ';\n',
    { ...(await prettier.resolveConfig(filename)), filepath: filename }
  );
  if (mode === '--write') await fs.writeFile(filename, source, 'utf8');
  else if ((await fs.readFile(filename, 'utf8')) !== source)
    throw new Error('Native cover inputs or poses changed; regenerate and validate model parity');
  console.log(
    JSON.stringify({
      mode,
      models: Object.keys(measured.metrics).length,
      inputs: Object.keys(measured.inputs).length,
      metrics: measured.metrics,
    })
  );
}

if (require.main === module)
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

module.exports = { measureCoverPoses };
