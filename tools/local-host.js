const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { parseArgs } = require('node:util');
const { SqliteCampaignStorage } = require('./campaign-storage.js');
const { CampaignBackups } = require('./campaign-backups.js');
const { SessionAuthority } = require('./session-authority.js');
const { HostResources } = require('./host-resources.js');
const { PlayerCampaigns } = require('./player-campaigns.js');
const { PlayerGameplay } = require('./player-gameplay.js');

const operations = new Map([
  ['create', 1],
  ['get', 1],
  ['list', 0],
  ['update', 2],
  ['readCharacters', 1],
  ['readScene', 1],
  ['commitScene', 2],
  ['commitCharacters', 2],
  ['importBackup', 1],
  ['backupNow', 1],
  ['listBackups', 1],
  ['readBackup', 2],
  ['backupStatus', 1],
  ['sessionInfo', 1],
  ['createInvite', 2],
  ['revokeInvite', 2],
  ['assignCharacter', 4],
  ['publishMap', 3],
  ['playerState', 1],
  ['playerCommit', 2],
  ['doorState', 2],
  ['playerCommand', 2],
  ['grantPlacement', 4],
]);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
};

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function defaultDataDirectory() {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'TavernTable');
}

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

function requestBody(request, maximum = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximum) {
        if (!exceeded) reject(failure(413, 'The request exceeds its size limit'));
        exceeded = true;
        chunks.length = 0;
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      if (exceeded) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(failure(400, `The campaign request is not valid JSON: ${error.message}`));
      }
    });
  });
}

