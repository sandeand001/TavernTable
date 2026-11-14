import { validateApplicationRuntime } from './CloudRuntime.js';
import { CloudAccountError } from './CloudAccount.js';
import { sessionJSON } from './SessionConnection.js';
import CloudEventStream from './CloudEventStream.js';
import {
  isCloudAccessScope,
  CLOUD_ACCESS_SEAT_HEADER,
  CLOUD_ACCESS_GENERATION_HEADER,
  CLOUD_BACKUP_BYTE_LIMIT,
  CLOUD_BACKUP_BYTES_HEADER,
  CLOUD_BACKUP_DIGEST_HEADER,
  isCloudUUID,
} from './CloudProtocol.js';

const REQUEST_TIMEOUT = 60000;
const requestError = (status, code, message) => Object.assign(new Error(message), { status, code });
const changedAccount = () =>
  requestError(409, 'account-changed', 'The signed-in account changed. Reopen its campaigns.');
const invalidResponse = () =>
  requestError(
    503,
    'invalid-cloud-response',
    'The cloud backend returned an invalid response. No local storage fallback was selected.'
  );
const denialCodes = new Set([
  'invalid-participant-request',
  'invalid-participant-state',
  'invalid-scene-presentation',
  'invalid-command',
  'actor-forbidden',
  'not-your-turn',
  'unreachable',
  'invalid-destination',
  'unsupported-movement',
  'world-not-ready',
  'participant-view-forbidden',
  'participant-view-changed',
  'participant-state-changed',
  'invalid-live-session',
  'invalid-live-presence',
  'invalid-assigned-state',
  'assigned-state-changed',
  'invalid-assigned-change',
  'live-presence-changed',
  'live-presence-expired',
  'invalid-live-command',
  'live-session-changed',
  'live-session-paused',
  'live-session-already-started',
  'stream-limit-reached',
  'stream-lease-expired',
  'invalid-stream-lease',
  'stream-closed',
  'campaign-limit-reached',
  'storage-limit-reached',
  'request-limit-reached',
  'invalid-account-usage',
  'usage-initializing',
  'usage-unavailable',
  'object-maintenance-busy',
  'object-publication-expired',
  'maintenance-unavailable',
  'maintenance-state-changed',
  'invalid-maintenance-state',
  'cloud-requests-busy',
  'storage-reservation-too-large',
  'backup-too-large',
  'backup-integrity-failed',
  'backup-download-unavailable',
  'invalid-backup-request',
  'invalid-backup-state',
  'backup-not-found',
  'backup-unavailable',
  'backup-storage-unavailable',
  'invalid-campaign-backup',
  'invalid-command-claim',
  'invalid-import-request',
  'invalid-import-chunk',
  'import-chunk-too-large',
  'import-not-found',
  'invalid-import-state',
  'import-unavailable',
  'import-state-changed',
  'import-incomplete',
  'import-rejected',
  'import-expired',
  'import-storage-limit-reached',
  'import-campaign-limit-reached',
  'import-image-too-large',
  'import-invalid-image',
  'authentication-required',
  'invalid-identity',
  'email-verification-required',
  'pilot-access-required',
  'identity-unavailable',
  'eligibility-unavailable',
  'invalid-account-eligibility',
  'campaign-not-found',
  'invalid-campaign-request',
  'invalid-campaign-change',
  'invalid-campaign-settings',
  'invalid-asset-request',
  'invalid-asset-image',
  'asset-too-large',
  'asset-image-too-large',
  'asset-integrity-failed',
  'asset-not-found',
  'asset-unavailable',
  'asset-storage-unavailable',
  'asset-processing-busy',
  'invalid-asset-record',
  'stale-revision',
  'command-id-conflict',
  'invalid-command-receipt',
  'invalid-campaign-head',
  'invalid-campaign-membership',
  'invalid-invitation-request',
  'invalid-invitation-record',
  'invitation-unavailable',
  'invitation-already-accepted',
  'seat-already-joined',
  'campaign-already-joined',
  'invalid-access-scope',
  'campaign-access-changed',
  'invalid-member-request',
  'invalid-assignment-request',
  'unknown-assignment-character',
  'seat-not-joined',
  'access-generation-exhausted',
  'revision-conflict',
  'invalid-character-snapshot',
  'snapshot-integrity-failed',
  'snapshot-unavailable',
  'snapshot-storage-unavailable',
  'resource-catalog-unavailable',
  'cloud-save-unavailable',
  'campaign-metadata-unavailable',
  'request-too-large',
  'snapshot-too-large',
  'origin-not-allowed',
  'method-not-allowed',
  'unsupported-request-format',
  'cloud-campaigns-unavailable',
  'campaign-request-failed',
  'account-request-failed',
]);
const denialMessages = new Map([
  ['invalid-command', 'Choose a current canonical gameplay command.'],
  ['actor-forbidden', 'Choose your active currently assigned real creature.'],
  ['not-your-turn', 'Wait for your active turn, or ask the owner to set Free Play.'],
  ['unreachable', 'That destination is blocked or beyond current movement.'],
  ['invalid-destination', 'Choose an available destination on the active actor map.'],
  ['unsupported-movement', 'This saved pose does not support that movement.'],
  ['world-not-ready', 'The campaign owner must save the world before gameplay.'],
  [
    'invalid-scene-presentation',
    'The native movement route does not match the current authorized scene.',
  ],
  ['stream-limit-reached', 'This account has four live connections. Close another live tab first.'],
  ['stream-lease-expired', 'This live stream expired. Reconnect to its current state.'],
  ['invalid-stream-lease', 'The live stream lease could not be verified.'],
  ['stream-closed', 'The live stream was closed.'],
  ['invalid-participant-request', 'Choose the current live session and assigned observer.'],
  ['invalid-participant-state', 'The authorized participant checkpoint could not be verified.'],
  ['participant-view-forbidden', 'This area or observer is not currently authorized.'],
  ['participant-view-changed', 'The authorized view changed. Refresh its current manifest.'],
  ['participant-state-changed', 'The world changed while loading. Refresh its authorized state.'],
  [
    'invalid-live-session',
    'The live-game state could not be verified. No local or combat-turn fallback was selected.',
  ],
  [
    'invalid-live-presence',
    'Live connections could not be verified. No ongoing-game or local fallback was selected.',
  ],
  [
    'invalid-assigned-state',
    'Assigned character data could not be verified. No owner-data fallback was selected.',
  ],
  [
    'assigned-state-changed',
    'Campaign data changed while reading assigned sheets. Refresh before editing.',
  ],
  [
    'invalid-assigned-change',
    'Only permitted assigned-sheet changes can be saved. No world or unassigned character data was changed.',
  ],
  ['live-presence-changed', 'This live connection changed. Reconnect to its current state.'],
  ['live-presence-expired', 'This live connection expired. Reconnect to its current state.'],
  [
    'invalid-live-command',
    'Refresh the current live game before choosing an explicit owner action.',
  ],
  ['live-session-changed', 'The live game changed. Refresh its current state before continuing.'],
  [
    'live-session-paused',
    'The campaign owner must start a live game before world actions. Between-game preparation is separate.',
  ],
  [
    'live-session-already-started',
    'This campaign already has a live game. Refresh its current state.',
  ],
  [
    'object-maintenance-busy',
    'A private object is being maintained. Retain the original command and retry shortly.',
  ],
  [
    'object-publication-expired',
    'This object operation timed out without publication. Retry the same original command online.',
  ],
  [
    'maintenance-unavailable',
    'Private object maintenance is temporarily unavailable; primary saves are separate.',
  ],
  [
    'maintenance-state-changed',
    'Object maintenance observed changed state. No new deletion was acknowledged.',
  ],
  [
    'invalid-maintenance-state',
    'Private object maintenance could not be verified. Saved data must not be deleted.',
  ],
  [
    'invalid-campaign-backup',
    'Choose a complete supported campaign JSON backup with its original edition, sources and state.',
  ],
  [
    'invalid-command-claim',
    'The original pending command could not be verified. Retain it before retrying.',
  ],
  ['invalid-import-request', 'Choose the original complete campaign file and import command.'],
  [
    'invalid-import-chunk',
    'A file part does not match the original import. Retain the pending file.',
  ],
  ['import-chunk-too-large', 'Each campaign file part must not exceed 1 MiB.'],
  ['import-not-found', 'This private import is not available to the signed-in account.'],
  [
    'invalid-import-state',
    'The private import journal could not be verified. Retain the original file and command.',
  ],
  [
    'import-unavailable',
    'Private import preparation is temporarily unavailable. Retry the same pending import.',
  ],
  [
    'import-state-changed',
    'The import state changed. Retry the same pending import to recover its receipt.',
  ],
  ['import-incomplete', 'The complete file has not arrived yet. Retry the same pending import.'],
  [
    'import-rejected',
    'The import was rejected. No new campaign was created; the original backup is unchanged.',
  ],
  [
    'import-expired',
    'The unfinished import expired without creating a campaign. Select the original backup again.',
  ],
  [
    'import-storage-limit-reached',
    'The import reached the 20 GiB allowance. No new campaign was created; the original backup is unchanged.',
  ],
  [
    'import-campaign-limit-reached',
    'The import would exceed ten owned campaigns. No new campaign was created.',
  ],
  [
    'import-image-too-large',
    'Imported images must stay within 10,000,000 bytes, 16,000,000 pixels and 8192 pixels per side. No new campaign was created.',
  ],
  [
    'import-invalid-image',
    'An imported JPEG, PNG or WebP image is incomplete or corrupt. No new campaign was created.',
  ],
  ['backup-too-large', 'Complete cloud campaign files must not exceed 128,000,000 UTF-8 bytes.'],
  [
    'backup-integrity-failed',
    'The complete backup could not be verified. No partial file was accepted.',
  ],
  ['backup-download-unavailable', 'This browser cannot verify a complete backup download.'],
  ['invalid-backup-request', 'Choose an explicit owned campaign and retained JSON backup.'],
  [
    'invalid-backup-state',
    'Private backup history could not be verified. Primary saves are separate.',
  ],
  [
    'backup-not-found',
    'This retained private backup is no longer available to the signed-in account.',
  ],
  [
    'backup-unavailable',
    'The complete private backup file is unavailable. No partial file was accepted.',
  ],
  [
    'backup-storage-unavailable',
    'Private backup storage is temporarily unavailable. Primary saves are separate; retry the original backup.',
  ],
  ['campaign-limit-reached', 'Each account can own at most 10 private-pilot campaigns.'],
  [
    'storage-limit-reached',
    'The 20 GiB private-storage allowance is full. Existing saved data is unchanged; no new save was acknowledged.',
  ],
  [
    'request-limit-reached',
    'This account has reached 300 requests per minute. Wait a minute, then retry the same pending command.',
  ],
  ['invalid-account-usage', 'Account usage could not be verified. No new save was acknowledged.'],
  [
    'usage-initializing',
    'Existing private storage is being accounted for. Retain the pending command and retry shortly.',
  ],
  [
    'usage-unavailable',
    'Account usage is temporarily unavailable. Retain the pending command before retrying online.',
  ],
  [
    'cloud-requests-busy',
    'Cloud data processing is busy. Retain the pending command and retry shortly.',
  ],
  [
    'storage-reservation-too-large',
    'This change needs the bounded large-import path. No new save was acknowledged.',
  ],
  ['invalid-asset-request', 'Choose an explicit private campaign image upload.'],
  ['invalid-asset-image', 'Choose a complete JPEG, PNG or WebP image.'],
  ['asset-too-large', 'Image files must not exceed 10,000,000 bytes.'],
  [
    'asset-image-too-large',
    'Images must not exceed 16,000,000 pixels or 8192 pixels on either side.',
  ],
  ['asset-not-found', 'This private image is not available to the current account and view.'],
  ['asset-unavailable', 'The referenced campaign image has not been finalized. Retry online.'],
  [
    'asset-integrity-failed',
    'The private image failed its integrity check. No image was acknowledged.',
  ],
  [
    'asset-storage-unavailable',
    'Private image storage is temporarily unavailable. Retain the pending change before retrying.',
  ],
  ['invalid-asset-record', 'Private image metadata could not be verified.'],
  [
    'asset-processing-busy',
    'Private image processing is busy. Retain the pending command and retry shortly.',
  ],
  ['authentication-required', 'Sign in before using cloud campaigns.'],
  ['invalid-identity', 'Sign in again before using cloud campaigns.'],
  ['email-verification-required', 'Verify your email, then refresh account access.'],
  [
    'pilot-access-required',
    'This account has not been enabled for the private pilot. Contact the host.',
  ],
  ['campaign-not-found', 'This private campaign is not available to the signed-in account.'],
  ['stale-revision', 'Campaign data changed elsewhere. Reopen it before making another change.'],
  [
    'invalid-campaign-settings',
    'Choose a valid campaign name and compatible pinned sources. The ruleset cannot be changed.',
  ],
  [
    'command-id-conflict',
    'This command ID belongs to another change. Keep the pending save and reopen the campaign.',
  ],
  [
    'request-too-large',
    'The cloud command exceeds the 24 MiB request limit. No save was acknowledged.',
  ],
  ['snapshot-too-large', 'The cloud snapshot exceeds its size limit. No save was acknowledged.'],
  [
    'invitation-unavailable',
    'This invitation is invalid, expired or no longer available. Ask the campaign owner for a new link.',
  ],
  [
    'invitation-already-accepted',
    'This invitation has been accepted. Revoking a link does not remove a player.',
  ],
  [
    'seat-already-joined',
    'This player seat already belongs to an account. An invitation cannot replace its membership.',
  ],
  [
    'campaign-already-joined',
    'This account has already joined that campaign through another seat.',
  ],
  ['invalid-access-scope', 'Choose the explicit current campaign access scope.'],
  [
    'campaign-access-changed',
    'Campaign access changed. Refresh its authorized view before continuing.',
  ],
  ['invalid-member-request', 'Choose a joined player seat and refresh its current access.'],
  [
    'invalid-assignment-request',
    'Choose a saved campaign character, player seat and current access.',
  ],
  ['unknown-assignment-character', 'Choose a saved character from this campaign.'],
  ['seat-not-joined', 'This seat does not have a joined player to remove. Refresh player access.'],
  [
    'access-generation-exhausted',
    'Campaign access cannot advance. No new access change was acknowledged.',
  ],
  ['revision-conflict', 'Campaign characters changed. Refresh before assigning them.'],
  [
    'invalid-character-snapshot',
    'Saved character records could not be verified. No assignment was acknowledged.',
  ],
]);

