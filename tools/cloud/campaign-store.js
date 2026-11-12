const { default: CampaignStore } = require('../../src/campaigns/CampaignStore.js');
const {
  default: CampaignCharacters,
  campaignCharacterRoster,
  campaignRecordCharacterId,
} = require('../../src/campaigns/CampaignCharacters.js');
const { decodeScene } = require('../../src/campaigns/CampaignScene.js');
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const stableStringify = require('fast-json-stable-stringify');
const { CloudError, metadataUnavailable } = require('./cloud-error.js');
const { pilotAccountKey } = require('./account-access.js');
const {
  isCloudUUID,
  isCloudDigest,
  isCloudInvitation,
  isCloudInvitationRevocation,
  isCloudInvitationAcceptance,
  isCloudAccessGeneration,
  isCloudMemberRemoval,
  isCloudCharacterAssignment,
  CLOUD_INVITATION_TTL_MS,
} = require('../../src/campaigns/CloudProtocol.js');

const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
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
  constructor({ firestore, access, packs, objects = null, resources = null, now = Date.now }) {
    if (
      typeof firestore?.runTransaction !== 'function' ||
      access?.firestore !== firestore ||
      typeof access.assertEligibility !== 'function' ||
      typeof now !== 'function'
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
    this.now = now;
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
      ![
        'campaign.create',
        'scene.commit',
        'characters.commit',
        'campaign.invite',
        'campaign.invite.revoke',
        'campaign.join',
        'campaign.member.remove',
        'campaign.character.assign',
      ].includes(previous.kind) ||
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
    if (previous.kind === 'campaign.join') {
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

  async _accessGrant(transaction, uid, id) {
    if (!isCloudUUID(id)) throw unavailableCampaign();
    const snapshot = await transaction.get(this.firestore.collection('campaigns').doc(id));
    if (!snapshot.exists) throw unavailableCampaign();
    const ownerUid = snapshot.data()?.ownerUid;
    if (ownerUid === uid)
      return participantSummary(uid, accessSummary(await this._metadata(snapshot, uid), 'owner'));
    const membership = await transaction.get(this._memberships(uid).doc(id));
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
    const player = this._seat(
      await transaction.get(snapshot.ref.collection('seats').doc(record.seatId)),
      id
    );
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

  async getParticipantAccess(principal, id, expected = null) {
    const uid = principalUid(principal);
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
    return this._transaction(
      async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const grant = await this._accessGrant(transaction, uid, id);
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
      },
      { readOnly: true }
    );
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
    const removedCharacters = new Set();
    if (kind === 'characters.commit') {
      const currentIds = new Set(
        next.records.map((record) => campaignRecordCharacterId(record.key))
      );
      for (const record of state.records) {
        const characterId = campaignRecordCharacterId(record.key);
        if (characterId !== null && !currentIds.has(characterId))
          removedCharacters.add(characterId);
      }
    }
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
      for (const revoked of revokedAssignments) {
        transaction.set(revoked.reference, {
          ...revoked.seat,
          version: 2,
          activeInvitationId: revoked.seat.activeInvitationId ?? null,
          characterIds: revoked.characterIds,
          accessGeneration: revoked.accessGeneration,
        });
        if (revoked.seat.memberUid !== null)
          transaction.update(this._memberships(revoked.seat.memberUid).doc(id), {
            version: 2,
            accessGeneration: revoked.accessGeneration,
          });
      }
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
