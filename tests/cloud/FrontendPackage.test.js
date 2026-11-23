const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { JSDOM } = require('jsdom');
const { buildCloudFrontend, verifyCloudFrontend } = require('../../tools/cloud/build-frontend.js');
const { resolvePublicFile } = require('../../tools/public-files.js');
const { encryptProtectedAsset } = require('../../tools/cloud/protected-assets.js');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const disk = (root, relative) => path.join(root, ...relative.split('/'));
const runtime = () => ({
  version: 1,
  mode: 'cloud',
  environment: 'production',
  apiOrigin: 'https://api.example.test',
  firebase: {
    apiKey: 'public-fixture-key',
    projectId: 'frontend-fixture',
    authDomain: 'frontend-fixture.firebaseapp.com',
    appId: 'frontend-fixture-app',
  },
});

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-frontend-package-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'input');
  const write = async (relative, text) => {
    await fs.mkdir(path.dirname(disk(root, relative)), { recursive: true });
    await fs.writeFile(disk(root, relative), text);
  };
  await write(
    'index.html',
    `<html><head>
      <script id="taverntable-runtime" type="application/json">{"version":1,"mode":"local"}</script>
      <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script>
      <link rel="stylesheet" href="src/style.css">
      </head><body><main>Frontend fixture</main><script type="module" src="src/main.js"></script></body></html>`
  );
  await write(
    'src/main.js',
    "import { name } from './name.js'; import('three'); window.fixture = name;\n"
  );
  await write('src/name.js', "export const name = 'first release';\n");
  await write('src/style.css', 'body { color: black; }\n');
  await write(
    'src/core/ModelAssetCache.js',
    `const base = 'assets/terrain/3d Assets/OBJ'; export const refs = [
      \`\${base}/Fixture.obj\`,
      'Fixture.png',
      'assets/terrain/representatives/village/Wall_Plaster_Door_Flat.gltf',
      'assets/terrain/representatives/dungeon/Wall_Modular.fbx',
      'assets/terrain/representatives/dungeon/Torch.fbx',
      'assets/terrain/representatives/cave-cc0/mine-frame.glb',
      'assets/terrain/representatives/cave-cc0/stalagmite-cluster.glb',
      'assets/terrain/representatives/cave-cc0/stone-column.glb',
      'assets/terrain/representatives/chest-cc0/dungeon-chest.fbx',
      'assets/terrain/representatives/fungal/Fly_Agaric_Big.fbx',
      'assets/terrain/representatives/fungal/Purple_Mushrooms_Cluster_3.fbx'
    ];\n`
  );
  await write('src/core/ModelPostProcessing.js', "export const materialTexture = 'Fixture.png';\n");
  await write(
    'src/config/HumanoidActionCatalog.js',
    "export const action = { animation: 'Fixture' };\n"
  );
  await write(
    'src/config/CharacterCatalog.js',
    "export const model = 'assets/animated-sprites/Fixture.fbx';\n"
  );
  await write('src/config/token-adapter/CoverMetrics.js', 'export const metrics = {};\n');
  await write('src/config/PlayerDiceCatalog.js', 'export const dice = {};\n');
  await write('src/config/assets/PurePolyAssets.js', 'export const assets = [];\n');
  for (const relative of [
    'assets/animated-sprites/Fixture.fbx',
    'assets/animated-sprites/Unused.fbx',
    'assets/terrain/3d Assets/OBJ/Fixture.obj',
    'assets/terrain/3d Assets/OBJ/Unused.obj',
    'assets/terrain/3d Assets/Textures/Fixture.png',
    'assets/terrain/3d Assets/Textures/Unused.png',
    'assets/terrain/3d Assets/Tropical/textures/Fixture.png',
    'assets/terrain/3d Assets/Tropical/textures/Unused.png',
    'assets/images/construction/fixture.svg',
    'assets/Items/d20-gold.glb',
    'assets/terrain/3d Assets/Tropical/source/MZRa_Pack_M02P.fbx',
    'assets/terrain/3d Assets/License_Pro.txt',
    'assets/terrain/representatives/village/Wall_Plaster_Door_Flat.gltf',
    'assets/terrain/representatives/village/Wall_Plaster_Door_Flat.bin',
    'assets/terrain/representatives/village/T_Plaster_BaseColor.png',
    'assets/terrain/representatives/village/Wall_Plaster_Straight.gltf',
    'assets/terrain/representatives/village/Wall_Plaster_Straight.bin',
    'assets/terrain/representatives/village/Wall_Plaster_Window_Wide_Flat.gltf',
    'assets/terrain/representatives/village/Wall_Plaster_Window_Wide_Flat.bin',
    'assets/terrain/representatives/village/Wall_Plaster_Window_Thin_Round.gltf',
    'assets/terrain/representatives/village/Wall_Plaster_Window_Thin_Round.bin',
    'assets/terrain/representatives/village/Roof_RoundTiles_6x8.gltf',
    'assets/terrain/representatives/village/Roof_RoundTiles_6x8.bin',
    'assets/terrain/representatives/village/Balcony_Simple_Straight.gltf',
    'assets/terrain/representatives/village/Balcony_Simple_Straight.bin',
    'assets/terrain/representatives/village/Roof_Front_Brick6.gltf',
    'assets/terrain/representatives/village/Roof_Front_Brick6.bin',
    'assets/terrain/representatives/village/T_Brick_BaseColor.png',
    'assets/terrain/representatives/village/T_Brick_Normal.png',
    'assets/terrain/representatives/village/T_Brick_Roughness.png',
    'assets/terrain/representatives/village/T_RoundTiles_BaseColor.png',
    'assets/terrain/representatives/village/T_RoundTiles_Normal.png',
    'assets/terrain/representatives/village/T_RoundTiles_Roughness.png',
    'assets/terrain/representatives/village/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/dungeon/Wall_Modular.fbx',
    'assets/terrain/representatives/dungeon/Torch.fbx',
    'assets/terrain/representatives/dungeon/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/cave/Mine Entrance Wooden Portal.glb',
    'assets/terrain/representatives/cave/Stalagmite Cluster.glb',
    'assets/terrain/representatives/cave/Natural Rock Column.glb',
    'assets/terrain/representatives/cave/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/cave/LICENSE.txt',
    'assets/terrain/representatives/cave/AI_NOTICE.txt',
    'assets/terrain/representatives/cave/USAGE_TERMS.json',
    'assets/terrain/representatives/cave/ASSET_MANIFEST.json',
    'assets/terrain/representatives/chest/SM_Chest_Iron_M_01.glb',
    'assets/terrain/representatives/chest/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/cave-cc0/mine-frame.glb',
    'assets/terrain/representatives/cave-cc0/stalagmite-cluster.glb',
    'assets/terrain/representatives/cave-cc0/stone-column.glb',
    'assets/terrain/representatives/cave-cc0/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/cave-cc0/ASSET_MANIFEST.json',
    'assets/terrain/representatives/chest-cc0/dungeon-chest.fbx',
    'assets/terrain/representatives/chest-cc0/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/fungal/Fly_Agaric_Big.fbx',
    'assets/terrain/representatives/fungal/Purple_Mushrooms_Cluster_3.fbx',
    'assets/terrain/representatives/fungal/Forest_Pack_BaseColor.png',
    'assets/terrain/representatives/fungal/Forest_Kit_License.txt',
    'assets/terrain/representatives/fungal/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/fungal/ASSET_MANIFEST.json',
    'assets/data/SRD2014-NOTICE.txt',
    'assets/data/SRD2014-UPSTREAM-LICENSE.txt',
    'assets/Items/player-dice-set/player-dice-set.glb',
    'assets/Items/player-dice-set/NOTICE.txt',
    ...Array.from({ length: 7 }, (_, index) => index + 1).flatMap((variant) =>
      ['basecolor', 'normal', 'roughness'].map(
        (name) => `assets/Items/player-dice-set/textures/${variant}/${name}.png`
      )
    ),
  ])
    await write(relative, 'Synthetic public fixture bytes\n');
  await write('assets/FRONTEND-NOTICES.txt', 'Synthetic artwork notices\n');
  await write('assets/data/resources/NOTICES.txt', 'Synthetic catalog notices\n');
  const pack = JSON.stringify({ id: 'fixture', version: '1', ruleset: '2014', entries: [] });
  await write('assets/data/resources/fixture-1.json', pack);
  await write(
    'assets/data/resources/manifest.json',
    JSON.stringify({
      version: 1,
      packs: [
        {
          id: 'fixture',
          version: '1',
          ruleset: '2014',
          file: 'assets/data/resources/fixture-1.json',
          bytes: Buffer.byteLength(pack),
          hash: hash(pack),
          licenses: ['fixture-only'],
        },
      ],
    })
  );
  for (const relative of [
    'tools/cloud/admin-runtime.js',
    'tests/private-fixture.js',
    '.env',
    '.git/config',
    'campaigns.sqlite',
    'backup.json',
    'src/config/FirebaseConfig.json',
    'src/unreachable.js',
    'assets/data/resources/unlisted-pack.json',
    'assets/terrain/3d Assets/OBJ/private.blend',
    'assets/animated-sprites/source.zip',
  ])
    await write(relative, 'PRIVATE_SENTINEL_DO_NOT_PUBLISH');
  const out = (name) => path.join(directory, name);
  return {
    root,
    directory,
    out,
    write,
    build: (name, options = {}) =>
      buildCloudFrontend({ root, output: out(name), runtime: runtime(), ...options }),
  };
}

