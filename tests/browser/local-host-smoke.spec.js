const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createCanvas } = require('canvas');
const { test, expect } = require('@playwright/test');
const { encryptProtectedAsset } = require('../../tools/cloud/protected-assets.js');
const { syntheticGlb } = require('../helpers/protectedModel.js');
const { PURE_POLY_ASSETS } = require('../../src/config/assets/PurePolyAssets.js');

const root = path.resolve(__dirname, '..', '..');
let child;
let dataDirectory;
let hostURL;
let hostKey;
let stopping;

function stopHost() {
  if (stopping) return stopping;
  stopping = (async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timeout);
  })();
  return stopping;
}

async function submitBiomeReview(page, submit, { cancel = false, skipWarning = false } = {}) {
  await submit.click();
  const warning = page.getByRole('dialog', { name: 'Replace this map?' });
  await expect(warning).toContainText(/replace.*terrain.*scenery/i);
  if (skipWarning) await warning.getByLabel("Don't show me this again").check();
  await warning.getByRole('button', { name: cancel ? 'Cancel' : 'Replace map' }).click();
}

test.beforeAll(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-browser-smoke-'));
  child = spawn(
    process.execPath,
    [path.join(root, 'tools', 'local-host.js'), '--port', '0', '--data-dir', dataDirectory],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TAVERNTABLE_PROTECTED_ASSET_KEYS_FILE: undefined },
    }
  );
  let errors = '';
  child.stderr.on('data', (chunk) => (errors = (errors + chunk).slice(-4000)));
  hostURL = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Local host timed out: ${errors}`)), 15000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Local host exited ${code}: ${errors}`));
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const line = output.split('\n').find((entry) => entry.startsWith('TavernTable host ready '));
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line.slice('TavernTable host ready '.length)).url);
    });
  });
  hostKey = (await fs.readFile(path.join(dataDirectory, 'host-access-key'), 'utf8')).trim();
});

test.afterAll(async () => {
  await stopHost();
  if (dataDirectory) await fs.rm(dataDirectory, { recursive: true, force: true });
});

test('browser WebCrypto renders protected models for owner and player providers and rejects tampering', async ({
  page,
}) => {
  const key = randomBytes(32);
  const canvas = createCanvas(2, 2);
  const context = canvas.getContext('2d');
  context.fillStyle = '#e14d3a';
  context.fillRect(0, 0, 2, 2);
  const model = syntheticGlb({
    images: [{ uri: `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}` }],
    textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
  });
  const encrypted = encryptProtectedAsset(model, {
    key,
    keyId: 'fixture-pack-v1',
    assetId: 'fixture-model',
  });
  let tampered = false;
  const downloads = [];
  await page.route('**/assets/protected/fixture-model.ttasset', async (route) => {
    downloads.push(route.request().url());
    const body = Buffer.from(encrypted);
    if (tampered) body[body.length - 1] ^= 1;
    await route.fulfill({ status: 200, contentType: 'application/octet-stream', body });
  });
  await page.goto(hostURL);
  const rendered = await page.evaluate(async (keyValue) => {
    const { default: ModelAssetCache } = await import('/src/core/ModelAssetCache.js');
    const three = await import('three');
    const result = [];
    for (const role of ['owner', 'member']) {
      const cache = new ModelAssetCache();
      cache.setThree(three);
      cache._registry['fixture-model'] = {
        path: 'assets/protected/fixture-model.ttasset',
        format: 'GLB',
        protectedKeyId: 'fixture-pack-v1',
      };
      cache.setProtectedAssetKeyProvider(async () => keyValue);
      const model = await cache.getModel('fixture-model');
      await cache.whenModelReady('fixture-model');
      let textured = false;
      model.traverse((node) => {
        if (node.isMesh && node.material?.map?.image) textured = true;
      });
      const scene = new three.Scene();
      scene.add(model, new three.AmbientLight(0xffffff, 3));
      const camera = new three.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0.5, 4);
      camera.lookAt(0, 0.5, 0);
      const renderer = new three.WebGLRenderer();
      renderer.setSize(64, 64);
      renderer.render(scene, camera);
      result.push({ role, triangles: renderer.info.render.triangles, textured });
      renderer.dispose();
    }
    return result;
  }, key.toString('base64'));
  expect(rendered).toEqual([
    { role: 'owner', triangles: 1, textured: true },
    { role: 'member', triangles: 1, textured: true },
  ]);
  tampered = true;
  const failure = await page.evaluate(async (keyValue) => {
    const { default: ModelAssetCache } = await import('/src/core/ModelAssetCache.js');
    const three = await import('three');
    const cache = new ModelAssetCache();
    cache.setThree(three);
    cache._registry['fixture-model'] = {
      path: 'assets/protected/fixture-model.ttasset',
      format: 'GLB',
      protectedKeyId: 'fixture-pack-v1',
    };
    cache.setProtectedAssetKeyProvider(async () => keyValue);
    try {
      await cache.getModel('fixture-model');
      return null;
    } catch (error) {
      return error.message;
    }
  }, key.toString('base64'));
  expect(failure).toMatch(/integrity/i);
  expect(downloads).toHaveLength(3);
});

test('protected biome scenery is selected, rendered and reopened for host and player', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-protected-biomes-'));
  const key = randomBytes(32);
  const keyring = path.join(directory, 'keys.json');
  await fs.writeFile(
    keyring,
    JSON.stringify({ version: 1, keys: { 'pure-poly-v1': key.toString('base64') } })
  );
  const data = path.join(directory, 'data');
  const protectedHost = spawn(
    process.execPath,
    [path.join(root, 'tools', 'local-host.js'), '--port', '0', '--data-dir', data],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TAVERNTABLE_PROTECTED_ASSET_KEYS_FILE: keyring },
    }
  );
  let errors = '';
  protectedHost.stderr.on('data', (chunk) => (errors = (errors + chunk).slice(-4000)));
  const ready = new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Protected host timed out: ${errors}`)), 15000);
    protectedHost.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    protectedHost.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Protected host exited ${code}: ${errors}`));
    });
    protectedHost.stdout.on('data', (chunk) => {
      output += chunk;
      const line = output.split('\n').find((entry) => entry.startsWith('TavernTable host ready '));
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line.slice('TavernTable host ready '.length)).url);
    });
  });
  const host = { url: null, hostKeyFile: path.join(data, 'host-access-key') };
  let playerContext;
  const canvas = createCanvas(2, 2);
  const paint = canvas.getContext('2d');
  paint.fillStyle = '#777777';
  paint.fillRect(0, 0, 2, 2);
  const model = syntheticGlb({
    images: [{ uri: `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}` }],
    textures: [{ source: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
  });
  const envelopes = new Map(
    PURE_POLY_ASSETS.map(({ id }) => [
      id,
      encryptProtectedAsset(model, { key, keyId: 'pure-poly-v1', assetId: id }),
    ])
  );
  const intercept = (route) => {
    const filename = new URL(route.request().url()).pathname.split('/').pop();
    const envelope = envelopes.get(filename.replace(/\.ttasset$/, ''));
    if (!envelope) return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: envelope });
  };
  try {
    host.url = await ready;
    await page.route('**/assets/protected/*.ttasset', intercept);
    await page.goto(host.url);
    const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
    await login
      .getByLabel('Host access key')
      .fill((await fs.readFile(host.hostKeyFile, 'utf8')).trim());
    await login.getByRole('button', { name: 'Sign in as host' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
    await picker.getByLabel('Campaign name', { exact: true }).fill('Protected biome fixture');
    await picker.getByLabel('Campaign ruleset').selectOption('2014');
    await picker.getByRole('button', { name: 'Create & open campaign' }).click();
    await page.waitForFunction(
      () =>
        window.gameManager?.sceneAutosave?.ready &&
        !window.gameManager.sceneAutosave.dirty &&
        !window.gameManager.sceneAutosave.writing
    );
    await page.getByRole('tab', { name: /Biomes/ }).click();
    await page.getByRole('button', { name: /Underground/ }).click();
    await page.evaluate(() => window.gameManager.terrainEngine.setBiomeSeed(42));
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Underground' });
    await review.locator('[name="variant"]').selectOption('cavern');
    await expect(review.locator('[name="assetPack"]')).toHaveValue('pure-poly');
    await submitBiomeReview(page, review.locator('button[type="submit"]'));
    await expect(page.locator('#biome-generation-status')).toContainText('Generated Cavern');
    const generated = await page.evaluate(async () => {
      const gm = window.gameManager;
      await gm.placeableMeshPool.whenSettled();
      await gm.sceneAutosave.flush();
      const entries = (await gm.placeableMeshPool.snapshotPlacements()).filter(({ modelKey }) =>
        modelKey?.startsWith('pure-poly-')
      );
      return {
        entries,
        recipe: gm.terrainEngine.generationRecipe,
        torches: (await gm.placeableMeshPool.snapshotPlacements()).filter(({ modelKey }) =>
          /torch|lantern/i.test(modelKey || '')
        ),
      };
    });
    expect(generated.entries.length).toBeGreaterThan(0);
    expect(new Set(generated.entries.map(({ modelKey }) => modelKey)).size).toBeGreaterThan(1);
    expect(generated.recipe.values.assetPack).toBe('pure-poly');
    expect(generated.torches).toEqual([]);
    const invite = await page.evaluate(async () => {
      const gm = window.gameManager;
      const library = gm.characterServices.library;
      const id = await library.create('Protected explorer');
      await library.flush();
      const { placeSavedCharacter } = await import('/src/campaigns/SavedCharacterPlacement.js');
      const { token } = await placeSavedCharacter(gm, id, 12, 12, { appearance: 'mannequin' });
      await token.__threeMeshPromise;
      await gm.sceneAutosave.flush();
      const invitation = await library.store.sessionCall('createInvite', [
        gm.campaign.id,
        { name: 'Protected player' },
      ]);
      await library.store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
      return invitation.invite;
    });
    playerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await playerContext.route('**/assets/protected/*.ttasset', intercept);
    const player = await playerContext.newPage();
    await player.goto(`${host.url}/player.html#invite=${encodeURIComponent(invite)}`);
    await player.waitForFunction(() =>
      [...(window.gameManager?.placeableMeshPool?._metadata?.values() || [])].some((entries) =>
        [...entries.values()].some(({ source }) => source?.modelKey?.startsWith('pure-poly-'))
      )
    );
    await expect(player.getByRole('dialog', { name: 'Opening campaign' })).toBeHidden();
    await player.evaluate(() => window.gameManager.placeableMeshPool.whenSettled());
    const rendered = await player.evaluate(() =>
      [...window.gameManager.placeableMeshPool._groups.values()]
        .filter(({ instancedMesh }) => instancedMesh.name.includes('pure-poly-'))
        .every(({ instancedMesh }) =>
          (Array.isArray(instancedMesh.material)
            ? instancedMesh.material
            : [instancedMesh.material]
          ).every((material) => Boolean(material.map?.image))
        )
    );
    expect(rendered).toBe(true);
    await playerContext.close();
    playerContext = null;
    await page.reload();
    await page
      .getByRole('dialog', { name: 'Choose your campaign' })
      .locator('article', { hasText: 'Protected biome fixture' })
      .getByRole('button', { name: 'Open', exact: true })
      .click();
    await page.waitForFunction(
      () =>
        window.gameManager?.sceneAutosave?.ready &&
        window.gameManager?.terrainEngine?.generationRecipe?.values?.assetPack === 'pure-poly'
    );
    expect(
      await page.evaluate(async () =>
        (await window.gameManager.placeableMeshPool.snapshotPlacements()).some(({ modelKey }) =>
          modelKey?.startsWith('pure-poly-')
        )
      )
    ).toBe(true);
  } finally {
    await playerContext?.close();
    await page.unroute('**/assets/protected/*.ttasset', intercept);
    if (protectedHost.exitCode === null && protectedHost.signalCode === null) {
      const exited = new Promise((resolve) => protectedHost.once('exit', resolve));
      protectedHost.kill('SIGTERM');
      const timeout = setTimeout(() => protectedHost.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timeout);
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('unavailable protected scenery cannot replace an existing map', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker
    .getByLabel('Campaign name', { exact: true })
    .fill('Protected access failure fixture');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.getByRole('tab', { name: /Biomes/ }).click();
  await page.getByRole('button', { name: /Underground/ }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Underground' });
  await expect(review.locator('[name="assetPack"] option[value="pure-poly"]')).toBeDisabled();
  await review.getByRole('button', { name: 'Cancel' }).click();
  await page.evaluate(() => {
    window.gameManager.modelAssetCache.setProtectedAssetKeyProvider(async () => {
      throw new Error('Configured key service is unavailable');
    });
  });
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const failedReview = page.getByRole('dialog', { name: 'Underground' });
  await expect(failedReview.locator('[data-field="assetPack"] small')).toContainText(
    'Configured key service is unavailable'
  );
  await expect(failedReview.locator('[name="assetPack"]')).toHaveValue('standard');
  await expect(failedReview.locator('[name="assetPack"] option[value="pure-poly"]')).toBeDisabled();
  await failedReview.getByRole('button', { name: 'Cancel' }).click();
  const result = await page.evaluate(async () => {
    const gm = window.gameManager;
    gm.modelAssetCache.setProtectedAssetKeyProvider(null);
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(gm, { biomeKey: 'cavern', seed: 42 }, { cols: 25, rows: 25 });
    await gm.sceneAutosave.flush();
    const snapshot = async () =>
      JSON.stringify({
        terrain: gm.terrainEngine.save(),
        placements: await gm.placeableMeshPool.snapshotPlacements(),
      });
    const before = await snapshot();
    let message = '';
    try {
      await replaceCampaignBiome(
        gm,
        { biomeKey: 'cavern', seed: 42, assetPack: 'pure-poly' },
        { cols: 25, rows: 25 }
      );
    } catch (error) {
      message = error.message;
    }
    return { before, after: await snapshot(), message };
  });
  expect(result.message).toMatch(/protected.*(?:account|access)/i);
  expect(result.after).toBe(result.before);
});

test('the real local host creates, renders and reopens a campaign', async ({ page }) => {
  const failedRepresentativeResponses = [];
  await page.route('**/api/campaigns', async (route) => {
    if (route.request().postDataJSON()?.operation === 'commitScene')
      await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  page.on('response', (response) => {
    if (
      response.status() >= 400 &&
      response.url().includes('/assets/terrain/representatives/village/')
    )
      failedRepresentativeResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();

  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await expect(picker).toBeVisible();
  const campaignName = 'Playwright host smoke';
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();

  await page.waitForFunction(() => {
    const manager = window.gameManager;
    const canvas = manager?.threeSceneManager?.renderer?.domElement;
    return (
      manager?.is3DModeActive?.() === true &&
      manager.campaign?.name === 'Playwright host smoke' &&
      manager.threeSceneManager?.scene?.visible === true &&
      canvas instanceof HTMLCanvasElement &&
      canvas.width > 0 &&
      canvas.height > 0
    );
  });
  const graphics = await page.evaluate(
    () => window.gameManager.threeSceneManager.getRenderStats().graphics
  );
  expect(graphics.mode).toMatch(/hardware|software/);
  await expect(page.getByRole('dialog', { name: 'Opening campaign' })).toBeHidden();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.evaluate(async () => {
    const { generateCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await generateCampaignBiome(window.gameManager, {
      biomeKey: 'town',
      structures: true,
      seed: 2434673465,
    });
  });
  await page.waitForFunction(
    () =>
      window.gameManager.threeSceneManager.scene.getObjectByName('ConstructionAssets')?.userData
        .replacements.length > 1
  );
  const town = await page.evaluate(() => {
    const gm = window.gameManager;
    const { scene, three } = gm.threeSceneManager;
    const assets = scene.getObjectByName('ConstructionAssets');
    const unit = gm.spatial.tileWorldSize / 5;
    const roofEnds = [];
    let threeSidedBalconies = 0;
    for (const spec of gm.terrainEngine.geometry.getStructures()) {
      const modules = assets.children.filter((child) => child.userData.structureId === spec.id);
      const roof = modules.find((child) => child.name.endsWith(':source-medieval-roof'));
      if (roof) {
        const box = new three.Box3().setFromObject(roof, true);
        const axis = Math.abs(Math.cos(spec.angleRadians)) > 0.5 ? 'x' : 'z';
        const gables = modules.filter((child) =>
          child.name.endsWith(':source-medieval-roof-front')
        );
        let framed = 0;
        let inside = 0;
        for (const gable of gables) {
          gable.traverse((node) => {
            if (node.isMesh && node.material?.name === 'MI_WoodTrim') framed++;
          });
          const end = new three.Box3().setFromObject(gable, true);
          if (
            end.min[axis] >= box.min[axis] + 0.65 * unit &&
            end.max[axis] <= box.max[axis] - 0.65 * unit
          )
            inside++;
        }
        roofEnds.push({ framed, inside });
      }
      const rails = modules.filter((child) => child.name.includes(':source-medieval-balcony-'));
      if (rails.length === 3) threeSidedBalconies++;
    }
    return {
      roofEnds,
      threeSidedBalconies,
      instanced: assets.children.some((child) => child.isInstancedMesh),
    };
  });
  expect(town.roofEnds.length).toBeGreaterThan(1);
  for (const ends of town.roofEnds) expect(ends).toEqual({ framed: 2, inside: 2 });
  expect(town.threeSidedBalconies).toBe(1);
  expect(town.instanced).toBe(true);
  expect(failedRepresentativeResponses).toEqual([]);

  await page.reload();
  const reopenedPicker = page.getByRole('dialog', { name: 'Choose your campaign' });
  const campaign = reopenedPicker.locator('article', { hasText: campaignName });
  await expect(campaign).toBeVisible();
  await campaign.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.campaign?.name === 'Playwright host smoke' &&
      window.gameManager?.threeSceneManager?.scene?.visible === true
  );
});

test('biome selection remains a draft until generation or palette application', async ({
  page,
}) => {
  const campaignName = 'Playwright biome draft';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.evaluate(async () => {
    const gm = window.gameManager;
    const { generateCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await generateCampaignBiome(gm, {
      biomeKey: 'grassland',
      seed: 42,
      roughness: 1.35,
      densityMultiplier: 0,
      structures: false,
    });
    await gm.placeableMeshPool.whenSettled();
    await gm.sceneAutosave.flush();
  });
  const before = await page.evaluate(() => window.gameManager.terrainEngine.save());
  await page.getByRole('tab', { name: /biomes/i }).click();
  const forest = page.locator('[data-biome-family="forest"]');
  await forest.click();
  await expect(forest).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.gameManager.terrainEngine.save())).toEqual(before);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const review = page.locator('[data-biome-generation-review]');
  await expect(review.locator('h2')).toHaveText('Forest');
  await review.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => window.gameManager.terrainEngine.save())).toEqual(before);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await submitBiomeReview(
    page,
    page.locator('[data-biome-generation-review] button[type="submit"]'),
    {
      cancel: true,
    }
  );
  expect(await page.evaluate(() => window.gameManager.terrainEngine.save())).toEqual(before);

  const persistedBefore = JSON.parse(JSON.stringify(before));
  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.campaign?.name === 'Playwright biome draft'
  );
  expect(await page.evaluate(() => window.gameManager.terrainEngine.save())).toEqual(
    persistedBefore
  );
  await page.getByRole('tab', { name: /biomes/i }).click();
  await page.locator('[data-biome-family="forest"]').click();
  await page.getByRole('button', { name: 'Apply palette only' }).click();
  const applied = await page.evaluate(() => window.gameManager.terrainEngine.save());
  expect(applied.biomeKey).toBe('forestTemperate');
  expect(applied.heights).toEqual(persistedBefore.heights);
});

test('planned forest scenery renders and survives campaign reopening', async ({ page }) => {
  const campaignName = 'Playwright planned forest';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const result = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { generateCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    const { readPlaceablePlacements } = await import('/src/scene/SceneSnapshotReaders.js');
    const { prepareBiomePlacements } = await import('/src/scene/terrain/PrepareBiomePlacements.js');
    const { planCampaignBiomeReplacement } = await import('/src/campaigns/CampaignBiomePlan.js');
    const options = { biomeKey: 'forestTemperate', seed: 42, structures: false };
    const plan = gm.terrainEngine.planBiomeGeneration(options.biomeKey, options);
    const liveCount = gm.placeableMeshPool.getStats().instances;
    const staged = await prepareBiomePlacements(gm, plan);
    const replacement = await planCampaignBiomeReplacement(gm, options, { cols: 25, rows: 25 });
    const afterPreparation = gm.placeableMeshPool.getStats().instances;
    await generateCampaignBiome(gm, options);
    await gm.placeableMeshPool.whenSettled();
    const saved = readPlaceablePlacements(gm.placeableMeshPool);
    await gm.sceneAutosave.flush();
    return {
      planned: plan.placements,
      staged: staged.placements,
      replacement: replacement.scenery.placements,
      saved,
      liveCount,
      afterPreparation,
    };
  });
  expect(result.planned.length).toBeGreaterThan(0);
  expect(result.saved.length).toBeGreaterThan(0);
  expect(result.afterPreparation).toBe(result.liveCount);
  const expected = new Set(
    result.planned.map(({ placeableId, gridX, gridY }) => `${placeableId}:${gridX}:${gridY}`)
  );
  for (const { placeableId, gridX, gridY } of result.saved)
    expect(expected.has(`${placeableId}:${gridX}:${gridY}`)).toBe(true);

  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.campaign?.name === 'Playwright planned forest'
  );
  const restored = await page.evaluate(async () => {
    const { readPlaceablePlacements } = await import('/src/scene/SceneSnapshotReaders.js');
    await window.gameManager.placeableMeshPool.whenSettled();
    return readPlaceablePlacements(window.gameManager.placeableMeshPool);
  });
  const sorted = (placements) =>
    [...placements].sort(
      (a, b) =>
        a.gridY - b.gridY ||
        a.gridX - b.gridX ||
        a.placeableId.localeCompare(b.placeableId) ||
        a.modelKey.localeCompare(b.modelKey)
    );
  expect(sorted(result.saved)).toEqual(sorted(result.staged));
  expect(sorted(result.replacement)).toEqual(sorted(result.staged));
  expect(sorted(restored)).toEqual(sorted(JSON.parse(JSON.stringify(result.saved))));
});

for (const { biomeKey, family, hasWater } of [
  { biomeKey: 'coast', family: 'Water & Coast', hasWater: true },
  { biomeKey: 'riverLake', family: 'Water & Coast', hasWater: true },
  { biomeKey: 'floodplain', family: 'Wetland', hasWater: true },
  { biomeKey: 'mangrove', family: 'Wetland', hasWater: true },
  { biomeKey: 'deadForest', family: 'Forest', hasWater: false },
  { biomeKey: 'ashWastes', family: 'Volcanic', hasWater: false },
  { biomeKey: 'wasteland', family: 'Wasteland & Ruins', hasWater: false },
  { biomeKey: 'graveyard', family: 'Wasteland & Ruins', hasWater: false },
]) {
  test(`${biomeKey} generation keeps land and scenery after reopening`, async ({ page }) => {
    const campaignName = `Playwright ${biomeKey} terrain`;
    await page.goto(hostURL);
    const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
    await login.getByLabel('Host access key').fill(hostKey);
    await login.getByRole('button', { name: 'Sign in as host' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
    await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
    await picker.getByLabel('Campaign ruleset').selectOption('2014');
    await picker.getByRole('button', { name: 'Create & open campaign' }).click();
    await page.waitForFunction(
      () =>
        window.gameManager?.sceneAutosave?.ready &&
        !window.gameManager.sceneAutosave.dirty &&
        !window.gameManager.sceneAutosave.writing
    );
    await page.getByRole('tab', { name: /Biomes/ }).click();
    await page.getByRole('button', { name: new RegExp(family) }).click();
    await page.locator('#biome-structures-toggle').uncheck();
    await page.evaluate(() => window.gameManager.terrainEngine.setBiomeSeed(42));
    await page.locator('label[for="biome-seed-lock"]').click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const review = page.getByRole('dialog', { name: family });
    await review.locator('[name="variant"]').selectOption(biomeKey);
    await review.getByLabel('Asset density').selectOption('dense');
    await submitBiomeReview(page, review.locator('button[type="submit"]'));
    await expect(page.locator('#biome-generation-status')).toContainText('Generated');
    const saved = await page.evaluate(async () => {
      const gm = window.gameManager;
      await gm.placeableMeshPool.whenSettled();
      await gm.sceneAutosave.flush();
      return {
        terrain: gm.terrainEngine.save(),
        placements: await gm.placeableMeshPool.snapshotPlacements(),
      };
    });
    const heights = saved.terrain.heights.flat();
    expect(saved.terrain.biomeKey).toBe(biomeKey);
    if (hasWater) {
      expect(heights.filter((height) => height < 0).length).toBeGreaterThan(30);
      expect(heights.filter((height) => height > 0).length).toBeGreaterThan(30);
    } else {
      expect(heights.filter((height) => height >= 0).length).toBeGreaterThan(30);
    }
    expect(saved.placements.length).toBeGreaterThan(0);

    await page.reload();
    const reopened = page
      .getByRole('dialog', { name: 'Choose your campaign' })
      .locator('article', { hasText: campaignName });
    await reopened.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForFunction(
      (name) =>
        window.gameManager?.sceneAutosave?.ready && window.gameManager?.campaign?.name === name,
      campaignName
    );
    const restored = await page.evaluate(async () => {
      const gm = window.gameManager;
      await gm.placeableMeshPool.whenSettled();
      return {
        terrain: gm.terrainEngine.save(),
        placements: await gm.placeableMeshPool.snapshotPlacements(),
      };
    });
    expect(restored.terrain).toEqual(saved.terrain);
    const sorted = (placements) =>
      [...placements].sort(
        (a, b) =>
          a.gridY - b.gridY ||
          a.gridX - b.gridX ||
          a.placeableId.localeCompare(b.placeableId) ||
          a.modelKey.localeCompare(b.modelKey)
      );
    expect(sorted(restored.placements)).toEqual(sorted(saved.placements));

    await page.getByRole('tab', { name: /Biomes/ }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const reopenedReview = page.getByRole('dialog', { name: family });
    if (family === 'Water & Coast') {
      await reopenedReview.locator('[name="variant"]').selectOption('ocean');
      await expect(reopenedReview.locator('[data-field="density"]')).toBeHidden();
    }
    await reopenedReview.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => window.gameManager.terrainEngine.save())).toEqual(
      saved.terrain
    );
  });
}

test('a staged Dungeon replacement resizes and survives a hosted campaign reopening', async ({
  page,
}) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright replacement';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const before = await page.evaluate(() => window.gameManager.terrainEngine.save());
  const staged = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { planCampaignBiomeReplacement } = await import('/src/campaigns/CampaignBiomePlan.js');
    const plan = await planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    );
    return {
      terrain: gm.terrainEngine.save(),
      target: plan.scene.maps.find((map) => map.id === plan.scene.view.mapId).grid,
    };
  });
  expect(staged.terrain).toEqual(before);
  expect(staged.target).toMatchObject({ cols: 15, rows: 12 });
  await page.evaluate(async () => {
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      window.gameManager,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    );
  });
  await page.waitForFunction(() =>
    window.gameManager.threeSceneManager.scene
      .getObjectByName('ConstructionAssets')
      ?.userData.replacements.some(({ modelKey }) => modelKey === 'source-dungeon-wall')
  );
  const generated = await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    return { cols: gm.cols, rows: gm.rows, terrain: gm.terrainEngine.save() };
  });
  expect([generated.cols, generated.rows]).toEqual([15, 12]);
  expect(generated.terrain.biomeKey).toBe('dungeon');

  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.campaign?.name === 'Playwright replacement' &&
      window.gameManager?.terrainEngine?.biomeKey === 'dungeon' &&
      window.gameManager?.sceneAutosave?.ready
  );
  const restored = await page.evaluate(() => ({
    cols: window.gameManager.cols,
    rows: window.gameManager.rows,
    terrain: window.gameManager.terrainEngine.save(),
  }));
  expect([restored.cols, restored.rows]).toEqual([15, 12]);
  expect(restored.terrain.geometry).toEqual(generated.terrain.geometry);
});

