const { randomUUID, createHash } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');

test(
  'immutable JSON objects preserve exact Unicode records and independently verified bytes across backend client replacement',
  { timeout: 30000 },
  async (t) => {
    const first = await createEmulatorRuntime();
    t.after(() => first.close());
    const campaignId = randomUUID();
    const records = [
      {
        key: 'taverntable.character.v1.fixture',
        value: JSON.stringify({ fixture: 'Caf\u00e9 \ud83d\udc09', nested: ['exact', 1] }),
      },
    ];
    const objects = new ImmutableCloudObjects({ bucket: first.bucket });
    const reference = await objects.stage(campaignId, 'characters', records);
    const [stored] = await first.bucket
      .file(reference.path, { generation: reference.generation })
      .download();
    assert.equal(reference.bytes, stored.length);
    assert.equal(reference.sha256, createHash('sha256').update(stored).digest('hex'));
    await first.close();
    const replacement = await createEmulatorRuntime();
    t.after(() => replacement.close());
    const reopened = new ImmutableCloudObjects({ bucket: replacement.bucket });
    assert.deepEqual(await reopened.read(campaignId, 'characters', reference), records);
  }
);

test(
  'concurrent identical stages reuse one verified immutable object and its original generation without overwriting it',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const campaignId = randomUUID();
    const scene = '{"fixture":"one immutable value"}';
    const references = await Promise.all(
      Array.from({ length: 4 }, () =>
        new ImmutableCloudObjects({ bucket: runtime.bucket }).stage(campaignId, 'scene', scene)
      )
    );
    for (const reference of references) assert.deepEqual(reference, references[0]);
    const [files] = await runtime.bucket.getFiles({ prefix: `campaigns/${campaignId}/objects/` });
    assert.equal(files.length, 1);
    assert.equal(
      await new ImmutableCloudObjects({ bucket: runtime.bucket }).read(
        campaignId,
        'scene',
        references[0]
      ),
      scene
    );
  }
);

test(
  'the pinned Firebase emulator omits GCS create-only preconditions; real-service enforcement needs its separate approved proof',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const file = runtime.bucket.file(`precondition-fixture/${randomUUID()}.bin`);
    const options = { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } };
    await file.save(Buffer.from('original'), structuredClone(options));
    await file.save(Buffer.from('different'), structuredClone(options));
    const [persisted] = await file.download();
    assert.equal(persisted.toString('utf8'), 'different');
  }
);

test(
  'a corrupt existing content-addressed object is rejected without replacing its bytes or generation',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const campaignId = randomUUID();
    const objects = new ImmutableCloudObjects({ bucket: runtime.bucket });
    const scene = '{"fixture":"original"}';
    const reference = await objects.stage(campaignId, 'scene', scene);
    const file = runtime.bucket.file(reference.path);
    const [stored] = await file.download();
    const corrupt = Buffer.from(stored);
    const index = corrupt.indexOf('original');
    assert.ok(index >= 0);
    corrupt[index] ^= 1;
    await file.save(corrupt, { resumable: false, contentType: 'application/json' });
    const [before] = await file.getMetadata();
    await assert.rejects(objects.stage(campaignId, 'scene', scene), {
      status: 503,
      code: 'snapshot-integrity-failed',
    });
    const [after] = await file.getMetadata();
    const [retained] = await file.download();
    assert.equal(after.generation, before.generation);
    assert.deepEqual(retained, corrupt);
  }
);

test(
  'foreign, malformed and missing object references never disclose another scope or become an empty snapshot',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const campaignId = randomUUID();
    const objects = new ImmutableCloudObjects({ bucket: runtime.bucket });
    const reference = await objects.stage(campaignId, 'characters', []);
    const invalid = [
      { ...reference, version: 2 },
      {
        ...reference,
        path: `campaigns/${randomUUID()}/objects/characters/${reference.sha256}.json`,
      },
      { ...reference, bytes: reference.bytes + 1 },
      { ...reference, sha256: '0'.repeat(64) },
      { ...reference, generation: 'not-a-generation' },
    ];
    for (const candidate of invalid)
      await assert.rejects(objects.read(campaignId, 'characters', candidate), {
        status: 503,
        code: 'snapshot-integrity-failed',
      });
    await assert.rejects(objects.read(randomUUID(), 'characters', reference), {
      status: 503,
      code: 'snapshot-integrity-failed',
    });
    await assert.rejects(objects.read(campaignId, 'scene', reference), {
      status: 503,
      code: 'snapshot-integrity-failed',
    });
    await runtime.bucket.file(reference.path).delete();
    await assert.rejects(objects.read(campaignId, 'characters', reference), {
      status: 503,
      code: 'snapshot-unavailable',
    });
  }
);

test(
  'immutable JSON snapshots accept exactly 32 MiB of UTF-8 bytes and reject one additional byte before uploading',
  { timeout: 60000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const campaignId = randomUUID();
    const objects = new ImmutableCloudObjects({ bucket: runtime.bucket });
    const calibration = await objects.stage(campaignId, 'scene', 'x');
    const maximum = 32 * 1024 * 1024;
    const overhead = calibration.bytes - Buffer.byteLength('x');
    const value = '\u00e9' + 'x'.repeat(maximum - overhead - Buffer.byteLength('\u00e9'));
    const reference = await objects.stage(campaignId, 'scene', value);
    assert.equal(reference.bytes, maximum);
    assert.ok(
      (await objects.read(campaignId, 'scene', reference)) === value,
      'All boundary bytes must round-trip exactly'
    );
    await assert.rejects(objects.stage(campaignId, 'scene', value + 'x'), {
      status: 413,
      code: 'snapshot-too-large',
    });
    const [files] = await runtime.bucket.getFiles({ prefix: `campaigns/${campaignId}/objects/` });
    assert.equal(files.length, 2);
  }
);
