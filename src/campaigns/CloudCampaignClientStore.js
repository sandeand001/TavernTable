import CampaignStore from './CampaignStore.js';
import CloudLiveConnection from './CloudLiveConnection.js';
import { sha256 } from '../storage/sha256.js';
import { campaignRecordCharacterId } from './CampaignCharacters.js';
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
  isCloudAssignedCharacterState,
  isCloudAssignedCharacterReceipt,
  isCloudParticipantRequest,
  isCloudOwnerHeadEvent,
  isCloudOwnerWorldRequest,
  isCloudWorldCommandReceipt,
  isCloudAccessGeneration,
  isCloudCharacterAssignment,
  isCloudMemberRemoval,
  isCloudCampaignSettings,
  isCloudAssetManifest,
  CLOUD_BACKUP_BYTE_LIMIT,
  CLOUD_IMPORT_CHUNK_BYTES,
  isCloudImportReceipt,
  isCloudImportTicket,
  isCloudBackupRecord,
  isCloudBackupStatus,
  isCloudLiveSession,
  isCloudLiveStatus,
  isCloudLiveAccess,
  CLOUD_BACKUP_RETAIN,
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
const base64 = (bytes) => {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return globalThis.btoa(parts.join(''));
};
const definitiveDenials = new Set([
  'invalid-campaign-request',
  'invalid-campaign-change',
  'invalid-assigned-change',
  'invalid-scene-presentation',
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
    this.pendingBackup = null;
    this.pendingLive = null;
    this.saveListeners = new Set();
    this.streams = new Set();
    this.liveConnections = new Set();
    this.ownerWorlds = new Map();
    this.issuedCommands = new Set();
    this.saveState = Object.freeze({ phase: 'idle', error: null });
    this.storageInfo = Object.freeze({
      kind: 'cloud',
      label: 'Cloud-authoritative storage. Online access is required.',
    });
    this.capabilities = Object.freeze({
      settings: true,
      backups: true,
      backupRestore: true,
      portability: true,
      invitations: true,
      participantAccess: true,
      assignedSheets: true,
      assignments: true,
      memberships: true,
      browserImport: false,
      sharedSessions: false,
      roomVisits: false,
      nativeMotion: true,
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

  bindOwnerWorld(id, sessionId, access) {
    this._identity();
    if (
      !isCloudUUID(sessionId) ||
      !isCloudAccessScope(access) ||
      access.role !== 'owner' ||
      access.uid !== this.uid ||
      access.campaignId !== id
    )
      throw failure(400, 'invalid-access-scope', 'Choose current live owner world access.');
    const binding = { sessionId, access: copy(access) };
    this.ownerWorlds.set(id, binding);
    return () => {
      if (this.ownerWorlds.get(id) === binding) this.ownerWorlds.delete(id);
    };
  }

  wantsSharedPresentations(id) {
    this._identity();
    return this.ownerWorlds.has(id);
  }

  isLocalChange(event) {
    return event?.origin?.uid === this.uid && this.issuedCommands.has(event.origin.commandId);
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
      backupFileByteLimit: CLOUD_BACKUP_BYTE_LIMIT,
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
    if (operation === 'assigned-characters') {
      if (
        !isCloudAssignedCharacterReceipt(result) ||
        result.campaignId !== id ||
        result.access.uid !== this.uid ||
        result.access.seatId !== input.scope.seatId ||
        result.access.accessGeneration !== input.scope.accessGeneration ||
        result.revision !== input.change.revision + 1
      )
        throw invalidResponse();
      return {
        revision: result.revision,
        sceneRevision: result.sceneRevision,
        sceneSavedAt: result.sceneSavedAt,
      };
    }
    if (operation === 'import') {
      if (
        !isCloudImportReceipt(result) ||
        result.importId !== input.importId ||
        result.bytes !== input.bytes.byteLength ||
        result.sha256 !== input.sha256 ||
        result.campaign.id !== input.targetId
      )
        throw invalidResponse();
      const metadata = await this._metadata(result.campaign);
      if (
        metadata.name !== input.source.name ||
        metadata.ruleset !== input.source.ruleset ||
        metadata.coreVersion !== input.source.coreVersion ||
        metadata.sceneRevision !== (input.hasScene ? 1 : 0) ||
        metadata.sourcePacks.length !== input.source.sourcePacks.length ||
        input.source.sourcePacks.some((source) => {
          const actual = metadata.sourcePacks.find((entry) => entry.id === source.id);
          return (
            !actual || ['version', 'ruleset', 'enabled'].some((key) => actual[key] !== source[key])
          );
        })
      )
        throw invalidResponse();
      return metadata;
    }
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
    const input = operation === 'import' ? value : copy(value);
    const ownerWorld = ['scene', 'characters'].includes(operation)
      ? this.ownerWorlds.get(id)
      : null;
    let presentations = [];
    if (['scene', 'characters'].includes(operation)) {
      const capture = operation === 'scene' ? input : input.scene;
      if (capture && Object.hasOwn(capture, 'presentations')) {
        if (
          !ownerWorld ||
          !Array.isArray(capture.presentations) ||
          capture.presentations.length > 256
        )
          throw failure(
            400,
            'invalid-scene-presentation',
            'Native motion requires the current live owner world.'
          );
        presentations = copy(capture.presentations);
        delete capture.presentations;
      }
    }
    const commandId = this.crypto.randomUUID();
    if (!isCloudUUID(commandId))
      throw failure(503, 'invalid-command-id', 'A secure cloud command ID could not be created.');
    let resource;
    if (operation === 'create') resource = 'campaigns';
    else if (operation === 'import') resource = 'account/imports';
    else if (operation === 'join') resource = 'account/invitations/redeem';
    else if (operation === 'revoke') resource = this._resource(id, '/invitations/revoke');
    else if (operation === 'assign') resource = this._resource(id, '/assignments');
    else if (operation === 'remove') resource = this._resource(id, '/members/remove');
    else
      resource = this._resource(id, operation === 'invitation' ? '/invitations' : `/${operation}`);
    const body =
      operation === 'import'
        ? { commandId, bytes: input.bytes.byteLength, sha256: input.sha256 }
        : operation === 'settings'
          ? { commandId, generation: input.generation, changes: input.changes }
          : ['join', 'revoke', 'assign', 'remove'].includes(operation)
            ? { commandId, ...input }
            : operation === 'create' || operation === 'invitation'
              ? { commandId, options: input }
              : operation === 'assigned-characters'
                ? { commandId, change: input.change }
                : { commandId, change: input };
    if (ownerWorld) {
      body.sessionId = ownerWorld.sessionId;
      body.presentations = presentations;
    }
    this.issuedCommands.add(commandId);
    while (this.issuedCommands.size > 512)
      this.issuedCommands.delete(this.issuedCommands.values().next().value);
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
      importStarted: false,
    };
    if (operation === 'import') input.importId = commandId;
    this.pending = item;
    this._saveStatus('saving');
    void this._attempt(item);
    return promise;
  }

  async _attempt(item) {
    if (item.running) return item.running;
    item.running = (async () => {
      try {
        const result =
          item.operation === 'import'
            ? await this._importAttempt(item)
            : await this._call(item.resource, {
                method: 'POST',
                body: item.body,
                accessScope: item.operation === 'assigned-characters' ? item.input.scope : null,
              });
        const receipt = await this._receipt(item.operation, result, item.input, item.id);
        this._identity();
        this.pending = null;
        this._saveStatus('saved');
        item.resolve(receipt);
      } catch (error) {
        const freshCapacityDenial =
          item.error === null &&
          (item.operation !== 'import' || !item.importStarted) &&
          [
            'campaign-limit-reached',
            'storage-limit-reached',
            'storage-reservation-too-large',
          ].includes(error.code);
        const freshAccessDenial =
          (item.operation === 'join' ||
            metadataOperations.has(item.operation) ||
            (item.operation === 'import' && !item.importStarted)) &&
          item.error === null &&
          [
            'pilot-access-required',
            'email-verification-required',
            'invalid-identity',
            'authentication-required',
          ].includes(error.code);
        const freshAssignedDenial =
          item.operation === 'assigned-characters' &&
          item.error === null &&
          [
            'campaign-access-changed',
            'campaign-not-found',
            'pilot-access-required',
            'email-verification-required',
            'invalid-identity',
            'authentication-required',
            'account-changed',
          ].includes(error.code);
        const freshLiveDenial =
          item.body.sessionId !== undefined &&
          item.error === null &&
          ['live-session-paused', 'live-session-changed', 'campaign-access-changed'].includes(
            error.code
          );
        item.error = error;
        const terminal =
          item.operation === 'import'
            ? [
                'import-rejected',
                'import-expired',
                'command-id-conflict',
                'import-campaign-limit-reached',
                'import-storage-limit-reached',
                'import-image-too-large',
                'import-invalid-image',
              ].includes(error.code) ||
              freshAccessDenial ||
              freshCapacityDenial
            : freshCapacityDenial ||
              freshAccessDenial ||
              freshAssignedDenial ||
              freshLiveDenial ||
              definitiveDenials.has(error.code) ||
              (metadataOperations.has(item.operation) && definitiveMetadataDenials.has(error.code));
        if (terminal) {
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

  async _fileDigest(bytes) {
    const value = await sha256(bytes, this.crypto);
    if (!isCloudDigest(value))
      throw failure(503, 'cloud-unavailable', 'Complete file hashing is unavailable.');
    return value;
  }

  async _importAttempt(item) {
    const ticket = await this._call(item.resource, { method: 'POST', body: item.body });
    const input = item.input;
    if (
      !isCloudImportTicket(ticket) ||
      ticket.importId !== item.commandId ||
      ticket.bytes !== input.bytes.byteLength ||
      ticket.sha256 !== input.sha256 ||
      (input.targetId !== null && input.targetId !== ticket.campaignId)
    )
      throw invalidResponse();
    item.importStarted = true;
    input.targetId = ticket.campaignId;
    if (ticket.completed !== null) return ticket.completed;
    const count = Math.ceil(input.bytes.byteLength / CLOUD_IMPORT_CHUNK_BYTES);
    for (let index = 0; index < count; index++) {
      const bytes = input.bytes.subarray(
        index * CLOUD_IMPORT_CHUNK_BYTES,
        Math.min((index + 1) * CLOUD_IMPORT_CHUNK_BYTES, input.bytes.byteLength)
      );
      const sha256 = await this._fileDigest(bytes);
      this._identity();
      const previous = ticket.parts.find((part) => part.index === index);
      if (previous) {
        if (previous.bytes !== bytes.byteLength || previous.sha256 !== sha256)
          throw invalidResponse();
        continue;
      }
      const result = await this._call(`${item.resource}/${item.commandId}/parts`, {
        method: 'POST',
        body: { index, data: base64(bytes) },
      });
      if (
        !result ||
        Object.keys(result).length !== 5 ||
        result.version !== 1 ||
        result.importId !== item.commandId ||
        result.index !== index ||
        result.bytes !== bytes.byteLength ||
        result.sha256 !== sha256
      )
        throw invalidResponse();
    }
    return this._call(`${item.resource}/${item.commandId}/finish`, {
      method: 'POST',
      body: { commandId: item.commandId },
    });
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

  async readAssignedCharacters(id, expected) {
    if (
      !isCloudAccessScope(expected) ||
      expected.uid !== this.uid ||
      expected.campaignId !== id ||
      expected.role !== 'member'
    )
      throw failure(
        400,
        'invalid-access-scope',
        'Choose the current assigned-character access scope.'
      );
    const scope = copy(expected);
    const result = await this._call(this._resource(id, '/assigned-characters'), {
      accessScope: scope,
    });
    if (
      !isCloudAssignedCharacterState(result) ||
      result.access.uid !== this.uid ||
      result.access.campaignId !== id ||
      result.access.seatId !== scope.seatId ||
      result.access.accessGeneration !== scope.accessGeneration ||
      result.records.some(
        (row) => !result.characterIds.includes(campaignRecordCharacterId(row.key))
      )
    )
      throw invalidResponse();
    const campaign = await this._metadata(result.campaign, id);
    if (
      result.revision !== campaign.charactersRevision ||
      result.sceneRevision !== campaign.sceneRevision ||
      result.sceneSavedAt !== campaign.sceneSavedAt
    )
      throw invalidResponse();
    return { ...copy(result), campaign };
  }

  async readParticipantSnapshot(id, view, expected, { cachedAssets = null } = {}) {
    if (
      !isCloudAccessScope(expected) ||
      expected.uid !== this.uid ||
      expected.campaignId !== id ||
      expected.role !== 'member'
    )
      throw failure(400, 'invalid-access-scope', 'Choose current player access before joining.');
    if (!isCloudParticipantRequest(view) || (view.assetKey !== null && cachedAssets === null))
      throw failure(
        400,
        'invalid-participant-request',
        'Choose a current live view and its verified cache.'
      );
    const scope = copy(expected);
    const input = copy(view);
    const result = await this._call(this._resource(id, '/participant-state'), {
      method: 'POST',
      body: input,
      accessScope: scope,
    });
    return this._verifiedParticipantSnapshot(id, result, input, scope, cachedAssets);
  }

  async _verifiedParticipantSnapshot(id, result, input, scope, cachedAssets) {
    const { validateCloudParticipantSnapshot } = await import('./CloudParticipantProtocol.js');
    try {
      validateCloudParticipantSnapshot(result, { cachedAssets });
    } catch (error) {
      if (
        error.code === 'invalid-cloud-participant' ||
        error.code === 'invalid-player-state' ||
        error?.constructor === Error ||
        error instanceof SyntaxError
      )
        throw invalidResponse();
      throw error;
    }
    if (
      result.access.uid !== this.uid ||
      result.access.campaignId !== id ||
      result.access.seatId !== scope.seatId ||
      result.access.accessGeneration !== scope.accessGeneration ||
      result.sessionId !== input.sessionId
    )
      throw invalidResponse();
    const assets =
      result.state.publicScene.assetKey === null
        ? null
        : result.state.publicScene.assets || cachedAssets;
    if (
      assets &&
      (await this._fileDigest(new TextEncoder().encode(JSON.stringify(assets)))) !==
        result.state.publicScene.assetKey
    )
      throw invalidResponse();
    const campaign = await this._metadata(result.state.campaign, id);
    this._identity();
    return { ...copy(result), state: { ...copy(result.state), campaign } };
  }

  observeEvents(id, view, expected, { cachedAssets = null, onState, onStatus } = {}) {
    this._identity();
    const connection = new CloudLiveConnection({
      store: this,
      account: this.connection.account,
      id,
      view,
      scope: expected,
      cachedAssets,
      onState,
      onStatus,
    });
    this.liveConnections.add(connection);
    void connection.done.then(() => this.liveConnections.delete(connection));
    return connection;
  }

  async openEvents(id, view, expected, { cachedAssets = null, signal = null } = {}) {
    return this._openEvents(id, view, expected, { cachedAssets, signal }, false);
  }

  async openOwnerEvents(id, request, expected, { signal = null } = {}) {
    return this._openEvents(id, request, expected, { cachedAssets: null, signal }, true);
  }

  observeOwnerEvents(id, request, expected, { onState, onStatus } = {}) {
    this._identity();
    if (
      !isCloudAccessScope(expected) ||
      expected.uid !== this.uid ||
      expected.campaignId !== id ||
      expected.role !== 'owner' ||
      !isCloudOwnerWorldRequest(request)
    )
      throw failure(400, 'invalid-access-scope', 'Choose current live owner world access.');
    const connection = new CloudLiveConnection({
      store: this,
      account: this.connection.account,
      id,
      view: request,
      scope: expected,
      onState,
      onStatus,
      ownerWorld: true,
    });
    this.liveConnections.add(connection);
    void connection.done.then(() => this.liveConnections.delete(connection));
    return connection;
  }

  async _openEvents(id, view, expected, { cachedAssets = null, signal = null }, ownerWorld) {
    this._identity();
    if (
      !isCloudAccessScope(expected) ||
      expected.uid !== this.uid ||
      expected.campaignId !== id ||
      (ownerWorld && expected.role !== 'owner')
    )
      throw failure(400, 'invalid-access-scope', 'Choose current live campaign access.');
    if (
      (ownerWorld ? !isCloudOwnerWorldRequest(view) : !isCloudParticipantRequest(view)) ||
      (!ownerWorld && view.assetKey !== null && cachedAssets === null) ||
      (!ownerWorld &&
        expected.role === 'owner' &&
        [view.observerTokenId, view.mapId, view.assetKey, cachedAssets].some(
          (value) => value !== null
        ))
    )
      throw failure(
        400,
        'invalid-participant-request',
        'Choose a current live view and verified cache.'
      );
    const scope = copy(expected);
    const input = copy(view);
    let assets = cachedAssets === null ? null : copy(cachedAssets);
    let previous = null;
    let ended = false;
    let closing;
    const { applyCloudParticipantDelta } = await import('./CloudParticipantProtocol.js');
    const ownerProtocol = ownerWorld ? await import('./CloudOwnerProtocol.js') : null;
    this._identity();
    const source = await this.connection.request(
      this._resource(id, ownerWorld ? '/owner-events' : '/events'),
      {
        method: 'POST',
        body: input,
        accessScope: scope,
        responseType: 'events',
        signal,
      }
    );
    const close = () => {
      if (closing) return closing;
      ended = true;
      previous = null;
      assets = null;
      this.streams.delete(events);
      closing = source.close();
      return closing;
    };
    const events = {
      [Symbol.asyncIterator]() {
        return this;
      },
      close,
      return: async () => {
        await close();
        return { done: true, value: undefined };
      },
      next: async () => {
        if (ended) return { done: true, value: undefined };
        try {
          this._identity();
          const step = await source.next();
          this._identity();
          if (step.done || step.value.kind === 'closed') {
            await close();
            return step;
          }
          const event = step.value;
          if (ownerWorld) {
            if (
              !['owner-checkpoint', 'owner-resync', 'owner-delta'].includes(event.kind) ||
              Object.keys(event).length !== 2 ||
              !Object.hasOwn(event, event.kind === 'owner-delta' ? 'delta' : 'checkpoint')
            )
              throw invalidResponse();
            if (event.kind === 'owner-delta' && previous === null)
              throw failure(409, 'owner-delta-gap', 'Read a current owner checkpoint first.');
            const checkpoint =
              event.kind === 'owner-delta'
                ? ownerProtocol.applyCloudOwnerDelta(previous, event.delta)
                : ownerProtocol.validateCloudOwnerSnapshot(event.checkpoint);
            if (
              checkpoint.access.uid !== scope.uid ||
              checkpoint.access.campaignId !== id ||
              checkpoint.sessionId !== input.sessionId ||
              (previous && checkpoint.generation < previous.generation)
            )
              throw invalidResponse();
            const campaign = await this._metadata(checkpoint.state.campaign, id);
            previous = { ...copy(checkpoint), state: { ...copy(checkpoint.state), campaign } };
          } else if (scope.role === 'owner') {
            if (
              !isCloudOwnerHeadEvent(event) ||
              event.access.uid !== scope.uid ||
              event.access.campaignId !== id ||
              event.sessionId !== input.sessionId ||
              (previous && event.head.generation < previous.head.generation)
            )
              throw invalidResponse();
            previous = copy(event);
          } else {
            if (
              !['checkpoint', 'delta', 'resync'].includes(event.kind) ||
              Object.keys(event).length !== 2 ||
              !Object.hasOwn(event, event.kind === 'delta' ? 'delta' : 'checkpoint')
            )
              throw invalidResponse();
            if (event.kind === 'delta' && previous === null)
              throw failure(
                409,
                'participant-delta-gap',
                'Read a current authorized checkpoint first.'
              );
            const checkpoint =
              event.kind === 'delta'
                ? applyCloudParticipantDelta(previous, event.delta, { cachedAssets: assets })
                : event.checkpoint;
            previous = await this._verifiedParticipantSnapshot(
              id,
              checkpoint,
              input,
              scope,
              assets
            );
            assets =
              previous.state.publicScene.assetKey === null
                ? null
                : previous.state.publicScene.assets || assets;
          }
          this._identity();
          if (ended) return { done: true, value: undefined };
          return { done: false, value: copy(event) };
        } catch (error) {
          await close();
          throw error;
        }
      },
    };
    try {
      this._identity();
      this.streams.add(events);
      return events;
    } catch (error) {
      await close();
      throw error;
    }
  }

  commitAssignedCharacters(id, change, expected) {
    if (
      !isCloudAccessScope(expected) ||
      expected.uid !== this.uid ||
      expected.campaignId !== id ||
      expected.role !== 'member'
    )
      throw failure(
        400,
        'invalid-access-scope',
        'Choose the current assigned-character access scope.'
      );
    return this._write('assigned-characters', id, { change, scope: copy(expected) });
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

  async commitWorldCommand(id, request, expected) {
    this._identity();
    if (
      !isCloudAccessScope(expected) ||
      expected.uid !== this.uid ||
      expected.campaignId !== id ||
      expected.role !== 'member' ||
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      Object.keys(request).length !== 2 ||
      !Object.hasOwn(request, 'sessionId') ||
      !Object.hasOwn(request, 'command') ||
      !isCloudUUID(request.sessionId) ||
      !isCloudUUID(request.command?.commandId)
    )
      throw failure(400, 'invalid-command', 'Choose current assigned live command access.');
    const input = copy(request);
    const scope = copy(expected);
    const { validatePlayerCommand } = await import('./PlayerCommandProtocol.js');
    validatePlayerCommand(input.command);
    const result = await this._call(this._resource(id, '/world-commands'), {
      method: 'POST',
      body: input,
      accessScope: scope,
    });
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      !Object.hasOwn(result, 'presentation')
    )
      throw invalidResponse();
    const { presentation, ...receipt } = result;
    if (
      !isCloudWorldCommandReceipt(receipt) ||
      receipt.access.uid !== this.uid ||
      receipt.campaignId !== id ||
      receipt.access.seatId !== scope.seatId ||
      receipt.access.accessGeneration !== scope.accessGeneration ||
      receipt.sessionId !== input.sessionId ||
      receipt.commandId !== input.command.commandId ||
      receipt.kind !== input.command.kind ||
      receipt.applied.sceneRevision !== input.command.sceneRevision + 1 ||
      receipt.applied.charactersRevision < input.command.charactersRevision ||
      (receipt.outcome === 'duplicate'
        ? presentation !== null
        : !presentation ||
          typeof presentation !== 'object' ||
          Array.isArray(presentation) ||
          presentation.kind !== input.command.kind ||
          (input.command.kind === 'place'
            ? presentation.characterId !== input.command.payload.characterId
            : presentation.tokenId !== input.command.tokenId))
    )
      throw invalidResponse();
    return copy(result);
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
  async getLiveSession(id) {
    const result = await this._call(this._resource(id, '/live'));
    if (!isCloudLiveSession(result) || result.campaignId !== id) throw invalidResponse();
    return copy(result);
  }

  async getLiveStatus(id) {
    const result = await this._call(this._resource(id, '/live/status'));
    if (!isCloudLiveStatus(result) || result.session.campaignId !== id) throw invalidResponse();
    return copy(result);
  }

  async getLiveAccess(id, sessionId) {
    if (!(sessionId === null || isCloudUUID(sessionId)))
      throw failure(
        400,
        'invalid-live-command',
        'Choose the current live game before entering its world.'
      );
    const result = await this._call(this._resource(id, '/live/access'), {
      method: 'POST',
      body: { sessionId },
    });
    if (
      !isCloudLiveAccess(result) ||
      result.session.campaignId !== id ||
      result.session.sessionId !== sessionId ||
      result.participant.access.uid !== this.uid
    )
      throw invalidResponse();
    return copy(result);
  }

  controlLiveSession(id, action, snapshot) {
    this._identity();
    this._resource(id);
    if (
      !['start', 'end', 'keep-active'].includes(action) ||
      !isCloudLiveSession(snapshot) ||
      snapshot.campaignId !== id
    )
      throw failure(
        400,
        'invalid-live-command',
        'Refresh the campaign live-game state before an owner action.'
      );
    if (this.pendingLive !== null)
      throw failure(
        409,
        'live-control-pending',
        'Recover the original live-game action before starting another.'
      );
    const item = {
      id,
      snapshot: copy(snapshot),
      uncertain: false,
      promise: null,
      body: {
        commandId: this.crypto.randomUUID(),
        action,
        generation: snapshot.generation,
        sessionId: snapshot.sessionId,
      },
    };
    this.pendingLive = item;
    return this._liveAttempt(item);
  }

  retryLiveSession() {
    this._identity();
    if (this.pendingLive === null)
      throw failure(
        409,
        'no-pending-live-control',
        'There is no original live-game action to recover.'
      );
    return this._liveAttempt(this.pendingLive);
  }

  _liveAttempt(item) {
    if (item.promise !== null) return item.promise;
    item.promise = this._call(this._resource(item.id, '/live'), {
      method: 'POST',
      body: copy(item.body),
    })
      .then((result) => {
        if (
          !isCloudLiveSession(result) ||
          result.campaignId !== item.id ||
          result.generation !== item.body.generation + 1
        )
          throw invalidResponse();
        const start = item.body.action === 'start';
        if (
          (start &&
            (result.state !== 'live' ||
              result.sessionId === item.body.sessionId ||
              result.startedAt !== result.lastMeaningfulAt)) ||
          (!start &&
            (result.sessionId !== item.body.sessionId ||
              result.startedAt !== item.snapshot.startedAt)) ||
          (item.body.action === 'end' &&
            (result.state !== 'paused' ||
              result.pauseReason !== 'owner-end' ||
              Date.parse(result.lastMeaningfulAt) < Date.parse(item.snapshot.lastMeaningfulAt))) ||
          (item.body.action === 'keep-active' &&
            (result.state !== 'live' ||
              Date.parse(result.lastMeaningfulAt) < Date.parse(item.snapshot.lastMeaningfulAt)))
        )
          throw invalidResponse();
        this.pendingLive = null;
        return copy(result);
      })
      .catch((error) => {
        if (
          !item.uncertain &&
          [
            'invalid-live-command',
            'live-session-changed',
            'live-session-paused',
            'live-session-already-started',
            'command-id-conflict',
            'campaign-not-found',
            'authentication-required',
            'invalid-identity',
            'email-verification-required',
            'pilot-access-required',
            'account-changed',
          ].includes(error.code)
        )
          this.pendingLive = null;
        else item.uncertain = true;
        throw error;
      })
      .finally(() => {
        item.promise = null;
      });
    return item.promise;
  }

  async listBackups(id) {
    const result = await this._call(this._resource(id, '/backups'));
    if (
      !Array.isArray(result) ||
      result.length > CLOUD_BACKUP_RETAIN ||
      result.some((record) => !isCloudBackupRecord(record)) ||
      new Set(result.map((record) => record.name)).size !== result.length
    )
      throw invalidResponse();
    return copy(result);
  }

  async backupStatus(id) {
    const result = await this._call(this._resource(id, '/backups/status'));
    if (!isCloudBackupStatus(result)) throw invalidResponse();
    return copy(result);
  }

  async backupNow(id) {
    this._identity();
    const resource = this._resource(id, '/backups');
    if (this.pendingBackup !== null && this.pendingBackup.id !== id)
      throw failure(
        409,
        'backup-pending',
        'Retry the original campaign backup before starting another.'
      );
    const item = this.pendingBackup ?? {
      id,
      commandId: this.crypto.randomUUID(),
      uncertain: false,
      promise: null,
    };
    this.pendingBackup = item;
    if (item.promise !== null) return item.promise;
    item.promise = this._call(resource, { method: 'POST', body: { commandId: item.commandId } })
      .then((result) => {
        if (!isCloudBackupRecord(result) || result.name !== item.commandId) throw invalidResponse();
        this.pendingBackup = null;
        return copy(result);
      })
      .catch((error) => {
        if (
          !item.uncertain &&
          [
            'invalid-backup-request',
            'campaign-not-found',
            'authentication-required',
            'invalid-identity',
            'email-verification-required',
            'pilot-access-required',
          ].includes(error.code)
        )
          this.pendingBackup = null;
        else item.uncertain = true;
        throw error;
      })
      .finally(() => {
        item.promise = null;
      });
    return item.promise;
  }

  async readBackup(id, name) {
    if (!isCloudUUID(name))
      throw failure(400, 'invalid-backup-request', 'Choose an explicit retained private backup.');
    const text = await this._call(this._resource(id, `/backups/${name}`), {
      responseType: 'backup',
    });
    let data;
    try {
      data = this.parseBackup(text);
    } catch (error) {
      if (error?.constructor === Error || error instanceof SyntaxError) throw invalidResponse();
      throw error;
    }
    if (data.version !== 2 || data.campaign.id !== id) throw invalidResponse();
    return text;
  }

  async finishBackupSession(id) {
    const result = await this._call(this._resource(id, '/backups/work'), {
      method: 'POST',
      body: { final: true },
    });
    if (result !== null && !isCloudBackupRecord(result)) throw invalidResponse();
    return result === null ? null : copy(result);
  }

  async exportBackup(id) {
    const text = await this._call(this._resource(id, '/backup'), { responseType: 'backup' });
    let data;
    try {
      data = this.parseBackup(text);
    } catch (error) {
      if (['invalid-campaign-backup', 'backup-too-large'].includes(error?.code))
        throw invalidResponse();
      throw error;
    }
    if (data.campaign.id !== id) throw invalidResponse();
    await this._metadata(data.campaign, id);
    this._identity();
    return text;
  }
  parseBackup(text) {
    try {
      return this._domain({}).parseBackup(text);
    } catch (error) {
      if (error?.code === 'backup-too-large')
        throw failure(
          413,
          'backup-too-large',
          'Cloud campaign files must not exceed 128,000,000 UTF-8 bytes.'
        );
      if (error?.constructor === Error || error instanceof SyntaxError)
        throw failure(
          400,
          'invalid-campaign-backup',
          'Choose a complete supported campaign JSON backup.'
        );
      throw error;
    }
  }
  async importBackup(text) {
    this._identity();
    if (this.pending)
      throw failure(
        409,
        'pending-cloud-command',
        'Resolve the pending cloud save before importing another file.'
      );
    if (
      typeof this.crypto.subtle?.digest !== 'function' ||
      typeof globalThis.btoa !== 'function' ||
      typeof TextEncoder !== 'function'
    )
      throw failure(
        503,
        'cloud-unavailable',
        'This browser cannot transfer a complete campaign file.'
      );
    const data = this.parseBackup(text);
    const source = {
      name: data.campaign.name,
      ruleset: data.campaign.ruleset,
      coreVersion: data.campaign.coreVersion,
      sourcePacks: data.campaign.sourcePacks.map(({ id, version, ruleset, enabled }) => ({
        id,
        version,
        ruleset,
        enabled,
      })),
    };
    const bytes = new TextEncoder().encode(text);
    const sha256 = await this._fileDigest(bytes);
    this._identity();
    return this._write('import', null, {
      bytes,
      sha256,
      source,
      hasScene: data.scene !== null,
      targetId: null,
    });
  }

  close() {
    if (this.pending) throw new Error('Resolve the pending cloud save before closing the campaign');
    this.closed = true;
    this.ownerWorlds.clear();
    this.issuedCommands.clear();
    this.saveListeners.clear();
    for (const connection of this.liveConnections)
      void connection.close().catch((error) => {
        logger.log(
          LOG_LEVEL.ERROR,
          'A live campaign observation could not close',
          LOG_CATEGORY.SYSTEM,
          {
            component: 'CloudCampaignClientStore',
            code: 'live-observation-close-failed',
            kind: error instanceof Error ? 'error' : 'non-error',
          }
        );
      });
    for (const stream of this.streams)
      void stream.close().catch((error) => {
        logger.log(LOG_LEVEL.ERROR, 'A cloud event stream could not close', LOG_CATEGORY.SYSTEM, {
          component: 'CloudCampaignClientStore',
          code: 'stream-close-failed',
          kind: error instanceof Error ? 'error' : 'non-error',
        });
      });
  }
}