test('a failed hosted replacement restores the prior scene and undo history', async ({ page }) => {
  const campaignName = 'Playwright replacement rollback';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const result = await page.evaluate(async () => {
    const gm = window.gameManager;
    const library = gm.characterServices.library;
    const { captureCampaignScene } = await import('/src/campaigns/SceneWorld.js');
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    gm.terrainEngine.setHeightAt(2, 2, 3);
    await gm.sceneAutosave.flush();
    const before = await captureCampaignScene(gm, library);
    const save = library.saveScene;
    library.saveScene = async () => {
      throw Object.assign(new Error('Injected storage failure'), { status: 400 });
    };
    let message;
    try {
      await replaceCampaignBiome(
        gm,
        { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
        { cols: 15, rows: 12 }
      );
    } catch (error) {
      message = error.message;
    } finally {
      library.saveScene = save;
    }
    const after = await captureCampaignScene(gm, library);
    const canUndo = gm.terrainEngine.canUndo;
    const undid = gm.terrainEngine.undo();
    return {
      message,
      before,
      after,
      canUndo,
      undid,
      height: gm.terrainEngine.getHeightAt(2, 2),
      frozen: !!gm.campaignMapFailure,
    };
  });
  expect(result.message).toMatch(/injected storage failure/i);
  expect(result.after).toEqual(result.before);
  expect(result.canUndo && result.undid).toBe(true);
  expect(result.height).toBe(0);
  expect(result.frozen).toBe(false);
});

test('settlement generation honors the selected grid rather than expanding it', async ({
  page,
}) => {
  const campaignName = 'Playwright exact settlement size';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.getByRole('tab', { name: /Biomes/ }).click();
  await page.getByRole('button', { name: /Settlement/ }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Settlement' });
  await review.getByLabel('Grid width (squares)').fill('25');
  await review.getByLabel('Grid height (squares)').fill('25');
  await expect(review.locator('[name="footprint"]')).toHaveCount(0);
  await submitBiomeReview(page, review.locator('button[type="submit"]'));
  await expect(page.locator('#biome-generation-status')).toContainText('25 x 25');
  await page.waitForFunction(
    () =>
      window.gameManager.threeSceneManager.scene.getObjectByName('ConstructionAssets')?.userData
        .replacements.length > 0
  );
  const result = await page.evaluate(() => ({
    cols: window.gameManager.cols,
    rows: window.gameManager.rows,
    biome: window.gameManager.terrainEngine.biomeKey,
  }));
  expect(result).toEqual({ cols: 25, rows: 25, biome: 'town' });
  const floor = await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    const saved = gm.campaignWorld.save();
    const target = saved.maps.find((map) => map.building?.floor === 0);
    const { changeCampaignView } = await import('/src/campaigns/SceneWorld.js');
    await changeCampaignView(gm, { mapId: target.id });
    return {
      id: target.id,
      cols: target.grid.cols,
      rows: target.grid.rows,
      parent: saved.maps.find((map) => map.id === target.building.ownerMapId),
      connections: saved.connections,
    };
  });
  await page.getByRole('button', { name: /Underground/ }).click();
  await page.locator('#biome-structures-toggle').uncheck();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const floorReview = page.getByRole('dialog', { name: 'Underground' });
  await floorReview.locator('[name="variant"]').selectOption('dungeon');
  await floorReview.getByLabel('Grid width (squares)').fill(String(floor.cols + 2));
  await floorReview.getByLabel('Grid height (squares)').fill(String(floor.rows + 2));
  await submitBiomeReview(page, floorReview.locator('button[type="submit"]'));
  await expect(page.locator('#biome-generation-status')).toContainText(
    `${floor.cols + 2} x ${floor.rows + 2}`
  );
  const resizedFloor = await page.evaluate(async ({ id, parent }) => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    return {
      mapId: gm.campaignMapId,
      cols: gm.cols,
      rows: gm.rows,
      parent: gm.campaignWorld.getMap(parent.id),
      connections: gm.campaignWorld.getConnections(),
      floor: gm.campaignWorld.getMap(id),
    };
  }, floor);
  expect([resizedFloor.mapId, resizedFloor.cols, resizedFloor.rows]).toEqual([
    floor.id,
    floor.cols + 2,
    floor.rows + 2,
  ]);
  expect(resizedFloor.parent).toEqual(floor.parent);
  expect(resizedFloor.connections).toEqual(floor.connections);
  expect(resizedFloor.floor.terrain.biome).toBe('dungeon');
  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    (id) => window.gameManager?.sceneAutosave?.ready && window.gameManager.campaignMapId === id,
    floor.id
  );
  expect(await page.evaluate(() => [window.gameManager.cols, window.gameManager.rows])).toEqual([
    floor.cols + 2,
    floor.rows + 2,
  ]);
});