async function loadHostKey(directory) {
  const filename = path.join(directory, 'host-access-key');
  let value;
  try {
    value = await fs.readFile(filename, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    value = randomBytes(32).toString('hex');
    try {
      await fs.writeFile(filename, value + '\n', { flag: 'wx', mode: 0o600 });
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      value = await fs.readFile(filename, 'utf8');
    }
  }
  value = value.trim();
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error('The saved host access key is invalid; it was not overwritten');
  return value;
}

async function startLocalHost({
  port = 3000,
  root = path.resolve(__dirname, '..'),
  dataDirectory = process.env.TAVERNTABLE_DATA_DIR || defaultDataDirectory(),
  backupIntervalMs = 300000,
  backupRetain = 20,
  publicOrigin = process.env.TAVERNTABLE_PUBLIC_ORIGIN || null,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('Choose a valid local host port');
  if (publicOrigin) {
    const external = new URL(publicOrigin);
    if (
      external.protocol !== 'https:' ||
      external.pathname !== '/' ||
      external.search ||
      external.hash ||
      external.username ||
      external.password
    )
      throw new Error('The public origin must be an HTTPS origin without a path or credentials');
    publicOrigin = external.origin;
  }
  root = await fs.realpath(root);
  dataDirectory = path.resolve(dataDirectory);
  const relativeData = path.relative(root, dataDirectory);
  if (
    !relativeData ||
    (!relativeData.startsWith('..' + path.sep) && !path.isAbsolute(relativeData))
  )
    throw new Error('Campaign data must be outside the served project directory');
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  dataDirectory = await fs.realpath(dataDirectory);
  const resolvedData = path.relative(root, dataDirectory);
  if (
    !resolvedData ||
    (!resolvedData.startsWith('..' + path.sep) && !path.isAbsolute(resolvedData))
  )
    throw new Error('Campaign data must resolve outside the served project directory');
  const { default: CampaignStore } = await import(
    pathToFileURL(path.join(root, 'src', 'campaigns', 'CampaignStore.js')).href
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'assets', 'data', 'resources', 'manifest.json'), 'utf8')
  );
  const storage = new SqliteCampaignStorage(path.join(dataDirectory, 'campaigns.sqlite'));
  const store = new CampaignStore({ packs: manifest.packs, storage });
  const hostKey = await loadHostKey(dataDirectory);
  const authority = new SessionAuthority({
    filename: path.join(dataDirectory, 'access.sqlite'),
    hostKey,
  });
  const resources = new HostResources({ root, manifest });
  const players = new PlayerCampaigns({ root, store, authority, resources });
  const gameplay = new PlayerGameplay({ root, players });
  const backups = new CampaignBackups({
    directory: path.join(dataDirectory, 'backups'),
    store,
    intervalMs: backupIntervalMs,
    retain: backupRetain,
  });
  for (const campaign of await store.list()) backups.changedCampaign(campaign.id);
  const streams = new Set();
  const broadcast = (campaignId, actorId, kind, revisions = null, presentations = []) => {
    for (const stream of streams) {
      const session = authority.authenticate(stream.cookie, stream.cookieName);
      if (!session) {
        stream.response.end();
        continue;
      }
      const profile = authority.profile(session);
      if (profile.role === 'dm' || profile.campaignId === campaignId)
        stream.response.write(
          `event: campaign\ndata: ${JSON.stringify({
            campaignId,
            actorId,
            kind,
            ...(revisions ? { version: 1, ...revisions } : {}),
            ...(presentations.length ? { hasPresentations: true } : {}),
            ...(profile.role === 'dm' && presentations.length ? { presentations } : {}),
          })}\n\n`
        );
    }
  };
  const loginAttempts = new Map();
  const server = http.createServer(async (request, response) => {
    try {
      const currentPort = server.address().port;
      const host = request.headers.host;
      const local = [`localhost:${currentPort}`, `127.0.0.1:${currentPort}`].includes(host);
      const external = publicOrigin && host === new URL(publicOrigin).host;
      if (!local && !external)
        throw failure(403, 'This hostname is not configured for the game host');
      if (!local && request.headers['x-forwarded-proto'] !== 'https')
        throw failure(426, 'Internet sessions require HTTPS through the configured trusted proxy');
      const origin = local ? `http://${host}` : publicOrigin;
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (
          (request.headers.origin && request.headers.origin !== origin) ||
          request.headers['sec-fetch-site'] === 'cross-site'
        )
          throw failure(403, 'Cross-origin campaign access is not allowed');
        const cookieName = `tt-session-${currentPort}`;
        const session = authority.authenticate(request.headers.cookie, cookieName);
        if (url.pathname === '/api/session' && request.method === 'GET') {
          jsonResponse(response, 200, authority.profile(session));
          return;
        }
        if (
          ['/api/session/host', '/api/session/join'].includes(url.pathname) &&
          request.method === 'POST'
        ) {
          if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json')
            throw failure(415, 'Sign-in requests require application/json');
          const remote = !local;
          if (
            url.pathname === '/api/session/host' &&
            (!local || request.headers['x-forwarded-proto'] || request.headers['forwarded'])
          )
            throw failure(403, 'Host sign-in is available only directly on the host computer');
          const key = `${request.socket.remoteAddress}:${url.pathname}`;
          const previous = loginAttempts.get(key);
          const attempts =
            previous && Date.now() - previous.since < 60000
              ? previous
              : { since: Date.now(), count: 0 };
          if (++attempts.count > 30)
            throw failure(429, 'Too many sign-in attempts. Wait a minute and retry.');
          loginAttempts.set(key, attempts);
          const credentials = await requestBody(request, 4096);
          const issued = url.pathname.endsWith('/host')
            ? authority.signInHost(credentials?.key)
            : authority.join(credentials?.invite);
          jsonResponse(response, 200, authority.profile(issued.session), {
            'Set-Cookie': authority.cookie(issued.token, remote, cookieName),
          });
          return;
        }
        const identity = authority.profile(session);
        if (url.pathname === '/api/events' && request.method === 'GET') {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            'X-Accel-Buffering': 'no',
          });
          response.write(': connected\n\n');
          const stream = { response, cookie: request.headers.cookie, cookieName };
          streams.add(stream);
          const timer = setInterval(() => {
            if (!authority.authenticate(stream.cookie, cookieName)) response.end();
            else response.write(': keepalive\n\n');
          }, 15000);
          timer.unref?.();
          response.on('close', () => {
            clearInterval(timer);
            streams.delete(stream);
          });
          return;
        }
        if (url.pathname === '/api/session/logout' && request.method === 'POST') {
          if (request.headers['x-taverntable-host'] !== identity.csrf)
            throw failure(403, 'Invalid session request');
          authority.logout(request.headers.cookie, cookieName);
          jsonResponse(
            response,
            200,
            { signedOut: true },
            {
              'Set-Cookie': `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${local ? '' : '; Secure'}`,
            }
          );
          for (const stream of streams)
            if (!authority.authenticate(stream.cookie, stream.cookieName)) stream.response.end();
          return;
        }
        if (url.pathname === '/api/host' && request.method === 'GET') {
          authority.requireDM(session);
          jsonResponse(response, 200, {
            version: 1,
            storage: 'host',
            dataDirectory,
            token: identity.csrf,
            identity,
            publicOrigin,
          });
          return;
        }
        if (url.pathname !== '/api/campaigns') throw failure(404, 'Unknown host endpoint');
        if (request.method !== 'POST') throw failure(405, 'Use POST for campaign requests');
        if (request.headers['x-taverntable-host'] !== identity.csrf)
          throw failure(
            403,
            'The local host restarted or this tab is not connected. Reload the campaign.'
          );
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json')
          throw failure(415, 'Campaign requests require application/json');
        const command = await requestBody(request);
        if (
          !command ||
          !operations.has(command.operation) ||
          !Array.isArray(command.args) ||
          command.args.length !== operations.get(command.operation)
        )
          throw failure(400, 'Unsupported campaign operation or arguments');
        if (
          identity.role === 'player' &&
          !['playerState', 'playerCommit', 'doorState', 'playerCommand'].includes(command.operation)
        )
          throw failure(403, 'Players can access only their assigned character workspace');
        const sessionOperations = {
          playerState: (options) => players.state(session, options),
          playerCommit: (id, change) => players.commit(session, id, change),
          doorState: (id, change) => players.doorState(session, id, change),
          playerCommand: (id, change) => gameplay.command(session, id, change),
          grantPlacement: (id, playerId, characterId, destination) =>
            gameplay.grant(session, id, playerId, characterId, destination),
          sessionInfo: async (id) => {
            authority.requireDM(session);
            const state = await store.readCharacters(id);
            return {
              ...authority.summary(session, id),
              characters: state.records
                .filter((row) => row.key.startsWith('taverntable.character.v1.'))
                .map((row) => {
                  const character = JSON.parse(row.value);
                  return { id: character.id, name: character.name };
                }),
              maps: players.published
                .maps(state.scene ? JSON.parse(state.scene) : null)
                .map(({ id: mapId, name }) => ({ id: mapId, name })),
            };
          },
          createInvite: async (id, options) => {
            await store.get(id);
            return authority.createInvite(session, id, options?.name, options?.playerId || null);
          },
          revokeInvite: (id, playerId) => authority.revokeInvite(session, id, playerId),
          assignCharacter: async (id, playerId, characterId, assigned) => {
            authority.requireDM(session);
            const state = await store.readCharacters(id);
            if (!state.records.some((row) => row.key === `taverntable.character.v1.${characterId}`))
              throw new Error('Choose an existing saved character in this campaign');
            return authority.assignCharacter(session, id, playerId, characterId, assigned);
          },
          publishMap: async (id, mapId, published) => {
            authority.requireDM(session);
            const state = await store.readScene(id);
            if (
              !players.published
                .maps(state.scene ? JSON.parse(state.scene) : null)
                .some((map) => map.id === mapId)
            )
              throw new Error('Save the board and choose an existing map before publishing it');
            return authority.publishMap(session, id, mapId, published);
          },
        };
        const backupOperations = {
          backupNow: (id) => backups.backupNow(id),
          listBackups: (id) => backups.list(id),
          readBackup: (id, name) => backups.read(id, name),
          backupStatus: (id) => backups.status(id),
        };
        if (Object.hasOwn(backupOperations, command.operation)) await store.get(command.args[0]);
        const sceneChange =
          command.operation === 'commitScene'
            ? command.args[1]
            : command.operation === 'commitCharacters'
              ? command.args[1]?.scene
              : null;
        let visitedScene = null;
        if (sceneChange?.trackRoomVisits === true) {
          visitedScene = JSON.parse(sceneChange.scene ?? sceneChange.value);
          if (
            visitedScene?.version !== 3 ||
            !Array.isArray(visitedScene.maps) ||
            !Array.isArray(visitedScene.creatures)
          )
            throw failure(400, 'Room discovery requires a connected scene checkpoint');
        }
        if (sceneChange && Object.hasOwn(sceneChange, 'presentations'))
          await players.validatePresentations(
            command.args[0],
            sceneChange.presentations,
            command.operation === 'commitScene' ? sceneChange.scene : sceneChange.value,
            sceneChange.revision,
            command.operation === 'commitScene'
              ? sceneChange.charactersRevision
              : command.args[1].revision
          );
        const result = Object.hasOwn(sessionOperations, command.operation)
          ? await sessionOperations[command.operation](...command.args)
          : Object.hasOwn(backupOperations, command.operation)
            ? await backupOperations[command.operation](...command.args)
            : await store[command.operation](...command.args);
        if (['create', 'importBackup'].includes(command.operation))
          backups.changedCampaign(result.id);
        else if (
          ['update', 'commitScene', 'commitCharacters', 'doorState'].includes(command.operation)
        )
          backups.changedCampaign(command.args[0]);
        else if (
          command.operation === 'playerCommit' ||
          (command.operation === 'playerCommand' && result.outcome !== 'duplicate')
        )
          backups.changedCampaign(identity.campaignId);
        const changedCampaign = ['create', 'importBackup'].includes(command.operation)
          ? result.id
          : ['playerCommit', 'playerCommand'].includes(command.operation)
            ? identity.campaignId
            : command.args[0];
        if (visitedScene) authority.recordRoomVisits(changedCampaign, visitedScene);
        const revisions =
          command.operation === 'playerCommand'
            ? result.applied
            : command.operation === 'commitScene'
              ? {
                  sceneRevision: result.revision,
                  charactersRevision: command.args[1].charactersRevision,
                }
              : command.operation === 'commitCharacters' && command.args[1]?.scene
                ? {
                    sceneRevision: result.sceneRevision,
                    charactersRevision: result.revision,
                  }
                : null;
        const presentations =
          result?.outcome === 'duplicate'
            ? []
            : command.operation === 'playerCommand' && result.receipt.motion
              ? [
                  {
                    commandId: result.commandId,
                    tokenId: result.receipt.tokenId,
                    kind: result.receipt.kind,
                    costFeet: result.receipt.costFeet,
                    budget: result.receipt.budget,
                    motion: result.receipt.motion,
                  },
                ]
              : sceneChange?.presentations || [];
        const shared = players.rememberPresentations(changedCampaign, presentations, revisions);
        if (
          result?.outcome !== 'duplicate' &&
          [
            'create',
            'importBackup',
            'update',
            'commitScene',
            'commitCharacters',
            'playerCommit',
            'doorState',
            'playerCommand',
            'createInvite',
            'revokeInvite',
            'assignCharacter',
            'publishMap',
            'grantPlacement',
          ].includes(command.operation)
        )
          broadcast(changedCampaign, identity.id, command.operation, revisions, shared);
        jsonResponse(response, 200, { result });
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw failure(405, 'Unsupported file request');
      const pathname = decodeURIComponent(url.pathname);
      const segments = pathname.split('/').filter(Boolean);
      if (
        segments.some((part) => part.startsWith('.')) ||
        ['node_modules', 'tools', 'tests'].includes(segments[0])
      )
        throw failure(404, 'File not found');
      const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      const relative = path.relative(root, filename);
      if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        throw failure(404, 'File not found');
      const resolved = await fs.realpath(filename);
      const realRelative = path.relative(root, resolved);
      if (realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative))
        throw failure(404, 'File not found');
      const stat = await fs.stat(resolved);
      if (!stat.isFile()) throw failure(404, 'File not found');
      response.writeHead(200, {
        'Content-Type':
          mimeTypes[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : await fs.readFile(resolved));
    } catch (error) {
      const status =
        error.status ||
        (error.code === 'ENOENT'
          ? 404
          : /changed in another window/.test(error.message)
            ? 409
            : error.code
              ? 500
              : 400);
      if (status >= 500) console.error('[TavernTable host]', error);
      if (response.headersSent) {
        response.destroy(error);
      } else {
        jsonResponse(response, status, {
          error:
            status >= 500
              ? 'The host could not save/read campaign data. Check its terminal and retry.'
              : error.message,
          ...(status < 500 &&
          typeof error.code === 'string' &&
          /^[a-z][a-z0-9-]{0,100}$/.test(error.code)
            ? { code: error.code }
            : {}),
          ...(status === 409 && error.current ? { current: error.current } : {}),
        });
      }
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    try {
      await backups.close();
    } finally {
      await store.close();
      authority.close();
    }
    throw error;
  }
  return {
    server,
    dataDirectory,
    hostKeyFile: path.join(dataDirectory, 'host-access-key'),
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      for (const stream of streams) stream.response.end();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      try {
        await backups.close();
      } finally {
        await store.close();
        authority.close();
      }
    },
  };
}

if (require.main === module) {
  (async () => {
    const { values } = parseArgs({
      options: {
        port: { type: 'string' },
        'data-dir': { type: 'string' },
        'public-origin': { type: 'string' },
      },
    });
    const host = await startLocalHost({
      port: values.port === undefined ? 3000 : Number(values.port),
      dataDirectory:
        values['data-dir'] || process.env.TAVERNTABLE_DATA_DIR || defaultDataDirectory(),
      publicOrigin: values['public-origin'] || process.env.TAVERNTABLE_PUBLIC_ORIGIN || null,
    });
    console.log(
      `TavernTable host ready ${JSON.stringify({ url: host.url, dataDirectory: host.dataDirectory })}`
    );
    console.log(`Host sign-in key file (private; do not share with players): ${host.hostKeyFile}`);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      try {
        await host.close();
        process.exitCode = 0;
      } catch (error) {
        console.error('[TavernTable host shutdown]', error);
        process.exitCode = 1;
      }
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  })().catch((error) => {
    console.error('[TavernTable host startup]', error);
    process.exitCode = 1;
  });
}

module.exports = { startLocalHost };
