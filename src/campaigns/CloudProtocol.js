import { supportedEditions } from '../rules/editions.js';

export const isCloudUUID = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const CLOUD_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const isCloudDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) =>
  Object.keys(value).length === names.length &&
  Object.keys(value).every((key) => names.includes(key));

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

export function isCloudPlayerSeat(value, campaignId) {
  if (
    !record(value) ||
    !keys(value, ['version', 'id', 'name', 'characterIds', 'joined', 'invitation']) ||
    value.version !== 1 ||
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