test('a missing Village texture rejects generation without clearing the existing map', async ({
  page,
}) => {
  const campaignName = 'Playwright missing Village texture';
  await page.route('**/T_Plaster_BaseColor.png', (route) => route.abort());
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const before = await page.evaluate(() => window.gameManager.terrainEngine.save());
  await page.getByRole('tab', { name: /Biomes/ }).click();
  await page.getByRole('button', { name: /Settlement/ }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Settlement' });
  await submitBiomeReview(page, review.locator('button[type="submit"]'));
  await expect(page.locator('#biome-generation-status')).toContainText('Cannot generate');
  await expect(page.locator('#biome-generation-status')).toContainText('texture');
  expect(await page.evaluate(() => window.gameManager.terrainEngine.save())).toEqual(before);
  await page.unroute('**/T_Plaster_BaseColor.png');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const retryReview = page.getByRole('dialog', { name: 'Settlement' });
  await submitBiomeReview(page, retryReview.locator('button[type="submit"]'));
  await expect(page.locator('#biome-generation-status')).toContainText('Generated Village');
});

test('cavern generation creates blank linked maps that a player can traverse', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright logical chambers';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.getByRole('tab', { name: /Biomes/ }).click();
  await page.getByRole('button', { name: /Underground/ }).click();
  await page.evaluate(() => window.gameManager.terrainEngine.setBiomeSeed(42));
  await page.locator('label[for="biome-seed-lock"]').click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Underground' });
  await review.locator('[name="variant"]').selectOption('cavern');
  await review.locator('[name="entrances"]').selectOption('4');
  await review.locator('[name="density"]').selectOption('sparse');
  await review.locator('[name="totalChambers"]').fill('3');
  await review.locator('[name="outsideSide"][value="north"]').check();
  await review.locator('[name="outsideSide"][value="east"]').check();
  await review.locator('[name="outsideMode"]').selectOption('shared');
  await submitBiomeReview(page, review.locator('button[type="submit"]'));
  await expect(page.locator('#biome-generation-status')).toContainText('Generated Cavern');
  await page.waitForFunction(
    () =>
      window.gameManager?.threeSceneManager?.scene.getObjectByName('LogicalPassageMarkers')
        ?.children.length === 4
  );
  const network = await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    const scene = gm.campaignWorld.save();
    const passage = scene.logicalPassages.find((entry) => entry.kind === 'chamber');
    const source = passage.ends.find((end) => end.mapId === gm.campaignMapId);
    const target = passage.ends.find((end) => end.mapId !== gm.campaignMapId);
    const { logicalPassageEndpoint } =
      await import('/src/campaigns/CampaignLogicalPassageTravel.js');
    const entrance = logicalPassageEndpoint(gm.campaignWorld.getMap(gm.campaignMapId), source.side);
    const offset = {
      north: [0, 1],
      east: [-1, 0],
      south: [0, -1],
      west: [1, 0],
    }[source.side];
    return {
      scene,
      source,
      target,
      passageId: passage.id,
      actorCell: { x: entrance.gridX + offset[0], y: entrance.gridY + offset[1] },
    };
  });
  expect(network.scene.maps).toHaveLength(4);
  expect(network.scene.connections).toEqual([]);
  expect(network.scene.logicalPassages.filter((entry) => entry.kind === 'chamber')).toHaveLength(2);
  expect(network.scene.logicalPassages.filter((entry) => entry.kind === 'outside')).toHaveLength(2);
  expect(
    network.scene.maps
      .filter((map) => map.id !== network.source.mapId)
      .every(
        (map) =>
          map.terrain.biome === null && map.terrain.heights.flat().every((height) => height === 0)
      )
  ).toBe(true);

  await page.locator('.campaign-map-controls summary').click();
  await page.getByRole('button', { name: 'Open location overview' }).click();
  const overview = page.getByRole('dialog', { name: 'DM location overview' });
  await expect(overview).toBeVisible();
  await expect(overview.locator('[data-overview-map]')).toHaveCount(3);
  await expect(overview.locator('[data-overview-connection]')).toHaveCount(4);
  await expect(overview.locator('.overview-map-rock')).toHaveCount(1);
  await overview.getByRole('button', { name: 'Close location overview' }).click();
  await page.locator('.campaign-map-controls summary').click();

  const characterId = await page.evaluate(async () => {
    const library = window.gameManager.characterServices.library;
    const id = await library.create('Cavern explorer');
    await library.flush();
    return id;
  });
  await expect(page.getByLabel('Shared session status')).toContainText('up to date');
  await page.evaluate(
    async ({ characterId, cell }) => {
      const gm = window.gameManager;
      const library = gm.characterServices.library;
      const creature = gm.tokenManager.createCreatureByType('mannequin');
      gm.tokenManager.addTokenToCollection(creature, cell.x, cell.y, 'mannequin');
      const token = gm.placedTokens.at(-1);
      const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
      linkTokenCharacter(token, library, characterId);
      await token.__threeMeshPromise;
      await gm.sceneAutosave.flush();
    },
    { characterId, cell: network.actorCell }
  );
  const invite = await page.evaluate(async (id) => {
    const gm = window.gameManager;
    const store = gm.characterServices.library.store;
    const invitation = await store.sessionCall('createInvite', [
      gm.campaign.id,
      { name: 'Cavern player' },
    ]);
    await store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
    return invitation.invite;
  }, characterId);
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const player = await playerContext.newPage();
  await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(invite)}`);
  await player.waitForFunction(
    () =>
      !!window.gameManager?.playerApplication?.state?.observerTokenId &&
      !!window.gameManager?.playerApplication?.traversalPopup?.root.isConnected &&
      !window.gameManager?.campaignViewBusy
  );
  const initial = await player.evaluate(() => window.gameManager.playerApplication.state);
  await expect(player.getByRole('dialog', { name: 'DM location overview' })).toHaveCount(0);
  await expect(player.getByRole('button', { name: 'Open location overview' })).toHaveCount(0);
  expect(JSON.stringify(initial)).not.toContain(network.target.mapId);
  await player.waitForFunction(
    (id) =>
      window.gameManager?.threeSceneManager?.scene
        .getObjectByName('LogicalPassageMarkers')
        ?.children.some((marker) => marker.userData.passageId === id),
    network.passageId
  );
  const markerPoint = await player.evaluate((id) => {
    const manager = window.gameManager.threeSceneManager;
    const marker = manager.scene
      .getObjectByName('LogicalPassageMarkers')
      .children.find((entry) => entry.userData.passageId === id);
    manager.camera.updateMatrixWorld(true);
    marker.updateWorldMatrix(true, false);
    const point = marker.getWorldPosition(new manager.three.Vector3()).project(manager.camera);
    const rect = manager.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) * rect.width) / 2,
      y: rect.top + ((1 - point.y) * rect.height) / 2,
    };
  }, network.passageId);
  await player.mouse.click(markerPoint.x, markerPoint.y);
  const popup = player.getByRole('dialog', { name: 'Traversal options' });
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: /Go through/ }).click();
  await player.waitForFunction(
    (mapId) =>
      window.gameManager?.playerApplication?.state?.publicScene?.presentation?.mapId === mapId,
    network.target.mapId
  );
  const arrived = await player.evaluate(() => window.gameManager.playerApplication.state);
  expect(arrived.publicScene.assets.maps.map((map) => map.id)).toEqual([network.target.mapId]);
  await player.getByRole('tab', { name: /Settings/ }).click();
  await player.getByRole('button', { name: `Use ${network.target.side} passage` }).click();
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: /Go through/ }).click();
  await player.waitForFunction(
    (mapId) =>
      window.gameManager?.playerApplication?.state?.publicScene?.presentation?.mapId === mapId,
    network.source.mapId
  );
  const returnedRevision = await player.evaluate(
    () => window.gameManager.playerApplication.state.sceneRevision
  );
  await page.waitForFunction(
    ({ revision, mapId }) => {
      const gm = window.gameManager;
      return (
        gm?.characterServices?.library?.sceneRevision >= revision &&
        gm.placedTokens.some((token) => token.mapId === mapId) &&
        !gm.sceneAutosave.dirty &&
        !gm.sceneAutosave.writing &&
        !gm.campaignViewBusy
      );
    },
    { revision: returnedRevision, mapId: network.source.mapId }
  );
  await expect(page.getByLabel('Shared session status')).toContainText('up to date');
  await page.evaluate(async (mapId) => {
    const { changeCampaignView } = await import('/src/campaigns/SceneWorld.js');
    await changeCampaignView(window.gameManager, { mapId });
  }, network.target.mapId);
  await page.getByRole('tab', { name: /Biomes/ }).click();
  await page.getByRole('button', { name: /Underground/ }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const chamberReview = page.getByRole('dialog', { name: 'Underground' });
  await chamberReview.locator('[name="variant"]').selectOption('fungalGrove');
  await expect(chamberReview.locator('[name="totalChambers"]')).toHaveValue('3');
  await chamberReview.getByLabel('Grid width (squares)').fill('17');
  await chamberReview.getByLabel('Grid height (squares)').fill('19');
  await chamberReview.locator('[name="density"]').selectOption('sparse');
  await submitBiomeReview(page, chamberReview.locator('button[type="submit"]'));
  await expect(page.locator('#biome-generation-status')).toContainText('17 x 19');
  const regenerated = await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    return gm.campaignWorld.save();
  });
  expect(regenerated.logicalPassages).toEqual(network.scene.logicalPassages);
  expect(regenerated.maps.find((map) => map.id === network.target.mapId).grid).toMatchObject({
    cols: 17,
    rows: 19,
  });
  expect(regenerated.maps.filter((map) => map.id !== network.target.mapId)).toEqual(
    network.scene.maps.filter((map) => map.id !== network.target.mapId)
  );
  expect(
    await player.evaluate(
      () => window.gameManager.playerApplication.state.publicScene.presentation.mapId
    )
  ).toBe(network.source.mapId);
  await player.getByRole('button', { name: `Use ${network.source.side} passage` }).click();
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: /Go through/ }).click();
  await player.waitForFunction(
    (mapId) =>
      window.gameManager?.playerApplication?.state?.publicScene?.presentation?.mapId === mapId,
    network.target.mapId
  );
  const entered = await player.evaluate(() => window.gameManager.playerApplication.state);
  expect(entered.publicScene.assets.maps[0].terrain.biome).toBe('fungalGrove');
  expect(entered.publicScene.assets.maps[0].grid).toMatchObject({ cols: 17, rows: 19 });
  const enteredRevision = entered.sceneRevision;
  await page.waitForFunction(
    ({ revision, mapId }) => {
      const gm = window.gameManager;
      return (
        gm?.characterServices?.library?.sceneRevision >= revision &&
        gm.placedTokens.some((token) => token.mapId === mapId) &&
        !gm.sceneAutosave.dirty &&
        !gm.sceneAutosave.writing &&
        !gm.campaignViewBusy
      );
    },
    { revision: enteredRevision, mapId: network.target.mapId }
  );
  await page.locator('.campaign-map-controls summary').click();
  const addArea = page.getByRole('form', { name: 'Add blank linked cavern area' });
  await expect(addArea).toBeVisible();
  await addArea.getByLabel('Linked area name').fill('Later grotto');
  await addArea.getByRole('button', { name: 'Add blank linked area' }).click();
  await page.waitForFunction(() =>
    window.gameManager?.campaignWorld?.listMaps().some((map) => map.name === 'Later grotto')
  );
  const withLaterArea = await page.evaluate(() => window.gameManager.campaignWorld.save());
  expect(withLaterArea.maps).toHaveLength(5);
  expect(withLaterArea.logicalPassages).toHaveLength(5);
  expect(withLaterArea.maps.find((map) => map.name === 'Later grotto').terrain.biome).toBeNull();
  expect(withLaterArea.maps.find((map) => map.id === network.target.mapId).terrain).toEqual(
    regenerated.maps.find((map) => map.id === network.target.mapId).terrain
  );
  await page.getByRole('button', { name: 'Open location overview' }).click();
  const layout = () =>
    page
      .locator('[data-overview-map]')
      .evaluateAll((nodes) =>
        nodes
          .map((node) => [node.getAttribute('data-overview-map'), node.getAttribute('transform')])
          .sort(([a], [b]) => a.localeCompare(b))
      );
  const beforeReopen = await layout();
  await page.getByRole('button', { name: 'Close location overview' }).click();
  await playerContext.close();
  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(() => window.gameManager?.sceneAutosave?.ready);
  const persisted = await page.evaluate(() => window.gameManager.campaignWorld.save());
  expect(persisted.logicalPassages).toEqual(withLaterArea.logicalPassages);
  expect(persisted.maps.find((map) => map.id === network.target.mapId).grid).toMatchObject({
    cols: 17,
    rows: 19,
  });
  await page.locator('.campaign-map-controls summary').click();
  await page.getByRole('button', { name: 'Open location overview' }).click();
  await expect(
    page.getByRole('dialog', { name: 'DM location overview' }).locator('[data-overview-map]')
  ).toHaveCount(4);
  expect(await layout()).toEqual(beforeReopen);
});

test('manual tree previews fit real trunks and family placements survive reopening', async ({
  page,
}) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright manual tree support';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(() => window.gameManager?.sceneAutosave?.ready);
  await expect(page.getByRole('dialog', { name: 'Opening campaign' })).toBeHidden();
  await page.getByRole('tab', { name: /Terrain/ }).click();
  await page
    .locator('label')
    .filter({ has: page.locator('#terrain-mode-toggle') })
    .click();
  const hoverCell = async (gridX, gridY) => {
    const point = await page.evaluate(
      ({ gridX, gridY }) => {
        const gm = window.gameManager;
        const { camera, canvas, three } = gm.threeSceneManager;
        const tile = gm.spatial.tileWorldSize;
        camera.updateMatrixWorld(true);
        const projected = new three.Vector3(
          (gridX + 0.5) * tile,
          gm.getTerrainHeight(gridX, gridY) * gm.spatial.elevationUnit,
          (gridY + 0.5) * tile
        ).project(camera);
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + ((projected.x + 1) * rect.width) / 2,
          y: rect.top + ((1 - projected.y) * rect.height) / 2,
        };
      },
      { gridX, gridY }
    );
    await page.mouse.move(point.x, point.y);
  };
  await page.locator('[data-placeable="tree-thick-a"]').click();
  await hoverCell(0, 0);
  await page.waitForFunction(() => {
    const gm = window.gameManager;
    const mesh = gm.threeSceneManager.brushOverlay?._instanced;
    if (!mesh?.instanceColor || mesh.count !== 1) return false;
    const color = new gm.threeSceneManager.three.Color();
    mesh.getColorAt(0, color);
    return color.getHex() === 0xf59e0b;
  });
  await page.evaluate(async () => {
    const gm = window.gameManager;
    gm.terrainEngine.emitPlaceableChanged(0, 0, 'tree-thick-a');
    await gm.placeableMeshPool.whenSettled();
  });
  await page.locator('[data-placeable="family-birch"]').click();
  await hoverCell(2, 2);
  await page.waitForFunction(
    () => window.gameManager.threeSceneManager.brushOverlay?._instanced?.count === 1
  );
  const placed = await page.evaluate(async () => {
    const gm = window.gameManager;
    gm.terrainEngine.emitPlaceableChanged(2, 2, 'family-birch');
    await gm.placeableMeshPool.whenSettled();
    await gm.sceneAutosave.flush();
    return gm.placeableMeshPool.snapshotPlacements();
  });
  const thick = placed.find(({ placeableId }) => placeableId === 'tree-thick-a');
  const birch = placed.find(({ placeableId }) => /^tree-birch-/.test(placeableId || ''));
  expect(thick.persistedScale.x).toBeGreaterThanOrEqual(0.65);
  expect(thick.persistedScale.x).toBeLessThan(1);
  expect(thick.persistedScale.y).toBeCloseTo(thick.persistedScale.x);
  expect(birch.modelKey).toMatch(/^birch-/);
  expect(birch.variantKey).toBe(birch.placeableId);
  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(() => window.gameManager?.sceneAutosave?.ready);
  const restored = await page.evaluate(() =>
    window.gameManager.placeableMeshPool.snapshotPlacements()
  );
  expect(restored).toEqual(expect.arrayContaining([thick, birch]));
});

test('all representative source-pack models load and expose measurable support', async ({
  page,
}) => {
  await page.goto(hostURL);
  const result = await page.evaluate(async () => {
    const [{ default: ModelAssetCache }, postProcess, placeableGeometry, three] = await Promise.all(
      [
        import('/src/core/ModelAssetCache.js'),
        import('/src/core/ModelPostProcessing.js'),
        import('/src/scene/terrain/placeableModelGeometry.js'),
        import('three'),
      ]
    );
    const cache = new ModelAssetCache();
    cache.setThree(three);
    const rows = [];
    for (const key of [
      'source-medieval-wall-door',
      'source-dungeon-wall',
      'source-cave-entrance',
      'source-cave-stalagmite',
      'source-cave-column',
      'source-iron-chest',
      'mushroom-glow',
      'mushroom-giant-cap',
    ]) {
      const model = await cache.getModel(key);
      if (!model) {
        rows.push({ key, loaded: false });
        continue;
      }
      const bounds = new three.Box3().setFromObject(model, true);
      const support = postProcess.getModelSupportBounds(three, model);
      let preparedVertices = null;
      let preparedMaterials = null;
      if (/^source-cave-|^source-iron-chest$/.test(key)) {
        const prepared = placeableGeometry.createPlaceableModelGeometry(three, model);
        preparedVertices = prepared.geometry.attributes.position.count;
        preparedMaterials = Array.isArray(prepared.material) ? prepared.material.length : 1;
        prepared.geometry.dispose();
      }
      let texturedMaterials = 0;
      let nonOpaqueMaterials = 0;
      model.traverse((child) => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        texturedMaterials += materials.filter((material) => material?.map).length;
        nonOpaqueMaterials += materials.filter(
          (material) => !material || material.transparent || material.opacity !== 1
        ).length;
      });
      rows.push({
        key,
        loaded: true,
        height: bounds.max.y - bounds.min.y,
        minY: bounds.min.y,
        supportWidth: support.max.x - support.min.x,
        supportDepth: support.max.z - support.min.z,
        texturedMaterials,
        nonOpaqueMaterials,
        preparedVertices,
        preparedMaterials,
      });
    }
    return rows;
  });
  expect(result).toHaveLength(8);
  for (const row of result) {
    expect(row.loaded, row.key).toBe(true);
    expect(row.height, row.key).toBeGreaterThan(0.1);
    expect(row.minY, row.key).toBeCloseTo(0, 3);
    expect(row.supportWidth, row.key).toBeGreaterThan(0);
    expect(row.supportDepth, row.key).toBeGreaterThan(0);
    if (/^source-cave-(stalagmite|column)$/.test(row.key))
      expect(row.texturedMaterials, row.key).toBeGreaterThan(0);
    if (/^source-cave-|^source-iron-chest$/.test(row.key))
      expect(row.preparedVertices, row.key).toBeGreaterThan(0);
    if (/^mushroom-(glow|giant-cap)$/.test(row.key))
      expect(row.texturedMaterials, row.key).toBeGreaterThan(0);
    if (row.key === 'source-iron-chest') {
      expect(row.nonOpaqueMaterials).toBe(0);
      expect(row.preparedMaterials).toBeGreaterThan(1);
    }
  }
});

test('cave formations retain visible surface detail in diffuse underground light', async ({
  page,
}) => {
  await page.goto(hostURL);
  const measurements = await page.evaluate(async () => {
    const [{ default: ModelAssetCache }, { PlaceableMeshPool }, three] = await Promise.all([
      import('/src/core/ModelAssetCache.js'),
      import('/src/scene/terrain/PlaceableMeshPool.js'),
      import('three'),
    ]);
    const scene = new three.Scene();
    scene.add(new three.AmbientLight(0xe4e1df, 0.85));
    scene.add(new three.HemisphereLight(0xb6bed0, 0x514b47, 0.3));
    const cache = new ModelAssetCache();
    cache.setThree(three);
    const pool = new PlaceableMeshPool({
      gameManager: {
        is3DModeActive: () => true,
        threeSceneManager: { scene },
        terrainEngine: { biomeKey: 'cavern', biomeSeed: 42 },
        modelAssetCache: cache,
        spatial: {
          tileWorldSize: 1,
          elevationUnit: 1,
          gridToWorld: () => ({ x: 0, y: 0, z: 0 }),
        },
        getTerrainHeight: () => 0,
      },
      initialCapacity: 1,
      maxCapacity: 1,
      publishMetrics: false,
    });
    const renderer = new three.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(192, 192);
    renderer.setClearColor(0, 0);
    const target = new three.WebGLRenderTarget(192, 192);
    target.texture.colorSpace = three.SRGBColorSpace;
    const camera = new three.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 50);
    const reports = [];
    try {
      for (const modelKey of ['source-cave-stalagmite', 'source-cave-column']) {
        const handle = await pool.addPlaceable(
          {
            type: 'plant',
            modelKey,
            placeableId: modelKey,
            biomeKey: 'cavern',
            biomeSeed: 42,
            gridX: 0,
            gridY: 0,
            gridOffsetX: 0,
            gridOffsetY: 0,
            angleRadians: 0,
            persistedScale: { x: 1, y: 1, z: 1 },
          },
          { strict: true }
        );
        await cache.whenModelReady(modelKey);
        for (const [x, z] of [
          [5, 7],
          [-7, 5],
        ]) {
          camera.position.set(x, 3.2, z);
          camera.lookAt(0, 1.1, 0);
          camera.updateMatrixWorld(true);
          renderer.setRenderTarget(target);
          renderer.render(scene, camera);
          const pixels = new Uint8Array(192 * 192 * 4);
          renderer.readRenderTargetPixels(target, 0, 0, 192, 192, pixels);
          const values = [];
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] < 250) continue;
            values.push(
              0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]
            );
          }
          values.sort((a, b) => a - b);
          reports.push({
            modelKey,
            angle: [x, z],
            pixels: values.length,
            contrast:
              values[Math.floor(values.length * 0.9)] - values[Math.floor(values.length * 0.1)],
          });
        }
        pool.removePlaceable({ __meshPoolHandle: handle });
      }
    } finally {
      pool.purgeAll();
      target.dispose();
      renderer.dispose();
    }
    return reports;
  });
  for (const measurement of measurements) {
    expect(measurement.pixels, JSON.stringify(measurement)).toBeGreaterThan(500);
    expect(measurement.contrast, JSON.stringify(measurement)).toBeGreaterThan(15);
  }
});

test('cavern cutaways follow each viewer and preserve a clickable floor after reopening', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Playwright cavern cutaway');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );

  await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'cavern', seed: 848467040, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    );
    await gm.sceneAutosave.flush();
  });
  const inspect = (viewer, cameraZ) =>
    viewer.evaluate((cameraZ) => {
      const gm = window.gameManager;
      const { camera, canvas, scene, three } = gm.threeSceneManager;
      const tile = gm.spatial.tileWorldSize;
      const floor = gm.getTerrainHeight(12, 12) * gm.spatial.elevationUnit;
      const target = new three.Vector3(12.5 * tile, floor, 12.5 * tile);
      camera.position.set(12.5 * tile, floor + 8 * tile, cameraZ * tile);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      const projected = target.clone().project(camera);
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + ((projected.x + 1) * rect.width) / 2;
      const y = rect.top + ((1 - projected.y) * rect.height) / 2;
      const hit = gm.pickingService.pickGroundSync(x, y, canvas);
      const ray = new three.Raycaster();
      ray.setFromCamera(new three.Vector2(projected.x, projected.y), camera);
      const mesh = scene.getObjectByName('TerrainMesh');
      const first = ray.intersectObject(mesh)[0];
      let checksum = 0;
      const count = Math.min(mesh.geometry.drawRange.count, mesh.geometry.index.count);
      for (let index = 0; index < count; index++)
        checksum = (Math.imul(checksum, 31) + mesh.geometry.index.getX(index)) >>> 0;
      return {
        hit: hit?.grid,
        point: first?.point.toArray(),
        normal: first?.face?.normal.toArray(),
        focused: gm.token3DAdapter.getSelectedToken()?.id ?? null,
        checksum,
        gridTiles: scene.getObjectByName('GridBaseFill')?.count,
        floorTiles: Array.from({ length: gm.rows }, (_, z) =>
          Array.from({ length: gm.cols }, (_, x) => gm.getTerrainHeight(x, z) <= -5)
        )
          .flat()
          .filter(Boolean).length,
      };
    }, cameraZ);
  const result = await inspect(page, 36);
  expect(result.focused).toBeNull();
  expect(result.hit, JSON.stringify(result)).toEqual({ gx: 12, gy: 12 });
  expect((await inspect(page, -11)).hit).toEqual({ gx: 12, gy: 12 });
  await inspect(page, 36);
  const invite = await page.evaluate(async () => {
    const gm = window.gameManager;
    const library = gm.characterServices.library;
    const id = await library.create('Cavern cutaway explorer');
    await library.flush();
    const creature = gm.tokenManager.createCreatureByType('mannequin');
    gm.tokenManager.addTokenToCollection(creature, 12, 12, 'mannequin');
    const token = gm.placedTokens.at(-1);
    const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
    linkTokenCharacter(token, library, id);
    await token.__threeMeshPromise;
    await gm.sceneAutosave.flush();
    const invitation = await library.store.sessionCall('createInvite', [
      gm.campaign.id,
      { name: 'Cavern cutaway player' },
    ]);
    await library.store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
    return invitation.invite;
  });
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const player = await playerContext.newPage();
    await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(invite)}`);
    await player.waitForFunction(
      () =>
        window.gameManager?.publicPlayerPresentation &&
        window.gameManager?.threeSceneManager?._boundaryWallCutaway
    );
    const playerView = await inspect(player, 36);
    expect(playerView.hit, JSON.stringify(playerView)).toEqual({ gx: 12, gy: 12 });
    expect(playerView.gridTiles).toBe(playerView.floorTiles);
    const hostGeometryChecksum = () =>
      page.evaluate(() => {
        const geometry =
          window.gameManager.threeSceneManager.scene.getObjectByName('TerrainMesh').geometry;
        const count = Math.min(geometry.drawRange.count, geometry.index.count);
        let checksum = 0;
        for (let index = 0; index < count; index++)
          checksum = (Math.imul(checksum, 31) + geometry.index.getX(index)) >>> 0;
        return checksum;
      });
    const hostChecksum = await hostGeometryChecksum();
    const opposite = await inspect(player, -11);
    expect(opposite.hit).toEqual({ gx: 12, gy: 12 });
    expect(opposite.checksum).not.toBe(playerView.checksum);
    const hostAfter = await hostGeometryChecksum();
    expect(hostAfter).toBe(hostChecksum);
  } finally {
    await playerContext.close();
  }
  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: 'Playwright cavern cutaway' });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.threeSceneManager?._boundaryWallCutaway
  );
  const restored = await inspect(page, 36);
  expect(restored.hit, JSON.stringify(restored)).toEqual({ gx: 12, gy: 12 });
});

test('the DM overview displays a navigable Dungeon floor plan', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Playwright dungeon overview');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0, dungeonRoomCount: 6 },
      { cols: 25, rows: 25 }
    );
    await gm.sceneAutosave.flush();
  });
  await page.locator('.campaign-map-controls summary').click();
  await page.getByRole('button', { name: 'Open location overview' }).click();
  const overview = page.getByRole('dialog', { name: 'DM location overview' });
  await expect(overview).toBeVisible();
  await expect(overview.locator('[data-overview-map]')).toHaveCount(1);
  await expect(overview.locator('.overview-map-wall')).toHaveCount(1);
  expect(await overview.locator('[data-overview-door]').count()).toBeGreaterThan(0);
  const interior = await page.evaluate(() => {
    const walls = window.gameManager.terrainEngine.geometry.getStructures();
    const partition = walls.find((wall) => wall.name === 'Dungeon Room Partition');
    const doorway = walls.find((wall) => wall.opening && /Room Doorway/.test(wall.name));
    const path = document.querySelector('.overview-map-wall');
    return {
      partition: !!partition,
      doorway: !!doorway,
      solid:
        partition && path.isPointInFill(new DOMPoint(partition.xFeet * 2, partition.zFeet * 2)),
      open: doorway && !path.isPointInFill(new DOMPoint(doorway.xFeet * 2, doorway.zFeet * 2)),
    };
  });
  expect(interior).toEqual({ partition: true, doorway: true, solid: true, open: true });
  const svg = overview.locator('svg');
  const width = Number(await svg.getAttribute('width'));
  await overview.getByRole('button', { name: 'Zoom in overview' }).click();
  expect(Number(await svg.getAttribute('width'))).toBeGreaterThan(width);
  await overview.getByRole('button', { name: 'Fit overview' }).click();
  expect(Number(await svg.getAttribute('width'))).toBe(width);
  await page.keyboard.press('Escape');
  await expect(overview).toBeHidden();
  await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      {
        biomeKey: 'cavern',
        seed: 42,
        densityMultiplier: 0,
        cavernNetwork: { totalChambers: 3, outsideSides: [], outsideMode: 'separate' },
      },
      { cols: 25, rows: 25 }
    );
    await gm.sceneAutosave.flush();
  });
  await page.getByRole('button', { name: 'Open location overview' }).click();
  await expect(overview.locator('[data-overview-map]')).toHaveCount(3);
});

