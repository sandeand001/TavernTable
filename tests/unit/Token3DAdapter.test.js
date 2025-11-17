import { addTokenToCollection } from '../../src/managers/token-manager/internals/collection.js';

// Minimal hybrid-mode creation test for Token3DAdapter
// We mock dynamic import('three') by injecting a lightweight stand-in into globalThis.importShim style.
// Instead, we simulate by temporarily overriding global import via a jest mock factory is not trivial without bundler;
// so we design the adapter to early-return if three cannot load - here we provide a faux module in module cache using jest.mock.

// jest does static analysis; mock the 'three' module with minimal API we use.
jest.mock('three', () => {
  class Geometry {
    dispose() {}
  }
  class Material {
    dispose() {}
  }
  class PlaneGeometry extends Geometry {
    constructor(w, h) {
      super();
      this.w = w;
      this.h = h;
    }
  }
  class RingGeometry extends Geometry {
    constructor(inner, outer, segments) {
      super();
      this.inner = inner;
      this.outer = outer;
      this.segments = segments;
    }
  }
  class MeshBasicMaterial extends Material {
    constructor(opts) {
      super();
      this.opts = opts;
      this.color = opts?.color
        ? { setHex: jest.fn(), clone: jest.fn(() => ({ setHex: jest.fn(), copy: jest.fn() })) }
        : null;
      this.emissive = opts?.color
        ? { setHex: jest.fn(), clone: jest.fn(() => ({ setHex: jest.fn(), copy: jest.fn() })) }
        : null;
    }
  }
  class Mesh {
    constructor(geo, mat) {
      this.geometry = geo;
      this.material = mat;
      this.position = { set: jest.fn() };
      this.name = '';
      this.userData = {};
      this.rotation = { y: 0 };
      this.scale = { x: 1, y: 1, z: 1 };
      this.children = [];
    }
    lookAt() {}
    add(child) {
      this.children.push(child);
      child.parent = this;
    }
    remove(child) {
      this.children = this.children.filter((c) => c !== child);
      if (child.parent === this) child.parent = null;
    }
  }
  return {
    PlaneGeometry,
    RingGeometry,
    MeshBasicMaterial,
    Mesh,
    DoubleSide: 2,
  };
});

// We import after mocking
import { Token3DAdapter } from '../../src/scene/Token3DAdapter.js';

