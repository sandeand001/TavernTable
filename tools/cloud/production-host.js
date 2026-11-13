const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { createProductionRuntime } = require('./production-runtime.js');
const { CloudAccountAccess } = require('./account-access.js');
const { CloudCampaignStore } = require('./campaign-store.js');
const { ImmutableCloudObjects } = require('./immutable-objects.js');
const { PrivateCampaignAssets } = require('./campaign-assets.js');
const { createCloudHttpHandler } = require('./cloud-http.js');
const { HostResources } = require('../host-resources.js');

function jsonResponse(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

async function createProductionHost() {
  const runtime = await createProductionRuntime();
  let server;
  try {
    const root = path.resolve(__dirname, '..', '..');
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
    const api = createCloudHttpHandler({
      access,
      store,
      allowedOrigins: runtime.config.allowedOrigins,
    });
    server = http.createServer(async (request, response) => {
      try {
        if (['/health', '/healthz'].includes(request.url)) {
          if (!['GET', 'HEAD'].includes(request.method)) {
            jsonResponse(
              response,
              405,
              { version: 1, code: 'method-not-allowed' },
              { Allow: 'GET, HEAD' }
            );
          } else {
            jsonResponse(response, 200, { version: 1, status: 'ready' });
          }
        } else if (!(await api(request, response))) {
          jsonResponse(response, 404, { version: 1, code: 'not-found' }, { Connection: 'close' });
        }
      } catch (error) {
        console.error('[cloud-runtime]', {
          code: 'cloud-response-failed',
          kind: error instanceof Error ? 'error' : 'non-error',
        });
        if (response.headersSent) response.destroy();
        else
          jsonResponse(
            response,
            500,
            { version: 1, code: 'cloud-response-failed' },
            { Connection: 'close' }
          );
      }
    });
    server.requestTimeout = 60 * 60 * 1000;
    server.timeout = 60 * 60 * 1000;
    server.headersTimeout = 60 * 1000;
    let closing;
    return {
      server,
      port: runtime.config.port,
      close() {
        if (!closing)
          closing = (async () => {
            const errors = [];
            try {
              if (server.listening)
                await new Promise((resolve, reject) => {
                  server.close((error) => (error ? reject(error) : resolve()));
                });
            } catch (error) {
              errors.push(error);
            }
            try {
              await runtime.close();
            } catch (error) {
              errors.push(error);
            }
            if (errors.length) throw new AggregateError(errors, 'Cloud server cleanup failed');
          })();
        return closing;
      },
    };
  } catch (error) {
    try {
      await runtime.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Cloud server initialization and cleanup failed'
      );
    }
    throw error;
  }
}

async function run() {
  const host = await createProductionHost();
  try {
    host.server.listen(host.port, '0.0.0.0');
    await once(host.server, 'listening');
  } catch (error) {
    await host.close();
    throw error;
  }
  console.log(JSON.stringify({ version: 1, code: 'cloud-runtime-ready', port: host.port }));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      host.close().catch(() => {
        console.error(JSON.stringify({ version: 1, code: 'cloud-shutdown-failed' }));
        process.exitCode = 1;
      });
    });
}

if (require.main === module)
  run().catch((error) => {
    console.error(
      JSON.stringify({
        version: 1,
        code: error?.code === 'invalid-production-runtime' ? error.code : 'cloud-startup-failed',
      })
    );
    process.exitCode = 1;
  });

module.exports = { createProductionHost };