test('a foreground Dungeon boundary does not hide the usable floor', async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Playwright dungeon cutaway');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0, dungeonRoomCount: 6 },
      { cols: 25, rows: 25 }
    );
  });
  await page.waitForFunction(
    () =>
      window.gameManager?.threeSceneManager?.scene.getObjectByName('ConstructionAssets') &&
      window.gameManager?.threeSceneManager?._boundaryWallCutaway?.wallModels.length > 0
  );
  const result = await page.evaluate(() => {
    const gm = window.gameManager;
    const { camera, canvas, scene, three } = gm.threeSceneManager;
    const boundary = gm.terrainEngine.geometry
      .getStructures()
      .find(({ name }) => name === 'Dungeon South Wall');
    if (!boundary) throw new Error('The Dungeon fixture has no southern perimeter wall');
    const target = new three.Vector3(boundary.xFeet / 5, 0, 23.5);
    camera.position.set(target.x, 5, 36);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    const ndc = target.clone().project(camera);
    const rect = canvas.getBoundingClientRect();
    const hit = gm.pickingService.pickGroundSync(
      rect.left + ((ndc.x + 1) * rect.width) / 2,
      rect.top + ((1 - ndc.y) * rect.height) / 2,
      canvas
    );
    const assets = scene.getObjectByName('ConstructionAssets');
    assets.updateMatrixWorld(true);
    const meshes = [];
    assets.traverseVisible((object) => {
      if (!object.isMesh) return;
      meshes.push({ object, raycast: object.raycast });
      object.raycast = object.isInstancedMesh
        ? three.InstancedMesh.prototype.raycast
        : three.Mesh.prototype.raycast;
    });
    const ray = new three.Raycaster();
    ray.setFromCamera(new three.Vector2(ndc.x, ndc.y), camera);
    const distance = ray.ray.origin.distanceTo(target);
    let blocked;
    try {
      blocked = ray
        .intersectObjects(
          meshes.map(({ object }) => object),
          false
        )
        .some(
          (entry) =>
            entry.distance < distance - 1e-5 &&
            (entry.object.userData.structureIds?.[entry.instanceId] ||
              entry.object.userData.structureId) === boundary.id
        );
    } finally {
      for (const { object, raycast } of meshes) object.raycast = raycast;
    }
    return { blocked, hit: hit?.grid, target: { gx: Math.floor(target.x), gy: 23 } };
  });
  expect(result.blocked, JSON.stringify(result)).toBe(false);
  expect(result.hit).toEqual(result.target);
  const rotation = await page.evaluate(() => {
    const gm = window.gameManager;
    const manager = gm.threeSceneManager;
    const { camera, scene, three } = manager;
    const boundary = gm.terrainEngine.geometry
      .getStructures()
      .find(({ name }) => name === 'Dungeon South Wall');
    const wallVisible = () => {
      const assets = scene.getObjectByName('ConstructionAssets');
      assets.updateMatrixWorld(true);
      const meshes = [];
      assets.traverseVisible((object) => {
        if (!object.isMesh) return;
        meshes.push({ object, raycast: object.raycast });
        object.raycast = object.isInstancedMesh
          ? three.InstancedMesh.prototype.raycast
          : three.Mesh.prototype.raycast;
      });
      try {
        const ray = new three.Raycaster(
          new three.Vector3(12.5, 1, 23.5),
          new three.Vector3(0, 0, 1),
          0,
          3
        );
        return ray
          .intersectObjects(
            meshes.map(({ object }) => object),
            false
          )
          .some(
            (entry) =>
              (entry.object.userData.structureIds?.[entry.instanceId] ||
                entry.object.userData.structureId) === boundary.id
          );
      } finally {
        for (const { object, raycast } of meshes) object.raycast = raycast;
      }
    };
    camera.position.set(12.5, 5, -11);
    camera.lookAt(12.5, 0, 12.5);
    manager._boundaryWallCutaway.update(camera);
    const restored = wallVisible();
    camera.position.set(12.5, 5, 36);
    camera.lookAt(12.5, 0, 23.5);
    manager._boundaryWallCutaway.update(camera);
    const cut = wallVisible();
    gm.terrainRebuilder.rebuild();
    const afterRebuild = wallVisible();
    return { restored, cut, afterRebuild };
  });
  expect(rotation).toEqual({ restored: true, cut: false, afterRebuild: false });
  const invite = await page.evaluate(async () => {
    const gm = window.gameManager;
    const library = gm.characterServices.library;
    const id = await library.create('Dungeon cutaway explorer');
    await library.flush();
    const creature = gm.tokenManager.createCreatureByType('mannequin');
    gm.tokenManager.addTokenToCollection(creature, 12, 23, 'mannequin');
    const token = gm.placedTokens.at(-1);
    const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
    linkTokenCharacter(token, library, id);
    await token.__threeMeshPromise;
    await gm.sceneAutosave.flush();
    const invitation = await library.store.sessionCall('createInvite', [
      gm.campaign.id,
      { name: 'Dungeon cutaway player' },
    ]);
    await library.store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
    return invitation.invite;
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const player = await context.newPage();
    await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(invite)}`);
    await player.waitForFunction(
      () =>
        window.gameManager?.publicPlayerPresentation &&
        window.gameManager?.threeSceneManager?._boundaryWallCutaway
    );
    const playerResult = await player.evaluate(() => {
      const gm = window.gameManager;
      const { camera, canvas, scene, three } = gm.threeSceneManager;
      const target = new three.Vector3(12.5, 0, 23.5);
      camera.position.set(12.5, 5, 36);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      const point = target.clone().project(camera);
      const rect = canvas.getBoundingClientRect();
      const picked = gm.pickingService.pickGroundSync(
        rect.left + ((point.x + 1) * rect.width) / 2,
        rect.top + ((1 - point.y) * rect.height) / 2,
        canvas
      );
      const ray = new three.Raycaster();
      ray.setFromCamera(new three.Vector2(point.x, point.y), camera);
      const first = ray.intersectObject(scene.getObjectByName('TerrainMesh'))[0];
      return { hit: picked?.grid, point: first?.point.toArray() };
    });
    expect(playerResult.hit, JSON.stringify(playerResult)).toEqual({ gx: 12, gy: 23 });
    expect(playerResult.point[1]).toBeCloseTo(0, 4);
    expect(playerResult.point[2]).toBeCloseTo(23.5, 4);
  } finally {
    await context.close();
  }
  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: 'Playwright dungeon cutaway' });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.threeSceneManager?._boundaryWallCutaway?.wallModels.length > 0
  );
  const reopenedView = await page.evaluate(() => {
    const gm = window.gameManager;
    const manager = gm.threeSceneManager;
    manager.camera.position.set(12.5, 5, 36);
    manager.camera.lookAt(12.5, 0, 23.5);
    manager._boundaryWallCutaway.update(manager.camera);
    const target = new manager.three.Vector3(12.5, 0, 23.5).project(manager.camera);
    const rect = manager.canvas.getBoundingClientRect();
    const hit = gm.pickingService.pickGroundSync(
      rect.left + ((target.x + 1) * rect.width) / 2,
      rect.top + ((1 - target.y) * rect.height) / 2,
      manager.canvas
    );
    const hidden = manager._boundaryWallCutaway.wallModels.some((model) =>
      model.instances?.some(
        ({ index }) =>
          Math.abs(
            new manager.three.Matrix4()
              .fromArray(model.object.instanceMatrix.array, index * 16)
              .determinant()
          ) < 1e-8
      )
    );
    return { hit: hit?.grid, hidden };
  });
  expect(reopenedView).toEqual({ hit: { gx: 12, gy: 23 }, hidden: true });
});

test('Dungeon doorways are readable overhead without changing physical walls', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright Dungeon overhead doorway';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0, dungeonRoomCount: 6 },
      { cols: 25, rows: 25 }
    );
  });
  await page.waitForFunction(
    () =>
      window.gameManager?.threeSceneManager?.scene.getObjectByName('ConstructionAssets') &&
      window.gameManager?.threeSceneManager?._boundaryWallCutaway?.wallModels.length > 0
  );
  const host = await page.evaluate(() => {
    const gm = window.gameManager;
    const manager = gm.threeSceneManager;
    const { scene, three } = manager;
    const doorway = gm.terrainEngine.geometry
      .getStructures()
      .find(({ name }) => name.endsWith('Room Doorway'));
    if (!doorway) throw new Error('The Dungeon fixture has no room doorway');
    const physical = JSON.stringify(gm.terrainEngine.geometry.save());
    const target = new three.Vector3(doorway.xFeet / 5, 0, doorway.zFeet / 5).add(
      new three.Vector3(
        -Math.sin(doorway.angleRadians),
        0,
        Math.cos(doorway.angleRadians)
      ).multiplyScalar(0.1)
    );
    const jamb = target
      .clone()
      .add(
        new three.Vector3(
          Math.cos(doorway.angleRadians),
          0,
          Math.sin(doorway.angleRadians)
        ).multiplyScalar((doorway.openingWidthFeet / 2 + 0.5) / 5)
      );
    const hitWallModel = (point) => {
      const assets = scene.getObjectByName('ConstructionAssets');
      assets.updateMatrixWorld(true);
      const meshes = [];
      assets.traverseVisible((object) => {
        if (!object.isMesh) return;
        meshes.push({ object, raycast: object.raycast });
        object.raycast = object.isInstancedMesh
          ? three.InstancedMesh.prototype.raycast
          : three.Mesh.prototype.raycast;
      });
      try {
        const ray = new three.Raycaster(
          point.clone().add(new three.Vector3(0, 30, 0)),
          new three.Vector3(0, -1, 0)
        );
        return ray
          .intersectObjects(
            meshes.map(({ object }) => object),
            false
          )
          .some(
            (entry) =>
              (entry.object.userData.structureIds?.[entry.instanceId] ||
                entry.object.userData.structureId) === doorway.id
          );
      } finally {
        for (const { object, raycast } of meshes) object.raycast = raycast;
      }
    };
    manager.setTopDownView(true);
    const camera = manager.camera;
    camera.position.set(target.x, 30, target.z);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    manager._boundaryWallCutaway.update(camera);
    const ndc = target.clone().project(camera);
    const rect = manager.canvas.getBoundingClientRect();
    const picked = gm.pickingService.pickGroundSync(
      rect.left + ((ndc.x + 1) * rect.width) / 2,
      rect.top + ((1 - ndc.y) * rect.height) / 2,
      manager.canvas
    );
    const overhead = {
      doorway: hitWallModel(target),
      jamb: hitWallModel(jamb),
      picked: picked?.grid,
    };
    camera.position.set(target.x, 8, target.z + 20);
    camera.lookAt(target);
    manager._boundaryWallCutaway.update(camera);
    return {
      doorway,
      target: { x: target.x, z: target.z },
      overhead,
      restored: hitWallModel(target),
      unchanged: JSON.stringify(gm.terrainEngine.geometry.save()) === physical,
      physical,
    };
  });
  expect(host.overhead.doorway).toBe(false);
  expect(host.overhead.jamb).toBe(true);
  expect(host.overhead.picked).toEqual({
    gx: Math.floor(host.target.x),
    gy: Math.floor(host.target.z),
  });
  expect(host.restored).toBe(true);
  expect(host.unchanged).toBe(true);

  const invite = await page.evaluate(async (doorway) => {
    const gm = window.gameManager;
    const library = gm.characterServices.library;
    const id = await library.create('Dungeon doorway explorer');
    await library.flush();
    const normal = { x: -Math.sin(doorway.angleRadians), z: Math.cos(doorway.angleRadians) };
    const gridX = Math.floor((doorway.xFeet - normal.x * 2.5) / 5);
    const gridY = Math.floor((doorway.zFeet - normal.z * 2.5) / 5);
    const creature = gm.tokenManager.createCreatureByType('mannequin');
    gm.tokenManager.addTokenToCollection(creature, gridX, gridY, 'mannequin');
    const token = gm.placedTokens.at(-1);
    const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
    linkTokenCharacter(token, library, id);
    await token.__threeMeshPromise;
    await gm.sceneAutosave.flush();
    const invitation = await library.store.sessionCall('createInvite', [
      gm.campaign.id,
      { name: 'Dungeon doorway player' },
    ]);
    await library.store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
    return invitation.invite;
  }, host.doorway);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const player = await context.newPage();
    await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(invite)}`);
    await player.waitForFunction(
      () =>
        window.gameManager?.publicPlayerPresentation &&
        window.gameManager?.threeSceneManager?._boundaryWallCutaway
    );
    const result = await player.evaluate((doorway) => {
      const gm = window.gameManager;
      const manager = gm.threeSceneManager;
      const { three } = manager;
      const target = new three.Vector3(doorway.xFeet / 5, 0, doorway.zFeet / 5).add(
        new three.Vector3(
          -Math.sin(doorway.angleRadians),
          0,
          Math.cos(doorway.angleRadians)
        ).multiplyScalar(0.1)
      );
      const before = JSON.stringify(gm.terrainEngine.geometry.save());
      manager.setTopDownView(true);
      const camera = manager.camera;
      camera.position.set(target.x, 30, target.z);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      manager._boundaryWallCutaway.update(camera);
      const ray = new three.Raycaster(
        target.clone().add(new three.Vector3(0, 30, 0)),
        new three.Vector3(0, -1, 0)
      );
      const overhead = ray.intersectObject(manager.scene.getObjectByName('TerrainMesh'))[0]?.point
        .y;
      camera.position.set(target.x, 8, target.z + 20);
      camera.lookAt(target);
      manager._boundaryWallCutaway.update(camera);
      const tilted = ray.intersectObject(manager.scene.getObjectByName('TerrainMesh'))[0]?.point.y;
      return {
        overhead,
        tilted,
        unchanged: JSON.stringify(gm.terrainEngine.geometry.save()) === before,
      };
    }, host.doorway);
    expect(result.overhead).toBeCloseTo(0, 4);
    expect(result.tilted).toBeGreaterThan(1.5);
    expect(result.unchanged).toBe(true);
    await player.evaluate((doorway) => {
      const manager = window.gameManager.threeSceneManager;
      const target = new manager.three.Vector3(doorway.xFeet / 5, 0, doorway.zFeet / 5);
      manager.camera.position.set(target.x, 30, target.z);
      manager.camera.lookAt(target);
      manager._boundaryWallCutaway.update(manager.camera);
    }, host.doorway);
    expect(
      await player.evaluate(
        () => window.gameManager.threeSceneManager._boundaryWallCutaway.hideLintels
      )
    ).toBe(true);
    expect(
      await page.evaluate(
        () => window.gameManager.threeSceneManager._boundaryWallCutaway.hideLintels
      )
    ).toBe(false);
  } finally {
    await context.close();
  }

  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction((id) => {
    const gm = window.gameManager;
    const replacements =
      gm?.threeSceneManager?.scene.getObjectByName('ConstructionAssets')?.userData.replacements ||
      [];
    return (
      gm?.sceneAutosave?.ready &&
      gm?.threeSceneManager?._boundaryWallCutaway &&
      replacements.some(({ structureId }) => structureId === id)
    );
  }, host.doorway.id);
  const reopenedView = await page.evaluate((doorway) => {
    const gm = window.gameManager;
    const manager = gm.threeSceneManager;
    const { three } = manager;
    const target = new three.Vector3(doorway.xFeet / 5, 0, doorway.zFeet / 5).add(
      new three.Vector3(
        -Math.sin(doorway.angleRadians),
        0,
        Math.cos(doorway.angleRadians)
      ).multiplyScalar(0.1)
    );
    const wallMeshes = [];
    manager.scene.getObjectByName('ConstructionAssets').traverseVisible((object) => {
      if (!object.isMesh) return;
      wallMeshes.push({ object, raycast: object.raycast });
      object.raycast = object.isInstancedMesh
        ? three.InstancedMesh.prototype.raycast
        : three.Mesh.prototype.raycast;
    });
    const ray = new three.Raycaster(
      target.clone().add(new three.Vector3(0, 30, 0)),
      new three.Vector3(0, -1, 0)
    );
    const hitsDoorway = () =>
      ray
        .intersectObjects(
          wallMeshes.map(({ object }) => object),
          false
        )
        .some(
          (entry) =>
            (entry.object.userData.structureIds?.[entry.instanceId] ||
              entry.object.userData.structureId) === doorway.id
        );
    try {
      manager.setTopDownView(true);
      manager.camera.position.set(target.x, 30, target.z);
      manager.camera.lookAt(target);
      manager._boundaryWallCutaway.update(manager.camera);
      const overhead = hitsDoorway();
      manager.camera.position.set(target.x, 8, target.z + 20);
      manager.camera.lookAt(target);
      manager._boundaryWallCutaway.update(manager.camera);
      return {
        overhead,
        tilted: hitsDoorway(),
        physical: JSON.stringify(gm.terrainEngine.geometry.save()),
      };
    } finally {
      for (const { object, raycast } of wallMeshes) object.raycast = raycast;
    }
  }, host.doorway);
  expect(reopenedView.overhead).toBe(false);
  expect(reopenedView.tilted).toBe(true);
  expect(reopenedView.physical).toBe(host.physical);
});

test('the DM overview labels linked building levels and stairs', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Playwright building overview');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const saved = await page.evaluate(async () => {
    const gm = window.gameManager;
    gm.terrainEngine.placeStructure({
      id: 'overview-house',
      kind: 'building',
      xFeet: 60,
      zFeet: 60,
      heightFeet: 30,
      lengthFeet: 30,
      widthFeet: 25,
      building: { roof: 'gable' },
    });
    await gm.sceneAutosave.flush();
    return gm.campaignWorld.save();
  });
  expect(saved.maps.filter((map) => map.building)).toHaveLength(3);
  expect(saved.connections.filter((connection) => connection.kind === 'stairs')).toHaveLength(2);
  await page.locator('.campaign-map-controls summary').click();
  await page.getByRole('button', { name: 'Open location overview' }).click();
  const overview = page.getByRole('dialog', { name: 'DM location overview' });
  await expect(overview.locator('[data-overview-map]')).toHaveCount(4);
  await expect(overview.locator('[data-kind="stairs"]')).toHaveCount(4);
  await expect(overview).toContainText('Level +10 ft');
  await expect(overview).toContainText('Level +20 ft');
  const layout = await overview.locator('.location-overview-dialog').evaluate((dialog) => {
    const box = dialog.getBoundingClientRect();
    const root = dialog.parentElement.getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      height: innerHeight,
      rootTop: root.top,
      rootBottom: root.bottom,
      scrollY: window.scrollY,
    };
  });
  expect(layout.top, JSON.stringify(layout)).toBeGreaterThanOrEqual(0);
  expect(layout.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(layout.height);
});

test('dense cavern formations do not intersect boulders and remain clear after reopening', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Playwright cavern clearance');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'cavern', seed: 848467040, densityMultiplier: 1.65 },
      { cols: 25, rows: 25 }
    );
    await gm.placeableMeshPool.whenSettled();
    await gm.sceneAutosave.flush();
  });
  const measure = () =>
    page.evaluate(async () => {
      const gm = window.gameManager;
      const pool = gm.placeableMeshPool;
      const three = gm.threeSceneManager.three;
      const { blocksCreatureMovement } = await import('/src/terrain/PlaceableCollision.js');
      const { naturalCavernRoutes } = await import('/src/terrain/generation/CavernInteriors.js');
      await pool.whenSettled();
      const material = new three.MeshBasicMaterial({ side: three.DoubleSide });
      const items = [];
      const blockers = [];
      const geometries = [];
      for (const [key, entries] of pool._metadata) {
        const instanced = pool._groups.get(key).instancedMesh;
        const geometry = instanced.geometry.clone();
        geometry.computeBoundingBox();
        geometries.push(geometry);
        instanced.updateMatrixWorld(true);
        for (const [index, entry] of entries) {
          const model = entry.source.modelKey || '';
          const relevant = /^(source-cave-(stalagmite|column)|rock-medium-[234])$/.test(model);
          const routeSensitive =
            blocksCreatureMovement(entry.source) ||
            /^(source-cave-(stalagmite|column)|mushroom-(glow|giant-cap))$/.test(model);
          if (!relevant && !routeSensitive) continue;
          const matrix = new three.Matrix4();
          instanced.getMatrixAt(index, matrix);
          matrix.premultiply(instanced.matrixWorld);
          const box = geometry.boundingBox.clone().applyMatrix4(matrix);
          if (routeSensitive) blockers.push({ model, box });
          if (!relevant) continue;
          const mesh = new three.Mesh(geometry, material);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(matrix);
          mesh.updateMatrixWorld(true);
          items.push({
            model,
            grid: [entry.gx, entry.gy],
            box,
            mesh,
          });
        }
      }
      const formations = items.filter(({ model }) => model.startsWith('source-cave'));
      const boulders = items.filter(({ model }) => model.startsWith('rock-medium'));
      const formationOverlaps = [];
      for (const [index, first] of formations.entries())
        for (const second of formations.slice(index + 1)) {
          const common = first.box.clone().intersect(second.box);
          if (
            !common.isEmpty() &&
            common.max.x - common.min.x > 1e-6 &&
            common.max.y - common.min.y > 1e-6 &&
            common.max.z - common.min.z > 1e-6
          )
            formationOverlaps.push([first.grid, second.grid]);
        }
      const ray = new three.Raycaster();
      const direction = new three.Vector3(0, 1, 0);
      const intervals = (hits) => {
        const values = [];
        for (const hit of hits)
          if (!values.length || Math.abs(hit.point.y - values.at(-1)) > 1e-4)
            values.push(hit.point.y);
        const result = [];
        for (let index = 0; index + 1 < values.length; index += 2)
          result.push([values[index], values[index + 1]]);
        return result;
      };
      const overlaps = [];
      for (const formation of formations)
        for (const boulder of boulders) {
          const common = formation.box.clone().intersect(boulder.box);
          if (
            common.isEmpty() ||
            common.max.x - common.min.x < 0.02 ||
            common.max.y - common.min.y < 0.02 ||
            common.max.z - common.min.z < 0.02
          )
            continue;
          let intersecting = false;
          for (let z = 1; z <= 5 && !intersecting; z++)
            for (let x = 1; x <= 5 && !intersecting; x++) {
              ray.set(
                new three.Vector3(
                  common.min.x + ((common.max.x - common.min.x) * x) / 6,
                  Math.min(formation.box.min.y, boulder.box.min.y) - 1,
                  common.min.z + ((common.max.z - common.min.z) * z) / 6
                ),
                direction
              );
              const a = intervals(ray.intersectObject(formation.mesh));
              const b = intervals(ray.intersectObject(boulder.mesh));
              intersecting = a.some((first) =>
                b.some(
                  (second) => Math.min(first[1], second[1]) - Math.max(first[0], second[0]) > 0.02
                )
              );
            }
          if (intersecting) overlaps.push({ formation: formation.grid, boulder: boulder.grid });
        }
      const cavern = gm.terrainEngine.cavern;
      const routes = naturalCavernRoutes({
        cols: gm.cols,
        rows: gm.rows,
        getHeight: (x, z) => gm.getTerrainHeight(x, z),
        exits: cavern.exits,
        seed: cavern.seed,
      });
      const tile = gm.spatial.tileWorldSize;
      const blockedRoutes = [];
      const nearRouteBoulders = boulders.filter(({ grid: [x, z] }) =>
        routes.some(({ cells }) =>
          cells.some((cell) => Math.max(Math.abs(cell.x - x), Math.abs(cell.z - z)) <= 2)
        )
      ).length;
      for (const { side, cells } of routes)
        for (const { x, z } of cells) {
          const floor = gm.getTerrainHeight(x, z) * gm.spatial.elevationUnit;
          const body = new three.Box3(
            new three.Vector3(x * tile, floor, z * tile),
            new three.Vector3((x + 1) * tile, floor + tile, (z + 1) * tile)
          );
          for (const blocker of blockers) {
            const common = body.clone().intersect(blocker.box);
            if (
              !common.isEmpty() &&
              common.max.x - common.min.x > 1e-6 &&
              common.max.y - common.min.y > 1e-6 &&
              common.max.z - common.min.z > 1e-6
            )
              blockedRoutes.push({ side, x, z, model: blocker.model });
          }
        }
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
      return {
        formations: formations.length,
        boulders: boulders.length,
        nearRouteBoulders,
        overlaps,
        formationOverlaps,
        blockedRoutes,
        placements: await pool.snapshotPlacements(),
      };
    });
  const initial = await measure();
  expect(initial.formations).toBeGreaterThan(35);
  expect(initial.boulders).toBeGreaterThan(0);
  expect(initial.overlaps).toEqual([]);
  expect(initial.formationOverlaps).toEqual([]);
  expect(initial.blockedRoutes).toEqual([]);
  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: 'Playwright cavern clearance' });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.terrainEngine?.biomeKey === 'cavern'
  );
  const restored = await measure();
  expect(restored.overlaps).toEqual([]);
  expect(restored.formationOverlaps).toEqual([]);
  expect(restored.blockedRoutes).toEqual([]);
  const signature = (placements) =>
    placements.sort(
      (a, b) =>
        (a.modelKey || '').localeCompare(b.modelKey || '') || a.gridY - b.gridY || a.gridX - b.gridX
    );
  expect(signature(restored.placements)).toEqual(signature(initial.placements));
  await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    if (
      !gm.terrainEngine.generateBiomeElevation('cavern', {
        seed: 848467040,
        densityMultiplier: 1.65,
      })
    )
      throw new Error('Direct cavern regeneration did not start');
    await gm.placeableMeshPool.whenSettled();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  const direct = await measure();
  expect(direct.formations).toBeGreaterThan(35);
  expect(direct.boulders).toBeGreaterThan(0);
  expect(direct.overlaps).toEqual([]);
  expect(direct.formationOverlaps).toEqual([]);
  expect(direct.blockedRoutes).toEqual([]);
  expect(signature(direct.placements)).toEqual(signature(initial.placements));
  await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    if (!gm.terrainEngine.generateBiomeElevation('cavern', { seed: 4, densityMultiplier: 1.65 }))
      throw new Error('Second direct cavern regeneration did not start');
    await gm.placeableMeshPool.whenSettled();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await gm.sceneAutosave.flush();
  });
  const nearby = await measure();
  expect(nearby.nearRouteBoulders).toBeGreaterThan(0);
  expect(nearby.blockedRoutes).toEqual([]);
  expect(nearby.overlaps).toEqual([]);
  await page.reload();
  await page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: 'Playwright cavern clearance' })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.terrainEngine?.biomeKey === 'cavern'
  );
  const directRestored = await measure();
  expect(signature(directRestored.placements)).toEqual(signature(nearby.placements));
  expect(directRestored.blockedRoutes).toEqual([]);
  expect(directRestored.overlaps).toEqual([]);
  const moderate = await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'cavern', seed: 848467040, densityMultiplier: 1 },
      { cols: 25, rows: 25 }
    );
    return (await gm.placeableMeshPool.snapshotPlacements()).filter(({ modelKey }) =>
      /^source-cave-(stalagmite|column)$/.test(modelKey || '')
    ).length;
  });
  expect(initial.formations).toBeGreaterThan(moderate * 1.3);
  const regenerated = await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'cavern', seed: 848467040, densityMultiplier: 1.65 },
      { cols: 25, rows: 25 }
    );
    return gm.placeableMeshPool.snapshotPlacements();
  });
  expect(signature(regenerated)).toEqual(signature(initial.placements));
});

