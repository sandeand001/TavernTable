const { createHash, randomUUID } = require('node:crypto');
const { CloudError, metadataUnavailable } = require('./cloud-error.js');
const { pilotAccountKey } = require('./account-access.js');
const { storageUnavailable } = require('./immutable-objects.js');
const {
  isCloudUUID,
  isCloudDigest,
  CLOUD_STREAM_LEASE_MS,
} = require('../../src/campaigns/CloudProtocol.js');

const OWNED_CAMPAIGN_LIMIT = 10;
const STORAGE_BYTE_LIMIT = 20 * 1024 ** 3;
const REQUEST_LIMIT = 300;
const REQUEST_WINDOW_MS = 60 * 1000;
const STREAM_LIMIT = 4;
const INVENTORY_LEASE_MS = 5 * 60 * 1000;
const OBJECT_PUBLICATION_WINDOW_MS = 15 * 60 * 1000;
const SOFT_DELETE_BYTE_HOLD_MS = 7 * 24 * 60 * 60 * 1000;
const objectBusy = () =>
  Object.assign(
    new CloudError(
      503,
      'object-maintenance-busy',
      'A private object is being maintained; retain the original command and retry'
    ),
    { retryAfter: 5 }
  );
const invalidUsage = () =>
  new CloudError(503, 'invalid-account-usage', 'Account usage could not be verified');
const inventoryBusy = () =>
  Object.assign(
    new CloudError(
      503,
      'usage-initializing',
      'Existing private storage is being accounted for; retain the pending command and retry'
    ),
    { retryAfter: 5 }
  );
const objectKey = (path, generation = null) =>
  createHash('sha256')
    .update(generation === null ? path : `${path}\n${generation}`)
    .digest('hex');
const validBytes = (value) => Number.isSafeInteger(value) && value >= 0;

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

function ownerStorageCandidates(uid, campaignId, input, importId = null) {
  pilotAccountKey(uid);
  if (!isCloudUUID(campaignId) || (importId !== null && !isCloudUUID(importId)))
    throw new CloudError(
      400,
      'invalid-storage-reservation',
      'Choose a private campaign object scope'
    );
  const candidates = Array.isArray(input) ? input : [input];
  const scope = new RegExp(
    `^campaigns/${campaignId}/(?:objects/(?:scene|characters|import|presentations)/[a-f0-9]{64}\\.json|assets/[a-f0-9]{64}\\.bin|backups/[a-f0-9-]{36}/[a-f0-9]{64}\\.json)$`
  );
  if (
    !candidates.length ||
    candidates.some(
      (candidate) =>
        !candidate ||
        !validBytes(candidate.bytes) ||
        candidate.bytes < 1 ||
        typeof candidate.path !== 'string' ||
        !scope.test(candidate.path) ||
        (candidate.path.split('/')[2] === 'backups' && !isCloudUUID(candidate.path.split('/')[3]))
    )
  )
    throw new CloudError(
      400,
      'invalid-storage-reservation',
      'Choose a bounded private campaign object'
    );
  return candidates;
}

class CloudUsageLimits {
  constructor({ firestore, access, now = Date.now }) {
    if (
      typeof firestore?.runTransaction !== 'function' ||
      access?.firestore !== firestore ||
      typeof access.assertEligibility !== 'function' ||
      typeof now !== 'function'
    )
      throw new Error('Cloud usage limits require coordinated metadata and current account access');
    this.firestore = firestore;
    this.access = access;
    this.now = now;
  }

  _reference(uid) {
    return this.firestore.collection('accountUsage').doc(pilotAccountKey(uid));
  }

  _record(snapshot, uid) {
    const record = snapshot.data();
    if (
      !snapshot.exists ||
      record?.version !== 1 ||
      record.uid !== uid ||
      !Number.isSafeInteger(record.ownedCampaigns) ||
      record.ownedCampaigns < 0 ||
      !validBytes(record.storageBytes) ||
      typeof record.storageInitialized !== 'boolean' ||
      !(record.storageBucket === null || typeof record.storageBucket === 'string') ||
      (record.storageInitialization !== undefined &&
        (!isCloudUUID(record.storageInitialization?.token) ||
          !validBytes(record.storageInitialization.expiresAt)))
    )
      throw invalidUsage();
    return record;
  }

