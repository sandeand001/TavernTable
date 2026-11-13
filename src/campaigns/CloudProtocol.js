import { supportedEditions } from '../rules/editions.js';
import {
  CHARACTER_IMAGE_TYPES,
  CHARACTER_IMAGE_FIELDS,
  CHARACTER_IMAGE_FILE_LIMIT,
} from '../config/characters/CharacterImages.js';

export const CLOUD_IMAGE_PIXEL_LIMIT = 16000000;
export const CLOUD_IMAGE_DIMENSION_LIMIT = 8192;
export const CLOUD_BACKUP_BYTE_LIMIT = 128000000;
export const CLOUD_BACKUP_BYTES_HEADER = 'X-TavernTable-Backup-Bytes';
export const CLOUD_BACKUP_DIGEST_HEADER = 'X-TavernTable-Backup-SHA256';
export const CLOUD_IMPORT_CHUNK_BYTES = 1024 * 1024;
export const CLOUD_BACKUP_INTERVAL_MS = 300000;
export const CLOUD_BACKUP_RETAIN = 20;
export const CLOUD_LIVE_WARNING_MS = 55 * 60 * 1000;
export const CLOUD_LIVE_INACTIVITY_MS = 60 * 60 * 1000;

export const isCloudUUID = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const CLOUD_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const isCloudDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isCloudAccessGeneration = (value) => Number.isSafeInteger(value) && value >= 0;
export const CLOUD_ACCESS_SEAT_HEADER = 'X-TavernTable-Seat';
export const CLOUD_ACCESS_GENERATION_HEADER = 'X-TavernTable-Access-Generation';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) =>
  Object.keys(value).length === names.length &&
  Object.keys(value).every((key) => names.includes(key));

export function isCloudLiveSession(value) {
  if (
    !record(value) ||
    !keys(value, [
      'version',
      'campaignId',
      'generation',
      'sessionId',
      'state',
      'startedAt',
      'lastMeaningfulAt',
      'pausedAt',
      'pauseReason',
    ]) ||
    value.version !== 1 ||
    !isCloudUUID(value.campaignId) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    !['paused', 'live'].includes(value.state)
  )
    return false;
  if (value.sessionId === null)
    return (
      value.generation === 0 &&
      value.state === 'paused' &&
      value.startedAt === null &&
      value.lastMeaningfulAt === null &&
      value.pausedAt === null &&
      value.pauseReason === 'not-started'
    );
  if (
    !isCloudUUID(value.sessionId) ||
    value.generation < 1 ||
    typeof value.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    typeof value.lastMeaningfulAt !== 'string' ||
    !Number.isFinite(Date.parse(value.lastMeaningfulAt)) ||
    Date.parse(value.lastMeaningfulAt) < Date.parse(value.startedAt) ||
    !Number.isFinite(
      new Date(Date.parse(value.lastMeaningfulAt) + CLOUD_LIVE_INACTIVITY_MS).getTime()
    )
  )
    return false;
  return value.state === 'live'
    ? value.pausedAt === null && value.pauseReason === null
    : value.generation > 1 &&
        ['owner-end', 'inactivity'].includes(value.pauseReason) &&
        typeof value.pausedAt === 'string' &&
        Number.isFinite(Date.parse(value.pausedAt)) &&
        Date.parse(value.pausedAt) >= Date.parse(value.lastMeaningfulAt) &&
        (value.pauseReason !== 'inactivity' ||
          Date.parse(value.pausedAt) ===
            Date.parse(value.lastMeaningfulAt) + CLOUD_LIVE_INACTIVITY_MS);
}

export function isCloudLiveAccess(value) {
  return (
    record(value) &&
    keys(value, ['version', 'session', 'participant']) &&
    value.version === 1 &&
    isCloudLiveSession(value.session) &&
    value.session.state === 'live' &&
    isCloudParticipantAccess(value.participant) &&
    value.participant.access.campaignId === value.session.campaignId
  );
}

export function cloudLiveStatus(session, now) {
  if (
    !isCloudLiveSession(session) ||
    !Number.isFinite(now) ||
    !Number.isFinite(new Date(now).getTime())
  )
    throw new Error('Live status requires verified session state and a valid server clock');
  const observed = Math.max(
    now,
    Date.parse(session.pausedAt ?? session.lastMeaningfulAt ?? '1970-01-01T00:00:00.000Z')
  );
  const live = session.state === 'live';
  const last = Date.parse(session.lastMeaningfulAt);
  if (live && observed >= last + CLOUD_LIVE_INACTIVITY_MS)
    throw new Error('Evaluate the expired live game before publishing its status');
  return {
    version: 1,
    session,
    activity: {
      observedAt: new Date(observed).toISOString(),
      warningAt: live ? new Date(last + CLOUD_LIVE_WARNING_MS).toISOString() : null,
      pauseAt: live ? new Date(last + CLOUD_LIVE_INACTIVITY_MS).toISOString() : null,
      phase: live ? (observed >= last + CLOUD_LIVE_WARNING_MS ? 'warning' : 'active') : 'paused',
    },
  };
}