test('a short walk waits for cold locomotion assets instead of sliding', async ({ page }) => {
  test.setTimeout(120000);
  let release;
  let requested = false;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route('**/assets/animated-sprites/Walking.fbx', async (route) => {
    requested = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto(hostURL);
    const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
    await login.getByLabel('Host access key').fill(hostKey);
    await login.getByRole('button', { name: 'Sign in as host' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
    await picker.getByLabel('Campaign name', { exact: true }).fill('Playwright cold walk');
    await picker.getByLabel('Campaign ruleset').selectOption('2014');
    await picker.getByRole('button', { name: 'Create & open campaign' }).click();
    await page.waitForFunction(
      () =>
        window.gameManager?.sceneAutosave?.ready &&
        !window.gameManager.sceneAutosave.dirty &&
        !window.gameManager.sceneAutosave.writing
    );
    await expect(page.getByLabel('Shared session status')).toContainText('up to date');
    await page.evaluate(() => {
      const gm = window.gameManager;
      const creature = gm.tokenManager.createCreatureByType('mannequin');
      gm.tokenManager.addTokenToCollection(creature, 5, 5, 'mannequin');
      window.__coldWalkToken = gm.placedTokens.at(-1);
    });
    await expect.poll(() => requested).toBe(true);
    await page.waitForFunction(() => {
      const gm = window.gameManager;
      const token = window.__coldWalkToken;
      return token?.__threeMesh && !gm.token3DAdapter._tokenAnimationData.has(token);
    });
    const before = await page.evaluate(() => {
      const gm = window.gameManager;
      const token = window.__coldWalkToken;
      const start = { ...token.world };
      const result = gm.token3DAdapter.requestMoveToGrid(token, 6, 5);
      return { start, accepted: !!result };
    });
    expect(before.accepted).toBe(true);
    await page.waitForTimeout(700);
    const pending = await page.evaluate(() => ({
      world: { ...window.__coldWalkToken.world },
      animationsReady: window.gameManager.token3DAdapter._tokenAnimationData.has(
        window.__coldWalkToken
      ),
    }));
    expect(pending.animationsReady).toBe(false);
    expect(pending.world).toEqual(before.start);
    release();
    await page.waitForFunction(() => {
      const gm = window.gameManager;
      const token = window.__coldWalkToken;
      const data = gm.token3DAdapter._tokenAnimationData.get(token);
      return token.world.x > 5.55 && data?.actions.walk?.getEffectiveWeight() > 0;
    });
    const motion = await page.evaluate(async () => {
      const token = window.__coldWalkToken;
      const skins = [];
      token.__threeMesh.traverse((object) => {
        if (object.isSkinnedMesh) skins.push(object);
      });
      const leg = skins[0]?.skeleton.getBoneByName('mixamorigLeftUpLeg');
      if (!leg) throw new Error('The loaded creature has no left-leg animation bone');
      const rotation = leg.quaternion.clone();
      const start = token.world.x;
      await new Promise((resolve) => setTimeout(resolve, 130));
      return { angle: rotation.angleTo(leg.quaternion), distance: token.world.x - start };
    });
    expect(motion.distance).toBeGreaterThan(0);
    expect(motion.angle, JSON.stringify(motion)).toBeGreaterThan(0.005);
    await page.waitForFunction(
      () => !window.gameManager.token3DAdapter.isMovementInProgress(window.__coldWalkToken)
    );
    expect(await page.evaluate(() => window.__coldWalkToken.gridX)).toBe(6);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a wet Geyser Basin displays more supported scenery at dense settings', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Playwright geyser density');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const result = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    const { normalizeBiomeGenerationChoices } =
      await import('/src/config/biome/BiomeGenerationFamilies.js');
    const generate = async (density) => {
      await replaceCampaignBiome(
        gm,
        {
          ...normalizeBiomeGenerationChoices('geyserBasin', {
            variant: 'geyserBasin',
            moisture: 'wet',
            density,
          }),
          seed: 42,
          structures: false,
        },
        { cols: 12, rows: 12 }
      );
      await gm.sceneAutosave.flush();
      const placements = await gm.placeableMeshPool.snapshotPlacements();
      return {
        placements: placements.length,
        supported: placements.every(({ gridX, gridY }) => gm.getTerrainHeight(gridX, gridY) >= 0),
      };
    };
    return { sparse: await generate('sparse'), dense: await generate('dense') };
  });
  expect(result.dense.placements).toBeGreaterThan(result.sparse.placements);
  expect(result.dense.supported).toBe(true);
});

test('Salt Flats relief changes the rendered terrain and survives reopening', async ({ page }) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright Salt Flats relief';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'saltFlats', seed: 42, relief: 1, waterBias: 0, structures: false },
      { cols: 12, rows: 12 }
    );
    await gm.sceneAutosave.flush();
  });
  const old = await page.evaluate(() => window.gameManager.terrainEngine.save());
  expect(old.generationRecipe.values).not.toHaveProperty('saltFlatReliefVersion');

  const reopen = async () => {
    await page.reload();
    await page
      .getByRole('dialog', { name: 'Choose your campaign' })
      .locator('article', { hasText: campaignName })
      .getByRole('button', { name: 'Open', exact: true })
      .click();
    await page.waitForFunction(
      () =>
        window.gameManager?.sceneAutosave?.ready &&
        window.gameManager?.terrainEngine?.biomeKey === 'saltFlats'
    );
  };
  await reopen();
  expect(await page.evaluate(() => window.gameManager.terrainEngine.save())).toEqual(old);
  await page.getByRole('tab', { name: /Biomes/ }).click();
  await page.getByRole('button', { name: /Desert/ }).click();
  await page.locator('#biome-structures-toggle').uncheck();
  if (!(await page.locator('#biome-seed-lock').isChecked()))
    await page.locator('label[for="biome-seed-lock"]').click();

  const generate = async (choice, relief) => {
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Desert' });
    await review.locator('[name="variant"]').selectOption('saltFlats');
    const control = review.locator('[name="relief"]');
    await expect(control).toBeVisible();
    await control.selectOption(choice);
    await submitBiomeReview(page, review.locator('button[type="submit"]'));
    await page.waitForFunction(
      (value) =>
        window.gameManager?.terrainEngine?.generationRecipe?.values?.relief === value &&
        window.gameManager?.terrainEngine?.generationRecipe?.values?.saltFlatReliefVersion === 1 &&
        !window.gameManager?.terrainRebuilder?._timer,
      relief
    );
    return page.evaluate(async () => {
      const gm = window.gameManager;
      await gm.sceneAutosave.flush();
      const mesh = gm.threeSceneManager.scene.getObjectByName('TerrainMesh');
      const positions = mesh?.geometry?.attributes?.position;
      if (!positions?.count) throw new Error('Salt Flats terrain did not render');
      const ys = new Set();
      for (let index = 0; index < positions.count; index++) ys.add(positions.getY(index));
      return {
        terrain: gm.terrainEngine.save(),
        renderedHeights: [...ys].sort((a, b) => a - b),
      };
    });
  };
  const gentle = await generate('gentle', 0.7);
  const dramatic = await generate('dramatic', 1.4);
  expect(dramatic.terrain.biomeSeed).toBe(gentle.terrain.biomeSeed);
  expect(dramatic.terrain.heights).not.toEqual(gentle.terrain.heights);
  const span = (heights) => heights.at(-1) - heights[0];
  expect(span(dramatic.renderedHeights)).toBeGreaterThan(span(gentle.renderedHeights) + 0.05);
  await reopen();
  expect(await page.evaluate(() => window.gameManager.terrainEngine.save())).toEqual(
    dramatic.terrain
  );
});

for (const [biomeKey, size, structures, seed] of [
  ['castle', 50, true, 42],
  ['mountainCastle', 25, true, 42],
  ['city', 12, true, 42],
  ['riverLake', 12, false, 42],
  ['graveyard', 12, false, 7],
]) {
  test(`${biomeKey} density survives staged generation and reopening`, async ({ page }) => {
    test.setTimeout(180000);
    const campaignName = `Playwright ${biomeKey} density`;
    await page.goto(hostURL);
    const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
    await login.getByLabel('Host access key').fill(hostKey);
    await login.getByRole('button', { name: 'Sign in as host' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
    await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
    await picker.getByLabel('Campaign ruleset').selectOption('2014');
    await picker.getByRole('button', { name: 'Create & open campaign' }).click();
    await page.waitForFunction(
      () =>
        window.gameManager?.sceneAutosave?.ready &&
        !window.gameManager.sceneAutosave.dirty &&
        !window.gameManager.sceneAutosave.writing
    );
    const generated = await page.evaluate(
      async ({ biomeKey, size, structures, seed }) => {
        const gm = window.gameManager;
        const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
        const { normalizeBiomeGenerationChoices } =
          await import('/src/config/biome/BiomeGenerationFamilies.js');
        const generate = async (density) => {
          await replaceCampaignBiome(
            gm,
            {
              ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, density }),
              seed,
              structures,
            },
            { cols: size, rows: size }
          );
          await gm.placeableMeshPool.whenSettled();
          const placements = await gm.placeableMeshPool.snapshotPlacements();
          const grounded = [];
          const three = gm.threeSceneManager.three;
          for (const [key, entries] of gm.placeableMeshPool._metadata) {
            const group = gm.placeableMeshPool._groups.get(key);
            if (!group.supportBounds)
              throw new Error('A generated tree has no ground support bounds');
            const mesh = group.instancedMesh;
            mesh.updateWorldMatrix(true, false);
            for (const [index, entry] of entries) {
              const matrix = new three.Matrix4();
              mesh.getMatrixAt(index, matrix);
              matrix.premultiply(mesh.matrixWorld);
              const bottom = group.supportBounds.clone().applyMatrix4(matrix).min.y;
              const floor = gm.getTerrainHeight(entry.gx, entry.gy) * gm.spatial.elevationUnit;
              grounded.push(Math.abs(bottom - floor) < 0.01 * gm.spatial.tileWorldSize);
            }
          }
          return { placements, grounded };
        };
        const sparse = await generate('sparse');
        const dense = await generate('dense');
        await gm.sceneAutosave.flush();
        return { sparse, dense };
      },
      { biomeKey, size, structures, seed }
    );
    expect(generated.dense.placements.length).toBeGreaterThan(generated.sparse.placements.length);
    expect(generated.dense.grounded.length).toBe(generated.dense.placements.length);
    expect(generated.dense.grounded.every(Boolean)).toBe(true);

    await page.reload();
    await page
      .getByRole('dialog', { name: 'Choose your campaign' })
      .locator('article', { hasText: campaignName })
      .getByRole('button', { name: 'Open', exact: true })
      .click();
    await page.waitForFunction(
      (key) =>
        window.gameManager?.sceneAutosave?.ready &&
        window.gameManager?.terrainEngine?.biomeKey === key,
      biomeKey
    );
    const reopened = await page.evaluate(async () => {
      await window.gameManager.placeableMeshPool.whenSettled();
      return window.gameManager.placeableMeshPool.snapshotPlacements();
    });
    const signature = (placements) =>
      [...placements].sort(
        (a, b) =>
          a.gridY - b.gridY || a.gridX - b.gridX || a.placeableId.localeCompare(b.placeableId)
      );
    expect(signature(reopened)).toEqual(signature(generated.dense.placements));
  });
}

