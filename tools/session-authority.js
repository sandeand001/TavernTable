const { DatabaseSync } = require('node:sqlite');
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');

const digest = (value) => createHash('sha256').update(value).digest('hex');
const denied = (message = 'This operation requires the DM') =>
  Object.assign(new Error(message), { status: 403 });

class SessionAuthority {
  constructor({ filename, hostKey, now = Date.now, sessionTtlMs = 43200000 }) {
    if (typeof hostKey !== 'string' || hostKey.length < 16)
      throw new Error('The host access key is invalid');
    this.hostHash = Buffer.from(digest(hostKey), 'hex');
    this.now = now;
    this.sessionTtlMs = sessionTtlMs;
    this.sessions = new Map();
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, name TEXT NOT NULL,
        invite_hash TEXT NOT NULL UNIQUE, revoked INTEGER NOT NULL DEFAULT 0,
        generation INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS assignments (
        player_id TEXT NOT NULL REFERENCES players(id),
        character_id TEXT NOT NULL,
        PRIMARY KEY(player_id, character_id)
      );
      CREATE TABLE IF NOT EXISTS published_maps (
        campaign_id TEXT NOT NULL, map_id TEXT NOT NULL,
        PRIMARY KEY(campaign_id, map_id)
      );
      CREATE TABLE IF NOT EXISTS placement_grants (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id),
        character_id TEXT NOT NULL,
        map_id TEXT NOT NULL,
        grid_x INTEGER NOT NULL,
        grid_y INTEGER NOT NULL,
        surface_id TEXT,
        UNIQUE(player_id, character_id)
      );
    `);
  }

  _issue(role, playerId = null, generation = null) {
    const token = randomBytes(32).toString('base64url');
    const session = {
      id: randomUUID(),
      role,
      playerId,
      generation,
      csrf: randomBytes(32).toString('base64url'),
      expiresAt: this.now() + this.sessionTtlMs,
    };
    this.sessions.set(digest(token), session);
    return { token, session };
  }

  signInHost(key) {
    if (
      typeof key !== 'string' ||
      key.length > 512 ||
      !timingSafeEqual(this.hostHash, Buffer.from(digest(key), 'hex'))
    )
      throw Object.assign(new Error('The host access key is incorrect'), { status: 401 });
    return this._issue('dm');
  }

  join(invite) {
    if (typeof invite !== 'string' || invite.length > 512)
      throw Object.assign(new Error('The invitation is invalid or revoked'), { status: 401 });
    const player = this.database
      .prepare('SELECT id, generation FROM players WHERE invite_hash = ? AND revoked = 0')
      .get(digest(invite));
    if (!player)
      throw Object.assign(new Error('The invitation is invalid or revoked'), { status: 401 });
    return this._issue('player', player.id, player.generation);
  }

  authenticate(cookie, name = 'tt-session') {
    const token = (cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + '='))
      ?.slice(name.length + 1);
    if (!token) return null;
    const key = digest(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (
      session.expiresAt <= this.now() ||
      (session.role === 'player' &&
        this._player(session.playerId)?.generation !== session.generation)
    ) {
      this.sessions.delete(key);
      return null;
    }
    return session;
  }

  logout(cookie, name = 'tt-session') {
    const token = (cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + '='))
      ?.slice(name.length + 1);
    if (token) this.sessions.delete(digest(token));
  }

  cookie(token, secure = false, name = 'tt-session') {
    return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.sessionTtlMs / 1000)}${secure ? '; Secure' : ''}`;
  }

  _player(id) {
    return this.database
      .prepare(
        'SELECT id, campaign_id AS campaignId, name, generation FROM players WHERE id = ? AND revoked = 0'
      )
      .get(id);
  }

  _assertSession(session) {
    if (
      !session ||
      session.expiresAt <= this.now() ||
      ![...this.sessions.values()].includes(session)
    )
      throw Object.assign(new Error('Sign in as the host or join with a private invitation'), {
        status: 401,
      });
  }

  profile(session) {
    this._assertSession(session);
    if (session.role === 'dm') return { id: session.id, role: 'dm', csrf: session.csrf };
    const player = this._player(session.playerId);
    if (!player || player.generation !== session.generation)
      throw denied('This invitation was revoked');
    return {
      id: session.id,
      role: 'player',
      csrf: session.csrf,
      playerId: player.id,
      campaignId: player.campaignId,
      name: player.name,
      characterIds: this.ownedCharacterIds(session),
    };
  }

  requireDM(session) {
    if (this.profile(session).role !== 'dm') throw denied();
  }

  createInvite(session, campaignId, name, playerId = null) {
    this.requireDM(session);
    if (
      typeof campaignId !== 'string' ||
      !campaignId ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 80
    )
      throw new Error('A player invitation needs a campaign and a name of at most 80 characters');
    const existing = playerId
      ? this.database
          .prepare('SELECT campaign_id AS campaignId FROM players WHERE id = ?')
          .get(playerId)
      : null;
    if (playerId && existing?.campaignId !== campaignId)
      throw new Error('The player does not belong to this campaign');
    const id = playerId || randomUUID();
    const invite = randomBytes(32).toString('base64url');
    this.database
      .prepare(
        `
      INSERT INTO players(id, campaign_id, name, invite_hash, revoked) VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, invite_hash = excluded.invite_hash,
        revoked = 0, generation = players.generation + 1
    `
      )
      .run(id, campaignId, name.trim(), digest(invite));
    this._invalidatePlayer(id);
    return { id, name: name.trim(), invite };
  }

  _invalidatePlayer(playerId) {
    for (const [key, session] of this.sessions)
      if (session.playerId === playerId) this.sessions.delete(key);
  }

  revokeInvite(session, campaignId, playerId) {
    this.requireDM(session);
    const changed = this.database
      .prepare('UPDATE players SET revoked = 1 WHERE id = ? AND campaign_id = ?')
      .run(playerId, campaignId);
    if (!changed.changes) throw new Error('The player invitation was not found');
    this._invalidatePlayer(playerId);
    return { revoked: true };
  }

  assignCharacter(session, campaignId, playerId, characterId, assigned) {
    this.requireDM(session);
    if (
      this._player(playerId)?.campaignId !== campaignId ||
      typeof characterId !== 'string' ||
      !characterId ||
      typeof assigned !== 'boolean'
    )
      throw new Error('Choose a player and saved character in this campaign');
    if (assigned)
      this.database
        .prepare('INSERT OR IGNORE INTO assignments(player_id, character_id) VALUES (?, ?)')
        .run(playerId, characterId);
    else {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.database
          .prepare('DELETE FROM assignments WHERE player_id = ? AND character_id = ?')
          .run(playerId, characterId);
        this.database
          .prepare('DELETE FROM placement_grants WHERE player_id = ? AND character_id = ?')
          .run(playerId, characterId);
        this.database.exec('COMMIT');
      } catch (error) {
        try {
          this.database.exec('ROLLBACK');
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Character unassignment could not roll back'
          );
        }
        throw error;
      }
    }
    return { assigned };
  }

  ownedCharacterIds(session) {
    this._assertSession(session);
    if (session?.role !== 'player' || !this._player(session.playerId))
      throw denied('The player session is unavailable');
    return this.database
      .prepare(
        'SELECT character_id AS id FROM assignments WHERE player_id = ? ORDER BY character_id'
      )
      .all(session.playerId)
      .map((row) => row.id);
  }

  grantPlacement(session, campaignId, playerId, characterId, destination) {
    this.requireDM(session);
    const assignment = this.database
      .prepare('SELECT 1 FROM assignments WHERE player_id = ? AND character_id = ?')
      .get(playerId, characterId);
    if (
      this._player(playerId)?.campaignId !== campaignId ||
      !assignment ||
      typeof destination?.mapId !== 'string' ||
      !Number.isInteger(destination.gridX) ||
      !Number.isInteger(destination.gridY)
    )
      throw new Error('Choose an assigned character and explicit placement destination');
    const id = randomUUID();
    this.database
      .prepare(
        'INSERT INTO placement_grants(id, player_id, character_id, map_id, grid_x, grid_y, surface_id) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(player_id, character_id) DO UPDATE SET id = excluded.id, map_id = excluded.map_id, grid_x = excluded.grid_x, grid_y = excluded.grid_y, surface_id = excluded.surface_id'
      )
      .run(
        id,
        playerId,
        characterId,
        destination.mapId,
        destination.gridX,
        destination.gridY,
        destination.surfaceId ?? null
      );
    return { id, characterId, ...destination };
  }

  placementGrant(session, id) {
    const profile = this.profile(session);
    const row = this.database
      .prepare(
        'SELECT id, player_id AS playerId, character_id AS characterId, map_id AS mapId, grid_x AS gridX, grid_y AS gridY, surface_id AS surfaceId FROM placement_grants WHERE id = ?'
      )
      .get(id);
    if (
      profile.role !== 'player' ||
      row?.playerId !== profile.playerId ||
      !profile.characterIds.includes(row.characterId)
    )
      throw denied('This placement destination is not authorized');
    return row;
  }

  placementGrants(session) {
    const profile = this.profile(session);
    if (profile.role !== 'player') throw denied();
    return this.database
      .prepare('SELECT id FROM placement_grants WHERE player_id = ?')
      .all(profile.playerId)
      .map(({ id }) => this.placementGrant(session, id));
  }

  publishMap(session, campaignId, mapId, published) {
    this.requireDM(session);
    if (typeof mapId !== 'string' || !mapId || typeof published !== 'boolean')
      throw new Error('Choose a map and its publication state');
    if (published)
      this.database
        .prepare('INSERT OR IGNORE INTO published_maps(campaign_id, map_id) VALUES (?, ?)')
        .run(campaignId, mapId);
    else
      this.database
        .prepare('DELETE FROM published_maps WHERE campaign_id = ? AND map_id = ?')
        .run(campaignId, mapId);
    return { published };
  }

  publishedMapIds(campaignId) {
    return this.database
      .prepare('SELECT map_id AS id FROM published_maps WHERE campaign_id = ? ORDER BY map_id')
      .all(campaignId)
      .map((row) => row.id);
  }

  summary(session, campaignId) {
    this.requireDM(session);
    return {
      players: this.database
        .prepare('SELECT id, name, revoked FROM players WHERE campaign_id = ? ORDER BY name')
        .all(campaignId)
        .map((player) => ({
          ...player,
          revoked: !!player.revoked,
          characterIds: this.database
            .prepare(
              'SELECT character_id AS id FROM assignments WHERE player_id = ? ORDER BY character_id'
            )
            .all(player.id)
            .map((row) => row.id),
        })),
      publishedMapIds: this.publishedMapIds(campaignId),
    };
  }

  close() {
    this.sessions.clear();
    this.database.close();
  }
}

module.exports = { SessionAuthority };
