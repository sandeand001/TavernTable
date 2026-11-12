import CampaignStore from './CampaignStore.js';
import {
  isCloudUUID,
  isCloudDigest,
  isCloudCampaignAccess,
  isCloudInvitation,
  isCloudInvitationAcceptance,
  isCloudInvitationRevocation,
  isCloudPlayerSeat,
  isCloudAccessScope,
  isCloudParticipantAccess,
  isCloudAccessGeneration,
  isCloudCharacterAssignment,
  isCloudMemberRemoval,
  isCloudCampaignSettings,
  isCloudAssetManifest,
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
  'invalid-campaign-settings',
  'invalid-asset-request',
  'invalid-asset-image',
  'asset-too-large',
  'asset-image-too-large',
]);
const metadataOperations = new Set(['invitation', 'revoke', 'assign', 'remove']);
const definitiveMetadataDenials = new Set([
  'campaign-access-changed',
  'invalid-member-request',
  'invalid-assignment-request',
  'unknown-assignment-character',
  'seat-not-joined',
  'access-generation-exhausted',
  'revision-conflict',
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
      settings: true,
      backups: false,
      invitations: true,
      participantAccess: true,
      assignments: true,
      memberships: true,
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

  _domain(transaction) {
    return new CampaignStore({
      indexedDB: null,
      packs: this.packs,
      storage: { transaction: async (_mode, operation) => operation(transaction) },
    });
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
    const domain = this._domain({ getCampaign: () => record });
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

  removeMember(id, { seatId, accessGeneration } = {}) {
    this._identity();
    this._resource(id);
    if (!isCloudUUID(seatId) || !isCloudAccessGeneration(accessGeneration))
      throw failure(
        400,
        'invalid-member-request',
        'Choose an explicit joined seat and its current access generation.'
      );
    return this._write('remove', id, { seatId, accessGeneration });
  }

  assignCharacter(id, { seatId, characterId, assigned, accessGeneration } = {}) {
    this._identity();
    this._resource(id);
    if (
      !isCloudUUID(seatId) ||
      typeof characterId !== 'string' ||
      !characterId ||
      typeof assigned !== 'boolean' ||
      !isCloudAccessGeneration(accessGeneration)
    )
      throw failure(
        400,
        'invalid-assignment-request',
        'Choose an explicit saved character, seat and current access generation.'
      );
    return this._write('assign', id, { seatId, characterId, assigned, accessGeneration });
  }

  async getParticipantAccess(id, expected = null) {
    this._identity();
    const resource = this._resource(id, '/participant-access');
    if (
      expected !== null &&
      (!isCloudAccessScope(expected) || expected.uid !== this.uid || expected.campaignId !== id)
    )
      throw failure(
        400,
        'invalid-access-scope',
        'Choose the explicit current campaign access scope.'
      );
    const scope = expected === null ? null : copy(expected);
    const result = await this._call(resource, { accessScope: scope });
    if (
      !isCloudParticipantAccess(result) ||
      result.access.uid !== this.uid ||
      result.access.campaignId !== id ||
      (scope !== null &&
        (result.access.role !== scope.role ||
          result.access.seatId !== scope.seatId ||
          result.access.accessGeneration !== scope.accessGeneration))
    )
      throw invalidResponse();
    return copy(result);
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
    if (operation === 'settings') {
      if (!isCloudCampaignSettings(result) || result.generation !== input.generation + 1)
        throw invalidResponse();
      const campaign = await this._metadata(result.campaign, id);
      const expected = input.expectedCampaign;
      if (
        ![
          'version',
          'id',
          'name',
          'ruleset',
          'coreVersion',
          'createdAt',
          'charactersRevision',
          'sceneRevision',
          'sceneSavedAt',
        ].every((key) => campaign[key] === expected[key]) ||
        campaign.sourcePacks.length !== expected.sourcePacks.length ||
        campaign.sourcePacks.some(
          (source, index) =>
            !['id', 'ruleset', 'version', 'enabled'].every(
              (key) => source[key] === expected.sourcePacks[index][key]
            )
        )
      )
        throw invalidResponse();
      return { version: 1, generation: result.generation, campaign };
    }
    if (operation === 'remove') {
      if (
        !isCloudMemberRemoval(result) ||
        result.seatId !== input.seatId ||
        result.accessGeneration !== input.accessGeneration + 1
      )
        throw invalidResponse();
      return copy(result);
    }
    if (operation === 'assign') {
      if (
        !isCloudCharacterAssignment(result) ||
        result.seatId !== input.seatId ||
        result.accessGeneration !== input.accessGeneration + Number(result.changed) ||
        result.characterIds.includes(input.characterId) !== input.assigned
      )
        throw invalidResponse();
      return copy(result);
    }
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
      metadataOperations.has(this.pending?.operation)
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
    else if (operation === 'assign') resource = this._resource(id, '/assignments');
    else if (operation === 'remove') resource = this._resource(id, '/members/remove');
    else
      resource = this._resource(id, operation === 'invitation' ? '/invitations' : `/${operation}`);
    const body =
      operation === 'settings'
        ? { commandId, generation: input.generation, changes: input.changes }
        : ['join', 'revoke', 'assign', 'remove'].includes(operation)
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
        const freshCapacityDenial =
          item.error === null &&
          [
            'campaign-limit-reached',
            'storage-limit-reached',
            'storage-reservation-too-large',
          ].includes(error.code);
        const freshAccessDenial =
          (item.operation === 'join' || metadataOperations.has(item.operation)) &&
          item.error === null &&
          [
            'pilot-access-required',
            'email-verification-required',
            'invalid-identity',
            'authentication-required',
          ].includes(error.code);
        item.error = error;
        if (
          freshCapacityDenial ||
          freshAccessDenial ||
          definitiveDenials.has(error.code) ||
          (metadataOperations.has(item.operation) && definitiveMetadataDenials.has(error.code))
        ) {
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

  async getAssetManifest(id) {
    const result = await this._call(this._resource(id, '/assets/manifest'));
    if (
      !isCloudAssetManifest(result) ||
      result.access.uid !== this.uid ||
      result.access.campaignId !== id
    )
      throw invalidResponse();
    return copy(result);
  }

  async getSettings(id) {
    const result = await this._call(this._resource(id, '/settings'));
    if (!isCloudCampaignSettings(result)) throw invalidResponse();
    return {
      version: 1,
      generation: result.generation,
      campaign: await this._metadata(result.campaign, id),
    };
  }

  async update(id, updates, snapshot) {
    this._identity();
    this._resource(id);
    if (
      !updates ||
      typeof updates !== 'object' ||
      Array.isArray(updates) ||
      !isCloudCampaignSettings(snapshot) ||
      snapshot.campaign.id !== id
    )
      throw failure(
        400,
        'invalid-campaign-settings',
        'Refresh the campaign settings before saving them.'
      );
    const base = copy(snapshot);
    const changes = copy(updates);
    let record = await this._metadata(base.campaign, id);
    const domain = this._domain({
      getCampaign: () => copy(record),
      writeCampaign: (value) => {
        record = copy(value);
      },
    });
    let expectedCampaign;
    try {
      expectedCampaign = await domain.update(id, changes);
    } catch (error) {
      if (error?.constructor === Error || error instanceof SyntaxError)
        throw failure(
          400,
          'invalid-campaign-settings',
          'Choose a valid campaign name and compatible pinned sources.'
        );
      throw error;
    }
    const result = await this._write('settings', id, {
      generation: base.generation,
      changes,
      expectedCampaign,
    });
    return result.campaign;
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