test('water surfaces render for host and player without changing terrain picking or saves', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright water surface';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const setup = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    const { normalizeBiomeGenerationChoices } =
      await import('/src/config/biome/BiomeGenerationFamilies.js');
    await replaceCampaignBiome(
      gm,
      {
        ...normalizeBiomeGenerationChoices('riverLake', { variant: 'riverLake' }),
        seed: 42,
        densityMultiplier: 0,
        structures: false,
      },
      { cols: 25, rows: 25 }
    );
    const manager = gm.threeSceneManager;
    const initialWater = manager.scene.getObjectByName('TerrainWater');
    if (!initialWater) throw new Error('The generated lake has no water surface');
    const generatedTerrain = JSON.stringify(gm.terrainEngine.save());
    const wet = [];
    let dry = null;
    for (let z = 0; z < gm.rows; z++)
      for (let x = 0; x < gm.cols; x++) {
        const height = gm.getTerrainHeight(x, z);
        if (height < 0) wet.push({ x, z, height });
        else if (!dry && height === 0) dry = { x, z };
      }
    if (!wet.length || !dry) throw new Error('The lake fixture needs both water and dry ground');
    const library = gm.characterServices.library;
    const id = await library.create('Water viewer');
    await library.flush();
    const creature = gm.tokenManager.createCreatureByType('mannequin');
    gm.tokenManager.addTokenToCollection(creature, dry.x, dry.z, 'mannequin');
    const token = gm.placedTokens.at(-1);
    const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
    linkTokenCharacter(token, library, id);
    await token.__threeMeshPromise;
    await gm.sceneAutosave.flush();
    const invitation = await library.store.sessionCall('createInvite', [
      gm.campaign.id,
      { name: 'Water player' },
    ]);
    await library.store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
    manager.setTopDownView(true);
    const point = new manager.three.Vector3(wet[0].x + 0.5, 0, wet[0].z + 0.5);
    manager.camera.position.set(point.x, 30, point.z);
    manager.camera.lookAt(point);
    manager.camera.updateMatrixWorld(true);
    const ndc = point.clone().project(manager.camera);
    const rect = manager.canvas.getBoundingClientRect();
    const picked = gm.pickingService.pickGroundSync(
      rect.left + ((ndc.x + 1) * rect.width) / 2,
      rect.top + ((1 - ndc.y) * rect.height) / 2,
      manager.canvas
    );
    const water = manager.scene.getObjectByName('TerrainWater');
    if (!water) throw new Error('The lake water disappeared after the scene update');
    const gl = manager.renderer.getContext();
    const pixels = () => {
      manager.renderer.render(manager.scene, manager.camera);
      const values = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        values
      );
      return values;
    };
    const withWater = pixels();
    water.visible = false;
    const withoutWater = pixels();
    water.visible = true;
    manager.renderer.render(manager.scene, manager.camera);
    const normalOpacity = water.material.opacity;
    manager.setTerrainMeshOpacity(0.5);
    const fadedOpacity = water.material.opacity;
    manager.setTerrainMeshOpacity(1);
    let changedPixels = 0;
    for (let index = 0; index < withWater.length; index += 4)
      if (
        Math.abs(withWater[index] - withoutWater[index]) +
          Math.abs(withWater[index + 1] - withoutWater[index + 1]) +
          Math.abs(withWater[index + 2] - withoutWater[index + 2]) >
        9
      )
        changedPixels++;
    return {
      invite: invitation.invite,
      wet: wet[0],
      picked: picked?.grid,
      pickedHeight: picked?.world.y,
      groundHeight: wet[0].height * gm.spatial.elevationUnit,
      terrain: JSON.stringify(gm.terrainEngine.save()),
      changedPixels,
      sameSurface: initialWater === water,
      sameTerrain: generatedTerrain === JSON.stringify(gm.terrainEngine.save()),
      normalOpacity,
      fadedOpacity,
    };
  });
  expect(setup.picked).toEqual({ gx: setup.wet.x, gy: setup.wet.z });
  expect(setup.pickedHeight).toBeCloseTo(setup.groundHeight, 5);
  expect(setup.changedPixels).toBeGreaterThan(100);
  expect(setup.sameTerrain).toBe(true);
  expect(setup.sameSurface).toBe(true);
  expect(setup.fadedOpacity).toBeLessThan(setup.normalOpacity);
  expect(await page.evaluate(() => JSON.stringify(window.gameManager.terrainEngine.save()))).toBe(
    setup.terrain
  );

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const player = await context.newPage();
    await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(setup.invite)}`);
    await player.waitForFunction(
      () =>
        window.gameManager?.publicPlayerPresentation &&
        window.gameManager?.threeSceneManager?.scene.getObjectByName('TerrainWater')
    );
    const playerView = await player.evaluate(({ x, z, height }) => {
      const gm = window.gameManager;
      const manager = gm.threeSceneManager;
      const water = manager.scene.getObjectByName('TerrainWater');
      manager.setTopDownView(true);
      const point = new manager.three.Vector3(x + 0.5, 0, z + 0.5);
      manager.camera.position.set(point.x, 30, point.z);
      manager.camera.lookAt(point);
      manager.camera.updateMatrixWorld(true);
      const ndc = point.clone().project(manager.camera);
      const rect = manager.canvas.getBoundingClientRect();
      const picked = gm.pickingService.pickGroundSync(
        rect.left + ((ndc.x + 1) * rect.width) / 2,
        rect.top + ((1 - ndc.y) * rect.height) / 2,
        manager.canvas
      );
      return {
        opacity: water.material.opacity,
        grid: picked?.grid,
        pickedHeight: picked?.world.y,
        groundHeight: height * gm.spatial.elevationUnit,
      };
    }, setup.wet);
    expect(playerView.opacity).toBeGreaterThan(0);
    expect(playerView.grid).toEqual({ gx: setup.wet.x, gy: setup.wet.z });
    expect(playerView.pickedHeight).toBeCloseTo(playerView.groundHeight, 5);
  } finally {
    await context.close();
  }
  await page.reload();
  await page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.threeSceneManager?.scene.getObjectByName('TerrainWater')
  );
  expect(await page.evaluate(() => JSON.stringify(window.gameManager.terrainEngine.save()))).toBe(
    setup.terrain
  );
  const previousWaterId = await page.evaluate(
    () => window.gameManager.threeSceneManager.scene.getObjectByName('TerrainWater').uuid
  );
  await page.evaluate(
    ({ x, z }) => window.gameManager.terrainEngine.setHeightAt(x, z, 0),
    setup.wet
  );
  await page.waitForFunction(
    (previous) =>
      window.gameManager.threeSceneManager.scene.getObjectByName('TerrainWater')?.uuid !== previous,
    previousWaterId
  );
  const raisedStillCovered = await page.evaluate(({ x, z }) => {
    const manager = window.gameManager.threeSceneManager;
    const water = manager.scene.getObjectByName('TerrainWater');
    const ray = new manager.three.Raycaster(
      new manager.three.Vector3(x + 0.5, 10, z + 0.5),
      new manager.three.Vector3(0, -1, 0)
    );
    const hits = [];
    water.updateWorldMatrix(true, false);
    manager.three.Mesh.prototype.raycast.call(water, ray, hits);
    return hits.length > 0;
  }, setup.wet);
  expect(raisedStillCovered).toBe(false);
  await page.evaluate(() =>
    window.gameManager.terrainEngine.setBiome('grassland', { generateIfFlat: false })
  );
  await page.waitForFunction(
    () => !window.gameManager.threeSceneManager.scene.getObjectByName('TerrainWater')
  );
});

test('water remains visible in a connected building view', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Playwright projected water');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const result = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    const { changeCampaignView } = await import('/src/campaigns/SceneWorld.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'riverLake', seed: 42, densityMultiplier: 0, structures: false, waterBias: 0 },
      { cols: 25, rows: 25 }
    );
    for (let z = 8; z <= 16; z++)
      for (let x = 8; x <= 16; x++) gm.terrainEngine.setHeightAt(x, z, 0);
    await gm.sceneAutosave.flush();
    gm.terrainEngine.placeStructure({
      id: 'water-house',
      kind: 'building',
      xFeet: 60,
      zFeet: 60,
      heightFeet: 10,
      lengthFeet: 30,
      widthFeet: 25,
      building: { roof: 'flat', stairs: false, autoWindows: false },
    });
    await gm.sceneAutosave.flush();
    const owner = gm.campaignMapId;
    const floor = gm.campaignWorld
      .save()
      .maps.find((map) => map.building?.structureId === 'water-house');
    if (!floor) throw new Error('The water fixture has no connected building floor');
    await changeCampaignView(gm, { mapId: floor.id });
    await gm.token3DAdapter.syncMapProjections();
    const manager = gm.threeSceneManager;
    const water = manager.scene.getObjectByName(`MapProjectionWater:${owner}`);
    if (!water?.visible) throw new Error('The connected view has no projected water');
    const positions = water.geometry.getAttribute('position');
    if (positions.count < 3) throw new Error('The projected water has no visible surface');
    const target = new manager.three.Vector3()
      .fromBufferAttribute(positions, 0)
      .add(new manager.three.Vector3().fromBufferAttribute(positions, 1))
      .add(new manager.three.Vector3().fromBufferAttribute(positions, 2))
      .divideScalar(3);
    manager.setTopDownView(true);
    manager.camera.position.set(target.x, 30, target.z);
    manager.camera.lookAt(target);
    manager.camera.updateMatrixWorld(true);
    const gl = manager.renderer.getContext();
    const pixels = () => {
      manager.renderer.render(manager.scene, manager.camera);
      const values = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        values
      );
      return values;
    };
    const visible = pixels();
    water.visible = false;
    const hidden = pixels();
    water.visible = true;
    let changed = 0;
    for (let index = 0; index < visible.length; index += 4)
      if (
        Math.abs(visible[index] - hidden[index]) +
          Math.abs(visible[index + 1] - hidden[index + 1]) +
          Math.abs(visible[index + 2] - hidden[index + 2]) >
        9
      )
        changed++;
    return { changed, mapId: gm.campaignMapId, floorId: floor.id };
  });
  expect(result.mapId).toBe(result.floorId);
  expect(result.changed).toBeGreaterThan(100);
});

test('wet Blood Marsh retains supported density-controlled scenery', async ({ page }) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright Blood Marsh density';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const result = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    const { normalizeBiomeGenerationChoices } =
      await import('/src/config/biome/BiomeGenerationFamilies.js');
    const generate = async (density, size, seed) => {
      await replaceCampaignBiome(
        gm,
        {
          ...normalizeBiomeGenerationChoices('bloodMarsh', {
            variant: 'bloodMarsh',
            moisture: 'wet',
            density,
          }),
          seed,
          structures: false,
        },
        { cols: size, rows: size }
      );
      await gm.placeableMeshPool.whenSettled();
      await gm.sceneAutosave.flush();
      const placements = await gm.placeableMeshPool.snapshotPlacements();
      const feetPerWorld = 5 / gm.spatial.tileWorldSize;
      const supported = placements.every(({ gridX, gridY }) => {
        const height = gm.getTerrainHeight(gridX, gridY);
        const feet = height * gm.spatial.elevationUnit * feetPerWorld;
        const support = gm.terrainEngine.geometry.findSupport(
          (gridX + 0.5) * 5,
          (gridY + 0.5) * 5,
          {
            belowFeet: feet + 1e-6,
          }
        );
        return height >= -2 && support && Math.abs(support.heightFeet - feet) < 1e-5;
      });
      const three = gm.threeSceneManager.three;
      const grounded = [];
      for (const [key, entries] of gm.placeableMeshPool._metadata) {
        const group = gm.placeableMeshPool._groups.get(key);
        if (!group.supportBounds) continue;
        const mesh = group.instancedMesh;
        mesh.updateWorldMatrix(true, false);
        for (const [index, entry] of entries) {
          const matrix = new three.Matrix4();
          mesh.getMatrixAt(index, matrix);
          matrix.premultiply(mesh.matrixWorld);
          const bottom = group.supportBounds.clone().applyMatrix4(matrix).min.y;
          const floor = gm.getTerrainHeight(entry.gx, entry.gy) * gm.spatial.elevationUnit;
          grounded.push(Math.abs(bottom - floor) < 0.01 * gm.spatial.tileWorldSize);
        }
      }
      return { placements, supported, grounded, terrain: gm.terrainEngine.save() };
    };
    return {
      sparse: await generate('sparse', 12, 42),
      dense: await generate('dense', 12, 42),
      small: await generate('dense', 5, 0),
    };
  });
  expect(result.dense.placements.length).toBeGreaterThan(result.sparse.placements.length);
  expect(result.dense.supported).toBe(true);
  expect(result.dense.grounded.length).toBeGreaterThan(0);
  expect(result.dense.grounded.every(Boolean)).toBe(true);
  expect(result.small.placements.length).toBeGreaterThan(0);
  expect(result.small.supported).toBe(true);
  expect(result.small.grounded.length).toBeGreaterThan(0);
  expect(result.small.grounded.every(Boolean)).toBe(true);
  await page.reload();
  await page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.terrainEngine?.biomeKey === 'bloodMarsh'
  );
  const restored = await page.evaluate(async () => ({
    terrain: window.gameManager.terrainEngine.save(),
    placements: await window.gameManager.placeableMeshPool.snapshotPlacements(),
  }));
  expect(restored.terrain).toEqual(result.small.terrain);
  const signature = (placements) =>
    [...placements].sort(
      (a, b) =>
        (a.modelKey || '').localeCompare(b.modelKey || '') || a.gridY - b.gridY || a.gridX - b.gridX
    );
  expect(signature(restored.placements)).toEqual(signature(result.small.placements));
});

test('Swamp and Wetlands keep wet pockets and grounded scenery', async ({ page, browser }) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright wetland scenery';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const result = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    const { normalizeBiomeGenerationChoices } =
      await import('/src/config/biome/BiomeGenerationFamilies.js');
    const generate = async (biomeKey, density, moisture, size) => {
      await replaceCampaignBiome(
        gm,
        {
          ...normalizeBiomeGenerationChoices(biomeKey, {
            variant: biomeKey,
            density,
            moisture,
          }),
          seed: 42,
          structures: false,
        },
        { cols: size, rows: size }
      );
      await gm.placeableMeshPool.whenSettled();
      await gm.sceneAutosave.flush();
      const placements = await gm.placeableMeshPool.snapshotPlacements();
      const grounded = [];
      const three = gm.threeSceneManager.three;
      for (const [key, entries] of gm.placeableMeshPool._metadata) {
        const group = gm.placeableMeshPool._groups.get(key);
        if (!group.supportBounds) continue;
        const mesh = group.instancedMesh;
        mesh.updateWorldMatrix(true, false);
        for (const [index, entry] of entries) {
          const matrix = new three.Matrix4();
          mesh.getMatrixAt(index, matrix);
          matrix.premultiply(mesh.matrixWorld);
          const bottom = group.supportBounds.clone().applyMatrix4(matrix).min.y;
          const floor = gm.getTerrainHeight(entry.gx, entry.gy) * gm.spatial.elevationUnit;
          grounded.push(Math.abs(bottom - floor) < 0.01 * gm.spatial.tileWorldSize);
        }
      }
      const terrain = gm.terrainEngine.save();
      return {
        placements,
        grounded,
        terrain,
        wet: terrain.heights.flat().some((height) => height < 0),
      };
    };
    return {
      small: await generate('swamp', 'dense', 'dry', 5),
      swamp: await generate('swamp', 'dense', 'wet', 12),
      sparse: await generate('wetlands', 'sparse', 'wet', 25),
      dense: await generate('wetlands', 'dense', 'wet', 25),
    };
  });
  for (const generated of [result.small, result.swamp, result.dense]) {
    expect(generated.wet).toBe(true);
    expect(generated.placements.length).toBeGreaterThan(0);
    expect(generated.grounded.length).toBeGreaterThan(0);
    expect(generated.grounded.every(Boolean)).toBe(true);
  }
  expect(result.dense.placements.length).toBeGreaterThan(result.sparse.placements.length);
  const invite = await page.evaluate(async () => {
    const gm = window.gameManager;
    const library = gm.characterServices.library;
    const id = await library.create('Wetlands explorer');
    await library.flush();
    const placements = await gm.placeableMeshPool.snapshotPlacements();
    const occupied = new Set(placements.map(({ gridX, gridY }) => `${gridX}:${gridY}`));
    let cell = null;
    for (let y = 0; y < gm.rows && !cell; y++)
      for (let x = 0; x < gm.cols; x++)
        if (!occupied.has(`${x}:${y}`)) {
          cell = { x, y };
          break;
        }
    if (!cell) throw new Error('No open Wetlands cell for a player');
    const creature = gm.tokenManager.createCreatureByType('mannequin');
    gm.tokenManager.addTokenToCollection(creature, cell.x, cell.y, 'mannequin');
    const token = gm.placedTokens.at(-1);
    const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
    linkTokenCharacter(token, library, id);
    await token.__threeMeshPromise;
    await gm.sceneAutosave.flush();
    const invitation = await library.store.sessionCall('createInvite', [
      gm.campaign.id,
      { name: 'Wetlands player' },
    ]);
    await library.store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
    return invitation.invite;
  });
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const player = await playerContext.newPage();
    await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(invite)}`);
    await player.waitForFunction(
      () =>
        window.gameManager?.terrainEngine?.biomeKey === 'wetlands' &&
        window.gameManager?.placeableMeshPool?._metadata?.size > 0
    );
    const playerView = await player.evaluate(async () => {
      const gm = window.gameManager;
      await gm.placeableMeshPool.whenSettled();
      return {
        heights: gm.terrainEngine.save().heights,
        placements: await gm.placeableMeshPool.snapshotPlacements(),
      };
    });
    expect(playerView.heights).toEqual(result.dense.terrain.heights);
    expect(playerView.placements.length).toBeGreaterThan(0);
  } finally {
    await playerContext.close();
  }
  await page.reload();
  await page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName })
    .getByRole('button', { name: 'Open', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.terrainEngine?.biomeKey === 'wetlands'
  );
  const restored = await page.evaluate(async () => ({
    terrain: window.gameManager.terrainEngine.save(),
    placements: await window.gameManager.placeableMeshPool.snapshotPlacements(),
  }));
  const signature = (placements) =>
    [...placements].sort(
      (a, b) =>
        (a.modelKey || '').localeCompare(b.modelKey || '') || a.gridY - b.gridY || a.gridX - b.gridX
    );
  expect(restored.terrain).toEqual(result.dense.terrain);
  expect(signature(restored.placements)).toEqual(signature(result.dense.placements));
});

