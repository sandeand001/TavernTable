const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { startLocalHost } = require('../../tools/local-host.js');

const root = path.resolve(__dirname, '..', '..');
let host;

function within(directory, filename) {
  const relative = path.relative(directory, filename);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function start() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '0' },
      'data-dir': { type: 'string' },
    },
  });
  if (!values['data-dir']) throw new Error('An explicit fresh test data directory is required');
  const dataDirectory = path.resolve(values['data-dir']);
  try {
    if ((await fs.readdir(dataDirectory)).length)
      throw new Error('The test data directory must be new or empty; existing data was not opened');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const dependencies = new Map();
  for (const [name, version] of [
    ['three', '0.170.0'],
    ['cannon-es', '0.20.0'],
  ]) {
    const directory = await fs.realpath(path.join(root, 'node_modules', name));
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    if (manifest.version !== version)
      throw new Error(`The installed ${name} must match the app's pinned version ${version}`);
    dependencies.set(name, directory);
  }
  host = await startLocalHost({
    root,
    port: Number(values.port),
    dataDirectory,
    publicOrigin: null,
  });
  const sessionResponse = await fetch(host.url + '/api/session/host', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: (await fs.readFile(host.hostKeyFile, 'utf8')).trim() }),
  });
  if (!sessionResponse.ok)
    throw new Error(`The isolated host sign-in failed with HTTP ${sessionResponse.status}`);
  const identity = await sessionResponse.json();
  const cookie = sessionResponse.headers.get('set-cookie');
  if (identity.role !== 'dm' || !cookie)
    throw new Error('The isolated host did not issue a DM session');

  const handlers = host.server.listeners('request');
  if (handlers.length !== 1) throw new Error('The app host has an unexpected request handler');
  host.server.removeListener('request', handlers[0]);
  host.server.on('request', (request, response) => {
    serve(request, response).catch((error) => {
      console.error('[Traversal test host]', error);
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(error.status || 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.message);
    });
  });

  async function serve(request, response) {
    const port = host.server.address().port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(request.headers.host))
      throw Object.assign(new Error('The test app is available on loopback only'), { status: 403 });
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (
      (request.headers.origin && request.headers.origin !== url.origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      request.headers.forwarded ||
      request.headers['x-forwarded-proto']
    )
      throw Object.assign(new Error('Cross-origin or forwarded test requests are not allowed'), {
        status: 403,
      });
    const custom =
      pathname === '/' || pathname === '/index.html' || pathname.startsWith('/__test-deps/');
    if (!custom) return handlers[0].call(host.server, request, response);
    if (!['GET', 'HEAD'].includes(request.method))
      throw Object.assign(new Error('Use GET or HEAD for test app files'), { status: 405 });
    if (pathname.startsWith('/__test-deps/')) {
      const [name, ...parts] = pathname.slice('/__test-deps/'.length).split('/');
      const directory = dependencies.get(name);
      if (
        !directory ||
        !parts.length ||
        parts.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '..') ||
        !parts.at(-1).endsWith('.js')
      )
        throw Object.assign(new Error('Unsupported local dependency path'), { status: 403 });
      const candidate = path.resolve(directory, ...parts);
      if (!within(directory, candidate))
        throw Object.assign(new Error('Invalid local dependency path'), { status: 403 });
      const filename = await fs.realpath(candidate);
      if (!within(directory, filename))
        throw Object.assign(new Error('Invalid resolved dependency path'), { status: 403 });
      const stat = await fs.stat(filename);
      if (!stat.isFile()) throw new Error('The local dependency is not a file');
      response.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : await fs.readFile(filename));
      return;
    }
    const html = (await fs.readFile(path.join(root, 'index.html'), 'utf8'))
      .replaceAll('https://cdn.jsdelivr.net/npm/three@0.170.0/', '/__test-deps/three/')
      .replaceAll('https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/', '/__test-deps/cannon-es/')
      .replace(
        '<body>',
        '<body><div style="position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:10000;padding:5px 12px;background:#21334d;color:white;font:13px system-ui;pointer-events:none">ISOLATED TRAVERSAL TEST - separate campaign data</div>'
      );
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store',
      'Set-Cookie': cookie,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  }

  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    try {
      await host.close();
    } catch (error) {
      console.error('[Traversal test shutdown]', error);
      process.exitCode = 1;
    }
  }
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  console.log(
    `Traversal test app ready ${JSON.stringify({ url: host.url, dataDirectory, pid: process.pid })}`
  );
}

start().catch(async (error) => {
  console.error('[Traversal test startup]', error);
  if (host) {
    try {
      await host.close();
    } catch (closeError) {
      console.error('[Traversal test startup cleanup]', closeError);
    }
  }
  process.exitCode = 1;
});