function safeDenial(error) {
  if (error instanceof CloudAccountError) return error;
  if (!Number.isInteger(error?.status) || error.status < 400 || error.status > 599)
    return requestError(
      503,
      'cloud-unavailable',
      'The cloud backend could not be reached. Retry online; no local save was made.'
    );
  if (!denialCodes.has(error.code)) return invalidResponse();
  const failure = requestError(
    error.status,
    error.code,
    denialMessages.get(error.code) ||
      'The cloud request could not complete. Retain its command ID before retrying online.'
  );
  if (error.current) failure.current = { ...error.current };
  return failure;
}

export default class CloudAccountConnection {
  constructor({ account, runtime, fetch = globalThis.fetch, baseURL = globalThis.location?.href }) {
    if (
      typeof account?.tokenContext !== 'function' ||
      typeof account.identity !== 'function' ||
      typeof fetch !== 'function'
    )
      throw new Error('Cloud requests require managed account identity and HTTP');
    this.runtime = validateApplicationRuntime(runtime, { baseURL });
    if (this.runtime.mode !== 'cloud')
      throw new Error('Choose explicit cloud runtime for cloud requests');
    this.account = account;
    this.apiOrigin = this.runtime.apiOrigin;
    this.fetch = (...args) => fetch(...args);
  }