for (const [biomeKey, seed, relief, belowZero] of [
  ['steppe', 1, 'balanced', false],
  ['tundra', 7, 'balanced', false],
  ['screeSlope', 2, 'gentle', true],
]) {
  test(`${biomeKey} density includes supported terrain`, async ({ page }) => {
    test.setTimeout(120000);
    const campaignName = `Playwright ${biomeKey} level scenery`;
    await page.goto(hostURL);
    const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
    await login.getByLabel('Host access key').fill(hostKey);
    await login.getByRole('button', { name: 'Sign in as host' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
    await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
    await picker.getByLabel('Campaign ruleset').selectOption('2014');
    await picker.getByRole('button', { name: 'Create & open campaign' }).click();
    await page.waitForFunction(
      () =>
        window.gameManager?.sceneAutosave?.ready &&
        !window.gameManager.sceneAutosave.dirty &&
        !window.gameManager.sceneAutosave.writing
    );
    const generated = await page.evaluate(
      async ({ key, fixedSeed, reliefChoice, allowBelowZero }) => {
        const gm = window.gameManager;
        const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
        const { normalizeBiomeGenerationChoices } =
          await import('/src/config/biome/BiomeGenerationFamilies.js');
        const generate = async (density) => {
          await replaceCampaignBiome(
            gm,
            {
              ...normalizeBiomeGenerationChoices(key, {
                variant: key,
                density,
                relief: reliefChoice,
              }),
              seed: fixedSeed,
              structures: false,
            },
            { cols: 12, rows: 12 }
          );
          await gm.placeableMeshPool.whenSettled();
          await gm.sceneAutosave.flush();
          const placements = await gm.placeableMeshPool.snapshotPlacements();
          const grounded = [];
          const three = gm.threeSceneManager.three;
          for (const [key, entries] of gm.placeableMeshPool._metadata) {
            const group = gm.placeableMeshPool._groups.get(key);
            if (!group.supportBounds) continue;
            const mesh = group.instancedMesh;
            mesh.updateWorldMatrix(true, false);
            for (const [index, entry] of entries) {
              const matrix = new three.Matrix4();
              mesh.getMatrixAt(index, matrix);
              matrix.premultiply(mesh.matrixWorld);
              const bottom = group.supportBounds.clone().applyMatrix4(matrix).min.y;
              const floor = gm.getTerrainHeight(entry.gx, entry.gy) * gm.spatial.elevationUnit;
              grounded.push(Math.abs(bottom - floor) < 0.01 * gm.spatial.tileWorldSize);
            }
          }
          return {
            placements,
            grounded,
            level: placements.filter(({ gridX, gridY }) => gm.getTerrainHeight(gridX, gridY) === 0)
              .length,
            below: placements.filter(({ gridX, gridY }) => gm.getTerrainHeight(gridX, gridY) < 0)
              .length,
            supported: placements.every(
              ({ gridX, gridY }) =>
                Number.isFinite(gm.getTerrainHeight(gridX, gridY)) &&
                (allowBelowZero || gm.getTerrainHeight(gridX, gridY) >= 0)
            ),
            terrain: gm.terrainEngine.save(),
          };
        };
        return { sparse: await generate('sparse'), dense: await generate('dense') };
      },
      { key: biomeKey, fixedSeed: seed, reliefChoice: relief, allowBelowZero: belowZero }
    );
    expect(generated.dense.placements.length).toBeGreaterThan(generated.sparse.placements.length);
    expect(belowZero ? generated.dense.below : generated.dense.level).toBeGreaterThan(0);
    expect(generated.dense.supported).toBe(true);
    expect(generated.dense.grounded.length).toBeGreaterThan(0);
    expect(generated.dense.grounded.every(Boolean)).toBe(true);
    await page.reload();
    await page
      .getByRole('dialog', { name: 'Choose your campaign' })
      .locator('article', { hasText: campaignName })
      .getByRole('button', { name: 'Open', exact: true })
      .click();
    await page.waitForFunction(
      (key) =>
        window.gameManager?.sceneAutosave?.ready &&
        window.gameManager?.terrainEngine?.biomeKey === key,
      biomeKey
    );
    expect(await page.evaluate(() => window.gameManager.terrainEngine.save())).toEqual(
      generated.dense.terrain
    );
  });
}

test('Fungal Grove mushrooms render for host and player and survive reopening', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright fungal mushroom models';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  const host = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(gm, { biomeKey: 'fungalGrove', seed: 42 }, { cols: 25, rows: 25 });
    await gm.placeableMeshPool.whenSettled();
    gm.threeSceneManager.refreshLocalLighting();
    await gm.sceneAutosave.flush();
    const three = gm.threeSceneManager.three;
    const { naturalCavernRoutes } = await import('/src/terrain/generation/CavernInteriors.js');
    const routes = naturalCavernRoutes({
      cols: gm.cols,
      rows: gm.rows,
      getHeight: (x, z) => gm.getTerrainHeight(x, z),
      exits: gm.terrainEngine.cavern.exits,
      seed: gm.terrainEngine.cavern.seed,
    });
    const tile = gm.spatial.tileWorldSize;
    const routeBodies = routes.flatMap(({ cells }) =>
      cells.map(({ x, z }) => {
        const floor = gm.getTerrainHeight(x, z) * gm.spatial.elevationUnit;
        return new three.Box3(
          new three.Vector3(x * tile, floor, z * tile),
          new three.Vector3((x + 1) * tile, floor + tile, (z + 1) * tile)
        );
      })
    );
    const models = [];
    for (const [key, entries] of gm.placeableMeshPool._metadata) {
      const group = gm.placeableMeshPool._groups.get(key);
      const mesh = group.instancedMesh;
      mesh.updateWorldMatrix(true, false);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const [index, entry] of entries) {
        if (!/^mushroom-(glow|giant-cap)$/.test(entry.source.modelKey || '')) continue;
        const matrix = new three.Matrix4();
        mesh.getMatrixAt(index, matrix);
        matrix.premultiply(mesh.matrixWorld);
        const box = mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
        models.push({
          modelKey: entry.source.modelKey,
          bottom: box.min.y,
          floor: gm.getTerrainHeight(entry.gx, entry.gy) * gm.spatial.elevationUnit,
          height: box.max.y - box.min.y,
          visible: mesh.visible && mesh.count > index,
          textured: materials.every((material) => material.map?.image?.complete),
          emissive: materials.every((material) => material.emissiveIntensity > 0),
          blocksRoute: routeBodies.some((body) => {
            const common = body.clone().intersect(box);
            return (
              !common.isEmpty() &&
              common.max.x - common.min.x > 1e-6 &&
              common.max.y - common.min.y > 1e-6 &&
              common.max.z - common.min.z > 1e-6
            );
          }),
        });
      }
    }
    const placements = (await gm.placeableMeshPool.snapshotPlacements()).filter(({ modelKey }) =>
      /^mushroom-(glow|giant-cap)$/.test(modelKey || '')
    );
    return {
      models,
      placements,
      lights:
        gm.threeSceneManager.scene.getObjectByName('UndergroundLocalLights')?.children.length || 0,
    };
  });
  for (const key of ['mushroom-glow', 'mushroom-giant-cap']) {
    const models = host.models.filter((model) => model.modelKey === key);
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.visible).toBe(true);
      expect(model.textured).toBe(true);
      expect(model.bottom).toBeCloseTo(model.floor, 4);
      expect(model.blocksRoute).toBe(false);
      if (key === 'mushroom-glow') expect(model.emissive).toBe(true);
    }
  }
  expect(
    host.models.find((model) => model.modelKey === 'mushroom-giant-cap').height
  ).toBeGreaterThan(host.models.find((model) => model.modelKey === 'mushroom-glow').height * 3);
  expect(host.lights).toBeGreaterThan(0);
  const invite = await page.evaluate(async () => {
    const gm = window.gameManager;
    const library = gm.characterServices.library;
    const id = await library.create('Fungal Grove explorer');
    await library.flush();
    const creature = gm.tokenManager.createCreatureByType('mannequin');
    gm.tokenManager.addTokenToCollection(creature, 12, 12, 'mannequin');
    const token = gm.placedTokens.at(-1);
    const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
    linkTokenCharacter(token, library, id);
    await token.__threeMeshPromise;
    await gm.sceneAutosave.flush();
    const invitation = await library.store.sessionCall('createInvite', [
      gm.campaign.id,
      { name: 'Fungal Grove player' },
    ]);
    await library.store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
    return invitation.invite;
  });
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const player = await playerContext.newPage();
    await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(invite)}`);
    await player.waitForFunction(() => {
      const entries = [
        ...(window.gameManager?.placeableMeshPool?._metadata?.values() || []),
      ].flatMap((group) => [...group.values()]);
      return ['mushroom-glow', 'mushroom-giant-cap'].every((key) =>
        entries.some(({ source }) => source.modelKey === key)
      );
    });
    const playerView = await player.evaluate(async () => {
      const gm = window.gameManager;
      await gm.placeableMeshPool.whenSettled();
      const placements = (await gm.placeableMeshPool.snapshotPlacements()).filter(({ modelKey }) =>
        /^mushroom-(glow|giant-cap)$/.test(modelKey || '')
      );
      const groups = [...gm.placeableMeshPool._groups.entries()].filter(([key]) =>
        /^mushroom-(glow|giant-cap)$/.test(key)
      );
      return {
        placements,
        groupCount: groups.length,
        visible: groups.every(
          ([, group]) => group.instancedMesh.visible && group.instancedMesh.count > 0
        ),
      };
    });
    expect(playerView.groupCount).toBe(2);
    expect(playerView.visible).toBe(true);
    expect(new Set(playerView.placements.map(({ modelKey }) => modelKey))).toEqual(
      new Set(['mushroom-glow', 'mushroom-giant-cap'])
    );
    for (const mushroom of playerView.placements)
      expect(host.placements).toContainEqual(
        expect.objectContaining({
          modelKey: mushroom.modelKey,
          gridX: mushroom.gridX,
          gridY: mushroom.gridY,
          persistedScale: mushroom.persistedScale,
        })
      );
  } finally {
    await playerContext.close();
  }
  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.terrainEngine?.biomeKey === 'fungalGrove'
  );
  const restored = await page.evaluate(async () =>
    (await window.gameManager.placeableMeshPool.snapshotPlacements()).filter(({ modelKey }) =>
      /^mushroom-(glow|giant-cap)$/.test(modelKey || '')
    )
  );
  const signature = (placements) =>
    placements
      .map(({ modelKey, gridX, gridY, persistedScale }) => ({
        modelKey,
        gridX,
        gridY,
        persistedScale,
      }))
      .sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
  expect(signature(restored)).toEqual(signature(host.placements));
});

for (const biomeKey of ['cavern', 'crystalSpires']) {
  test(`${biomeKey} formations render for host and player and survive reopening`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120000);
    const campaignName = `Playwright ${biomeKey} formations`;
    await page.goto(hostURL);
    const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
    await login.getByLabel('Host access key').fill(hostKey);
    await login.getByRole('button', { name: 'Sign in as host' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
    await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
    await picker.getByLabel('Campaign ruleset').selectOption('2014');
    await picker.getByRole('button', { name: 'Create & open campaign' }).click();
    await page.waitForFunction(
      () =>
        window.gameManager?.sceneAutosave?.ready &&
        !window.gameManager.sceneAutosave.dirty &&
        !window.gameManager.sceneAutosave.writing
    );
    const host = await page.evaluate(async (key) => {
      const gm = window.gameManager;
      const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
      const { cavernEntranceCells } = await import('/src/terrain/generation/CavernInteriors.js');
      await replaceCampaignBiome(gm, { biomeKey: key, seed: 42 }, { cols: 25, rows: 25 });
      await gm.placeableMeshPool.whenSettled();
      gm.threeSceneManager.refreshLocalLighting();
      await gm.sceneAutosave.flush();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      while (gm.terrainRebuilder._timer)
        await new Promise((resolve) => requestAnimationFrame(resolve));
      const pool = gm.placeableMeshPool;
      const three = gm.threeSceneManager.three;
      const terrainMesh = gm.threeSceneManager.scene.getObjectByName('TerrainMesh');
      const gridPositions = gm.threeSceneManager.scene
        .getObjectByName('GridLineFrame')
        .geometry.getAttribute('position');
      const passages = new Set(
        gm.terrainEngine.cavern.exits.flatMap((side) =>
          cavernEntranceCells(side, 25, 25).map(({ x, z }) => `${x}:${z}`)
        )
      );
      const measurements = [];
      for (const [groupKey, entries] of pool._metadata) {
        const group = pool._groups.get(groupKey);
        const mesh = group.instancedMesh;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        mesh.updateMatrixWorld(true);
        for (const [index, entry] of entries) {
          if (!/^source-cave-(stalagmite|column)$/.test(entry.source.modelKey || '')) continue;
          const matrix = new three.Matrix4();
          mesh.getMatrixAt(index, matrix);
          matrix.premultiply(mesh.matrixWorld);
          const box = mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
          const support = group.supportBounds.clone().applyMatrix4(matrix);
          const size = box.getSize(new three.Vector3());
          const tile = gm.spatial.tileWorldSize;
          const level = gm.getTerrainHeight(entry.gx, entry.gy);
          let supported = true;
          for (
            let z = Math.floor((support.min.z + 1e-6) / tile);
            z <= Math.floor((support.max.z - 1e-6) / tile);
            z++
          )
            for (
              let x = Math.floor((support.min.x + 1e-6) / tile);
              x <= Math.floor((support.max.x - 1e-6) / tile);
              x++
            )
              if (
                x < 0 ||
                z < 0 ||
                x >= gm.cols ||
                z >= gm.rows ||
                gm.getTerrainHeight(x, z) !== level
              )
                supported = false;
          const center = gm.spatial.gridToWorld(entry.gx + 0.5, entry.gy + 0.5, 0);
          const hit = new three.Raycaster(
            new three.Vector3(center.x, 100, center.z),
            new three.Vector3(0, -1, 0)
          ).intersectObject(terrainMesh, false)[0];
          const gridHeights = [];
          for (let i = 0; i < gridPositions.count; i += 2) {
            const x = gridPositions.getX(i);
            const z = gridPositions.getZ(i);
            const x2 = gridPositions.getX(i + 1);
            const z2 = gridPositions.getZ(i + 1);
            if (
              x === entry.gx &&
              z === entry.gy &&
              ((x2 === x + 1 && z2 === z) || (x2 === x && z2 === z + 1))
            )
              gridHeights.push(gridPositions.getY(i));
          }
          measurements.push({
            width: size.x,
            height: size.y,
            depth: size.z,
            minX: box.min.x - center.x,
            maxX: box.max.x - center.x,
            minZ: box.min.z - center.z,
            maxZ: box.max.z - center.z,
            bottom: box.min.y,
            floor: gm.getTerrainHeight(entry.gx, entry.gy) * gm.spatial.elevationUnit,
            terrain: hit?.point.y ?? null,
            supported,
            gridHeights,
            passage: passages.has(`${entry.gx}:${entry.gy}`),
          });
        }
      }
      const placements = (await pool.snapshotPlacements()).filter(({ modelKey }) =>
        /^source-cave-(stalagmite|column)$/.test(modelKey || '')
      );
      const map = gm.campaignWorld.save().maps.find(({ id }) => id === gm.campaignMapId);
      return {
        placements,
        measurements,
        depthGroups: [...pool._groups.values()]
          .filter(({ instancedMesh }) => instancedMesh.name.startsWith('Placeables:source-cave-'))
          .map(({ instancedMesh, depthPrepass }) => ({
            count: instancedMesh.count,
            depthCount: depthPrepass?.count ?? null,
            textured: (Array.isArray(instancedMesh.material)
              ? instancedMesh.material
              : [instancedMesh.material]
            ).every((material) => Boolean(material.map?.image)),
          })),
        sightCount: map.terrain.sightBounds.length,
        lights:
          gm.threeSceneManager.scene.getObjectByName('UndergroundLocalLights')?.children.length ||
          0,
        tileSize: gm.spatial.tileWorldSize,
      };
    }, biomeKey);
    expect(host.placements.length).toBeGreaterThan(0);
    expect(host.measurements).toHaveLength(host.placements.length);
    expect(host.depthGroups.length).toBeGreaterThan(0);
    expect(host.depthGroups.every(({ textured }) => textured)).toBe(true);
    const sizes = host.placements.map(({ persistedScale }) => persistedScale.y);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(2);
    expect(
      host.placements.some(
        ({ gridOffsetX, gridOffsetY }) => Math.abs(gridOffsetX) > 0.2 || Math.abs(gridOffsetY) > 0.2
      )
    ).toBe(true);
    expect(
      host.measurements.some(
        ({ minX, maxX, minZ, maxZ }) =>
          minX < -host.tileSize / 2 ||
          maxX > host.tileSize / 2 ||
          minZ < -host.tileSize / 2 ||
          maxZ > host.tileSize / 2
      )
    ).toBe(true);
    for (const item of host.measurements) {
      expect(item.passage).toBe(false);
      expect(item.bottom).toBeCloseTo(item.floor, 4);
      expect(item.terrain).toBeCloseTo(item.floor, 4);
      expect(item.supported).toBe(true);
      expect(item.gridHeights.some((height) => Math.abs(height - item.floor - 0.004) < 1e-4)).toBe(
        true
      );
      expect(item.width).toBeGreaterThan(0);
      expect(item.depth).toBeGreaterThan(0);
      if (biomeKey === 'crystalSpires')
        expect(item.height / Math.max(item.width, item.depth)).toBeGreaterThan(3);
    }
    if (biomeKey === 'cavern') expect(host.sightCount).toBeGreaterThan(0);
    else {
      expect(host.sightCount).toBe(0);
      expect(host.depthGroups.length).toBeGreaterThan(0);
      expect(host.depthGroups.every(({ count, depthCount }) => depthCount === count)).toBe(true);
      expect(host.lights).toBeGreaterThan(0);
      expect(host.lights).toBeLessThanOrEqual(8);
    }
    const invite = await page.evaluate(async (key) => {
      const gm = window.gameManager;
      const library = gm.characterServices.library;
      const id = await library.create(`${key} explorer`);
      await library.flush();
      const creature = gm.tokenManager.createCreatureByType('mannequin');
      gm.tokenManager.addTokenToCollection(creature, 12, 12, 'mannequin');
      const token = gm.placedTokens.at(-1);
      const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
      linkTokenCharacter(token, library, id);
      await token.__threeMeshPromise;
      await gm.sceneAutosave.flush();
      const invitation = await library.store.sessionCall('createInvite', [
        gm.campaign.id,
        { name: `${key} player` },
      ]);
      await library.store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
      return invitation.invite;
    }, biomeKey);
    const playerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const player = await playerContext.newPage();
      await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(invite)}`);
      await player.waitForFunction(
        (key) =>
          window.gameManager?.terrainEngine?.biomeKey === key &&
          [...(window.gameManager?.placeableMeshPool?._metadata?.values() || [])].some((entries) =>
            [...entries.values()].some(({ source }) =>
              /^source-cave-(stalagmite|column)$/.test(source?.modelKey || '')
            )
          ),
        biomeKey
      );
      const playerView = await player.evaluate(async () => {
        const gm = window.gameManager;
        const placements = (await gm.placeableMeshPool.snapshotPlacements()).filter(
          ({ modelKey }) => /^source-cave-(stalagmite|column)$/.test(modelKey || '')
        );
        gm.threeSceneManager.refreshLocalLighting();
        return {
          placements,
          depthGroups: [...gm.placeableMeshPool._groups.values()]
            .filter(({ instancedMesh }) => instancedMesh.name.startsWith('Placeables:source-cave-'))
            .map(({ instancedMesh, depthPrepass }) => ({
              count: instancedMesh.count,
              depthCount: depthPrepass?.count ?? null,
              textured: (Array.isArray(instancedMesh.material)
                ? instancedMesh.material
                : [instancedMesh.material]
              ).every((material) => Boolean(material.map?.image)),
            })),
          lights:
            gm.threeSceneManager.scene.getObjectByName('UndergroundLocalLights')?.children.length ||
            0,
        };
      });
      expect(playerView.placements.length).toBeGreaterThan(0);
      expect(playerView.depthGroups.length).toBeGreaterThan(0);
      expect(playerView.depthGroups.every(({ textured }) => textured)).toBe(true);
      if (biomeKey === 'crystalSpires') {
        expect(playerView.lights).toBeGreaterThan(0);
        expect(playerView.depthGroups.length).toBeGreaterThan(0);
        expect(playerView.depthGroups.every(({ count, depthCount }) => depthCount === count)).toBe(
          true
        );
      }
      for (const formation of playerView.placements)
        expect(host.placements).toContainEqual(
          expect.objectContaining({
            modelKey: formation.modelKey,
            gridX: formation.gridX,
            gridY: formation.gridY,
            persistedScale: formation.persistedScale,
            angleRadians: formation.angleRadians,
            gridOffsetX: formation.gridOffsetX,
            gridOffsetY: formation.gridOffsetY,
          })
        );
    } finally {
      await playerContext.close();
    }
    await page.reload();
    const reopened = page
      .getByRole('dialog', { name: 'Choose your campaign' })
      .locator('article', { hasText: campaignName });
    await reopened.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForFunction(
      (key) =>
        window.gameManager?.sceneAutosave?.ready &&
        window.gameManager?.terrainEngine?.biomeKey === key,
      biomeKey
    );
    const restored = await page.evaluate(async () =>
      (await window.gameManager.placeableMeshPool.snapshotPlacements()).filter(({ modelKey }) =>
        /^source-cave-(stalagmite|column)$/.test(modelKey || '')
      )
    );
    const signature = (placements) =>
      placements
        .map(
          ({ modelKey, gridX, gridY, persistedScale, angleRadians, gridOffsetX, gridOffsetY }) => ({
            modelKey,
            gridX,
            gridY,
            persistedScale,
            angleRadians,
            gridOffsetX,
            gridOffsetY,
          })
        )
        .sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
    expect(signature(restored)).toEqual(signature(host.placements));
    const reopenedFloor = await page.evaluate(async () => {
      const gm = window.gameManager;
      while (gm.terrainRebuilder._timer)
        await new Promise((resolve) => requestAnimationFrame(resolve));
      const first = (await gm.placeableMeshPool.snapshotPlacements()).find(({ modelKey }) =>
        /^source-cave-(stalagmite|column)$/.test(modelKey || '')
      );
      const center = gm.spatial.gridToWorld(first.gridX + 0.5, first.gridY + 0.5, 0);
      const t = gm.threeSceneManager.three;
      const mesh = gm.threeSceneManager.scene.getObjectByName('TerrainMesh');
      const hit = new t.Raycaster(
        new t.Vector3(center.x, 100, center.z),
        new t.Vector3(0, -1, 0)
      ).intersectObject(mesh, false)[0];
      return {
        terrain: hit?.point.y ?? null,
        floor: gm.getTerrainHeight(first.gridX, first.gridY) * gm.spatial.elevationUnit,
      };
    });
    expect(reopenedFloor.terrain).toBeCloseTo(reopenedFloor.floor, 4);
  });
}

test('regenerated Crystal Spires remain visible as the camera moves', async ({ page }) => {
  const campaignName = 'Playwright crystal visibility';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () => window.gameManager?.sceneAutosave?.ready && !window.gameManager.sceneAutosave.writing
  );
  const result = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'crystalSpires', seed: 42, densityMultiplier: 1 },
      { cols: 25, rows: 25 }
    );
    for (const group of gm.placeableMeshPool._groups.values())
      if (group.instancedMesh.count) group.instancedMesh.computeBoundingSphere();
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'crystalSpires', seed: 1513926253, densityMultiplier: 1.65 },
      { cols: 25, rows: 25 }
    );
    const manager = gm.threeSceneManager;
    manager.restoreView({
      ...manager.snapshotView(),
      target: { x: 8.5276, y: -8 * gm.spatial.elevationUnit, z: 9.1285 },
      yaw: 3.6565,
      pitch: 1.4286,
      zoom: 1.5315,
      isometric: true,
      topDown: false,
      manualLock: true,
      orbit: null,
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const t = manager.three;
    const camera = manager.camera;
    camera.updateMatrixWorld(true);
    const frustum = new t.Frustum().setFromProjectionMatrix(
      new t.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    let visibleInstances = 0;
    const incorrectlyCulled = [];
    for (const [key, entries] of gm.placeableMeshPool._metadata) {
      if (!key.startsWith('source-cave-stalagmite')) continue;
      const group = gm.placeableMeshPool._groups.get(key);
      const mesh = group.instancedMesh;
      mesh.updateMatrixWorld(true);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      let visible = 0;
      for (const [index] of entries) {
        const matrix = new t.Matrix4();
        mesh.getMatrixAt(index, matrix);
        matrix.premultiply(mesh.matrixWorld);
        if (frustum.intersectsBox(mesh.geometry.boundingBox.clone().applyMatrix4(matrix)))
          visible++;
      }
      visibleInstances += visible;
      if (visible && !frustum.intersectsObject(mesh)) incorrectlyCulled.push(key);
      if (visible && group.depthPrepass && !frustum.intersectsObject(group.depthPrepass))
        incorrectlyCulled.push(`${key}:depth`);
    }
    return { visibleInstances, incorrectlyCulled };
  });
  expect(result.visibleInstances).toBeGreaterThan(0);
  expect(result.incorrectlyCulled).toEqual([]);
});

test('overlapping Crystal Spires retain their depth across camera angles and placement changes', async ({
  page,
}) => {
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Crystal depth ordering');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () => window.gameManager?.sceneAutosave?.ready && !window.gameManager.sceneAutosave.writing
  );
  const result = await page.evaluate(async () => {
    const gm = window.gameManager;
    const { PlaceableMeshPool } = await import('/src/scene/terrain/PlaceableMeshPool.js');
    const t = gm.threeSceneManager.three;
    const renderer = gm.threeSceneManager.renderer;
    const scene = new t.Scene();
    scene.background = new t.Color(0x171922);
    scene.add(new t.AmbientLight(0xffffff, 3));
    const background = new t.Mesh(
      new t.PlaneGeometry(5, 5),
      new t.MeshBasicMaterial({
        color: 0x63833a,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: t.DoubleSide,
      })
    );
    background.position.set(0, 1.1, 3);
    background.renderOrder = 2;
    scene.add(background);
    const localManager = {
      is3DModeActive: () => true,
      threeSceneManager: { scene },
      terrainEngine: { biomeKey: 'crystalSpires', biomeSeed: 42 },
      modelAssetCache: gm.modelAssetCache,
      spatial: {
        tileWorldSize: 1,
        elevationUnit: 1,
        gridToWorld: (x, y) => ({ x: (x - 0.5) * 10, y: 0, z: (y - 0.5) * 1.5 }),
      },
      getTerrainHeight: () => 0,
    };
    const pool = new PlaceableMeshPool({
      gameManager: localManager,
      initialCapacity: 1,
      maxCapacity: 4,
      publishMetrics: false,
    });
    const add = (gridX, gridY, angleRadians = 0) =>
      pool.addPlaceable(
        {
          type: 'plant',
          modelKey: 'source-cave-stalagmite',
          placeableId: 'source-cave-stalagmite',
          biomeKey: 'crystalSpires',
          biomeSeed: 42,
          gridX,
          gridY,
          gridOffsetX: 0,
          gridOffsetY: 0,
          angleRadians,
          persistedScale: { x: 1, y: 1, z: 1 },
        },
        { strict: true }
      );
    const target = new t.WebGLRenderTarget(256, 256);
    const previousTarget = renderer.getRenderTarget();
    const camera = new t.OrthographicCamera(-1.3, 1.3, 1.4, -1.4, 0.1, 50);
    const render = () => {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(256 * 256 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
      return pixels;
    };
    const changedPixels = (a, b) => {
      let changed = 0;
      for (let index = 0; index < a.length; index += 4) {
        const difference =
          Math.abs(a[index] - b[index]) +
          Math.abs(a[index + 1] - b[index + 1]) +
          Math.abs(a[index + 2] - b[index + 2]);
        if (difference > 3) changed++;
      }
      return changed;
    };
    const colorDifference = (a, b) => {
      let total = 0;
      for (let index = 0; index < a.length; index += 4)
        total +=
          Math.abs(a[index] - b[index]) +
          Math.abs(a[index + 1] - b[index + 1]) +
          Math.abs(a[index + 2] - b[index + 2]);
      return total;
    };
    try {
      const first = await add(0, 0, 0.2);
      const second = await add(0, 1, -0.25);
      await add(1, 0);
      const front = pool._groups.get(first.key).instancedMesh;
      const back = pool._groups.get(second.key).instancedMesh;
      camera.position.set(0, 1.1, -8);
      camera.lookAt(0, 1.1, 0.75);
      camera.updateMatrixWorld(true);
      front.visible = false;
      back.visible = false;
      const empty = render();
      front.visible = true;
      back.visible = true;
      const visiblePixels = changedPixels(empty, render());
      const firstGroup = pool._groups.get(first.key);
      const materials = Array.isArray(front.material) ? front.material : [front.material];
      const opacity = materials.map((material) => material.opacity);
      back.visible = false;
      background.visible = false;
      firstGroup.depthPrepass.visible = false;
      for (const material of materials) material.opacity = firstGroup.appearance.opacity;
      const previousSingle = render();
      firstGroup.depthPrepass.visible = true;
      const uncompensatedSingle = render();
      for (let index = 0; index < materials.length; index++)
        materials[index].opacity = opacity[index];
      const correctedSingle = render();
      const uncompensatedDifference = colorDifference(previousSingle, uncompensatedSingle);
      const correctedDifference = colorDifference(previousSingle, correctedSingle);
      back.visible = true;
      background.visible = true;
      const changedByOrder = [];
      for (const z of [8, -8]) {
        camera.position.set(0, 1.1, z);
        camera.lookAt(0, 1.1, 0.75);
        camera.updateMatrixWorld(true);
        front.renderOrder = 0;
        back.renderOrder = 1;
        const firstOrder = render();
        front.renderOrder = 1;
        back.renderOrder = 0;
        changedByOrder.push(changedPixels(firstOrder, render()));
      }
      localManager.getTerrainHeight = () => 1;
      await pool.resyncHeights();
      camera.position.set(0, 2.1, -8);
      camera.lookAt(0, 2.1, 0.75);
      camera.updateMatrixWorld(true);
      front.renderOrder = 0;
      back.renderOrder = 1;
      const beforeResort = render();
      front.renderOrder = 1;
      back.renderOrder = 0;
      const resyncDifference = changedPixels(beforeResort, render());
      front.visible = false;
      const withoutFront = render();
      front.visible = true;
      pool.removePlaceable({ __meshPoolHandle: first });
      const removedDifference = changedPixels(withoutFront, render());
      pool.clearAll();
      const cleared = render();
      back.visible = false;
      const clearedDifference = changedPixels(cleared, render());
      const material = Array.isArray(back.material) ? back.material[0] : back.material;
      return {
        changedByOrder,
        visiblePixels,
        uncompensatedDifference,
        correctedDifference,
        resyncDifference,
        removedDifference,
        clearedDifference,
        opacity: material.opacity,
        transparent: material.transparent,
      };
    } finally {
      renderer.setRenderTarget(previousTarget);
      target.dispose();
      pool.purgeAll();
    }
  });
  expect(result.visiblePixels).toBeGreaterThan(1000);
  expect(result.uncompensatedDifference).toBeGreaterThan(0);
  expect(result.correctedDifference).toBeLessThan(result.uncompensatedDifference * 0.8);
  expect(result.changedByOrder).toEqual([0, 0]);
  expect(result.resyncDifference).toBe(0);
  expect(result.removedDifference).toBe(0);
  expect(result.clearedDifference).toBe(0);
  expect(result.opacity).toBeGreaterThan(0);
  expect(result.opacity).toBeLessThan(1);
  expect(result.transparent).toBe(true);
});

