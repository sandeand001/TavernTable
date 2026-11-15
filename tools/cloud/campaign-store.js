const { default: CampaignStore } = require('../../src/campaigns/CampaignStore.js');
const {
  default: CampaignCharacters,
  campaignCharacterRoster,
  campaignRecordCharacterId,
} = require('../../src/campaigns/CampaignCharacters.js');
const { decodeScene } = require('../../src/campaigns/CampaignScene.js');
const path = require('node:path');
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { FieldPath, Timestamp } = require('firebase-admin/firestore');
const stableStringify = require('fast-json-stable-stringify');
const { CloudError, metadataUnavailable } = require('./cloud-error.js');
const { pilotAccountKey } = require('./account-access.js');
const { CloudUsageLimits } = require('./usage-limits.js');
const {
  snapshotCandidate,
  isImmutableCloudReference,
  storageUnavailable,
} = require('./immutable-objects.js');
const { CompleteCloudBackupObjects, isCompleteBackupReference } = require('./backup-objects.js');
const { acquireLargeFileWork } = require('./large-file-work.js');
const { prepareAssignedCharacterChange } = require('../assigned-character-change.js');
const { PhysicalDice } = require('../physical-dice.js');
const {
  playerUndoFor,
  rememberPlayerUndo,
  advancePlayerUndo,
} = require('../player-undo-sessions.js');
const {
  validateMovementPresentations,
  visibleMovementPresentations,
} = require('../movement-presentations.js');
const { isPrivateAssetReference } = require('./campaign-assets.js');
const {
  CHARACTER_IMAGE_TYPES,
  CHARACTER_IMAGE_FILE_LIMIT,
  CHARACTER_IMAGE_FIELDS,
} = require('../../src/config/characters/CharacterImages.js');
const {
  isCloudUUID,
  isCloudDigest,
  isCloudInvitation,
  isCloudInvitationRevocation,
  isCloudInvitationAcceptance,
  isCloudAccessGeneration,
  isCloudMemberRemoval,
  isCloudCharacterAssignment,
  isCloudCampaignSettings,
  isCloudAccessScope,
  CLOUD_INVITATION_TTL_MS,
  CLOUD_BACKUP_BYTE_LIMIT,
  CLOUD_IMPORT_CHUNK_BYTES,
  isCloudImportReceipt,
  isCloudImportTicket,
  isCloudBackupRecord,
  isCloudLiveSession,
  isCloudAssignedCharacterReceipt,
  isCloudParticipantRequest,
  isCloudParticipantAssetRequest,
  isCloudWorldCommandReceipt,
  validateCloudWorldCommand,
  isCloudPlacementDestination,
  isCloudPlacementGrant,
  isCloudPlacementReceipt,
  isCloudOwnerWorldRequest,
  cloudLiveStatus,
  CLOUD_LIVE_INACTIVITY_MS,
  CLOUD_LIVE_DISCONNECT_GRACE_MS,
  CLOUD_STREAM_LEASE_MS,
  CLOUD_LIVE_PRESENCE_COALESCE_MS,
  CLOUD_BACKUP_INTERVAL_MS,
  CLOUD_BACKUP_RETAIN,
} = require('../../src/campaigns/CloudProtocol.js');

const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validMilliseconds = (value) =>
  Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
const invalidPresence = () =>
  new CloudError(503, 'invalid-live-presence', 'Live-connection presence could not be verified');
const accessSummary = (head, role, seatId = null) => ({
  version: 1,
  campaign: {
    id: head.campaign.id,
    name: head.campaign.name,
    ruleset: head.campaign.ruleset,
    coreVersion: head.campaign.coreVersion,
  },
  role,
  seatId,
});
// Only the validated version-1 seat format has the initial, unversioned generation.
const seatAccessGeneration = (seat) => (seat.version === 1 ? 0 : seat.accessGeneration);
const participantSummary = (uid, summary, seat = null) => ({
  version: 1,
  access: {
    version: 1,
    uid,
    campaignId: summary.campaign.id,
    role: summary.role,
    seatId: summary.seatId,
    accessGeneration: seat === null ? 0 : seatAccessGeneration(seat),
  },
  campaign: summary.campaign,
  characterIds: seat === null ? [] : [...seat.characterIds],
});
const participantCampaign = (campaign) => ({
  version: campaign.version,
  id: campaign.id,
  name: campaign.name,
  ruleset: campaign.ruleset,
  coreVersion: campaign.coreVersion,
  sourcePacks: structuredClone(campaign.sourcePacks),
  createdAt: campaign.createdAt,
  charactersRevision: campaign.charactersRevision,
  sceneRevision: campaign.sceneRevision,
  sceneSavedAt: campaign.sceneSavedAt,
});
function sceneActivityState(text) {
  if (text === null) return null;
  const scene = JSON.parse(text);
  delete scene.camera;
  delete scene.selection;
  delete scene.view;
  return stableStringify(scene);
}
const unavailableCampaign = () =>
  new CloudError(404, 'campaign-not-found', 'This private campaign is not available');
const invalidMembership = () =>
  new CloudError(503, 'invalid-campaign-membership', 'Campaign access could not be verified');
const unavailableInvitation = () =>
  new CloudError(
    410,
    'invitation-unavailable',
    'This invitation is invalid, expired or no longer available'
  );
const validUid = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const IMPORT_TTL_MS = 24 * 60 * 60 * 1000;
const OBJECT_QUARANTINE_MS = 24 * 60 * 60 * 1000;
const OBJECT_MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
const OBJECT_MAINTENANCE_PAGE_SIZE = 20;
const CHANGE_HISTORY_RETAIN = 1000;
const CHANGE_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CHANGE_HISTORY_PRUNE_BATCH = 100;
const BACKUP_FAILURE_MESSAGE =
  'The complete backup was not finished. Acknowledged primary saves are unchanged; retry the backup online.';
const newestBackupFirst = (a, b) =>
  b.generation - a.generation ||
  Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
  b.name.localeCompare(a.name);
const importFingerprint = (bytes, sha256) =>
  createHash('sha256')
    .update(stableStringify({ kind: 'campaign.import', bytes, sha256 }))
    .digest('hex');
const invalidImport = () =>
  new CloudError(503, 'invalid-import-state', 'The private import journal could not be verified');
const terminalImportReasons = new Set([
  'invalid-campaign-backup',
  'invalid-campaign-change',
  'backup-too-large',
  'snapshot-too-large',
  'invalid-asset-image',
  'asset-image-too-large',
  'asset-too-large',
  'storage-limit-reached',
  'campaign-limit-reached',
  'storage-reservation-too-large',
]);
function importRejection(reason) {
  if (reason === 'storage-limit-reached')
    return new CloudError(
      409,
      'import-storage-limit-reached',
      'The import reached the 20 GiB allowance; no new campaign was created'
    );
  if (reason === 'campaign-limit-reached')
    return new CloudError(
      409,
      'import-campaign-limit-reached',
      'The import reached the ten-campaign allowance; no new campaign was created'
    );
  if (['asset-image-too-large', 'asset-too-large'].includes(reason))
    return new CloudError(
      413,
      'import-image-too-large',
      'An imported image exceeds the supported bounds; no new campaign was created'
    );
  if (reason === 'invalid-asset-image')
    return new CloudError(
      400,
      'import-invalid-image',
      'An imported image is incomplete or corrupt; no new campaign was created'
    );
  return new CloudError(
    400,
    'import-rejected',
    'The backup violates its edition, source, record or scene limits; no new campaign was created'
  );
}
const importTicket = (importId, job, completed = null) => ({
  version: 1,
  importId,
  campaignId: job.campaignId,
  bytes: job.bytes,
  sha256: job.sha256,
  parts:
    completed === null
      ? job.parts.map(({ index, bytes, sha256 }) => ({ index, bytes, sha256 }))
      : [],
  completed,
});

function principalUid(principal) {
  pilotAccountKey(principal?.uid);
  if (principal.emailVerified !== true)
    throw new CloudError(
      403,
      'email-verification-required',
      'Verify your email before using campaigns'
    );
  return principal.uid;
}

function validCommandResult(previous) {
  const kind = previous?.kind;
  const result = previous?.result;
  if (kind === 'campaign.invite')
    return isCloudInvitation(result) && result.campaignId === previous.campaignId;
  if (kind === 'campaign.invite.revoke') return isCloudInvitationRevocation(result);
  if (kind === 'campaign.join')
    return isCloudInvitationAcceptance(result) && result.access.campaign.id === previous.campaignId;
  if (kind === 'campaign.member.remove') return isCloudMemberRemoval(result);
  if (kind === 'campaign.character.assign') return isCloudCharacterAssignment(result);
  if (kind === 'campaign.arrival')
    return isCloudPlacementReceipt(result) && result.campaignId === previous.campaignId;
  if (kind === 'campaign.settings')
    return isCloudCampaignSettings(result) && result.campaign.id === previous.campaignId;
  if (kind === 'campaign.asset.upload') return isPrivateAssetReference(result, previous.campaignId);
  if (kind === 'campaign.backup') return isCloudBackupRecord(result);
  if (kind === 'campaign.live')
    return isCloudLiveSession(result) && result.campaignId === previous.campaignId;
  if (kind === 'characters.assigned.commit')
    return (
      isCloudAssignedCharacterReceipt(result) &&
      result.campaignId === previous.campaignId &&
      result.access.uid === previous.uid
    );
  if (kind === 'world.command')
    return (
      isCloudWorldCommandReceipt(result) &&
      result.outcome === 'applied' &&
      result.campaignId === previous.campaignId &&
      result.access.uid === previous.uid
    );
  if (kind === 'campaign.import')
    return (
      isCloudImportReceipt(result) &&
      result.campaign.id === previous.campaignId &&
      importFingerprint(result.bytes, result.sha256) === previous.fingerprint
    );
  if (kind === 'campaign.create')
    return (
      result?.id === previous.campaignId &&
      result.version === 1 &&
      result.charactersRevision === 0 &&
      result.sceneRevision === 0 &&
      result.sceneSavedAt === null &&
      !Object.hasOwn(result, 'scene') &&
      typeof result.createdAt === 'string' &&
      Number.isFinite(Date.parse(result.createdAt))
    );
  if (!Number.isSafeInteger(result?.revision) || result.revision < 1) return false;
  if (kind === 'scene.commit')
    return typeof result.savedAt === 'string' && Number.isFinite(Date.parse(result.savedAt));
  if (kind === 'characters.commit')
    return (
      Number.isSafeInteger(result.sceneRevision) &&
      result.sceneRevision >= 0 &&
      (result.sceneRevision === 0
        ? result.sceneSavedAt === null
        : typeof result.sceneSavedAt === 'string' &&
          Number.isFinite(Date.parse(result.sceneSavedAt)))
    );
  return false;
}

class CloudCampaignStore {
  constructor({
    firestore,
    access,
    packs,
    objects = null,
    resources = null,
    assets = null,
    backupObjects = null,
    now = Date.now,
  }) {
    if (
      typeof firestore?.runTransaction !== 'function' ||
      access?.firestore !== firestore ||
      typeof access.assertEligibility !== 'function' ||
      typeof now !== 'function'
    )
      throw new Error('Cloud campaigns require coordinated metadata and account access clients');
    this.firestore = firestore;
    this.access = access;
    this.usage = new CloudUsageLimits({ firestore, access, now });
    this.packs = packs;
    if (
      objects !== null &&
      ['read', 'stage'].some((method) => typeof objects[method] !== 'function')
    )
      throw new Error('Cloud snapshots require the immutable object interface');
    if (resources !== null && typeof resources.catalog !== 'function')
      throw new Error('Cloud saves require the pinned resource catalog interface');
    this.objects = objects;
    this.resources = resources;
    if (assets !== null && ['stage', 'read'].some((method) => typeof assets[method] !== 'function'))
      throw new Error('Cloud assets require the explicit immutable private asset interface');
    this.assets = assets;
    this.backupObjects =
      backupObjects ??
      (objects?.bucket ? new CompleteCloudBackupObjects({ bucket: objects.bucket }) : null);
    if (
      this.backupObjects !== null &&
      ['stage', 'read'].some((method) => typeof this.backupObjects[method] !== 'function')
    )
      throw new Error('Complete backups require the private immutable file interface');
    if (
      new Set(
        [objects?.bucket?.name, assets?.bucket?.name, this.backupObjects?.bucket?.name].filter(
          (name) => name !== undefined
        )
      ).size > 1
    )
      throw new Error(
        'Canonical snapshots, assets and complete backups must share the accounted private bucket'
      );
    this.now = now;
    this.livePresenceInstanceId = randomUUID();
    this.worldUndoSessions = new Map();
    this.worldOperations = new Map();
  }

  _worldUndoProfile(principal, id, sessionId, grant) {
    return {
      id: stableStringify({
        uid: principalUid(principal),
        campaignId: id,
        sessionId,
        seatId: grant.access.seatId,
        accessGeneration: grant.access.accessGeneration,
        authSession:
          principal.authTime === undefined
            ? { kind: 'internal' }
            : { kind: 'firebase', time: principal.authTime },
      }),
      campaignId: id,
      characterIds: grant.characterIds,
    };
  }

  async _transaction(operation, options) {
    try {
      return await this.firestore.runTransaction(operation, options);
    } catch (error) {
      if (metadataUnavailable(error))
        throw new CloudError(
          503,
          'campaign-metadata-unavailable',
          'Cloud campaign metadata is temporarily unavailable; retry online'
        );
      throw error;
    }
  }

  _domain(transaction) {
    return new CampaignStore({
      packs: this.packs,
      backupFileByteLimit: CLOUD_BACKUP_BYTE_LIMIT,
      storage: { transaction: async (_mode, operation) => operation(transaction) },
    });
  }

  async _metadata(snapshot, uid) {
    if (!snapshot.exists) throw unavailableCampaign();
    return this._headMetadata(snapshot.data(), snapshot.id, uid);
  }

  async _headMetadata(head, id, uid) {
    if (head?.ownerUid !== uid) throw unavailableCampaign();
    if (
      head.version !== 1 ||
      !Number.isSafeInteger(head.generation) ||
      head.generation < 1 ||
      head.campaign?.id !== id ||
      !Number.isSafeInteger(head.campaign.sceneRevision) ||
      head.campaign.sceneRevision < 0 ||
      !Number.isSafeInteger(head.campaign.charactersRevision) ||
      head.campaign.charactersRevision < 0 ||
      (head.sceneRef === null) !== (head.campaign.sceneRevision === 0) ||
      (head.charactersRef === null) !== (head.campaign.charactersRevision === 0) ||
      (head.presentationRef !== undefined &&
        head.presentationRef !== null &&
        !isImmutableCloudReference(id, 'presentations', head.presentationRef)) ||
      (head.campaign.sceneRevision === 0
        ? head.campaign.sceneSavedAt !== null
        : typeof head.campaign.sceneSavedAt !== 'string' ||
          !Number.isFinite(Date.parse(head.campaign.sceneSavedAt)))
    )
      throw new CloudError(503, 'invalid-campaign-head', 'The cloud campaign head is invalid');
    if (
      head.lastCommand !== undefined &&
      (!head.lastCommand ||
        typeof head.lastCommand !== 'object' ||
        Object.keys(head.lastCommand).length !== 4 ||
        !validUid(head.lastCommand.uid) ||
        !isCloudUUID(head.lastCommand.commandId) ||
        typeof head.lastCommand.kind !== 'string' ||
        !/^[a-z][a-z.-]+$/.test(head.lastCommand.kind) ||
        head.lastCommand.generation !== head.generation)
    )
      throw new CloudError(503, 'invalid-campaign-head', 'The canonical change origin is invalid');
    const domain = this._domain({ getCampaign: () => head.campaign });
    await domain.get(id);
    return head;
  }

  async _previousCommand(transaction, { uid, reference, fingerprint, kind, campaignId = null }) {
    const claimReference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('claims')
      .doc(reference.id);
    const [snapshot, claimSnapshot] = await transaction.getAll(reference, claimReference);
    if (!snapshot.exists) {
      if (kind === 'campaign.import' && campaignId !== null && !claimSnapshot.exists)
        throw invalidImport();
      if (claimSnapshot.exists) {
        const claim = claimSnapshot.data();
        if (
          claim?.version !== 1 ||
          claim.uid !== uid ||
          !['campaign.import', 'campaign.backup'].includes(claim.kind) ||
          !isCloudDigest(claim.fingerprint) ||
          !isCloudUUID(claim.campaignId)
        )
          throw new CloudError(
            503,
            'invalid-command-claim',
            'The pending command intent could not be verified'
          );
        if (
          claim.kind !== kind ||
          claim.fingerprint !== fingerprint ||
          (campaignId !== null && campaignId !== claim.campaignId)
        )
          throw new CloudError(
            409,
            'command-id-conflict',
            'This command ID was already used for another intent'
          );
      }
      return null;
    }
    const previous = snapshot.data();
    if (
      previous?.version !== 1 ||
      previous.uid !== uid ||
      ![
        'campaign.create',
        'scene.commit',
        'characters.commit',
        'campaign.invite',
        'campaign.invite.revoke',
        'campaign.join',
        'campaign.member.remove',
        'campaign.character.assign',
        'campaign.arrival',
        'campaign.settings',
        'campaign.asset.upload',
        'campaign.import',
        'campaign.backup',
        'campaign.live',
        'characters.assigned.commit',
        'world.command',
      ].includes(previous.kind) ||
      !isCloudUUID(previous.campaignId) ||
      !validCommandResult(previous) ||
      (previous.kind === 'campaign.import' && previous.result.importId !== reference.id) ||
      (previous.kind === 'campaign.backup' && previous.result.name !== reference.id) ||
      (previous.kind === 'world.command' && previous.result.commandId !== reference.id) ||
      (previous.kind === 'campaign.arrival' && previous.result.grant.id !== reference.id) ||
      typeof previous.fingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(previous.fingerprint)
    )
      throw new CloudError(
        503,
        'invalid-command-receipt',
        'The durable command receipt is invalid'
      );
    if (
      previous.fingerprint !== fingerprint ||
      previous.kind !== kind ||
      (campaignId !== null && previous.campaignId !== campaignId)
    )
      throw new CloudError(
        409,
        'command-id-conflict',
        'This command ID was already used for another intent'
      );
    if (['campaign.create', 'campaign.settings', 'campaign.import'].includes(previous.kind)) {
      try {
        const campaign =
          previous.kind === 'campaign.create' ? previous.result : previous.result.campaign;
        await this._domain({ getCampaign: () => campaign }).get(previous.campaignId);
      } catch (error) {
        if (error?.constructor === Error || error instanceof SyntaxError)
          throw new CloudError(
            503,
            'invalid-command-receipt',
            'The durable command receipt is invalid'
          );
        throw error;
      }
    }
    if (['characters.assigned.commit', 'world.command'].includes(previous.kind)) {
      await this.access.assertEligibility(uid, transaction);
    } else if (previous.kind === 'campaign.join') {
      await this.access.assertEligibility(uid, transaction);
      const current = await this._accessSummary(transaction, uid, previous.campaignId);
      if (current.role !== 'member' || current.seatId !== previous.result.access.seatId)
        throw unavailableCampaign();
    } else {
      await this._metadata(
        await transaction.get(this.firestore.collection('campaigns').doc(previous.campaignId)),
        uid
      );
    }
    return previous.result;
  }

  _liveSessionReference(id) {
    return this.firestore.collection('campaigns').doc(id).collection('liveSession').doc('current');
  }

  async _liveSession(transaction, id) {
    const snapshot = await transaction.get(this._liveSessionReference(id));
    if (!snapshot.exists)
      return {
        version: 1,
        campaignId: id,
        generation: 0,
        sessionId: null,
        state: 'paused',
        startedAt: null,
        lastMeaningfulAt: null,
        pausedAt: null,
        pauseReason: 'not-started',
      };
    const value = snapshot.data();
    if (!isCloudLiveSession(value) || value.campaignId !== id)
      throw new CloudError(503, 'invalid-live-session', 'Live-game state could not be verified');
    return value;
  }

  async getLiveSession(principal, id) {
    return (await this.getLiveStatus(principal, id)).session;
  }

  _presenceSummaries(id) {
    return this.firestore.collection('campaigns').doc(id).collection('livePresence');
  }

  _presenceConnections(id) {
    return this.firestore.collection('campaigns').doc(id).collection('livePresenceConnections');
  }

  _presenceSummary(snapshot, id) {
    if (!snapshot.exists) return null;
    const value = snapshot.data();
    if (
      value?.version !== 1 ||
      value.campaignId !== id ||
      value.instanceId !== snapshot.id ||
      !isCloudUUID(value.instanceId) ||
      !isCloudUUID(value.sessionId) ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 1 ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0 ||
      !validMilliseconds(value.renewedAt) ||
      !validMilliseconds(value.expiresAt) ||
      value.expiresAt !== value.renewedAt + (value.count > 0 ? CLOUD_STREAM_LEASE_MS : 0)
    )
      throw invalidPresence();
    return value;
  }

  _presenceConnection(snapshot, id) {
    if (!snapshot.exists) return null;
    const value = snapshot.data();
    if (
      ![1, 2].includes(value?.version) ||
      value.id !== snapshot.id ||
      !isCloudUUID(value.id) ||
      value.campaignId !== id ||
      !isCloudUUID(value.sessionId) ||
      !isCloudUUID(value.instanceId) ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 1 ||
      !isCloudAccessScope(value.access) ||
      value.access.uid !== value.uid ||
      value.access.campaignId !== id ||
      (value.version === 1
        ? Object.hasOwn(value, 'clientSeenAt')
        : !validMilliseconds(value.clientSeenAt))
    )
      throw invalidPresence();
    return value;
  }

