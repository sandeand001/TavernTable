const { createHash } = require('node:crypto');
const { CloudError } = require('./cloud-error.js');
const { isCloudUUID } = require('../../src/campaigns/CloudProtocol.js');

const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validValue = (kind, value) =>
  kind === 'scene' ? typeof value === 'string' : kind === 'characters' && Array.isArray(value);
const integrityError = () =>
  new CloudError(
    503,
    'snapshot-integrity-failed',
    'The private cloud snapshot failed its integrity check'
  );
const unavailableStorageCodes = new Set([
  401,
  403,
  408,
  429,
  500,
  502,
  503,
  504,
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function storageFailure(error) {
  if (error?.code === 404)
    return new CloudError(
      503,
      'snapshot-unavailable',
      'The referenced private cloud snapshot is unavailable'
    );
  if (unavailableStorageCodes.has(error?.code))
    return new CloudError(
      503,
      'snapshot-storage-unavailable',
      'Private cloud storage is temporarily unavailable; retry online'
    );
  return error;
}

function objectPath(campaignId, kind, sha256) {
  if (!isCloudUUID(campaignId) || !['scene', 'characters'].includes(kind))
    throw new CloudError(
      400,
      'invalid-snapshot-request',
      'Choose an explicit campaign snapshot scope'
    );
  return `campaigns/${campaignId}/objects/${kind}/${sha256}.json`;
}

class ImmutableCloudObjects {
  constructor({ bucket }) {
    if (typeof bucket?.file !== 'function' || typeof bucket.name !== 'string')
      throw new Error('Immutable cloud objects require the explicit private bucket client');
    this.bucket = bucket;
  }

  async stage(campaignId, kind, value) {
    try {
      if (!validValue(kind, value))
        throw new CloudError(
          400,
          'invalid-snapshot-value',
          'Choose canonical scene or character snapshot data'
        );
      const bytes = Buffer.from(JSON.stringify({ version: 1, kind, value }), 'utf8');
      if (bytes.length > MAX_SNAPSHOT_BYTES)
        throw new CloudError(
          413,
          'snapshot-too-large',
          'Cloud JSON snapshots must not exceed 32 MiB'
        );
      const sha256 = digest(bytes);
      const path = objectPath(campaignId, kind, sha256);
      const file = this.bucket.file(path);
      let metadata = null;
      try {
        [metadata] = await file.getMetadata();
      } catch (error) {
        if (error?.code !== 404) throw error;
      }
      if (metadata === null) {
        try {
          await file.save(bytes, {
            resumable: false,
            contentType: 'application/json; charset=utf-8',
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { cacheControl: 'private, no-store' },
          });
        } catch (error) {
          if (error?.code !== 412) throw error;
        }
        [metadata] = await file.getMetadata();
      }
      const reference = {
        version: 1,
        kind,
        path,
        bytes: bytes.length,
        sha256,
        generation: metadata.generation,
      };
      await this.read(campaignId, kind, reference);
      return reference;
    } catch (error) {
      throw storageFailure(error);
    }
  }

  async read(campaignId, kind, reference) {
    try {
      if (
        !reference ||
        reference.version !== 1 ||
        reference.kind !== kind ||
        typeof reference.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(reference.sha256) ||
        !Number.isSafeInteger(reference.bytes) ||
        reference.bytes < 1 ||
        reference.bytes > MAX_SNAPSHOT_BYTES ||
        typeof reference.generation !== 'string' ||
        !/^[1-9][0-9]*$/.test(reference.generation) ||
        reference.path !== objectPath(campaignId, kind, reference.sha256)
      )
        throw integrityError();
      const file = this.bucket.file(reference.path, { generation: reference.generation });
      const [metadata] = await file.getMetadata();
      if (
        metadata.name !== reference.path ||
        metadata.bucket !== this.bucket.name ||
        metadata.generation !== reference.generation ||
        Number(metadata.size) !== reference.bytes
      )
        throw integrityError();
      const [bytes] = await file.download();
      if (bytes.length !== reference.bytes || digest(bytes) !== reference.sha256)
        throw integrityError();
      let envelope;
      try {
        envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch (error) {
        if (error instanceof SyntaxError || error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
          throw integrityError();
        throw error;
      }
      if (envelope?.version !== 1 || envelope.kind !== kind || !validValue(kind, envelope.value))
        throw integrityError();
      return envelope.value;
    } catch (error) {
      throw storageFailure(error);
    }
  }
}

module.exports = { ImmutableCloudObjects, MAX_SNAPSHOT_BYTES };