test('Dungeon generates constructed rooms from the Underground review and survives reopening', async ({
  page,
  browser,
}) => {
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Playwright Dungeon');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () => window.gameManager?.sceneAutosave?.ready && !window.gameManager?.campaignViewBusy
  );
  const characterId = await page.evaluate(async () => {
    const gm = window.gameManager;
    const library = gm.characterServices.library;
    const id = await library.create('Dungeon adventurer');
    await library.flush();
    return id;
  });
  await expect(page.getByLabel('Shared session status')).toContainText('up to date');
  await page.evaluate(async (id) => {
    const gm = window.gameManager;
    const library = gm.characterServices.library;
    const creature = gm.tokenManager.createCreatureByType('mannequin');
    gm.tokenManager.addTokenToCollection(creature, 2, 2, 'mannequin');
    const token = gm.placedTokens.at(-1);
    const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
    linkTokenCharacter(token, library, id);
    await token.__threeMeshPromise;
    await gm.sceneAutosave.flush();
  }, characterId);
  const invite = await page.evaluate(async (id) => {
    const gm = window.gameManager;
    const store = gm.characterServices.library.store;
    const invitation = await store.sessionCall('createInvite', [
      gm.campaign.id,
      { name: 'Dungeon player' },
    ]);
    await store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
    return invitation.invite;
  }, characterId);
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const player = await playerContext.newPage();
  await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(invite)}`);
  await player.waitForFunction(
    () => !!window.gameManager?.playerApplication?.state?.observerTokenId
  );

  await page.getByRole('tab', { name: /Biomes/ }).click();
  await page.getByRole('button', { name: /Underground/ }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Underground' });
  await review.locator('[name="variant"]').selectOption('dungeon');
  const beforeReview = await page.evaluate(() =>
    JSON.stringify(window.gameManager.terrainEngine.save())
  );
  await review.getByLabel('Grid width (squares)').fill('12');
  await review.getByLabel('Grid height (squares)').fill('12');
  await review.getByLabel('Dungeon rooms').selectOption('16');
  expect(
    await review.getByLabel('Dungeon rooms').evaluate((input) => input.validationMessage)
  ).toMatch(/up to 6 rooms/i);
  await review.getByRole('button', { name: 'Generate Dungeon' }).click();
  await expect(review).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(window.gameManager.terrainEngine.save()))).toBe(
    beforeReview
  );
  await review.getByLabel('Grid width (squares)').fill('18');
  await review.getByLabel('Grid height (squares)').fill('14');
  await review.getByLabel('Dungeon rooms').selectOption('9');
  await expect(review.locator('[data-field="entrances"]')).toBeHidden();
  await submitBiomeReview(page, review.getByRole('button', { name: 'Generate Dungeon' }));
  await expect(page.locator('#biome-generation-status')).toContainText('Generated Dungeon');
  await expect(page.locator('#biome-generation-status')).toContainText('18 x 14');
  await player.waitForFunction(
    () => window.gameManager?.playerApplication?.state?.observerTokenId === null
  );
  const playerState = await player.evaluate(() => {
    const app = window.gameManager.playerApplication;
    return {
      observers: app.state.observers.length,
      characters: app.state.profile.characterIds,
    };
  });
  expect(playerState.observers).toBe(0);
  expect(playerState.characters).toContain(characterId);
  await playerContext.close();
  await page.waitForFunction(() =>
    window.gameManager.threeSceneManager.scene
      .getObjectByName('ConstructionAssets')
      ?.userData.replacements.some(({ modelKey }) => modelKey === 'source-dungeon-wall')
  );
  const before = await page.evaluate(async (id) => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    const assets = gm.threeSceneManager.scene.getObjectByName('ConstructionAssets');
    return {
      cols: gm.cols,
      rows: gm.rows,
      tokens: gm.placedTokens.length,
      character: gm.characterServices.library.get(id).name,
      terrain: gm.terrainEngine.save(),
      torchCount: (await gm.placeableMeshPool.snapshotPlacements()).filter(
        ({ modelKey }) => modelKey === 'source-dungeon-torch'
      ).length,
      instancedWalls: assets.children.some(
        (child) => child.isInstancedMesh && Array.isArray(child.material)
      ),
      wallMaterials: assets.children
        .filter((child) => child.isInstancedMesh)
        .flatMap((child) => (Array.isArray(child.material) ? child.material : [child.material]))
        .map(({ opacity, transparent }) => ({ opacity, transparent })),
    };
  }, characterId);
  expect([before.cols, before.rows]).toEqual([18, 14]);
  expect(before.tokens).toBe(0);
  expect(before.character).toBe('Dungeon adventurer');
  expect(before.terrain.biomeKey).toBe('dungeon');
  expect(before.terrain.generationRecipe.values.dungeonRoomCount).toBe(9);
  expect(before.torchCount).toBe(9);
  expect(before.instancedWalls).toBe(true);
  expect(before.wallMaterials.length).toBeGreaterThan(0);
  expect(
    before.wallMaterials.every(({ opacity, transparent }) => opacity === 1 && !transparent)
  ).toBe(true);

  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Playwright Dungeon', exact: true }) });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.campaign?.name === 'Playwright Dungeon' &&
      window.gameManager?.terrainEngine?.biomeKey === 'dungeon'
  );
  await page.waitForFunction(() =>
    window.gameManager.threeSceneManager.scene
      .getObjectByName('ConstructionAssets')
      ?.userData.replacements.some(({ modelKey }) => modelKey === 'source-dungeon-wall')
  );
  const after = await page.evaluate((id) => {
    const gm = window.gameManager;
    const assets = gm.threeSceneManager.scene.getObjectByName('ConstructionAssets');
    return {
      cols: gm.cols,
      rows: gm.rows,
      tokens: gm.placedTokens.length,
      character: gm.characterServices.library.get(id).name,
      terrain: gm.terrainEngine.save(),
      visibleWalls: assets.children.some(
        (child) =>
          child.isInstancedMesh &&
          (Array.isArray(child.material) ? child.material : [child.material]).every(
            (material) => material.opacity === 1 && !material.transparent
          )
      ),
    };
  }, characterId);
  expect([after.cols, after.rows]).toEqual([18, 14]);
  expect(after.tokens).toBe(0);
  expect(after.character).toBe('Dungeon adventurer');
  expect(after.terrain.geometry).toEqual(before.terrain.geometry);
  expect(after.terrain.generationRecipe.values.dungeonRoomCount).toBe(9);
  expect(after.visibleWalls).toBe(true);

  await page.getByRole('tab', { name: /Biomes/ }).click();
  await page.getByRole('button', { name: /Underground/ }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const reopenedReview = page.getByRole('dialog', { name: 'Underground' });
  await reopenedReview.locator('[name="variant"]').selectOption('dungeon');
  await expect(reopenedReview.getByLabel('Dungeon rooms')).toHaveValue('9');
  await reopenedReview.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: /Plains & Wildlands/ }).click();
  await page.locator('#biome-structures-toggle').uncheck();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const secondReview = page.getByRole('dialog', { name: 'Plains & Wildlands' });
  await expect(secondReview.getByLabel('Grid width (squares)')).toHaveValue('18');
  await expect(secondReview.getByLabel('Grid height (squares)')).toHaveValue('14');
  await secondReview.locator('[name="density"]').selectOption('sparse');
  await submitBiomeReview(page, secondReview.locator('button[type="submit"]'));
  await expect(page.locator('#biome-generation-status')).toContainText('18 x 14');
  const replaced = await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.sceneAutosave.flush();
    return {
      biome: gm.terrainEngine.biomeKey,
      structures: gm.terrainEngine.geometry.getStructures(),
      cols: gm.cols,
      rows: gm.rows,
    };
  });
  expect(replaced).toEqual({ biome: 'grassland', structures: [], cols: 18, rows: 14 });
});

test('underground lights stay map-local for the host and player and survive reopening', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const campaignName = 'Playwright underground lighting';
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill(campaignName);
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.evaluate(async () => {
    const gm = window.gameManager;
    const { replaceCampaignBiome } = await import('/src/campaigns/CampaignBiomeGeneration.js');
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      {
        cols: 18,
        rows: 14,
      }
    );
  });
  await page.waitForFunction(
    () =>
      window.gameManager?.threeSceneManager?.scene.getObjectByName('UndergroundLocalLights')
        ?.children.length >= 4
  );
  await page.getByRole('tab', { name: /Terrain/ }).click();
  await page.locator('label:has(#terrain-mode-toggle)').click();
  const torchButton = page.getByRole('button', { name: 'Torch (light source)' });
  await expect(torchButton).toBeVisible();
  await torchButton.click();
  const cell = await page.evaluate(() => {
    const gm = window.gameManager;
    const { camera, canvas, three } = gm.threeSceneManager;
    const rect = canvas.getBoundingClientRect();
    camera.updateMatrixWorld();
    for (const [gridX, gridY] of [
      [8, 7],
      [9, 7],
      [7, 7],
      [10, 7],
    ]) {
      const point = new three.Vector3(gridX + 0.5, 0, gridY + 0.5).project(camera);
      const x = rect.left + ((point.x + 1) * rect.width) / 2;
      const y = rect.top + ((1 - point.y) * rect.height) / 2;
      const hit = gm.pickingService.pickGroundSync(x, y, canvas);
      if (
        document.elementFromPoint(x, y) === canvas &&
        hit?.grid?.gx === gridX &&
        hit.grid.gy === gridY
      )
        return { x, y, gridX, gridY };
    }
    throw new Error('No visible dungeon floor tile is available for torch placement');
  });
  await page.mouse.click(cell.x, cell.y);
  await page.waitForFunction(({ gridX, gridY }) => {
    const pool = window.gameManager.placeableMeshPool;
    return [...pool._metadata.values()].some((entries) =>
      [...entries.values()].some(
        ({ source }) =>
          source?.modelKey === 'source-dungeon-torch' &&
          source.gridX === gridX &&
          source.gridY === gridY
      )
    );
  }, cell);
  await page.evaluate(async () => {
    const gm = window.gameManager;
    await gm.placeableMeshPool.whenSettled();
    gm.threeSceneManager.refreshLocalLighting();
    await gm.sceneAutosave.flush();
  });
  await page.locator('label:has(#terrain-mode-toggle)').click();
  await page.waitForFunction(() => !window.gameManager.terrainEngine.isActive);
  const hostLighting = await page.evaluate(async () => {
    const gm = window.gameManager;
    const manager = gm.threeSceneManager;
    const snapshot = () => ({
      sunVisible: manager._sunLight.visible,
      ambient: manager._ambientLight.intensity,
      terrainColors: [
        ...manager.scene
          .getObjectByName('TerrainMesh')
          .geometry.attributes.color.array.slice(0, 30),
      ],
      lights: manager.scene.getObjectByName('UndergroundLocalLights').children.map((light) => ({
        kind: light.userData.kind,
        position: light.position.toArray(),
      })),
    });
    manager.setSunTimeMinutes(60, { immediate: true });
    const night = snapshot();
    manager.setSunTimeMinutes(720, { immediate: true });
    const day = snapshot();
    const placements = await gm.placeableMeshPool.snapshotPlacements();
    return {
      night,
      day,
      torchCount: placements.filter(({ modelKey }) => modelKey === 'source-dungeon-torch').length,
    };
  });
  expect(hostLighting.day).toEqual(hostLighting.night);
  expect(hostLighting.day.sunVisible).toBe(false);
  expect(hostLighting.day.ambient).toBeGreaterThan(0);
  expect(hostLighting.torchCount).toBeGreaterThanOrEqual(5);
  expect(hostLighting.day.lights.every(({ kind }) => kind === 'torch')).toBe(true);

  const invite = await page.evaluate(async () => {
    const gm = window.gameManager;
    const library = gm.characterServices.library;
    const id = await library.create('Lighting explorer');
    await library.flush();
    const creature = gm.tokenManager.createCreatureByType('mannequin');
    gm.tokenManager.addTokenToCollection(creature, 9, 7, 'mannequin');
    const token = gm.placedTokens.at(-1);
    const { linkTokenCharacter } = await import('/src/entities/creatures/TokenMovement.js');
    linkTokenCharacter(token, library, id);
    await token.__threeMeshPromise;
    await gm.sceneAutosave.flush();
    const invitation = await library.store.sessionCall('createInvite', [
      gm.campaign.id,
      { name: 'Lighting player' },
    ]);
    await library.store.sessionCall('assignCharacter', [gm.campaign.id, invitation.id, id, true]);
    return invitation.invite;
  });
  const playerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const player = await playerContext.newPage();
  try {
    await player.goto(`${hostURL}/player.html#invite=${encodeURIComponent(invite)}`);
    await player.waitForFunction(
      () =>
        window.gameManager?.playerApplication?.state?.observerTokenId &&
        window.gameManager?.terrainEngine?.biomeKey === 'dungeon' &&
        window.gameManager?.threeSceneManager?.scene.getObjectByName('UndergroundLocalLights')
          ?.children.length >= 4
    );
    const playerLighting = await player.evaluate(() => {
      const manager = window.gameManager.threeSceneManager;
      const snapshot = () => ({
        sunVisible: manager._sunLight.visible,
        ambient: manager._ambientLight.intensity,
        lights: manager.scene.getObjectByName('UndergroundLocalLights').children.length,
      });
      manager.setSunTimeMinutes(0, { immediate: true });
      const night = snapshot();
      manager.setSunTimeMinutes(720, { immediate: true });
      return { night, day: snapshot() };
    });
    expect(playerLighting.day).toEqual(playerLighting.night);
    expect(playerLighting.day.sunVisible).toBe(false);
    expect(playerLighting.day.lights).toBe(hostLighting.day.lights.length);

    const removed = await page.evaluate(async () => {
      const gm = window.gameManager;
      const pool = gm.placeableMeshPool;
      const torch = (await pool.snapshotPlacements()).find(
        ({ modelKey }) => modelKey === 'source-dungeon-torch'
      );
      const count = pool.removePlantsAt(torch.gridX, torch.gridY);
      gm.threeSceneManager.refreshLocalLighting();
      await gm.sceneAutosave.flush();
      return {
        count,
        lights:
          gm.threeSceneManager.scene.getObjectByName('UndergroundLocalLights').children.length,
      };
    });
    expect(removed.count).toBe(1);
    expect(removed.lights).toBe(hostLighting.day.lights.length - 1);
    await player.waitForFunction(
      (count) =>
        window.gameManager?.threeSceneManager?.scene.getObjectByName('UndergroundLocalLights')
          ?.children.length === count,
      removed.lights
    );

    const maps = await page.evaluate(async () => {
      const gm = window.gameManager;
      const source = gm.campaignMapId;
      const { createCampaignLocation } = await import('/src/campaigns/CampaignLocationEditing.js');
      const { changeCampaignView } = await import('/src/campaigns/SceneWorld.js');
      const outside = await createCampaignLocation(gm, 'Outdoor inspection');
      await changeCampaignView(gm, { mapId: outside.mapId });
      return {
        source,
        outside: outside.mapId,
        sunVisible: gm.threeSceneManager._sunLight.visible,
        localLights: !!gm.threeSceneManager.scene.getObjectByName('UndergroundLocalLights'),
      };
    });
    expect(maps.sunVisible).toBe(true);
    expect(maps.localLights).toBe(false);
    expect(await player.evaluate(() => window.gameManager.terrainEngine.biomeKey)).toBe('dungeon');
    await page.evaluate(async (source) => {
      const { changeCampaignView } = await import('/src/campaigns/SceneWorld.js');
      await changeCampaignView(window.gameManager, { mapId: source });
    }, maps.source);
    await page.waitForFunction(
      (count) =>
        window.gameManager?.threeSceneManager?.scene.getObjectByName('UndergroundLocalLights')
          ?.children.length === count,
      removed.lights
    );
    await page.evaluate(() => window.gameManager.sceneAutosave.flush());
  } finally {
    await playerContext.close();
  }

  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: campaignName });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    (count) =>
      window.gameManager?.terrainEngine?.biomeKey === 'dungeon' &&
      window.gameManager?.threeSceneManager?.scene.getObjectByName('UndergroundLocalLights')
        ?.children.length === count,
    hostLighting.day.lights.length - 1
  );
  expect(await page.evaluate(() => window.gameManager.threeSceneManager._sunLight.visible)).toBe(
    false
  );
});

test('repeating Dungeon generation with the same room count can produce different layouts', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto(hostURL);
  const login = page.getByRole('dialog', { name: 'Sign in to TavernTable' });
  await login.getByLabel('Host access key').fill(hostKey);
  await login.getByRole('button', { name: 'Sign in as host' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose your campaign' });
  await picker.getByLabel('Campaign name', { exact: true }).fill('Dungeon cycle baseline');
  await picker.getByLabel('Campaign ruleset').selectOption('2014');
  await picker.getByRole('button', { name: 'Create & open campaign' }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      !window.gameManager.sceneAutosave.dirty &&
      !window.gameManager.sceneAutosave.writing
  );
  await page.getByRole('tab', { name: /Biomes/ }).click();
  await page.getByRole('button', { name: /Underground/ }).click();
  const generate = async (seed) => {
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Underground' });
    await review.locator('[name="variant"]').selectOption('dungeon');
    await review.getByLabel('Dungeon rooms').selectOption('12');
    await page.evaluate((value) => {
      window.__testOriginalRandom = Math.random;
      Math.random = () => value / 0xffffffff;
    }, seed);
    await submitBiomeReview(page, review.getByRole('button', { name: 'Generate Dungeon' }));
    await expect(page.locator('#biome-generation-status')).toContainText('Generated Dungeon');
    await page.waitForFunction((value) => {
      const gm = window.gameManager;
      const replacements =
        gm.threeSceneManager.scene.getObjectByName('ConstructionAssets')?.userData.replacements ||
        [];
      const walls = gm.terrainEngine.geometry
        .getStructures()
        .filter((entry) => entry.id.startsWith(`generated-dungeon-${value}-`));
      return (
        walls.length > 0 &&
        walls.every(({ id }) => replacements.some(({ structureId }) => structureId === id))
      );
    }, seed);
    const result = await page.evaluate(() => {
      Math.random = window.__testOriginalRandom;
      delete window.__testOriginalRandom;
      const engine = window.gameManager.terrainEngine;
      return {
        seed: engine.biomeSeed,
        roomCount: engine.generationRecipe.values.dungeonRoomCount,
        geometry: engine.geometry
          .getStructures()
          .map(({ xFeet, zFeet, lengthFeet, angleRadians, opening }) => [
            xFeet,
            zFeet,
            lengthFeet,
            angleRadians,
            opening,
          ]),
      };
    });
    result.image = await page.locator('canvas[data-three]').screenshot();
    return result;
  };
  const first = await generate(7);
  const second = await generate(42);
  expect([first.seed, second.seed]).toEqual([7, 42]);
  expect([first.roomCount, second.roomCount]).toEqual([12, 12]);
  expect(first.geometry).not.toEqual(second.geometry);
  expect(first.image.equals(second.image)).toBe(false);

  const cycle = page.getByRole('button', { name: 'Next Dungeon layout' });
  await expect(cycle).toBeVisible();
  await page.locator('label[for="biome-seed-lock"]').click();
  await expect(page.locator('#biome-seed-lock')).toBeChecked();
  await cycle.click();
  let warning = page.getByRole('dialog', { name: 'Replace this map?' });
  await warning.getByLabel("Don't show me this again").check();
  await warning.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => window.gameManager.terrainEngine.biomeSeed)).toBe(42);
  await expect(page.locator('#biome-replacement-warning')).toBeChecked();
  await cycle.click();
  warning = page.getByRole('dialog', { name: 'Replace this map?' });
  await warning.getByLabel("Don't show me this again").check();
  await warning.getByRole('button', { name: 'Replace map' }).click();
  await page.waitForFunction(
    (previous) => window.gameManager.terrainEngine.biomeSeed !== previous,
    42
  );
  await expect(cycle).toBeEnabled();
  const cycled = await page.evaluate(() => {
    const engine = window.gameManager.terrainEngine;
    return {
      seed: engine.biomeSeed,
      roomCount: engine.generationRecipe.values.dungeonRoomCount,
      geometry: engine.geometry
        .getStructures()
        .map(({ xFeet, zFeet, lengthFeet, angleRadians, opening }) => [
          xFeet,
          zFeet,
          lengthFeet,
          angleRadians,
          opening,
        ]),
    };
  });
  expect(cycled.roomCount).toBe(12);
  expect(cycled.geometry).not.toEqual(second.geometry);
  await expect(page.locator('#biome-replacement-warning')).not.toBeChecked();
  await page.evaluate(() => window.gameManager.sceneAutosave.flush());

  await page.reload();
  const reopened = page
    .getByRole('dialog', { name: 'Choose your campaign' })
    .locator('article', { hasText: 'Dungeon cycle baseline' });
  await reopened.getByRole('button', { name: 'Open', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.gameManager?.sceneAutosave?.ready &&
      window.gameManager?.terrainEngine?.biomeKey === 'dungeon'
  );
  await page.getByRole('tab', { name: /Biomes/ }).click();
  await expect(page.locator('#biome-replacement-warning')).not.toBeChecked();
  await expect(cycle).toBeEnabled();
  await cycle.click();
  await page.waitForFunction(
    (previous) => window.gameManager.terrainEngine.biomeSeed !== previous,
    cycled.seed
  );
  await expect(cycle).toBeEnabled();
  expect(await page.getByRole('dialog', { name: 'Replace this map?' }).count()).toBe(0);
  await page.locator('label[for="biome-replacement-warning"]').click();
  await expect(page.locator('#biome-replacement-warning')).toBeChecked();
  const beforeCancel = await page.evaluate(() => window.gameManager.terrainEngine.biomeSeed);
  await cycle.click();
  warning = page.getByRole('dialog', { name: 'Replace this map?' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => window.gameManager.terrainEngine.biomeSeed)).toBe(beforeCancel);
});
