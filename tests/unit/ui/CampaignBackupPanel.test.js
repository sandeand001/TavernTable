import CampaignBackupPanel from '../../../src/ui/campaigns/CampaignBackupPanel.js';

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