  async _backupText(response, credential, progress) {
    if (
      typeof response.headers?.get !== 'function' ||
      typeof response.body?.getReader !== 'function' ||
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') || '')
    )
      throw invalidResponse();
    const declaredBytes = response.headers.get(CLOUD_BACKUP_BYTES_HEADER);
    const declaredHash = response.headers.get(CLOUD_BACKUP_DIGEST_HEADER);
    if (
      typeof declaredBytes !== 'string' ||
      !/^[1-9][0-9]*$/.test(declaredBytes) ||
      !Number.isSafeInteger(Number(declaredBytes)) ||
      typeof declaredHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(declaredHash)
    )
      throw invalidResponse();
    const length = Number(declaredBytes);
    if (length > CLOUD_BACKUP_BYTE_LIMIT)
      throw requestError(413, 'backup-too-large', 'The complete backup exceeds its byte limit.');
    if (typeof globalThis.crypto?.subtle?.digest !== 'function')
      throw requestError(503, 'backup-download-unavailable', 'Backup verification is unavailable.');
    const integrityError = () =>
      requestError(
        503,
        'backup-integrity-failed',
        'The complete backup failed its integrity check.'
      );
    const bytes = new Uint8Array(length);
    const reader = response.body.getReader();
    let offset = 0;
    try {
      for (;;) {
        if (!credential.isCurrent()) throw changedAccount();
        const { value, done } = await reader.read();
        if (done) break;
        if (!ArrayBuffer.isView(value) || value.BYTES_PER_ELEMENT !== 1) throw integrityError();
        if (!value.byteLength) continue;
        if (offset + value.byteLength > length) throw integrityError();
        bytes.set(value, offset);
        offset += value.byteLength;
        progress();
      }
      if (offset !== length) throw integrityError();
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
      const sha256 = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
      if (sha256 !== declaredHash) throw integrityError();
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) {
        if (error instanceof TypeError || error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
          throw integrityError();
        throw error;
      }
    } finally {
      reader.releaseLock();
    }
  }