  async _transaction(operation) {
    try {
      return await this.firestore.runTransaction(operation);
    } catch (error) {
      if (metadataUnavailable(error))
        throw new CloudError(
          503,
          'usage-unavailable',
          'Account usage is temporarily unavailable; retain the pending command before retrying'
        );
      throw error;
    }
  }

  async _ownedCampaigns(uid) {
    try {
      return await this.firestore.collection('campaigns').where('ownerUid', '==', uid).get();
    } catch (error) {
      if (metadataUnavailable(error))
        throw new CloudError(
          503,
          'usage-unavailable',
          'Existing campaign usage could not be verified'
        );
      throw error;
    }
  }

  ensureAccount(principal) {
    return this.ensureOwnerAccount(principalUid(principal));
  }

  ensureOwnerAccount(uid) {
    pilotAccountKey(uid);
    return this._ensureAccount(uid);
  }

  prepareStorage(principal, bucket) {
    return this.prepareOwnerStorage(principalUid(principal), bucket);
  }

  prepareOwnerStorage(uid, bucket) {
    pilotAccountKey(uid);
    return this._initializeStorage(uid, bucket);
  }

  _objectRecord(snapshot, uid, campaignId, candidate) {
    const saved = snapshot.data();
    if (
      !snapshot.exists ||
      saved?.version !== 1 ||
      saved.uid !== uid ||
      saved.campaignId !== campaignId ||
      saved.path !== candidate.path ||
      !validBytes(saved.bytes) ||
      saved.bytes !== candidate.bytes ||
      saved.generation !== candidate.generation ||
      !(
        saved.generation === null ||
        (typeof saved.generation === 'string' && /^[1-9][0-9]*$/.test(saved.generation))
      )
    )
      throw invalidUsage();
    if (
      saved.activity !== undefined &&
      (saved.activity?.version !== 1 ||
        !Number.isSafeInteger(saved.activity.epoch) ||
        saved.activity.epoch < 1 ||
        !validBytes(saved.activity.touchedAt) ||
        !validBytes(saved.activity.writableUntil) ||
        saved.activity.writableUntil < saved.activity.touchedAt)
    )
      throw invalidUsage();
    if (
      saved.cleanup !== undefined &&
      (saved.cleanup?.version !== 1 ||
        !['deleting', 'retired'].includes(saved.cleanup.state) ||
        !isCloudUUID(saved.cleanup.token) ||
        typeof saved.cleanup.generation !== 'string' ||
        !/^[1-9][0-9]*$/.test(saved.cleanup.generation) ||
        (saved.cleanup.state === 'retired' && !validBytes(saved.cleanup.retainUntil)))
    )
      throw invalidUsage();
    return saved;
  }

  _activeObjectRecord(snapshot, uid, campaignId, candidate) {
    const record = this._objectRecord(snapshot, uid, campaignId, {
      ...candidate,
      generation: null,
    });
    if (record.cleanup !== undefined) throw objectBusy();
    const epoch = (record.activity?.epoch ?? 0) + 1;
    if (!Number.isSafeInteger(epoch)) throw invalidUsage();
    return {
      ...record,
      activity: {
        version: 1,
        epoch,
        touchedAt: this.now(),
        writableUntil: this.now() + OBJECT_PUBLICATION_WINDOW_MS,
      },
    };
  }

  async touchReferences(transaction, uid, campaignId, candidates) {
    const references = candidates.map((candidate) =>
      this._reference(uid).collection('objects').doc(objectKey(candidate.path))
    );
    const snapshots = references.length ? await transaction.getAll(...references) : [];
    const prepared = snapshots.map((snapshot, index) =>
      this._activeObjectRecord(snapshot, uid, campaignId, candidates[index])
    );
    prepared.forEach((record, index) => transaction.set(references[index], record));
  }