describe('Token3DAdapter (Phase 3)', () => {
  test('adding a token in hybrid mode schedules a 3D mesh creation and attaches reference', async () => {
    const addedCallbacks = [];
    const fakeScene = { add: jest.fn(), remove: jest.fn() };
    const gm = {
      renderMode: '3d-hybrid',
      threeSceneManager: {
        scene: fakeScene,
        camera: { position: { x: 0, y: 5, z: 5 } },
        addAnimationCallback: (fn) => addedCallbacks.push(fn),
      },
      spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }), elevationUnit: 0.5 },
      getTerrainHeight: () => 0,
      placedTokens: [],
      __threeTestDouble: require('three'),
      is3DModeActive: () => true,
    };

    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;
    adapter.attach();

    const c = {
      selectedTokenType: 'goblin',
      placedTokens: gm.placedTokens,
      setupTokenInteractions: () => {},
      gameManager: gm,
    };
    const creature = { sprite: {}, removeFromStage: () => {} };

    addTokenToCollection(c, creature, 2, 3);

    const token = gm.placedTokens[0];
    if (token.__threeMeshPromise) await token.__threeMeshPromise; // still safe

    expect(gm.placedTokens[0].__threeMesh).toBeDefined();
    expect(fakeScene.add).toHaveBeenCalledTimes(1);
    // After consolidation there should be exactly one unified frame callback
    expect(addedCallbacks.length).toBe(1);
  });

  test('removing a token calls adapter cleanup and disposes mesh', async () => {
    const fakeScene = { add: jest.fn(), remove: jest.fn() };
    const gm = {
      renderMode: '3d-hybrid',
      threeSceneManager: {
        scene: fakeScene,
        camera: { position: { x: 0, y: 0, z: 0 } },
        addAnimationCallback: () => {},
      },
      spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }), elevationUnit: 0.5 },
      getTerrainHeight: () => 0,
      placedTokens: [],
      __threeTestDouble: require('three'),
      is3DModeActive: () => true,
    };
    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;
    adapter.attach();

    const c = {
      selectedTokenType: 'orc',
      placedTokens: gm.placedTokens,
      setupTokenInteractions: () => {},
      gameManager: gm,
    };
    const creature = { sprite: {}, removeFromStage: () => {} };
    addTokenToCollection(c, creature, 1, 1);
    const token = gm.placedTokens[0];
    if (token.__threeMeshPromise) await token.__threeMeshPromise;
    const mesh = token.__threeMesh;
    jest.spyOn(mesh.geometry, 'dispose');
    jest.spyOn(mesh.material, 'dispose');

    // Use removal path
    const { removeToken } = await import('../../src/managers/token-manager/internals/removal.js');
    removeToken(c, token);

    expect(fakeScene.remove).toHaveBeenCalledWith(mesh);
    expect(mesh.geometry.dispose).toHaveBeenCalled();
    expect(mesh.material.dispose).toHaveBeenCalled();
    expect(token.__threeMesh).toBeUndefined();
  });

  test('facing direction sync flips mesh scale.x', async () => {
    const addedCallbacks = [];
    const fakeScene = { add: jest.fn(), remove: jest.fn() };
    const gm = {
      renderMode: '3d-hybrid',
      threeSceneManager: {
        scene: fakeScene,
        camera: { position: { x: 0, y: 5, z: 5 } },
        addAnimationCallback: (fn) => addedCallbacks.push(fn),
      },
      spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }), elevationUnit: 0.5 },
      getTerrainHeight: () => 0,
      placedTokens: [],
      __threeTestDouble: require('three'),
      tokenManager: {
        tokenFacingRight: true,
        getTokenFacingRight() {
          return this.tokenFacingRight;
        },
      },
      is3DModeActive: () => true,
    };
    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;
    adapter.attach();

    const c = {
      selectedTokenType: 'goblin',
      placedTokens: gm.placedTokens,
      setupTokenInteractions: () => {},
      gameManager: gm,
    };
    const creature = { sprite: {}, removeFromStage: () => {} };
    addTokenToCollection(c, creature, 0, 0);
    const token = gm.placedTokens[0];
    if (token.__threeMeshPromise) await token.__threeMeshPromise;
    const mesh = token.__threeMesh;
    mesh.scale = { x: 1, y: 1, z: 1 };

    // Run all registered animation callbacks once to capture initial state
    addedCallbacks.forEach((cb) => cb());
    expect(mesh.scale.x).toBe(1);

    // Flip facing
    gm.tokenManager.tokenFacingRight = false;
    addedCallbacks.forEach((cb) => cb());
    expect(mesh.scale.x).toBe(-1);

    // Flip back
    gm.tokenManager.tokenFacingRight = true;
    addedCallbacks.forEach((cb) => cb());
    expect(mesh.scale.x).toBe(1);
  });

  test('updateTokenOrientation applies yaw offset and global flip', () => {
    const gm = {
      is3DModeActive: () => true,
      tokenManager: {
        tokenFacingRight: true,
        getTokenFacingRight() {
          return this.tokenFacingRight;
        },
      },
      placedTokens: [],
    };

    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;

    const sprite = { scale: { x: 1 }, rotation: 0 };
    const mesh = {
      userData: { __tt3DToken: true, __ttBaseYaw: Math.PI / 2 },
      rotation: { y: 0 },
    };

    const token = { facingAngle: 0, creature: { sprite }, __threeMesh: mesh };
    gm.placedTokens.push(token);

    adapter.updateTokenOrientation(token);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(sprite.scale.x).toBeCloseTo(1);
    expect(sprite.rotation).toBeCloseTo(0);

    token.facingAngle = Math.PI / 4;
    adapter.updateTokenOrientation(token);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2 + Math.PI / 4);
    expect(sprite.rotation).toBeCloseTo(Math.PI / 4);

    gm.tokenManager.tokenFacingRight = false;
    adapter._lastFacingRight = null;
    adapter._syncFacingDirection();
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2 + Math.PI / 4 + Math.PI);
    expect(sprite.scale.x).toBeLessThan(0);
  });

  test('selection indicator attaches when token selected', async () => {
    const three = require('three');
    const gm = {
      is3DModeActive: () => true,
      placedTokens: [],
      tokenManager: {
        tokenFacingRight: true,
        getTokenFacingRight() {
          return this.tokenFacingRight;
        },
      },
    };

    const adapter = new Token3DAdapter(gm);
    adapter._threePromise = Promise.resolve(three);

    const mesh = new three.Mesh(new three.PlaneGeometry(1, 1), new three.MeshBasicMaterial());
    const token = { creature: { sprite: { scale: { x: 1 } } }, __threeMesh: mesh };

    await adapter.setSelectedToken(token);

    expect(token.__ttSelectionIndicator).toBeDefined();
    expect(token.__ttSelectionIndicator.visible).toBe(true);
    expect(mesh.children.includes(token.__ttSelectionIndicator)).toBe(true);
    const materialStore = adapter._originalMaterials;
    const storeSize =
      typeof materialStore?.size === 'number'
        ? materialStore.size
        : typeof materialStore?.length === 'number'
          ? materialStore.length
          : 0;
    expect(storeSize).toBe(0);

    await adapter.setSelectedToken(null);
    expect(token.__ttSelectionIndicator.visible).toBe(false);
    const materialStoreAfter = adapter._originalMaterials;
    const storeSizeAfter =
      typeof materialStoreAfter?.size === 'number'
        ? materialStoreAfter.size
        : typeof materialStoreAfter?.length === 'number'
          ? materialStoreAfter.length
          : 0;
    expect(storeSizeAfter).toBe(0);
  });

  test('_finalizeClimbLanding attempts advance when eligible', () => {
    const gm = { is3DModeActive: () => true };
    const adapter = new Token3DAdapter(gm);
    const landingWorld = { x: 1, y: 2, z: 3 };
    const recoverWorld = { x: 0, y: 1, z: 0 };
    const state = { token: { id: 'hero' } };

    adapter._shouldStartClimbAdvance = jest.fn().mockReturnValue(true);
    adapter._startClimbAdvancePhase = jest.fn().mockReturnValue(true);
    adapter._resetClimbLandingState = jest.fn();

    const result = adapter._finalizeClimbLanding(state, { landingWorld, recoverWorld });

    expect(result).toBe(true);
    expect(adapter._shouldStartClimbAdvance).toHaveBeenCalledWith(
      state,
      recoverWorld,
      landingWorld
    );
    expect(adapter._startClimbAdvancePhase).toHaveBeenCalledWith(state, recoverWorld, landingWorld);
    expect(adapter._resetClimbLandingState).not.toHaveBeenCalled();
  });

  test('_finalizeClimbLanding falls back to reset when advance cannot start', () => {
    const gm = { is3DModeActive: () => true };
    const adapter = new Token3DAdapter(gm);
    const landingWorld = { x: 5, y: 6, z: 7 };
    const state = { token: { id: 'rogue' } };

    adapter._shouldStartClimbAdvance = jest.fn().mockReturnValue(true);
    adapter._startClimbAdvancePhase = jest.fn().mockReturnValue(false);
    adapter._resetClimbLandingState = jest.fn();

    adapter._finalizeClimbLanding(state, { landingWorld });

    expect(adapter._shouldStartClimbAdvance).toHaveBeenCalledWith(state, null, landingWorld);
    expect(adapter._startClimbAdvancePhase).toHaveBeenCalledWith(state, null, landingWorld);
    expect(adapter._resetClimbLandingState).toHaveBeenCalledWith(state, { landingWorld });
  });

  test('_finalizeClimbLanding respects allowAdvance=false', () => {
    const gm = { is3DModeActive: () => true };
    const adapter = new Token3DAdapter(gm);
    const landingWorld = { x: -1, y: 0, z: 2 };
    const state = { token: { id: 'mage' } };

    adapter._shouldStartClimbAdvance = jest.fn();
    adapter._startClimbAdvancePhase = jest.fn();
    adapter._resetClimbLandingState = jest.fn();

    adapter._finalizeClimbLanding(state, { landingWorld, allowAdvance: false });

    expect(adapter._shouldStartClimbAdvance).not.toHaveBeenCalled();
    expect(adapter._startClimbAdvancePhase).not.toHaveBeenCalled();
    expect(adapter._resetClimbLandingState).toHaveBeenCalledWith(state, { landingWorld });
  });

  test('_syncTokenAndMeshWorld updates both token and mesh when available', () => {
    const gm = { is3DModeActive: () => true };
    const adapter = new Token3DAdapter(gm);
    const world = { x: 3, y: 4, z: 5 };
    const state = {
      token: { id: 'hero', __threeMesh: { id: 'fallbackMesh' } },
      mesh: { id: 'activeMesh' },
    };

    adapter._updateTokenWorldDuringMovement = jest.fn();
    adapter._applyMeshWorldPosition = jest.fn().mockReturnValue(world);

    const result = adapter._syncTokenAndMeshWorld(state, world);

    expect(adapter._updateTokenWorldDuringMovement).toHaveBeenCalledWith(state.token, world);
    expect(adapter._applyMeshWorldPosition).toHaveBeenCalledWith(state.mesh, world);
    expect(result).toBe(world);
  });

  test('_syncTokenAndMeshWorld tolerates missing mesh', () => {
    const gm = { is3DModeActive: () => true };
    const adapter = new Token3DAdapter(gm);
    const world = { x: 7, y: 8, z: 9 };
    const state = {
      token: { id: 'hero', __threeMesh: null },
      mesh: null,
    };

    adapter._updateTokenWorldDuringMovement = jest.fn();
    adapter._applyMeshWorldPosition = jest.fn();

    const result = adapter._syncTokenAndMeshWorld(state, world);

    expect(adapter._updateTokenWorldDuringMovement).toHaveBeenCalledWith(state.token, world);
    expect(adapter._applyMeshWorldPosition).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  test('_advanceClimbPhase uses sync helper for interpolated poses', () => {
    const gm = { is3DModeActive: () => true };
    const adapter = new Token3DAdapter(gm);
    const state = {
      token: { id: 'hero' },
      mesh: {},
      climbActive: true,
      climbDuration: 2,
      climbElapsed: 0,
      climbStartWorld: { x: 0, y: 0, z: 0 },
      climbTargetWorld: { x: 0, y: 2, z: 0 },
    };

    adapter._syncTokenAndMeshWorld = jest.fn();
    adapter._applyMeshWorldPosition = jest.fn();
    adapter._startClimbRecoverPhase = jest.fn();

    adapter._advanceClimbPhase(state, 0.5);

    expect(adapter._applyMeshWorldPosition).toHaveBeenCalledWith(state.mesh, state.climbStartWorld);
    expect(adapter._syncTokenAndMeshWorld).toHaveBeenCalledTimes(1);
    const [syncState, syncedWorld, syncOptions] = adapter._syncTokenAndMeshWorld.mock.calls[0];
    expect(syncState).toBe(state);
    expect(syncedWorld.y).toBeCloseTo(0.5);
    expect(syncOptions).toEqual({ mesh: null });
    expect(state.climbLastWorld).toEqual(expect.objectContaining({ y: syncedWorld.y }));
    expect(adapter._startClimbRecoverPhase).not.toHaveBeenCalled();
  });

  test('_advanceClimbPhase falls back to anchor when target unavailable', () => {
    const gm = { is3DModeActive: () => true };
    const adapter = new Token3DAdapter(gm);
    const anchor = { x: 2, y: 3, z: 4 };
    const state = {
      token: { id: 'rogue' },
      mesh: {},
      climbActive: true,
      climbDuration: 1,
      climbElapsed: 0,
      climbStartWorld: anchor,
      climbTargetWorld: null,
      climbFinalWorld: null,
    };

    adapter._syncTokenAndMeshWorld = jest.fn();
    adapter._applyMeshWorldPosition = jest.fn();
    adapter._startClimbRecoverPhase = jest.fn();

    adapter._advanceClimbPhase(state, 0.25);

    expect(adapter._applyMeshWorldPosition).toHaveBeenCalledWith(state.mesh, anchor);
    expect(adapter._syncTokenAndMeshWorld).toHaveBeenCalledWith(state, anchor, { mesh: null });
    expect(state.climbLastWorld).toEqual({ x: 2, y: 3, z: 4 });
    expect(adapter._startClimbRecoverPhase).not.toHaveBeenCalled();
  });

  test('_advanceFreeMovement syncs via helper', () => {
    const gm = { spatial: { tileWorldSize: 1 } };
    const adapter = new Token3DAdapter(gm);
    const token = { world: { x: 0, y: 0, z: 0 }, facingAngle: 0 };
    const state = {
      token,
      mesh: {},
      movementSign: 1,
      phase: 'walk',
      profile: {},
      pathActive: false,
      freeDistance: 0,
    };

    adapter._getMovementYaw = jest.fn().mockReturnValue(0);
    adapter._getDirectionalVectorFromYaw = jest.fn().mockReturnValue({ x: 0, z: -1 });
    adapter._sampleWorldHeight = jest.fn().mockReturnValue(0);
    adapter._syncTokenAndMeshWorld = jest.fn();

    adapter._advanceFreeMovement(state, 0.5);

    expect(adapter._syncTokenAndMeshWorld).toHaveBeenCalledWith(
      state,
      expect.objectContaining({ x: 0, y: 0, z: -0.5 })
    );
  });

  test('_resetClimbLandingState retries with direct navigate when resume fails', () => {
    const gm = { is3DModeActive: () => true };
    const adapter = new Token3DAdapter(gm);

    adapter._transferRootMotionToWorld = jest.fn();
    adapter._syncTokenAndMeshWorld = jest.fn();
    adapter._clearClimbState = jest.fn();
    adapter._hasActiveIntents = jest.fn().mockReturnValue(false);
    adapter._resetMovementState = jest.fn();
    adapter._resumeCachedPostClimbGoal = jest.fn().mockReturnValue(false);
    adapter._resolveClimbLandingWorld = jest.fn().mockReturnValue({ x: 0, y: 0, z: 0 });

    const state = {
      token: { gridX: 0, gridY: 0, __threeMesh: { position: { set: jest.fn() } } },
      mesh: { position: { set: jest.fn() } },
      forwardKeys: new Set(['__path_nav']),
      climbContinuationGoal: { gridX: 7, gridY: 8, options: { tolerance: 0.15 } },
      climbData: { targetGridX: 1, targetGridY: 2 },
      climbAdvanceActive: false,
      climbRecoverActive: false,
      stopBlendedToIdle: false,
      pendingStop: false,
      stopTriggered: false,
      intentHold: false,
      stepFinalized: true,
      phase: 'climb',
    };

    const continuationGoal = state.climbContinuationGoal;
    adapter._reissueMaintainedGoal = jest.fn().mockReturnValue(false);
    adapter.navigateToGrid = jest.fn().mockReturnValue({ goal: {} });

    adapter._resetClimbLandingState(state);

    expect(adapter._reissueMaintainedGoal).toHaveBeenCalledWith(state, continuationGoal, {
      allowSameTile: true,
    });
    expect(adapter.navigateToGrid).toHaveBeenCalledWith(
      state.token,
      continuationGoal.gridX,
      continuationGoal.gridY,
      expect.objectContaining({ tolerance: 0.15 })
    );
  });

  test('_logPathing archives entries without writing to console', () => {
    const adapter = new Token3DAdapter({});
    adapter.setPathingLoggingEnabled(true);

    const spies = ['log', 'info', 'warn', 'error'].map((method) =>
      jest.spyOn(console, method).mockImplementation(() => {})
    );

    adapter._logPathing('diagnostic:test', { foo: 'bar' });

    const archive = adapter.getPathingLogArchive();
    expect(archive.length).toBeGreaterThan(0);
    expect(archive[archive.length - 1]).toEqual(
      expect.objectContaining({
        event: 'diagnostic:test',
        payload: expect.objectContaining({ foo: 'bar' }),
      })
    );

    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    spies.forEach((spy) => spy.mockRestore());
  });

  test('clearPathingLogArchive removes archived entries', () => {
    const adapter = new Token3DAdapter({});
    adapter.setPathingLoggingEnabled(true);

    adapter._logPathing('foo', {});
    adapter._logPathing('bar', {});
    expect(adapter.getPathingLogArchive().length).toBeGreaterThanOrEqual(2);

    adapter.clearPathingLogArchive();
    expect(adapter.getPathingLogArchive().length).toBe(0);
  });

  const buildClimbNavigationHarness = (targetGridY) => {
    const gm = {
      is3DModeActive: () => true,
      spatial: {
        tileWorldSize: 1,
        elevationUnit: 0.5,
        gridToWorld: (gridX, gridY, heightLevel = 0) => ({
          x: gridX,
          y: (heightLevel ?? 0) * 0.5,
          z: gridY,
        }),
      },
      getTerrainHeight: (gridX, gridY) => (gridX === 0 && gridY === targetGridY ? 6 : 0),
    };

    const adapter = new Token3DAdapter(gm);
    const token = { id: 'hero', gridX: 0, gridY: 0, world: { x: 0.5, y: 0, z: 0.5 } };
    const state = {
      token,
      mesh: {},
      phase: 'idle',
      climbContinuationGoal: null,
      pathStallTime: 0,
      lastRequestedGoal: null,
      forwardKeys: new Set(),
      backwardKeys: new Set(),
      movementSign: 0,
      lastMoveSign: 0,
      intentHold: false,
      pendingStop: false,
      stopTriggered: false,
      pathActive: false,
      pathGoal: null,
      pathSpeedMode: null,
      freeStartWorld: null,
      freeLastWorld: null,
      freeDistance: 0,
      __resumeProbe: null,
      climbQueued: null,
    };

    jest.spyOn(adapter, '_ensureMovementState').mockReturnValue(state);
    jest.spyOn(adapter, '_planIntermediateClimbTraversal').mockReturnValue(null);
    jest.spyOn(adapter, '_isGridWithinBounds').mockReturnValue(true);
    jest.spyOn(adapter, '_clearResumeProbe').mockImplementation(() => {});
    jest.spyOn(adapter, '_clearPathState').mockImplementation(() => {});
    jest.spyOn(adapter, '_orientTokenTowardsWorld').mockImplementation(() => {});
    jest.spyOn(adapter, '_recalculateMovementIntent').mockReturnValue(1);
    jest.spyOn(adapter, '_startMovementPhase').mockImplementation(() => {});
    jest.spyOn(adapter, '_syncMovementVariant').mockImplementation(() => {});
    jest.spyOn(adapter, '_updateMovementFlags').mockImplementation(() => {});
    jest.spyOn(adapter, '_logPathing').mockImplementation(() => {});
    jest.spyOn(adapter, '_abortStopPhase').mockImplementation(() => {});

    return { adapter, token, state };
  };

  test('navigateToGrid adjusts climb approach for walk, run, and sprint speeds', () => {
    const slowTargetY = 2;
    const runTargetY = 5;
    const sprintTargetY = 8;

    const slow = buildClimbNavigationHarness(slowTargetY);
    const run = buildClimbNavigationHarness(runTargetY);
    const sprint = buildClimbNavigationHarness(sprintTargetY);

    const slowResult = slow.adapter.navigateToGrid(slow.token, 0, slowTargetY);
    const runResult = run.adapter.navigateToGrid(run.token, 0, runTargetY);
    const sprintResult = sprint.adapter.navigateToGrid(sprint.token, 0, sprintTargetY);

    expect(slowResult.speedMode).toBe('walk');
    expect(runResult.speedMode).toBe('run');
    expect(sprintResult.speedMode).toBe('sprint');

    const wallClearance = (state, targetY) => targetY - state.pathGoal.world.z;

    const slowClearance = wallClearance(slow.state, slowTargetY);
    const runClearance = wallClearance(run.state, runTargetY);
    const sprintClearance = wallClearance(sprint.state, sprintTargetY);

    expect(runClearance).toBeGreaterThan(slowClearance);
    expect(sprintClearance).toBeGreaterThan(runClearance);
    expect(runClearance).toBeGreaterThan(0.25);
    expect(runClearance).toBeLessThan(0.45);
    expect(sprintClearance).toBeGreaterThan(0.65);
    expect(sprintClearance).toBeLessThan(0.85);

    expect(run.state.pathTolerance).toBeLessThan(slow.state.pathTolerance);
    expect(sprint.state.pathTolerance).toBeLessThan(run.state.pathTolerance);

    expect(run.state.climbQueued).toBeTruthy();
    expect(sprint.state.climbQueued).toBeTruthy();
  });
});
