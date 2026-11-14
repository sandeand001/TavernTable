import CloudLiveSessionControls from '../../../src/ui/sessions/CloudLiveSessionControls.js';
import CloudHostSessionUpdates from '../../../src/ui/sessions/CloudHostSessionUpdates.js';

jest.mock('../../../src/ui/sessions/CloudHostSessionUpdates.js', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    ready: Promise.resolve(),
    close: jest.fn(async () => {}),
  })),
}));

function fixture(live = false) {
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  let session = {
    version: 1,
    campaignId,
    generation: live ? 1 : 0,
    state: live ? 'live' : 'paused',
    sessionId: live ? sessionId : null,
    startedAt: live ? '2026-11-14T00:00:00.000Z' : null,
    lastMeaningfulAt: live ? '2026-11-14T00:00:00.000Z' : null,
    pausedAt: null,
    pauseReason: live ? null : 'not-started',
  };
  const order = [];
  const access = {
    version: 1,
    uid: 'owner-a',
    campaignId,
    role: 'owner',
    seatId: null,
    accessGeneration: 0,
  };
  const store = {
    storageInfo: { kind: 'cloud' },
    uid: access.uid,
    getLiveSession: jest.fn(async () => JSON.parse(JSON.stringify(session))),
    getParticipantAccess: jest.fn(async () => ({ access })),
    controlLiveSession: jest.fn(async (_id, action, captured) => {
      expect(captured.generation).toBe(session.generation);
      order.push(action);
      session = {
        ...session,
        generation: session.generation + 1,
        state: action === 'end' ? 'paused' : 'live',
        sessionId,
        startedAt: '2026-11-14T00:00:00.000Z',
        lastMeaningfulAt: '2026-11-14T00:00:00.000Z',
        pausedAt: action === 'end' ? '2026-11-14T00:01:00.000Z' : null,
        pauseReason: action === 'end' ? 'owner-end' : null,
      };
      return JSON.parse(JSON.stringify(session));
    }),
    finishBackupSession: jest.fn(async () => {
      order.push('backup');
    }),
  };
  const services = {
    campaign: { id: campaignId },
    workspace: { store },
    autosave: {
      flush: jest.fn(async () => {
        order.push('autosave');
      }),
    },
    library: {
      flush: jest.fn(async () => {
        order.push('library');
      }),
    },
  };
  return { campaignId, sessionId, order, access, store, services };
}

beforeEach(() => jest.clearAllMocks());

test('opening a paused owner workspace does not start a game or stream; explicit Start and Pause flush before authority and finish a backup', async () => {
  const { campaignId, sessionId, order, access, store, services } = fixture();
  const parent = document.createElement('section');
  document.body.append(parent);
  const controls = new CloudLiveSessionControls({ gameManager: {}, services, parent });
  try {
    await controls.ready;
    expect(controls.root.querySelector('[role="status"]').textContent).toContain('paused');
    expect(store.controlLiveSession).not.toHaveBeenCalled();
    expect(CloudHostSessionUpdates).not.toHaveBeenCalled();
    controls.root.querySelector('[data-cloud-live-start]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['autosave', 'library', 'start']);
    expect(CloudHostSessionUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        access,
        services,
      })
    );
    controls.root.querySelector('[data-cloud-live-pause]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['autosave', 'library', 'start', 'autosave', 'library', 'end', 'backup']);
    expect(store.finishBackupSession).toHaveBeenCalledWith(campaignId);
    expect(controls.root.querySelector('[role="status"]').textContent).toContain('paused');
  } finally {
    await controls.close();
    parent.remove();
  }
});

test('closing a returning owner during access admission cannot create a late world stream or live save binding', async () => {
  const { store, services, access } = fixture(true);
  let admit;
  store.getParticipantAccess.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        admit = resolve;
      })
  );
  const parent = document.createElement('section');
  document.body.append(parent);
  const controls = new CloudLiveSessionControls({ gameManager: {}, services, parent });
  try {
    for (let step = 0; step < 20 && !admit; step++) await Promise.resolve();
    expect(admit).toEqual(expect.any(Function));
    await controls.close();
    admit({ access });
    await controls.ready;
    expect(CloudHostSessionUpdates).not.toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
    expect(store.controlLiveSession).not.toHaveBeenCalled();
  } finally {
    await controls.close();
    parent.remove();
  }
});
