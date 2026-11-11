const { default: CampaignStore } = require('../../src/campaigns/CampaignStore.js');
const { default: CampaignCharacters } = require('../../src/campaigns/CampaignCharacters.js');
const { decodeScene } = require('../../src/campaigns/CampaignScene.js');
const { createHash } = require('node:crypto');
const stableStringify = require('fast-json-stable-stringify');
const { CloudError, metadataUnavailable } = require('./cloud-error.js');
const { pilotAccountKey } = require('./account-access.js');
const { isCloudUUID } = require('../../src/campaigns/CloudProtocol.js');

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
  constructor({ firestore, access, packs, objects = null, resources = null }) {
    if (
      typeof firestore?.runTransaction !== 'function' ||
      access?.firestore !== firestore ||
      typeof access.assertEligibility !== 'function'
    )
      throw new Error('Cloud campaigns require coordinated metadata and account access clients');
    this.firestore = firestore;
    this.access = access;
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
      storage: { transaction: async (_mode, operation) => operation(transaction) },
    });
  }

  async _metadata(snapshot, uid) {
    const head = snapshot.data();
    if (!snapshot.exists || head?.ownerUid !== uid)
      throw new CloudError(404, 'campaign-not-found', 'This private campaign is not available');
    if (
      head.version !== 1 ||
      !Number.isSafeInteger(head.generation) ||
      head.generation < 1 ||
      head.campaign?.id !== snapshot.id ||
      !Number.isSafeInteger(head.campaign.sceneRevision) ||
      head.campaign.sceneRevision < 0 ||
      !Number.isSafeInteger(head.campaign.charactersRevision) ||
      head.campaign.charactersRevision < 0 ||
      (head.sceneRef === null) !== (head.campaign.sceneRevision === 0) ||
      (head.charactersRef === null) !== (head.campaign.charactersRevision === 0) ||
      (head.campaign.sceneRevision === 0
        ? head.campaign.sceneSavedAt !== null
        : typeof head.campaign.sceneSavedAt !== 'string' ||
          !Number.isFinite(Date.parse(head.campaign.sceneSavedAt)))
    )
      throw new CloudError(503, 'invalid-campaign-head', 'The cloud campaign head is invalid');
    const domain = this._domain({ getCampaign: () => head.campaign });
    await domain.get(snapshot.id);
    return head;
  }

  async _previousCommand(transaction, { uid, reference, fingerprint, kind, campaignId = null }) {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return null;
    const previous = snapshot.data();
    if (
      previous?.version !== 1 ||
      previous.uid !== uid ||
      !['campaign.create', 'scene.commit', 'characters.commit'].includes(previous.kind) ||
      !isCloudUUID(previous.campaignId) ||
      !validCommandResult(previous) ||
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
    if (previous.kind === 'campaign.create') {
      try {
        await this._domain({ getCampaign: () => previous.result }).get(previous.campaignId);
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
    await this._metadata(
      await transaction.get(this.firestore.collection('campaigns').doc(previous.campaignId)),
      uid
    );
    return previous.result;
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
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, intent);
      if (replay !== null) return replay;
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
      return campaign;
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

  async get(principal, id) {
    return (await this._readHead(principal, id)).campaign;
  }

  async readCharacters(principal, id) {
    const head = await this._readHead(principal, id);
    const state = await this._loadSnapshot(head);
    await this._readHead(principal, id);
    return state;
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

  async _prepareChange(state, kind, change) {
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
    let record = structuredClone(state.campaign);
    if (state.scene !== null) record.scene = state.scene;
    let records = structuredClone(state.records);
    const domain = this._domain({
      getCampaign: () => structuredClone(record),
      writeCampaign: (value) => {
        record = structuredClone(value);
      },
      readCharacters: () => structuredClone(records),
      replaceCharacters: (_id, values) => {
        records = structuredClone(values);
      },
    });
    try {
      const receipt =
        kind === 'scene.commit'
          ? await domain.commitScene(record.id, change)
          : await domain.commitCharacters(record.id, change);
      const next = await domain.readCharacters(record.id);
      const library = new CampaignCharacters({ ...next, catalog, store: domain });
      if (next.scene !== null) decodeScene(next.scene, { library, ruleset: next.campaign.ruleset });
      return { next, receipt };
    } catch (error) {
      if (error?.status === 409 && error.code === 'stale-revision')
        throw Object.assign(new CloudError(409, 'stale-revision', error.message), {
          current: error.current,
        });
      if (error?.constructor === Error || error instanceof SyntaxError)
        throw new CloudError(
          400,
          'invalid-campaign-change',
          'The campaign change is invalid for its saved rules, sources and scene'
        );
      throw error;
    }
  }

  async commitScene(principal, id, command) {
    return this._commit(principal, id, command, 'scene.commit');
  }

  async commitCharacters(principal, id, command) {
    return this._commit(principal, id, command, 'characters.commit');
  }

  async _commit(principal, id, command, kind) {
    const uid = principalUid(principal);
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
      Object.keys(command).some((key) => !['commandId', 'change'].includes(key)) ||
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
    const change = structuredClone(command.change);
    const fingerprint = createHash('sha256')
      .update(stableStringify({ kind, campaignId: id, change }))
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
        return {
          replay: null,
          head: await this._metadata(await transaction.get(headReference), uid),
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
    const { next, receipt } = await this._prepareChange(state, kind, change);
    const changesScene = kind === 'scene.commit' || change.scene !== undefined;
    const [sceneRef, charactersRef] = await Promise.all([
      changesScene ? this.objects.stage(id, 'scene', next.scene) : captured.head.sceneRef,
      kind === 'characters.commit'
        ? this.objects.stage(id, 'characters', next.records)
        : captured.head.charactersRef,
    ]);
    const { FieldValue } = require('firebase-admin/firestore');
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const replay = await this._previousCommand(transaction, intent);
      if (replay !== null) return replay;
      const current = await this._metadata(await transaction.get(headReference), uid);
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
      const generation = current.generation + 1;
      transaction.set(headReference, {
        ...current,
        campaign: next.campaign,
        sceneRef,
        charactersRef,
        generation,
      });
      transaction.create(reference, {
        version: 1,
        uid,
        kind,
        fingerprint,
        campaignId: id,
        result: receipt,
      });
      transaction.create(headReference.collection('changes').doc(String(generation)), {
        version: 1,
        generation,
        kind,
        sceneRevision: next.sceneRevision,
        charactersRevision: next.revision,
        committedAt: FieldValue.serverTimestamp(),
      });
      return receipt;
    });
  }
}

module.exports = { CloudCampaignStore };