export function isCloudLiveStatus(value) {
  if (
    !record(value) ||
    !keys(value, ['version', 'session', 'activity']) ||
    value.version !== 1 ||
    !isCloudLiveSession(value.session) ||
    !record(value.activity) ||
    !keys(value.activity, ['observedAt', 'warningAt', 'pauseAt', 'phase']) ||
    typeof value.activity.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.activity.observedAt))
  )
    return false;
  const now = Date.parse(value.activity.observedAt);
  if (
    value.session.state === 'live' &&
    now >= Date.parse(value.session.lastMeaningfulAt) + CLOUD_LIVE_INACTIVITY_MS
  )
    return false;
  const expected = cloudLiveStatus(value.session, now);
  return Object.entries(expected.activity).every(([key, item]) => value.activity[key] === item);
}

export function isCloudBackupRecord(value) {
  return (
    record(value) &&
    keys(value, ['name', 'createdAt', 'bytes', 'generation']) &&
    isCloudUUID(value.name) &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= CLOUD_BACKUP_BYTE_LIMIT &&
    Number.isSafeInteger(value.generation) &&
    value.generation > 0
  );
}

export function isCloudBackupStatus(value) {
  return (
    record(value) &&
    keys(value, ['state', 'error', 'latest', 'intervalMs', 'retain']) &&
    ['none', 'pending', 'saved', 'error'].includes(value.state) &&
    (value.error === null ||
      (typeof value.error === 'string' && value.error.length > 0 && value.error.length <= 512)) &&
    (value.state === 'error') === (value.error !== null) &&
    (value.latest === null || isCloudBackupRecord(value.latest)) &&
    (value.state !== 'saved' || value.latest !== null) &&
    value.intervalMs === CLOUD_BACKUP_INTERVAL_MS &&
    value.retain === CLOUD_BACKUP_RETAIN
  );
}

export function isCloudImportReceipt(value) {
  if (
    !record(value) ||
    !keys(value, ['version', 'importId', 'bytes', 'sha256', 'campaign']) ||
    value.version !== 1 ||
    !isCloudUUID(value.importId) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > CLOUD_BACKUP_BYTE_LIMIT ||
    !isCloudDigest(value.sha256) ||
    !record(value.campaign)
  )
    return false;
  const campaign = value.campaign;
  const profile = supportedEditions.find((entry) => entry.id === campaign.ruleset);
  return (
    keys(campaign, [
      'version',
      'id',
      'name',
      'ruleset',
      'coreVersion',
      'sourcePacks',
      'charactersRevision',
      'sceneRevision',
      'sceneSavedAt',
      'createdAt',
    ]) &&
    campaign.version === 1 &&
    isCloudUUID(campaign.id) &&
    typeof campaign.name === 'string' &&
    campaign.name.trim().length > 0 &&
    campaign.name.length <= 100 &&
    profile !== undefined &&
    campaign.coreVersion === profile.srd &&
    campaign.charactersRevision === 1 &&
    [0, 1].includes(campaign.sceneRevision) &&
    (campaign.sceneRevision === 0
      ? campaign.sceneSavedAt === null
      : typeof campaign.sceneSavedAt === 'string' &&
        Number.isFinite(Date.parse(campaign.sceneSavedAt))) &&
    typeof campaign.createdAt === 'string' &&
    Number.isFinite(Date.parse(campaign.createdAt)) &&
    Array.isArray(campaign.sourcePacks) &&
    campaign.sourcePacks.length > 0 &&
    campaign.sourcePacks.every(
      (source) =>
        record(source) &&
        keys(source, ['id', 'version', 'ruleset', 'enabled']) &&
        typeof source.id === 'string' &&
        source.id.length > 0 &&
        typeof source.version === 'string' &&
        source.version.length > 0 &&
        source.ruleset === campaign.ruleset &&
        typeof source.enabled === 'boolean'
    ) &&
    new Set(campaign.sourcePacks.map((source) => source.id)).size === campaign.sourcePacks.length
  );
}