  async assertPublication(transaction, uid, campaignId, candidates, startedAt) {
    if (!validBytes(startedAt) || this.now() > startedAt + OBJECT_PUBLICATION_WINDOW_MS)
      throw new CloudError(
        503,
        'object-publication-expired',
        'Object publication timed out; retain the original command and retry'
      );
    const unique = [
      ...new Map(candidates.map((candidate) => [candidate.path, candidate])).values(),
    ];
    const references = unique.map((candidate) =>
      this._reference(uid).collection('objects').doc(objectKey(candidate.path))
    );
    const snapshots = [];
    for (let offset = 0; offset < references.length; offset += 200)
      snapshots.push(...(await transaction.getAll(...references.slice(offset, offset + 200))));
    snapshots.forEach((snapshot, index) => {
      const record = this._objectRecord(snapshot, uid, campaignId, {
        ...unique[index],
        generation: null,
      });
      if (
        record.cleanup !== undefined ||
        record.activity === undefined ||
        record.activity.writableUntil < this.now()
      )
        throw objectBusy();
    });
  }

  async claimObjectDeletion(transaction, uid, campaignId, candidate, firstUnreferencedAt) {
    const reference = this._reference(uid).collection('objects').doc(objectKey(candidate.path));
    const saved = this._objectRecord(await transaction.get(reference), uid, campaignId, {
      path: candidate.path,
      bytes: candidate.bytes,
      generation: null,
    });
    if (saved.cleanup !== undefined) {
      if (saved.cleanup.state !== 'deleting' || saved.cleanup.generation !== candidate.generation)
        throw invalidUsage();
      return { token: saved.cleanup.token, postponed: false };
    }
    if (
      saved.activity &&
      (saved.activity.writableUntil >= this.now() || saved.activity.touchedAt > firstUnreferencedAt)
    )
      return { token: null, postponed: true };
    const token = randomUUID();
    transaction.set(reference, {
      ...saved,
      cleanup: {
        version: 1,
        state: 'deleting',
        token,
        generation: candidate.generation,
      },
    });
    return { token, postponed: false };
  }

  async objectDeletionPermit(transaction, uid, campaignId, candidate, token) {
    const account = this._reference(uid).collection('objects');
    const [activeSnapshot, retiredSnapshot] = await transaction.getAll(
      account.doc(objectKey(candidate.path)),
      account.doc(objectKey(candidate.path, candidate.generation))
    );
    if (retiredSnapshot.exists) {
      const retired = this._objectRecord(retiredSnapshot, uid, campaignId, candidate);
      if (retired.cleanup?.state !== 'retired' || retired.cleanup.token !== token)
        throw invalidUsage();
      return false;
    }
    const active = this._objectRecord(activeSnapshot, uid, campaignId, {
      path: candidate.path,
      bytes: candidate.bytes,
      generation: null,
    });
    if (
      active.cleanup?.state !== 'deleting' ||
      active.cleanup.token !== token ||
      active.cleanup.generation !== candidate.generation
    )
      throw invalidUsage();
    return true;
  }

  async retireObjectGeneration(transaction, uid, campaignId, candidate, token) {
    const account = this._reference(uid);
    const current = account.collection('objects').doc(objectKey(candidate.path));
    const retained = account
      .collection('objects')
      .doc(objectKey(candidate.path, candidate.generation));
    const [currentSnapshot, retainedSnapshot] = await transaction.getAll(current, retained);
    if (retainedSnapshot.exists) {
      const saved = this._objectRecord(retainedSnapshot, uid, campaignId, candidate);
      if (saved.cleanup?.state !== 'retired' || saved.cleanup.token !== token) throw invalidUsage();
      return;
    }
    if (!currentSnapshot.exists) throw invalidUsage();
    const saved = this._objectRecord(currentSnapshot, uid, campaignId, {
      path: candidate.path,
      bytes: candidate.bytes,
      generation: null,
    });
    if (
      saved.cleanup?.state !== 'deleting' ||
      saved.cleanup.token !== token ||
      saved.cleanup.generation !== candidate.generation
    )
      throw invalidUsage();
    const deletedAt = this.now();
    transaction.create(retained, {
      ...saved,
      generation: candidate.generation,
      cleanup: {
        version: 1,
        state: 'retired',
        token,
        generation: candidate.generation,
        deletedAt,
        retainUntil: deletedAt + SOFT_DELETE_BYTE_HOLD_MS,
      },
    });
    transaction.delete(current);
  }

