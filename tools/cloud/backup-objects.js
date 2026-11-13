const { createHash } = require('node:crypto');
const { CloudError } = require('./cloud-error.js');
const { storageUnavailable } = require('./immutable-objects.js');
const {
  isCloudUUID,
  isCloudDigest,
  CLOUD_BACKUP_BYTE_LIMIT,
} = require('../../src/campaigns/CloudProtocol.js');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const integrityError = () =>
  new CloudError(
    503,
    'backup-integrity-failed',
    'The complete private backup failed its integrity check'
  );
const pathFor = (campaignId, backupId, sha256) =>
  `campaigns/${campaignId}/backups/${backupId}/${sha256}.json`;

function isCompleteBackupReference(value, campaignId, backupId) {
  return (
    value?.version === 1 &&
    isCloudUUID(campaignId) &&
    isCloudUUID(backupId) &&
    value.campaignId === campaignId &&
    value.backupId === backupId &&
    isCloudDigest(value.sha256) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= CLOUD_BACKUP_BYTE_LIMIT &&
    typeof value.generation === 'string' &&
    /^[1-9][0-9]*$/.test(value.generation)
  );
}

function storageFailure(error) {
  if (error?.code === 404)
    return new CloudError(
      503,
      'backup-unavailable',
      'The complete private backup is not available'
    );
  if (storageUnavailable(error))
    return new CloudError(
      503,
      'backup-storage-unavailable',
      'Private backup storage is temporarily unavailable'
    );
  return error;
}

class CompleteCloudBackupObjects {
  constructor({ bucket }) {
    if (typeof bucket?.file !== 'function' || typeof bucket.name !== 'string')
      throw new Error('Complete cloud backups require the explicit private bucket');
    this.bucket = bucket;
  }

  async stage(campaignId, backupId, text, reserve) {
    if (
      !isCloudUUID(campaignId) ||
      !isCloudUUID(backupId) ||
      typeof text !== 'string' ||
      !text.length ||
      typeof reserve !== 'function'
    )
      throw new CloudError(
        400,
        'invalid-backup-request',
        'Choose an explicit complete private backup'
      );
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > CLOUD_BACKUP_BYTE_LIMIT)
      throw new CloudError(
        413,
        'backup-too-large',
        'Complete cloud backup files must not exceed 128,000,000 bytes'
      );
    const sha256 = digest(bytes);
    const path = pathFor(campaignId, backupId, sha256);
    await reserve({ path, bytes: bytes.length });
    try {
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
        campaignId,
        backupId,
        bytes: bytes.length,
        sha256,
        generation: metadata.generation,
      };
      await this.read(campaignId, backupId, reference);
      return reference;
    } catch (error) {
      throw storageFailure(error);
    }
  }

  async read(campaignId, backupId, reference) {
    if (!isCompleteBackupReference(reference, campaignId, backupId)) throw integrityError();
    try {
      const path = pathFor(campaignId, backupId, reference.sha256);
      const file = this.bucket.file(path, { generation: reference.generation });
      const [metadata] = await file.getMetadata();
      if (
        metadata.name !== path ||
        metadata.bucket !== this.bucket.name ||
        metadata.generation !== reference.generation ||
        Number(metadata.size) !== reference.bytes
      )
        throw integrityError();
      const [bytes] = await file.download();
      if (bytes.length !== reference.bytes || digest(bytes) !== reference.sha256)
        throw integrityError();
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) {
        if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') throw integrityError();
        throw error;
      }
    } catch (error) {
      throw storageFailure(error);
    }
  }
}

module.exports = { CompleteCloudBackupObjects, isCompleteBackupReference };
