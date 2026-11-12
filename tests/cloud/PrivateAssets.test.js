const { randomUUID, createHash } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('canvas');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { PrivateCampaignAssets } = require('../../tools/cloud/campaign-assets.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { signedInIdentity } = require('./helpers/accounts.js');

test(
  'a validated private image is immutable, scoped to its campaign and retrieved with exact bytes',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const assets = new PrivateCampaignAssets({ bucket: runtime.bucket });
    const id = randomUUID();
    const bytes = createCanvas(2, 2).toBuffer('image/png');
    const original = Buffer.from(bytes);
    const staged = assets.stage(id, 'image/png', bytes);
    bytes.fill(0);
    const reference = await staged;
    assert.equal(reference.version, 1);
    assert.equal(reference.campaignId, id);
    assert.equal(reference.mimeType, 'image/png');
    assert.equal(reference.bytes, original.length);
    assert.equal(reference.sha256, createHash('sha256').update(original).digest('hex'));
    assert.equal(reference.width, 2);
    assert.equal(reference.height, 2);
    assert.deepEqual(await assets.read(id, reference), original);
    assert.deepEqual(await assets.stage(id, 'image/png', original), reference);
    await assert.rejects(assets.read(randomUUID(), reference), { code: 'asset-integrity-failed' });
  }
);

for (const mimeType of ['image/jpeg', 'image/webp'])
  test(
    `private validation retains supported ${mimeType} content without transcoding it`,
    { timeout: 30000 },
    async (t) => {
      const runtime = await createEmulatorRuntime();
      t.after(() => runtime.close());
      const assets = new PrivateCampaignAssets({ bucket: runtime.bucket });
      const bytes =
        mimeType === 'image/jpeg'
          ? createCanvas(2, 2).toBuffer('image/jpeg')
          : Buffer.from(
              'UklGRkQAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAAAAAAABWUDggGAAAADABAJ0BKgIAAgABQCYlpAADcAD+/TZoAA==',
              'base64'
            );
      const id = randomUUID();
      const reference = await assets.stage(id, mimeType, bytes);
      assert.equal(reference.width, 2);
      assert.equal(reference.height, 2);
      assert.deepEqual(await assets.read(id, reference), bytes);
    }
  );

test(
  'corrupt image bodies, forged MIME and oversized headers fail before any private object is staged',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const assets = new PrivateCampaignAssets({ bucket: runtime.bucket });
    const id = randomUUID();
    const png = createCanvas(2, 2).toBuffer('image/png');
    await assert.rejects(assets.stage(id, 'image/png', png.subarray(0, 40)), {
      code: 'invalid-asset-image',
    });
    await assert.rejects(assets.stage(id, 'image/jpeg', png), { code: 'invalid-asset-image' });
    for (const [width, height] of [
      [8193, 1],
      [4001, 4000],
    ]) {
      const oversized = Buffer.from(png);
      oversized.writeUInt32BE(width, 16);
      oversized.writeUInt32BE(height, 20);
      await assert.rejects(assets.stage(id, 'image/png', oversized), {
        code: 'asset-image-too-large',
      });
    }
    assert.equal(
      (await runtime.bucket.getFiles({ prefix: `campaigns/${id}/assets/` }))[0].length,
      0
    );
  }
);

test(
  'a real image at the 16,000,000-pixel boundary is accepted without changing its original bytes',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const assets = new PrivateCampaignAssets({ bucket: runtime.bucket });
    const id = randomUUID();
    const bytes = createCanvas(4000, 4000).toBuffer('image/png');
    const reference = await assets.stage(id, 'image/png', bytes);
    assert.equal(reference.width * reference.height, 16000000);
    assert.deepEqual(await assets.read(id, reference), bytes);
  }
);

test(
  'private image reference metadata and stored byte corruption cannot be repaired by restaging the claimed hash',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const assets = new PrivateCampaignAssets({ bucket: runtime.bucket });
    const id = randomUUID();
    const bytes = createCanvas(2, 2).toBuffer('image/png');
    const reference = await assets.stage(id, 'image/png', bytes);
    for (const forged of [
      { ...reference, width: 3 },
      { ...reference, mimeType: 'image/jpeg' },
      { ...reference, generation: String(BigInt(reference.generation) + 1n) },
    ])
      await assert.rejects(assets.read(id, forged), { code: 'asset-integrity-failed' });
    const path = `campaigns/${id}/assets/${reference.sha256}.bin`;
    const file = runtime.bucket.file(path);
    const corrupt = Buffer.from(bytes);
    corrupt[corrupt.length - 1] ^= 1;
    await file.save(corrupt, {
      resumable: false,
      contentType: 'image/png',
      metadata: { metadata: { assetVersion: '1', width: '2', height: '2' } },
    });
    await assert.rejects(assets.stage(id, 'image/png', bytes), { code: 'asset-integrity-failed' });
    assert.deepEqual((await file.download())[0], corrupt);
  }
);

test(
  'owner asset upload is durable and cannot be granted by another account or replayed as another intent',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const owner = await signedInIdentity(runtime);
    const other = await signedInIdentity(runtime);
    t.after(() => owner.close());
    t.after(() => other.close());
    for (const identity of [owner, other])
      await runtime.firestore
        .collection('pilotAccounts')
        .doc(pilotAccountKey(identity.uid))
        .create({ version: 1, uid: identity.uid, enabled: true });
    const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
    const principal = await access.verifyAuthorization('Bearer ' + owner.token);
    const foreign = await access.verifyAuthorization('Bearer ' + other.token);
    const store = new CloudCampaignStore({
      firestore: runtime.firestore,
      access,
      packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1-seed.1' }],
      assets: new PrivateCampaignAssets({ bucket: runtime.bucket }),
    });
    const campaign = await store.create(principal, {
      commandId: randomUUID(),
      options: { name: 'Private upload fixture', ruleset: '2014' },
    });
    const bytes = createCanvas(2, 2).toBuffer('image/png');
    const command = {
      commandId: randomUUID(),
      mimeType: 'image/png',
      data: bytes.toString('base64'),
    };
    await assert.rejects(store.uploadAsset(foreign, campaign.id, command), {
      code: 'campaign-not-found',
    });
    const original = await store.uploadAsset(principal, campaign.id, command);
    assert.equal(original.campaignId, campaign.id);
    assert.equal(original.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(await store.uploadAsset(principal, campaign.id, command), original);
    await assert.rejects(
      store.uploadAsset(principal, campaign.id, {
        ...command,
        mimeType: 'image/jpeg',
      }),
      { code: 'command-id-conflict' }
    );
    assert.equal(
      (await runtime.firestore.collection('campaigns').doc(campaign.id).get()).data().generation,
      1
    );
  }
);