export function isCloudImportTicket(value) {
  return (
    record(value) &&
    keys(value, ['version', 'importId', 'campaignId', 'bytes', 'sha256', 'parts', 'completed']) &&
    value.version === 1 &&
    isCloudUUID(value.importId) &&
    isCloudUUID(value.campaignId) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= CLOUD_BACKUP_BYTE_LIMIT &&
    isCloudDigest(value.sha256) &&
    Array.isArray(value.parts) &&
    value.parts.length <= Math.ceil(value.bytes / CLOUD_IMPORT_CHUNK_BYTES) &&
    value.parts.every(
      (part) =>
        record(part) &&
        keys(part, ['index', 'bytes', 'sha256']) &&
        Number.isSafeInteger(part.index) &&
        part.index >= 0 &&
        part.index < Math.ceil(value.bytes / CLOUD_IMPORT_CHUNK_BYTES) &&
        part.bytes ===
          Math.min(CLOUD_IMPORT_CHUNK_BYTES, value.bytes - part.index * CLOUD_IMPORT_CHUNK_BYTES) &&
        isCloudDigest(part.sha256)
    ) &&
    new Set(value.parts.map((part) => part.index)).size === value.parts.length &&
    (value.completed === null ||
      (isCloudImportReceipt(value.completed) &&
        value.completed.importId === value.importId &&
        value.completed.bytes === value.bytes &&
        value.completed.sha256 === value.sha256 &&
        value.completed.campaign.id === value.campaignId))
  );
}

export function isCloudAssetReference(value, campaignId) {
  return (
    record(value) &&
    keys(value, [
      'version',
      'campaignId',
      'mimeType',
      'bytes',
      'sha256',
      'generation',
      'width',
      'height',
    ]) &&
    value.version === 1 &&
    isCloudUUID(campaignId) &&
    value.campaignId === campaignId &&
    CHARACTER_IMAGE_TYPES.includes(value.mimeType) &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= CHARACTER_IMAGE_FILE_LIMIT &&
    isCloudDigest(value.sha256) &&
    typeof value.generation === 'string' &&
    /^[1-9][0-9]*$/.test(value.generation) &&
    Number.isSafeInteger(value.width) &&
    Number.isSafeInteger(value.height) &&
    value.width > 0 &&
    value.height > 0 &&
    value.width <= CLOUD_IMAGE_DIMENSION_LIMIT &&
    value.height <= CLOUD_IMAGE_DIMENSION_LIMIT &&
    value.width * value.height <= CLOUD_IMAGE_PIXEL_LIMIT
  );
}

export function isCloudAssetManifest(value) {
  return (
    record(value) &&
    keys(value, ['version', 'access', 'charactersRevision', 'images']) &&
    value.version === 1 &&
    isCloudAccessScope(value.access) &&
    Number.isSafeInteger(value.charactersRevision) &&
    value.charactersRevision >= 0 &&
    Array.isArray(value.images) &&
    value.images.every(
      (image) =>
        record(image) &&
        keys(image, ['characterId', 'field', 'reference']) &&
        typeof image.characterId === 'string' &&
        image.characterId.length > 0 &&
        CHARACTER_IMAGE_FIELDS.includes(image.field) &&
        isCloudAssetReference(image.reference, value.access.campaignId)
    ) &&
    new Set(value.images.map((image) => image.characterId + ':' + image.field)).size ===
      value.images.length
  );
}

export function isCloudCampaignSettings(value) {
  return (
    record(value) &&
    keys(value, ['version', 'generation', 'campaign']) &&
    value.version === 1 &&
    Number.isSafeInteger(value.generation) &&
    value.generation > 0 &&
    record(value.campaign) &&
    value.campaign.version === 1 &&
    isCloudUUID(value.campaign.id)
  );
}

export function isCloudInvitationLink(value) {
  return (
    record(value) &&
    keys(value, ['version', 'id', 'secret']) &&
    value.version === 1 &&
    isCloudUUID(value.id) &&
    isCloudDigest(value.secret)
  );
}

export function isCloudCampaignAccess(value) {
  if (
    !record(value) ||
    !keys(value, ['version', 'campaign', 'role', 'seatId']) ||
    value.version !== 1 ||
    !['owner', 'member'].includes(value.role) ||
    (value.role === 'owner' ? value.seatId !== null : !isCloudUUID(value.seatId))
  )
    return false;
  const campaign = value.campaign;
  return (
    record(campaign) &&
    keys(campaign, ['id', 'name', 'ruleset', 'coreVersion']) &&
    isCloudUUID(campaign.id) &&
    typeof campaign.name === 'string' &&
    campaign.name.length > 0 &&
    campaign.name.length <= 100 &&
    campaign.name === campaign.name.trim() &&
    supportedEditions.some(
      (profile) => profile.id === campaign.ruleset && profile.srd === campaign.coreVersion
    )
  );
}

