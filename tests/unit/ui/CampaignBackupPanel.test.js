import CampaignBackupPanel from '../../../src/ui/campaigns/CampaignBackupPanel.js';

test('cloud history offers complete downloads without exposing the not-yet-verified restore action', async () => {
  const workspace = {
    store: {
      storageInfo: { kind: 'cloud' },
      capabilities: { backupRestore: false },
      backupStatus: async () => ({
        state: 'pending',
        error: null,
        intervalMs: 300000,
        retain: 20,
        latest: { createdAt: '2026-11-06T01:00:00Z' },
      }),
      listBackups: async () => [
        {
          name: '11111111-1111-4111-8111-111111111111',
          createdAt: '2026-11-06T01:00:00Z',
          bytes: 1024,
        },
      ],
    },
  };
  const panel = new CampaignBackupPanel({ workspace, campaignId: 'original' });
  try {
    await panel.open();
    expect(panel.root.querySelector('[data-download-backup]')).not.toBeNull();
    expect(panel.root.querySelector('[data-restore-backup]')).toBeNull();
    expect(panel.status.textContent).toContain('active online work');
    expect(panel.status.textContent).toContain('pending');
  } finally {
    panel.destroy();
  }
});

test('opening history does not keep a stale failure after that same request completes pending cloud work', async () => {
  const point = {
    name: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-11-06T01:00:00Z',
    bytes: 1024,
    generation: 1,
  };
  let completed = false;
  const workspace = {
    store: {
      storageInfo: { kind: 'cloud' },
      capabilities: { backupRestore: false },
      async listBackups() {
        await Promise.resolve();
        completed = true;
        return [point];
      },
      async backupStatus() {
        return {
          state: completed ? 'saved' : 'error',
          error: completed ? null : 'Earlier interrupted job',
          latest: completed ? point : null,
          intervalMs: 300000,
          retain: 20,
        };
      },
    },
  };
  const panel = new CampaignBackupPanel({ workspace, campaignId: 'original' });
  try {
    await panel.open();
    expect(panel.status.textContent).not.toContain('failed');
    expect(panel.status.textContent).toContain('Latest:');
    expect(panel.root.querySelector('[data-download-backup]')).not.toBeNull();
  } finally {
    panel.destroy();
  }
});

test('backup history restores a separate copy and leaves the active campaign untouched', async () => {
  const onRestored = jest.fn();
  const workspace = {
    store: {
      backupStatus: jest.fn(async () => ({
        state: 'saved',
        intervalMs: 300000,
        retain: 20,
        latest: { createdAt: '2026-11-06T01:00:00Z' },
      })),
      listBackups: jest.fn(async () => [
        {
          name: 'backup-example.json',
          createdAt: '2026-11-06T01:00:00Z',
          bytes: 1024,
        },
      ]),
    },
    restoreBackup: jest.fn(async () => ({ id: 'new-copy', name: 'Restored campaign' })),
  };
  const previous = document.createElement('button');
  previous.inert = false;
  document.body.append(previous);
  const panel = new CampaignBackupPanel({ workspace, campaignId: 'original', onRestored });
  try {
    await panel.open();
    expect(previous.inert).toBe(true);
    panel.root.querySelector('[data-restore-backup]').click();
    for (let step = 0; step < 12 && panel.busy; step++) await Promise.resolve();
    expect(workspace.restoreBackup).toHaveBeenCalledWith('original', 'backup-example.json');
    expect(onRestored).toHaveBeenCalledWith({ id: 'new-copy', name: 'Restored campaign' });
    expect(panel.status.textContent).toContain('current campaign is unchanged');
  } finally {
    panel.destroy();
    expect(previous.inert).toBe(false);
    previous.remove();
  }
});
