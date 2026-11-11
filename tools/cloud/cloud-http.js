const { URL } = require('node:url');
const { CloudError } = require('./cloud-error.js');
const { readLimitedBody, RequestBodyLimitError } = require('../http-body.js');

const MAX_CLOUD_REQUEST_BYTES = 24 * 1024 * 1024;

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
    ['create', 'list', 'get', 'readCharacters'].some(
      (method) => typeof store[method] !== 'function'
    )
  )
    throw new Error('Cloud campaign HTTP requires the explicit private campaign store interface');
  const origins = new Set(allowedOrigins);
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
    const collection = url.pathname === '/api/cloud/campaigns';
    const campaign = /^\/api\/cloud\/campaigns\/([^/]+)(?:\/(characters))?$/.exec(url.pathname);
    if (!account && !collection && !campaign) return false;
    const subject = account ? 'account' : 'campaign';
    const methods = collection ? 'GET, POST, OPTIONS' : 'GET, OPTIONS';
    const operation = account
      ? 'account'
      : collection
        ? request.method === 'POST'
          ? 'campaign.create'
          : 'campaign.list'
        : campaign[2]
          ? 'campaign.characters'
          : 'campaign.get';
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
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Cache-Control': 'no-store',
      });
      response.end();
      return true;
    }
    if (request.method !== 'GET' && !(collection && request.method === 'POST')) {
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
    try {
      const principal = await access.verifyAuthorization(request.headers.authorization);
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
        if (collection) {
          result =
            request.method === 'POST'
              ? await store.create(principal, await requestJSON(request))
              : await store.list(principal);
        } else {
          result = campaign[2]
            ? await store.readCharacters(principal, campaign[1])
            : await store.get(principal, campaign[1]);
        }
      }
      jsonResponse(
        response,
        collection && request.method === 'POST' ? 201 : 200,
        { version: 1, result },
        headers
      );
    } catch (error) {
      if (error instanceof CloudError) {
        jsonResponse(
          response,
          error.status,
          { version: 1, code: error.code, error: error.message },
          headers
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
    }
    return true;
  };
}

module.exports = { createCloudHttpHandler, MAX_CLOUD_REQUEST_BYTES };
