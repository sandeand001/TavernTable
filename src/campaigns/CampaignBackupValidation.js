import CampaignCharacters, { validateCampaignCharacters } from './CampaignCharacters.js';
import { decodeScene } from './CampaignScene.js';

export function validateCampaignBackup(data, catalog) {
  validateCampaignCharacters(data.campaign, catalog, data.records);
  if (data.scene === null) return;
  const library = new CampaignCharacters({
    campaign: data.campaign,
    catalog,
    records: data.records,
    revision: 0,
  });
  decodeScene(data.scene, { ruleset: library.ruleset, library });
}
