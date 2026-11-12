const { createHash } = require('node:crypto');
const { imageSize } = require('image-size');
const sharp = require('sharp');
const { CloudError } = require('./cloud-error.js');
const { storageUnavailable } = require('./immutable-objects.js');
const {
  isCloudUUID,
  isCloudAssetReference,
  CLOUD_IMAGE_PIXEL_LIMIT,
  CLOUD_IMAGE_DIMENSION_LIMIT,
} = require('../../src/campaigns/CloudProtocol.js');
const {
  CHARACTER_IMAGE_FILE_LIMIT,
  CHARACTER_IMAGE_TYPES,
} = require('../../src/config/characters/CharacterImages.js');

const MAX_IMAGE_PIXELS = CLOUD_IMAGE_PIXEL_LIMIT;
const MAX_IMAGE_DIMENSION = CLOUD_IMAGE_DIMENSION_LIMIT;
const MAX_IMAGE_DECODERS = 2;
let activeImageDecoders = 0;
const imageMimeTypes = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const integrityError = () =>
  new CloudError(503, 'asset-integrity-failed', 'The private asset failed its integrity check');
const invalidImage = () =>
  new CloudError(400, 'invalid-asset-image', 'Choose a complete JPEG, PNG or WebP image');
const dimensionsValid = ({ width, height }) =>
  Number.isSafeInteger(width) &&
  Number.isSafeInteger(height) &&
  width > 0 &&
  height > 0 &&
  width <= MAX_IMAGE_DIMENSION &&
  height <= MAX_IMAGE_DIMENSION &&
  width * height <= MAX_IMAGE_PIXELS;

function assetFailure(error) {
  if (error?.code === 404)
    return new CloudError(503, 'asset-unavailable', 'The referenced private asset is unavailable');
  if (storageUnavailable(error))
    return new CloudError(
      503,
      'asset-storage-unavailable',
      'Private asset storage is temporarily unavailable; retry online'
    );
  return error;
}

async function validateImage(bytes, mimeType) {
  let size;
  try {
    size = imageSize(bytes);
  } catch (error) {
    if (error instanceof Error) throw invalidImage();
    throw error;
  }
  if (imageMimeTypes[size.type] !== mimeType) throw invalidImage();
  if (!dimensionsValid(size))
    throw new CloudError(
      413,
      'asset-image-too-large',
      'Images must not exceed 16,000,000 pixels or 8192 pixels on either side'
    );
  let decoded;
  if (activeImageDecoders >= MAX_IMAGE_DECODERS)
    throw Object.assign(
      new CloudError(
        503,
        'asset-processing-busy',
        'Private image processing is busy; retain the pending command and retry shortly'
      ),
      { retryAfter: 1 }
    );
  activeImageDecoders++;
  try {
    decoded = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof Error) throw invalidImage();
    throw error;
  } finally {
    activeImageDecoders--;
  }
  if (!dimensionsValid(decoded.info))
    throw new CloudError(
      413,
      'asset-image-too-large',
      'Images must not exceed 16,000,000 pixels or 8192 pixels on either side'
    );
  return { width: decoded.info.width, height: decoded.info.height };
}

class PrivateCampaignAssets {
  constructor({ bucket }) {
    if (typeof bucket?.file !== 'function' || typeof bucket.name !== 'string')
      throw new Error('Private campaign assets require the explicit private bucket client');
    this.bucket = bucket;
  }

  async stage(campaignId, mimeType, input, reserve = null) {
    if (
      !isCloudUUID(campaignId) ||
      !CHARACTER_IMAGE_TYPES.includes(mimeType) ||
      !Buffer.isBuffer(input) ||
      !input.length
    )
      throw new CloudError(
        400,
        'invalid-asset-request',
        'Choose an explicit campaign and JPEG, PNG or WebP image bytes'
      );
    if (input.length > CHARACTER_IMAGE_FILE_LIMIT)
      throw new CloudError(413, 'asset-too-large', 'Image files must not exceed 10,000,000 bytes');
    const bytes = Buffer.from(input);
    const size = await validateImage(bytes, mimeType);
    const sha256 = hash(bytes);
    const path = `campaigns/${campaignId}/assets/${sha256}.bin`;
    if (reserve !== null) await reserve({ path, bytes: bytes.length });
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
            contentType: mimeType,
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: {
              cacheControl: 'private, no-store',
              metadata: {
                assetVersion: '1',
                width: String(size.width),
                height: String(size.height),
              },
            },
          });
        } catch (error) {
          if (error?.code !== 412) throw error;
        }
        [metadata] = await file.getMetadata();
      }
      const reference = {
        version: 1,
        campaignId,
        mimeType,
        bytes: bytes.length,
        sha256,
        generation: metadata.generation,
        ...size,
      };
      await this.read(campaignId, reference);
      return reference;
    } catch (error) {
      throw assetFailure(error);
    }
  }

  async read(campaignId, reference) {
    if (!isCloudAssetReference(reference, campaignId)) throw integrityError();
    const path = `campaigns/${campaignId}/assets/${reference.sha256}.bin`;
    try {
      const file = this.bucket.file(path, { generation: reference.generation });
      const [metadata] = await file.getMetadata();
      if (
        metadata.name !== path ||
        metadata.bucket !== this.bucket.name ||
        metadata.generation !== reference.generation ||
        Number(metadata.size) !== reference.bytes ||
        metadata.contentType !== reference.mimeType ||
        metadata.metadata?.assetVersion !== '1' ||
        Number(metadata.metadata?.width) !== reference.width ||
        Number(metadata.metadata?.height) !== reference.height
      )
        throw integrityError();
      const [bytes] = await file.download();
      if (bytes.length !== reference.bytes || hash(bytes) !== reference.sha256)
        throw integrityError();
      return bytes;
    } catch (error) {
      throw assetFailure(error);
    }
  }
}

module.exports = {
  PrivateCampaignAssets,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_DIMENSION,
  isPrivateAssetReference: isCloudAssetReference,
};