export function isCloudAccessScope(value) {
  return (
    record(value) &&
    keys(value, ['version', 'uid', 'campaignId', 'role', 'seatId', 'accessGeneration']) &&
    value.version === 1 &&
    typeof value.uid === 'string' &&
    value.uid.length > 0 &&
    value.uid.length <= 128 &&
    isCloudUUID(value.campaignId) &&
    isCloudAccessGeneration(value.accessGeneration) &&
    (value.role === 'owner'
      ? value.seatId === null && value.accessGeneration === 0
      : value.role === 'member' && isCloudUUID(value.seatId))
  );
}

export function isCloudParticipantAccess(value) {
  if (
    !record(value) ||
    !keys(value, ['version', 'access', 'campaign', 'characterIds']) ||
    value.version !== 1 ||
    !isCloudAccessScope(value.access) ||
    !Array.isArray(value.characterIds) ||
    value.characterIds.some((id) => typeof id !== 'string' || !id) ||
    new Set(value.characterIds).size !== value.characterIds.length ||
    (value.access.role === 'owner' && value.characterIds.length !== 0)
  )
    return false;
  return (
    isCloudCampaignAccess({
      version: 1,
      campaign: value.campaign,
      role: value.access.role,
      seatId: value.access.seatId,
    }) && value.campaign.id === value.access.campaignId
  );
}

export function isCloudInvitation(value) {
  return (
    record(value) &&
    keys(value, ['version', 'id', 'campaignId', 'seatId', 'createdAt', 'expiresAt']) &&
    value.version === 1 &&
    isCloudUUID(value.id) &&
    isCloudUUID(value.campaignId) &&
    isCloudUUID(value.seatId) &&
    typeof value.createdAt === 'string' &&
    typeof value.expiresAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    Date.parse(value.expiresAt) - Date.parse(value.createdAt) === CLOUD_INVITATION_TTL_MS
  );
}

export function isCloudInvitationRevocation(value) {
  return (
    record(value) &&
    keys(value, ['version', 'invitationId', 'revokedAt']) &&
    value.version === 1 &&
    isCloudUUID(value.invitationId) &&
    typeof value.revokedAt === 'string' &&
    Number.isFinite(Date.parse(value.revokedAt))
  );
}

export function isCloudInvitationAcceptance(value) {
  return (
    record(value) &&
    keys(value, ['version', 'invitationId', 'access']) &&
    value.version === 1 &&
    isCloudUUID(value.invitationId) &&
    isCloudCampaignAccess(value.access) &&
    value.access.role === 'member'
  );
}

export function isCloudMemberRemoval(value) {
  return (
    record(value) &&
    keys(value, ['version', 'seatId', 'accessGeneration', 'removedAt']) &&
    value.version === 1 &&
    isCloudUUID(value.seatId) &&
    isCloudAccessGeneration(value.accessGeneration) &&
    value.accessGeneration > 0 &&
    typeof value.removedAt === 'string' &&
    Number.isFinite(Date.parse(value.removedAt))
  );
}

export function isCloudCharacterAssignment(value) {
  return (
    record(value) &&
    keys(value, ['version', 'seatId', 'characterIds', 'accessGeneration', 'changed']) &&
    value.version === 1 &&
    isCloudUUID(value.seatId) &&
    isCloudAccessGeneration(value.accessGeneration) &&
    typeof value.changed === 'boolean' &&
    (!value.changed || value.accessGeneration > 0) &&
    Array.isArray(value.characterIds) &&
    value.characterIds.every((id) => typeof id === 'string' && id.length > 0) &&
    new Set(value.characterIds).size === value.characterIds.length
  );
}

export function isCloudPlayerSeat(value, campaignId) {
  if (
    !record(value) ||
    !keys(value, [
      'version',
      'id',
      'name',
      'characterIds',
      'joined',
      'invitation',
      ...(value.version === 2 ? ['accessGeneration'] : []),
    ]) ||
    ![1, 2].includes(value.version) ||
    (value.version === 2 && !isCloudAccessGeneration(value.accessGeneration)) ||
    !isCloudUUID(value.id) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 80 ||
    !Array.isArray(value.characterIds) ||
    value.characterIds.some((id) => typeof id !== 'string' || !id) ||
    new Set(value.characterIds).size !== value.characterIds.length ||
    typeof value.joined !== 'boolean'
  )
    return false;
  if (value.invitation === null) return true;
  if (value.joined || !record(value.invitation)) return false;
  const { status, ...invitation } = value.invitation;
  return (
    ['pending', 'expired', 'revoked'].includes(status) &&
    isCloudInvitation(invitation) &&
    invitation.campaignId === campaignId &&
    invitation.seatId === value.id
  );
}
