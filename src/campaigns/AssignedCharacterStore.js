export default class AssignedCharacterStore {
  constructor(connection, campaignId) {
    this.connection = connection;
    this.campaignId = campaignId;
    this.storageInfo = { kind: 'host' };
  }

  _requireCampaign(id) {
    if (id !== this.campaignId) throw new Error('This campaign is not assigned to the player');
  }

  readCharacters(id) {
    this._requireCampaign(id);
    return this.connection.call('playerState', [{}]);
  }

  commitCharacters(id, change) {
    this._requireCampaign(id);
    return this.connection.call('playerCommit', [id, change]);
  }

  readScene() {
    return Promise.reject(
      new Error('Player world and combat commands are not enabled in this milestone')
    );
  }

  commitScene() {
    return Promise.reject(
      new Error('Player world and combat commands are not enabled in this milestone')
    );
  }
}
