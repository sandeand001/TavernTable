import { validateApplicationRuntime } from './CloudRuntime.js';
import { CloudAccountError } from './CloudAccount.js';
import { sessionJSON } from './SessionConnection.js';

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

  async request(resource, { method = 'GET', body } = {}) {
    if (
      typeof resource !== 'string' ||
      !/^(?:account|campaigns)(?:\/[A-Za-z0-9-]+)*$/.test(resource) ||
      !['GET', 'POST'].includes(method) ||
      (method !== 'POST' && body !== undefined)
    )
      throw requestError(
        400,
        'invalid-cloud-request',
        'Choose an explicit cloud account or campaign operation.'
      );
    const url = new URL(`/api/cloud/${resource}`, this.apiOrigin).href;
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    let credential = await this.account.tokenContext();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!credential.isCurrent()) throw changedAccount();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      let data;
      try {
        data = await sessionJSON(this.fetch, url, {
          method,
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${credential.token}`,
            ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(encoded === undefined ? {} : { body: encoded }),
        });
      } catch (error) {
        if (!credential.isCurrent()) throw changedAccount();
        if (controller.signal.aborted)
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
      }
      if (!credential.isCurrent()) throw changedAccount();
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
