const { createHash, randomUUID } = require('node:crypto');
const { CloudError, metadataUnavailable } = require('./cloud-error.js');
const { pilotAccountKey } = require('./account-access.js');
const { storageUnavailable } = require('./immutable-objects.js');
const { isCloudUUID, isCloudDigest } = require('../../src/campaigns/CloudProtocol.js');

const OWNED_CAMPAIGN_LIMIT = 10;
const STORAGE_BYTE_LIMIT = 20 * 1024 ** 3;
const REQUEST_LIMIT = 300;
const REQUEST_WINDOW_MS = 60 * 1000;
const STREAM_LIMIT = 4;
const STREAM_LEASE_MS = 90 * 1000;
const INVENTORY_LEASE_MS = 5 * 60 * 1000;
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
    return this._ensureAccount(principalUid(principal));
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
      const result = { version: 1, uid, id, expiresAt: now + STREAM_LEASE_MS };
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
    importId = null
  ) {
    const reference = this._reference(uid);
    const reservations = candidates.map((candidate) =>
      reference.collection('objects').doc(objectKey(candidate.path, candidate.generation))
    );
    await this._transaction(async (transaction) => {
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
    if (!isCloudUUID(campaignId) || (importId !== null && !isCloudUUID(importId)))
      throw new CloudError(
        400,
        'invalid-storage-reservation',
        'Choose a private campaign object scope'
      );
    const candidates = Array.isArray(input) ? input : [input];
    const scope = new RegExp(
      `^campaigns/${campaignId}/(?:objects/(?:scene|characters|import)/[a-f0-9]{64}\\.json|assets/[a-f0-9]{64}\\.bin|backups/[a-f0-9-]{36}/[a-f0-9]{64}\\.json)$`
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
    await this._reserveObjects(uid, campaignId, [...unique.values()], bucket.name, null, importId);
  }
}

module.exports = { CloudUsageLimits };
