const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('canvas');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { PrivateCampaignAssets } = require('../../tools/cloud/campaign-assets.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { HostResources } = require('../../tools/host-resources.js');
const { default: CampaignCharacters } = require('../../src/campaigns/CampaignCharacters.js');

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

test(
  'assigned image delivery checks the current member scope and cannot revive an older grant after reassignment',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const owner = await signedInIdentity(runtime);
    const member = await signedInIdentity(runtime);
    t.after(() => owner.close());
    t.after(() => member.close());
    for (const identity of [owner, member])
      await runtime.firestore
        .collection('pilotAccounts')
        .doc(pilotAccountKey(identity.uid))
        .create({ version: 1, uid: identity.uid, enabled: true });
    const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
    const principal = await access.verifyAuthorization('Bearer ' + owner.token);
    const player = await access.verifyAuthorization('Bearer ' + member.token);
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(__dirname, '..', '..', 'assets', 'data', 'resources', 'manifest.json'),
        'utf8'
      )
    );
    const resources = new HostResources({ root: path.join(__dirname, '..', '..'), manifest });
    const store = new CloudCampaignStore({
      firestore: runtime.firestore,
      access,
      packs: manifest.packs,
      resources,
      objects: new ImmutableCloudObjects({ bucket: runtime.bucket }),
      assets: new PrivateCampaignAssets({ bucket: runtime.bucket }),
    });
    const api = await cloudApi({ access, store });
    t.after(() => api.close());
    const campaign = await store.create(principal, {
      commandId: randomUUID(),
      options: { name: 'Assigned private image fixture', ruleset: '2014' },
    });
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog: await resources.catalog(campaign),
      store: {
        readCharacters: (id) => store.readCharacters(principal, id),
        commitCharacters: (id, change) =>
          store.commitCharacters(principal, id, { commandId: randomUUID(), change }),
      },
    });
    const characterId = await library.create('Assigned portrait');
    const bytes = createCanvas(2, 2).toBuffer('image/png');
    await library.edit(characterId, {
      portraitImage: 'data:image/png;base64,' + bytes.toString('base64'),
    });
    const hiddenId = await library.create('Hidden NPC portrait');
    const hiddenCanvas = createCanvas(2, 2);
    const hiddenContext = hiddenCanvas.getContext('2d');
    hiddenContext.fillStyle = 'red';
    hiddenContext.fillRect(0, 0, 2, 2);
    const hiddenBytes = hiddenCanvas.toBuffer('image/png');
    await library.edit(hiddenId, {
      portraitImage: 'data:image/png;base64,' + hiddenBytes.toString('base64'),
    });
    const beforeInvalidImage = await store.readCharacters(principal, campaign.id);
    await assert.rejects(
      library.edit(characterId, {
        artworkImage: 'data:image/png;base64,' + bytes.subarray(0, 40).toString('base64'),
      }),
      { code: 'invalid-asset-image' }
    );
    assert.deepEqual(
      (await store.readCharacters(principal, campaign.id)).records,
      beforeInvalidImage.records
    );
    const ownerManifest = await store.getAssetManifest(principal, campaign.id);
    const image = ownerManifest.images.find((entry) => entry.characterId === characterId).reference;
    const hiddenImage = ownerManifest.images.find(
      (entry) => entry.characterId === hiddenId
    ).reference;
    assert.deepEqual((await store.readAsset(principal, campaign.id, image.sha256)).bytes, bytes);
    const secret = randomBytes(32).toString('hex');
    const issued = await store.createInvitation(principal, campaign.id, {
      commandId: randomUUID(),
      options: {
        name: 'Assigned viewer',
        seatId: null,
        tokenHash: createHash('sha256').update(secret).digest('hex'),
      },
    });
    await store.assignCharacter(principal, campaign.id, {
      commandId: randomUUID(),
      seatId: issued.seatId,
      characterId,
      assigned: true,
      accessGeneration: 0,
    });
    await store.redeemInvitation(player, {
      commandId: randomUUID(),
      invitationId: issued.id,
      secret,
    });
    const before = await store.getParticipantAccess(player, campaign.id);
    const imageManifest = await store.getAssetManifest(player, campaign.id);
    assert.deepEqual(imageManifest.access, before.access);
    assert.deepEqual(imageManifest.images, [
      {
        characterId,
        field: 'portraitImage',
        reference: image,
      },
    ]);
    assert.equal(JSON.stringify(imageManifest).includes('Assigned portrait'), false);
    assert.equal(JSON.stringify(imageManifest).includes('base64'), false);
    assert.equal(JSON.stringify(imageManifest).includes(hiddenId), false);
    assert.equal(JSON.stringify(imageManifest).includes(hiddenImage.sha256), false);
    await assert.rejects(store.readAsset(player, campaign.id, hiddenImage.sha256, before.access), {
      code: 'asset-not-found',
    });
    const manifestResponse = await fetch(
      api.url + '/api/cloud/campaigns/' + campaign.id + '/assets/manifest',
      { headers: { Authorization: 'Bearer ' + member.token, Origin: api.origin } }
    );
    assert.equal(manifestResponse.status, 200);
    assert.deepEqual((await manifestResponse.json()).result, imageManifest);
    assert.deepEqual(
      (await store.readAsset(player, campaign.id, image.sha256, before.access)).bytes,
      bytes
    );
    const requestImage = (scope) =>
      fetch(api.url + '/api/cloud/campaigns/' + campaign.id + '/assets/' + image.sha256, {
        headers: {
          Authorization: 'Bearer ' + member.token,
          Origin: api.origin,
          'X-TavernTable-Seat': scope.seatId,
          'X-TavernTable-Access-Generation': String(scope.accessGeneration),
        },
      });
    const response = await requestImage(before.access);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    await store.assignCharacter(principal, campaign.id, {
      commandId: randomUUID(),
      seatId: issued.seatId,
      characterId,
      assigned: false,
      accessGeneration: before.access.accessGeneration,
    });
    await assert.rejects(store.readAsset(player, campaign.id, image.sha256, before.access), {
      code: 'campaign-access-changed',
    });
    assert.equal((await requestImage(before.access)).status, 409);
    const removed = await store.getParticipantAccess(player, campaign.id);
    await assert.rejects(store.readAsset(player, campaign.id, image.sha256, removed.access), {
      code: 'asset-not-found',
    });
    await store.assignCharacter(principal, campaign.id, {
      commandId: randomUUID(),
      seatId: issued.seatId,
      characterId,
      assigned: true,
      accessGeneration: removed.access.accessGeneration,
    });
    await assert.rejects(store.readAsset(player, campaign.id, image.sha256, before.access), {
      code: 'campaign-access-changed',
    });
    const current = await store.getParticipantAccess(player, campaign.id);
    assert.deepEqual(
      (await store.readAsset(player, campaign.id, image.sha256, current.access)).bytes,
      bytes
    );
    const originalFile = runtime.bucket.file;
    let removeDuringDownload = true;
    runtime.bucket.file = function (...args) {
      const file = originalFile.apply(this, args);
      if (args[0] === `campaigns/${campaign.id}/assets/${image.sha256}.bin`) {
        const download = file.download.bind(file);
        file.download = async (...options) => {
          const result = await download(...options);
          if (removeDuringDownload) {
            removeDuringDownload = false;
            await store.removeMember(principal, campaign.id, {
              commandId: randomUUID(),
              seatId: issued.seatId,
              accessGeneration: current.access.accessGeneration,
            });
          }
          return result;
        };
      }
      return file;
    };
    try {
      await assert.rejects(store.readAsset(player, campaign.id, image.sha256, current.access), {
        code: 'campaign-not-found',
      });
    } finally {
      runtime.bucket.file = originalFile;
    }
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
  'private image files accept exactly 10,000,000 bytes and the 8192-pixel side boundary',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const assets = new PrivateCampaignAssets({ bucket: runtime.bucket });
    const id = randomUUID();
    const png = createCanvas(2, 2).toBuffer('image/png');
    const boundary = Buffer.alloc(10000000);
    png.copy(boundary);
    const reference = await assets.stage(id, 'image/png', boundary);
    assert.equal(reference.bytes, 10000000);
    assert.deepEqual(await assets.read(id, reference), boundary);
    await assert.rejects(
      assets.stage(id, 'image/png', Buffer.concat([boundary, Buffer.from([0])])),
      { code: 'asset-too-large' }
    );
    const wide = createCanvas(8192, 1).toBuffer('image/png');
    const wideReference = await assets.stage(id, 'image/png', wide);
    assert.equal(wideReference.width, 8192);
    assert.equal(wideReference.height, 1);
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
    const api = await cloudApi({ access, store });
    t.after(() => api.close());
    const response = await fetch(api.url + '/api/cloud/campaigns/' + campaign.id + '/assets', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + owner.token,
        Origin: api.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });
    assert.equal(response.status, 201);
    const original = (await response.json()).result;
    assert.equal(original.campaignId, campaign.id);
    assert.equal(original.sha256, createHash('sha256').update(bytes).digest('hex'));
    const download = await store.readAsset(principal, campaign.id, original.sha256);
    assert.deepEqual(download.reference, original);
    assert.deepEqual(download.bytes, bytes);
    const delivered = await fetch(
      api.url + '/api/cloud/campaigns/' + campaign.id + '/assets/' + original.sha256,
      { headers: { Authorization: 'Bearer ' + owner.token, Origin: api.origin } }
    );
    assert.equal(delivered.status, 200);
    assert.equal(delivered.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), bytes);
    await assert.rejects(store.readAsset(foreign, campaign.id, original.sha256), {
      code: 'campaign-not-found',
    });
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