test('a deterministic static-only package contains only reachable code, approved runtime assets and verified catalogs', async (t) => {
  const f = await fixture(t);
  const first = await f.build('first');
  const second = await f.build('second');
  assert.deepEqual(first, second);
  assert.deepEqual(await verifyCloudFrontend(f.out('first')), first);
  assert.ok(first.files.some((file) => file.source === 'src/name.js'));
  assert.ok(first.files.some((file) => file.source.endsWith('MZRa_Pack_M02P.fbx')));
  assert.equal(first.assetSelection.candidateFiles, 47);
  assert.equal(first.assetSelection.selectedFiles, 43);
  assert.equal(first.assetSelection.excludedFiles, 4);
  assert.equal(
    first.assetSelection.candidateBytes,
    first.assetSelection.selectedBytes + first.assetSelection.excludedBytes
  );
  for (const source of [
    'assets/animated-sprites/Fixture.fbx',
    'assets/terrain/3d Assets/OBJ/Fixture.obj',
    'assets/terrain/3d Assets/Textures/Fixture.png',
    'assets/terrain/3d Assets/Tropical/textures/Fixture.png',
    'assets/terrain/representatives/village/Wall_Plaster_Door_Flat.gltf',
    'assets/terrain/representatives/village/Wall_Plaster_Door_Flat.bin',
    'assets/terrain/representatives/village/T_Plaster_BaseColor.png',
    'assets/terrain/representatives/village/Wall_Plaster_Straight.gltf',
    'assets/terrain/representatives/village/Wall_Plaster_Window_Wide_Flat.gltf',
    'assets/terrain/representatives/village/Wall_Plaster_Window_Thin_Round.gltf',
    'assets/terrain/representatives/village/Roof_RoundTiles_6x8.gltf',
    'assets/terrain/representatives/village/Balcony_Simple_Straight.gltf',
    'assets/terrain/representatives/village/Roof_Front_Brick6.gltf',
    'assets/terrain/representatives/village/T_Brick_BaseColor.png',
    'assets/terrain/representatives/village/T_RoundTiles_BaseColor.png',
    'assets/terrain/representatives/village/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/dungeon/Wall_Modular.fbx',
    'assets/terrain/representatives/dungeon/Torch.fbx',
    'assets/terrain/representatives/dungeon/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/cave-cc0/mine-frame.glb',
    'assets/terrain/representatives/cave-cc0/stalagmite-cluster.glb',
    'assets/terrain/representatives/cave-cc0/stone-column.glb',
    'assets/terrain/representatives/cave-cc0/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/cave-cc0/ASSET_MANIFEST.json',
    'assets/terrain/representatives/chest-cc0/dungeon-chest.fbx',
    'assets/terrain/representatives/chest-cc0/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/fungal/Fly_Agaric_Big.fbx',
    'assets/terrain/representatives/fungal/Purple_Mushrooms_Cluster_3.fbx',
    'assets/terrain/representatives/fungal/Forest_Pack_BaseColor.png',
    'assets/terrain/representatives/fungal/Forest_Kit_License.txt',
    'assets/terrain/representatives/fungal/SOURCE-NOTICE.txt',
    'assets/terrain/representatives/fungal/ASSET_MANIFEST.json',
  ])
    assert.ok(
      first.files.some((file) => file.source === source),
      source
    );
  for (const source of [
    'assets/animated-sprites/Unused.fbx',
    'assets/terrain/3d Assets/OBJ/Unused.obj',
    'assets/terrain/3d Assets/Textures/Unused.png',
    'assets/terrain/3d Assets/Tropical/textures/Unused.png',
    'assets/terrain/representatives/cave/Mine Entrance Wooden Portal.glb',
    'assets/terrain/representatives/cave/Stalagmite Cluster.glb',
    'assets/terrain/representatives/cave/Natural Rock Column.glb',
    'assets/terrain/representatives/chest/SM_Chest_Iron_M_01.glb',
  ])
    assert.equal(
      first.files.some((file) => file.source === source),
      false,
      source
    );
  assert.equal(first.assetProvenance.deploymentApproved, false);
  assert.match(first.assetProvenance.tropical, /formal-license-unrecorded/);
  const entry = disk(f.out('first'), `public/releases/${first.release}/index.html`);
  const dom = new JSDOM(await fs.readFile(entry, 'utf8'));
  try {
    assert.deepEqual(
      JSON.parse(dom.window.document.querySelector('#taverntable-runtime').textContent),
      runtime()
    );
    assert.equal(
      dom.window.document.querySelector('meta[name="taverntable-build"]').content,
      first.release
    );
  } finally {
    dom.window.close();
  }
  const notices = first.files.find((file) => file.source === 'assets/data/resources/NOTICES.txt');
  assert.equal(
    await fs.readFile(disk(f.out('first'), 'public/' + notices.path), 'utf8'),
    'Synthetic catalog notices\n\n\nSynthetic artwork notices\n'
  );
  const hosting = JSON.parse(await fs.readFile(path.join(f.out('first'), 'firebase.json'), 'utf8'));
  assert.equal(hosting.hosting.public, 'public');
  assert.equal(hosting.hosting.rewrites, undefined);
  assert.equal(hosting.firestore, undefined);
  assert.equal(hosting.storage, undefined);
  assert.equal(hosting.hosting.redirects[0].destination, `/releases/${first.release}/index.html`);
  const publicRoot = path.join(f.out('first'), 'public');
  for (const relative of [
    'tools/cloud/admin-runtime.js',
    'tests/private-fixture.js',
    '.env',
    '.git/config',
    'campaigns.sqlite',
    'backup.json',
    'src/config/FirebaseConfig.json',
    'src/unreachable.js',
    'assets/data/resources/unlisted-pack.json',
    'assets/terrain/3d Assets/OBJ/private.blend',
    'assets/animated-sprites/source.zip',
    'api/cloud/account',
  ]) {
    assert.ok(!first.files.some((file) => file.source === relative), relative);
    for (const pathname of ['/' + relative, `/releases/${first.release}/${relative}`])
      await assert.rejects(resolvePublicFile(publicRoot, pathname), (error) =>
        [404, 'ENOENT', 'ENOTDIR'].includes(error.status ?? error.code)
      );
  }
});