  async reconcileRetired(principal, campaignId, bucket) {
    const uid = principalUid(principal);
    const account = this._reference(uid);
    const rows = await account
      .collection('objects')
      .where('campaignId', '==', campaignId)
      .where('cleanup.state', '==', 'retired')
      .where('cleanup.retainUntil', '<=', this.now())
      .orderBy('cleanup.retainUntil')
      .limit(4)
      .get();
    let releasedBytes = 0;
    for (const snapshot of rows.docs) {
      const data = snapshot.data();
      if (
        typeof data.path !== 'string' ||
        !data.path.startsWith(`campaigns/${campaignId}/`) ||
        typeof data.generation !== 'string' ||
        !/^[1-9][0-9]*$/.test(data.generation) ||
        snapshot.id !== objectKey(data.path, data.generation)
      )
        throw invalidUsage();
      const candidate = { path: data.path, bytes: data.bytes, generation: data.generation };
      const saved = this._objectRecord(snapshot, uid, campaignId, candidate);
      if (
        saved.cleanup?.state !== 'retired' ||
        !validBytes(saved.cleanup.deletedAt) ||
        saved.cleanup.retainUntil < saved.cleanup.deletedAt + SOFT_DELETE_BYTE_HOLD_MS
      )
        throw invalidUsage();
      let present = false;
      let complete = true;
      for (const selection of [{ versions: true }, { softDeleted: true }]) {
        let query = { prefix: data.path, autoPaginate: false, maxResults: 200, ...selection };
        let pages = 0;
        while (query && pages++ < 2) {
          let files;
          let next;
          try {
            [files, next] = await bucket.getFiles(query);
          } catch (error) {
            if (storageUnavailable(error))
              throw new CloudError(
                503,
                'usage-unavailable',
                'Retained private storage could not be reconciled'
              );
            throw error;
          }
          for (const file of files) {
            const metadata = file.metadata;
            if (
              typeof metadata?.name !== 'string' ||
              metadata.bucket !== bucket.name ||
              typeof metadata.generation !== 'string' ||
              !/^[1-9][0-9]*$/.test(metadata.generation)
            )
              throw invalidUsage();
            if (metadata.name === data.path && metadata.generation === data.generation) {
              if (Number(metadata.size) !== saved.bytes) throw invalidUsage();
              present = true;
            }
          }
          query = next ? { ...query, ...next, prefix: data.path } : null;
        }
        if (query) complete = false;
      }
      if (present || !complete) continue;
      releasedBytes += await this._transaction(async (transaction) => {
        await this.access.assertEligibility(uid, transaction);
        const [usageSnapshot, retainedSnapshot] = await transaction.getAll(account, snapshot.ref);
        const usage = this._record(usageSnapshot, uid);
        if (!retainedSnapshot.exists) return 0;
        const retained = this._objectRecord(retainedSnapshot, uid, campaignId, candidate);
        if (
          retained.cleanup?.state !== 'retired' ||
          retained.cleanup.token !== saved.cleanup.token ||
          retained.cleanup.retainUntil > this.now() ||
          usage.storageBucket !== bucket.name ||
          usage.storageBytes < retained.bytes
        )
          throw invalidUsage();
        transaction.set(account, { ...usage, storageBytes: usage.storageBytes - retained.bytes });
        transaction.delete(snapshot.ref);
        return retained.bytes;
      });
    }
    return releasedBytes;
  }

