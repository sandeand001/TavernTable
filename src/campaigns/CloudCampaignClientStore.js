import CampaignStore from './CampaignStore.js';
import {
  isCloudUUID,
  isCloudDigest,
  isCloudCampaignAccess,
  isCloudInvitation,
  isCloudInvitationAcceptance,
  isCloudInvitationRevocation,
  isCloudPlayerSeat,
} from './CloudProtocol.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';

const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
const invalidResponse = () =>
  failure(
    503,
    'invalid-cloud-response',
    'Cloud campaign data is invalid. No local storage fallback was selected.'
  );
const validRevision = (value) => Number.isSafeInteger(value) && value >= 0;
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const copy = (value) => JSON.parse(JSON.stringify(value));
const unsupported = () =>
  failure(
    501,
    'cloud-feature-unavailable',
    'This feature is not enabled for the private cloud preparation slice.'
  );
const definitiveDenials = new Set([
  'invalid-campaign-request',
  'invalid-campaign-change',
  'stale-revision',
  'command-id-conflict',
  'request-too-large',
  'snapshot-too-large',
  'unsupported-request-format',
  'invalid-invitation-request',
  'invitation-unavailable',
  'invitation-already-accepted',
  'seat-already-joined',
  'campaign-already-joined',
]);

export default class CloudCampaignClientStore {
  constructor({ connection, packs, uid, crypto = globalThis.crypto }) {
    if (
      typeof connection?.request !== 'function' ||
      typeof connection.account?.identity !== 'function' ||
      typeof uid !== 'string' ||
      !uid ||
      uid.length > 128 ||
      !Array.isArray(packs) ||
      typeof crypto?.randomUUID !== 'function'
    )
      throw new Error(
        'Cloud campaign storage requires verified account-bound HTTP, pinned sources and command IDs'
      );
    this.connection = connection;
    this.packs = packs;
    this.uid = uid;
    this.crypto = crypto;
    this.closed = false;
    this.pending = null;
    this.saveListeners = new Set();
    this.saveState = Object.freeze({ phase: 'idle', error: null });
    this.storageInfo = Object.freeze({
      kind: 'cloud',
      label: 'Cloud-authoritative storage. Online access is required.',
    });
    this.capabilities = Object.freeze({
      settings: false,
      backups: false,
      invitations: true,
      browserImport: false,
      sharedSessions: false,
      roomVisits: false,
      nativeMotion: false,
    });
  }

  _identity() {
    if (this.closed) throw new Error('The cloud campaign store is closed');
    if (this.connection.account.identity()?.uid !== this.uid)
      throw failure(
        409,
        'account-changed',
        'This workspace belongs to another signed-in account. Reopen its campaigns.'
      );
  }

  async _call(resource, options) {
    this._identity();
    const result = await this.connection.request(resource, options);
    this._identity();
    return result;
  }

  _resource(id, suffix = '') {
    if (!isCloudUUID(id))
      throw failure(404, 'campaign-not-found', 'Choose an explicit private cloud campaign.');
    return `campaigns/${id}${suffix}`;
  }

