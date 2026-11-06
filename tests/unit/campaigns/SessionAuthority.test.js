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