  async _ensureAccount(uid) {
    const reference = this._reference(uid);
    const current = await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const snapshot = await transaction.get(reference);
      return snapshot.exists ? this._record(snapshot, uid) : null;
    });
    if (current !== null) return current;
    // Every new campaign writer requires this ledger before publication can begin.
    let campaigns;
    let reservations;
    let claims;
    try {
      [campaigns, reservations, claims] = await Promise.all([
        this._ownedCampaigns(uid),
        reference.collection('objects').limit(1).get(),
        this.firestore
          .collection('accountCommands')
          .doc(pilotAccountKey(uid))
          .collection('claims')
          .limit(1)
          .get(),
      ]);
    } catch (error) {
      if (metadataUnavailable(error))
        throw new CloudError(
          503,
          'usage-unavailable',
          'Existing account usage could not be verified'
        );
      throw error;
    }
    return this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) return this._record(snapshot, uid);
      if (!reservations.empty || !claims.empty) throw invalidUsage();
      const record = {
        version: 1,
        uid,
        ownedCampaigns: campaigns.size,
        storageBytes: 0,
        storageInitialized: campaigns.empty,
        storageBucket: null,
      };
      transaction.create(reference, record);
      return record;
    });
  }

  async assertCampaignCapacity(uid, transaction) {
    const record = this._record(await transaction.get(this._reference(uid)), uid);
    if (record.ownedCampaigns >= OWNED_CAMPAIGN_LIMIT)
      throw new CloudError(
        409,
        'campaign-limit-reached',
        'Each account can own at most 10 private-pilot campaigns'
      );
    return record;
  }

  async claimCampaign(uid, transaction) {
    const record = await this.assertCampaignCapacity(uid, transaction);
    transaction.set(this._reference(uid), { ...record, ownedCampaigns: record.ownedCampaigns + 1 });
  }

  async consumeRequest(principal, { invitation = false } = {}) {
    const uid = principalUid(principal);
    const reference = this.firestore.collection('accountRequests').doc(pilotAccountKey(uid));
    await this._transaction(async (transaction) => {
      if (invitation) await this.access.assertInvitationEligibility(uid, transaction);
      else await this.access.assertEligibility(uid, transaction);
      const snapshot = await transaction.get(reference);
      const record = snapshot.exists ? snapshot.data() : { version: 1, uid, timestamps: [] };
      if (
        record?.version !== 1 ||
        record.uid !== uid ||
        !Array.isArray(record.timestamps) ||
        record.timestamps.length > REQUEST_LIMIT ||
        record.timestamps.some(
          (value, index) =>
            !validBytes(value) || (index > 0 && value < record.timestamps[index - 1])
        )
      )
        throw invalidUsage();
      const now = Math.max(this.now(), record.timestamps.at(-1) ?? 0);
      const timestamps = record.timestamps.filter((value) => now - value < REQUEST_WINDOW_MS);
      if (timestamps.length >= REQUEST_LIMIT)
        throw Object.assign(
          new CloudError(
            429,
            'request-limit-reached',
            'This account has reached 300 requests per minute; wait before retrying the same command'
          ),
          { retryAfter: Math.max(1, Math.ceil((timestamps[0] + REQUEST_WINDOW_MS - now) / 1000)) }
        );
      transaction.set(reference, { version: 1, uid, timestamps: [...timestamps, now] });
    });
  }

  acquireStream(principal) {
    return this._streamChange(principal, null, 'acquire');
  }

  renewStream(principal, lease) {
    return this._streamChange(principal, lease, 'renew');
  }

  releaseStream(principal, lease) {
    return this._streamChange(principal, lease, 'release');
  }

  async _streamChange(principal, lease, operation) {
    const uid = principalUid(principal);
    if (
      operation !== 'acquire' &&
      (lease?.version !== 1 ||
        lease.uid !== uid ||
        !isCloudUUID(lease.id) ||
        !validBytes(lease.expiresAt))
    )
      throw new CloudError(400, 'invalid-stream-lease', 'Choose the current account stream lease');
    const id = operation === 'acquire' ? randomUUID() : lease.id;
    const reference = this.firestore.collection('accountStreams').doc(pilotAccountKey(uid));
    return this._transaction(async (transaction) => {
      // Closing a stream must still release its slot after account access is disabled.
      if (operation !== 'release') await this.access.assertEligibility(uid, transaction);
      const snapshot = await transaction.get(reference);
      const record = snapshot.exists
        ? snapshot.data()
        : {
            version: 1,
            uid,
            updatedAt: 0,
            leases: [],
          };
      if (
        record?.version !== 1 ||
        record.uid !== uid ||
        !validBytes(record.updatedAt) ||
        !Array.isArray(record.leases) ||
        record.leases.length > STREAM_LIMIT ||
        record.leases.some(
          (value) =>
            value?.version !== 1 ||
            value.uid !== uid ||
            !isCloudUUID(value.id) ||
            !validBytes(value.expiresAt)
        ) ||
        new Set(record.leases.map((value) => value.id)).size !== record.leases.length
      )
        throw invalidUsage();
      const now = Math.max(this.now(), record.updatedAt);
      let leases = record.leases.filter((value) => value.expiresAt > now);
      const current = leases.findIndex((value) => value.id === id);
      if (operation === 'release') {
        leases = leases.filter((value) => value.id !== id);
        if (snapshot.exists)
          transaction.set(reference, { version: 1, uid, updatedAt: now, leases });
        return { released: current !== -1 };
      }
      if (operation === 'renew' && current === -1)
        throw new CloudError(409, 'stream-lease-expired', 'Reconnect using a new live stream');
      if (operation === 'acquire' && leases.length >= STREAM_LIMIT)
        throw Object.assign(
          new CloudError(
            429,
            'stream-limit-reached',
            'This account already has four live connections; close another live tab before reconnecting'
          ),
          {
            retryAfter: Math.max(
              1,
              Math.ceil((Math.min(...leases.map((value) => value.expiresAt)) - now) / 1000)
            ),
          }
        );
      const result = { version: 1, uid, id, expiresAt: now + CLOUD_STREAM_LEASE_MS };
      if (operation === 'renew') leases[current] = result;
      else leases.push(result);
      transaction.set(reference, { version: 1, uid, updatedAt: now, leases });
      return result;
    });
  }

  async _initializeStorage(uid, bucket) {
    if (typeof bucket?.name !== 'string')
      throw new CloudError(
        503,
        'usage-unavailable',
        'Private storage accounting is not configured'
      );
    const existing = await this._ensureAccount(uid);
    if (existing.storageBucket !== null && existing.storageBucket !== bucket.name)
      throw invalidUsage();
    if (existing.storageInitialized) return;
    if (typeof bucket.getFiles !== 'function')
      throw new CloudError(
        503,
        'usage-unavailable',
        'Existing private storage cannot be inventoried'
      );
    const campaigns = await this._ownedCampaigns(uid);
    const reference = this._reference(uid);
    const claim = await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const record = this._record(await transaction.get(reference), uid);
      if (
        record?.storageBucket !== null &&
        record?.storageBucket !== undefined &&
        record.storageBucket !== bucket.name
      )
        throw invalidUsage();
      if (record?.storageInitialized) return null;
      const now = this.now();
      if (record?.storageInitialization?.expiresAt > now) throw inventoryBusy();
      const token = randomUUID();
      transaction.set(reference, {
        ...record,
        storageBucket: bucket.name,
        storageInitialization: { token, expiresAt: now + INVENTORY_LEASE_MS },
      });
      return { token, campaigns: campaigns.docs.map((snapshot) => snapshot.id) };
    });
    if (claim === null) return;
    for (const campaignId of claim.campaigns) {
      for (const selection of [{ versions: true }, { softDeleted: true }]) {
        let query = {
          prefix: `campaigns/${campaignId}/`,
          maxResults: 200,
          autoPaginate: false,
          ...selection,
        };
        while (query) {
          let files;
          let next;
          try {
            [files, next] = await bucket.getFiles(query);
          } catch (error) {
            if (storageUnavailable(error))
              throw new CloudError(
                503,
                'usage-unavailable',
                'Existing storage could not be accounted for; retain the pending command and retry online'
              );
            throw error;
          }
          for (const file of files) {
            const metadata = file.metadata;
            const bytes = Number(metadata?.size);
            if (
              typeof metadata?.name !== 'string' ||
              !metadata.name.startsWith(`campaigns/${campaignId}/`) ||
              metadata.bucket !== bucket.name ||
              !/^[1-9][0-9]*$/.test(metadata.generation) ||
              !validBytes(bytes)
            )
              throw invalidUsage();
            await this._reserveObject(
              uid,
              campaignId,
              {
                path: metadata.name,
                bytes,
                generation:
                  metadata.softDeleteTime || metadata.timeDeleted ? metadata.generation : null,
              },
              bucket.name,
              claim.token
            );
          }
          query = next ? { ...query, ...next } : null;
        }
      }
    }
    await this._transaction(async (transaction) => {
      await this.access.assertEligibility(uid, transaction);
      const record = this._record(await transaction.get(reference), uid);
      if (record.storageInitialization?.token !== claim.token) throw inventoryBusy();
      const ready = { ...record };
      delete ready.storageInitialization;
      transaction.set(reference, { ...ready, storageInitialized: true });
    });
  }

  async _reserveObject(uid, campaignId, candidate, bucketName, inventoryToken = null) {
    return this._reserveObjects(uid, campaignId, [candidate], bucketName, inventoryToken);
  }

  async _reserveObjects(
    uid,
    campaignId,
    candidates,
    bucketName,
    inventoryToken = null,
    importId = null,
    authorize = null
  ) {
    const reference = this._reference(uid);
    const reservations = candidates.map((candidate) =>
      reference.collection('objects').doc(objectKey(candidate.path, candidate.generation))
    );
    await this._transaction(async (transaction) => {
      if (authorize !== null) await authorize(transaction);
      await this.access.assertEligibility(uid, transaction);
      const campaign = await transaction.get(
        this.firestore.collection('campaigns').doc(campaignId)
      );
      if (importId !== null) {
        const [job, claim] = await transaction.getAll(
          this.firestore
            .collection('accountImports')
            .doc(pilotAccountKey(uid))
            .collection('transfers')
            .doc(importId),
          this.firestore
            .collection('accountCommands')
            .doc(pilotAccountKey(uid))
            .collection('claims')
            .doc(importId)
        );
        if (!job.exists || job.data()?.uid !== uid || job.data()?.campaignId !== campaignId)
          throw new CloudError(404, 'import-not-found', 'This private import is not available');
        const proof = claim.data();
        if (
          job.data().version !== 1 ||
          job.data().importId !== importId ||
          !isCloudDigest(job.data().fingerprint) ||
          proof?.version !== 1 ||
          proof.uid !== uid ||
          proof.kind !== 'campaign.import' ||
          proof.campaignId !== campaignId ||
          proof.fingerprint !== job.data().fingerprint
        )
          throw new CloudError(
            503,
            'invalid-import-state',
            'The private import intent could not be verified'
          );
        if (
          campaign.exists ||
          job.data().state !== 'uploading' ||
          !Number.isFinite(Date.parse(job.data().expiresAt)) ||
          Date.parse(job.data().expiresAt) <= this.now()
        )
          throw new CloudError(
            409,
            'import-state-changed',
            'Reconcile the current private import before continuing'
          );
      } else if (!campaign.exists || campaign.data()?.ownerUid !== uid)
        throw new CloudError(404, 'campaign-not-found', 'This private campaign is not available');
      const record = this._record(await transaction.get(reference), uid);
      if (record.storageBucket !== null && record.storageBucket !== bucketName)
        throw invalidUsage();
      if (
        inventoryToken === null
          ? !record.storageInitialized
          : record.storageInitialization?.token !== inventoryToken
      )
        throw inventoryBusy();
      const previous = [];
      for (let offset = 0; offset < reservations.length; offset += 200)
        previous.push(...(await transaction.getAll(...reservations.slice(offset, offset + 200))));
      const added = [];
      for (let index = 0; index < previous.length; index++) {
        const saved = previous[index].data();
        const candidate = candidates[index];
        if (previous[index].exists) {
          if (
            saved?.version !== 1 ||
            saved.uid !== uid ||
            saved.campaignId !== campaignId ||
            saved.path !== candidate.path ||
            saved.bytes !== candidate.bytes ||
            saved.generation !== candidate.generation
          )
            throw invalidUsage();
        } else {
          added.push(index);
        }
      }
      if (added.length > 499)
        throw new CloudError(
          413,
          'storage-reservation-too-large',
          'Stage large imports in bounded batches before publishing their canonical checkpoint'
        );
      if (!added.length && inventoryToken === null) return;
      const storageBytes = added.reduce(
        (total, index) => total + candidates[index].bytes,
        record.storageBytes
      );
      if (!validBytes(storageBytes)) throw invalidUsage();
      if (inventoryToken === null && storageBytes > STORAGE_BYTE_LIMIT)
        throw new CloudError(
          409,
          'storage-limit-reached',
          'Private storage has reached the 20 GiB account limit; no new object was uploaded'
        );
      for (const index of added)
        transaction.create(reservations[index], {
          version: 1,
          uid,
          campaignId,
          ...candidates[index],
        });
      transaction.set(reference, {
        ...record,
        storageBytes,
        storageBucket: bucketName,
        ...(inventoryToken === null
          ? {}
          : {
              storageInitialization: {
                token: inventoryToken,
                expiresAt: this.now() + INVENTORY_LEASE_MS,
              },
            }),
      });
    });
  }

  async reserveStorage(principal, campaignId, input, bucket, { importId = null } = {}) {
    const uid = principalUid(principal);
    return this.reserveOwnerStorage(uid, campaignId, input, bucket, { importId });
  }

  async renewOwnerStorage(uid, campaignId, input, bucket, { authorize = null } = {}) {
    const candidates = ownerStorageCandidates(uid, campaignId, input);
    if (
      candidates.length !== 1 ||
      typeof bucket?.name !== 'string' ||
      (authorize !== null && typeof authorize !== 'function')
    )
      throw new CloudError(
        400,
        'invalid-storage-reservation',
        'Choose one verified reserved campaign object'
      );
    const candidate = candidates[0];
    const usage = this._reference(uid);
    const reference = usage.collection('objects').doc(objectKey(candidate.path));
    const renewed = await this._transaction(async (transaction) => {
      if (authorize !== null) await authorize(transaction);
      await this.access.assertEligibility(uid, transaction);
      const [campaign, account, saved] = await transaction.getAll(
        this.firestore.collection('campaigns').doc(campaignId),
        usage,
        reference
      );
      if (!campaign.exists || campaign.data()?.ownerUid !== uid)
        throw new CloudError(404, 'campaign-not-found', 'This private campaign is not available');
      if (!account.exists) return false;
      const record = this._record(account, uid);
      if (record.storageBucket !== null && record.storageBucket !== bucket.name)
        throw invalidUsage();
      if (!record.storageInitialized || record.storageBucket === null || !saved.exists)
        return false;
      transaction.set(reference, this._activeObjectRecord(saved, uid, campaignId, candidate));
      return true;
    });
    // A held lookup can outlive its reservation; regain quota before recreating any object.
    if (!renewed) await this.reserveOwnerStorage(uid, campaignId, candidate, bucket, { authorize });
  }

  async reserveOwnerStorage(
    uid,
    campaignId,
    input,
    bucket,
    { importId = null, authorize = null } = {}
  ) {
    const candidates = ownerStorageCandidates(uid, campaignId, input, importId);
    if (authorize !== null && typeof authorize !== 'function')
      throw new CloudError(
        400,
        'invalid-storage-reservation',
        'Choose verified campaign publication authority'
      );
    if (authorize !== null) await this._transaction(authorize, { readOnly: true });
    await this._initializeStorage(uid, bucket);
    const unique = new Map();
    for (const candidate of candidates) {
      if (unique.has(candidate.path) && unique.get(candidate.path).bytes !== candidate.bytes)
        throw invalidUsage();
      unique.set(candidate.path, {
        path: candidate.path,
        bytes: candidate.bytes,
        generation: null,
      });
    }
    const selected = [...unique.values()];
    await this._reserveObjects(uid, campaignId, selected, bucket.name, null, importId, authorize);
    for (let offset = 0; offset < selected.length; offset += 200) {
      await this._transaction(async (transaction) => {
        if (authorize !== null) await authorize(transaction);
        await this.access.assertEligibility(uid, transaction);
        await this.touchReferences(
          transaction,
          uid,
          campaignId,
          selected.slice(offset, offset + 200)
        );
      });
    }
  }
}

module.exports = { CloudUsageLimits, OBJECT_PUBLICATION_WINDOW_MS };