test('only referenced encrypted envelopes are published and private source folders are not served', async (t) => {
  const f = await fixture(t);
  const json = Buffer.from('{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}]} ');
  const glb = Buffer.alloc(20 + json.length);
  glb.write('glTF', 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const encrypted = encryptProtectedAsset(glb, {
    key: randomBytes(32),
    keyId: 'fixture-pack-v1',
    assetId: 'fixture-model',
  });
  await f.write('assets/protected/fixture-model.ttasset', encrypted);
  const manifestModel = encryptProtectedAsset(glb, {
    key: randomBytes(32),
    keyId: 'fixture-pack-v1',
    assetId: 'manifest-model',
  });
  await f.write('assets/protected/manifest-model.ttasset', manifestModel);
  await f.write(
    'src/config/assets/PurePolyAssets.js',
    "export const selected = 'assets/protected/manifest-model.ttasset';\n"
  );
  await f.write('assets/protected/unused.ttasset', encrypted);
  await f.write('assets/protected/plaintext.glb', 'PRIVATE_MODEL_SENTINEL');
  await f.write('assets/protected/keys.json', 'PRIVATE_KEY_SENTINEL');
  await f.write('assets/protected/fake.ttasset', 'glTF plaintext is not an envelope');
  for (const relative of [
    'assets/terrain/source-packs/example/contents/model.glb',
    'assets/animated-sprites/source-packs/source.zip',
    'assets/Items/source-packs/source.zip',
  ])
    await f.write(relative, 'PRIVATE_MODEL_SENTINEL');
  const registry = disk(f.root, 'src/core/ModelAssetCache.js');
  await fs.appendFile(
    registry,
    "\nexport const protectedModel = 'assets/protected/fixture-model.ttasset';\n"
  );

  const build = await f.build('protected');
  assert.ok(build.files.some((file) => file.source === 'assets/protected/fixture-model.ttasset'));
  assert.ok(build.files.some((file) => file.source === 'assets/protected/manifest-model.ttasset'));
  for (const source of [
    'assets/protected/unused.ttasset',
    'assets/protected/plaintext.glb',
    'assets/protected/keys.json',
    'assets/protected/fake.ttasset',
  ])
    assert.equal(
      build.files.some((file) => file.source === source),
      false,
      source
    );
  for (const pathname of [
    '/assets/protected/plaintext.glb',
    '/assets/protected/keys.json',
    '/assets/protected/fake.ttasset',
    '/assets/terrain/source-packs/example/contents/model.glb',
    '/assets\\terrain\\source-packs\\example\\contents\\model.glb',
    '/assets\\..\\.env',
    '/assets/animated-sprites/source-packs/source.zip',
    '/assets/Items/source-packs/source.zip',
    '/assets/terrain/representatives/cave/Stalagmite Cluster.glb',
    '/assets/terrain/representatives/chest/SM_Chest_Iron_M_01.glb',
  ])
    await assert.rejects(resolvePublicFile(f.root, pathname), { status: 404 });
  assert.equal(
    (await resolvePublicFile(f.root, '/assets/protected/fixture-model.ttasset')).size,
    encrypted.length
  );
  await fs.appendFile(registry, "\nexport const badModel = 'assets/protected/fake.ttasset';\n");
  await assert.rejects(f.build('bad-protected'), /protected/i);
});

test('a referenced protected model must exist before a frontend release can be built', async (t) => {
  const f = await fixture(t);
  await fs.appendFile(
    disk(f.root, 'src/core/ModelAssetCache.js'),
    "\nexport const protectedModel = 'assets/protected/missing-model.ttasset';\n"
  );
  await assert.rejects(f.build('missing-protected'), /referenced protected model.*missing/i);
});

test('one verified previous release survives an update and unsupported or corrupted packages cannot be retained', async (t) => {
  const f = await fixture(t);
  const first = await f.build('first');
  const legacy = { ...first };
  delete legacy.retiredReleases;
  delete legacy.assetSelection;
  await fs.writeFile(
    path.join(f.out('first'), 'public', 'frontend-manifest.json'),
    JSON.stringify(legacy)
  );
  await f.write('src/name.js', "export const name = 'second release';\n");
  const second = await f.build('second', { previous: f.out('first') });
  assert.notEqual(first.release, second.release);
  assert.deepEqual(second.releases, [second.release, first.release]);
  const previousFile = first.files.find((file) => file.source === 'src/name.js');
  assert.equal(
    await fs.readFile(disk(f.out('second'), 'public/' + previousFile.path), 'utf8'),
    "export const name = 'first release';\n"
  );
  const sharedAsset = second.files.find(
    (file) =>
      file.source === 'assets/animated-sprites/Fixture.fbx' &&
      file.path.startsWith(`releases/${first.release}/`)
  );
  assert.equal(
    sharedAsset.rewrite,
    `releases/${second.release}/assets/animated-sprites/Fixture.fbx`
  );
  await assert.rejects(fs.stat(disk(f.out('second'), 'public/' + sharedAsset.path)), {
    code: 'ENOENT',
  });
  assert(
    JSON.parse(
      await fs.readFile(path.join(f.out('second'), 'firebase.json'), 'utf8')
    ).hosting.rewrites.some(
      (rule) =>
        rule.source === `/releases/${first.release}/:path*` &&
        rule.destination === `/releases/${second.release}/:path`
    )
  );
  await f.write('src/name.js', "export const name = 'third release';\n");
  const third = await f.build('third', { previous: f.out('second') });
  assert.deepEqual(third.releases, [third.release, second.release]);
  assert.ok(third.files.every((file) => !file.path.startsWith(`releases/${first.release}/`)));
  const thirdHosting = JSON.parse(
    await fs.readFile(path.join(f.out('third'), 'firebase.json'), 'utf8')
  ).hosting;
  assert.deepEqual(
    thirdHosting.redirects.find((rule) => rule.source === `/releases/${first.release}/index.html`),
    {
      source: `/releases/${first.release}/index.html`,
      destination: `/releases/${third.release}/index.html`,
      type: 302,
    }
  );
  assert(
    thirdHosting.headers.some(
      (rule) =>
        rule.source === '/releases/*/index.html' &&
        rule.headers.some((header) => header.key === 'Cache-Control' && header.value === 'no-store')
    )
  );
  assert(
    !thirdHosting.redirects.some((rule) =>
      [`/releases/${third.release}/index.html`, `/releases/${second.release}/index.html`].includes(
        rule.source
      )
    )
  );
  await f.write('src/name.js', "export const name = 'fourth release';\n");
  const fourth = await f.build('fourth', { previous: f.out('third') });
  const fourthHosting = JSON.parse(
    await fs.readFile(path.join(f.out('fourth'), 'firebase.json'), 'utf8')
  ).hosting;
  for (const retired of [first.release, second.release])
    assert.deepEqual(
      fourthHosting.redirects.find((rule) => rule.source === `/releases/${retired}/index.html`),
      {
        source: `/releases/${retired}/index.html`,
        destination: `/releases/${fourth.release}/index.html`,
        type: 302,
      }
    );
  const manifestPath = path.join(f.out('second'), 'public', 'frontend-manifest.json');
  const rewritten = second.files.find((file) => file.rewrite);
  const brokenRewrite = structuredClone(second);
  brokenRewrite.files.find((file) => file.path === rewritten.path).rewrite =
    `releases/${second.release}/index.html`;
  await fs.writeFile(manifestPath, JSON.stringify(brokenRewrite));
  await assert.rejects(verifyCloudFrontend(f.out('second')), {
    code: 'invalid-frontend-package',
  });
  await fs.writeFile(manifestPath, JSON.stringify(second));
  await fs.writeFile(manifestPath, JSON.stringify({ ...second, compatibility: { runtime: 99 } }));
  await assert.rejects(f.build('bad-version', { previous: f.out('second') }), {
    code: 'invalid-frontend-package',
  });
  await fs.writeFile(manifestPath, JSON.stringify(second));
  await fs.appendFile(disk(f.out('second'), 'public/' + previousFile.path), 'corrupt');
  await assert.rejects(f.build('bad-bytes', { previous: f.out('second') }), {
    code: 'invalid-frontend-package',
  });
});

test('retired entry metadata rejects malformed history, duplicate redirects and retained-entry loops', async (t) => {
  const f = await fixture(t);
  const built = await f.build('retired-validation');
  const manifestPath = path.join(f.out('retired-validation'), 'public', 'frontend-manifest.json');
  for (const retiredReleases of [
    null,
    ['../src/config/FirebaseConfig.json'],
    [built.release],
    ['a'.repeat(64), 'a'.repeat(64)],
  ]) {
    await fs.writeFile(manifestPath, JSON.stringify({ ...built, retiredReleases }));
    await assert.rejects(verifyCloudFrontend(f.out('retired-validation')), {
      code: 'invalid-frontend-package',
    });
  }
  const invalidSelection = {
    ...built,
    assetSelection: {
      ...built.assetSelection,
      excludedFiles: built.assetSelection.excludedFiles + 1,
    },
  };
  await fs.writeFile(manifestPath, JSON.stringify(invalidSelection));
  await assert.rejects(verifyCloudFrontend(f.out('retired-validation')), {
    code: 'invalid-frontend-package',
  });
});

test('emulator/local/secret-bearing configurations and escaped or computed module imports fail without output', async (t) => {
  const f = await fixture(t);
  const settings = runtime();
  for (const [name, value] of [
    ['local', { version: 1, mode: 'local' }],
    ['emulator', { ...settings, environment: 'emulator' }],
    ['secret', { ...settings, firebase: { ...settings.firebase, privateKey: 'PRIVATE_SENTINEL' } }],
    ['insecure-api', { ...settings, apiOrigin: 'http://api.example.test' }],
  ]) {
    await assert.rejects(f.build(name, { runtime: value }));
    await assert.rejects(fs.stat(f.out(name)), { code: 'ENOENT' });
  }
  for (const [name, text] of [
    ['outside', "import '../tools/cloud/admin-runtime.js';"],
    ['config-json', "import './config/FirebaseConfig.json';"],
    ['computed', 'import(window.untrustedModule);'],
    ['unpinned', "import('https://cdn.jsdelivr.net/npm/three@latest/build/three.module.js');"],
  ]) {
    await f.write('src/main.js', text);
    await assert.rejects(f.build(name), { code: 'invalid-frontend-package' });
    await assert.rejects(fs.stat(f.out(name)), { code: 'ENOENT' });
  }
});

test('integrity failures, undeclared output and overwrites remain explicit without changing original inputs', async (t) => {
  const f = await fixture(t);
  const built = await f.build('existing');
  await assert.rejects(f.build('existing'), { code: 'invalid-frontend-package' });
  await assert.rejects(f.build('input-tree', { output: f.root }), {
    code: 'invalid-frontend-package',
  });
  await assert.rejects(f.build('input-parent', { output: f.directory }), {
    code: 'invalid-frontend-package',
  });
  await fs.writeFile(path.join(f.out('existing'), 'public', 'secret.json'), 'PRIVATE_SENTINEL');
  await assert.rejects(verifyCloudFrontend(f.out('existing')), {
    code: 'invalid-frontend-package',
  });
  await f.write('assets/data/resources/fixture-1.json', 'corrupted pack');
  await assert.rejects(f.build('bad-pack'), { code: 'invalid-frontend-package' });
  assert.equal(built.files.filter((file) => file.source === 'index.html').length, 1);
  assert.match(await fs.readFile(disk(f.root, 'index.html'), 'utf8'), /"mode":"local"/);
  assert.equal(
    await fs.readFile(disk(f.root, 'src/config/FirebaseConfig.json'), 'utf8'),
    'PRIVATE_SENTINEL_DO_NOT_PUBLISH'
  );
});

test('verification rejects local fallbacks, missing entry shells and invented deployment approval even with valid file hashes', async (t) => {
  const f = await fixture(t);
  for (const kind of ['local-fallback', 'missing-entry', 'false-approval']) {
    const manifest = await f.build(kind);
    const folder = f.out(kind);
    const index = manifest.files.find((file) => file.source === 'index.html');
    const filename = disk(folder, 'public/' + index.path);
    if (kind === 'missing-entry') {
      await fs.unlink(filename);
      manifest.files = manifest.files.filter((file) => file !== index);
    } else if (kind === 'false-approval') {
      manifest.assetProvenance = { ...manifest.assetProvenance, deploymentApproved: true };
    } else {
      const dom = new JSDOM(await fs.readFile(filename, 'utf8'));
      try {
        const local = { version: 1, mode: 'local' };
        dom.window.document.querySelector('#taverntable-runtime').textContent =
          JSON.stringify(local);
        const body = dom.serialize();
        await fs.writeFile(filename, body);
        index.bytes = Buffer.byteLength(body);
        index.sha256 = hash(body);
        manifest.runtimeDigest = hash(JSON.stringify(local));
      } finally {
        dom.window.close();
      }
    }
    await fs.writeFile(
      path.join(folder, 'public', 'frontend-manifest.json'),
      JSON.stringify(manifest)
    );
    await assert.rejects(verifyCloudFrontend(folder), { code: 'invalid-frontend-package' });
  }
});