  async _metadata(value, id = value?.id) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !isCloudUUID(value.id) ||
      value.id !== id ||
      !validRevision(value.sceneRevision) ||
      !validRevision(value.charactersRevision) ||
      !validTime(value.createdAt) ||
      (value.sceneRevision === 0 ? value.sceneSavedAt !== null : !validTime(value.sceneSavedAt)) ||
      Object.hasOwn(value, 'scene')
    )
      throw invalidResponse();
    const record = copy(value);
    const domain = new CampaignStore({
      indexedDB: null,
      packs: this.packs,
      storage: {
        transaction: async (_mode, operation) => operation({ getCampaign: () => record }),
      },
    });
    try {
      return await domain.get(id);
    } catch (error) {
      if (error?.constructor === Error || error instanceof SyntaxError) throw invalidResponse();
      throw error;
    }
  }

  async create(options) {
    this._identity();
    if (!options || typeof options.name !== 'string' || typeof options.ruleset !== 'string')
      throw failure(
        400,
        'invalid-campaign-request',
        'Choose an explicit campaign name and ruleset.'
      );
    return this._write('create', null, options);
  }

  async createInvitation(id, { name, seatId = null } = {}) {
    this._identity();
    this._resource(id);
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 80 ||
      (seatId !== null && !isCloudUUID(seatId))
    )
      throw failure(400, 'invalid-invitation-request', 'Choose an explicit player name and seat.');
    if (
      typeof this.crypto.getRandomValues !== 'function' ||
      typeof this.crypto.subtle?.digest !== 'function' ||
      typeof TextEncoder !== 'function'
    )
      throw failure(
        503,
        'cloud-unavailable',
        'This browser cannot create a secure invitation. No invitation was issued.'
      );
    const hex = (bytes) => [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    const secret = hex(this.crypto.getRandomValues(new Uint8Array(32)));
    const digest = await this.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    const result = await this._write('invitation', id, {
      name,
      seatId,
      tokenHash: hex(new Uint8Array(digest)),
    });
    return { ...result, secret };
  }

  redeemInvitation(invitation) {
    if (!isCloudUUID(invitation?.id) || !isCloudDigest(invitation.secret))
      throw failure(400, 'invalid-invitation-request', 'Choose an explicit private invitation.');
    return this._write('join', null, {
      invitationId: invitation.id,
      secret: invitation.secret,
    });
  }

  revokeInvitation(id, invitationId) {
    if (!isCloudUUID(invitationId))
      throw failure(400, 'invalid-invitation-request', 'Choose an explicit unused invitation.');
    return this._write('revoke', id, { invitationId });
  }

  subscribeSave(listener) {
    if (typeof listener !== 'function')
      throw new Error('Cloud save observation requires a listener');
    this.saveListeners.add(listener);
    listener(this.saveState);
    return () => this.saveListeners.delete(listener);
  }

  _saveStatus(phase, error = null) {
    this.saveState = Object.freeze({
      phase,
      commandId: this.pending?.commandId ?? null,
      operation: this.pending?.operation ?? null,
      campaignId: this.pending?.id ?? null,
      error: error
        ? Object.freeze({
            status: error.status,
            code: error.code,
            message: error.message,
          })
        : null,
    });
    for (const listener of this.saveListeners) {
      try {
        listener(this.saveState);
      } catch (notificationError) {
        logger.log(LOG_LEVEL.ERROR, 'A cloud save-state listener failed', LOG_CATEGORY.SYSTEM, {
          component: 'CloudCampaignClientStore',
          operation: 'notifySave',
          kind: notificationError instanceof Error ? 'error' : 'non-error',
        });
      }
    }
  }

  async _receipt(operation, result, input, id) {
    if (operation === 'revoke') {
      if (!isCloudInvitationRevocation(result) || result.invitationId !== input.invitationId)
        throw invalidResponse();
      return copy(result);
    }
    if (operation === 'join') {
      if (!isCloudInvitationAcceptance(result) || result.invitationId !== input.invitationId)
        throw invalidResponse();
      return copy(result);
    }
    if (operation === 'invitation') {
      if (
        !isCloudInvitation(result) ||
        result.campaignId !== id ||
        (input.seatId !== null && result.seatId !== input.seatId)
      )
        throw invalidResponse();
      return copy(result);
    }
    if (operation === 'create') {
      const metadata = await this._metadata(result);
      if (
        metadata.name !== input.name.trim() ||
        metadata.ruleset !== input.ruleset ||
        metadata.sceneRevision !== 0 ||
        metadata.charactersRevision !== 0
      )
        throw invalidResponse();
      return metadata;
    }
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      !validRevision(result.revision) ||
      result.revision < 1 ||
      result.revision !== input.revision + 1
    )
      throw invalidResponse();
    if (operation === 'scene') {
      if (Object.keys(result).length !== 2 || !validTime(result.savedAt)) throw invalidResponse();
      return { revision: result.revision, savedAt: result.savedAt };
    }
    if (
      Object.keys(result).length !== 3 ||
      !validRevision(result.sceneRevision) ||
      (result.sceneRevision === 0
        ? result.sceneSavedAt !== null
        : !validTime(result.sceneSavedAt)) ||
      (input.scene !== undefined && result.sceneRevision !== input.scene.revision + 1)
    )
      throw invalidResponse();
    return {
      revision: result.revision,
      sceneRevision: result.sceneRevision,
      sceneSavedAt: result.sceneSavedAt,
    };
  }

  async _write(operation, id, value) {
    this._identity();
    if (
      ['scene', 'characters'].includes(operation) &&
      ['invitation', 'revoke'].includes(this.pending?.operation)
    ) {
      // Access metadata leaves canonical revisions unchanged; finish it before a queued checkpoint.
      await this.pending.promise;
      this._identity();
    }
    if (this.pending)
      throw failure(
        409,
        'pending-cloud-command',
        'Resolve the pending cloud save before making another change.'
      );
    if (globalThis.navigator?.onLine === false)
      throw failure(
        503,
        'cloud-offline',
        'Cloud editing requires an online connection. No change was queued.'
      );
    const input = copy(value);
    const commandId = this.crypto.randomUUID();
    if (!isCloudUUID(commandId))
      throw failure(503, 'invalid-command-id', 'A secure cloud command ID could not be created.');
    let resource;
    if (operation === 'create') resource = 'campaigns';
    else if (operation === 'join') resource = 'account/invitations/redeem';
    else if (operation === 'revoke') resource = this._resource(id, '/invitations/revoke');
    else
      resource = this._resource(id, operation === 'invitation' ? '/invitations' : `/${operation}`);
    const body =
      operation === 'join' || operation === 'revoke'
        ? { commandId, ...input }
        : operation === 'create' || operation === 'invitation'
          ? { commandId, options: input }
          : { commandId, change: input };
    let resolve;
    let reject;
    const promise = new Promise((accepted, denied) => {
      resolve = accepted;
      reject = denied;
    });
    const item = {
      operation,
      id,
      input,
      commandId,
      resource,
      body,
      promise,
      resolve,
      reject,
      running: null,
      error: null,
    };
    this.pending = item;
    this._saveStatus('saving');
    void this._attempt(item);
    return promise;
  }

  async _attempt(item) {
    if (item.running) return item.running;
    item.running = (async () => {
      try {
        const result = await this._call(item.resource, { method: 'POST', body: item.body });
        const receipt = await this._receipt(item.operation, result, item.input, item.id);
        this.pending = null;
        this._saveStatus('saved');
        item.resolve(receipt);
      } catch (error) {
        const freshJoinDenial =
          item.operation === 'join' &&
          item.error === null &&
          [
            'pilot-access-required',
            'email-verification-required',
            'invalid-identity',
            'authentication-required',
          ].includes(error.code);
        item.error = error;
        if (freshJoinDenial || definitiveDenials.has(error.code)) {
          this.pending = null;
          this._saveStatus('failed', error);
          item.reject(error);
        } else {
          this._saveStatus('uncertain', error);
        }
      }
    })();
    await item.running;
    item.running = null;
  }

  async retryPending() {
    this._identity();
    const item = this.pending;
    if (!item)
      throw failure(
        400,
        'no-pending-cloud-command',
        'There is no unresolved cloud command to retry.'
      );
    if (item.running) await item.running;
    if (this.pending !== item) return item.promise;
    if (globalThis.navigator?.onLine === false)
      throw failure(503, 'cloud-offline', 'Reconnect before retrying the pending cloud save.');
    this._saveStatus('saving');
    await this._attempt(item);
    if (this.pending === item) throw item.error;
    return item.promise;
  }

  commitScene(id, change) {
    return this._write('scene', id, change);
  }
  commitCharacters(id, change) {
    return this._write('characters', id, change);
  }

  async list() {
    const result = await this._call('campaigns');
    if (!Array.isArray(result) || new Set(result.map((entry) => entry?.id)).size !== result.length)
      throw invalidResponse();
    return Promise.all(result.map((entry) => this._metadata(entry)));
  }

  async listSeats(id) {
    const result = await this._call(this._resource(id, '/seats'));
    if (
      !Array.isArray(result) ||
      result.some((entry) => !isCloudPlayerSeat(entry, id)) ||
      new Set(result.map((entry) => entry.id)).size !== result.length
    )
      throw invalidResponse();
    return copy(result);
  }

  async listAccess() {
    const result = await this._call('account/campaigns');
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      Object.keys(result).length !== 2 ||
      !['owned', 'joined'].every((key) => Array.isArray(result[key])) ||
      result.owned.some((entry) => !isCloudCampaignAccess(entry) || entry.role !== 'owner') ||
      result.joined.some((entry) => !isCloudCampaignAccess(entry) || entry.role !== 'member')
    )
      throw invalidResponse();
    const ids = [...result.owned, ...result.joined].map((entry) => entry.campaign.id);
    if (new Set(ids).size !== ids.length) throw invalidResponse();
    return copy(result);
  }

  async getAccess(id) {
    const result = await this._call(this._resource(id, '/access'));
    if (!isCloudCampaignAccess(result) || result.campaign.id !== id) throw invalidResponse();
    return copy(result);
  }

  async get(id) {
    return this._metadata(await this._call(this._resource(id)), id);
  }

  async readCharacters(id) {
    const result = await this._call(this._resource(id, '/characters'));
    const campaign = await this._metadata(result?.campaign, id);
    if (
      !result ||
      result.revision !== campaign.charactersRevision ||
      result.sceneRevision !== campaign.sceneRevision ||
      result.sceneSavedAt !== campaign.sceneSavedAt ||
      !Array.isArray(result.records) ||
      result.records.length > 10000 ||
      new Set(result.records.map((row) => row?.key)).size !== result.records.length ||
      result.records.some(
        (row) => !row || typeof row.key !== 'string' || !row.key || typeof row.value !== 'string'
      ) ||
      (result.sceneRevision === 0
        ? result.scene !== null
        : typeof result.scene !== 'string' || !result.scene)
    )
      throw invalidResponse();
    return {
      campaign,
      revision: result.revision,
      records: copy(result.records),
      scene: result.scene,
      sceneRevision: result.sceneRevision,
      sceneSavedAt: result.sceneSavedAt,
    };
  }

  async readScene(id) {
    const result = await this._call(this._resource(id, '/scene'));
    const campaign = await this._metadata(result?.campaign, id);
    if (
      !result ||
      result.revision !== campaign.sceneRevision ||
      result.charactersRevision !== campaign.charactersRevision ||
      result.savedAt !== campaign.sceneSavedAt ||
      (result.revision === 0
        ? result.scene !== null
        : typeof result.scene !== 'string' || !result.scene)
    )
      throw invalidResponse();
    return {
      campaign,
      revision: result.revision,
      charactersRevision: result.charactersRevision,
      scene: result.scene,
      savedAt: result.savedAt,
    };
  }

  update() {
    throw unsupported();
  }
  exportBackup() {
    throw unsupported();
  }
  parseBackup() {
    throw unsupported();
  }
  importBackup() {
    throw unsupported();
  }

  close() {
    if (this.pending) throw new Error('Resolve the pending cloud save before closing the campaign');
    this.closed = true;
    this.saveListeners.clear();
  }
}
