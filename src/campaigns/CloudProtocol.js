import { supportedEditions } from '../rules/editions.js';

export const isCloudUUID = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) =>
  Object.keys(value).length === names.length &&
  Object.keys(value).every((key) => names.includes(key));

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
