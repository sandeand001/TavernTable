# TavernTable maintenance handoff

Last verified: October 24, 2026, after the cliff-motion, large-d20, and camera updates.

## Start here

- This directory is the active Git repository. Run commands from the directory
  containing [package.json](./package.json).
- [README.md](./README.md) contains setup instructions and the verified baseline.
- [TODO.md](./TODO.md) is the current backlog.
- [CONVENTIONS.md](./CONVENTIONS.md) defines code organization.

## Cleanup scope

- The six obsolete sibling phase repositories were removed at the owner's
  request, including the assets inside those old copies.
- All 1,083 files in the active [assets directory](./assets/) were preserved
  byte-for-byte, including licenses.
- The pre-existing terrain-coordinator work was committed and pushed before
  cleanup: [checkpoint 6a3c434](https://github.com/sandeand001/TavernTable/commit/6a3c434aba1afb442732f28ced59d1e9246c94ed).
- That cleanup did not include the broader terrain ownership migration; the
  owner explicitly deferred it. The later mannequin motion work is described below.

## Verified baseline

```powershell
npm run test:stable -- --watch=false
npm run lint:all
```

- 77 Jest suites and 341 tests pass.
- JavaScript lint has no errors and 40 existing unused-variable warnings.
- Stylesheet lint and the architecture-layer check pass.
- Repository-wide `format:check` reports the unchanged
  [lint configuration](./tools/.eslintrc.json); changed JavaScript and tests pass
  a focused formatting check.

The three previously recorded movement failures were caused by stale test
assumptions, not established gameplay regressions:

1. Landing root-motion sanitization intentionally keeps the landing elevation.
2. `W` requests the drunk gait; path navigation uses its own input key.
3. Mocking the fall finalizer prevented the expected transition to idle.

[Token3DAdapter.test.js](./tests/unit/scene/Token3DAdapter.test.js) now exercises
both normal-path and drunk animation loading and the real fall cleanup.
The subsequent cliff-motion pass changes production movement and adds the
regressions below. Remaining browser reports are tracked separately in the backlog.

## Camera projection and view modes

- [CameraSystem](./src/scene/camera/CameraSystem.js) owns a cached perspective
  lens for normal 3D orbit and an orthographic lens for tactical top-down.
  `ThreeSceneManager.camera` always points to the active lens.
- Normal 3D uses a 35-degree field of view. Board dimensions, tile size, viewport
  aspect, and zoom determine orbit distance; perspective near clipping is positive.
  Framing is recomputed rather than keeping a stale board-size cache.
- `setTopDownView` saves/restores orbit yaw, pitch, and manual pitch lock.
  Focus and zoom remain live across switches; top-down pitch stays at 89.9
  degrees even when rotation inputs request a different pitch.
- [StateCoordinator](./src/coordinators/StateCoordinator.js) applies stored and
  subsequent mode changes independently of settings-panel listeners. Keep the
  persisted values `isometric` and `topdown` for compatibility; `isometric` now
  selects the normal perspective view, not an orthographic lens.
- Pan and cursor zoom use ground-ray intersections in CSS pixels, not
  drawing-buffer dimensions. Orbiting must not reset a panned focus.
  World elevation scaling remains independent of camera projection and zoom.
- Picking, die dismissal, and default face calibration must read the active
  camera when handling input. An explicitly supplied calibration camera remains
  an override. Reattach the camera rig when the active lens changes, without
  repositioning it or accidentally applying scene zoom twice.
- Real-Three camera tests cover cardinal yaws and the reported approximately
  10-degree low-angle pose, portrait/landscape and non-unit-tile boards, mode
  persistence, pan/zoom, rig behavior, and picking/dismissal after switches.
  Browser checks measured the near edge at about 889 pixels and the far edge at
  582 in that low-angle pose; top-down opposite edges remained equal. They also
  exercised the actual settings toggle, top-down rotation lock, cursor zoom,
  picking, and a physical d20 throw followed by camera-switch dismissal.
- Pan math is covered at the camera API. The existing Space-drag keyboard flag
  is not wired by the interaction manager; this pass does not add a new pan
  input binding.

## Large d20 physics

- This changes only the single gold d20 on the board. Other dice and multi-die
  rolls keep their existing 2D path.
- [D20Dynamics](./src/systems/dice/D20Dynamics.js) uses cannon-es 0.20.0, pinned in
  the dependency manifest and the browser import map. Load it lazily for the large
  die; a physics download must not become an application-startup requirement.
- [DiceState](./src/systems/dice/DiceState.js) derives a compact convex collider
  from the 20 calibrated numbered planes of the existing GLB. Enclose the raised
  numerals/bevels as well as the recessed calibration triangles. Do not interpret
  arbitrary body/glyph triangle indices as the numbered result: some numbered
  facets contain multiple triangles.
- Advance at 1/120 second with an owned accumulator. Cannon's render-time-budgeted
  stepping can discard accumulated time and change results with frame rate.
  Render the body pose; never add an Euler spin, cumulative wobble, or cosmetic
  snap after the body stops. Convert Cannon quaternions to Three quaternions
  before calling Three's `slerp`.
- Terrain colliders are a snapshot of the live heights at throw time, coalesced
  into same-height boxes. Static obstacles and board boundaries participate in
  contacts. Set static body position/orientation in the constructor so broadphase
  bounds are correct. Terrain edits during a throw are not live collider updates.
- A quiet die may sleep only when the top facet is unambiguous. Let gravity
  continue tipping a low-speed die balanced on an edge. A stationary cocked die
  prompts a manual reroll, as selected by the owner: retain its model, publish no
  number, and release the controls. A six-second simulation guard reports an
  unsettled-roll failure rather than forcing a face or fabricating a result.
- Launch momentum scales with the usable board span rather than a fixed weak
  impulse, so throws cross the board. Boundary walls have a separate contact
  material (0.45 restitution, 0.2 friction) for a modest bank; the board keeps its
  lower restitution. Linear damping is 0.22 in flight / 0.4 on contact, and
  angular damping is 0.35 / 0.6. This preserves the strong toss without extending
  the slow finish. The cocked-die regression uses a recorded resting pose so
  launch tuning cannot invalidate that fixture.
- [DiceAnimationScheduler](./src/systems/dice/DiceAnimationScheduler.js) handles
  physics/render scheduling, small-board fitting, and one-shot completion,
  cancellation, and cocked/error outcomes. Dispose cloned materials on dismissal,
  not the shared GLB geometry or textures.
- [dice3d](./src/systems/dice/dice3d.js) resolves every roll outcome explicitly.
  [dice](./src/systems/dice/dice.js) displays/logs only a valid physical result.
  RNG fallback is reserved for an unavailable 3D renderer, never a failed face
  read or cancelled/cocked die.

Tests under [the dice unit directory](./tests/unit/systems/dice/) load the actual
gold GLB for geometry/contact checks and cover 30/120 FPS pose/result agreement,
bounded throws, all 20 faces, minimum-board fitting, asynchronous setup,
cancellation, cocked prompts, and unchanged non-d20/multi-die behavior.
Browser verification uses the same model and physics modules. The owned visual
fixture allows software WebGL for this host's strict GPU-preflight rejection;
the temporary per-instance preflight override is restored immediately. Renderer
availability code and the existing animation assets were not changed.
The original gentle-launch verification covered 200 flat-board throws and all
values 1-20. In the current 100-seed cross-board replay on a 25-tile board, 99 throws
contacted a far wall and 98 rebounded away from it. Median travel was about 27.85
world units; median simulated duration was 4.07 seconds, with a 5.63-second maximum.
Four throws correctly prompted for a cocked die; none hit the failure guard.
Uneven-board checks exercise both valid landings and explicit cocked/unsettled
outcomes, rather than counting an arbitrary number as a successful result.

## Mannequin cliff motion

- [RootMotion](./src/scene/token-adapter/spatial/RootMotion.js) transforms
  displacement through the bone parent's world matrix, including scale. Do not
  substitute container yaw or treat FBX centimeters as world units.
- Prepare per-token climbing clip copies before creating mixer actions. The wall
  controller owns vertical travel; the mantle transfers its locomotor root bridge
  to the support anchor while retaining the authored crouched ending pose.
  Cached source clips and animation assets must remain unchanged.
- Sample the mixer before movement. Wall segments follow the authored root curve;
  phase/action clocks start together, without prestarting the mantle or jumping
  the final half of a wall segment.
- Preserve hip height and rotation. Cinematic planar root channels use their
  own action's sampled weight, not an outgoing walk/run translation. Recovery
  retains its authored rise and forward shift, with render-only toe grounding
  for blend penetration; its canonical terrain support height remains fixed.
- [Navigation](./src/scene/token-adapter/pathing/Navigation.js) shares climb
  approach geometry with keyboard movement. Keep held physical keys intact.
  Releasing a key or requesting a turn during a climb/fall must not interrupt the
  committed traversal; finish safely before stopping or applying the turn.
- Trace actual world-space cell crossings. Approach/arrival movement must stay
  within the speed-times-delta budget; tolerance is not permission to teleport.
  Finishing ledge advance belongs to the climb finalizer, not generic stopping.
- Rebase a fall trajectory at takeoff so its duration excludes consumed walking
  distance. [MannequinConfig](./src/config/token-adapter/MannequinConfig.js)
  annotates first-foot-contact times: soft landing at 8/30 seconds, hard landing
  at 3/30, and roll at 2/30. These are asset events, not full recovery durations.
  Recheck them if replacing or retargeting the clips.
- Preserve genuine roll travel in world units. A roll needs flat support along
  its authored root path and must stay inside board movement bounds; otherwise
  use the braced landing. Release world authority on every completed landing,
  including landings that resume movement.

New regression seams:
[RootMotion.test.js](./tests/unit/scene/token-adapter/spatial/RootMotion.test.js)
and [CliffMotion.test.js](./tests/unit/scene/token-adapter/movement/CliffMotion.test.js).
Fresh-source browser replays used the actual 26-action mannequin, repeated
eight-level climbs, soft/hard/rolling falls, cardinal/diagonal travel, both inputs,
walk/run/sprint, release/turn requests, edge destinations, adjacent cliffs,
0.15/0.3/0.5 elevation units, and 30/60/120 FPS.

In the 60 Hz eight-level fixture, the wall-to-mantle hip discontinuity fell from
about 0.605 to 0.002 world units. Recovery toe clearance is approximately
0-0.011 instead of hovering up to 0.228 above the ledge; exact click destinations
no longer consume a roughly 0.36-unit final snap. This is not full-body IK or
proof that every irregular-terrain/cold-loading edge case is solved.

## Exotic asset appearances

- All nine rarity-exotic biomes have distinct palettes and deterministic opacity
  variants in [ExoticBiomeAppearance.js](./src/config/biome/ExoticBiomeAppearance.js).
  Astral keeps natural diffuse colors; Arcane uses fantasy hues.
- [Placeable appearance materials](./src/scene/terrain/materials/placeable-appearance.js)
  clone materials before styling, retain texture UVs/alpha, and isolate shader
  programs from ordinary materials. Dispose owned material arrays, not cached
  source materials or shared textures.
- Capture the generated biome and seed before asynchronous model loading.
  Instance groups include the appearance variant in their identity.
- Crystal Spires uses rocky decor; Lava Fields uses only rocks/pebbles. Rift and
  Shadowfell floors can support their fitting assets below zero. Blood Marsh
  allows shallow wet-ground placement while excluding its deep basin.
- Shadowfell must use its dedicated profile, not the earlier Dead Forest rule.
  Flower materials use the existing `Flowers.png` texture and cutout handling.
- Appearance updates apply when generating a biome. The density control is
  labeled Asset Density because it also affects plants and rocks.

This is model material styling, not procedural terrain painting or completion
of the terrain ownership migration.

## Important unfinished work

[ADR-0001](./docs/adr/ADR-0001-terrain-engine-event-seam.md) is the accepted
terrain design, not a statement that the migration is finished.

- [GameManager](./src/core/GameManager.js) constructs both
  [TerrainEngine](./src/terrain/TerrainEngine.js) and
  [TerrainCoordinator](./src/coordinators/TerrainCoordinator.js).
- Both currently maintain height state. Most live editing still uses the
  coordinator's store, so engine-only state changes are not authoritative
  throughout the application.
- [TerrainEngineSceneAdapter](./src/scene/terrain/TerrainEngineSceneAdapter.js)
  exists, but event coverage and the callers' use of the engine need integration
  work.
- A future migration must cover game height queries, tools, resizing, brush input,
  biome/flora generation, and scene updates after reset/load. Verify behavior
  through that seam rather than declaring success from a smaller coordinator.

The 3D model pipeline uses [ModelAssetCache](./src/core/ModelAssetCache.js),
[ModelPostProcessing](./src/core/ModelPostProcessing.js), and
[PlaceableMeshPool](./src/scene/terrain/PlaceableMeshPool.js).

- Automatic flora weights must reference concrete `plant` entries with a
  `modelKey`, not virtual `plant-family` menu selectors.
- Match OBJ material names to their authored diffuse textures. TallThick leaves
  use `Leaves_TallThick_C.png`, and Pine bark uses `Bark_PineTree.png`; the generic
  `Leaves.png` atlas is not a universal foliage texture.
- Share in-flight instance-group creation per model/appearance key. Clear/reset/dispose
  must invalidate pending groups before they can publish stale scene meshes.

Asset scale calibration and model-load fallbacks still need browser checks.

The [March 2026 audit](./docs/archive/CONVENTIONS-AUDIT-2026-03-30.md) is retained
as historical context. Its file counts, paths, and findings are not a current
verification report.