  _presenceCommand(command, connection) {
    const names = connection ? ['sessionId', 'connectionId'] : ['sessionId'];
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).length !== names.length ||
      Object.keys(command).some((key) => !names.includes(key)) ||
      names.some((key) => !isCloudUUID(command[key]))
    )
      throw new CloudError(
        400,
        'invalid-live-command',
        'Choose the current live presence connection'
      );
    return { ...command };
  }

  _presenceResult(connection, summary) {
    return {
      version: 1,
      id: connection.id,
      campaignId: connection.campaignId,
      sessionId: connection.sessionId,
      expiresAt: summary.expiresAt,
      ...(connection.version === 2
        ? { clientExpiresAt: connection.clientSeenAt + CLOUD_STREAM_LEASE_MS }
        : {}),
    };
  }

  _presenceDisconnectedAt(session, summaries, now) {
    if (session.state !== 'live') return null;
    const until = Math.max(
      Date.parse(session.startedAt),
      ...summaries.map((value) => value.expiresAt)
    );
    return now >= until ? new Date(until).toISOString() : null;
  }

  async _livePresence(transaction, session) {
    if (session.state !== 'live') return [];
    const rows = await transaction.get(
      this._presenceSummaries(session.campaignId)
        .where('sessionId', '==', session.sessionId)
        .orderBy('expiresAt', 'desc')
        .limit(2)
    );
    const summaries = rows.docs.map((snapshot) =>
      this._presenceSummary(snapshot, session.campaignId)
    );
    if (
      summaries.some(
        (value) =>
          value.sessionId !== session.sessionId || value.renewedAt < Date.parse(session.startedAt)
      )
    )
      throw invalidPresence();
    return summaries;
  }

  async getLiveStatus(principal, id) {
    const uid = principalUid(principal);
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      await this._accessGrant(transaction, uid, id);
      const current = await this._liveSession(transaction, id);
      const presence = await this._livePresence(transaction, current);
      const now = Math.max(
        this.now(),
        Date.parse(current.pausedAt ?? current.lastMeaningfulAt ?? '1970-01-01T00:00:00.000Z')
      );
      const disconnectedAt = this._presenceDisconnectedAt(current, presence, now);
      const next = this._expireLiveSession(current, now, disconnectedAt);
      if (next !== current) {
        await this._queueFinalBackup(transaction, id, next);
        transaction.set(this._liveSessionReference(id), next);
      }
      return cloudLiveStatus(next, now, next.state === 'live' ? disconnectedAt : null);
    });
  }

  _expireLiveSession(current, now, disconnectedAt) {
    if (current.state !== 'live') return current;
    if (!(disconnectedAt === null || validTime(disconnectedAt))) throw invalidPresence();
    const inactivity = Date.parse(current.lastMeaningfulAt) + CLOUD_LIVE_INACTIVITY_MS;
    const grace =
      disconnectedAt === null
        ? Infinity
        : Date.parse(disconnectedAt) + CLOUD_LIVE_DISCONNECT_GRACE_MS;
    const deadline = Math.min(inactivity, grace);
    if (now < deadline) return current;
    if (current.generation >= Number.MAX_SAFE_INTEGER)
      throw new CloudError(503, 'invalid-live-session', 'The live-game generation cannot advance');
    return {
      ...current,
      generation: current.generation + 1,
      state: 'paused',
      pausedAt: new Date(deadline).toISOString(),
      pauseReason: grace < inactivity ? 'disconnected' : 'inactivity',
    };
  }

  async _queueFinalBackup(transaction, id, session, head = null) {
    const campaign = this.firestore.collection('campaigns').doc(id);
    if (head === null) {
      const snapshot = await transaction.get(campaign);
      head = await this._metadata(snapshot, snapshot.data()?.ownerUid);
    }
    const name = randomUUID();
    transaction.create(campaign.collection('backupJobs').doc(name), {
      version: 1,
      uid: head.ownerUid,
      campaignId: id,
      name,
      createdAt: session.pausedAt,
      fingerprint: this._backupFingerprint(head),
      snapshot: this._backupSnapshot(head),
      state: 'pending',
      automaticFinal: true,
      finalSessionId: session.sessionId,
    });
  }

  async requireLiveSession(transaction, principal, id, sessionId, expectedAccess = null) {
    const uid = principalUid(principal);
    if (!(sessionId === null || isCloudUUID(sessionId)))
      throw new CloudError(400, 'invalid-live-command', 'Choose the current live-game session');
    const participant = await this._participantGrant(transaction, uid, id, expectedAccess);
    const current = await this._liveSession(transaction, id);
    const presence = await this._livePresence(transaction, current);
    const now = Math.max(
      this.now(),
      Date.parse(current.lastMeaningfulAt ?? '1970-01-01T00:00:00.000Z')
    );
    const session = this._expireLiveSession(
      current,
      now,
      this._presenceDisconnectedAt(current, presence, now)
    );
    this._assertLiveSession(session, sessionId);
    return { version: 1, session, participant };
  }

  _assertLiveSession(session, sessionId) {
    if (session.state !== 'live')
      throw new CloudError(
        409,
        'live-session-paused',
        'The campaign owner must start a live game before world actions'
      );
    if (session.sessionId !== sessionId)
      throw new CloudError(
        409,
        'live-session-changed',
        'This live-game session changed; reconnect to its current state'
      );
  }

  async connectLivePresence(principal, id, command, { clientAcknowledgements = false } = {}) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (typeof clientAcknowledgements !== 'boolean')
      throw new CloudError(400, 'invalid-live-command', 'Choose explicit client presence proof');
    const { sessionId } = this._presenceCommand(command, false);
    const connectionId = randomUUID();
    const reference = this._presenceSummaries(id).doc(this.livePresenceInstanceId);
    const outcome = await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const participant = await this._accessGrant(transaction, uid, id);
      const current = await this._liveSession(transaction, id);
      const presence = await this._livePresence(transaction, current);
      const previous = this._presenceSummary(await transaction.get(reference), id);
      const now = Math.max(
        this.now(),
        Date.parse(current.lastMeaningfulAt ?? '1970-01-01T00:00:00.000Z'),
        previous?.sessionId === current.sessionId ? previous.renewedAt : 0
      );
      const evaluated = this._expireLiveSession(
        current,
        now,
        this._presenceDisconnectedAt(current, presence, now)
      );
      if (evaluated !== current) {
        await this._queueFinalBackup(transaction, id, evaluated);
        transaction.set(this._liveSessionReference(id), evaluated);
        return { expired: true };
      }
      this._assertLiveSession(current, sessionId);
      const same = previous?.sessionId === sessionId;
      const continuing = same && previous.count > 0 && previous.expiresAt > now;
      const generation = continuing ? previous.generation : same ? previous.generation + 1 : 1;
      const count = (continuing ? previous.count : 0) + 1;
      if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(count))
        throw invalidPresence();
      const summary = {
        version: 1,
        campaignId: id,
        sessionId,
        instanceId: this.livePresenceInstanceId,
        generation,
        count,
        renewedAt: now,
        expiresAt: now + CLOUD_STREAM_LEASE_MS,
      };
      transaction.set(reference, summary);
      const connection = {
        version: clientAcknowledgements ? 2 : 1,
        id: connectionId,
        campaignId: id,
        sessionId,
        instanceId: this.livePresenceInstanceId,
        generation,
        uid,
        access: participant.access,
        ...(clientAcknowledgements ? { clientSeenAt: now } : {}),
      };
      transaction.create(this._presenceConnections(id).doc(connectionId), connection);
      return { result: this._presenceResult(connection, summary) };
    });
    if (outcome.expired)
      throw new CloudError(
        409,
        'live-session-paused',
        'The live game paused before this connection'
      );
    return outcome.result;
  }

  async renewLivePresence(principal, id, command) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const { sessionId, connectionId } = this._presenceCommand(command, true);
    const outcome = await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const participant = await this._accessGrant(transaction, uid, id);
      const connection = this._presenceConnection(
        await transaction.get(this._presenceConnections(id).doc(connectionId)),
        id
      );
      if (connection === null || connection.uid !== uid) throw unavailableCampaign();
      if (stableStringify(connection.access) !== stableStringify(participant.access))
        throw new CloudError(
          409,
          'campaign-access-changed',
          'This live connection no longer has its original access'
        );
      if (
        connection.sessionId !== sessionId ||
        connection.instanceId !== this.livePresenceInstanceId
      )
        throw new CloudError(
          409,
          'live-presence-changed',
          'Reconnect using this worker and the current live game'
        );
      const reference = this._presenceSummaries(id).doc(connection.instanceId);
      const summary = this._presenceSummary(await transaction.get(reference), id);
      if (summary === null) throw invalidPresence();
      if (summary.sessionId !== sessionId || summary.generation !== connection.generation)
        throw new CloudError(
          409,
          'live-presence-changed',
          'This live connection was replaced; reconnect'
        );
      if (summary.count < 1) throw invalidPresence();
      const current = await this._liveSession(transaction, id);
      const presence = await this._livePresence(transaction, current);
      const now = Math.max(
        this.now(),
        summary.renewedAt,
        Date.parse(current.lastMeaningfulAt ?? '1970-01-01T00:00:00.000Z')
      );
      const evaluated = this._expireLiveSession(
        current,
        now,
        this._presenceDisconnectedAt(current, presence, now)
      );
      if (evaluated !== current) {
        await this._queueFinalBackup(transaction, id, evaluated);
        transaction.set(this._liveSessionReference(id), evaluated);
        return { expired: true };
      }
      this._assertLiveSession(current, sessionId);
      if (connection.version === 2 && connection.clientSeenAt + CLOUD_STREAM_LEASE_MS <= now)
        throw new CloudError(
          409,
          'client-presence-expired',
          'This client stopped acknowledging its live connection; reconnect'
        );
      if (connection.version === 1 && summary.expiresAt <= now)
        throw new CloudError(
          409,
          'live-presence-expired',
          'This live presence lease expired; reconnect'
        );
      const renewedAt =
        connection.version === 2 ? Math.max(summary.renewedAt, connection.clientSeenAt) : now;
      if (
        renewedAt === summary.renewedAt ||
        (now - summary.renewedAt < CLOUD_LIVE_PRESENCE_COALESCE_MS && summary.expiresAt > now)
      )
        return { result: this._presenceResult(connection, summary) };
      const next = { ...summary, renewedAt, expiresAt: renewedAt + CLOUD_STREAM_LEASE_MS };
      transaction.set(reference, next);
      return { result: this._presenceResult(connection, next) };
    });
    if (outcome.expired)
      throw new CloudError(
        409,
        'live-session-paused',
        'The live game paused before this heartbeat'
      );
    return outcome.result;
  }

  async acknowledgeLivePresence(principal, id, command, expected) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const scope = this._accessExpectation(expected);
    if (scope === null)
      throw new CloudError(400, 'invalid-access-scope', 'Choose the current live presence scope');
    const { sessionId, connectionId } = this._presenceCommand(command, true);
    const reference = this._presenceConnections(id).doc(connectionId);
    return this._transaction(async (transaction) => {
      const admitted = await this.requireLiveSession(transaction, principal, id, sessionId, scope);
      const connection = this._presenceConnection(await transaction.get(reference), id);
      if (connection === null || connection.uid !== uid) throw unavailableCampaign();
      if (
        connection.sessionId !== sessionId ||
        stableStringify(connection.access) !== stableStringify(admitted.participant.access)
      )
        throw new CloudError(
          409,
          'campaign-access-changed',
          'This live connection no longer has its original access'
        );
      if (connection.version !== 2)
        throw new CloudError(
          400,
          'invalid-live-command',
          'Choose a client-acknowledged live connection'
        );
      const summaryReference = this._presenceSummaries(id).doc(connection.instanceId);
      const summary = this._presenceSummary(await transaction.get(summaryReference), id);
      if (summary === null) throw invalidPresence();
      if (
        summary.sessionId !== sessionId ||
        summary.generation !== connection.generation ||
        summary.count < 1
      )
        throw new CloudError(
          409,
          'live-presence-changed',
          'This live connection was replaced; reconnect'
        );
      const now = Math.max(
        this.now(),
        connection.clientSeenAt,
        summary.renewedAt,
        Date.parse(admitted.session.lastMeaningfulAt)
      );
      if (connection.clientSeenAt + CLOUD_STREAM_LEASE_MS <= now)
        throw new CloudError(
          409,
          'client-presence-expired',
          'This client stopped acknowledging its live connection; reconnect'
        );
      const clientSeenAt =
        now - connection.clientSeenAt >= CLOUD_LIVE_PRESENCE_COALESCE_MS
          ? now
          : connection.clientSeenAt;
      if (clientSeenAt !== connection.clientSeenAt)
        transaction.set(reference, { ...connection, clientSeenAt });
      if (now - summary.renewedAt >= CLOUD_LIVE_PRESENCE_COALESCE_MS)
        transaction.set(summaryReference, {
          ...summary,
          renewedAt: now,
          expiresAt: now + CLOUD_STREAM_LEASE_MS,
        });
      return { version: 1, connectionId, expiresAt: clientSeenAt + CLOUD_STREAM_LEASE_MS };
    });
  }

  async disconnectLivePresence(principal, id, command, expected = null) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const scope = this._accessExpectation(expected);
    const { sessionId, connectionId } = this._presenceCommand(command, true);
    const connectionReference = this._presenceConnections(id).doc(connectionId);
    return this._transaction(async (transaction) => {
      const connection = this._presenceConnection(await transaction.get(connectionReference), id);
      if (connection === null) return { closed: false };
      if (connection.uid !== uid) throw unavailableCampaign();
      if (
        scope !== null &&
        (connection.access.seatId !== scope.seatId ||
          connection.access.accessGeneration !== scope.accessGeneration)
      )
        throw new CloudError(
          409,
          'campaign-access-changed',
          'Choose this connection original scope'
        );
      if (connection.sessionId !== sessionId)
        throw new CloudError(
          409,
          'live-session-changed',
          'This presence belongs to another live game'
        );
      const summaryReference = this._presenceSummaries(id).doc(connection.instanceId);
      const summary = this._presenceSummary(await transaction.get(summaryReference), id);
      if (summary === null) throw invalidPresence();
      const current = await this._liveSession(transaction, id);
      const presence = await this._livePresence(transaction, current);
      const now = this.now();
      let nextSummary = summary;
      if (summary?.sessionId === sessionId && summary.generation === connection.generation) {
        if (summary.count < 1) throw invalidPresence();
        const count = summary.count - 1;
        const closedAt = Math.max(summary.renewedAt, Math.min(now, summary.expiresAt));
        nextSummary =
          count > 0
            ? { ...summary, count }
            : { ...summary, count: 0, renewedAt: closedAt, expiresAt: closedAt };
      }
      const summaries = presence.filter((value) => value.instanceId !== connection.instanceId);
      if (nextSummary?.sessionId === current.sessionId) summaries.push(nextSummary);
      const disconnectedAt = this._presenceDisconnectedAt(current, summaries, now);
      const evaluated = this._expireLiveSession(current, now, disconnectedAt);
      if (evaluated !== current) await this._queueFinalBackup(transaction, id, evaluated);
      transaction.delete(connectionReference);
      if (nextSummary !== summary) transaction.set(summaryReference, nextSummary);
      if (evaluated !== current) transaction.set(this._liveSessionReference(id), evaluated);
      return { closed: true };
    });
  }

  async getLiveAccess(principal, id, command) {
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).length !== 1 ||
      !Object.hasOwn(command, 'sessionId')
    )
      throw new CloudError(
        400,
        'invalid-live-command',
        'Choose an explicit live-game session for admission'
      );
    const { sessionId } = command;
    await this.getLiveSession(principal, id);
    return this._transaction(
      (transaction) => this.requireLiveSession(transaction, principal, id, sessionId),
      { readOnly: true }
    );
  }

  async controlLiveSession(principal, id, command) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).length !== 4 ||
      Object.keys(command).some(
        (key) => !['commandId', 'action', 'generation', 'sessionId'].includes(key)
      ) ||
      !isCloudUUID(command.commandId) ||
      !['start', 'end', 'keep-active'].includes(command.action) ||
      !Number.isSafeInteger(command.generation) ||
      command.generation < 0 ||
      !(command.sessionId === null || isCloudUUID(command.sessionId))
    )
      throw new CloudError(
        400,
        'invalid-live-command',
        'Choose the current live game and an explicit owner action'
      );
    const input = structuredClone(command);
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind: 'campaign.live',
          campaignId: id,
          action: input.action,
          generation: input.generation,
          sessionId: input.sessionId,
        })
      )
      .digest('hex');
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(input.commandId);
    const intent = { uid, reference, fingerprint, kind: 'campaign.live', campaignId: id };
    const sessionId = randomUUID();
    const outcome = await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, intent);
      if (replay !== null) return { result: replay };
      await this._metadata(
        await transaction.get(this.firestore.collection('campaigns').doc(id)),
        uid
      );
      const current = await this._liveSession(transaction, id);
      const presence = await this._livePresence(transaction, current);
      const now = Math.max(
        this.now(),
        Date.parse(current.pausedAt ?? current.lastMeaningfulAt ?? '1970-01-01T00:00:00.000Z')
      );
      const expired = this._expireLiveSession(
        current,
        now,
        this._presenceDisconnectedAt(current, presence, now)
      );
      if (expired !== current) {
        await this._queueFinalBackup(transaction, id, expired);
        transaction.set(this._liveSessionReference(id), expired);
        return { expired: true };
      }
      if (current.generation !== input.generation || current.sessionId !== input.sessionId)
        throw new CloudError(
          409,
          'live-session-changed',
          'The live game changed; refresh its state before another action'
        );
      if (current.generation >= Number.MAX_SAFE_INTEGER)
        throw new CloudError(
          503,
          'invalid-live-session',
          'The live-game generation cannot advance'
        );
      if (input.action === 'start' && current.state === 'live')
        throw new CloudError(
          409,
          'live-session-already-started',
          'This campaign already has a live game'
        );
      if (input.action !== 'start' && current.state !== 'live')
        throw new CloudError(
          409,
          'live-session-paused',
          'Start the campaign live game before this action'
        );
      const timestamp = new Date(now).toISOString();
      const next = {
        ...current,
        generation: current.generation + 1,
        ...(input.action === 'start'
          ? {
              sessionId,
              state: 'live',
              startedAt: timestamp,
              lastMeaningfulAt: timestamp,
              pausedAt: null,
              pauseReason: null,
            }
          : input.action === 'end'
            ? {
                state: 'paused',
                pausedAt: timestamp,
                pauseReason: 'owner-end',
              }
            : { lastMeaningfulAt: timestamp }),
      };
      if (!isCloudLiveSession(next))
        throw new CloudError(
          503,
          'invalid-live-session',
          'The live-game transition could not be verified'
        );
      if (next.state === 'paused') await this._queueFinalBackup(transaction, id, next);
      transaction.set(this._liveSessionReference(id), next);
      transaction.create(reference, {
        version: 1,
        uid,
        kind: 'campaign.live',
        campaignId: id,
        fingerprint,
        result: next,
      });
      return { result: next };
    });
    if (outcome.expired)
      throw new CloudError(
        409,
        'live-session-paused',
        'The inactive live game paused; refresh before starting another game'
      );
    return outcome.result;
  }

  _backupStateReference(id) {
    return this.firestore.collection('campaigns').doc(id).collection('backupState').doc('current');
  }

  _backupState(snapshot, uid, id) {
    if (!snapshot.exists)
      return {
        version: 1,
        uid,
        campaignId: id,
        records: [],
        lastFingerprint: null,
        lastSavedAt: null,
        lastGeneration: 0,
        pending: null,
        error: null,
      };
    const state = snapshot.data();
    if (
      state?.version !== 1 ||
      state.uid !== uid ||
      state.campaignId !== id ||
      !Array.isArray(state.records) ||
      state.records.length > CLOUD_BACKUP_RETAIN ||
      state.records.some((record) => !isCloudBackupRecord(record)) ||
      new Set(state.records.map((record) => record.name)).size !== state.records.length ||
      !(state.lastFingerprint === null || isCloudDigest(state.lastFingerprint)) ||
      !(state.lastSavedAt === null || validTime(state.lastSavedAt)) ||
      !Number.isSafeInteger(state.lastGeneration) ||
      state.lastGeneration < 0 ||
      (state.lastGeneration === 0) !== (state.records.length === 0) ||
      (state.lastGeneration === 0) !== (state.lastFingerprint === null) ||
      (state.lastGeneration === 0) !== (state.lastSavedAt === null) ||
      state.records.some(
        (record, index) =>
          record.generation > state.lastGeneration ||
          (index > 0 && newestBackupFirst(state.records[index - 1], record) > 0)
      ) ||
      !(
        state.pending === null ||
        (isCloudUUID(state.pending?.name) &&
          validTime(state.pending.requestedAt) &&
          validTime(state.pending.dueAt) &&
          Object.keys(state.pending).every((key) => ['name', 'requestedAt', 'dueAt'].includes(key)))
      ) ||
      !(
        state.error === null ||
        (isCloudUUID(state.error?.name) &&
          typeof state.error.code === 'string' &&
          /^[a-z][a-z-]+$/.test(state.error.code) &&
          state.error.message === BACKUP_FAILURE_MESSAGE &&
          validTime(state.error.at))
      )
    )
      throw new CloudError(
        503,
        'invalid-backup-state',
        'Private backup status could not be verified'
      );
    return state;
  }

  _backupSnapshot(head) {
    return {
      version: 1,
      ownerUid: head.ownerUid,
      generation: head.generation,
      campaign: structuredClone(head.campaign),
      sceneRef: head.sceneRef,
      charactersRef: head.charactersRef,
    };
  }

  _backupFingerprint(head) {
    const campaign = structuredClone(head.campaign);
    delete campaign.charactersRevision;
    delete campaign.sceneRevision;
    delete campaign.sceneSavedAt;
    return createHash('sha256')
      .update(
        stableStringify({
          campaign,
          scene: head.sceneRef?.sha256 ?? null,
          characters: head.charactersRef?.sha256 ?? null,
        })
      )
      .digest('hex');
  }

  async _pendingBackupJob(snapshot, uid, id) {
    const job = snapshot.data();
    if (
      !snapshot.exists ||
      job?.version !== 1 ||
      job.uid !== uid ||
      job.campaignId !== id ||
      job.name !== snapshot.id ||
      job.state !== 'pending' ||
      !validTime(job.createdAt) ||
      !isCloudDigest(job.fingerprint) ||
      (job.automaticFinal !== undefined &&
        (job.automaticFinal !== true || !isCloudUUID(job.finalSessionId)))
    )
      throw new CloudError(503, 'invalid-backup-state', 'The pending backup could not be verified');
    await this._headMetadata(job.snapshot, id, uid);
    if (this._backupFingerprint(job.snapshot) !== job.fingerprint)
      throw new CloudError(
        503,
        'invalid-backup-state',
        'The pending backup source could not be verified'
      );
    return job;
  }

  _nextBackupPending(state, head) {
    if (this._backupFingerprint(head) === state.lastFingerprint) return null;
    return (
      state.pending ?? {
        name: randomUUID(),
        requestedAt: new Date(this.now()).toISOString(),
        dueAt: new Date(
          Date.parse(state.lastSavedAt ?? head.campaign.createdAt) + CLOUD_BACKUP_INTERVAL_MS
        ).toISOString(),
      }
    );
  }

  async listBackups(principal, id) {
    const uid = principalUid(principal);
    await this._readHead(principal, id);
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        await this._metadata(
          await transaction.get(this.firestore.collection('campaigns').doc(id)),
          uid
        );
        return this._backupState(await transaction.get(this._backupStateReference(id)), uid, id)
          .records;
      },
      { readOnly: true }
    );
  }

  async backupStatus(principal, id) {
    const uid = principalUid(principal);
    await this._readHead(principal, id);
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const head = await this._metadata(
          await transaction.get(this.firestore.collection('campaigns').doc(id)),
          uid
        );
        const state = this._backupState(
          await transaction.get(this._backupStateReference(id)),
          uid,
          id
        );
        const jobs = await transaction.get(
          this.firestore
            .collection('campaigns')
            .doc(id)
            .collection('backupJobs')
            .where('state', '==', 'pending')
            .limit(1)
        );
        return {
          state: state.error
            ? 'error'
            : state.pending ||
                !jobs.empty ||
                this._backupFingerprint(head) !== state.lastFingerprint
              ? 'pending'
              : state.records.length
                ? 'saved'
                : 'none',
          error: state.error?.message ?? null,
          latest: state.records[0] ?? null,
          intervalMs: CLOUD_BACKUP_INTERVAL_MS,
          retain: CLOUD_BACKUP_RETAIN,
        };
      },
      { readOnly: true }
    );
  }

  async runBackupWork(principal, id, options = {}) {
    return this._runOwnerBackupWork(principalUid(principal), id, options);
  }

  async _runOwnerBackupWork(uid, id, options = {}) {
    if (
      !isCloudUUID(id) ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => key !== 'final') ||
      (Object.hasOwn(options, 'final') && typeof options.final !== 'boolean')
    )
      throw new CloudError(400, 'invalid-backup-request', 'Choose explicit private backup work');
    const final = options.final === true;
    const commandId = await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const campaign = this.firestore.collection('campaigns').doc(id);
      const head = await this._metadata(await transaction.get(campaign), uid);
      const reference = this._backupStateReference(id);
      const state = this._backupState(await transaction.get(reference), uid, id);
      if (state.lastGeneration > head.generation)
        throw new CloudError(
          503,
          'invalid-backup-state',
          'The backup source is ahead of the campaign'
        );
      const jobs = await transaction.get(
        campaign.collection('backupJobs').where('state', '==', 'pending').limit(1)
      );
      const fingerprint = this._backupFingerprint(head);
      const changed = fingerprint !== state.lastFingerprint;
      const job = jobs.empty ? null : await this._pendingBackupJob(jobs.docs[0], uid, id);
      if (
        final &&
        changed &&
        job?.automaticFinal === true &&
        job.snapshot.generation === head.generation &&
        job.fingerprint === fingerprint
      )
        return job.name;
      let pending = this._nextBackupPending(state, head);
      let error = state.error;
      let skipped = false;
      if (final && changed) {
        const started = await transaction.get(campaign.collection('backupJobs').doc(pending.name));
        if (started.exists && started.data().fingerprint !== fingerprint)
          pending = { ...pending, name: randomUUID() };
        pending = { ...pending, dueAt: new Date(this.now()).toISOString() };
      }
      if (!(final && changed) && job !== null) {
        if (job.automaticFinal === true && job.fingerprint === state.lastFingerprint) {
          skipped = true;
          transaction.set(jobs.docs[0].ref, { ...job, state: 'complete', skipped: true });
          if (error?.name === job.name) error = null;
          if (pending?.name === job.name)
            pending = this._nextBackupPending({ ...state, pending: null }, head);
        }
      }
      if (
        stableStringify(pending) !== stableStringify(state.pending) ||
        stableStringify(error) !== stableStringify(state.error)
      )
        transaction.set(reference, { ...state, pending, error });
      if (final && changed) return pending.name;
      if (!jobs.empty && !skipped) return jobs.docs[0].id;
      return pending !== null && Date.parse(pending.dueAt) <= this.now() ? pending.name : null;
    });
    return commandId === null ? null : this._backupNow(uid, id, { commandId });
  }

  async _recordBackupFailure(id, intent, error) {
    try {
      return await this._transaction(async (transaction) => {
        await this.access.assertEligibility(intent.uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return replay;
        if (error instanceof CloudError && error.code === 'cloud-requests-busy') return null;
        await this._metadata(
          await transaction.get(this.firestore.collection('campaigns').doc(id)),
          intent.uid
        );
        const reference = this._backupStateReference(id);
        const state = this._backupState(await transaction.get(reference), intent.uid, id);
        transaction.set(reference, {
          ...state,
          error: {
            name: intent.reference.id,
            code: error instanceof CloudError ? error.code : 'backup-request-failed',
            message: BACKUP_FAILURE_MESSAGE,
            at: new Date(this.now()).toISOString(),
          },
        });
        return null;
      });
    } catch (statusError) {
      console.error('[cloud-backup-status-failed]', {
        campaignId: id,
        code: statusError instanceof CloudError ? statusError.code : 'backup-status-write-failed',
      });
      return null;
    }
  }

  async backupNow(principal, id, command) {
    return this._backupNow(principalUid(principal), id, command);
  }

  async _backupNow(uid, id, command) {
    if (
      !isCloudUUID(id) ||
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).length !== 1 ||
      !isCloudUUID(command.commandId)
    )
      throw new CloudError(
        400,
        'invalid-backup-request',
        'Choose an owned campaign and explicit backup command'
      );
    const commandId = command.commandId;
    const fingerprint = createHash('sha256')
      .update(stableStringify({ kind: 'campaign.backup', campaignId: id }))
      .digest('hex');
    const account = this.firestore.collection('accountCommands').doc(pilotAccountKey(uid));
    const reference = account.collection('receipts').doc(commandId);
    const claimReference = account.collection('claims').doc(commandId);
    const intent = { uid, reference, fingerprint, kind: 'campaign.backup', campaignId: id };
    const campaign = this.firestore.collection('campaigns').doc(id);
    const jobReference = campaign.collection('backupJobs').doc(commandId);
    const previous = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return replay;
        await this._metadata(await transaction.get(campaign), uid);
        return null;
      },
      { readOnly: true }
    );
    if (previous !== null) return previous;
    const startedAt = this.now();
    let release = null;
    try {
      await this.usage.ensureOwnerAccount(uid);
      if (this.backupObjects?.bucket)
        await this.usage.prepareOwnerStorage(uid, this.backupObjects.bucket);
      const prepared = await this._transaction(async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return { replay, job: null };
        const head = await this._metadata(await transaction.get(campaign), uid);
        const jobSnapshot = await transaction.get(jobReference);
        const claim = await transaction.get(claimReference);
        if (jobSnapshot.exists) {
          if (jobSnapshot.data()?.state === 'complete' && jobSnapshot.data()?.skipped === true)
            throw new CloudError(
              409,
              'backup-already-covered',
              'This final checkpoint is already covered by a complete backup'
            );
          const job = await this._pendingBackupJob(jobSnapshot, uid, id);
          if (claim.exists ? claim.data().fingerprint !== fingerprint : job.automaticFinal !== true)
            throw new CloudError(
              503,
              'invalid-backup-state',
              'The pending backup could not be verified'
            );
          await this._touchBackupSources(transaction, uid, id, job.snapshot);
          if (!claim.exists)
            transaction.create(claimReference, {
              version: 1,
              uid,
              kind: 'campaign.backup',
              fingerprint,
              campaignId: id,
            });
          return { replay: null, job };
        }
        if (
          claim.exists ||
          (await transaction.get(campaign.collection('backups').doc(commandId))).exists
        )
          throw new CloudError(409, 'command-id-conflict', 'This backup identity was already used');
        const job = {
          version: 1,
          uid,
          campaignId: id,
          name: commandId,
          createdAt: new Date(this.now()).toISOString(),
          fingerprint: this._backupFingerprint(head),
          snapshot: this._backupSnapshot(head),
          state: 'pending',
        };
        await this._touchBackupSources(transaction, uid, id, head);
        transaction.create(claimReference, {
          version: 1,
          uid,
          kind: 'campaign.backup',
          fingerprint,
          campaignId: id,
        });
        transaction.create(jobReference, job);
        return { replay: null, job };
      });
      if (prepared.replay !== null) return prepared.replay;
      if (this.backupObjects === null)
        throw new CloudError(
          503,
          'backup-storage-unavailable',
          'Complete private backup storage is not configured'
        );
      release = acquireLargeFileWork();
      const text = await this._exportState(await this._loadSnapshot(prepared.job.snapshot));
      const archived = await this.backupObjects.stage(id, commandId, text, (candidate) =>
        this.usage.reserveOwnerStorage(uid, id, candidate, this.backupObjects.bucket)
      );
      const stateReference = this._backupStateReference(id);
      return await this._transaction(async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return replay;
        if (!(await transaction.get(claimReference)).exists)
          throw new CloudError(
            503,
            'invalid-backup-state',
            'The original backup intent is missing'
          );
        const currentHead = await this._metadata(await transaction.get(campaign), uid);
        const job = (await transaction.get(jobReference)).data();
        if (job?.state !== 'pending' || job.fingerprint !== prepared.job.fingerprint)
          throw new CloudError(
            503,
            'invalid-backup-state',
            'The original backup source could not be reconciled'
          );
        const state = this._backupState(await transaction.get(stateReference), uid, id);
        if (state.lastGeneration > currentHead.generation)
          throw new CloudError(
            503,
            'invalid-backup-state',
            'The backup source is ahead of the campaign'
          );
        await this.usage.assertPublication(
          transaction,
          uid,
          id,
          [
            {
              path: `campaigns/${id}/backups/${commandId}/${archived.sha256}.json`,
              bytes: archived.bytes,
            },
          ],
          startedAt
        );
        const record = {
          name: commandId,
          createdAt: prepared.job.createdAt,
          bytes: archived.bytes,
          generation: prepared.job.snapshot.generation,
        };
        const records = [record, ...state.records].sort(newestBackupFirst);
        const retained = records.slice(0, CLOUD_BACKUP_RETAIN);
        if (retained.some((point) => point.name === commandId))
          transaction.create(campaign.collection('backups').doc(commandId), {
            version: 1,
            uid,
            campaignId: id,
            record,
            reference: archived,
            fingerprint: prepared.job.fingerprint,
          });
        for (const old of state.records.filter(
          (point) => !retained.some((kept) => kept.name === point.name)
        ))
          transaction.delete(campaign.collection('backups').doc(old.name));
        const nextState = {
          ...state,
          records: retained,
          ...(record.generation > state.lastGeneration ||
          (record.generation === state.lastGeneration &&
            Date.parse(record.createdAt) >= Date.parse(state.lastSavedAt))
            ? {
                lastFingerprint: prepared.job.fingerprint,
                lastSavedAt: record.createdAt,
                lastGeneration: record.generation,
              }
            : {}),
          pending: state.pending?.name === commandId ? null : state.pending,
          error: state.error?.name === commandId ? null : state.error,
        };
        nextState.pending = this._nextBackupPending(nextState, currentHead);
        transaction.set(stateReference, nextState);
        transaction.set(jobReference, { ...job, state: 'complete' });
        transaction.create(reference, {
          version: 1,
          uid,
          kind: 'campaign.backup',
          fingerprint,
          campaignId: id,
          result: record,
        });
        return record;
      });
    } catch (error) {
      const replay = await this._recordBackupFailure(id, intent, error);
      if (replay !== null) return replay;
      throw error;
    } finally {
      release?.();
    }
  }

  async readBackup(principal, id, name) {
    const uid = principalUid(principal);
    if (!isCloudUUID(name))
      throw new CloudError(400, 'invalid-backup-request', 'Choose an explicit retained backup');
    await this._readHead(principal, id);
    const archived = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const current = await this._metadata(
          await transaction.get(this.firestore.collection('campaigns').doc(id)),
          uid
        );
        const state = this._backupState(
          await transaction.get(this._backupStateReference(id)),
          uid,
          id
        );
        const retained = state.records.find((point) => point.name === name);
        if (!retained)
          throw new CloudError(
            404,
            'backup-not-found',
            'This retained private backup is not available'
          );
        const snapshot = await transaction.get(
          this.firestore.collection('campaigns').doc(id).collection('backups').doc(name)
        );
        if (!snapshot.exists)
          throw new CloudError(
            503,
            'invalid-backup-state',
            'A retained backup manifest is missing'
          );
        const record = snapshot.data();
        if (
          record?.version !== 1 ||
          record.uid !== uid ||
          record.campaignId !== id ||
          !isCloudBackupRecord(record.record) ||
          record.record.name !== name ||
          record.record.generation > current.generation ||
          stableStringify(record.record) !== stableStringify(retained) ||
          !isCompleteBackupReference(record.reference, id, name) ||
          record.record.bytes !== record.reference.bytes
        )
          throw new CloudError(
            503,
            'invalid-backup-state',
            'The retained backup could not be verified'
          );
        return record.reference;
      },
      { readOnly: true }
    );
    if (this.backupObjects === null)
      throw new CloudError(
        503,
        'backup-storage-unavailable',
        'Private backup storage is not configured'
      );
    const text = await this.backupObjects.read(id, name, archived);
    const parsed = this._domain({}).parseBackup(text);
    if (parsed.campaign.id !== id)
      throw new CloudError(
        503,
        'backup-integrity-failed',
        'The backup belongs to a different campaign'
      );
    await this._readHead(principal, id);
    return text;
  }

  async _touchBackupSources(transaction, uid, id, head) {
    const candidates = [];
    for (const [kind, reference] of [
      ['scene', head.sceneRef],
      ['characters', head.charactersRef],
      ['presentations', head.presentationRef ?? null],
    ]) {
      if (reference === null) continue;
      if (!isImmutableCloudReference(id, kind, reference))
        throw new CloudError(
          503,
          'invalid-backup-state',
          'The pending backup source references are invalid'
        );
      candidates.push({ path: reference.path, bytes: reference.bytes });
    }
    await this.usage.touchReferences(transaction, uid, id, candidates);
  }

  _importReference(uid, importId) {
    return this.firestore
      .collection('accountImports')
      .doc(pilotAccountKey(uid))
      .collection('transfers')
      .doc(importId);
  }

  _maintenanceWorkRecord(snapshot, uid) {
    if (!snapshot.exists)
      return {
        version: 1,
        uid,
        phase: 'campaign',
        campaignCursor: null,
        importCursor: null,
        token: null,
        leaseUntil: 0,
        nextRunAt: 0,
        lastRunAt: null,
        lastError: null,
      };
    const saved = snapshot.data();
    if (
      saved?.version !== 1 ||
      saved.uid !== uid ||
      !['campaign', 'import'].includes(saved.phase) ||
      ![saved.campaignCursor, saved.importCursor].every(
        (cursor) => cursor === null || isCloudUUID(cursor)
      ) ||
      !(saved.token === null || isCloudUUID(saved.token)) ||
      !Number.isSafeInteger(saved.leaseUntil) ||
      saved.leaseUntil < 0 ||
      (saved.token === null) !== (saved.leaseUntil === 0) ||
      !Number.isSafeInteger(saved.nextRunAt) ||
      saved.nextRunAt < 0 ||
      !(saved.lastRunAt === null || validTime(saved.lastRunAt)) ||
      !(
        saved.lastError === null ||
        (typeof saved.lastError?.code === 'string' &&
          /^[a-z0-9-]{1,96}$/.test(saved.lastError.code) &&
          validTime(saved.lastError.at))
      )
    )
      throw new CloudError(
        503,
        'invalid-maintenance-state',
        'The account maintenance lease is invalid'
      );
    return saved;
  }

  async _nextMaintenanceTarget(uid, phase, cursor) {
    const collection =
      phase === 'campaign'
        ? this.firestore.collection('campaigns').where('ownerUid', '==', uid)
        : this.firestore
            .collection('accountImports')
            .doc(pilotAccountKey(uid))
            .collection('transfers');
    const query = collection.orderBy(FieldPath.documentId()).limit(1);
    let rows = await (cursor === null ? query : query.startAfter(cursor)).get();
    if (rows.empty && cursor !== null) rows = await query.get();
    if (rows.empty) return null;
    const snapshot = rows.docs[0];
    const id =
      phase === 'campaign'
        ? (await this._metadata(snapshot, uid)).campaign.id
        : this._importRecord(snapshot, uid, snapshot.id).campaignId;
    return { phase, cursor: snapshot.id, id };
  }

  async runObjectMaintenance(principal) {
    const uid = principalUid(principal);
    const reference = this.firestore
      .collection('accountObjectMaintenance')
      .doc(pilotAccountKey(uid));
    const claim = await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const saved = this._maintenanceWorkRecord(await transaction.get(reference), uid);
      const now = this.now();
      if (saved.nextRunAt > now || saved.leaseUntil > now) return null;
      const claimed = {
        ...saved,
        token: randomUUID(),
        leaseUntil: now + OBJECT_MAINTENANCE_INTERVAL_MS,
        nextRunAt: now + OBJECT_MAINTENANCE_INTERVAL_MS,
      };
      transaction.set(reference, claimed);
      return claimed;
    });
    if (claim === null) return { version: 1, state: 'deferred' };
    let target = null;
    let result = null;
    let failure = null;
    try {
      target = await this._nextMaintenanceTarget(
        uid,
        claim.phase,
        claim.phase === 'campaign' ? claim.campaignCursor : claim.importCursor
      );
      if (target === null) {
        const other = claim.phase === 'campaign' ? 'import' : 'campaign';
        target = await this._nextMaintenanceTarget(
          uid,
          other,
          other === 'campaign' ? claim.campaignCursor : claim.importCursor
        );
      }
      if (target !== null) result = await this.maintainObjects(principal, target.id);
    } catch (error) {
      failure =
        error instanceof Error
          ? error
          : new CloudError(
              503,
              'maintenance-failed',
              'Private object maintenance could not be completed'
            );
      console.error('[cloud-object-maintenance]', {
        code: error instanceof CloudError ? error.code : 'maintenance-failed',
      });
    }
    await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const saved = this._maintenanceWorkRecord(await transaction.get(reference), uid);
      if (saved.token !== claim.token)
        throw new CloudError(
          503,
          'maintenance-state-changed',
          'Another worker owns the maintenance lease'
        );
      const now = this.now();
      transaction.set(reference, {
        ...saved,
        token: null,
        leaseUntil: 0,
        nextRunAt: now + (failure !== null || result?.more ? 5000 : OBJECT_MAINTENANCE_INTERVAL_MS),
        lastRunAt: failure === null ? new Date(now).toISOString() : saved.lastRunAt,
        lastError:
          failure === null
            ? null
            : {
                code: failure instanceof CloudError ? failure.code : 'maintenance-failed',
                at: new Date(now).toISOString(),
              },
        ...(failure === null && target !== null && !result.more
          ? {
              phase: target.phase === 'campaign' ? 'import' : 'campaign',
              [target.phase === 'campaign' ? 'campaignCursor' : 'importCursor']: target.cursor,
            }
          : {}),
      });
    });
    if (failure !== null) throw failure;
    return { version: 1, state: target === null ? 'idle' : 'complete', result };
  }

  async _maintenanceImport(transaction, uid, id) {
    const jobs = await transaction.get(
      this.firestore
        .collection('accountImports')
        .doc(pilotAccountKey(uid))
        .collection('transfers')
        .where('campaignId', '==', id)
        .limit(2)
    );
    if (jobs.empty) return null;
    if (jobs.size !== 1)
      throw new CloudError(
        503,
        'invalid-maintenance-state',
        'The import target authority is ambiguous'
      );
    const snapshot = jobs.docs[0];
    const job = this._importRecord(snapshot, uid, snapshot.id);
    const claim = (
      await transaction.get(
        this.firestore
          .collection('accountCommands')
          .doc(pilotAccountKey(uid))
          .collection('claims')
          .doc(job.importId)
      )
    ).data();
    if (
      claim?.version !== 1 ||
      claim.uid !== uid ||
      claim.kind !== 'campaign.import' ||
      claim.campaignId !== id ||
      claim.fingerprint !== job.fingerprint
    )
      throw new CloudError(
        503,
        'invalid-maintenance-state',
        'The import target claim could not be verified'
      );
    return { job, active: job.state === 'uploading' && Date.parse(job.expiresAt) > this.now() };
  }

  async _maintenanceAuthority(transaction, uid, id) {
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const snapshot = await transaction.get(this.firestore.collection('campaigns').doc(id));
    if (snapshot.exists) return { head: await this._metadata(snapshot, uid), importing: null };
    const importing = await this._maintenanceImport(transaction, uid, id);
    if (importing === null) throw unavailableCampaign();
    if (importing.job.state === 'complete')
      throw new CloudError(
        503,
        'invalid-maintenance-state',
        'A completed import target has no saved head'
      );
    return { head: null, importing };
  }

  async _maintenanceImageRoots(principal, id) {
    const authority = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(principalUid(principal), transaction);
        return this._maintenanceAuthority(transaction, principal.uid, id);
      },
      { readOnly: true }
    );
    const head = authority.head;
    if (head === null) return { generation: null, paths: new Set() };
    if (head.charactersRef === null) return { generation: head.generation, paths: new Set() };
    const release = acquireLargeFileWork();
    try {
      const records = await this.objects.read(id, 'characters', head.charactersRef);
      return {
        generation: head.generation,
        paths: new Set(
          this._imageEntries(records).map((image) => `campaigns/${id}/assets/${image.sha256}.bin`)
        ),
      };
    } finally {
      release();
    }
  }

  async _maintenanceRoots(transaction, uid, id, images = null, candidatePath = null) {
    const campaign = this.firestore.collection('campaigns').doc(id);
    const { head, importing } = await this._maintenanceAuthority(transaction, uid, id);
    if (head === null) return { head, paths: new Set(), pending: importing.active };
    const state = this._backupState(await transaction.get(this._backupStateReference(id)), uid, id);
    if (state.lastGeneration > head.generation)
      throw new CloudError(
        503,
        'invalid-maintenance-state',
        'Backup roots are ahead of the campaign'
      );
    const paths = new Set();
    if (images !== null) {
      if (images.generation !== head.generation)
        throw new CloudError(
          503,
          'maintenance-state-changed',
          'Campaign image references changed during maintenance'
        );
      for (const path of images.paths) paths.add(path);
    }
    for (const [kind, reference] of [
      ['scene', head.sceneRef],
      ['characters', head.charactersRef],
    ]) {
      if (reference === null) continue;
      if (!isImmutableCloudReference(id, kind, reference))
        throw new CloudError(
          503,
          'invalid-maintenance-state',
          'Current object references could not be verified'
        );
      paths.add(reference.path);
    }
    const references = state.records.map((record) =>
      campaign.collection('backups').doc(record.name)
    );
    const snapshots = references.length ? await transaction.getAll(...references) : [];
    for (let index = 0; index < snapshots.length; index++) {
      const manifest = snapshots[index].data();
      const record = state.records[index];
      if (
        !snapshots[index].exists ||
        manifest?.version !== 1 ||
        manifest.uid !== uid ||
        manifest.campaignId !== id ||
        stableStringify(manifest.record) !== stableStringify(record) ||
        !isCompleteBackupReference(manifest.reference, id, record.name) ||
        manifest.reference.bytes !== record.bytes
      )
        throw new CloudError(
          503,
          'invalid-maintenance-state',
          'Retained backup references could not be verified'
        );
      paths.add(`campaigns/${id}/backups/${record.name}/${manifest.reference.sha256}.json`);
    }
    let pending = false;
    if (candidatePath?.includes('/objects/import/')) {
      const source = await this._maintenanceImport(transaction, uid, id);
      if (source === null || source.job.state !== 'complete')
        throw new CloudError(
          503,
          'invalid-maintenance-state',
          'The committed import source could not be verified'
        );
    }
    const snapshotKind =
      candidatePath === null
        ? null
        : new RegExp(`^campaigns/${id}/objects/(scene|characters)/`).exec(candidatePath)?.[1];
    if (snapshotKind) {
      const jobs = await transaction.get(
        campaign
          .collection('backupJobs')
          .where('state', '==', 'pending')
          .where(
            `snapshot.${snapshotKind === 'scene' ? 'sceneRef' : 'charactersRef'}.path`,
            '==',
            candidatePath
          )
          .limit(1)
      );
      for (const snapshot of jobs.docs) {
        const job = snapshot.data();
        if (
          job?.version !== 1 ||
          job.uid !== uid ||
          job.campaignId !== id ||
          job.snapshot?.ownerUid !== uid
        )
          throw new CloudError(
            503,
            'invalid-maintenance-state',
            'A pending source root could not be verified'
          );
      }
      pending = !jobs.empty;
    }
    const raw =
      candidatePath === null
        ? null
        : new RegExp(`^campaigns/${id}/backups/([a-f0-9-]{36})/`).exec(candidatePath);
    if (raw) {
      const snapshot = await transaction.get(campaign.collection('backupJobs').doc(raw[1]));
      if (snapshot.exists) {
        const job = snapshot.data();
        if (
          job?.version !== 1 ||
          job.uid !== uid ||
          job.campaignId !== id ||
          !['pending', 'complete'].includes(job.state)
        )
          throw new CloudError(
            503,
            'invalid-maintenance-state',
            'The complete-file root could not be verified'
          );
        pending = job.state === 'pending';
      }
    }
    return { head, paths, pending };
  }

  async _finishObjectDeletion(principal, id, reference, candidate, capturedImages = null) {
    if (
      candidate?.version !== 1 ||
      candidate.uid !== principalUid(principal) ||
      candidate.campaignId !== id ||
      candidate.state !== 'deleting' ||
      typeof candidate.path !== 'string' ||
      !candidate.path.startsWith(`campaigns/${id}/`) ||
      typeof candidate.generation !== 'string' ||
      !/^[1-9][0-9]*$/.test(candidate.generation) ||
      !isCloudUUID(candidate.token) ||
      !Number.isSafeInteger(candidate.bytes) ||
      candidate.bytes < 0 ||
      !validTime(candidate.firstUnreferencedAt) ||
      !validTime(candidate.eligibleAt) ||
      Date.parse(candidate.eligibleAt) <
        Date.parse(candidate.firstUnreferencedAt) + OBJECT_QUARANTINE_MS ||
      Date.parse(candidate.eligibleAt) > this.now() ||
      reference.id !==
        createHash('sha256').update(`${candidate.path}\n${candidate.generation}`).digest('hex')
    )
      throw new CloudError(503, 'invalid-maintenance-state', 'The pending deletion is invalid');
    const images = candidate.path.includes('/assets/')
      ? (capturedImages ?? (await this._maintenanceImageRoots(principal, id)))
      : null;
    const permit = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(principal.uid, transaction);
        const roots = await this._maintenanceRoots(
          transaction,
          principal.uid,
          id,
          images,
          candidate.path
        );
        const current = await this.usage.objectDeletionPermit(
          transaction,
          principal.uid,
          id,
          candidate,
          candidate.token
        );
        if (!current) return false;
        if (roots.paths.has(candidate.path) || roots.pending)
          throw new CloudError(
            503,
            'invalid-maintenance-state',
            'A pending deletion is referenced by saved data'
          );
        return true;
      },
      { readOnly: true }
    );
    const bucket = this.objects.bucket;
    if (permit) {
      try {
        await bucket
          .file(candidate.path, {
            preconditionOpts: { ifGenerationMatch: candidate.generation },
          })
          .delete();
      } catch (error) {
        if (error.code === 412)
          throw new CloudError(
            503,
            'maintenance-state-changed',
            'The object generation changed; no new deletion was acknowledged'
          );
        if (storageUnavailable(error))
          throw new CloudError(
            503,
            'maintenance-unavailable',
            'Private object deletion could not be confirmed; its byte charge is retained'
          );
        if (error.code !== 404) throw error;
      }
    }
    await this._transaction(async (transaction) => {
      await this.access.assertEligibility(principal.uid, transaction);
      const snapshot = await transaction.get(reference);
      const saved = snapshot.data();
      if (
        !snapshot.exists ||
        saved?.token !== candidate.token ||
        !['deleting', 'retired'].includes(saved.state)
      )
        throw new CloudError(
          503,
          'invalid-maintenance-state',
          'The completed deletion could not be reconciled'
        );
      await this.usage.retireObjectGeneration(
        transaction,
        principal.uid,
        id,
        candidate,
        candidate.token
      );
      transaction.set(reference, {
        ...saved,
        state: 'retired',
        deletedAt: new Date(this.now()).toISOString(),
      });
    });
  }

  async maintainObjects(principal, id) {
    const uid = principalUid(principal);
    await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        return this._maintenanceAuthority(transaction, uid, id);
      },
      { readOnly: true }
    );
    const bucket = this.objects?.bucket;
    if (typeof bucket?.getFiles !== 'function')
      throw new CloudError(
        503,
        'maintenance-unavailable',
        'Private object maintenance is not configured'
      );
    await this.usage.prepareStorage(principal, bucket);
    const releasedBytes = await this.usage.reconcileRetired(principal, id, bucket);
    const campaign = this.firestore.collection('campaigns').doc(id);
    const cursorReference = campaign.collection('objectMaintenance').doc('current');
    const cursor = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        await this._maintenanceAuthority(transaction, uid, id);
        const snapshot = await transaction.get(cursorReference);
        if (!snapshot.exists) return null;
        const saved = snapshot.data();
        if (
          saved?.version !== 1 ||
          saved.uid !== uid ||
          saved.campaignId !== id ||
          !(
            saved.pageToken === null ||
            (typeof saved.pageToken === 'string' && saved.pageToken.length > 0)
          )
        )
          throw new CloudError(
            503,
            'invalid-maintenance-state',
            'The bounded maintenance cursor is invalid'
          );
        return saved.pageToken;
      },
      { readOnly: true }
    );
    const pending = await campaign
      .collection('objectCleanup')
      .where('state', '==', 'deleting')
      .limit(4)
      .get();
    let files;
    let next;
    try {
      [files, next] = await bucket.getFiles({
        prefix: `campaigns/${id}/`,
        autoPaginate: false,
        maxResults: OBJECT_MAINTENANCE_PAGE_SIZE,
        ...(cursor === null ? {} : { pageToken: cursor }),
      });
    } catch (error) {
      if (storageUnavailable(error))
        throw new CloudError(
          503,
          'maintenance-unavailable',
          'Private object inventory could not be confirmed'
        );
      throw error;
    }
    const images =
      files.some((file) => file.metadata?.name?.includes('/assets/')) ||
      pending.docs.some((snapshot) => snapshot.data().path?.includes('/assets/'))
        ? await this._maintenanceImageRoots(principal, id)
        : null;
    let deleted = 0;
    for (const snapshot of pending.docs) {
      await this._finishObjectDeletion(principal, id, snapshot.ref, snapshot.data(), images);
      deleted++;
    }
    const result = {
      version: 1,
      scanned: files.length,
      quarantined: 0,
      deleted,
      deferred: 0,
      releasedBytes,
      more: pending.size === 4 || releasedBytes > 0,
    };
    for (const file of files) {
      const metadata = file.metadata;
      const path = metadata?.name;
      const bytes = Number(metadata?.size);
      if (
        typeof path !== 'string' ||
        !path.startsWith(`campaigns/${id}/`) ||
        metadata.bucket !== bucket.name ||
        typeof metadata.generation !== 'string' ||
        !/^[1-9][0-9]*$/.test(metadata.generation) ||
        !Number.isSafeInteger(bytes) ||
        bytes < 0
      )
        throw new CloudError(
          503,
          'invalid-maintenance-state',
          'Private object inventory could not be verified'
        );
      const canonical = new RegExp(
        `^campaigns/${id}/objects/(scene|characters|import|presentations)/[a-f0-9]{64}\\.json$`
      ).test(path);
      const complete = new RegExp(
        `^campaigns/${id}/backups/([a-f0-9-]{36})/[a-f0-9]{64}\\.json$`
      ).exec(path);
      const asset = new RegExp(`^campaigns/${id}/assets/([a-f0-9]{64})\\.bin$`).exec(path);
      if (!canonical && !(complete && isCloudUUID(complete[1])) && !asset) {
        result.deferred++;
        continue;
      }
      const reference = campaign
        .collection('objectCleanup')
        .doc(createHash('sha256').update(`${path}\n${metadata.generation}`).digest('hex'));
      const action = await this._transaction(async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const roots = await this._maintenanceRoots(transaction, uid, id, images, path);
        const snapshot = await transaction.get(reference);
        if (roots.pending || roots.paths.has(path)) return { kind: 'protected' };
        if (snapshot.exists) {
          const saved = snapshot.data();
          if (
            saved?.version !== 1 ||
            saved.uid !== uid ||
            saved.campaignId !== id ||
            saved.path !== path ||
            saved.generation !== metadata.generation ||
            saved.bytes !== bytes ||
            !['quarantined', 'deleting', 'retired'].includes(saved.state) ||
            !validTime(saved.firstUnreferencedAt) ||
            !validTime(saved.eligibleAt) ||
            Date.parse(saved.eligibleAt) <
              Date.parse(saved.firstUnreferencedAt) + OBJECT_QUARANTINE_MS
          )
            throw new CloudError(
              503,
              'invalid-maintenance-state',
              'The object quarantine could not be verified'
            );
          if (saved.state === 'retired' || Date.parse(saved.eligibleAt) > this.now())
            return { kind: 'waiting' };
          if (result.deleted >= 4) return { kind: 'budget' };
          const assetReference = asset ? campaign.collection('assets').doc(asset[1]) : null;
          const assetSnapshot = assetReference ? await transaction.get(assetReference) : null;
          if (assetSnapshot?.exists) {
            const record = assetSnapshot.data();
            if (
              record?.version !== 1 ||
              record.campaignId !== id ||
              !isPrivateAssetReference(record.reference, id) ||
              record.reference.sha256 !== asset[1] ||
              record.reference.generation !== metadata.generation
            )
              throw new CloudError(
                503,
                'invalid-maintenance-state',
                'The unused asset generation could not be verified'
              );
          }
          const claim = await this.usage.claimObjectDeletion(
            transaction,
            uid,
            id,
            {
              path,
              bytes,
              generation: metadata.generation,
            },
            Date.parse(saved.firstUnreferencedAt)
          );
          if (claim.postponed) {
            const now = this.now();
            transaction.set(reference, {
              ...saved,
              state: 'quarantined',
              firstUnreferencedAt: new Date(now).toISOString(),
              eligibleAt: new Date(now + OBJECT_QUARANTINE_MS).toISOString(),
            });
            return { kind: 'waiting' };
          }
          const candidate = { ...saved, state: 'deleting', token: claim.token };
          if (assetSnapshot?.exists) transaction.delete(assetReference);
          transaction.set(reference, candidate);
          return { kind: 'delete', candidate };
        }
        const now = this.now();
        transaction.create(reference, {
          version: 1,
          uid,
          campaignId: id,
          path,
          generation: metadata.generation,
          bytes,
          state: 'quarantined',
          firstUnreferencedAt: new Date(now).toISOString(),
          eligibleAt: new Date(now + OBJECT_QUARANTINE_MS).toISOString(),
        });
        return { kind: 'quarantined' };
      });
      if (action.kind === 'quarantined') result.quarantined++;
      if (action.kind === 'budget') result.more = true;
      if (action.kind === 'delete') {
        await this._finishObjectDeletion(principal, id, reference, action.candidate, images);
        result.deleted++;
      }
    }
    const pageToken = next?.pageToken ?? null;
    if (!(pageToken === null || (typeof pageToken === 'string' && pageToken.length > 0)))
      throw new CloudError(
        503,
        'invalid-maintenance-state',
        'The next maintenance page is invalid'
      );
    if (pageToken !== null) result.more = true;
    await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      await this._maintenanceAuthority(transaction, uid, id);
      transaction.set(cursorReference, { version: 1, uid, campaignId: id, pageToken });
    });
    return result;
  }

  _importRecord(snapshot, uid, importId) {
    const job = snapshot.data();
    if (!snapshot.exists || job?.uid !== uid)
      throw new CloudError(404, 'import-not-found', 'This private import is not available');
    if (
      job.version !== 1 ||
      job.importId !== importId ||
      snapshot.id !== importId ||
      !['uploading', 'failed', 'complete'].includes(job.state) ||
      !validTime(job.createdAt) ||
      !validTime(job.expiresAt) ||
      Date.parse(job.expiresAt) <= Date.parse(job.createdAt) ||
      !Array.isArray(job.parts) ||
      !isCloudImportTicket(importTicket(importId, job)) ||
      (job.state === 'failed' && !terminalImportReasons.has(job.failure)) ||
      job.fingerprint !== importFingerprint(job.bytes, job.sha256) ||
      job.parts.some(
        (part) =>
          !isImmutableCloudReference(job.campaignId, 'import', part.reference) ||
          part.reference.bytes !==
            4 * Math.ceil(part.bytes / 3) +
              Buffer.byteLength(JSON.stringify({ version: 1, kind: 'import', value: '' }))
      )
    )
      throw invalidImport();
    return job;
  }

  _openImport(job) {
    if (job.state === 'failed') throw importRejection(job.failure);
    if (job.state !== 'uploading') throw invalidImport();
    if (Date.parse(job.expiresAt) <= this.now())
      throw new CloudError(
        410,
        'import-expired',
        'This unfinished import expired; select the original file again'
      );
  }

  async startImport(principal, command) {
    const uid = principalUid(principal);
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some((key) => !['commandId', 'bytes', 'sha256'].includes(key)) ||
      !isCloudUUID(command.commandId) ||
      !Number.isSafeInteger(command.bytes) ||
      command.bytes < 1 ||
      !isCloudDigest(command.sha256)
    )
      throw new CloudError(
        400,
        'invalid-import-request',
        'Choose a complete campaign file and an explicit import command'
      );
    if (command.bytes > CLOUD_BACKUP_BYTE_LIMIT)
      throw new CloudError(
        413,
        'backup-too-large',
        'Cloud campaign files must not exceed 128,000,000 UTF-8 bytes'
      );
    const { commandId, bytes, sha256 } = command;
    const fingerprint = importFingerprint(bytes, sha256);
    const account = this.firestore.collection('accountCommands').doc(pilotAccountKey(uid));
    const reference = account.collection('receipts').doc(commandId);
    const intent = { uid, reference, fingerprint, kind: 'campaign.import' };
    const completedTicket = (result) => {
      const ticket = importTicket(
        commandId,
        {
          campaignId: result.campaign.id,
          bytes,
          sha256,
          parts: [],
        },
        result
      );
      if (!isCloudImportTicket(ticket)) throw invalidImport();
      return ticket;
    };
    const previous = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        return this._previousCommand(transaction, intent);
      },
      { readOnly: true }
    );
    if (previous !== null) return completedTicket(previous);
    await this.usage.ensureAccount(principal);
    const campaignId = randomUUID();
    const jobReference = this._importReference(uid, commandId);
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, intent);
      if (replay !== null) return completedTicket(replay);
      const snapshot = await transaction.get(jobReference);
      if (snapshot.exists) {
        const job = this._importRecord(snapshot, uid, commandId);
        const committed = await this._previousCommand(transaction, {
          ...intent,
          campaignId: job.campaignId,
        });
        if (committed !== null) return completedTicket(committed);
        this._openImport(job);
        return importTicket(commandId, job);
      }
      const claimReference = account.collection('claims').doc(commandId);
      if ((await transaction.get(claimReference)).exists) throw invalidImport();
      await this.usage.assertCampaignCapacity(uid, transaction);
      if ((await transaction.get(this.firestore.collection('campaigns').doc(campaignId))).exists)
        throw new CloudError(
          503,
          'import-unavailable',
          'A new private campaign could not be allocated; retry the same import'
        );
      const now = this.now();
      const job = {
        version: 1,
        uid,
        importId: commandId,
        campaignId,
        bytes,
        sha256,
        fingerprint,
        state: 'uploading',
        parts: [],
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + IMPORT_TTL_MS).toISOString(),
      };
      transaction.create(claimReference, {
        version: 1,
        uid,
        kind: 'campaign.import',
        fingerprint,
        campaignId,
      });
      transaction.create(jobReference, job);
      return importTicket(commandId, job);
    });
  }

  async uploadImportChunk(principal, importId, command) {
    const uid = principalUid(principal);
    if (
      !isCloudUUID(importId) ||
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some((key) => !['index', 'data'].includes(key)) ||
      !Number.isSafeInteger(command.index) ||
      command.index < 0 ||
      typeof command.data !== 'string' ||
      !command.data.length
    )
      throw new CloudError(
        400,
        'invalid-import-chunk',
        'Choose a bounded part of the original campaign file'
      );
    const { index, data } = command;
    if (data.length > 4 * Math.ceil(CLOUD_IMPORT_CHUNK_BYTES / 3))
      throw new CloudError(
        413,
        'import-chunk-too-large',
        'Campaign file parts must not exceed 1 MiB'
      );
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      throw new CloudError(400, 'invalid-import-chunk', 'Use complete canonical base64 file bytes');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > CLOUD_IMPORT_CHUNK_BYTES)
      throw new CloudError(
        413,
        'import-chunk-too-large',
        'Campaign file parts must not exceed 1 MiB'
      );
    if (bytes.toString('base64') !== data)
      throw new CloudError(400, 'invalid-import-chunk', 'Use complete canonical base64 file bytes');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const reference = this._importReference(uid, importId);
    const check = (job) => {
      const previous = job.parts.find((part) => part.index === index);
      if (previous) {
        if (previous.sha256 !== sha256 || previous.bytes !== bytes.length)
          throw new CloudError(
            409,
            'command-id-conflict',
            'This file part was already staged for another intent'
          );
        return { version: 1, importId, index, bytes: bytes.length, sha256 };
      }
      this._openImport(job);
      if (
        index >= Math.ceil(job.bytes / CLOUD_IMPORT_CHUNK_BYTES) ||
        bytes.length !==
          Math.min(CLOUD_IMPORT_CHUNK_BYTES, job.bytes - index * CLOUD_IMPORT_CHUNK_BYTES)
      )
        throw new CloudError(
          400,
          'invalid-import-chunk',
          'File part length does not match the original import'
        );
      return null;
    };
    const captured = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const job = this._importRecord(await transaction.get(reference), uid, importId);
        return { job, replay: check(job) };
      },
      { readOnly: true }
    );
    if (captured.replay !== null) return captured.replay;
    if (this.objects === null)
      throw new CloudError(
        503,
        'cloud-save-unavailable',
        'Private import staging is not configured'
      );
    const staged = await this.objects.stage(captured.job.campaignId, 'import', data, (candidate) =>
      this.usage.reserveStorage(
        principal,
        captured.job.campaignId,
        candidate,
        this.objects.bucket,
        { importId }
      )
    );
    const expected = snapshotCandidate(captured.job.campaignId, 'import', data);
    if (
      !isImmutableCloudReference(captured.job.campaignId, 'import', staged) ||
      staged.path !== expected.path ||
      staged.bytes !== expected.bytes
    )
      throw new CloudError(
        503,
        'snapshot-integrity-failed',
        'The staged file part failed its integrity check'
      );
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const job = this._importRecord(await transaction.get(reference), uid, importId);
      const replay = check(job);
      if (replay !== null) return replay;
      transaction.set(reference, {
        ...job,
        parts: [...job.parts, { index, bytes: bytes.length, sha256, reference: staged }].sort(
          (left, right) => left.index - right.index
        ),
      });
      return { version: 1, importId, index, bytes: bytes.length, sha256 };
    });
  }

  async _recoverImport(principal, importId) {
    const uid = principalUid(principal);
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(importId);
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const previous = await transaction.get(reference);
        if (!previous.exists) return null;
        return this._previousCommand(transaction, {
          uid,
          reference,
          kind: 'campaign.import',
          fingerprint: previous.data()?.fingerprint,
        });
      },
      { readOnly: true }
    );
  }

  async _rejectImport(principal, importId, reason) {
    const uid = principalUid(principal);
    const recovered = await this._recoverImport(principal, importId);
    if (recovered !== null) return recovered;
    const jobReference = this._importReference(uid, importId);
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(importId);
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const job = this._importRecord(await transaction.get(jobReference), uid, importId);
      const replay = await this._previousCommand(transaction, {
        uid,
        reference,
        kind: 'campaign.import',
        fingerprint: job.fingerprint,
        campaignId: job.campaignId,
      });
      if (replay !== null) return replay;
      if (
        job.state === 'complete' ||
        (await transaction.get(this.firestore.collection('campaigns').doc(job.campaignId))).exists
      )
        throw invalidImport();
      if (job.state !== 'failed')
        transaction.set(jobReference, { ...job, state: 'failed', failure: reason });
      return null;
    });
  }

  async _prepareImport(job) {
    if (this.objects === null || this.resources === null)
      throw new CloudError(
        503,
        'cloud-save-unavailable',
        'Complete private imports are not configured'
      );
    if (job.parts.length !== Math.ceil(job.bytes / CLOUD_IMPORT_CHUNK_BYTES))
      throw new CloudError(
        409,
        'import-incomplete',
        'Upload every part of the original file before finishing'
      );
    const bytes = Buffer.alloc(job.bytes);
    for (const part of job.parts) {
      const encoded = await this.objects.read(job.campaignId, 'import', part.reference);
      const value = Buffer.from(encoded, 'base64');
      if (
        value.length !== part.bytes ||
        value.toString('base64') !== encoded ||
        createHash('sha256').update(value).digest('hex') !== part.sha256
      )
        throw new CloudError(
          503,
          'snapshot-integrity-failed',
          'A staged file part failed its integrity check'
        );
      value.copy(bytes, part.index * CLOUD_IMPORT_CHUNK_BYTES);
    }
    if (createHash('sha256').update(bytes).digest('hex') !== job.sha256)
      throw new CloudError(
        400,
        'invalid-campaign-backup',
        'The complete file does not match the original import'
      );
    let data;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      data = this._domain({}).parseBackup(text);
    } catch (error) {
      if (
        error?.constructor === Error ||
        error instanceof SyntaxError ||
        error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA' ||
        ['backup-too-large', 'invalid-campaign-backup'].includes(error?.code)
      )
        throw new CloudError(
          400,
          'invalid-campaign-backup',
          'Choose a complete supported UTF-8 campaign JSON backup'
        );
      throw error;
    }
    const campaign = {
      version: 1,
      id: job.campaignId,
      name: data.campaign.name,
      ruleset: data.campaign.ruleset,
      coreVersion: data.campaign.coreVersion,
      sourcePacks: data.campaign.sourcePacks.map(({ id, version, ruleset, enabled }) => ({
        id,
        version,
        ruleset,
        enabled,
      })),
      charactersRevision: 0,
      sceneRevision: 0,
      sceneSavedAt: null,
      createdAt: job.createdAt,
    };
    const { next } = await this._prepareChange(
      {
        campaign,
        revision: 0,
        records: [],
        scene: null,
        sceneRevision: 0,
        sceneSavedAt: null,
      },
      'characters.commit',
      {
        ruleset: campaign.ruleset,
        revision: 0,
        records: data.records,
        ...(data.scene === null ? {} : { scene: { revision: 0, value: data.scene } }),
      }
    );
    return next;
  }

  async finishImport(principal, importId, command) {
    const uid = principalUid(principal);
    if (
      !isCloudUUID(importId) ||
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).length !== 1 ||
      command.commandId !== importId
    )
      throw new CloudError(
        400,
        'invalid-import-request',
        'Finish the original explicit import command'
      );
    const recovered = await this._recoverImport(principal, importId);
    if (recovered !== null) return recovered;
    const startedAt = this.now();
    const jobReference = this._importReference(uid, importId);
    try {
      const job = await this._transaction(
        async (transaction) => {
          await this.access.assertEligibility(uid, transaction);
          const captured = this._importRecord(await transaction.get(jobReference), uid, importId);
          this._openImport(captured);
          await this.usage.assertCampaignCapacity(uid, transaction);
          return captured;
        },
        { readOnly: true }
      );
      const next = await this._prepareImport(job);
      const images = [
        ...new Map(this._imageEntries(next.records).map((image) => [image.sha256, image])).values(),
      ];
      if (images.length && this.assets === null)
        throw new CloudError(
          503,
          'asset-storage-unavailable',
          'Private imported images are not configured'
        );
      const candidates = [
        snapshotCandidate(job.campaignId, 'characters', next.records),
        ...(next.scene === null ? [] : [snapshotCandidate(job.campaignId, 'scene', next.scene)]),
        ...images.map((image) => ({
          path: `campaigns/${job.campaignId}/assets/${image.sha256}.bin`,
          bytes: Buffer.byteLength(image.data, 'base64'),
        })),
      ];
      for (let offset = 0; offset < candidates.length; offset += 499)
        await this.usage.reserveStorage(
          principal,
          job.campaignId,
          candidates.slice(offset, offset + 499),
          this.objects.bucket,
          { importId }
        );
      const imageReferences = [];
      for (const image of images) {
        const bytes = Buffer.from(image.data, 'base64');
        const reference = await this.assets.stage(
          job.campaignId,
          image.mimeType,
          bytes,
          (candidate) =>
            this.usage.reserveStorage(principal, job.campaignId, candidate, this.assets.bucket, {
              importId,
            })
        );
        if (
          !isPrivateAssetReference(reference, job.campaignId) ||
          reference.sha256 !== image.sha256 ||
          reference.bytes !== bytes.length ||
          reference.mimeType !== image.mimeType
        )
          throw new CloudError(
            503,
            'asset-integrity-failed',
            'An imported image failed its integrity check'
          );
        await this._transaction(async (transaction) => {
          await this.access.assertEligibility(uid, transaction);
          this._openImport(this._importRecord(await transaction.get(jobReference), uid, importId));
          await this.usage.assertPublication(
            transaction,
            uid,
            job.campaignId,
            [
              {
                path: `campaigns/${job.campaignId}/assets/${reference.sha256}.bin`,
                bytes: reference.bytes,
              },
            ],
            startedAt
          );
          await this._publishAsset(transaction, job.campaignId, reference);
        });
        imageReferences.push(reference);
      }
      const reserve = (candidate) =>
        this.usage.reserveStorage(principal, job.campaignId, candidate, this.objects.bucket, {
          importId,
        });
      const [charactersRef, sceneRef] = await Promise.all([
        this.objects.stage(job.campaignId, 'characters', next.records, reserve),
        next.scene === null
          ? null
          : this.objects.stage(job.campaignId, 'scene', next.scene, reserve),
      ]);
      const reference = this.firestore
        .collection('accountCommands')
        .doc(pilotAccountKey(uid))
        .collection('receipts')
        .doc(importId);
      const intent = {
        uid,
        reference,
        kind: 'campaign.import',
        fingerprint: job.fingerprint,
        campaignId: job.campaignId,
      };
      const result = {
        version: 1,
        importId,
        bytes: job.bytes,
        sha256: job.sha256,
        campaign: next.campaign,
      };
      if (!isCloudImportReceipt(result)) throw invalidImport();
      const headReference = this.firestore.collection('campaigns').doc(job.campaignId);
      const { FieldValue } = require('firebase-admin/firestore');
      return await this._transaction(async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return replay;
        const current = this._importRecord(await transaction.get(jobReference), uid, importId);
        this._openImport(current);
        if ((await transaction.get(headReference)).exists) throw invalidImport();
        await this.usage.assertPublication(
          transaction,
          uid,
          job.campaignId,
          [
            { path: charactersRef.path, bytes: charactersRef.bytes },
            ...(sceneRef === null ? [] : [{ path: sceneRef.path, bytes: sceneRef.bytes }]),
            ...imageReferences.map((asset) => ({
              path: `campaigns/${job.campaignId}/assets/${asset.sha256}.bin`,
              bytes: asset.bytes,
            })),
          ],
          startedAt
        );
        await this.usage.claimCampaign(uid, transaction);
        transaction.create(headReference, {
          version: 1,
          ownerUid: uid,
          generation: 1,
          campaign: next.campaign,
          sceneRef,
          charactersRef,
        });
        transaction.create(reference, {
          version: 1,
          uid,
          kind: 'campaign.import',
          fingerprint: job.fingerprint,
          campaignId: job.campaignId,
          result,
        });
        transaction.set(jobReference, { ...current, state: 'complete' });
        transaction.create(headReference.collection('changes').doc('1'), {
          version: 1,
          generation: 1,
          kind: 'campaign.import',
          sceneRevision: next.sceneRevision,
          charactersRevision: next.revision,
          committedAt: FieldValue.serverTimestamp(),
        });
        return result;
      });
    } catch (error) {
      if (error instanceof CloudError) {
        if (terminalImportReasons.has(error.code)) {
          const replay = await this._rejectImport(principal, importId, error.code);
          if (replay !== null) return replay;
          throw importRejection(error.code);
        }
        const replay = await this._recoverImport(principal, importId);
        if (replay !== null) return replay;
      }
      throw error;
    }
  }

  async create(principal, command) {
    const uid = principalUid(principal);
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some((key) => !['commandId', 'options'].includes(key))
    )
      throw new CloudError(
        400,
        'invalid-campaign-request',
        'Choose explicit canonical campaign options and a command ID'
      );
    const { commandId, options } = command;
    if (
      !isCloudUUID(commandId) ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      typeof options.name !== 'string' ||
      typeof options.ruleset !== 'string' ||
      (Object.hasOwn(options, 'packIds') &&
        (!Array.isArray(options.packIds) ||
          options.packIds.some((id) => typeof id !== 'string' || !id))) ||
      Object.keys(options).some((key) => !['name', 'ruleset', 'packIds'].includes(key))
    )
      throw new CloudError(
        400,
        'invalid-campaign-request',
        'Choose explicit canonical campaign options and a command ID'
      );
    const intentOptions = structuredClone(options);
    const fingerprint = createHash('sha256')
      .update(stableStringify({ kind: 'campaign.create', options: intentOptions }))
      .digest('hex');
    const receiptRef = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(commandId);
    const intent = { uid, reference: receiptRef, fingerprint, kind: 'campaign.create' };
    const previous = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        return this._previousCommand(transaction, intent);
      },
      { readOnly: true }
    );
    if (previous !== null) return previous;
    let record;
    const domain = this._domain({
      writeCampaign: (value) => {
        record = structuredClone(value);
      },
    });
    let campaign;
    try {
      campaign = await domain.create(intentOptions);
    } catch (error) {
      if (error?.constructor !== Error) throw error;
      throw new CloudError(400, 'invalid-campaign-request', error.message);
    }
    await this.usage.ensureAccount(principal);
    const { FieldValue } = require('firebase-admin/firestore');
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, intent);
      if (replay !== null) return replay;
      await this.usage.claimCampaign(uid, transaction);
      transaction.create(this.firestore.collection('campaigns').doc(record.id), {
        version: 1,
        ownerUid: uid,
        generation: 1,
        campaign,
        sceneRef: null,
        charactersRef: null,
      });
      transaction.create(receiptRef, {
        version: 1,
        uid,
        kind: 'campaign.create',
        fingerprint,
        campaignId: campaign.id,
        result: campaign,
      });
      transaction.create(
        this.firestore.collection('campaigns').doc(record.id).collection('changes').doc('1'),
        {
          version: 1,
          generation: 1,
          kind: 'campaign.create',
          sceneRevision: 0,
          charactersRevision: 0,
          committedAt: FieldValue.serverTimestamp(),
        }
      );
      return campaign;
    });
  }

  _committedChange(snapshot, head) {
    const value = snapshot.data();
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).length !== 6 ||
      Object.keys(value).some(
        (field) =>
          ![
            'version',
            'generation',
            'kind',
            'sceneRevision',
            'charactersRevision',
            'committedAt',
          ].includes(field)
      ) ||
      value.version !== 1 ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 1 ||
      value.generation > head.generation ||
      snapshot.id !== String(value.generation) ||
      ![
        'campaign.create',
        'campaign.import',
        'campaign.settings',
        'campaign.arrival',
        'scene.commit',
        'characters.commit',
      ].includes(value.kind) ||
      !isCloudAccessGeneration(value.sceneRevision) ||
      !isCloudAccessGeneration(value.charactersRevision) ||
      !(value.committedAt instanceof Timestamp) ||
      !validMilliseconds(value.committedAt.toMillis())
    )
      throw new CloudError(
        503,
        'invalid-change-history',
        'Committed campaign history could not be verified'
      );
    return {
      version: 1,
      generation: value.generation,
      kind: value.kind,
      sceneRevision: value.sceneRevision,
      charactersRevision: value.charactersRevision,
      committedAt: value.committedAt.toDate().toISOString(),
    };
  }

  _changeHistoryReference(id) {
    return this.firestore
      .collection('campaigns')
      .doc(id)
      .collection('changeHistory')
      .doc('current');
  }

  _changeHistoryTime() {
    const now = this.now();
    if (!validMilliseconds(now))
      throw new CloudError(
        503,
        'change-history-unavailable',
        'The committed history clock could not be verified'
      );
    return now;
  }

  _changeHistoryFloor(snapshot, id, head) {
    if (!snapshot.exists) return 1;
    const value = snapshot.data();
    if (
      !value ||
      Object.keys(value).length !== 4 ||
      Object.keys(value).some(
        (field) => !['version', 'campaignId', 'prunedThrough', 'lastPrunedAt'].includes(field)
      ) ||
      value.version !== 1 ||
      value.campaignId !== id ||
      !Number.isSafeInteger(value.prunedThrough) ||
      value.prunedThrough < 0 ||
      value.prunedThrough > head.generation ||
      !(value.lastPrunedAt instanceof Timestamp)
    )
      throw new CloudError(
        503,
        'invalid-change-history',
        'The retained change-history boundary could not be verified'
      );
    return value.prunedThrough + 1;
  }

  async _committedChanges(transaction, id, head, afterGeneration) {
    const now = this._changeHistoryTime();
    const result = {
      version: 1,
      campaignId: id,
      afterGeneration,
      headGeneration: head.generation,
      changes: [],
      resync: null,
    };
    if (afterGeneration > head.generation)
      throw new CloudError(409, 'change-cursor-ahead', 'Refresh the current campaign checkpoint');
    const floor = this._changeHistoryFloor(
      await transaction.get(this._changeHistoryReference(id)),
      id,
      head
    );
    if (afterGeneration === head.generation) return result;
    if (head.generation - afterGeneration > CHANGE_HISTORY_RETAIN || afterGeneration + 1 < floor)
      return { ...result, resync: 'history-pruned' };
    const rows = await transaction.get(
      this.firestore
        .collection('campaigns')
        .doc(id)
        .collection('changes')
        .where('generation', '>', afterGeneration)
        .where('generation', '<=', head.generation)
        .orderBy('generation', 'asc')
        .limit(CHANGE_HISTORY_RETAIN)
    );
    const changes = rows.docs.map((snapshot) => this._committedChange(snapshot, head));
    if (afterGeneration === 0 && (!changes.length || changes[0].generation === 2))
      return { ...result, resync: 'legacy-baseline' };
    if (
      changes.length !== head.generation - afterGeneration ||
      changes.some((change, index) => change.generation !== afterGeneration + index + 1) ||
      changes.some(
        (change, index) =>
          index > 0 &&
          (change.sceneRevision < changes[index - 1].sceneRevision ||
            change.charactersRevision < changes[index - 1].charactersRevision ||
            Date.parse(change.committedAt) < Date.parse(changes[index - 1].committedAt))
      ) ||
      changes.at(-1).sceneRevision !== head.campaign.sceneRevision ||
      changes.at(-1).charactersRevision !== head.campaign.charactersRevision
    )
      throw new CloudError(
        503,
        'invalid-change-history',
        'The committed revision sequence could not be verified'
      );
    if (Date.parse(changes[0].committedAt) <= now - CHANGE_HISTORY_MAX_AGE_MS)
      return { ...result, resync: 'history-expired' };
    return { ...result, changes };
  }

  async readCommittedChanges(principal, id, command) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).length !== 1 ||
      !Object.hasOwn(command, 'afterGeneration') ||
      !isCloudAccessGeneration(command.afterGeneration)
    )
      throw new CloudError(400, 'invalid-change-request', 'Choose an explicit committed revision');
    const afterGeneration = command.afterGeneration;
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const head = await this._metadata(
          await transaction.get(this.firestore.collection('campaigns').doc(id)),
          uid
        );
        return this._committedChanges(transaction, id, head, afterGeneration);
      },
      { readOnly: true }
    );
  }

  async runChangeMaintenance(principal, id, expected = null) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const scope = this._accessExpectation(expected);
    const reference = this.firestore.collection('campaigns').doc(id);
    const { FieldValue } = require('firebase-admin/firestore');
    return this._transaction(async (transaction) => {
      if (scope === null) await this.access.assertEligibility(uid, transaction);
      else {
        const grant = await this._participantGrant(transaction, uid, id, scope);
        if (grant.access.role !== 'member') throw unavailableCampaign();
      }
      const saved = await transaction.get(reference);
      const head = await this._metadata(saved, scope === null ? uid : saved.data().ownerUid);
      const floorReference = this._changeHistoryReference(id);
      const floorSnapshot = await transaction.get(floorReference);
      const floor = this._changeHistoryFloor(floorSnapshot, id, head);
      const countFloor = Math.max(1, head.generation - CHANGE_HISTORY_RETAIN + 1);
      const cutoff = this._changeHistoryTime() - CHANGE_HISTORY_MAX_AGE_MS;
      const retained = (change) =>
        change.generation >= countFloor && Date.parse(change.committedAt) > cutoff;
      const oldest = reference.collection('changes').orderBy('generation', 'asc');
      let rows = await transaction.get(oldest.limit(1));
      if (!rows.empty && !retained(this._committedChange(rows.docs[0], head)))
        rows = await transaction.get(oldest.limit(CHANGE_HISTORY_PRUNE_BATCH));
      const retired = [];
      let next = floor;
      let time = -Infinity;
      for (const snapshot of rows.docs) {
        const change = this._committedChange(snapshot, head);
        if (next === 1 && change.generation === 2 && !floorSnapshot.exists) next = 2;
        if (change.generation !== next || Date.parse(change.committedAt) < time)
          throw new CloudError(
            503,
            'invalid-change-history',
            'The retiring change sequence could not be verified'
          );
        if (retained(change)) break;
        retired.push(snapshot.ref);
        next++;
        time = Date.parse(change.committedAt);
      }
      if (!retired.length) return { removed: 0, retainedFrom: floor };
      for (const row of retired) transaction.delete(row);
      transaction.set(floorReference, {
        version: 1,
        campaignId: id,
        prunedThrough: next - 1,
        lastPrunedAt: FieldValue.serverTimestamp(),
      });
      return { removed: retired.length, retainedFrom: next };
    });
  }

  async list(principal) {
    const uid = principalUid(principal);
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const snapshots = await transaction.get(
          this.firestore.collection('campaigns').where('ownerUid', '==', uid)
        );
        const campaigns = [];
        for (const snapshot of snapshots.docs)
          campaigns.push((await this._metadata(snapshot, uid)).campaign);
        return campaigns.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      },
      { readOnly: true }
    );
  }

  async createInvitation(principal, id, command) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const options = command?.options;
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some((key) => !['commandId', 'options'].includes(key)) ||
      !isCloudUUID(command.commandId) ||
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => !['name', 'seatId', 'tokenHash'].includes(key)) ||
      typeof options.name !== 'string' ||
      !options.name.trim() ||
      options.name.trim().length > 80 ||
      (options.seatId !== null && !isCloudUUID(options.seatId)) ||
      !isCloudDigest(options.tokenHash)
    )
      throw new CloudError(
        400,
        'invalid-invitation-request',
        'Choose an explicit player seat and a secure invitation hash'
      );
    const fingerprint = createHash('sha256')
      .update(stableStringify({ kind: 'campaign.invite', campaignId: id, options }))
      .digest('hex');
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    const createdAt = new Date(this.now()).toISOString();
    const invitation = {
      version: 1,
      id: randomUUID(),
      campaignId: id,
      seatId: options.seatId ?? randomUUID(),
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + CLOUD_INVITATION_TTL_MS).toISOString(),
    };
    const headReference = this.firestore.collection('campaigns').doc(id);
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, {
        uid,
        reference,
        fingerprint,
        kind: 'campaign.invite',
        campaignId: id,
      });
      if (replay !== null) return replay;
      await this._metadata(await transaction.get(headReference), uid);
      const seatReference = headReference.collection('seats').doc(invitation.seatId);
      let revoke = null;
      if (options.seatId !== null) {
        const seat = this._seat(await transaction.get(seatReference), id);
        if (seat.memberUid !== null)
          throw new CloudError(
            409,
            'seat-already-joined',
            'This seat already belongs to an account; an invitation cannot replace its membership'
          );
        if (seat.activeInvitationId) {
          const previousReference = this.firestore
            .collection('campaignInvitations')
            .doc(seat.activeInvitationId);
          const previous = this._invitation(await transaction.get(previousReference));
          if (
            previous.campaignId !== id ||
            previous.seatId !== invitation.seatId ||
            previous.redeemedByUid !== null
          )
            throw invalidMembership();
          if (previous.revokedAt === null) revoke = previousReference;
        }
      }
      if (revoke) transaction.update(revoke, { revokedAt: createdAt });
      if (options.seatId === null)
        transaction.create(seatReference, {
          version: 1,
          id: invitation.seatId,
          campaignId: id,
          name: options.name.trim(),
          memberUid: null,
          characterIds: [],
          createdAt,
          activeInvitationId: invitation.id,
        });
      else
        transaction.update(seatReference, {
          name: options.name.trim(),
          activeInvitationId: invitation.id,
        });
      transaction.create(this.firestore.collection('campaignInvitations').doc(invitation.id), {
        ...invitation,
        createdByUid: uid,
        tokenHash: options.tokenHash,
        redeemedByUid: null,
        redeemedAt: null,
        revokedAt: null,
      });
      transaction.create(reference, {
        version: 1,
        uid,
        kind: 'campaign.invite',
        fingerprint,
        campaignId: id,
        result: invitation,
      });
      return invitation;
    });
  }

  async listSeats(principal, id) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const headReference = this.firestore.collection('campaigns').doc(id);
        await this._metadata(await transaction.get(headReference), uid);
        const snapshots = await transaction.get(headReference.collection('seats'));
        const result = [];
        for (const snapshot of snapshots.docs) {
          const seat = this._seat(snapshot, id);
          let invitation = null;
          if (seat.activeInvitationId) {
            const active = this._invitation(
              await transaction.get(
                this.firestore.collection('campaignInvitations').doc(seat.activeInvitationId)
              )
            );
            if (
              seat.memberUid !== null ||
              active.campaignId !== id ||
              active.seatId !== seat.id ||
              active.redeemedByUid !== null
            )
              throw invalidMembership();
            invitation = {
              version: 1,
              id: active.id,
              campaignId: id,
              seatId: seat.id,
              createdAt: active.createdAt,
              expiresAt: active.expiresAt,
              status:
                active.revokedAt !== null
                  ? 'revoked'
                  : Date.parse(active.expiresAt) <= this.now()
                    ? 'expired'
                    : 'pending',
            };
          }
          result.push({
            version: 2,
            id: seat.id,
            accessGeneration: seatAccessGeneration(seat),
            name: seat.name,
            characterIds: [...seat.characterIds],
            joined: seat.memberUid !== null,
            invitation,
          });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      },
      { readOnly: true }
    );
  }

  async revokeInvitation(principal, id, command) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some((key) => !['commandId', 'invitationId'].includes(key)) ||
      !isCloudUUID(command.commandId) ||
      !isCloudUUID(command.invitationId)
    )
      throw new CloudError(
        400,
        'invalid-invitation-request',
        'Choose an explicit unused invitation to revoke'
      );
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind: 'campaign.invite.revoke',
          campaignId: id,
          invitationId: command.invitationId,
        })
      )
      .digest('hex');
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, {
        uid,
        reference,
        fingerprint,
        kind: 'campaign.invite.revoke',
        campaignId: id,
      });
      if (replay !== null) return replay;
      const headReference = this.firestore.collection('campaigns').doc(id);
      await this._metadata(await transaction.get(headReference), uid);
      const invitationReference = this.firestore
        .collection('campaignInvitations')
        .doc(command.invitationId);
      const invitation = this._invitation(await transaction.get(invitationReference));
      if (invitation.campaignId !== id) throw unavailableInvitation();
      if (invitation.redeemedByUid !== null)
        throw new CloudError(
          409,
          'invitation-already-accepted',
          'This invitation has been accepted; revoking a link does not remove a player'
        );
      const seatReference = headReference.collection('seats').doc(invitation.seatId);
      const seat = this._seat(await transaction.get(seatReference), id);
      const revokedAt = invitation.revokedAt ?? new Date(this.now()).toISOString();
      const result = { version: 1, invitationId: invitation.id, revokedAt };
      transaction.update(invitationReference, { revokedAt });
      if (seat.activeInvitationId === invitation.id)
        transaction.update(seatReference, { activeInvitationId: null });
      transaction.create(reference, {
        version: 1,
        uid,
        kind: 'campaign.invite.revoke',
        fingerprint,
        campaignId: id,
        result,
      });
      return result;
    });
  }

  _invitation(snapshot) {
    if (!snapshot.exists) throw unavailableInvitation();
    const value = snapshot.data();
    const projection = {
      version: value?.version,
      id: value?.id,
      campaignId: value?.campaignId,
      seatId: value?.seatId,
      createdAt: value?.createdAt,
      expiresAt: value?.expiresAt,
    };
    if (
      !isCloudInvitation(projection) ||
      value.id !== snapshot.id ||
      !validUid(value.createdByUid) ||
      !isCloudDigest(value.tokenHash) ||
      (value.redeemedByUid === null
        ? value.redeemedAt !== null
        : !validUid(value.redeemedByUid) || !validTime(value.redeemedAt)) ||
      (value.revokedAt !== null && !validTime(value.revokedAt)) ||
      Object.keys(value).some(
        (key) =>
          ![
            ...Object.keys(projection),
            'createdByUid',
            'tokenHash',
            'redeemedByUid',
            'redeemedAt',
            'revokedAt',
          ].includes(key)
      )
    )
      throw new CloudError(
        503,
        'invalid-invitation-record',
        'Invitation data could not be verified'
      );
    return value;
  }

  async grantPlacement(principal, id, command) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).length !== 5 ||
      Object.keys(command).some(
        (key) =>
          !['commandId', 'seatId', 'accessGeneration', 'characterId', 'destination'].includes(key)
      ) ||
      !isCloudUUID(command.commandId) ||
      !isCloudUUID(command.seatId) ||
      !isCloudAccessGeneration(command.accessGeneration) ||
      typeof command.characterId !== 'string' ||
      !command.characterId ||
      !isCloudPlacementDestination(command.destination)
    )
      throw new CloudError(
        400,
        'invalid-placement',
        'Choose an assigned character and explicit arrival cell'
      );
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind: 'campaign.arrival',
          campaignId: id,
          ...command,
        })
      )
      .digest('hex');
    const intent = { uid, reference, fingerprint, kind: 'campaign.arrival', campaignId: id };
    const headReference = this.firestore.collection('campaigns').doc(id);
    const seatReference = headReference.collection('seats').doc(command.seatId);
    const requireSeat = async (transaction) => {
      const seat = this._seat(await transaction.get(seatReference), id);
      if (seatAccessGeneration(seat) !== command.accessGeneration)
        throw new CloudError(
          409,
          'campaign-access-changed',
          'Refresh current player access before granting arrival'
        );
      if (!seat.characterIds.includes(command.characterId))
        throw new CloudError(
          403,
          'placement-forbidden',
          'Arrival requires this seat to control the saved character'
        );
      return seat;
    };
    const captured = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return { replay };
        const head = await this._metadata(await transaction.get(headReference), uid);
        await requireSeat(transaction);
        return { replay: null, head };
      },
      { readOnly: true }
    );
    if (captured.replay !== null) return captured.replay;
    if (!this.resources)
      throw new CloudError(
        503,
        'resource-catalog-unavailable',
        'Arrival validation requires current campaign resources'
      );
    const state = await this._loadSnapshot(captured.head);
    if (state.scene === null)
      throw new CloudError(
        409,
        'world-not-ready',
        'Save the campaign board before granting arrival'
      );
    const library = new CampaignCharacters({
      ...state,
      catalog: await this.resources.catalog(state.campaign),
    });
    const scene = decodeScene(state.scene, { library, ruleset: state.campaign.ruleset });
    const { validatePlayerArrival } = require('../../src/campaigns/ServerGameplay.js');
    try {
      validatePlayerArrival(scene, library, command.characterId, command.destination);
    } catch (error) {
      if (error.code === 'invalid-placement')
        throw new CloudError(error.status, error.code, error.message);
      throw error;
    }
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, intent);
      if (replay !== null) return replay;
      const head = await this._metadata(await transaction.get(headReference), uid);
      const seat = await requireSeat(transaction);
      if (head.generation !== captured.head.generation)
        throw new CloudError(
          409,
          'revision-conflict',
          'The arrival board changed. Refresh before granting again'
        );
      const generation = head.generation + 1;
      if (!isCloudAccessGeneration(generation))
        throw new CloudError(
          503,
          'invalid-campaign-head',
          'The campaign generation cannot advance'
        );
      const grant = {
        id: command.commandId,
        characterId: command.characterId,
        ...command.destination,
      };
      const result = {
        version: 1,
        campaignId: id,
        seatId: command.seatId,
        accessGeneration: command.accessGeneration,
        generation,
        grant,
      };
      const next = {
        ...head,
        generation,
        lastCommand: {
          uid,
          commandId: command.commandId,
          kind: 'campaign.arrival',
          generation,
        },
      };
      delete next.presentationRef;
      transaction.update(seatReference, {
        placementGrants: [
          ...(seat.placementGrants || []).filter(
            (entry) => entry.characterId !== command.characterId
          ),
          grant,
        ],
      });
      transaction.set(headReference, next);
      transaction.create(reference, {
        version: 1,
        uid,
        kind: intent.kind,
        fingerprint,
        campaignId: id,
        result,
      });
      const { FieldValue } = require('firebase-admin/firestore');
      transaction.create(headReference.collection('changes').doc(String(generation)), {
        version: 1,
        generation,
        kind: 'campaign.arrival',
        sceneRevision: state.sceneRevision,
        charactersRevision: state.revision,
        committedAt: FieldValue.serverTimestamp(),
      });
      return result;
    });
  }

  async assignCharacter(principal, id, command) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some(
        (key) =>
          !['commandId', 'seatId', 'characterId', 'assigned', 'accessGeneration'].includes(key)
      ) ||
      !isCloudUUID(command.commandId) ||
      !isCloudUUID(command.seatId) ||
      typeof command.characterId !== 'string' ||
      !command.characterId ||
      typeof command.assigned !== 'boolean' ||
      !isCloudAccessGeneration(command.accessGeneration)
    )
      throw new CloudError(
        400,
        'invalid-assignment-request',
        'Choose an explicit saved character, seat and current access generation'
      );
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind: 'campaign.character.assign',
          campaignId: id,
          seatId: command.seatId,
          characterId: command.characterId,
          assigned: command.assigned,
          accessGeneration: command.accessGeneration,
        })
      )
      .digest('hex');
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    const replayResult = (result) => {
      if (
        result.seatId !== command.seatId ||
        result.accessGeneration !== command.accessGeneration + Number(result.changed) ||
        result.characterIds.includes(command.characterId) !== command.assigned
      )
        throw new CloudError(
          503,
          'invalid-command-receipt',
          'The durable command receipt is invalid'
        );
      return result;
    };
    const headReference = this.firestore.collection('campaigns').doc(id);
    const captured = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, {
          uid,
          reference,
          fingerprint,
          kind: 'campaign.character.assign',
          campaignId: id,
        });
        return replay === null
          ? { replay: null, head: await this._metadata(await transaction.get(headReference), uid) }
          : { replay, head: null };
      },
      { readOnly: true }
    );
    if (captured.replay !== null) return replayResult(captured.replay);
    if (command.assigned) {
      const state = await this._loadSnapshot(captured.head);
      if (typeof this.resources?.catalog !== 'function')
        throw new CloudError(
          503,
          'resource-catalog-unavailable',
          'The pinned campaign resource catalog is unavailable'
        );
      let catalog;
      try {
        catalog = await this.resources.catalog(state.campaign);
      } catch (error) {
        if (
          error?.constructor === Error ||
          error instanceof SyntaxError ||
          ['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)
        )
          throw new CloudError(
            503,
            'resource-catalog-unavailable',
            'The pinned campaign resource catalog is unavailable'
          );
        throw error;
      }
      let roster;
      try {
        roster = campaignCharacterRoster(state.campaign, catalog, state.records);
      } catch (error) {
        if (error?.constructor === Error || error instanceof SyntaxError)
          throw new CloudError(
            503,
            'invalid-character-snapshot',
            'Campaign character records could not be verified'
          );
        throw error;
      }
      if (!roster.some((character) => character.id === command.characterId))
        throw new CloudError(
          400,
          'unknown-assignment-character',
          'Choose a saved character from this campaign'
        );
    }
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, {
        uid,
        reference,
        fingerprint,
        kind: 'campaign.character.assign',
        campaignId: id,
      });
      if (replay !== null) return replayResult(replay);
      const current = await this._metadata(await transaction.get(headReference), uid);
      if (command.assigned && current.generation !== captured.head.generation)
        throw new CloudError(
          409,
          'revision-conflict',
          'Campaign characters changed. Refresh before assigning.'
        );
      const seatReference = headReference.collection('seats').doc(command.seatId);
      const seat = this._seat(await transaction.get(seatReference), id);
      const generation = seatAccessGeneration(seat);
      if (generation !== command.accessGeneration)
        throw new CloudError(
          409,
          'campaign-access-changed',
          'Campaign access changed. Refresh before continuing.'
        );
      if (seat.memberUid !== null) {
        const grant = await this._accessSummary(transaction, seat.memberUid, id);
        if (grant.role !== 'member' || grant.seatId !== seat.id) throw invalidMembership();
      }
      const changed = seat.characterIds.includes(command.characterId) !== command.assigned;
      const accessGeneration = generation + Number(changed);
      if (!isCloudAccessGeneration(accessGeneration))
        throw new CloudError(
          409,
          'access-generation-exhausted',
          'Campaign access generation cannot advance'
        );
      const characterIds = command.assigned
        ? changed
          ? [...seat.characterIds, command.characterId]
          : [...seat.characterIds]
        : seat.characterIds.filter((characterId) => characterId !== command.characterId);
      const result = { version: 1, seatId: seat.id, characterIds, accessGeneration, changed };
      if (changed) {
        transaction.set(seatReference, {
          ...seat,
          version: 2,
          activeInvitationId: seat.activeInvitationId ?? null,
          characterIds,
          accessGeneration,
          ...(seat.placementGrants === undefined ? {} : { placementGrants: [] }),
        });
        if (seat.memberUid !== null)
          transaction.update(this._memberships(seat.memberUid).doc(id), {
            version: 2,
            accessGeneration,
          });
      }
      transaction.create(reference, {
        version: 1,
        uid,
        kind: 'campaign.character.assign',
        fingerprint,
        campaignId: id,
        result,
      });
      return result;
    });
  }

  async removeMember(principal, id, command) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some(
        (key) => !['commandId', 'seatId', 'accessGeneration'].includes(key)
      ) ||
      !isCloudUUID(command.commandId) ||
      !isCloudUUID(command.seatId) ||
      !isCloudAccessGeneration(command.accessGeneration)
    )
      throw new CloudError(
        400,
        'invalid-member-request',
        'Choose an explicit joined seat and its current access generation'
      );
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind: 'campaign.member.remove',
          campaignId: id,
          seatId: command.seatId,
          accessGeneration: command.accessGeneration,
        })
      )
      .digest('hex');
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    const removedAt = new Date(this.now()).toISOString();
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, {
        uid,
        reference,
        fingerprint,
        kind: 'campaign.member.remove',
        campaignId: id,
      });
      if (replay !== null) {
        if (
          replay.seatId !== command.seatId ||
          replay.accessGeneration !== command.accessGeneration + 1
        )
          throw new CloudError(
            503,
            'invalid-command-receipt',
            'The durable command receipt is invalid'
          );
        return replay;
      }
      const headReference = this.firestore.collection('campaigns').doc(id);
      await this._metadata(await transaction.get(headReference), uid);
      const seatReference = headReference.collection('seats').doc(command.seatId);
      const seat = this._seat(await transaction.get(seatReference), id);
      const generation = seatAccessGeneration(seat);
      if (generation !== command.accessGeneration)
        throw new CloudError(
          409,
          'campaign-access-changed',
          'Campaign access changed. Refresh before continuing.'
        );
      if (seat.memberUid === null)
        throw new CloudError(
          409,
          'seat-not-joined',
          'This seat does not have a joined player to remove'
        );
      if (generation >= Number.MAX_SAFE_INTEGER)
        throw new CloudError(
          409,
          'access-generation-exhausted',
          'Campaign access generation cannot advance'
        );
      const current = await this._accessSummary(transaction, seat.memberUid, id);
      if (current.role !== 'member' || current.seatId !== seat.id) throw invalidMembership();
      const accessGeneration = generation + 1;
      const result = { version: 1, seatId: seat.id, accessGeneration, removedAt };
      transaction.set(seatReference, {
        ...seat,
        version: 2,
        memberUid: null,
        activeInvitationId: null,
        accessGeneration,
        ...(seat.placementGrants === undefined ? {} : { placementGrants: [] }),
      });
      transaction.delete(this._memberships(seat.memberUid).doc(id));
      transaction.create(reference, {
        version: 1,
        uid,
        kind: 'campaign.member.remove',
        fingerprint,
        campaignId: id,
        result,
      });
      return result;
    });
  }

  _seat(snapshot, campaignId) {
    if (!snapshot.exists) throw unavailableCampaign();
    const player = snapshot.data();
    if (
      ![1, 2].includes(player?.version) ||
      (player.version === 1
        ? Object.hasOwn(player, 'accessGeneration')
        : !isCloudAccessGeneration(player.accessGeneration) ||
          player.accessGeneration === 0 ||
          !Object.hasOwn(player, 'activeInvitationId')) ||
      player.id !== snapshot.id ||
      player.campaignId !== campaignId ||
      typeof player.name !== 'string' ||
      !player.name.trim() ||
      player.name.length > 80 ||
      !validTime(player.createdAt) ||
      (player.memberUid !== null && !validUid(player.memberUid)) ||
      !Array.isArray(player.characterIds) ||
      player.characterIds.some((characterId) => typeof characterId !== 'string' || !characterId) ||
      new Set(player.characterIds).size !== player.characterIds.length ||
      (player.placementGrants !== undefined &&
        (!Array.isArray(player.placementGrants) ||
          player.placementGrants.some(
            (grant) =>
              !isCloudPlacementGrant(grant) || !player.characterIds.includes(grant.characterId)
          ) ||
          new Set(player.placementGrants.map((grant) => grant.characterId)).size !==
            player.placementGrants.length ||
          new Set(player.placementGrants.map((grant) => grant.id)).size !==
            player.placementGrants.length)) ||
      (Object.hasOwn(player, 'activeInvitationId') &&
        player.activeInvitationId !== null &&
        !isCloudUUID(player.activeInvitationId)) ||
      (player.memberUid !== null &&
        player.activeInvitationId !== undefined &&
        player.activeInvitationId !== null) ||
      Object.keys(player).some(
        (key) =>
          ![
            'version',
            'id',
            'campaignId',
            'name',
            'memberUid',
            'characterIds',
            'createdAt',
            'activeInvitationId',
            'accessGeneration',
            'placementGrants',
          ].includes(key)
      )
    )
      throw invalidMembership();
    return player;
  }

  async redeemInvitation(principal, command) {
    const uid = principalUid(principal);
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some((key) => !['commandId', 'invitationId', 'secret'].includes(key)) ||
      !isCloudUUID(command.commandId) ||
      !isCloudUUID(command.invitationId) ||
      !isCloudDigest(command.secret)
    )
      throw new CloudError(
        400,
        'invalid-invitation-request',
        'Choose an explicit private invitation and command ID'
      );
    const tokenHash = createHash('sha256').update(command.secret).digest('hex');
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind: 'campaign.join',
          invitationId: command.invitationId,
          tokenHash,
        })
      )
      .digest('hex');
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    const invitationReference = this.firestore
      .collection('campaignInvitations')
      .doc(command.invitationId);
    return this._transaction(async (transaction) => {
      const enabled = await this.access.assertInvitationEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, {
        uid,
        reference,
        fingerprint,
        kind: 'campaign.join',
      });
      if (replay !== null) return replay;
      const invitation = this._invitation(await transaction.get(invitationReference));
      const now = this.now();
      if (
        !timingSafeEqual(Buffer.from(invitation.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex')) ||
        invitation.revokedAt !== null ||
        invitation.redeemedByUid !== null ||
        Date.parse(invitation.expiresAt) <= now ||
        Date.parse(invitation.createdAt) > now ||
        invitation.createdByUid === uid
      )
        throw unavailableInvitation();
      const headReference = this.firestore.collection('campaigns').doc(invitation.campaignId);
      const head = await this._metadata(
        await transaction.get(headReference),
        invitation.createdByUid
      );
      await this.access.assertEligibility(head.ownerUid, transaction);
      const seatReference = headReference.collection('seats').doc(invitation.seatId);
      const seat = this._seat(await transaction.get(seatReference), invitation.campaignId);
      if (seat.memberUid !== null || seat.activeInvitationId !== invitation.id)
        throw unavailableInvitation();
      const membershipReference = this._memberships(uid).doc(invitation.campaignId);
      if ((await transaction.get(membershipReference)).exists)
        throw new CloudError(
          409,
          'campaign-already-joined',
          'This account has already joined the campaign through another seat'
        );
      const joinedAt = new Date(now).toISOString();
      const accessGeneration = seatAccessGeneration(seat) + 1;
      if (!isCloudAccessGeneration(accessGeneration))
        throw new CloudError(
          409,
          'access-generation-exhausted',
          'Campaign access generation cannot advance'
        );
      const result = {
        version: 1,
        invitationId: invitation.id,
        access: accessSummary(head, 'member', invitation.seatId),
      };
      if (!enabled)
        transaction.create(this.firestore.collection('pilotAccounts').doc(pilotAccountKey(uid)), {
          version: 1,
          uid,
          enabled: true,
        });
      transaction.update(seatReference, {
        version: 2,
        memberUid: uid,
        activeInvitationId: null,
        accessGeneration,
      });
      transaction.update(invitationReference, { redeemedByUid: uid, redeemedAt: joinedAt });
      transaction.create(membershipReference, {
        version: 2,
        uid,
        campaignId: invitation.campaignId,
        seatId: invitation.seatId,
        joinedAt,
        accessGeneration,
      });
      transaction.create(reference, {
        version: 1,
        uid,
        kind: 'campaign.join',
        fingerprint,
        campaignId: invitation.campaignId,
        result,
      });
      return result;
    });
  }

  _memberships(uid) {
    return this.firestore
      .collection('campaignMemberships')
      .doc(pilotAccountKey(uid))
      .collection('campaigns');
  }

  async _accessGrant(transaction, uid, id, expected = null) {
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const reference = this.firestore.collection('campaigns').doc(id);
    const membershipReference = this._memberships(uid).doc(id);
    // Expected scope only batches reads; stored records still determine the grant.
    const [snapshot, savedMembership, savedSeat] = expected?.seatId
      ? await transaction.getAll(
          reference,
          membershipReference,
          reference.collection('seats').doc(expected.seatId)
        )
      : [await transaction.get(reference), null, null];
    if (!snapshot.exists) throw unavailableCampaign();
    const ownerUid = snapshot.data()?.ownerUid;
    if (ownerUid === uid)
      return participantSummary(uid, accessSummary(await this._metadata(snapshot, uid), 'owner'));
    const membership = savedMembership ?? (await transaction.get(membershipReference));
    if (!membership.exists) throw unavailableCampaign();
    const record = membership.data();
    if (
      ![1, 2].includes(record?.version) ||
      (record.version === 1
        ? Object.hasOwn(record, 'accessGeneration')
        : !isCloudAccessGeneration(record.accessGeneration) || record.accessGeneration === 0) ||
      record.uid !== uid ||
      record.campaignId !== id ||
      !isCloudUUID(record.seatId) ||
      !validTime(record.joinedAt) ||
      Object.keys(record).some(
        (key) =>
          !['version', 'uid', 'campaignId', 'seatId', 'joinedAt', 'accessGeneration'].includes(key)
      )
    )
      throw invalidMembership();
    const seat =
      savedSeat?.id === record.seatId
        ? savedSeat
        : await transaction.get(snapshot.ref.collection('seats').doc(record.seatId));
    const player = this._seat(seat, id);
    if (player.memberUid !== uid) throw unavailableCampaign();
    if (
      player.version !== record.version ||
      (player.version === 2 && player.accessGeneration !== record.accessGeneration)
    )
      throw invalidMembership();
    if (!validUid(ownerUid)) throw invalidMembership();
    return participantSummary(
      uid,
      accessSummary(await this._metadata(snapshot, ownerUid), 'member', record.seatId),
      player
    );
  }

  async _accessSummary(transaction, uid, id) {
    const grant = await this._accessGrant(transaction, uid, id);
    return {
      version: 1,
      campaign: grant.campaign,
      role: grant.access.role,
      seatId: grant.access.seatId,
    };
  }

  async getAccess(principal, id) {
    const uid = principalUid(principal);
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        return this._accessSummary(transaction, uid, id);
      },
      { readOnly: true }
    );
  }

  _accessExpectation(expected) {
    if (
      expected !== null &&
      (!expected ||
        typeof expected !== 'object' ||
        Array.isArray(expected) ||
        Object.keys(expected).length !== 2 ||
        Object.keys(expected).some((key) => !['seatId', 'accessGeneration'].includes(key)) ||
        (expected.seatId !== null && !isCloudUUID(expected.seatId)) ||
        !isCloudAccessGeneration(expected.accessGeneration))
    )
      throw new CloudError(
        400,
        'invalid-access-scope',
        'Choose the explicit campaign access scope'
      );
    return expected === null ? null : structuredClone(expected);
  }

  async _participantGrant(transaction, uid, id, expected) {
    await this.access.assertEligibility(uid, transaction);
    const grant = await this._accessGrant(transaction, uid, id, expected);
    if (
      expected !== null &&
      (expected.seatId !== grant.access.seatId ||
        expected.accessGeneration !== grant.access.accessGeneration)
    )
      throw new CloudError(
        409,
        'campaign-access-changed',
        'Campaign access changed. Refresh before continuing.'
      );
    return grant;
  }

  async getParticipantAccess(principal, id, expected = null) {
    const uid = principalUid(principal);
    const scope = this._accessExpectation(expected);
    return this._transaction((transaction) => this._participantGrant(transaction, uid, id, scope), {
      readOnly: true,
    });
  }

  async readAssignedCharacters(principal, id, expected) {
    const uid = principalUid(principal);
    const scope = this._accessExpectation(expected);
    if (scope === null || scope.seatId === null)
      throw new CloudError(400, 'invalid-access-scope', 'Choose explicit current player access.');
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const reference = this.firestore.collection('campaigns').doc(id);
    const captured = await this._transaction(
      async (transaction) => {
        const grant = await this._participantGrant(transaction, uid, id, scope);
        if (grant.access.role !== 'member') throw unavailableCampaign();
        const snapshot = await transaction.get(reference);
        const head = await this._metadata(snapshot, snapshot.data().ownerUid);
        return { head, grant };
      },
      { readOnly: true }
    );
    const campaign = captured.head.campaign;
    let records;
    try {
      if (!this.resources || (captured.head.charactersRef !== null && !this.objects))
        throw new Error('Assigned character storage is unavailable');
      records =
        captured.head.charactersRef === null
          ? []
          : await this.objects.read(id, 'characters', captured.head.charactersRef);
      const catalog = await this.resources.catalog(campaign);
      const known = new Set(
        campaignCharacterRoster(campaign, catalog, records).map((row) => row.id)
      );
      if (captured.grant.characterIds.some((characterId) => !known.has(characterId)))
        throw invalidMembership();
    } catch (error) {
      if (
        error?.constructor === Error ||
        error instanceof SyntaxError ||
        ['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)
      )
        throw new CloudError(
          503,
          'invalid-assigned-state',
          'Assigned character data could not be verified'
        );
      throw error;
    }
    await this._transaction(
      async (transaction) => {
        const current = await this._participantGrant(transaction, uid, id, scope);
        if (
          current.access.role !== 'member' ||
          stableStringify(current.characterIds) !== stableStringify(captured.grant.characterIds)
        )
          throw new CloudError(
            409,
            'campaign-access-changed',
            'Assigned characters changed while reading.'
          );
        const head = await transaction.get(reference);
        if (head.data()?.generation !== captured.head.generation)
          throw new CloudError(
            409,
            'assigned-state-changed',
            'Campaign data changed while reading assigned sheets.'
          );
      },
      { readOnly: true }
    );
    const selected = new Set(captured.grant.characterIds);
    return {
      version: 1,
      access: captured.grant.access,
      characterIds: [...selected],
      campaign: participantCampaign(campaign),
      revision: campaign.charactersRevision,
      records: records
        .filter((row) => selected.has(campaignRecordCharacterId(row.key)))
        .map(({ key, value }) => ({ key, value })),
      scene: null,
      sceneRevision: campaign.sceneRevision,
      sceneSavedAt: campaign.sceneSavedAt,
    };
  }

  readParticipantSnapshot(principal, id, command, expected) {
    return this._participantSnapshot(principal, id, command, expected, (head) =>
      this._loadSnapshot(head)
    );
  }

  async _participantSnapshot(principal, id, command, expected, loadSnapshot) {
    const scope = this._accessExpectation(expected);
    if (scope === null || scope.seatId === null || !isCloudParticipantRequest(command))
      throw new CloudError(
        400,
        'invalid-participant-request',
        'Choose an explicit current live session, assigned observer and authorized view'
      );
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const input = structuredClone(command);
    await this.getLiveSession(principal, id);
    const reference = this.firestore.collection('campaigns').doc(id);
    const captured = await this._transaction(
      async (transaction) => {
        const admission = await this.requireLiveSession(
          transaction,
          principal,
          id,
          input.sessionId,
          scope
        );
        if (admission.participant.access.role !== 'member') throw unavailableCampaign();
        const snapshot = await transaction.get(reference);
        const head = await this._metadata(snapshot, snapshot.data().ownerUid);
        const seat = this._seat(
          await transaction.get(reference.collection('seats').doc(scope.seatId)),
          id
        );
        return {
          head,
          participant: admission.participant,
          placementGrants: seat.placementGrants || [],
        };
      },
      { readOnly: true }
    );
    if (!this.resources)
      throw new CloudError(503, 'cloud-save-unavailable', 'Participant resources are unavailable');
    // Head listeners can fire before committed transient receipts are installed.
    const pending = this.worldOperations.get(
      stableStringify([id, captured.head.lastCommand?.uid, captured.head.lastCommand?.commandId])
    );
    if (pending) await pending.promise;
    const saved = await loadSnapshot(captured.head);
    const { participantState } = require('./participant-state.js');
    const projected = await participantState({
      state: saved,
      catalog: await this.resources.catalog(saved.campaign),
      campaign: participantCampaign(saved.campaign),
      characterIds: captured.participant.characterIds,
      options: input,
      placementGrants: captured.placementGrants,
      images: this._imageEntries(saved.records),
      undo: playerUndoFor(
        this.worldUndoSessions,
        this._worldUndoProfile(principal, id, input.sessionId, captured.participant),
        saved
      ),
    });
    const images = [];
    for (const slot of projected.imageSlots) {
      const snapshot = await reference.collection('assets').doc(slot.sha256).get();
      const asset = snapshot.data();
      if (
        asset?.version !== 1 ||
        asset.campaignId !== id ||
        !isPrivateAssetReference(asset.reference, id) ||
        asset.reference.sha256 !== slot.sha256 ||
        asset.reference.mimeType !== slot.mimeType
      )
        throw new CloudError(
          503,
          'invalid-asset-record',
          'The authorized image metadata could not be verified'
        );
      const { source, id: slotId, field } = slot;
      images.push({ source, id: slotId, field, reference: structuredClone(asset.reference) });
    }
    await this._verifyParticipantRead(principal, id, input.sessionId, scope, {
      generation: captured.head.generation,
      characterIds: captured.participant.characterIds,
    });
    const checkpoint = {
      version: 1,
      access: captured.participant.access,
      sessionId: input.sessionId,
      generation: captured.head.generation,
      viewKey: createHash('sha256')
        .update(
          stableStringify({
            access: captured.participant.access,
            sessionId: input.sessionId,
            characterIds: captured.participant.characterIds,
            observerTokenId: projected.state.observerTokenId,
            presentation: projected.state.publicScene.presentation,
            ...(projected.state.arrival ? { arrival: projected.state.arrival } : {}),
            assetKey: projected.state.publicScene.assetKey,
            actors: projected.state.publicScene.actors.map((actor) => actor.id).sort(),
            images,
          })
        )
        .digest('hex'),
      state: projected.state,
      manifest: { version: 1, images },
    };
    const {
      validateCloudParticipantSnapshot,
    } = require('../../src/campaigns/CloudParticipantProtocol.js');
    try {
      validateCloudParticipantSnapshot(checkpoint, { cachedAssets: projected.assets });
    } catch (error) {
      if (
        ['invalid-cloud-participant', 'invalid-player-state'].includes(error?.code) ||
        error?.constructor === Error ||
        error instanceof SyntaxError
      )
        throw new CloudError(
          503,
          'invalid-participant-state',
          'The authorized participant checkpoint could not be verified'
        );
      throw error;
    }
    return checkpoint;
  }

  async _readLivePresentations(head) {
    if (head.presentationRef === undefined || head.presentationRef === null) return null;
    if (this.objects === null)
      throw new CloudError(
        503,
        'cloud-save-unavailable',
        'Private live movement storage is unavailable'
      );
    const value = await this.objects.read(head.campaign.id, 'presentations', head.presentationRef);
    const fields = [
      'version',
      'campaignId',
      'generation',
      'sessionId',
      'sceneRevision',
      'charactersRevision',
      'entries',
    ];
    const invalid = () =>
      new CloudError(
        503,
        'invalid-scene-presentation',
        'Committed live movement metadata could not be verified'
      );
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== fields.length ||
      fields.some((field) => !Object.hasOwn(value, field)) ||
      value.version !== 1 ||
      value.campaignId !== head.campaign.id ||
      value.generation !== head.generation ||
      !isCloudUUID(value.sessionId) ||
      value.sceneRevision !== head.campaign.sceneRevision ||
      value.charactersRevision !== head.campaign.charactersRevision ||
      !Array.isArray(value.entries) ||
      value.entries.length > 256 ||
      new Set(value.entries.map((entry) => entry?.commandId)).size !== value.entries.length
    )
      throw invalid();
    const {
      validatePlayerMotion,
      validateBudget,
    } = require('../../src/campaigns/PlayerPublicProtocol.js');
    const { PLAYER_COMMAND_KINDS } = require('../../src/campaigns/PlayerCommandProtocol.js');
    for (const entry of value.entries) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.keys(entry).some(
          (field) =>
            !['commandId', 'tokenId', 'kind', 'motion', 'costFeet', 'budget'].includes(field)
        ) ||
        ['commandId', 'tokenId', 'kind', 'motion'].some((field) => !Object.hasOwn(entry, field)) ||
        typeof entry.commandId !== 'string' ||
        !/^[a-zA-Z0-9_-]{8,100}$/.test(entry.commandId) ||
        typeof entry.tokenId !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(entry.tokenId) ||
        !PLAYER_COMMAND_KINDS.includes(entry.kind) ||
        (entry.costFeet !== undefined && (!Number.isFinite(entry.costFeet) || entry.costFeet < 0))
      )
        throw invalid();
      try {
        validatePlayerMotion(entry.motion);
        if (entry.budget !== undefined) validateBudget(entry.budget);
      } catch (error) {
        if (['invalid-player-state', 'invalid-saved-placement'].includes(error.code))
          throw invalid();
        throw error;
      }
    }
    return value;
  }

  async _participantPresentations(principal, id, command, scope, previous, next, frame) {
    if (!frame || frame.head.generation !== next.generation)
      throw new CloudError(409, 'participant-state-changed', 'The live movement frame changed');
    frame.presentations ??= this._readLivePresentations(frame.head);
    const packet = await frame.presentations;
    if (packet === null || packet.sessionId !== command.sessionId) return [];
    const saved = await frame.promise;
    const catalog = await this.resources.catalog(saved.campaign);
    const library = new CampaignCharacters({ ...saved, catalog });
    const scene = decodeScene(saved.scene, { library, ruleset: saved.campaign.ruleset });
    const presentations = await visibleMovementPresentations({
      root: path.resolve(__dirname, '..', '..'),
      scene,
      library,
      view: next.state,
      updates: packet.entries.map((entry) => ({
        ...structuredClone(entry),
        sceneRevision: packet.sceneRevision,
        charactersRevision: packet.charactersRevision,
      })),
      state: saved,
      sinceSceneRevision: previous.state.sceneRevision,
    });
    await this._verifyParticipantRead(principal, id, command.sessionId, scope, {
      generation: next.generation,
      characterIds: next.state.characterIds,
    });
    return presentations;
  }

  async _verifyParticipantRead(principal, id, sessionId, scope, expected) {
    await this._transaction(
      async (transaction) => {
        const current = await this.requireLiveSession(transaction, principal, id, sessionId, scope);
        if (
          current.participant.access.role !== 'member' ||
          stableStringify(current.participant.characterIds) !==
            stableStringify(expected.characterIds)
        )
          throw new CloudError(409, 'campaign-access-changed', 'Refresh current assigned access');
        const head = await transaction.get(this.firestore.collection('campaigns').doc(id));
        if (head.data()?.generation !== expected.generation)
          throw new CloudError(
            409,
            'participant-state-changed',
            'The authorized world changed while preparing participant data'
          );
      },
      { readOnly: true }
    );
  }

  observeParticipant(principal, id, command, expected, callbacks) {
    const { ParticipantChanges } = require('./participant-changes.js');
    this.participantChanges ??= new ParticipantChanges(this);
    return this.participantChanges.subscribe(principal, id, command, expected, callbacks);
  }

  observeOwnerWorld(principal, id, command, expected, callbacks) {
    if (!isCloudOwnerWorldRequest(command))
      throw new CloudError(
        400,
        'invalid-participant-request',
        'Choose the active owner world epoch'
      );
    const { ParticipantChanges } = require('./participant-changes.js');
    this.participantChanges ??= new ParticipantChanges(this);
    return this.participantChanges.subscribe(
      principal,
      id,
      {
        sessionId: command.sessionId,
        observerTokenId: null,
        mapId: null,
        assetKey: null,
      },
      expected,
      callbacks,
      true
    );
  }

  readOwnerWorldSnapshot(principal, id, command, expected) {
    return this._ownerWorldSnapshot(principal, id, command, expected, (head) =>
      this._loadSnapshot(head)
    );
  }

  async _ownerWorldSnapshot(principal, id, command, expected, loadSnapshot) {
    const uid = principalUid(principal);
    const scope = this._accessExpectation(expected);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (!scope || scope.seatId !== null || !isCloudOwnerWorldRequest(command))
      throw new CloudError(
        400,
        'invalid-access-scope',
        'Choose current live campaign owner access'
      );
    await this.getLiveSession(principal, id);
    const captured = await this._transaction(
      async (transaction) => {
        const admission = await this.requireLiveSession(
          transaction,
          principal,
          id,
          command.sessionId,
          scope
        );
        if (admission.participant.access.role !== 'owner') throw unavailableCampaign();
        const head = await this._metadata(
          await transaction.get(this.firestore.collection('campaigns').doc(id)),
          uid
        );
        return { head, access: admission.participant.access };
      },
      { readOnly: true }
    );
    const state = await loadSnapshot(captured.head);
    await this._verifyOwnerWorldRead(
      principal,
      id,
      command.sessionId,
      scope,
      captured.head.generation
    );
    const checkpoint = {
      version: 1,
      access: captured.access,
      sessionId: command.sessionId,
      generation: captured.head.generation,
      origin: captured.head.lastCommand ?? null,
      state,
    };
    const { validateCloudOwnerSnapshot } = require('../../src/campaigns/CloudOwnerProtocol.js');
    validateCloudOwnerSnapshot(checkpoint);
    return checkpoint;
  }

  async _verifyOwnerWorldRead(principal, id, sessionId, scope, generation) {
    const uid = principalUid(principal);
    return this._transaction(
      async (transaction) => {
        const current = await this.requireLiveSession(transaction, principal, id, sessionId, scope);
        if (current.participant.access.role !== 'owner') throw unavailableCampaign();
        const head = await transaction.get(this.firestore.collection('campaigns').doc(id));
        if (head.data()?.ownerUid !== uid) throw unavailableCampaign();
        if (head.data()?.generation !== generation)
          throw new CloudError(
            409,
            'participant-state-changed',
            'The owner world changed while loading'
          );
      },
      { readOnly: true }
    );
  }

  async _ownerWorldPresentations(principal, id, command, scope, previous, next, frame) {
    if (!frame || frame.head.generation !== next.generation)
      throw new CloudError(409, 'participant-state-changed', 'The owner movement frame changed');
    frame.presentations ??= this._readLivePresentations(frame.head);
    const packet = await frame.presentations;
    if (packet === null || packet.sessionId !== command.sessionId) return [];
    await this._verifyOwnerWorldRead(principal, id, command.sessionId, scope, next.generation);
    if (packet.sceneRevision <= previous.state.sceneRevision) return [];
    return packet.entries.map((entry) => ({
      ...structuredClone(entry),
      sceneRevision: packet.sceneRevision,
      charactersRevision: packet.charactersRevision,
    }));
  }

  async _ownerLiveHead(principal, id, command, expected) {
    const uid = principalUid(principal);
    const scope = this._accessExpectation(expected);
    if (!scope || scope.seatId !== null)
      throw new CloudError(400, 'invalid-access-scope', 'Choose current campaign owner access');
    return this._transaction(
      async (transaction) => {
        const admission = await this.requireLiveSession(
          transaction,
          principal,
          id,
          command.sessionId,
          scope
        );
        if (admission.participant.access.role !== 'owner') throw unavailableCampaign();
        const saved = await transaction.get(this.firestore.collection('campaigns').doc(id));
        const head = await this._metadata(saved, uid);
        return {
          kind: 'owner-head',
          version: 1,
          access: admission.participant.access,
          sessionId: command.sessionId,
          head: {
            generation: head.generation,
            charactersRevision: head.campaign.charactersRevision,
            sceneRevision: head.campaign.sceneRevision,
            sceneSavedAt: head.campaign.sceneSavedAt,
          },
        };
      },
      { readOnly: true }
    );
  }

  async _participantCommittedChanges(principal, id, command, scope, afterGeneration) {
    return this._transaction(
      async (transaction) => {
        const admission = await this.requireLiveSession(
          transaction,
          principal,
          id,
          command.sessionId,
          scope
        );
        if (admission.participant.access.role !== (scope.seatId === null ? 'owner' : 'member'))
          throw unavailableCampaign();
        const saved = await transaction.get(this.firestore.collection('campaigns').doc(id));
        const head = await this._metadata(saved, saved.data().ownerUid);
        return this._committedChanges(transaction, id, head, afterGeneration);
      },
      { readOnly: true }
    );
  }

  async readParticipantAsset(principal, id, sha256, command, expected) {
    const scope = this._accessExpectation(expected);
    if (!isCloudDigest(sha256) || !isCloudParticipantAssetRequest(command))
      throw new CloudError(
        400,
        'invalid-participant-request',
        'Choose an explicit image and its current authorized view'
      );
    const { viewKey, ...view } = structuredClone(command);
    const snapshot = await this.readParticipantSnapshot(principal, id, view, scope);
    if (snapshot.viewKey !== viewKey)
      throw new CloudError(
        409,
        'participant-view-changed',
        'The authorized view changed; refresh its manifest before loading images'
      );
    const image = snapshot.manifest.images.find((slot) => slot.reference.sha256 === sha256);
    if (!image)
      throw new CloudError(404, 'asset-not-found', 'This authorized image is unavailable');
    if (!this.assets)
      throw new CloudError(
        503,
        'asset-storage-unavailable',
        'Private image storage is unavailable'
      );
    const bytes = await this.assets.read(id, image.reference);
    await this._verifyParticipantRead(principal, id, snapshot.sessionId, scope, {
      generation: snapshot.generation,
      characterIds: snapshot.state.characterIds,
    });
    return { reference: image.reference, bytes };
  }

  async listAccess(principal) {
    const uid = principalUid(principal);
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const [campaigns, memberships] = await Promise.all([
          transaction.get(this.firestore.collection('campaigns').where('ownerUid', '==', uid)),
          transaction.get(this._memberships(uid)),
        ]);
        const owned = [];
        for (const snapshot of campaigns.docs)
          owned.push(accessSummary(await this._metadata(snapshot, uid), 'owner'));
        const joined = [];
        for (const membership of memberships.docs) {
          const entry = await this._accessSummary(transaction, uid, membership.id);
          if (entry.role !== 'member') throw invalidMembership();
          joined.push(entry);
        }
        const byName = (a, b) =>
          a.campaign.name.localeCompare(b.campaign.name) ||
          a.campaign.id.localeCompare(b.campaign.id);
        return { owned: owned.sort(byName), joined: joined.sort(byName) };
      },
      { readOnly: true }
    );
  }

  async _readHead(principal, id) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id))
      throw new CloudError(404, 'campaign-not-found', 'This private campaign is not available');
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        return this._metadata(
          await transaction.get(this.firestore.collection('campaigns').doc(id)),
          uid
        );
      },
      { readOnly: true }
    );
  }

  async _publishAsset(transaction, id, reference) {
    const assetReference = this.firestore
      .collection('campaigns')
      .doc(id)
      .collection('assets')
      .doc(reference.sha256);
    const current = await transaction.get(assetReference);
    if (current.exists) {
      const record = current.data();
      if (
        record?.version !== 1 ||
        record.campaignId !== id ||
        !isPrivateAssetReference(record.reference, id) ||
        Object.keys(reference).some((key) => record.reference[key] !== reference[key])
      )
        throw new CloudError(
          503,
          'invalid-asset-record',
          'The private asset metadata could not be verified'
        );
    } else {
      const { FieldValue } = require('firebase-admin/firestore');
      transaction.create(assetReference, {
        version: 1,
        campaignId: id,
        reference,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  async uploadAsset(principal, id, command) {
    return this._uploadAsset(principalUid(principal), id, command);
  }

  async _uploadAsset(uid, id, command, authorize = null) {
    const startedAt = this.now();
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some((key) => !['commandId', 'mimeType', 'data'].includes(key)) ||
      !isCloudUUID(command.commandId) ||
      !CHARACTER_IMAGE_TYPES.includes(command.mimeType) ||
      typeof command.data !== 'string' ||
      !command.data.length
    )
      throw new CloudError(
        400,
        'invalid-asset-request',
        'Choose a campaign image and an explicit upload command'
      );
    if (command.data.length > Math.ceil(CHARACTER_IMAGE_FILE_LIMIT / 3) * 4)
      throw new CloudError(413, 'asset-too-large', 'Image files must not exceed 10,000,000 bytes');
    if (command.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(command.data))
      throw new CloudError(
        400,
        'invalid-asset-request',
        'Use complete canonical base64 image data'
      );
    const bytes = Buffer.from(command.data, 'base64');
    if (bytes.toString('base64') !== command.data)
      throw new CloudError(
        400,
        'invalid-asset-request',
        'Use complete canonical base64 image data'
      );
    const mimeType = command.mimeType;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind: 'campaign.asset.upload',
          campaignId: id,
          mimeType,
          sha256,
          bytes: bytes.length,
        })
      )
      .digest('hex');
    const receiptReference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    const intent = {
      uid,
      reference: receiptReference,
      fingerprint,
      kind: 'campaign.asset.upload',
      campaignId: id,
    };
    const headReference = this.firestore.collection('campaigns').doc(id);
    const previous = await this._transaction(
      async (transaction) => {
        if (authorize !== null) await authorize(transaction);
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return replay;
        await this._metadata(await transaction.get(headReference), uid);
        return null;
      },
      { readOnly: true }
    );
    if (previous !== null) return previous;
    if (this.assets === null)
      throw new CloudError(
        503,
        'asset-storage-unavailable',
        'Private campaign asset storage is not configured'
      );
    const reference = await this.assets.stage(id, mimeType, bytes, (candidate) =>
      this.usage.reserveOwnerStorage(uid, id, candidate, this.assets.bucket, { authorize })
    );
    if (
      !isPrivateAssetReference(reference, id) ||
      reference.mimeType !== mimeType ||
      reference.bytes !== bytes.length ||
      reference.sha256 !== sha256
    )
      throw new CloudError(
        503,
        'asset-integrity-failed',
        'The private asset failed its integrity check'
      );
    return this._transaction(async (transaction) => {
      if (authorize !== null) await authorize(transaction);
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, intent);
      if (replay !== null) return replay;
      await this._metadata(await transaction.get(headReference), uid);
      await this.usage.assertPublication(
        transaction,
        uid,
        id,
        [
          {
            path: `campaigns/${id}/assets/${reference.sha256}.bin`,
            bytes: reference.bytes,
          },
        ],
        startedAt
      );
      await this._publishAsset(transaction, id, reference);
      transaction.create(receiptReference, {
        version: 1,
        uid,
        kind: 'campaign.asset.upload',
        fingerprint,
        campaignId: id,
        result: reference,
      });
      return reference;
    });
  }

  async _captureAssetAccess(uid, id, sha256, expected) {
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const grant = await this._accessGrant(transaction, uid, id);
        if (grant.access.role === 'member' && expected === null)
          throw new CloudError(
            400,
            'invalid-access-scope',
            'Use the current participant scope for private image delivery'
          );
        if (
          expected !== null &&
          Object.keys(grant.access).some((key) => grant.access[key] !== expected[key])
        )
          throw new CloudError(
            409,
            'campaign-access-changed',
            'Campaign access changed. Refresh before continuing.'
          );
        const campaign = this.firestore.collection('campaigns').doc(id);
        const snapshotHead = await transaction.get(campaign);
        const head = await this._metadata(snapshotHead, snapshotHead.data().ownerUid);
        const snapshot = await transaction.get(campaign.collection('assets').doc(sha256));
        if (!snapshot.exists)
          throw new CloudError(404, 'asset-not-found', 'This private asset is not available');
        const record = snapshot.data();
        if (
          record?.version !== 1 ||
          record.campaignId !== id ||
          !isPrivateAssetReference(record.reference, id) ||
          record.reference.sha256 !== sha256
        )
          throw new CloudError(
            503,
            'invalid-asset-record',
            'The private asset metadata could not be verified'
          );
        return { reference: record.reference, head, grant };
      },
      { readOnly: true }
    );
  }

  _imageEntries(records, characterIds = null) {
    const assigned = characterIds === null ? null : new Set(characterIds);
    const images = [];
    for (const record of records) {
      const characterId = campaignRecordCharacterId(record?.key);
      if (
        (assigned !== null && !assigned.has(characterId)) ||
        record.key !== `taverntable.character.v1.${characterId}`
      )
        continue;
      let character;
      try {
        character = JSON.parse(record.value);
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new CloudError(
            503,
            'invalid-character-snapshot',
            'Campaign character records could not be verified'
          );
        throw error;
      }
      if (
        !character ||
        typeof character !== 'object' ||
        Array.isArray(character) ||
        character.id !== characterId
      )
        throw new CloudError(
          503,
          'invalid-character-snapshot',
          'Campaign character records could not be verified'
        );
      for (const field of CHARACTER_IMAGE_FIELDS) {
        const image = character[field];
        if (image === undefined || image === null) continue;
        if (
          typeof image !== 'string' ||
          !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
        )
          throw new CloudError(
            503,
            'invalid-character-snapshot',
            'Campaign character records could not be verified'
          );
        const bytes = Buffer.from(image.slice(image.indexOf(';base64,') + 8), 'base64');
        images.push({
          characterId,
          field,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          mimeType: image.slice(5, image.indexOf(';base64,')),
          data: bytes.toString('base64'),
        });
      }
    }
    return images;
  }

  async _finalizeCharacterAssets(ownerUid, id, records, authorize = null) {
    if (this.assets === null) return;
    const unique = new Map(this._imageEntries(records).map((image) => [image.sha256, image]));
    for (const image of unique.values()) {
      const snapshot = await this.firestore
        .collection('campaigns')
        .doc(id)
        .collection('assets')
        .doc(image.sha256)
        .get();
      if (snapshot.exists) {
        const record = snapshot.data();
        if (
          record?.version !== 1 ||
          record.campaignId !== id ||
          !isPrivateAssetReference(record.reference, id) ||
          record.reference.sha256 !== image.sha256 ||
          record.reference.mimeType !== image.mimeType
        )
          throw new CloudError(
            503,
            'invalid-asset-record',
            'The private asset metadata could not be verified'
          );
        await this.assets.read(id, record.reference);
      } else {
        await this._uploadAsset(
          ownerUid,
          id,
          {
            commandId: randomUUID(),
            mimeType: image.mimeType,
            data: image.data,
          },
          authorize
        );
      }
    }
  }

  async getAssetManifest(principal, id) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const captured = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const grant = await this._accessGrant(transaction, uid, id);
        const snapshot = await transaction.get(this.firestore.collection('campaigns').doc(id));
        const head = await this._metadata(snapshot, snapshot.data().ownerUid);
        return { head, grant };
      },
      { readOnly: true }
    );
    const state = await this._loadSnapshot(captured.head);
    if (captured.grant.access.role === 'owner')
      await this._finalizeCharacterAssets(principalUid(principal), id, state.records);
    const entries = this._imageEntries(
      state.records,
      captured.grant.access.role === 'owner' ? null : captured.grant.characterIds
    );
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const current = await this._accessGrant(transaction, uid, id);
        if (
          Object.keys(current.access).some(
            (key) => current.access[key] !== captured.grant.access[key]
          )
        )
          throw new CloudError(
            409,
            'campaign-access-changed',
            'Campaign access changed. Refresh before continuing.'
          );
        const campaign = this.firestore.collection('campaigns').doc(id);
        const headSnapshot = await transaction.get(campaign);
        const head = await this._metadata(headSnapshot, headSnapshot.data().ownerUid);
        if (head.campaign.charactersRevision !== captured.head.campaign.charactersRevision)
          throw new CloudError(
            409,
            'campaign-access-changed',
            'Campaign image access changed. Refresh before continuing.'
          );
        const images = [];
        for (const entry of entries) {
          const snapshot = await transaction.get(campaign.collection('assets').doc(entry.sha256));
          if (!snapshot.exists)
            throw new CloudError(
              503,
              'asset-unavailable',
              'A referenced campaign image has not been finalized'
            );
          const record = snapshot.data();
          if (
            record?.version !== 1 ||
            record.campaignId !== id ||
            !isPrivateAssetReference(record.reference, id) ||
            record.reference.sha256 !== entry.sha256
          )
            throw new CloudError(
              503,
              'invalid-asset-record',
              'The private asset metadata could not be verified'
            );
          images.push({
            characterId: entry.characterId,
            field: entry.field,
            reference: record.reference,
          });
        }
        return {
          version: 1,
          access: current.access,
          charactersRevision: head.campaign.charactersRevision,
          images,
        };
      },
      { readOnly: true }
    );
  }

  async readAsset(principal, id, sha256, expected = null) {
    const uid = principalUid(principal);
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (!isCloudDigest(sha256))
      throw new CloudError(400, 'invalid-asset-request', 'Choose an explicit private asset hash');
    if (
      expected !== null &&
      (!isCloudAccessScope(expected) || expected.uid !== uid || expected.campaignId !== id)
    )
      throw new CloudError(
        400,
        'invalid-access-scope',
        'Choose the explicit current campaign access scope'
      );
    const captured = await this._captureAssetAccess(uid, id, sha256, expected);
    if (captured.grant.access.role === 'member') {
      const state = await this._loadSnapshot(captured.head);
      if (
        !this._imageEntries(state.records, captured.grant.characterIds).some(
          (image) => image.sha256 === sha256
        )
      )
        throw new CloudError(404, 'asset-not-found', 'This private asset is not available');
    }
    if (this.assets === null)
      throw new CloudError(
        503,
        'asset-storage-unavailable',
        'Private campaign asset storage is not configured'
      );
    const bytes = await this.assets.read(id, captured.reference);
    const current = await this._captureAssetAccess(uid, id, sha256, captured.grant.access);
    if (current.head.campaign.charactersRevision !== captured.head.campaign.charactersRevision)
      throw new CloudError(
        409,
        'campaign-access-changed',
        'Campaign image access changed. Refresh before continuing.'
      );
    if (
      Object.keys(captured.reference).some(
        (key) => current.reference[key] !== captured.reference[key]
      )
    )
      throw new CloudError(
        503,
        'asset-integrity-failed',
        'The private asset failed its integrity check'
      );
    return { reference: captured.reference, bytes };
  }

  async getSettings(principal, id) {
    const head = await this._readHead(principal, id);
    return { version: 1, generation: head.generation, campaign: head.campaign };
  }

  async updateSettings(principal, id, command) {
    const uid = principalUid(principal);
    const startedAt = this.now();
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      Object.keys(command).some((key) => !['commandId', 'generation', 'changes'].includes(key)) ||
      !isCloudUUID(command.commandId) ||
      !Number.isSafeInteger(command.generation) ||
      command.generation < 1 ||
      !command.changes ||
      typeof command.changes !== 'object' ||
      Array.isArray(command.changes) ||
      Object.keys(command.changes).some((key) => !['name', 'packIds'].includes(key))
    )
      throw new CloudError(
        400,
        'invalid-campaign-settings',
        'Choose a campaign name or compatible sources and its captured generation'
      );
    const changes = structuredClone(command.changes);
    const expectedGeneration = command.generation;
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind: 'campaign.settings',
          campaignId: id,
          generation: expectedGeneration,
          changes,
        })
      )
      .digest('hex');
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    const intent = { uid, reference, fingerprint, kind: 'campaign.settings', campaignId: id };
    const headReference = this.firestore.collection('campaigns').doc(id);
    const replayResult = (result) => {
      if (result.generation !== expectedGeneration + 1)
        throw new CloudError(
          503,
          'invalid-command-receipt',
          'The durable command receipt is invalid'
        );
      return result;
    };
    const requireGeneration = (head) => {
      if (head.generation !== expectedGeneration)
        throw Object.assign(
          new CloudError(
            409,
            'stale-revision',
            'Campaign settings changed. Refresh before saving them.'
          ),
          {
            current: {
              sceneRevision: head.campaign.sceneRevision,
              charactersRevision: head.campaign.charactersRevision,
            },
          }
        );
      if (head.generation >= Number.MAX_SAFE_INTEGER)
        throw new CloudError(
          503,
          'invalid-campaign-head',
          'The cloud campaign generation cannot advance'
        );
    };
    const captured = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return { replay, head: null };
        const head = await this._metadata(await transaction.get(headReference), uid);
        requireGeneration(head);
        return { replay: null, head };
      },
      { readOnly: true }
    );
    if (captured.replay !== null) return replayResult(captured.replay);
    let record = structuredClone(captured.head.campaign);
    const domain = this._domain({
      getCampaign: () => structuredClone(record),
      writeCampaign: (value) => {
        record = structuredClone(value);
      },
    });
    let campaign;
    try {
      campaign = await domain.update(id, changes);
    } catch (error) {
      if (error?.constructor === Error || error instanceof SyntaxError)
        throw new CloudError(
          400,
          'invalid-campaign-settings',
          'Choose a valid campaign name and compatible pinned sources'
        );
      throw error;
    }
    let charactersRef = captured.head.charactersRef;
    if (campaign.charactersRevision !== captured.head.campaign.charactersRevision) {
      if (this.objects === null || this.resources === null)
        throw new CloudError(
          503,
          'cloud-save-unavailable',
          'Canonical private cloud saving is not configured'
        );
      const state = await this._loadSnapshot(captured.head);
      let catalog;
      try {
        catalog = await this.resources.catalog(campaign);
      } catch (error) {
        if (
          error?.constructor === Error ||
          error instanceof SyntaxError ||
          ['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)
        )
          throw new CloudError(
            503,
            'resource-catalog-unavailable',
            'The pinned campaign resource catalog is unavailable'
          );
        throw error;
      }
      try {
        const library = new CampaignCharacters({
          ...state,
          campaign,
          revision: campaign.charactersRevision,
          catalog,
          store: domain,
        });
        if (state.scene !== null) decodeScene(state.scene, { library, ruleset: campaign.ruleset });
      } catch (error) {
        if (error?.constructor === Error || error instanceof SyntaxError)
          throw new CloudError(
            400,
            'invalid-campaign-settings',
            'The selected sources are incompatible with the saved campaign'
          );
        throw error;
      }
      charactersRef = await this.objects.stage(id, 'characters', state.records, (candidate) =>
        this.usage.reserveStorage(principal, id, candidate, this.objects.bucket)
      );
    }
    const { FieldValue } = require('firebase-admin/firestore');
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, intent);
      if (replay !== null) return replayResult(replay);
      const current = await this._metadata(await transaction.get(headReference), uid);
      requireGeneration(current);
      const generation = current.generation + 1;
      const result = { version: 1, generation, campaign };
      if (charactersRef !== captured.head.charactersRef)
        await this.usage.assertPublication(
          transaction,
          uid,
          id,
          [
            {
              path: charactersRef.path,
              bytes: charactersRef.bytes,
            },
          ],
          startedAt
        );
      const nextHead = { ...current, campaign, charactersRef, generation };
      nextHead.lastCommand = {
        uid,
        commandId: reference.id,
        kind: 'campaign.settings',
        generation,
      };
      delete nextHead.presentationRef;
      transaction.set(headReference, nextHead);
      transaction.create(reference, {
        version: 1,
        uid,
        kind: 'campaign.settings',
        fingerprint,
        campaignId: id,
        result,
      });
      transaction.create(headReference.collection('changes').doc(String(generation)), {
        version: 1,
        generation,
        kind: 'campaign.settings',
        sceneRevision: campaign.sceneRevision,
        charactersRevision: campaign.charactersRevision,
        committedAt: FieldValue.serverTimestamp(),
      });
      return result;
    });
  }

  async get(principal, id) {
    return (await this._readHead(principal, id)).campaign;
  }

  async readCharacters(principal, id) {
    const head = await this._readHead(principal, id);
    const state = await this._loadSnapshot(head);
    await this._readHead(principal, id);
    return state;
  }

  async exportBackup(principal, id) {
    return this._exportState(await this.readCharacters(principal, id));
  }

  async _exportState(state) {
    const record = structuredClone(state.campaign);
    if (state.scene !== null) record.scene = state.scene;
    const text = await this._domain({
      getCampaign: () => record,
      readCharacters: () => state.records,
    }).exportBackup(state.campaign.id);
    if (Buffer.byteLength(text, 'utf8') > CLOUD_BACKUP_BYTE_LIMIT)
      throw new CloudError(
        413,
        'backup-too-large',
        'Complete cloud campaign files must not exceed 128,000,000 UTF-8 bytes'
      );
    return text;
  }

  async _loadSnapshot(head) {
    if ((head.sceneRef !== null || head.charactersRef !== null) && this.objects === null)
      throw new CloudError(
        503,
        'cloud-save-unavailable',
        'Private cloud snapshot storage is not configured'
      );
    const [scene, records] = await Promise.all([
      head.sceneRef === null ? null : this.objects.read(head.campaign.id, 'scene', head.sceneRef),
      head.charactersRef === null
        ? []
        : this.objects.read(head.campaign.id, 'characters', head.charactersRef),
    ]);
    return {
      campaign: head.campaign,
      revision: head.campaign.charactersRevision,
      records,
      scene,
      sceneRevision: head.campaign.sceneRevision,
      sceneSavedAt: head.campaign.sceneSavedAt,
    };
  }

  async readScene(principal, id) {
    const state = await this.readCharacters(principal, id);
    return {
      campaign: state.campaign,
      revision: state.sceneRevision,
      charactersRevision: state.revision,
      scene: state.scene,
      savedAt: state.sceneSavedAt,
    };
  }

  _draft(state) {
    let record = structuredClone(state.campaign);
    if (state.scene !== null) record.scene = state.scene;
    let records = structuredClone(state.records);
    return this._domain({
      getCampaign: () => structuredClone(record),
      writeCampaign: (value) => {
        record = structuredClone(value);
      },
      readCharacters: () => structuredClone(records),
      replaceCharacters: (_id, values) => {
        records = structuredClone(values);
      },
    });
  }

  async _prepareChange(state, kind, change, assignedIds = null) {
    let catalog;
    try {
      catalog = await this.resources.catalog(state.campaign);
    } catch (error) {
      if (
        error?.constructor === Error ||
        error instanceof SyntaxError ||
        ['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)
      )
        throw new CloudError(
          503,
          'resource-catalog-unavailable',
          'The pinned campaign resource catalog is unavailable'
        );
      throw error;
    }
    const domain = this._draft(state);
    try {
      if (assignedIds !== null)
        change = prepareAssignedCharacterChange({
          state,
          library: new CampaignCharacters({ ...state, catalog }),
          characterIds: assignedIds,
          change,
        });
      const receipt =
        kind === 'scene.commit'
          ? await domain.commitScene(state.campaign.id, change)
          : await domain.commitCharacters(state.campaign.id, change);
      const next = await domain.readCharacters(state.campaign.id);
      const library = new CampaignCharacters({ ...next, catalog, store: domain });
      if (next.scene !== null) decodeScene(next.scene, { library, ruleset: next.campaign.ruleset });
      return { next, receipt, changesScene: kind === 'scene.commit' || change.scene !== undefined };
    } catch (error) {
      if (error?.status === 409 && (error.code === 'stale-revision' || assignedIds !== null))
        throw Object.assign(new CloudError(409, 'stale-revision', error.message), {
          current: error.current ?? { charactersRevision: state.revision },
        });
      if (assignedIds !== null && error?.status === 403)
        throw new CloudError(403, 'invalid-assigned-change', error.message);
      if (error?.constructor === Error || error instanceof SyntaxError)
        throw new CloudError(
          400,
          'invalid-campaign-change',
          'The campaign change is invalid for its saved rules, sources and scene'
        );
      throw error;
    }
  }

  async _prepareWorldChange(state, command, profile, placementGrants = []) {
    const characterIds = profile.characterIds;
    if (state.scene === null)
      throw new CloudError(409, 'world-not-ready', 'The campaign owner must save the world first');
    const catalog = await this.resources.catalog(state.campaign);
    const domain = this._draft(state);
    const library = new CampaignCharacters({ ...state, catalog, store: domain });
    const scene = decodeScene(state.scene, { library, ruleset: state.campaign.ruleset });
    const undo = playerUndoFor(this.worldUndoSessions, profile, state);
    const actor = scene.creatures.find((entry) => entry.id === command.tokenId);
    const placementGrant =
      command.kind === 'place'
        ? placementGrants.find(
            (grant) =>
              grant.id === command.payload.grantId &&
              grant.characterId === command.payload.characterId &&
              characterIds.includes(grant.characterId)
          )
        : null;
    if (command.kind === 'place' && !placementGrant)
      throw new CloudError(
        403,
        'placement-forbidden',
        'Choose a current arrival grant for this assigned character'
      );
    if (
      command.kind !== 'place' &&
      (!actor || command.observerTokenId !== actor.id || !characterIds.includes(actor.characterId))
    )
      throw new CloudError(
        403,
        'actor-forbidden',
        'Choose the active currently assigned real creature'
      );
    this.worldDice ??= new PhysicalDice({ root: path.resolve(__dirname, '..', '..') });
    const {
      executePlayerCommand,
      playerCommandReceipt,
      playerDoorState,
    } = require('../../src/campaigns/ServerGameplay.js');
    try {
      if (['roll', 'action.use'].includes(command.kind)) await this.worldDice.load();
      let applied;
      if (command.kind === 'door.state') {
        const changed = playerDoorState(scene, library, characterIds, {
          ...command.payload,
          observerTokenId: command.observerTokenId,
        });
        applied = {
          scene: changed.scene,
          receipt: {
            type: 'door.state',
            tokenId: command.tokenId,
            door: {
              id: changed.door.id,
              open: changed.door.open,
              locked: changed.door.locked,
            },
          },
        };
      } else
        applied = await executePlayerCommand(scene, library, command, {
          ownedIds: characterIds,
          dice: this.worldDice,
          undo,
          placementGrant,
        });
      await library.flush();
      await domain.commitScene(state.campaign.id, {
        ruleset: state.campaign.ruleset,
        revision: state.sceneRevision,
        charactersRevision: library.revision,
        scene: JSON.stringify(applied.scene),
      });
      const next = await domain.readCharacters(state.campaign.id);
      const update = advancePlayerUndo(undo, scene, applied, command);
      if (command.kind === 'door.state') {
        update.reset = true;
        update.tokens.clear();
      }
      return {
        next,
        receipt: playerCommandReceipt(applied, scene, library),
        undo: {
          previous: { sceneRevision: state.sceneRevision, revision: state.revision },
          current: { sceneRevision: next.sceneRevision, revision: next.revision },
          tokens: update.tokens,
          tokenId: command.tokenId,
          reset: update.reset,
        },
      };
    } catch (error) {
      if (
        [400, 403, 409, 422].includes(error.status) &&
        typeof error.code === 'string' &&
        /^[a-z][a-z-]+$/.test(error.code)
      )
        throw new CloudError(error.status, error.code, error.message);
      throw error;
    }
  }

  async commitWorldCommand(principal, id, request, expected) {
    const uid = principalUid(principal);
    const scope = this._accessExpectation(expected);
    const startedAt = this.now();
    if (!isCloudUUID(id)) throw unavailableCampaign();
    if (!scope || scope.seatId === null)
      throw new CloudError(400, 'invalid-access-scope', 'Choose current live player access');
    if (
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      Object.keys(request).length !== 2 ||
      !Object.hasOwn(request, 'sessionId') ||
      !Object.hasOwn(request, 'command') ||
      !isCloudUUID(request.sessionId) ||
      !isCloudUUID(request.command?.commandId)
    )
      throw new CloudError(
        400,
        'invalid-command',
        'Choose a current live epoch and canonical command ID'
      );
    const command = structuredClone(request.command);
    try {
      validateCloudWorldCommand(command);
    } catch (error) {
      if (error.code === 'invalid-command')
        throw new CloudError(error.status, error.code, error.message);
      throw error;
    }
    const { sessionId } = request;
    const canonical = structuredClone(command);
    delete canonical.view;
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind: 'world.command',
          campaignId: id,
          scope,
          sessionId,
          command: canonical,
        })
      )
      .digest('hex');
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    const intent = { uid, reference, fingerprint, kind: 'world.command', campaignId: id };
    const headReference = this.firestore.collection('campaigns').doc(id);
    const captured = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return { replay };
        const admitted = await this.requireLiveSession(
          transaction,
          principal,
          id,
          sessionId,
          scope
        );
        if (admitted.participant.access.role !== 'member') throw unavailableCampaign();
        const snapshot = await transaction.get(headReference);
        const head = await this._metadata(snapshot, snapshot.data().ownerUid);
        const seat =
          command.kind === 'place'
            ? this._seat(
                await transaction.get(headReference.collection('seats').doc(scope.seatId)),
                id
              )
            : null;
        return {
          replay: null,
          head,
          grant: admitted.participant,
          placementGrants: seat?.placementGrants || [],
        };
      },
      { readOnly: true }
    );
    if (captured.replay !== null)
      return { ...captured.replay, outcome: 'duplicate', presentation: null };
    if (this.objects === null || this.resources === null)
      throw new CloudError(503, 'cloud-save-unavailable', 'Private world authority is unavailable');
    if (captured.head.generation >= Number.MAX_SAFE_INTEGER)
      throw new CloudError(503, 'invalid-campaign-head', 'The campaign generation cannot advance');
    const operationKey = stableStringify([id, uid, command.commandId]);
    let operation = this.worldOperations.get(operationKey);
    if (!operation) {
      const pending = Promise.withResolvers();
      operation = { promise: pending.promise, resolve: pending.resolve, count: 0 };
      this.worldOperations.set(operationKey, operation);
    }
    operation.count++;
    try {
      const state = await this._loadSnapshot(captured.head);
      if (
        command.sceneRevision !== state.sceneRevision ||
        command.charactersRevision !== state.revision
      )
        throw Object.assign(
          new CloudError(
            409,
            'stale-revision',
            'Refresh current world state before another command'
          ),
          {
            current: { sceneRevision: state.sceneRevision, charactersRevision: state.revision },
          }
        );
      const profile = this._worldUndoProfile(principal, id, sessionId, captured.grant);
      const { next, receipt, undo } = await this._prepareWorldChange(
        state,
        command,
        profile,
        captured.placementGrants
      );
      const authorize = async (transaction) => {
        const admitted = await this.requireLiveSession(
          transaction,
          principal,
          id,
          sessionId,
          scope
        );
        if (
          admitted.participant.access.role !== 'member' ||
          stableStringify(admitted.participant.characterIds) !==
            stableStringify(captured.grant.characterIds)
        )
          throw new CloudError(
            409,
            'campaign-access-changed',
            'Refresh current assigned world access'
          );
        const head = await transaction.get(headReference);
        if (head.data()?.ownerUid !== captured.head.ownerUid) throw unavailableCampaign();
      };
      const result = {
        version: 1,
        campaignId: id,
        commandId: command.commandId,
        access: captured.grant.access,
        sessionId,
        kind: command.kind,
        outcome: 'applied',
        ...(command.kind === 'door.state' ? { door: receipt.door } : {}),
        ...(command.kind === 'place' ? { tokenId: receipt.tokenId } : {}),
        applied: {
          generation: captured.head.generation + 1,
          sceneRevision: next.sceneRevision,
          charactersRevision: next.revision,
        },
      };
      const entry = receipt.motion
        ? {
            commandId: command.commandId,
            tokenId: receipt.tokenId,
            kind: receipt.kind,
            motion: receipt.motion,
            ...(receipt.costFeet === undefined ? {} : { costFeet: receipt.costFeet }),
            ...(receipt.budget === undefined ? {} : { budget: receipt.budget }),
          }
        : null;
      const presented =
        entry === null
          ? null
          : {
              version: 1,
              campaignId: id,
              generation: result.applied.generation,
              sessionId,
              sceneRevision: next.sceneRevision,
              charactersRevision: next.revision,
              entries: [entry],
            };
      const published = await this._publishCanonical(principal, id, intent, captured, {
        state,
        next,
        result,
        authorize,
        startedAt,
        presented,
        canonicalKind: 'scene.commit',
        writesCharacters: next.revision !== state.revision,
        changesScene: true,
        meaningful:
          stableStringify(state.records) !== stableStringify(next.records) ||
          sceneActivityState(state.scene) !== sceneActivityState(next.scene),
      });
      if (!published.duplicate) rememberPlayerUndo(this.worldUndoSessions, profile, undo);
      return {
        ...published.result,
        outcome: published.duplicate ? 'duplicate' : 'applied',
        presentation: published.duplicate ? null : receipt,
      };
    } finally {
      if (--operation.count === 0) {
        if (this.worldOperations.get(operationKey) === operation)
          this.worldOperations.delete(operationKey);
        operation.resolve();
      }
    }
  }

  async commitScene(principal, id, command) {
    return this._commit(principal, id, command, 'scene.commit');
  }

  async commitCharacters(principal, id, command) {
    return this._commit(principal, id, command, 'characters.commit');
  }

  async commitAssignedCharacters(principal, id, command, expected) {
    const scope = this._accessExpectation(expected);
    if (scope === null || scope.seatId === null)
      throw new CloudError(400, 'invalid-access-scope', 'Choose explicit current player access.');
    return this._commit(principal, id, command, 'characters.assigned.commit', scope);
  }

  async _assignedPublicationAuthority(transaction, uid, id, scope, captured) {
    const grant = await this._participantGrant(transaction, uid, id, scope);
    if (
      grant.access.role !== 'member' ||
      stableStringify(grant.characterIds) !== stableStringify(captured.grant.characterIds)
    )
      throw new CloudError(
        409,
        'campaign-access-changed',
        'Assigned character access changed before publication.'
      );
    const head = await transaction.get(this.firestore.collection('campaigns').doc(id));
    if (head.data()?.ownerUid !== captured.head.ownerUid) throw unavailableCampaign();
  }

  async _participantBackupOwner(principal, id, scope) {
    const uid = principalUid(principal);
    return this._transaction(
      async (transaction) => {
        const grant = await this._participantGrant(transaction, uid, id, scope);
        if (scope !== null && grant.access.role !== 'member') throw unavailableCampaign();
        const snapshot = await transaction.get(this.firestore.collection('campaigns').doc(id));
        const head = await this._metadata(snapshot, snapshot.data().ownerUid);
        return head.ownerUid;
      },
      { readOnly: true }
    );
  }

  async runAssignedBackupWork(principal, id, expected) {
    const scope = this._accessExpectation(expected);
    if (scope === null || scope.seatId === null)
      throw new CloudError(400, 'invalid-access-scope', 'Choose explicit current player access.');
    const ownerUid = await this._participantBackupOwner(principal, id, scope);
    await this._runOwnerBackupWork(ownerUid, id);
  }

  async runLiveBackupWork(principal, id) {
    const ownerUid = await this._participantBackupOwner(principal, id, null);
    await this._runOwnerBackupWork(ownerUid, id);
  }

  async _commit(principal, id, command, kind, expected = null) {
    const uid = principalUid(principal);
    const assigned = kind === 'characters.assigned.commit';
    const ownerCommand = ['scene.commit', 'characters.commit'].includes(kind);
    const canonicalKind = assigned ? 'characters.commit' : kind;
    const writesCharacters = canonicalKind === 'characters.commit';
    const startedAt = this.now();
    if (!isCloudUUID(id))
      throw new CloudError(404, 'campaign-not-found', 'This private campaign is not available');
    if (
      !command ||
      typeof command !== 'object' ||
      Array.isArray(command) ||
      !isCloudUUID(command.commandId) ||
      !command.change ||
      typeof command.change !== 'object' ||
      Array.isArray(command.change) ||
      Object.keys(command).some(
        (key) =>
          !(
            ownerCommand
              ? ['commandId', 'change', 'sessionId', 'presentations']
              : ['commandId', 'change']
          ).includes(key)
      ) ||
      Object.keys(command.change).some(
        (key) =>
          !(
            kind === 'scene.commit'
              ? ['ruleset', 'revision', 'charactersRevision', 'scene']
              : ['ruleset', 'revision', 'records', 'scene']
          ).includes(key)
      )
    )
      throw new CloudError(
        400,
        'invalid-campaign-request',
        'Choose an explicit canonical campaign change and command ID'
      );
    const liveCommand =
      ownerCommand &&
      (Object.hasOwn(command, 'sessionId') || Object.hasOwn(command, 'presentations'));
    if (
      liveCommand &&
      (!isCloudUUID(command.sessionId) ||
        !Array.isArray(command.presentations) ||
        command.presentations.length > 256)
    )
      throw new CloudError(
        400,
        'invalid-scene-presentation',
        'Choose the active live epoch and bounded movement presentations'
      );
    const sessionId = liveCommand ? command.sessionId : null;
    const presentations = liveCommand ? structuredClone(command.presentations) : [];
    if (assigned && Object.hasOwn(command.change, 'scene'))
      throw new CloudError(
        403,
        'invalid-assigned-change',
        'Sheet edits cannot publish world or combat commands.'
      );
    const change = structuredClone(command.change);
    const access = assigned
      ? {
          version: 1,
          uid,
          campaignId: id,
          role: 'member',
          seatId: expected.seatId,
          accessGeneration: expected.accessGeneration,
        }
      : null;
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          kind,
          campaignId: id,
          change,
          ...(assigned ? { access } : {}),
          ...(liveCommand ? { sessionId, presentations } : {}),
        })
      )
      .digest('hex');
    const reference = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(command.commandId);
    const intent = { uid, reference, fingerprint, kind, campaignId: id };
    const headReference = this.firestore.collection('campaigns').doc(id);
    const captured = await this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const replay = await this._previousCommand(transaction, intent);
        if (replay !== null) return { replay, head: null };
        if (liveCommand) {
          const admitted = await this.requireLiveSession(transaction, principal, id, sessionId, {
            seatId: null,
            accessGeneration: 0,
          });
          if (admitted.participant.access.role !== 'owner') throw unavailableCampaign();
        }
        const grant = assigned
          ? await this._participantGrant(transaction, uid, id, expected)
          : null;
        if (assigned && grant.access.role !== 'member') throw unavailableCampaign();
        const snapshot = await transaction.get(headReference);
        return {
          replay: null,
          head: await this._metadata(snapshot, assigned ? snapshot.data().ownerUid : uid),
          grant,
        };
      },
      { readOnly: true }
    );
    if (captured.replay !== null) return captured.replay;
    if (this.objects === null || this.resources === null)
      throw new CloudError(
        503,
        'cloud-save-unavailable',
        'Canonical private cloud saving is not configured'
      );
    if (captured.head.generation >= Number.MAX_SAFE_INTEGER)
      throw new CloudError(
        503,
        'invalid-campaign-head',
        'The cloud campaign generation cannot advance'
      );
    const state = await this._loadSnapshot(captured.head);
    const { next, receipt, changesScene } = await this._prepareChange(
      state,
      canonicalKind,
      change,
      assigned ? captured.grant.characterIds : null
    );
    const result = assigned ? { version: 1, campaignId: id, access, ...receipt } : receipt;
    const authorize = assigned
      ? (transaction) =>
          this._assignedPublicationAuthority(transaction, uid, id, expected, captured)
      : liveCommand
        ? async (transaction) => {
            const admitted = await this.requireLiveSession(transaction, principal, id, sessionId, {
              seatId: null,
              accessGeneration: 0,
            });
            if (admitted.participant.access.role !== 'owner') throw unavailableCampaign();
          }
        : null;
    let presented = null;
    if (presentations.length) {
      try {
        await validateMovementPresentations({
          root: path.resolve(__dirname, '..', '..'),
          previous: state.scene === null ? null : JSON.parse(state.scene),
          scene: JSON.parse(next.scene),
          presentations,
        });
      } catch (error) {
        if (error.code === 'invalid-scene-presentation')
          throw new CloudError(error.status, error.code, error.message);
        throw error;
      }
      presented = {
        version: 1,
        campaignId: id,
        generation: captured.head.generation + 1,
        sessionId,
        sceneRevision: next.sceneRevision,
        charactersRevision: next.revision,
        entries: presentations,
      };
    }
    const meaningful =
      (writesCharacters && stableStringify(state.records) !== stableStringify(next.records)) ||
      (changesScene && sceneActivityState(state.scene) !== sceneActivityState(next.scene));
    const published = await this._publishCanonical(principal, id, intent, captured, {
      state,
      next,
      result,
      authorize,
      meaningful,
      writesCharacters,
      changesScene,
      canonicalKind,
      startedAt,
      presented,
    });
    return published.result;
  }

  async _publishCanonical(principal, id, intent, captured, plan) {
    const uid = principalUid(principal);
    const { reference, fingerprint, kind } = intent;
    const {
      state,
      next,
      result,
      authorize,
      meaningful,
      writesCharacters,
      changesScene,
      canonicalKind,
      startedAt,
      presented,
    } = plan;
    const ownerUid = captured.head.ownerUid;
    const headReference = this.firestore.collection('campaigns').doc(id);
    const candidates = [];
    if (presented !== null) candidates.push(snapshotCandidate(id, 'presentations', presented));
    if (changesScene) candidates.push(snapshotCandidate(id, 'scene', next.scene));
    if (writesCharacters) {
      candidates.push(snapshotCandidate(id, 'characters', next.records));
      if (this.assets !== null)
        for (const image of this._imageEntries(next.records))
          candidates.push({
            path: `campaigns/${id}/assets/${image.sha256}.bin`,
            bytes: Buffer.byteLength(image.data, 'base64'),
          });
    }
    await this.usage.reserveOwnerStorage(ownerUid, id, candidates, this.objects.bucket, {
      authorize,
    });
    if (writesCharacters)
      await this._finalizeCharacterAssets(ownerUid, id, next.records, authorize);
    const removedCharacters = new Set();
    if (writesCharacters) {
      const currentIds = new Set(
        next.records.map((record) => campaignRecordCharacterId(record.key))
      );
      for (const record of state.records) {
        const characterId = campaignRecordCharacterId(record.key);
        if (characterId !== null && !currentIds.has(characterId))
          removedCharacters.add(characterId);
      }
    }
    const [sceneRef, charactersRef, presentationRef] = await Promise.all([
      changesScene
        ? this.objects.stage(id, 'scene', next.scene, (candidate) =>
            this.usage.renewOwnerStorage(ownerUid, id, candidate, this.objects.bucket, {
              authorize,
            })
          )
        : captured.head.sceneRef,
      writesCharacters
        ? this.objects.stage(id, 'characters', next.records, (candidate) =>
            this.usage.renewOwnerStorage(ownerUid, id, candidate, this.objects.bucket, {
              authorize,
            })
          )
        : captured.head.charactersRef,
      presented === null
        ? null
        : this.objects.stage(id, 'presentations', presented, (candidate) =>
            this.usage.renewOwnerStorage(ownerUid, id, candidate, this.objects.bucket, {
              authorize,
            })
          ),
    ]);
    const { FieldValue } = require('firebase-admin/firestore');
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, intent);
      if (replay !== null) return { result: replay, duplicate: true };
      if (authorize !== null) await authorize(transaction);
      const current = await this._metadata(await transaction.get(headReference), ownerUid);
      if (
        current.generation !== captured.head.generation ||
        current.campaign.sceneRevision !== captured.head.campaign.sceneRevision ||
        current.campaign.charactersRevision !== captured.head.campaign.charactersRevision
      )
        throw Object.assign(
          new CloudError(
            409,
            'stale-revision',
            'Campaign data changed while saving; reopen before publishing another change'
          ),
          {
            current: {
              sceneRevision: current.campaign.sceneRevision,
              charactersRevision: current.campaign.charactersRevision,
            },
          }
        );
      const revokedAssignments = [];
      if (removedCharacters.size) {
        const seats = await transaction.get(headReference.collection('seats'));
        for (const snapshot of seats.docs) {
          const seat = this._seat(snapshot, id);
          const characterIds = seat.characterIds.filter(
            (characterId) => !removedCharacters.has(characterId)
          );
          if (characterIds.length === seat.characterIds.length) continue;
          const accessGeneration = seatAccessGeneration(seat) + 1;
          if (!isCloudAccessGeneration(accessGeneration))
            throw new CloudError(
              409,
              'access-generation-exhausted',
              'Campaign access generation cannot advance'
            );
          if (seat.memberUid !== null) {
            const grant = await this._accessSummary(transaction, seat.memberUid, id);
            if (grant.role !== 'member' || grant.seatId !== seat.id) throw invalidMembership();
          }
          revokedAssignments.push({
            reference: snapshot.ref,
            seat,
            characterIds,
            accessGeneration,
          });
        }
      }
      const live = await this._liveSession(transaction, id);
      const presence = await this._livePresence(transaction, live);
      await this.usage.assertPublication(transaction, ownerUid, id, candidates, startedAt);
      const now = Math.max(
        this.now(),
        Date.parse(live.lastMeaningfulAt ?? '1970-01-01T00:00:00.000Z')
      );
      const evaluated = this._expireLiveSession(
        live,
        now,
        this._presenceDisconnectedAt(live, presence, now)
      );
      const nextLive =
        meaningful && evaluated.state === 'live' && now > Date.parse(evaluated.lastMeaningfulAt)
          ? { ...evaluated, lastMeaningfulAt: new Date(now).toISOString() }
          : evaluated;
      const generation = current.generation + 1;
      const publishedHead = {
        ...current,
        campaign: next.campaign,
        sceneRef,
        charactersRef,
        generation,
        lastCommand: { uid, commandId: reference.id, kind, generation },
      };
      if (presentationRef === null) delete publishedHead.presentationRef;
      else publishedHead.presentationRef = presentationRef;
      if (live.state === 'live' && nextLive.state === 'paused')
        await this._queueFinalBackup(transaction, id, nextLive, publishedHead);
      if (nextLive !== live) transaction.set(this._liveSessionReference(id), nextLive);
      for (const revoked of revokedAssignments) {
        transaction.set(revoked.reference, {
          ...revoked.seat,
          version: 2,
          activeInvitationId: revoked.seat.activeInvitationId ?? null,
          characterIds: revoked.characterIds,
          ...(revoked.seat.placementGrants === undefined ? {} : { placementGrants: [] }),
          accessGeneration: revoked.accessGeneration,
        });
        if (revoked.seat.memberUid !== null)
          transaction.update(this._memberships(revoked.seat.memberUid).doc(id), {
            version: 2,
            accessGeneration: revoked.accessGeneration,
          });
      }
      transaction.set(headReference, publishedHead);
      transaction.create(reference, {
        version: 1,
        uid,
        kind,
        fingerprint,
        campaignId: id,
        result,
      });
      transaction.create(headReference.collection('changes').doc(String(generation)), {
        version: 1,
        generation,
        kind: canonicalKind,
        sceneRevision: next.sceneRevision,
        charactersRevision: next.revision,
        committedAt: FieldValue.serverTimestamp(),
      });
      return { result, duplicate: false };
    });
  }
}

module.exports = { CloudCampaignStore };
