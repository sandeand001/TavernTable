const { URL } = require('node:url');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { CloudError } = require('./cloud-error.js');
const { CloudUsageLimits } = require('./usage-limits.js');
const { acquireLargeFileWork } = require('./large-file-work.js');
const { readLimitedBody, RequestBodyLimitError } = require('../http-body.js');
const {
  isCloudUUID,
  isCloudAccessGeneration,
  CLOUD_ACCESS_SEAT_HEADER,
  CLOUD_ACCESS_GENERATION_HEADER,
  CLOUD_BACKUP_BYTES_HEADER,
  CLOUD_BACKUP_DIGEST_HEADER,
} = require('../../src/campaigns/CloudProtocol.js');

const MAX_CLOUD_REQUEST_BYTES = 24 * 1024 * 1024;
const MAX_CLOUD_WORK_REQUESTS = 4;
let activeCloudWork = 0;

async function opportunisticObjectMaintenance(store, principal) {
  try {
    await store.runObjectMaintenance(principal);
  } catch (error) {
    console.error('[cloud-object-maintenance-work]', {
      code: error instanceof CloudError ? error.code : 'maintenance-failed',
    });
  }
}

async function opportunisticBackupWork(store, principal, id) {
  try {
    await store.runBackupWork(principal, id);
  } catch (error) {
    console.error('[cloud-backup-work]', {
      campaignId: id,
      code: error instanceof CloudError ? error.code : 'backup-work-failed',
    });
  }
}

async function streamBackup(response, id, text, headers) {
  const bytes = Buffer.byteLength(text, 'utf8');
  const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
  response.writeHead(200, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="campaign-${id}.json"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Expose-Headers': `${CLOUD_BACKUP_BYTES_HEADER}, ${CLOUD_BACKUP_DIGEST_HEADER}`,
    [CLOUD_BACKUP_BYTES_HEADER]: String(bytes),
    [CLOUD_BACKUP_DIGEST_HEADER]: sha256,
    Vary: 'Origin',
  });
  const chunks = function* () {
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + 64 * 1024, text.length);
      const last = text.charCodeAt(end - 1);
      // Keep UTF-16 pairs together before encoding each buffer as UTF-8.
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      yield Buffer.from(text.slice(start, end), 'utf8');
      start = end;
    }
  };
  await pipeline(Readable.from(chunks()), response);
}

function requestAccessScope(request) {
  const seat = request.headers[CLOUD_ACCESS_SEAT_HEADER.toLowerCase()];
  const generation = request.headers[CLOUD_ACCESS_GENERATION_HEADER.toLowerCase()];
  if (seat === undefined && generation === undefined) return null;
  if (
    typeof seat !== 'string' ||
    (seat !== 'owner' && !isCloudUUID(seat)) ||
    typeof generation !== 'string' ||
    !/^(?:0|[1-9][0-9]*)$/.test(generation) ||
    !isCloudAccessGeneration(Number(generation))
  )
    throw new CloudError(400, 'invalid-access-scope', 'Choose the explicit campaign access scope');
  return { seatId: seat === 'owner' ? null : seat, accessGeneration: Number(generation) };
}

async function requestJSON(request) {
  const contentType = request.headers['content-type'];
  const encoding = request.headers['content-encoding'];
  if (
    typeof contentType !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType) ||
    (encoding !== undefined && encoding !== 'identity')
  )
    throw new CloudError(
      415,
      'unsupported-request-format',
      'Use uncompressed UTF-8 JSON for cloud commands'
    );
  let bytes;
  try {
    bytes = await readLimitedBody(request, MAX_CLOUD_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyLimitError)
      throw new CloudError(
        413,
        'request-too-large',
        'Cloud command JSON exceeds the 24 MiB request limit'
      );
    throw error;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
      throw new CloudError(
        400,
        'invalid-campaign-request',
        'The cloud command must be valid UTF-8 JSON'
      );
    throw error;
  }
}

