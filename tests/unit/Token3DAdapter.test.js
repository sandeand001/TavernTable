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

  test('navigateToGrid honors preferred speed override', () => {
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
      getTerrainHeight: () => 0,
    };

    const adapter = new Token3DAdapter(gm);
    const token = { gridX: 0, gridY: 0, world: gm.spatial.gridToWorld(0.5, 0.5, 0) };

    const result = adapter.navigateToGrid(token, 0, 20, { __preferredSpeedMode: 'walk' });
    expect(result.speedMode).toBe('walk');

    const state = adapter._movementStates.get(token);
    expect(state.lastRequestedGoal.options.__preferredSpeedMode).toBe('walk');
  });

  test('_createForwardMovementStep selects correct fall landing variants by drop height', () => {
    const buildStep = (drop) => {
      const startHeight = 12;
      const gm = {
        spatial: {
          tileWorldSize: 1,
          gridToWorld: (gridX, gridY, heightLevel = 0) => ({
            x: gridX,
            y: (heightLevel ?? 0) * 0.5,
            z: gridY,
          }),
        },
        getTerrainHeight: (_x, gy) => (gy === 0 ? startHeight : startHeight - drop),
      };
      const adapter = new Token3DAdapter(gm);
      const token = {
        gridX: 0,
        gridY: 0,
        facingAngle: 0,
        world: gm.spatial.gridToWorld(0.5, 0.5, startHeight),
      };
      const mesh = { position: { set: jest.fn() }, userData: {} };
      return adapter._createForwardMovementStep(token, mesh);
    };

    const noFall = buildStep(2.5);
    expect(noFall.requiresFall).toBe(false);

    const softLanding = buildStep(4);
    expect(softLanding.requiresFall).toBe(true);
    expect(softLanding.landingVariant).toBe('fall');

    const hardLanding = buildStep(6);
    expect(hardLanding.landingVariant).toBe('hardLanding');

    const rollLanding = buildStep(10);
    expect(rollLanding.landingVariant).toBe('fallToRoll');
  });

  test('_finishFallPhase transfers root offsets before locking and updates grids', () => {
    const gm = {
      is3DModeActive: () => true,
      spatial: { worldToGrid: jest.fn(() => ({ gridX: 7, gridY: 9 })) },
    };
    const adapter = new Token3DAdapter(gm);
    adapter._logFallHeightSample = jest.fn();
    adapter._clearFallStepState = jest.fn();
    adapter._resumeMovementAfterFall = jest.fn().mockReturnValue(true);
    adapter._setAnimation = jest.fn();

    const token = { gridX: 0, gridY: 0, __ttWorldLock: 1 };
    const mesh = {};
    const step = {
      tokenEntry: token,
      mesh,
      targetWorld: { x: 1, y: 2, z: 3 },
      targetPosition: { x: 1, y: 2, z: 3 },
      totalDistance: 1,
      horizontalDistance: 1,
      landingVariant: 'hardLanding',
    };
    const state = {
      token,
      mesh,
      phase: 'fall',
      activeStep: step,
      stepFinalized: false,
      fallLandingKey: 'hardLanding',
      __worldLockActive: true,
    };

    jest.spyOn(adapter, '_resolveTokenWorldPosition').mockReturnValue({ x: 1, y: 2, z: 3 });
    jest.spyOn(adapter, '_composeMeshPosition').mockReturnValue({ x: 0, y: 0, z: 0 });
    const transferSpy = jest
      .spyOn(adapter, '_transferRootMotionToWorld')
      .mockImplementation(() => null);
    const lockSpy = jest.spyOn(adapter, '_lockStepAtTarget').mockImplementation(() => {});
    const stepGridSpy = jest.spyOn(adapter, '_applyStepGridFromWorld').mockImplementation(() => {});
    const tokenGridSpy = jest
      .spyOn(adapter, '_applyTokenGridFromWorld')
      .mockImplementation(() => {});
    jest.spyOn(adapter, '_extractRootMotionOffset').mockReturnValue({
      offsetWorld: { x: 0.5, y: -0.25, z: 0.75 },
      rootInfo: {},
    });

    adapter._finishFallPhase(state);

    const expectedWorld = { x: 1.5, y: 1.75, z: 3.75 };
    expect(transferSpy).toHaveBeenCalledWith(state, expectedWorld, expect.any(Object));
    expect(transferSpy.mock.invocationCallOrder[0]).toBeLessThan(
      lockSpy.mock.invocationCallOrder[0]
    );
    expect(step.targetWorld).toEqual(expectedWorld);
    expect(stepGridSpy).toHaveBeenCalledWith(step, expectedWorld);
    expect(tokenGridSpy).toHaveBeenCalledWith(token, expectedWorld);
    expect(token.__ttWorldLock).toBe(1);
    expect(state.__worldLockActive).toBe(true);
  });

  test('_finishFallPhase clamps outlier root offsets', () => {
    const gm = {
      is3DModeActive: () => true,
      spatial: {
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
        tileWorldSize: 1,
      },
    };
    const adapter = new Token3DAdapter(gm);
    adapter._logFallHeightSample = jest.fn();
    adapter._clearFallStepState = jest.fn();
    adapter._resumeMovementAfterFall = jest.fn().mockReturnValue(true);
    adapter._setAnimation = jest.fn();

    const token = { gridX: 0, gridY: 0 };
    const mesh = {};
    const step = {
      tokenEntry: token,
      mesh,
      targetWorld: { x: 1, y: 0, z: 1 },
      startWorld: { x: 0, y: 0, z: 0 },
      startPosition: { x: 0, y: 0, z: 0 },
      targetPosition: { x: 1, y: 0, z: 1 },
      totalDistance: 1,
      horizontalDistance: 1,
      landingVariant: 'fallToRoll',
    };
    const state = {
      token,
      mesh,
      phase: 'fall',
      activeStep: step,
      stepFinalized: false,
      fallLandingKey: 'fallToRoll',
    };

    jest.spyOn(adapter, '_resolveTokenWorldPosition').mockReturnValue({ x: 1, y: 0, z: 1 });
    jest.spyOn(adapter, '_composeMeshPosition').mockReturnValue({ x: 0, y: 0, z: 0 });
    const transferSpy = jest
      .spyOn(adapter, '_transferRootMotionToWorld')
      .mockImplementation(() => null);
    jest.spyOn(adapter, '_lockStepAtTarget').mockImplementation(() => {});
    jest.spyOn(adapter, '_applyStepGridFromWorld').mockImplementation(() => {});
    jest.spyOn(adapter, '_applyTokenGridFromWorld').mockImplementation(() => {});

    const outlierOffset = { x: 50, y: 0, z: 0 };
    jest.spyOn(adapter, '_extractRootMotionOffset').mockReturnValue({
      offsetWorld: outlierOffset,
      rootInfo: {},
    });
    const landingWorld = { ...step.targetWorld };

    adapter._finishFallPhase(state);

    const sanitizedTransfer = transferSpy.mock.calls[0][2];
    expect(sanitizedTransfer).toBeTruthy();
    const expectedOffset = adapter._clampLandingOffsetToTargetTile(
      step,
      landingWorld,
      adapter._sanitizeLandingRootOffset(step, outlierOffset, 'fallToRoll'),
      'fallToRoll'
    );
    expect(sanitizedTransfer.offsetWorld).toEqual(expectedOffset);
    const expectedWorld = {
      x: landingWorld.x + (expectedOffset?.x || 0),
      y: landingWorld.y + (expectedOffset?.y || 0),
      z: landingWorld.z + (expectedOffset?.z || 0),
    };
    expect(step.targetWorld).toEqual(expectedWorld);
  });

  test('_sanitizeLandingRootOffset respects horizontal and vertical limits', () => {
    const gm = {
      spatial: { tileWorldSize: 1 },
    };
    const adapter = new Token3DAdapter(gm);
    const step = {
      horizontalDistance: 1,
      startWorld: { y: 2 },
      targetWorld: { y: 0 },
      heightDrop: 2,
    };

    const valid = adapter._sanitizeLandingRootOffset(
      step,
      { x: 0.5, y: -0.5, z: 0.25 },
      'fallToRoll'
    );
    expect(valid).toEqual({ x: 0.5, y: -0.5, z: 0.25 });

    const tooWide = adapter._sanitizeLandingRootOffset(step, { x: 5, y: 0, z: 0 }, 'fallToRoll');
    expect(tooWide.y).toBe(0);
    expect(tooWide.z).toBe(0);
    expect(tooWide.x).toBeCloseTo(1.95, 6);

    const tooHigh = adapter._sanitizeLandingRootOffset(
      step,
      { x: 0.2, y: -5, z: 0.1 },
      'fallToRoll'
    );
    expect(tooHigh).toEqual({ x: 0.2, y: -3.35, z: 0.1 });

    const hardLandingWide = adapter._sanitizeLandingRootOffset(
      step,
      { x: 2.8, y: 0, z: 0 },
      'hardLanding'
    );
    expect(hardLandingWide.x).toBeLessThan(2);
    expect(hardLandingWide.x).toBeGreaterThan(1);

    const hardLandingClamp = adapter._sanitizeLandingRootOffset(
      step,
      { x: 5, y: 0, z: 0 },
      'hardLanding'
    );
    expect(hardLandingClamp.x).toBeLessThanOrEqual(2);
    expect(hardLandingClamp.x).toBeGreaterThan(1);
  });

  test('_maybeEnterFallPhase skips fall loop for shallow drops', () => {
    const gm = {};
    const adapter = new Token3DAdapter(gm);
    const token = { id: 'acrobat' };
    const mesh = { position: { x: 0, y: 0, z: 0 } };
    const step = {
      tokenEntry: token,
      mesh,
      requiresFall: true,
      heightDrop: 4,
      totalDistance: 2,
      traveled: 0.2,
      startPosition: { x: 0, y: 2, z: 0 },
      targetPosition: { x: 1, y: 0, z: 0 },
      startWorld: { x: 0, y: 2, z: 0 },
      targetWorld: { x: 1, y: 0, z: 0 },
      horizontalDistance: 1,
    };
    const state = {
      token,
      mesh,
      activeStep: step,
      phase: 'walk',
      profile: { fallClipDuration: 0.8, fallLoopMinDrop: 4.5 },
    };

    const actions = {
      fallLoop: { getClip: () => ({ duration: 1 }) },
      fall: { getClip: () => ({ duration: 0.8 }) },
    };

    adapter._tokenAnimationData.set(token, {
      actions,
      profile: {
        ...state.profile,
        fallFadeIn: 0.1,
        fallFadeOut: 0.1,
        fallLoopFadeIn: 0.05,
        fallLoopFadeOut: 0.05,
      },
    });
    adapter._captureFallResumeContext = jest.fn(() => null);
    adapter._setAnimation = jest.fn();
    adapter._logFallHeightSample = jest.fn();

    const activated = adapter._maybeEnterFallPhase(state);

    expect(activated).toBe(true);
    expect(token.__ttWorldLock).toBe(1);
    expect(state.__worldLockActive).toBe(true);
    expect(state.fallMode).toBe('landing');
    expect(adapter._setAnimation).toHaveBeenCalledWith(token, 'fall', expect.any(Object));
  });

  test('_transitionFallToLanding keeps landing step active without snapping back', () => {
    const gm = {
      spatial: {
        tileWorldSize: 1,
      },
    };
    const adapter = new Token3DAdapter(gm);
    const token = {
      gridX: 0,
      gridY: 0,
      world: { x: 0, y: 5, z: 0 },
    };
    const mesh = { rotation: { y: 0 } };
    const step = {
      tokenEntry: token,
      mesh,
      startWorld: { x: 0, y: 5, z: 0 },
      targetWorld: { x: 0, y: 0, z: 1 },
      startPosition: { x: 0, y: 5, z: 0 },
      targetPosition: { x: 0, y: 0, z: 1 },
      totalDistance: 2,
      traveled: 1,
      horizontalDistance: 1,
      horizontalTraveled: 0.5,
      gridTargetX: 0,
      gridTargetY: 1,
      heightDrop: 5,
      requiresFall: true,
      fallTriggered: true,
      landingVariant: 'fallToRoll',
    };
    const state = {
      token,
      mesh,
      activeStep: step,
      stepFinalized: false,
      phase: 'fall',
      fallMode: 'loop',
      profile: { fallFadeIn: 0.1, fallFadeOut: 0.1, walkSpeed: 2 },
      phaseElapsed: 0,
    };

    adapter._tokenAnimationData.set(token, {
      actions: {
        fallLoop: { getClip: () => ({ duration: 1 }) },
        fallToRoll: { getClip: () => ({ duration: 1 }) },
      },
      profile: {
        fallFadeIn: 0.1,
        fallFadeOut: 0.1,
        fallLoopMinDrop: 1,
        fallLoopFadeIn: 0.1,
        fallLoopFadeOut: 0.1,
        fallLoopTimeScale: 1,
        walkSpeed: 2,
      },
    });

    jest.spyOn(adapter, '_setAnimation').mockImplementation(() => {});
    jest.spyOn(adapter, '_logFallHeightSample').mockImplementation(() => {});
    const lockSpy = jest.spyOn(adapter, '_lockStepAtTarget');

    const transitioned = adapter._transitionFallToLanding(state);

    expect(transitioned).toBe(true);
    expect(lockSpy).not.toHaveBeenCalled();
    expect(state.stepFinalized).toBe(false);
    expect(step.traveled).toBe(1);
    expect(state.fallMode).toBe('landing');
  });

  test('_clampLandingOffsetToTargetTile scales offsets to stay in landing tile for standard falls', () => {
    const gm = {
      spatial: {
        tileWorldSize: 1,
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
      },
    };
    const adapter = new Token3DAdapter(gm);
    const step = { gridTargetX: 1, gridTargetY: 2 };
    const landingWorld = { x: 1.5, y: 0, z: 2.5 };
    const offset = { x: 1.2, y: 0, z: 0 };

    const clamped = adapter._clampLandingOffsetToTargetTile(step, landingWorld, offset, 'fall');
    expect(clamped).toBeTruthy();
    expect(clamped.x).toBeLessThan(offset.x);

    const finalWorld = {
      x: landingWorld.x + clamped.x,
      y: landingWorld.y + clamped.y,
      z: landingWorld.z + clamped.z,
    };
    expect(Math.floor(finalWorld.x)).toBe(step.gridTargetX);
    expect(Math.floor(finalWorld.z)).toBe(step.gridTargetY);
  });

  test('_clampLandingOffsetToTargetTile anchors hard landing to the landing tile', () => {
    const gm = {
      spatial: {
        tileWorldSize: 1,
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
      },
    };
    const adapter = new Token3DAdapter(gm);
    const step = { gridTargetX: 1, gridTargetY: 2, landingVariant: 'hardLanding' };
    const landingWorld = { x: 1.5, y: 0, z: 2.5 };
    const offset = { x: 1.2, y: 0, z: 0 };

    const clamped = adapter._clampLandingOffsetToTargetTile(
      step,
      landingWorld,
      offset,
      'hardLanding'
    );
    expect(clamped).toBeTruthy();
    expect(clamped.x).toBeLessThan(offset.x);
  });

  test('_clampLandingOffsetToTargetTile preserves as much offset as possible when trimming', () => {
    const gm = {
      spatial: {
        tileWorldSize: 1,
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
      },
    };
    const adapter = new Token3DAdapter(gm);
    const step = { gridTargetX: 1, gridTargetY: 2 };
    const landingWorld = { x: 1.5, y: 0, z: 2.5 };
    const offset = { x: 0.6, y: 0, z: 0 };

    const clamped = adapter._clampLandingOffsetToTargetTile(step, landingWorld, offset, 'fall');
    expect(clamped).toBeTruthy();
    const scale = clamped.x / offset.x;
    expect(scale).toBeGreaterThan(0.8);
    expect(scale).toBeLessThan(0.9);
  });

  test('_finishFallPhase queues roll recover before resuming after fall-to-roll', () => {
    const gm = {
      is3DModeActive: () => true,
      spatial: {
        worldToGrid: jest.fn(() => ({ gridX: 2, gridY: 2 })),
      },
    };
    const adapter = new Token3DAdapter(gm);
    adapter._clearFallStepState = jest.fn();
    adapter._resumeMovementAfterFall = jest.fn().mockReturnValue(false);
    adapter._logFallHeightSample = jest.fn();
    adapter._setAnimation = jest.fn();
    adapter._syncTokenAndMeshWorld = jest.fn();

    const token = { gridX: 0, gridY: 0 };
    const step = {
      tokenEntry: token,
      targetWorld: { x: 2, y: 0, z: 2 },
      targetPosition: { x: 0, y: 0, z: 0 },
      totalDistance: 1,
      horizontalDistance: 1,
      gridTargetX: 2,
      gridTargetY: 2,
      landingVariant: 'fallToRoll',
    };
    const state = {
      token,
      mesh: {},
      phase: 'fall',
      activeStep: step,
      fallLandingKey: 'fallToRoll',
      profile: {},
    };

    adapter._tokenAnimationData.set(token, {
      actions: {
        climbRecover: { getClip: () => ({ duration: 0.3 }) },
        fallToRoll: { getClip: () => ({ duration: 0.4 }) },
      },
      clips: { climbRecover: 0.3 },
      profile: {},
    });

    jest.spyOn(adapter, '_resolveTokenWorldPosition').mockReturnValue({ x: 2, y: 0, z: 2 });
    jest.spyOn(adapter, '_composeMeshPosition').mockReturnValue({ x: 0, y: 0, z: 0 });
    jest.spyOn(adapter, '_applyStepGridFromWorld').mockImplementation(() => {});
    jest.spyOn(adapter, '_applyTokenGridFromWorld').mockImplementation(() => {});
    jest.spyOn(adapter, '_lockStepAtTarget').mockImplementation(() => {});
    jest.spyOn(adapter, '_extractRootMotionOffset').mockReturnValue({
      offsetWorld: { x: 0.5, y: 0, z: 0 },
      rootInfo: {},
    });

    adapter._finishFallPhase(state);

    expect(state.phase).toBe('roll-recover');
    expect(state.rollRecoverActive).toBe(true);
    expect(adapter._resumeMovementAfterFall).not.toHaveBeenCalled();
    expect(adapter._setAnimation).toHaveBeenCalledWith(token, 'climbRecover', expect.any(Object));
  });

  test('_finishFallPhase preserves fall-to-roll landing offset even if it exits the tile', () => {
    const gm = {
      is3DModeActive: () => true,
      spatial: {
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
      },
    };
    const adapter = new Token3DAdapter(gm);
    adapter._clearFallStepState = jest.fn();
    adapter._resumeMovementAfterFall = jest.fn().mockReturnValue(false);
    adapter._logFallHeightSample = jest.fn();
    adapter._setAnimation = jest.fn();
    adapter._applyPendingOrientation = jest.fn();
    adapter._shouldHoldMovementState = jest.fn(() => false);
    adapter._movementStates.delete = jest.fn();
    adapter._resetSprintState = jest.fn();
    adapter._applyStepGridFromWorld = jest.fn();
    adapter._applyTokenGridFromWorld = jest.fn();
    adapter._lockStepAtTarget = jest.fn();

    const token = { gridX: 0, gridY: 0 };
    const landingWorld = { x: 4.5, y: 0, z: 5.5 };
    const step = {
      tokenEntry: token,
      targetWorld: landingWorld,
      targetPosition: { x: 0, y: 0, z: 0 },
      totalDistance: 1,
      horizontalDistance: 1,
      gridTargetX: 4,
      gridTargetY: 5,
      landingVariant: 'fallToRoll',
    };
    const state = {
      token,
      mesh: {},
      phase: 'fall',
      activeStep: step,
      fallLandingKey: 'fallToRoll',
      profile: {},
    };

    jest.spyOn(adapter, '_resolveTokenWorldPosition').mockReturnValue(landingWorld);
    jest.spyOn(adapter, '_extractRootMotionOffset').mockReturnValue({
      offsetWorld: { x: 0.8, y: 0, z: -0.6 },
      rootInfo: {},
    });
    const transferSpy = jest
      .spyOn(adapter, '_transferRootMotionToWorld')
      .mockImplementation(() => null);
    const clampSpy = jest.spyOn(adapter, '_clampLandingOffsetToTargetTile');

    adapter._finishFallPhase(state);

    expect(transferSpy).toHaveBeenCalled();
    expect(clampSpy).not.toHaveBeenCalled();
    const targetArg = transferSpy.mock.calls[0][1];
    const sanitized = adapter._sanitizeLandingRootOffset(
      step,
      { x: 0.8, y: 0, z: -0.6 },
      'fallToRoll'
    );
    const expectedWorld = {
      x: landingWorld.x + (sanitized?.x || 0),
      y: landingWorld.y + (sanitized?.y || 0),
      z: landingWorld.z + (sanitized?.z || 0),
    };
    expect(targetArg).toEqual(expectedWorld);
    expect(step.targetWorld).toEqual(expectedWorld);
  });

  test('_finishFallPhase keeps fall-to-roll grid anchored even when offset leaves the tile', () => {
    const gm = {
      is3DModeActive: () => true,
      spatial: {
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
      },
    };
    const adapter = new Token3DAdapter(gm);
    adapter._clearFallStepState = jest.fn();
    adapter._resumeMovementAfterFall = jest.fn().mockReturnValue(false);
    adapter._logFallHeightSample = jest.fn();
    adapter._setAnimation = jest.fn();
    adapter._applyPendingOrientation = jest.fn();
    adapter._shouldHoldMovementState = jest.fn(() => false);
    adapter._movementStates.delete = jest.fn();
    adapter._resetSprintState = jest.fn();

    const token = { gridX: 4, gridY: 5 };
    const landingWorld = { x: 4.5, y: 0, z: 5.5 };
    const step = {
      tokenEntry: token,
      targetWorld: { ...landingWorld },
      targetPosition: { x: 0, y: 0, z: 0 },
      totalDistance: 1,
      horizontalDistance: 1,
      gridTargetX: 4,
      gridTargetY: 5,
      landingVariant: 'fallToRoll',
    };
    const state = {
      token,
      mesh: {},
      phase: 'fall',
      activeStep: step,
      fallLandingKey: 'fallToRoll',
      profile: {},
    };

    jest.spyOn(adapter, '_resolveTokenWorldPosition').mockReturnValue(landingWorld);
    jest.spyOn(adapter, '_composeMeshPosition').mockReturnValue({ x: 0, y: 0, z: 0 });
    jest.spyOn(adapter, '_extractRootMotionOffset').mockReturnValue({
      offsetWorld: { x: 0.8, y: 0, z: 0.75 },
      rootInfo: {},
    });
    const applyTokenSpy = jest
      .spyOn(adapter, '_applyTokenGridFromWorld')
      .mockImplementation(() => {});
    const applyStepSpy = jest
      .spyOn(adapter, '_applyStepGridFromWorld')
      .mockImplementation(() => {});

    adapter._finishFallPhase(state);

    expect(applyTokenSpy).not.toHaveBeenCalled();
    expect(applyStepSpy).not.toHaveBeenCalled();
    expect(token.gridX).toBe(4);
    expect(token.gridY).toBe(5);
    expect(step.gridTargetX).toBe(4);
    expect(step.gridTargetY).toBe(5);
    const expectedOffset = adapter._sanitizeLandingRootOffset(
      step,
      { x: 0.8, y: 0, z: 0.75 },
      'fallToRoll'
    );
    expect(state.activeStep.targetWorld.x).toBeCloseTo(landingWorld.x + (expectedOffset?.x || 0));
  });

  test('_advanceRollRecoverPhase resumes queued movement after crouch-to-stand completes', () => {
    const gm = { spatial: { tileWorldSize: 1 } };
    const adapter = new Token3DAdapter(gm);
    const token = { gridX: 0, gridY: 0 };
    const state = {
      token,
      mesh: {},
      phase: 'roll-recover',
      rollRecoverActive: true,
      rollRecoverElapsed: 0,
      rollRecoverDuration: 0.2,
      rollRecoverAnchorWorld: { x: 1, y: 0, z: 2 },
      profile: {},
    };

    adapter._setAnimation = jest.fn();
    adapter._resumeMovementAfterFall = jest.fn().mockReturnValue(false);
    const finalizeSpy = jest.spyOn(adapter, '_finalizePostFallState').mockImplementation(() => {});
    jest.spyOn(adapter, '_syncTokenAndMeshWorld').mockImplementation(() => {});

    adapter._advanceRollRecoverPhase(state, 0.15);
    expect(state.rollRecoverActive).toBe(true);

    adapter._advanceRollRecoverPhase(state, 0.15);
    expect(adapter._resumeMovementAfterFall).toHaveBeenCalledTimes(1);
    expect(finalizeSpy).toHaveBeenCalled();
  });

  test('_completeRollRecover snaps grid to landing anchor for fall-to-roll recoveries', () => {
    const gm = {
      spatial: {
        tileWorldSize: 1,
        worldToGrid: jest.fn(() => ({ gridX: 7, gridY: -2 })),
      },
    };
    const adapter = new Token3DAdapter(gm);
    const token = { gridX: 0, gridY: 0 };
    const state = {
      token,
      mesh: {},
      phase: 'roll-recover',
      rollRecoverActive: true,
      rollRecoverDuration: 0.4,
      rollRecoverElapsed: 0.4,
      rollRecoverAnchorWorld: { x: 3.4, y: 1.1, z: -1.2 },
      profile: {},
      fallLandingKey: 'fallToRoll',
    };

    adapter._syncTokenAndMeshWorld = jest.fn();
    adapter._resumeMovementAfterFall = jest.fn().mockReturnValue(false);
    const finalizeSpy = jest.spyOn(adapter, '_finalizePostFallState').mockImplementation(() => {});

    adapter._completeRollRecover(state);

    expect(gm.spatial.worldToGrid).toHaveBeenCalledWith(3.4, -1.2);
    expect(token.gridX).toBe(7);
    expect(token.gridY).toBe(-2);
    expect(finalizeSpy).toHaveBeenCalled();
  });

  test('_finishFallPhase anchors hard landing to the landing tile', () => {
    const gm = {
      is3DModeActive: () => true,
      spatial: {
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
        tileWorldSize: 1,
      },
    };
    const adapter = new Token3DAdapter(gm);
    adapter._clearFallStepState = jest.fn();
    adapter._resumeMovementAfterFall = jest.fn().mockReturnValue(false);
    adapter._setAnimation = jest.fn();
    adapter._applyPendingOrientation = jest.fn();
    adapter._shouldHoldMovementState = jest.fn(() => false);
    adapter._movementStates.delete = jest.fn();
    adapter._resetSprintState = jest.fn();

    const token = { gridX: 0, gridY: 0 };
    const mesh = {};
    const step = {
      tokenEntry: token,
      mesh,
      startWorld: { x: 1, y: 2, z: 2 },
      targetWorld: { x: 1, y: 0, z: 2 },
      startPosition: { x: 1, y: 2, z: 2 },
      targetPosition: { x: 1, y: 0, z: 2 },
      totalDistance: 1,
      horizontalDistance: 1,
      gridTargetX: 1,
      gridTargetY: 2,
      landingVariant: 'hardLanding',
    };
    const state = {
      token,
      mesh,
      phase: 'fall',
      activeStep: step,
      stepFinalized: false,
      fallLandingKey: 'hardLanding',
      profile: {},
    };

    token.__ttWorldLock = 1;
    state.__worldLockActive = true;

    jest.spyOn(adapter, '_resolveTokenWorldPosition').mockReturnValue({ x: 1, y: 0, z: 2 });
    jest.spyOn(adapter, '_composeMeshPosition').mockReturnValue({ x: 0, y: 0, z: 0 });
    jest.spyOn(adapter, '_applyStepGridFromWorld').mockImplementation(() => {});
    jest.spyOn(adapter, '_applyTokenGridFromWorld').mockImplementation(() => {});
    jest.spyOn(adapter, '_lockStepAtTarget').mockImplementation(() => {});
    const transferSpy = jest
      .spyOn(adapter, '_transferRootMotionToWorld')
      .mockImplementation(() => null);
    jest.spyOn(adapter, '_extractRootMotionOffset').mockReturnValue({
      offsetWorld: { x: 1.25, y: 0, z: 0 },
      rootInfo: {},
    });

    adapter._finishFallPhase(state);

    const transferTarget = transferSpy.mock.calls[0][1];
    const sanitized = adapter._sanitizeLandingRootOffset(
      step,
      { x: 1.25, y: 0, z: 0 },
      'hardLanding'
    );
    const clamped = adapter._clampLandingOffsetToTargetTile(
      step,
      { x: 1, y: 0, z: 2 },
      sanitized,
      'hardLanding'
    );
    const expectedWorld = {
      x: 1 + (clamped?.x || 0),
      y: 0 + (clamped?.y || 0),
      z: 2 + (clamped?.z || 0),
    };
    expect(transferTarget).toEqual(expectedWorld);
    expect(step.targetWorld).toEqual(expectedWorld);
    expect(token.__ttWorldLock).toBeUndefined();
    expect(state.__worldLockActive).toBe(false);
  });

  test('_finishFallPhase keeps standard fall landing centered on the tile', () => {
    const gm = {
      is3DModeActive: () => true,
      spatial: {
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
      },
    };
    const adapter = new Token3DAdapter(gm);
    adapter._clearFallStepState = jest.fn();
    adapter._resumeMovementAfterFall = jest.fn().mockReturnValue(false);
    adapter._setAnimation = jest.fn();
    adapter._applyPendingOrientation = jest.fn();
    adapter._shouldHoldMovementState = jest.fn(() => false);
    adapter._movementStates.delete = jest.fn();
    adapter._resetSprintState = jest.fn();

    const token = { gridX: 0, gridY: 0 };
    const step = {
      tokenEntry: token,
      targetWorld: { x: 3.5, y: 0, z: 4.5 },
      targetPosition: { x: 0, y: 0, z: 0 },
      totalDistance: 1,
      horizontalDistance: 1,
      gridTargetX: 3,
      gridTargetY: 4,
    };
    const state = {
      token,
      mesh: {},
      phase: 'fall',
      activeStep: step,
      fallLandingKey: 'fall',
      profile: {},
    };

    jest.spyOn(adapter, '_resolveTokenWorldPosition').mockReturnValue({ x: 3.5, y: 0, z: 4.5 });
    jest.spyOn(adapter, '_composeMeshPosition').mockReturnValue({ x: 0, y: 0, z: 0 });
    jest.spyOn(adapter, '_applyStepGridFromWorld').mockImplementation(() => {});
    jest.spyOn(adapter, '_applyTokenGridFromWorld').mockImplementation(() => {});
    jest.spyOn(adapter, '_lockStepAtTarget').mockImplementation(() => {});
    jest.spyOn(adapter, '_extractRootMotionOffset').mockReturnValue({
      offsetWorld: { x: -0.8, y: 0, z: 0 },
      rootInfo: {},
    });

    const transferSpy = jest
      .spyOn(adapter, '_transferRootMotionToWorld')
      .mockImplementation(() => null);

    adapter._finishFallPhase(state);

    const transferTarget = transferSpy.mock.calls[0][1];
    const sanitized = adapter._sanitizeLandingRootOffset(step, { x: -0.8, y: 0, z: 0 }, 'fall');
    const clamped = adapter._clampLandingOffsetToTargetTile(
      step,
      { x: 3.5, y: 0, z: 4.5 },
      sanitized,
      'fall'
    );
    const expectedWorld = {
      x: 3.5 + (clamped?.x || 0),
      y: 0 + (clamped?.y || 0),
      z: 4.5 + (clamped?.z || 0),
    };
    expect(transferTarget).toEqual(expectedWorld);
    expect(step.targetWorld).toEqual(expectedWorld);
  });

  test('_resetMovementState defers while world lock is active', () => {
    const adapter = new Token3DAdapter({});
    jest.spyOn(adapter, '_clearPathState').mockImplementation(() => {});
    jest.spyOn(adapter, '_resetSprintState').mockImplementation(() => {});
    jest.spyOn(adapter, '_applyPendingOrientation').mockImplementation(() => {});
    jest.spyOn(adapter, '_setAnimation').mockImplementation(() => {});

    const token = { __ttWorldLock: 1 };
    const state = {
      token,
      profile: { idleFadeIn: 0.1, walkFadeOut: 0.2, stopFadeOut: 0.3 },
      __worldLockActive: true,
      stopBlendedToIdle: false,
      stopTriggered: true,
      pendingStop: true,
    };

    adapter._resetMovementState(state, { useStopBlend: true, clearStopFlags: true });

    expect(state.__pendingMovementResetOptions).toEqual({
      useStopBlend: true,
      clearStopFlags: true,
    });
    expect(adapter._setAnimation).not.toHaveBeenCalled();

    adapter._unlockTokenWorldAuthority(state);

    expect(state.__pendingMovementResetOptions).toBeNull();
    expect(state.stopTriggered).toBe(false);
    expect(state.pendingStop).toBe(false);
    expect(state.__worldLockActive).toBe(false);
    expect(adapter._setAnimation).toHaveBeenCalledWith(
      token,
      'idle',
      expect.objectContaining({ fadeOut: state.profile.stopFadeOut })
    );
  });

  test('_resetMovementState merges deferred reset options across locks', () => {
    const adapter = new Token3DAdapter({});
    jest.spyOn(adapter, '_clearPathState').mockImplementation(() => {});
    jest.spyOn(adapter, '_resetSprintState').mockImplementation(() => {});
    jest.spyOn(adapter, '_applyPendingOrientation').mockImplementation(() => {});
    jest.spyOn(adapter, '_setAnimation').mockImplementation(() => {});

    const token = { __ttWorldLock: 2 };
    const state = {
      token,
      profile: { idleFadeIn: 0.1, walkFadeOut: 0.2, stopFadeOut: 0.3 },
      __worldLockActive: true,
      stopBlendedToIdle: false,
      stopTriggered: true,
      pendingStop: true,
    };

    adapter._resetMovementState(state, { useStopBlend: true });
    adapter._resetMovementState(state, { clearStopFlags: true });

    expect(state.__pendingMovementResetOptions).toEqual({
      useStopBlend: true,
      clearStopFlags: true,
    });

    adapter._unlockTokenWorldAuthority(state);
    expect(state.__worldLockActive).toBe(true);
    expect(adapter._setAnimation).not.toHaveBeenCalled();

    adapter._unlockTokenWorldAuthority(state);
    expect(state.__worldLockActive).toBe(false);
    expect(adapter._setAnimation).toHaveBeenCalledTimes(1);
    expect(state.stopTriggered).toBe(false);
    expect(state.pendingStop).toBe(false);
  });

  test('_advanceWalkPhase keeps pre-fall speed when fall step active', () => {
    const gm = { spatial: { tileWorldSize: 1 } };
    const adapter = new Token3DAdapter(gm);
    const state = {
      token: { id: 'speedster' },
      mesh: {},
      phase: 'walk',
      movementSign: 1,
      lastMoveSign: 1,
      intentHold: true,
      pendingStop: false,
      profile: { walkSpeed: 2 },
      activeSpeed: 1,
      lastMoveSpeed: 4,
      __fallStepActive: true,
    };

    adapter._recalculateMovementIntent = jest.fn(() => 1);
    adapter._syncMovementVariant = jest.fn();
    adapter._updateRunningDuration = jest.fn();
    adapter._ensureFallStepActive = jest.fn(() => true);
    adapter._advanceMovementStep = jest.fn().mockReturnValue(false);
    adapter._clearFallStepState = jest.fn();
    adapter._advanceFreeMovement = jest.fn();

    adapter._advanceWalkPhase(state, 1, { tileSize: 1 });

    expect(adapter._advanceMovementStep).toHaveBeenCalledWith(state, 4);
    expect(adapter._advanceFreeMovement).not.toHaveBeenCalled();
  });
});
