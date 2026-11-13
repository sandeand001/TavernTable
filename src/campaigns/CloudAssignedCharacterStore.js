import { isCloudAccessScope } from './CloudProtocol.js';

export default class CloudAssignedCharacterStore {
  constructor({ store, access }) {
    if (
      store?.storageInfo?.kind !== 'cloud' ||
      typeof store.readAssignedCharacters !== 'function' ||
      typeof store.commitAssignedCharacters !== 'function' ||
      !isCloudAccessScope(access) ||
      access.role !== 'member' ||
      access.uid !== store.uid
    )
      throw new Error(
        'Assigned cloud sheets require their current account and player access scope'
      );
    this.store = store;
    this.access = Object.freeze({ ...access });
    this.campaignId = access.campaignId;
    this.storageInfo = store.storageInfo;
    this.identity = Object.freeze({
      role: 'player',
      id: access.seatId,
      uid: access.uid,
      campaignId: access.campaignId,
    });
  }

  _requireCampaign(id) {
    if (id !== this.campaignId) throw new Error('This campaign is not assigned to the player');
  }

  readCharacters(id) {
    this._requireCampaign(id);
    return this.store.readAssignedCharacters(id, this.access);
  }

  commitCharacters(id, change) {
    this._requireCampaign(id);
    return this.store.commitAssignedCharacters(id, change, this.access);
  }

  readScene() {
    return Promise.reject(new Error('Assigned sheets do not grant world or combat access'));
  }

  commitScene() {
    return Promise.reject(new Error('Assigned sheets cannot publish world or combat commands'));
  }
}