  async request(
    resource,
    { method = 'GET', body, accessScope = null, responseType = 'json', signal = null } = {}
  ) {
    if (
      typeof resource !== 'string' ||
      !/^(?:account|campaigns)(?:\/[A-Za-z0-9-]+)*$/.test(resource) ||
      !['GET', 'POST'].includes(method) ||
      (method !== 'POST' && body !== undefined) ||
      !['json', 'backup', 'events'].includes(responseType) ||
      (signal !== null &&
        (responseType !== 'events' ||
          typeof signal.aborted !== 'boolean' ||
          typeof signal.addEventListener !== 'function' ||
          typeof signal.removeEventListener !== 'function')) ||
      (responseType === 'events' &&
        (method !== 'POST' ||
          accessScope === null ||
          !/^campaigns\/[a-f0-9-]{36}\/(?:events|owner-events)$/.test(resource) ||
          !isCloudUUID(resource.split('/')[1]))) ||
      (responseType === 'backup' &&
        (method !== 'GET' ||
          !/^campaigns\/[^/]+\/(?:backup|backups\/[^/]+)$/.test(resource) ||
          (resource.split('/')[2] === 'backups' && !isCloudUUID(resource.split('/')[3])) ||
          !isCloudUUID(resource.split('/')[1])))
    )
      throw requestError(
        400,
        'invalid-cloud-request',
        'Choose an explicit cloud account or campaign operation.'
      );
    const url = new URL(`/api/cloud/${resource}`, this.apiOrigin).href;
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (
      accessScope !== null &&
      (!isCloudAccessScope(accessScope) ||
        !(
          (method === 'GET' &&
            resource === `campaigns/${accessScope.campaignId}/participant-access`) ||
          (['GET', 'POST'].includes(method) &&
            accessScope.role === 'member' &&
            resource === `campaigns/${accessScope.campaignId}/assigned-characters`) ||
          (method === 'POST' &&
            ((accessScope.role === 'member' &&
              resource === `campaigns/${accessScope.campaignId}/participant-state`) ||
              resource === `campaigns/${accessScope.campaignId}/events`)) ||
          (method === 'POST' &&
            accessScope.role === 'owner' &&
            ['owner-events', 'owner-state'].some(
              (suffix) => resource === `campaigns/${accessScope.campaignId}/${suffix}`
            )) ||
          (method === 'POST' &&
            accessScope.role === 'member' &&
            resource === `campaigns/${accessScope.campaignId}/world-commands`)
        ))
    )
      throw requestError(
        400,
        'invalid-access-scope',
        'Choose the explicit current campaign access scope.'
      );
    const scopeUid = accessScope === null ? null : accessScope.uid;
    const scopeHeaders =
      accessScope === null
        ? {}
        : {
            [CLOUD_ACCESS_SEAT_HEADER]: accessScope.seatId === null ? 'owner' : accessScope.seatId,
            [CLOUD_ACCESS_GENERATION_HEADER]: String(accessScope.accessGeneration),
          };
    let credential = await this.account.tokenContext();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw requestError(409, 'stream-closed', 'The live stream was closed.');
      if (!credential.isCurrent() || (scopeUid !== null && credential.uid !== scopeUid))
        throw changedAccount();
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) controller.abort();
      let timeout;
      let timedOut = false;
      const progress = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, REQUEST_TIMEOUT);
      };
      progress();
      let data;
      try {
        const options = {
          method,
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${credential.token}`,
            ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            ...scopeHeaders,
          },
          ...(encoded === undefined ? {} : { body: encoded }),
        };
        const response = await this.fetch(url, options);
        if (responseType === 'events') {
          if (response.status !== 200) {
            await sessionJSON(async () => response, url, options);
            throw invalidResponse();
          }
          if (
            typeof response.body?.getReader !== 'function' ||
            !/^text\/event-stream(?:;\s*charset=utf-8)?$/i.test(
              response.headers.get('content-type') || ''
            )
          )
            throw invalidResponse();
          if (!credential.isCurrent()) throw changedAccount();
          return new CloudEventStream({
            response,
            controller,
            account: this.account,
            credential,
            signal,
          });
        }
        if (responseType === 'backup' && response.status !== 200) {
          await sessionJSON(async () => response, url, options);
          throw invalidResponse();
        }
        data =
          responseType === 'backup' && response.status === 200
            ? await this._backupText(response, credential, progress)
            : await sessionJSON(async () => response, url, options);
      } catch (error) {
        if (responseType === 'backup' || responseType === 'events') controller.abort();
        if (signal?.aborted)
          throw requestError(409, 'stream-closed', 'The live stream was closed.');
        if (!credential.isCurrent()) throw changedAccount();
        if (timedOut)
          throw requestError(
            504,
            'cloud-request-timeout',
            'The cloud request timed out. Its save status is unconfirmed. Retry online using the same pending command.'
          );
        if (error.status === 401 && attempt === 0) {
          credential = await this.account.tokenContext(true);
          continue;
        }
        throw safeDenial(error);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
      }
      if (!credential.isCurrent()) throw changedAccount();
      if (responseType === 'backup') return data;
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        data.version !== 1 ||
        !Object.hasOwn(data, 'result')
      )
        throw invalidResponse();
      return data.result;
    }
    throw requestError(
      401,
      'authentication-required',
      'Sign in again before using cloud campaigns.'
    );
  }

  async profile() {
    const result = await this.request('account');
    const identity = this.account.identity();
    if (identity === null) throw changedAccount();
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      Object.keys(result).length !== 3 ||
      !Object.keys(result).every((key) => ['uid', 'emailVerified', 'eligible'].includes(key)) ||
      result.uid !== identity.uid ||
      result.emailVerified !== true ||
      result.eligible !== true
    )
      throw invalidResponse();
    return Object.freeze({ uid: result.uid, emailVerified: true, eligible: true });
  }
}
