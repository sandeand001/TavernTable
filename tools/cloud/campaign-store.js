const { default: CampaignStore } = require('../../src/campaigns/CampaignStore.js');
const { createHash } = require('node:crypto');
const stableStringify = require('fast-json-stable-stringify');
const { CloudError, metadataUnavailable } = require('./cloud-error.js');
const { pilotAccountKey } = require('./account-access.js');

const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

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

class CloudCampaignStore {
  constructor({ firestore, access, packs }) {
    if (
      typeof firestore?.runTransaction !== 'function' ||
      access?.firestore !== firestore ||
      typeof access.assertEligibility !== 'function'
    )
      throw new Error('Cloud campaigns require coordinated metadata and account access clients');
    this.firestore = firestore;
    this.access = access;
    this.packs = packs;
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
      head.campaign.charactersRevision < 0
    )
      throw new CloudError(503, 'invalid-campaign-head', 'The cloud campaign head is invalid');
    const domain = this._domain({ getCampaign: () => head.campaign });
    await domain.get(snapshot.id);
    return head;
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
      !uuid(commandId) ||
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
    const fingerprint = createHash('sha256')
      .update(stableStringify({ kind: 'campaign.create', options }))
      .digest('hex');
    const receiptRef = this.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(uid))
      .collection('receipts')
      .doc(commandId);
    let record;
    const domain = this._domain({
      writeCampaign: (value) => {
        record = structuredClone(value);
      },
    });
    let campaign;
    try {
      campaign = await domain.create(options);
    } catch (error) {
      if (error?.constructor !== Error) throw error;
      throw new CloudError(400, 'invalid-campaign-request', error.message);
    }
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const previousSnapshot = await transaction.get(receiptRef);
      if (previousSnapshot.exists) {
        const previous = previousSnapshot.data();
        if (
          previous?.version !== 1 ||
          previous.uid !== uid ||
          previous.kind !== 'campaign.create' ||
          !uuid(previous.campaignId) ||
          previous.result?.id !== previous.campaignId ||
          typeof previous.fingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(previous.fingerprint)
        )
          throw new CloudError(
            503,
            'invalid-command-receipt',
            'The durable command receipt is invalid'
          );
        if (previous.fingerprint !== fingerprint)
          throw new CloudError(
            409,
            'command-id-conflict',
            'This command ID was already used for another intent'
          );
        await this._metadata(
          await transaction.get(this.firestore.collection('campaigns').doc(previous.campaignId)),
          uid
        );
        return previous.result;
      }
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
    if (!uuid(id))
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
    if (
      head.campaign.sceneRevision !== 0 ||
      head.campaign.charactersRevision !== 0 ||
      head.sceneRef !== null ||
      head.charactersRef !== null
    )
      throw new CloudError(
        503,
        'snapshot-unavailable',
        'The cloud snapshot reader is not ready for this state'
      );
    return {
      campaign: head.campaign,
      revision: 0,
      records: [],
      scene: null,
      sceneRevision: 0,
      sceneSavedAt: null,
    };
  }
}

module.exports = { CloudCampaignStore };
