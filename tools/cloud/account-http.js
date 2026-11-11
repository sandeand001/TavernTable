const { URL } = require('node:url');
const { CloudAccessError } = require('./account-access.js');

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

function createAccountHttpHandler({ access, allowedOrigins }) {
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
    if (url.pathname !== '/api/cloud/account') return false;
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
    if (url.search) {
      jsonResponse(
        response,
        400,
        {
          version: 1,
          code: 'invalid-account-request',
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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Cache-Control': 'no-store',
      });
      response.end();
      return true;
    }
    if (request.method !== 'GET') {
      jsonResponse(
        response,
        405,
        { version: 1, code: 'method-not-allowed', error: 'Use GET for account state' },
        { ...headers, Allow: 'GET, OPTIONS' }
      );
      return true;
    }
    try {
      const principal = await access.verifyAuthorization(request.headers.authorization);
      jsonResponse(
        response,
        200,
        {
          version: 1,
          result: { uid: principal.uid, emailVerified: principal.emailVerified, eligible: true },
        },
        headers
      );
    } catch (error) {
      if (error instanceof CloudAccessError) {
        jsonResponse(
          response,
          error.status,
          { version: 1, code: error.code, error: error.message },
          headers
        );
      } else {
        console.error('[cloud-account]', {
          operation: 'account',
          code: 'unexpected-account-error',
          kind: error instanceof Error ? 'error' : 'non-error',
        });
        jsonResponse(
          response,
          500,
          {
            version: 1,
            code: 'account-request-failed',
            error: 'Cloud account state could not be loaded',
          },
          headers
        );
      }
    }
    return true;
  };
}

module.exports = { createAccountHttpHandler };
