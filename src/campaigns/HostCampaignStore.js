import CampaignStore from './CampaignStore.js';
import SessionConnection from './SessionConnection.js';

export default class HostCampaignStore extends CampaignStore {
  constructor({ packs, fetch = globalThis.fetch, baseURL = globalThis.location.href, host }) {
    super({ packs, indexedDB: null });
    if (!host?.token || typeof host.dataDirectory !== 'string')
      throw new Error('The local campaign host returned an invalid storage configuration');
    this.fetch = (...args) => fetch(...args);
    this.endpoint = new URL('api/campaigns', baseURL).href;
    this.token = host.token;
    this.identity = host.identity || null;
    this.publicOrigin = host.publicOrigin || null;
    this.connection = new SessionConnection({
      identity: host.identity || { id: '', role: 'dm', csrf: host.token },
      fetch,
      baseURL,
    });
    this.storageInfo = { kind: 'host', dataDirectory: host.dataDirectory };
  }

  async _request(operation, args = []) {
    if (this.closed) throw new Error('The campaign database is closed');
    const response = await this.fetch(this.endpoint, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-TavernTable-Host': this.token,
      },
      body: JSON.stringify({ operation, args }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || `The campaign host could not complete the request (${response.status})`
      );
    if (!Object.hasOwn(data, 'result'))
      throw new Error('The campaign host returned no save receipt');
    return data.result;
  }

  create(options) {
    return this._request('create', [options]);
  }
  get(id) {
    return this._request('get', [id]);
  }
  list() {
    return this._request('list');
  }
  update(id, updates) {
    return this._request('update', [id, updates]);
  }
  readCharacters(id) {
    return this._request('readCharacters', [id]);
  }
  readScene(id) {
    return this._request('readScene', [id]);
  }
  commitScene(id, change) {
    return this._request('commitScene', [id, change]);
  }
  commitCharacters(id, change) {
    return this._request('commitCharacters', [id, change]);
  }
  importBackup(text) {
    return this._request('importBackup', [text]);
  }
  backupNow(id) {
    return this._request('backupNow', [id]);
  }
  listBackups(id) {
    return this._request('listBackups', [id]);
  }
  readBackup(id, name) {
    return this._request('readBackup', [id, name]);
  }
  backupStatus(id) {
    return this._request('backupStatus', [id]);
  }
  sessionCall(operation, args) {
    return this.connection.call(operation, args);
  }
  subscribeChanges(listener) {
    return this.connection.subscribe(listener);
  }
  close() {
    this.connection.close();
    return super.close();
  }
}
