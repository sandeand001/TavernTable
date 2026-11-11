/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionAuthority } from '../../../tools/session-authority.js';

let folder;
let authority;
const hostKey = 'deliberately-synthetic-test-host-key';
const cookie = (issued) => `tt-session=${issued.token}`;

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-session-'));
  authority = new SessionAuthority({ filename: path.join(folder, 'access.sqlite'), hostKey });
});
afterEach(async () => {
  authority.close();
  await fs.rm(folder, { recursive: true, force: true });
});

test('expired and explicitly signed-out cookies cannot authenticate again', () => {
  authority.close();
  let time = 1000;
  authority = new SessionAuthority({
    filename: path.join(folder, 'access.sqlite'),
    hostKey,
    now: () => time,
    sessionTtlMs: 1000,
  });
  const dm = authority.signInHost(hostKey);
  const invite = authority.createInvite(dm.session, 'campaign', 'Player');
  const player = authority.join(invite.invite);
  time += 1001;
  expect(authority.authenticate(cookie(dm))).toBeNull();
  expect(authority.authenticate(cookie(player))).toBeNull();
  const renewed = authority.signInHost(hostKey);
  authority.logout(cookie(renewed));
  expect(authority.authenticate(cookie(renewed))).toBeNull();
});

test('private invitations retain assigned saved characters after server restart', () => {
  const dm = authority.signInHost(hostKey).session;
  const invitation = authority.createInvite(dm, 'campaign', 'Player');
  authority.assignCharacter(dm, 'campaign', invitation.id, 'saved-character', true);
  authority.publishMap(dm, 'campaign', 'visible-map', true);
  authority.close();
  authority = new SessionAuthority({ filename: path.join(folder, 'access.sqlite'), hostKey });
  const returning = authority.join(invitation.invite);
  expect(authority.profile(returning.session)).toMatchObject({
    role: 'player',
    playerId: invitation.id,
    campaignId: 'campaign',
    characterIds: ['saved-character'],
  });
  expect(authority.publishedMapIds('campaign')).toEqual(['visible-map']);
  expect(authority.authenticate(cookie(returning))).toBe(returning.session);
});

test('players cannot grant ownership, publish maps or mint invitations, and revocation ends existing access', () => {
  const dm = authority.signInHost(hostKey).session;
  const invitation = authority.createInvite(dm, 'campaign', 'Player');
  const player = authority.join(invitation.invite);
  expect(() => authority.createInvite(player.session, 'campaign', 'Another')).toThrow('DM');
  expect(() =>
    authority.assignCharacter(player.session, 'campaign', invitation.id, 'other', true)
  ).toThrow('DM');
  expect(() => authority.publishMap(player.session, 'campaign', 'hidden', true)).toThrow('DM');
  expect(JSON.stringify(authority.summary(dm, 'campaign'))).not.toContain(invitation.invite);
  authority.revokeInvite(dm, 'campaign', invitation.id);
  expect(authority.authenticate(cookie(player))).toBeNull();
  expect(() => authority.join(invitation.invite)).toThrow('revoked');
  expect(() => authority.signInHost('wrong')).toThrow('incorrect');
});

test('reissuing a player invitation preserves identity and assignments while invalidating the old link and cookies', () => {
  const dm = authority.signInHost(hostKey).session;
  const before = authority.createInvite(dm, 'campaign', 'Player');
  authority.assignCharacter(dm, 'campaign', before.id, 'character', true);
  const session = authority.join(before.invite);
  const after = authority.createInvite(dm, 'campaign', 'Player', before.id);
  expect(after.id).toBe(before.id);
  expect(() => authority.join(before.invite)).toThrow('revoked');
  expect(authority.authenticate(cookie(session))).toBeNull();
  expect(authority.profile(authority.join(after.invite).session).characterIds).toEqual([
    'character',
  ]);
  expect(authority.cookie('value', true)).toContain('HttpOnly; SameSite=Strict');
  expect(authority.cookie('value', true)).toContain('Secure');
});

test('signed-out cached session objects cannot authorize an in-flight player command or DM grant', () => {
  const dm = authority.signInHost(hostKey);
  const invite = authority.createInvite(dm.session, 'campaign', 'Player');
  authority.assignCharacter(dm.session, 'campaign', invite.id, 'character', true);
  const player = authority.join(invite.invite);
  const grant = authority.grantPlacement(dm.session, 'campaign', invite.id, 'character', {
    mapId: 'map-main',
    gridX: 1,
    gridY: 1,
  });
  authority.logout(cookie(player));
  expect(() => authority.profile(player.session)).toThrow();
  expect(() => authority.placementGrant(player.session, grant.id)).toThrow();
  authority.logout(cookie(dm));
  expect(() => authority.requireDM(dm.session)).toThrow();
});

test('unassigning a character revokes its explicit placement grant and reassignment cannot resurrect that grant', () => {
  const dm = authority.signInHost(hostKey).session;
  const invite = authority.createInvite(dm, 'campaign', 'Player');
  authority.assignCharacter(dm, 'campaign', invite.id, 'character', true);
  const player = authority.join(invite.invite).session;
  const grant = authority.grantPlacement(dm, 'campaign', invite.id, 'character', {
    mapId: 'map-main',
    gridX: 1,
    gridY: 1,
  });
  expect(authority.placementGrants(player)).toHaveLength(1);
  authority.assignCharacter(dm, 'campaign', invite.id, 'character', false);
  expect(authority.profile(player).characterIds).toEqual([]);
  expect(authority.placementGrants(player)).toEqual([]);
  authority.assignCharacter(dm, 'campaign', invite.id, 'character', true);
  expect(authority.placementGrants(player)).toEqual([]);
  expect(() => authority.placementGrant(player, grant.id)).toThrow('not authorized');
});