function jsonResponse(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
    ...headers,
  });
  response.end(body);
}

function createCloudHttpHandler({ access, store = null, allowedOrigins }) {
  if (
    typeof access?.verifyAuthorization !== 'function' ||
    !Array.isArray(allowedOrigins) ||
    !allowedOrigins.length ||
    new Set(allowedOrigins).size !== allowedOrigins.length ||
    allowedOrigins.some((origin) => {
      if (typeof origin !== 'string' || !URL.canParse(origin)) return true;
      const url = new URL(origin);
      return (
        url.origin !== origin ||
        !(
          url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        )
      );
    })
  )
    throw new Error(
      'Cloud account HTTP requires verified access and exact secure/loopback frontend origins'
    );
  if (
    store !== null &&
    [
      'create',
      'list',
      'listAccess',
      'getAccess',
      'getParticipantAccess',
      'getLiveSession',
      'getLiveAccess',
      'controlLiveSession',
      'getSettings',
      'updateSettings',
      'uploadAsset',
      'readAsset',
      'getAssetManifest',
      'listSeats',
      'createInvitation',
      'revokeInvitation',
      'redeemInvitation',
      'removeMember',
      'assignCharacter',
      'get',
      'readCharacters',
      'exportBackup',
      'backupNow',
      'listBackups',
      'backupStatus',
      'readBackup',
      'runBackupWork',
      'runObjectMaintenance',
      'startImport',
      'uploadImportChunk',
      'finishImport',
      'readScene',
      'commitScene',
      'commitCharacters',
    ].some((method) => typeof store[method] !== 'function')
  )
    throw new Error('Cloud campaign HTTP requires the explicit private campaign store interface');
  const origins = new Set(allowedOrigins);
  const usage = store?.usage || new CloudUsageLimits({ firestore: access.firestore, access });
  return async (request, response) => {
    if (!URL.canParse(request.url, 'http://cloud.invalid')) {
      jsonResponse(response, 400, {
        version: 1,
        code: 'invalid-account-request',
        error: 'Invalid account request',
      });
      return true;
    }
    const url = new URL(request.url, 'http://cloud.invalid');
    const account = url.pathname === '/api/cloud/account';
    const redeem = url.pathname === '/api/cloud/account/invitations/redeem';
    const directory = url.pathname === '/api/cloud/account/campaigns';
    const collection = url.pathname === '/api/cloud/campaigns';
    const importStart = url.pathname === '/api/cloud/account/imports';
    const importAction = /^\/api\/cloud\/account\/imports\/([^/]+)\/(parts|finish)$/.exec(
      url.pathname
    );
    const campaign =
      /^\/api\/cloud\/campaigns\/([^/]+)(?:\/(characters|scene|settings|live(?:\/access)?|backup|backups(?:\/(?:status|work|[a-f0-9-]{36}))?|assets(?:\/(?:[a-f0-9]{64}|manifest))?|access|participant-access|seats|invitations(?:\/revoke)?|members\/remove|assignments))?$/.exec(
        url.pathname
      );
    if (
      !account &&
      !redeem &&
      !directory &&
      !collection &&
      !campaign &&
      !importStart &&
      !importAction
    )
      return false;
    const subject = account ? 'account' : 'campaign';
    const snapshot = campaign?.[2];
    const retainedFile =
      snapshot?.startsWith('backups/') && isCloudUUID(snapshot.slice('backups/'.length));
    const largeFile = snapshot === 'backup' || retainedFile || importAction?.[2] === 'finish';
    const evaluatesBackups =
      Boolean(campaign) &&
      [undefined, 'scene', 'characters', 'settings', 'backups', 'backups/status'].includes(
        snapshot
      );
    const maintainsObjects =
      !largeFile &&
      (directory ||
        collection ||
        evaluatesBackups ||
        snapshot === 'assets' ||
        importStart ||
        importAction?.[2] === 'parts');
    const postOnly =
      redeem ||
      importStart ||
      Boolean(importAction) ||
      [
        'invitations',
        'invitations/revoke',
        'members/remove',
        'assignments',
        'assets',
        'backups/work',
        'live/access',
      ].includes(snapshot);
    const writable =
      postOnly ||
      collection ||
      ['scene', 'characters', 'settings', 'backups', 'live'].includes(snapshot);
    const methods = postOnly ? 'POST, OPTIONS' : writable ? 'GET, POST, OPTIONS' : 'GET, OPTIONS';
    let operation = 'campaign.get';
    if (account) operation = 'account';
    else if (redeem) operation = 'campaign.join';
    else if (directory) operation = 'campaign.listAccess';
    else if (importStart) operation = 'campaign.import.start';
    else if (importAction) operation = 'campaign.import.' + importAction[2];
    else if (collection)
      operation = request.method === 'POST' ? 'campaign.create' : 'campaign.list';
    else if (snapshot === 'invitations') operation = 'campaign.invite';
    else if (snapshot === 'invitations/revoke') operation = 'campaign.invite.revoke';
    else if (snapshot === 'members/remove') operation = 'campaign.member.remove';
    else if (snapshot === 'assignments') operation = 'campaign.character.assign';
    else if (snapshot === 'settings') operation = 'campaign.settings';
    else if (snapshot === 'live' || snapshot === 'live/access') operation = 'campaign.live';
    else if (snapshot === 'backup') operation = 'campaign.backup.export';
    else if (snapshot?.startsWith('backups')) operation = 'campaign.' + snapshot.replace('/', '.');
    else if (snapshot === 'assets') operation = 'campaign.asset.upload';
    else if (snapshot === 'assets/manifest') operation = 'campaign.asset.manifest';
    else if (snapshot?.startsWith('assets/')) operation = 'campaign.asset.read';
    else if (snapshot) operation = `${snapshot}.${request.method === 'POST' ? 'commit' : 'read'}`;
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !origins.has(origin))) {
      jsonResponse(response, 403, {
        version: 1,
        code: 'origin-not-allowed',
        error: 'This frontend origin is not allowed',
      });
      return true;
    }
    const headers = origin ? { 'Access-Control-Allow-Origin': origin } : {};
    if (url.search || url.username || url.password || url.hash) {
      jsonResponse(
        response,
        400,
        {
          version: 1,
          code: `invalid-${subject}-request`,
          error: 'Account credentials and identity do not belong in query strings',
        },
        headers
      );
      return true;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        ...headers,
        Vary: 'Origin',
        'Access-Control-Allow-Methods': methods,
        'Access-Control-Allow-Headers': `Authorization, Content-Type, ${CLOUD_ACCESS_SEAT_HEADER}, ${CLOUD_ACCESS_GENERATION_HEADER}`,
        'Cache-Control': 'no-store',
      });
      response.end();
      return true;
    }
    if (!((request.method === 'GET' && !postOnly) || (writable && request.method === 'POST'))) {
      jsonResponse(
        response,
        405,
        {
          version: 1,
          code: 'method-not-allowed',
          error: account
            ? 'Use GET for account state'
            : 'Use the allowed HTTP methods for this cloud campaign operation',
        },
        { ...headers, Allow: methods }
      );
      return true;
    }
    let ownsWorkSlot = false;
    let releaseLargeFile = null;
    try {
      const principal = redeem
        ? await access.verifyIdentity(request.headers.authorization)
        : await access.verifyAuthorization(request.headers.authorization);
      await usage.consumeRequest(principal, { invitation: redeem });
      if (largeFile) releaseLargeFile = acquireLargeFileWork();
      if (
        request.method === 'POST' ||
        maintainsObjects ||
        (request.method === 'GET' && evaluatesBackups) ||
        ['scene', 'characters', 'backup'].includes(snapshot) ||
        retainedFile ||
        snapshot?.startsWith('assets/')
      ) {
        if (activeCloudWork >= MAX_CLOUD_WORK_REQUESTS)
          throw Object.assign(
            new CloudError(
              503,
              'cloud-requests-busy',
              'Cloud data processing is busy; retain the pending command and retry shortly'
            ),
            { retryAfter: 1 }
          );
        activeCloudWork++;
        ownsWorkSlot = true;
      }
      const expectedAccess = requestAccessScope(request);
      if (
        expectedAccess !== null &&
        snapshot !== 'participant-access' &&
        !snapshot?.startsWith('assets/')
      )
        throw new CloudError(
          400,
          'invalid-access-scope',
          'Access scope headers require the participant access interface'
        );
      let result;
      if (account) {
        result = { uid: principal.uid, emailVerified: principal.emailVerified, eligible: true };
      } else {
        if (store === null)
          throw new CloudError(
            503,
            'cloud-campaigns-unavailable',
            'Cloud campaign persistence is not configured'
          );
        if (maintainsObjects) await opportunisticObjectMaintenance(store, principal);
        if (evaluatesBackups && request.method === 'GET')
          await opportunisticBackupWork(store, principal, campaign[1]);
        if (importStart) {
          result = await store.startImport(principal, await requestJSON(request));
        } else if (importAction?.[2] === 'parts') {
          result = await store.uploadImportChunk(
            principal,
            importAction[1],
            await requestJSON(request)
          );
        } else if (importAction?.[2] === 'finish') {
          result = await store.finishImport(principal, importAction[1], await requestJSON(request));
        } else if (redeem) {
          result = await store.redeemInvitation(principal, await requestJSON(request));
        } else if (directory) {
          result = await store.listAccess(principal);
        } else if (collection) {
          result =
            request.method === 'POST'
              ? await store.create(principal, await requestJSON(request))
              : await store.list(principal);
        } else if (snapshot === 'seats') {
          result = await store.listSeats(principal, campaign[1]);
        } else if (snapshot === 'invitations') {
          result = await store.createInvitation(principal, campaign[1], await requestJSON(request));
        } else if (snapshot === 'invitations/revoke') {
          result = await store.revokeInvitation(principal, campaign[1], await requestJSON(request));
        } else if (snapshot === 'members/remove') {
          result = await store.removeMember(principal, campaign[1], await requestJSON(request));
        } else if (snapshot === 'assignments') {
          result = await store.assignCharacter(principal, campaign[1], await requestJSON(request));
        } else if (snapshot === 'access') {
          result = await store.getAccess(principal, campaign[1]);
        } else if (snapshot === 'participant-access') {
          result = await store.getParticipantAccess(principal, campaign[1], expectedAccess);
        } else if (snapshot === 'live') {
          result =
            request.method === 'POST'
              ? await store.controlLiveSession(principal, campaign[1], await requestJSON(request))
              : await store.getLiveSession(principal, campaign[1]);
        } else if (snapshot === 'live/access') {
          result = await store.getLiveAccess(principal, campaign[1], await requestJSON(request));
        } else if (snapshot === 'backup') {
          const text = await store.exportBackup(principal, campaign[1]);
          await streamBackup(response, campaign[1], text, headers);
          return true;
        } else if (snapshot === 'backups') {
          result =
            request.method === 'POST'
              ? await store.backupNow(principal, campaign[1], await requestJSON(request))
              : await store.listBackups(principal, campaign[1]);
        } else if (snapshot === 'backups/status') {
          result = await store.backupStatus(principal, campaign[1]);
        } else if (snapshot === 'backups/work') {
          result = await store.runBackupWork(principal, campaign[1], await requestJSON(request));
        } else if (retainedFile) {
          const text = await store.readBackup(
            principal,
            campaign[1],
            snapshot.slice('backups/'.length)
          );
          await streamBackup(response, campaign[1], text, headers);
          return true;
        } else if (snapshot === 'settings') {
          result =
            request.method === 'POST'
              ? await store.updateSettings(principal, campaign[1], await requestJSON(request))
              : await store.getSettings(principal, campaign[1]);
        } else if (snapshot === 'assets') {
          result = await store.uploadAsset(principal, campaign[1], await requestJSON(request));
        } else if (snapshot === 'assets/manifest') {
          if (expectedAccess !== null)
            throw new CloudError(
              400,
              'invalid-access-scope',
              'Refresh the current image manifest without a stale scope'
            );
          result = await store.getAssetManifest(principal, campaign[1]);
        } else if (snapshot?.startsWith('assets/')) {
          const assetScope =
            expectedAccess === null
              ? null
              : {
                  version: 1,
                  uid: principal.uid,
                  campaignId: campaign[1],
                  role: expectedAccess.seatId === null ? 'owner' : 'member',
                  ...expectedAccess,
                };
          const asset = await store.readAsset(
            principal,
            campaign[1],
            snapshot.slice('assets/'.length),
            assetScope
          );
          response.writeHead(200, {
            'Content-Type': asset.reference.mimeType,
            'Content-Length': asset.bytes.length,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            Vary: 'Origin',
            ...headers,
          });
          response.end(asset.bytes);
          return true;
        } else if (snapshot === 'scene') {
          result =
            request.method === 'POST'
              ? await store.commitScene(principal, campaign[1], await requestJSON(request))
              : await store.readScene(principal, campaign[1]);
        } else if (snapshot === 'characters') {
          result =
            request.method === 'POST'
              ? await store.commitCharacters(principal, campaign[1], await requestJSON(request))
              : await store.readCharacters(principal, campaign[1]);
        } else {
          result = await store.get(principal, campaign[1]);
        }
        if (
          campaign &&
          request.method === 'POST' &&
          ['scene', 'characters', 'settings'].includes(snapshot)
        )
          await opportunisticBackupWork(store, principal, campaign[1]);
      }
      jsonResponse(
        response,
        (collection ||
          importStart ||
          importAction ||
          ['invitations', 'assets', 'backups'].includes(snapshot)) &&
          request.method === 'POST'
          ? 201
          : 200,
        { version: 1, result },
        headers
      );
    } catch (error) {
      if (response.headersSent) {
        console.error(`[cloud-${subject}]`, {
          operation,
          code: 'cloud-response-interrupted',
          kind: error instanceof Error ? 'error' : 'non-error',
        });
        response.destroy();
        return true;
      }
      if (error instanceof CloudError) {
        jsonResponse(
          response,
          error.status,
          {
            version: 1,
            code: error.code,
            error: error.message,
            ...(error.current
              ? {
                  current: {
                    sceneRevision: error.current.sceneRevision,
                    charactersRevision: error.current.charactersRevision,
                  },
                }
              : {}),
          },
          {
            ...headers,
            ...(request.method === 'POST' && !ownsWorkSlot ? { Connection: 'close' } : {}),
            ...(Number.isSafeInteger(error.retryAfter) && error.retryAfter > 0
              ? { 'Retry-After': String(error.retryAfter) }
              : {}),
          }
        );
      } else {
        console.error(`[cloud-${subject}]`, {
          operation,
          code: `unexpected-${subject}-error`,
          kind: error instanceof Error ? 'error' : 'non-error',
        });
        jsonResponse(
          response,
          500,
          {
            version: 1,
            code: `${subject}-request-failed`,
            error: account
              ? 'Cloud account state could not be loaded'
              : 'The cloud campaign request could not be completed; retain its command ID before retrying',
          },
          headers
        );
      }
    } finally {
      if (ownsWorkSlot) activeCloudWork--;
      releaseLargeFile?.();
    }
    return true;
  };
}

module.exports = { createCloudHttpHandler, MAX_CLOUD_REQUEST_BYTES };
