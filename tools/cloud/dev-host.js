const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { parseArgs } = require('node:util');
const { createEmulatorRuntime, readEmulatorEnvironment } = require('./emulator-runtime.js');
const { CloudAccountAccess } = require('./account-access.js');
const { CloudCampaignStore } = require('./campaign-store.js');
const { ImmutableCloudObjects } = require('./immutable-objects.js');
const { PrivateCampaignAssets } = require('./campaign-assets.js');
const { createCloudHttpHandler } = require('./cloud-http.js');
const { HostResources } = require('../host-resources.js');
const { resolvePublicFile } = require('../public-files.js');
const { validateApplicationRuntime } = require('../../src/campaigns/CloudRuntime.js');

const runtimeTag =
  /<script\b(?=[^>]*\bid="taverntable-runtime")(?=[^>]*\btype="application\/json")[^>]*>[\s\S]*?<\/script>/g;
const denied = (status, code, message) => Object.assign(new Error(message), { status, code });

function jsonResponse(response, status, code, error) {
  const body = JSON.stringify({ version: 1, code, error });
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function closeServer(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  server.closeAllConnections();
  await closed;
}

async function createCloudDevHost({
  root = path.resolve(__dirname, '..', '..'),
  port = 19410,
} = {}) {
  const environment = readEmulatorEnvironment();
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Choose an explicit valid loopback cloud development port');
  const runtime = await createEmulatorRuntime();
  let server;
  try {
    root = await fs.realpath(root);
    const index = await fs.readFile(path.join(root, 'index.html'), 'utf8');
    if ([...index.matchAll(runtimeTag)].length !== 1)
      throw new Error('The application shell requires exactly one JSON runtime tag');
    const manifest = JSON.parse(
      await fs.readFile(path.join(root, 'assets', 'data', 'resources', 'manifest.json'), 'utf8')
    );
    const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
    const store = new CloudCampaignStore({
      firestore: runtime.firestore,
      access,
      packs: manifest.packs,
      resources: new HostResources({ root, manifest }),
      objects: new ImmutableCloudObjects({ bucket: runtime.bucket }),
      assets: new PrivateCampaignAssets({ bucket: runtime.bucket }),
    });
    let api = null;
    let origin = null;
    let html = null;
    let hosts = null;
    server = http.createServer(async (request, response) => {
      try {
        if (!api) throw denied(503, 'cloud-starting', 'The development backend is starting.');
        if (!hosts.has(request.headers.host))
          throw denied(
            403,
            'host-not-allowed',
            'This hostname is not configured for cloud development.'
          );
        const url = new URL(request.url, origin);
        if (url.pathname.startsWith('/api/')) {
          if (!(await api(request, response)))
            throw denied(404, 'not-found', 'This development API is not enabled.');
          return;
        }
        if (!['GET', 'HEAD'].includes(request.method))
          throw denied(405, 'method-not-allowed', 'Use GET or HEAD for application files.');
        let pathname;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch (error) {
          if (error instanceof URIError) throw denied(404, 'not-found', 'File not found.');
          throw error;
        }
        const first = pathname.split('/').filter(Boolean)[0];
        if (pathname !== '/' && pathname !== '/index.html' && !['src', 'assets'].includes(first))
          throw denied(404, 'not-found', 'File not found.');
        const file = await resolvePublicFile(root, pathname);
        const shell = pathname === '/' || pathname === '/index.html';
        const body = shell
          ? html
          : request.method === 'HEAD'
            ? null
            : await fs.readFile(file.filename);
        response.writeHead(200, {
          'Content-Type': file.contentType,
          'Content-Length': shell ? html.length : file.size,
          'Cache-Control': shell ? 'no-store' : 'no-cache',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch (error) {
        const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500);
        if (status >= 500)
          console.error('[cloud-development]', {
            operation: 'request',
            code: 'development-request-failed',
            kind: error instanceof Error ? 'error' : 'non-error',
          });
        if (response.headersSent) response.destroy();
        else
          jsonResponse(
            response,
            status,
            status >= 500 ? 'development-request-failed' : error.code || 'not-found',
            status >= 500 ? 'The development request could not complete.' : error.message
          );
      }
    });
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Cloud development did not bind TCP');
    origin = `http://127.0.0.1:${address.port}`;
    hosts = new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`]);
    const configuration = validateApplicationRuntime(
      {
        version: 1,
        mode: 'cloud',
        environment: 'emulator',
        apiOrigin: origin,
        authEmulatorOrigin: `http://${environment.authHost}`,
        firebase: {
          apiKey: 'demo-api-key',
          projectId: runtime.projectId,
          authDomain: `${runtime.projectId}.firebaseapp.com`,
          appId: 'demo-taverntable-web',
        },
      },
      { baseURL: origin + '/' }
    );
    const json = JSON.stringify(configuration).replace(/</g, '\\u003c');
    html = Buffer.from(
      index.replace(
        runtimeTag,
        `<script id="taverntable-runtime" type="application/json">${json}</script>`
      ),
      'utf8'
    );
    api = createCloudHttpHandler({
      access,
      store,
      allowedOrigins: [origin, `http://localhost:${address.port}`],
    });
    let closing = null;
    return {
      url: origin + '/',
      projectId: runtime.projectId,
      close() {
        if (!closing)
          closing = (async () => {
            const errors = [];
            try {
              await closeServer(server);
            } catch (error) {
              errors.push(error);
            }
            try {
              await runtime.close();
            } catch (error) {
              errors.push(error);
            }
            if (errors.length)
              throw new AggregateError(errors, 'Cloud development could not close cleanly');
          })();
        return closing;
      },
    };
  } catch (error) {
    const errors = [error];
    try {
      await closeServer(server);
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    try {
      await runtime.close();
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (errors.length > 1)
      throw new AggregateError(errors, 'Cloud development startup/cleanup failed');
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '19410' } } });
  const host = await createCloudDevHost({ port: Number(values.port) });
  console.log(
    'TavernTable cloud development ready ' +
      JSON.stringify({ url: host.url, projectId: host.projectId, environment: 'emulator' })
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void host.close().catch(() => {
        console.error('[cloud-development]', {
          operation: 'shutdown',
          code: 'development-close-failed',
        });
        process.exitCode = 1;
      });
    });
}

if (require.main === module) {
  main().catch(() => {
    console.error('[cloud-development]', {
      operation: 'startup',
      code: 'development-start-failed',
    });
    process.exitCode = 1;
  });
}

module.exports = { createCloudDevHost };
