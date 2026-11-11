/** @jest-environment node */
import { ImmutableCloudObjects } from '../../../tools/cloud/immutable-objects.js';

test('a create-only 412 race reuses existing bytes only after verifying the complete immutable object', async () => {
  const stored = new Map();
  const bucket = {
    name: 'private-fixture-bucket',
    file: (path) => ({
      save: async (bytes) => {
        stored.set(path, Buffer.from(bytes));
        throw Object.assign(new Error('Another instance created this object'), { code: 412 });
      },
      getMetadata: async () => {
        if (!stored.has(path))
          throw Object.assign(new Error('The object is absent'), { code: 404 });
        return [
          {
            name: path,
            bucket: bucket.name,
            generation: '7',
            size: String(stored.get(path).length),
          },
        ];
      },
      download: async () => [Buffer.from(stored.get(path))],
    }),
  };
  const objects = new ImmutableCloudObjects({ bucket });
  const campaignId = '00000000-0000-4000-8000-000000000001';
  const value = '{"fixture":"the winner created the same canonical bytes"}';
  const reference = await objects.stage(campaignId, 'scene', value);
  expect(reference.generation).toBe('7');
  expect(await objects.read(campaignId, 'scene', reference)).toBe(value);
});

test('missing backend Storage permission is an explicit redacted service failure, not a campaign access denial', async () => {
  const bucket = {
    name: 'private-fixture-bucket',
    file: () => ({
      getMetadata: async () => {
        throw Object.assign(new Error('PRIVATE STORAGE PROVIDER DETAILS'), { code: 403 });
      },
    }),
  };
  const objects = new ImmutableCloudObjects({ bucket });
  let failure;
  try {
    await objects.stage(
      '00000000-0000-4000-8000-000000000001',
      'scene',
      '{"fixture":"unavailable"}'
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ status: 503, code: 'snapshot-storage-unavailable' });
  expect(failure.message).not.toContain('PRIVATE STORAGE PROVIDER DETAILS');
});
