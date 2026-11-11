/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test.each(['state', 'commit'])(
  'assignment revocation during %s loading cannot read or write formerly owned character records',
  async (operation) => {
    const root = path.resolve(__dirname, '..', '..');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-authority-race-'));
    const program = `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const {pathToFileURL} = require('node:url');
    const root = process.argv[1], directory = process.argv[2], operation = process.argv[3];
    const {SqliteCampaignStorage} = require(path.join(root,'tools','campaign-storage.js'));
    const {SessionAuthority} = require(path.join(root,'tools','session-authority.js'));
    const {HostResources} = require(path.join(root,'tools','host-resources.js'));
    const {PlayerCampaigns} = require(path.join(root,'tools','player-campaigns.js'));
    const manifest = require(path.join(root,'assets','data','resources','manifest.json'));
    (async () => {
      const [{default:CampaignStore},{default:CampaignCharacters}] = await Promise.all(
        ['CampaignStore','CampaignCharacters'].map(name => import(pathToFileURL(path.join(root,'src','campaigns',name+'.js')).href)));
      const storage = new SqliteCampaignStorage(path.join(directory,'campaigns.sqlite'));
      const store = new CampaignStore({packs:manifest.packs,storage});
      const authority = new SessionAuthority({filename:path.join(directory,'access.sqlite'),hostKey:'synthetic-authority-race-fixture-key'});
      try {
        const campaign = await store.create({name:'Authorization race fixture',ruleset:'2024'});
        const resources = new HostResources({root,manifest});
        const catalog = await resources.catalog(campaign);
        const state = await store.readCharacters(campaign.id);
        const library = new CampaignCharacters({...state,store,catalog});
        const characterId = await library.create('Assigned fixture character');
        const dm = authority.signInHost('synthetic-authority-race-fixture-key').session;
        const invitation = authority.createInvite(dm,campaign.id,'Fixture player');
        authority.assignCharacter(dm,campaign.id,invitation.id,characterId,true);
        const player = authority.join(invitation.invite).session;
        const before = await store.readCharacters(campaign.id);
        const records = before.records.map(row => {
          if (!row.key.startsWith('taverntable.character.v1.')) return row;
          const record = JSON.parse(row.value);
          record.hp.current = 0;
          return {...row,value:JSON.stringify(record)};
        });
        let entered, release;
        const loading = new Promise(resolve => {entered=resolve;});
        const barrier = new Promise(resolve => {release=resolve;});
        const players = new PlayerCampaigns({root,store,authority,resources:{catalog:async record => {
          entered(); await barrier; return resources.catalog(record);
        }}});
        const response = operation === 'state' ? players.state(player,{})
          : players.commit(player,campaign.id,{ruleset:campaign.ruleset,revision:before.revision,records});
        await loading;
        authority.assignCharacter(dm,campaign.id,invitation.id,characterId,false);
        release();
        await assert.rejects(response,error => error.status === 403 || error.status === 401);
        assert.deepEqual(await store.readCharacters(campaign.id),before);
        process.stdout.write('Revoked records were not accessed');
      } finally { await store.close(); authority.close(); }
    })().catch(error => { console.error(error); process.exitCode=1; });
  `;
    try {
      const result = await promisify(execFile)(
        process.execPath,
        ['-e', program, root, directory, operation],
        {
          cwd: root,
          timeout: 20000,
          maxBuffer: 200000,
        }
      );
      expect(result.stdout).toBe('Revoked records were not accessed');
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
  30000
);
