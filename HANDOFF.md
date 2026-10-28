# TavernTable maintenance handoff

Last verified after the facing, natural action, physical-height and vault
refinements, including actual-FBX contracts and rendered VS Code interaction checks.

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

- 100 Jest suites and 751 tests pass.
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

## Creature menus, identity, and character sheets

- [TokenCommandConfig](./src/config/TokenCommandConfig.js) exposes Character
  Sheet, the unchanged five-emote submenu, eight visual Actions, and one disabled
  Not yet available entry. Non-submenu actions execute directly. Keyboard
  activation follows the same route as pointer activation.
- [RadialMenu](./src/ui/components/RadialMenu.js) displays the instance name.
  Closed menus must be `inert`, not merely transparent: the SVG's explicit
  pointer-events otherwise intercept map clicks and rotation through its hidden
  parent. Preserve the visual hide transition without leaving invisible controls.
- [UIController](./src/ui/UIController.js) routes Character Sheet to one
  [CharacterSheetWindow](./src/ui/components/CharacterSheetWindow.js). It is
  non-modal and uses per-token tabs, not one browser window per creature.
  Sheet actions never become animation/quick-command markers.
- Token collection assigns a stable session ID and per-canonical-type
  `instanceNumber`. The first copy's `name` is unnumbered until a second is
  placed; then all existing copies receive numbered names. Keep the manager's
  counters monotonic after deletion. Legacy mannequin aliases count as the same
  creature type. Rendering and sheet labels share the creature display-name helper.
- The sheet window consumes `taverntable:tokenSelected`,
  `taverntable:tokenNamesChanged`, and `taverntable:tokenRemoved` events scoped to
  its game manager. Selection is emitted before asynchronous visual updates and
  also on an explicit re-selection, allowing a closed tab to reopen when its
  creature is clicked again.
- Visible-window selection creates/selects tabs without stealing focus; selection
  never reopens a hidden window. The window close button preserves tabs and
  layout; a tab close button discards just that tab. Removing a token discards
  its tab even while hidden. Movement is now editable per creature; other sheet
  sections remain placeholders. There is no reload persistence.
- Sheet-tab clicks, keyboard tab navigation, and explicit sheet opening select
  the associated map token through the existing 3D adapter. Passive map-to-tab
  events do not echo selection back to the adapter. When a visible active tab
  closes, its replacement is selected on the map too; hidden-window removal
  cleanup must not change map selection.
- Explicit sheet activation also focuses the token's current canonical world
  position, including height, without changing zoom or viewing angles. Do this
  synchronously with activation, not after asynchronous selection visuals, so
  a delayed older tab cannot steal focus. Passive map-to-tab updates do not pan.
- Minimize collapses the window to a draggable 48-pixel title bar; it does not
  close the window or discard tabs. Map selection continues updating the active
  sheet without restoring it. Restore retains the full dimensions, and an
  explicit Character Sheet menu action always restores the window.
- Title-bar controls use minus, square, and close symbols, retaining descriptive
  tooltips and accessible names for minimize, restore, and close.
- Keep full restore dimensions in `_bounds` and clamp minimized movement using
  the visible title-bar height. Restoring near a viewport edge must move the full
  window back into bounds. Tabs, content, and resizing controls are hidden while
  minimized, not left as transparent input blockers.
- Title-bar dragging and the resize handle use bounded pointer gestures and
  clean up on release, close, destruction, or focus loss. Viewport shrink keeps
  the window reachable. Tabs and resize controls support keyboard operation.
- Remove mode now prioritizes the actual clicked 3D token over the terrain tile
  projected behind its body. Token removal tolerates the absence of the legacy
  `removeFromStage` method on current 3D-only creatures. Both fixes are covered
  because sheet-tab cleanup must work through the actual user removal path.
- Browser verification covers drag-to-place numbering, real right-click sheet
  actions, selection sync, hide/reopen with retained layout, window movement and
  resizing, deletion/tab cleanup, preserved Rumba emotes, and non-modal map input.

## Shared humanoid imports and action authoring

### Interfaces and invariants

- [CharacterCatalog](./src/config/CharacterCatalog.js) owns canonical IDs,
  aliases, labels, palette icons, colors, logical scales and model metadata.
  Validation, generic creation, display names, model registration and palette
  buttons derive from it. Keep the existing mannequin aliases; they are not
  separate character implementations.
- [HumanoidActionCatalog](./src/config/HumanoidActionCatalog.js) owns locomotion
  roles, landing-contact times and manual actions, including each action's clip,
  menu metadata, playback policy and completion behavior. The historical `jump`
  key still means Rumba Dance; the actual jump is `actionJump`.
- [MannequinConfig](./src/config/token-adapter/MannequinConfig.js) remains the
  compatibility import for movement constants and the derived model registry.
  All characters share its movement profile and the existing controllers.
  New T-pose models normalize by height, not arm span. The reference mannequin
  retains its original footprint-based normalization and existing role clips.
- [HumanoidRig](./src/scene/token-adapter/HumanoidRig.js) clones the complete raw
  transform hierarchy without retaining source meshes/textures. It selects
  animation-driving bones, not the same-named bind copies that FBXLoader adds
  underneath them for multiple skins. Knight has three skins; Mutant has a
  reduced/asymmetric finger rig. Required body bones are validated; optional
  missing finger bones do not invalidate a compatible humanoid.
- Retargeting uses explicit names, target bind-rotation offsets, hip scale and
  bind-position offsets. It runs in raw model units, never against a placed or
  normalized token. Preserve authored root curves and exact clip duration.
  Retarget failures must not silently return the original incompatible clip.
- Source clips and bone-only rigs are shared across appearances. Retargeted
  clips are cached by target type and reference/retarget policy, then cloned
  for callers. Prepared climb tracks and calibrated ledge grips remain
  per-token; never mutate the cached source to align an instance.
- `Token3DAdapter.playTokenAction(token, commandId)` and
  `GameManager.applyTokenCommand(token, commandId)` are asynchronous. Await
  their boolean result; a Promise is not a successful playback result.
  The quick-command marker is assigned only after playback starts.
- New preview clips load lazily. Grounded/stationary eligibility is checked
  before and after loading, including held walls and committed routes. Removed
  creatures cannot be resurrected by a late download. Concurrent manual loads
  are rejected explicitly rather than queued or allowed to race.
- Ordinary previews retain vertical animation while neutralizing planar travel.
  Dodge uses an authored out-and-back sequence without changing canonical XYZ.
  Take Cover may align canonical X/Z within its current cell, but does not spend
  movement or grant a combat bonus. One-shot recovery uses the mixer's `finished`
  event, not wall-clock timers, and listeners are removed on release/removal.
- Submenus retain at least 24 degrees per action, within a full circle, so the
  eight prototype actions are not squeezed into one quarter-circle. Retracted
  parent tooltips must not obscure their children. Late async results are
  scoped to the menu's current token.

### Facing and motion refinements

- [TokenFacingGesture](./src/managers/interaction-manager/internals/facing.js)
  captures left drags that begin on the actual creature body. It projects both
  the original and current pointer onto the creature-height plane and snaps the
  resulting world-space vector to eight headings. Do not aim from the feet to
  an absolute screen coordinate: clicking the head would bias the direction.
  Simple clicks still use the normal interaction path. Terrain/remove modes,
  Space panning, right-button controls and busy/wall-attached tokens are protected.
  Global release, Escape, blur and renderer-canvas replacement clean up capture.
- [ManualActionMotion](./src/scene/token-adapter/ManualActionMotion.js) joins the
  authored left dodge with `right strafe walk.fbx`, mapping its return trajectory
  to the original rendered anchor. It does not reverse playback. Movement and
  facing wait until the out-and-back completes.
- Cover now uses the actual crouched `stand to cover (2).fbx` variant, not the
  standing-cover variant. Posed visible geometry calibrates grounding, crouched
  height, back extent and final heading for each rig. This matters for Mutant's
  different limb proportions. The short approach stays in the original cell,
  and a yaw-neutral held pose avoids a turn/snap when cover is released.
- Cover requires a cardinally adjacent terrain wall high enough for the pose.
  Both menu availability and playback check eligibility; the latter rechecks
  after loading. Disabled submenu leaves must reject keyboard and pointer input,
  not merely look disabled. Removing the cover wall releases the pose.
- [TokenMovementConfig](./src/config/TokenMovementConfig.js) defines physical
  height bands in feet. The maximum ordinary step is 1.5 feet (inclusive);
  waist-height vault/hop eligibility ends at 2.5 feet. Convert terrain levels
  through the current elevation unit and five-feet-per-square scale. The former
  `drop > 3 levels` cutoff incorrectly treated the captured 4.38-foot ledge as
  a walkable step when elevation was 0.438.
- [TraversalMotion](./src/scene/token-adapter/movement/TraversalMotion.js) samples
  authored feet and hands on each normalized rig. Source root translation is
  transferred to canonical movement while pose clips remain grounded. Short
  mantles select a suitable portion of the existing authored climb; controlled
  lowering reverses that supported climb sequence while facing the wall.
  Small ground transitions blend continuously across the actual terrain edge.
- Short traversal turns only when the heading actually changes, preserving
  unused frame time after a necessary turn. Do not insert a fixed turn-in-place
  delay into an already aligned Run approach.
- Crouch/stand recovery follows the complete per-rig planar root curve, including
  lateral movement, without stretching it across arbitrary tile endpoints.
  Ground gait covers the remaining distance. This keeps planted feet from
  sliding in both forward standing recovery and reversed lowering entry;
  ignoring the lateral curve is also visibly wrong for Mutant's proportions.
- New authored vault and two-foot-platform hop clips supply low-obstacle motion.
  Vault route edges cross one cardinal obstacle cell onto clear same-height
  support, cost 10 feet plus double the rise, and require the complete allowance.
  Recheck the obstacle/landing before starting. Root-motion warping is
  velocity-limited when foot-clearance constraints release, avoiding one-frame
  jumps. Keep actual feet above the obstacle, not merely the canonical anchor.
- Committed vaults finish after live mode changes. Queued, unstarted vaults become
  controlled up/down waypoints when switching to Walk. Explicit top-cell goals
  never vault beyond their destination. Selection suppression and world-authority
  locks are released at the exact supported endpoint.
- [MotionRefinements](./tests/unit/scene/token-adapter/movement/MotionRefinements.test.js),
  [ManualActionMotion tests](./tests/unit/scene/token-adapter/ManualActionMotion.test.js),
  [facing tests](./tests/unit/managers/TokenFacingGesture.test.js), and
  [vault planning tests](./tests/unit/entities/creatures/VaultMovement.test.js)
  cover the captured height scales, all three real rigs, foot clearance, planted
  contact drift, uninterrupted Run handoffs, complete Walk crossings, continuity,
  movement costs, mode changes, wall availability and camera-aware gestures.

### Adding an asset

1. Download through the normal signed-in Mixamo UI. Wait for the selected
   preview to finish loading **before** opening Download; the title can update
   before Mixamo's export state does. If Adobe expires the session, sign in
   normally rather than extracting credentials or bypassing browser security.
2. Character: select a **T-Pose**, export **FBX Binary, With Skin, 30 FPS,
   no keyframe reduction**, retaining embedded textures. Animation: use the
   shared **X Bot** source and export **Without Skin**, with the same format/FPS
   and no reduction. This batch uses default modifiers and no mirroring.
   Preserve authored root motion; in-place preview policy belongs to playback.
3. Save into [animated-sprites](./assets/animated-sprites/) without overwriting
   an unrelated asset. Check the binary header, parse the FBX, inspect required
   bones, decode material images, and verify the actual clip duration/end pose.
   An asset title alone is not proof of a usable complete animation.
4. Character: copy a compatible entry in `CHARACTER_DEFINITIONS`, changing its
   unique ID, label, icon/color and model path. Keep `aliases: []` for a new ID,
   the shared logical scale, height normalization and retargeting. No new
   logical subclass, factory branch, validation whitelist or HTML button is needed.
5. Action: add one entry to `MANUAL_ACTIONS` using a unique command/animation
   key, `visualClip(...)` and `VISUAL_PLAYBACK`. Add `revertTo: 'idle'` for a
   one-shot; omit it for a held/looping performance. Loading, menu entries and
   dispatch derive from that entry. Do not repurpose a locomotion or legacy key.
6. Run [HumanoidContracts](./tests/unit/scene/token-adapter/HumanoidContracts.test.js),
   the existing wall/root-motion suites, menu tests, then the broader checks
   above. Contracts enumerate registered characters, so a new definition must
   satisfy the same behavior and contact tolerances.

The existing `stand to cover.fbx` is reused. Dormant `jumping up.fbx` and
`Running Jump.fbx` end airborne, and the unused legacy `jump.fbx` did not parse;
none was substituted for a complete jump or modified. The new `Jumping.fbx`
contains a complete 1.9-second cycle that returns to its starting height.

### Imported assets and provenance

Downloaded from [Adobe Mixamo](https://www.mixamo.com/) on October 27, 2026.
Character source names are **Knight D Pelegrini** and **Mutant**. The nine new
animation exports use X Bot; original assets and licenses remain intact.
Mixamo assets retain [Adobe's own usage terms](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html),
not the application's MIT license; do not redistribute them as a standalone
character/animation library.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `Knight T-Pose.fbx` | 10,852,288 | `f2ea71e09b7a5d92a23efd318ae0493b67919085a65c83c3d2b19a0a3ff8dee2` |
| `Mutant T-Pose.fbx` | 19,800,640 | `f8c5b872648d3e73e8d65246e4f1163c07238d1327d56d985e7424cf13a95f92` |
| `Waving.fbx` | 305,040 | `524107e646d9696a8aa44d72723cde03ec463be3bb1b2f58342005bcf6cfee39` |
| `Sitting Idle.fbx` | 533,536 | `3f3cf77cafc64d59a4a3965e8c2411ea4e3c86658fa1ef257e7676b843f8f709` |
| `Punching.fbx` | 343,424 | `9e94f20c79af3d0153f1e26f773c4aae8f4f262699e6830e39494ea7e74e1439` |
| `Standing React Large Gut.fbx` | 414,480 | `297b0b0ce7ab8c7eceadfb2660b3cbc1b52fbce5a3a94bb632b0a5b051602bf5` |
| `Standing Dodge Left.fbx` | 356,384 | `d338d3e22137a87c265c4adb0f29d18365c16e8e5780fa87576d78741f1d2a1e` |
| `Standing 2H Magic Attack 01.fbx` | 568,592 | `036d68bfc32c724381ea1113c0146368dd911674e450bee88d589eb2dccbd8f1` |
| `Jumping.fbx` | 457,360 | `67770690d4bda8b0538d3518df6abdb1f96f9a27a4b6a8f0d3d2f155cbb5cfac` |
| `Vault Over Box.fbx` | 627,568 | `7b69c635ec085290083fc5f9c20adf072aa1b6817717e4eb157b373faaf1b8a4` |
| `Jump Down.fbx` | 545,920 | `4f07f80f1e897f232577b05129b5bfe250225a4ef25e2624e8612c8efb565e17` |

The two traversal clips were exported from X Bot as FBX Binary, Without Skin,
30 FPS, no keyframe reduction and default modifiers. Mixamo descriptions were
**Vault Over Box And Hide** and **Jumping Down From 2 Feet Platform With 2 Feet**.
Vault playback uses the traversal/landing portion before its later hide sequence.
Existing strafe and crouch clips were reused rather than downloaded again.

### Browser and contract verification

- Actual-FBX contracts cover all three characters and all thirteen manual
  commands, including the five existing emotes. They check grounding, styles,
  budgets, held/resumed climbs, hand-to-lip contacts, physical falls, recovery,
  lazy loading, explicit retarget failures and late-load/removal safety.
- The browser loaded all models and decoded Knight's nine and Mutant's two
  embedded 2048-by-2048 material maps. CPU-geometry body raycasts selected each
  appearance. All eight action icons were visible, in the viewport and
  non-overlapping; keyboard Cast Spell loaded, played and returned to idle
  without moving its token.
- The earlier `webgl_unavailable` report was a false negative in the application
  preflight, not a hard VS Code limitation. A real WebGL 2 context succeeded
  with `failIfMajorPerformanceCaveat: false` but failed with `true` on the
  Microsoft Basic Render Driver backend. The preflight now matches
  WebGLRenderer's default policy instead of treating a performance caveat as
  missing graphics support.
- Regression tests exercise that production probe without its Jest shortcut:
  valid software-backed contexts are accepted and genuinely unsupported
  browsers remain rejected. Probe contexts are released after checking.
- Fresh initialization created a real rendering canvas and rendered the grid.
  A subsequent live screenshot confirmed the board, Knight and Mutant in
  the VS Code test window. No fake WebGL support or graphics-setting override
  was used. The failed test tab was reloaded only while empty; the scene was
  left untouched once the owner began placing creatures and editing terrain.
- The separate motion-refinement preview verified real mouse-drag heading,
  unchanged-position Dodge with roughly one-square visible excursion and return,
  pointer/keyboard-disabled cover without a wall, aligned held cover beside a
  wall, and actual click-driven vaulting. A 2.19-foot obstacle cost 14.38 feet
  to vault; clicking its top instead climbed for 9.38 feet, and Run hopped down
  for 5 feet. Both older user-edited test scenes remain intact.

## Movement settings, range, and execution

- [TokenMovementConfig](./src/config/TokenMovementConfig.js) defines the 50-foot,
  Walk, Default settings and the disabled keyboard-token-controls flag. Keep
  the old keyboard handlers and engine APIs for potential re-enabling, but do
  not bind them at the input boundary while that flag is false.
- [TokenMovement](./src/entities/creatures/TokenMovement.js) validates per-token
  settings and computes minimum-cost reachable routes. Straight and diagonal
  edges cost five feet; climbing adds exactly twice the vertical feet, including
  Walk descents. Run drops have no vertical cost. Small non-climbing steps retain
  normal grid cost. Include intermediate climbs, not just net elevation.
  Wall bands are reachable even when the top is not. A hanging start is a virtual
  graph node with costed exits to ground and ledge, not a free start on the tile
  below it. An already attached 50-foot action permits exactly 25 vertical feet.
- [MovementRange](./src/scene/token-adapter/pathing/MovementRange.js) owns
  approved movement actions. User destinations must use `requestMoveToGrid`
  or `requestMoveToSurface`;
  `navigateToGrid` remains the lower-level animation primitive for approved
  route segments, climb continuation, and engine tests. Rejected/busy requests
  must not clear selection or release an emote.
- Execute the same route used for reachability, compressing only level collinear
  segments. Other tokens and the existing terrain-manager blocking-placeable
  map participate in planning. Diagonal movement cannot cut occupied corners or
  steep cliff corners. This does not add a new collision-footprint system for
  generated asset meshes.
- [WallMovement](./src/scene/token-adapter/movement/WallMovement.js) controls
  approach, looping wall motion, mantle, recovery and departure. Walk descent
  reverses recovery/mantle at the ledge, then plays `climbWallDown` forward for
  wall travel. Models without a dedicated downward action retain reversed-up
  behavior. Sample paused actions explicitly without advancing the mixer fade
  clock twice. Preserve loop phase across holds/resumes and crossfade once on
  direction changes; do not reset/re-fade the same wall action.
  The `climb-hold` phase is stationary but remains world-locked and retains its
  pose. It accepts the next fresh action without being grounded by idle resync.
  Prefer five-foot destinations before starting motion, with exact budget/terrain
  endpoints when needed; do not snap the rendered position at the end.
  Synchronize grid ownership with canonical world positions during wall motion
  and departure, and reserve the occupied wall column even near a mantle.
- The authored mantle height is shared between wall planning and execution.
  `face.restHeight` identifies the stable hanging anchor, not a permanent drawing
  cutoff. When that anchor is affordable, extend reachable wall bands to the lip
  and map upper-wall hits to `ledgeHang` at the anchor's actual movement cost.
  Standing on the platform remains a separate grid destination. Do not remove
  the entire upper strip merely because ordinary wall loops end below it.
  Reject out-of-range hits before rounding; only an unaffordable safe endpoint
  is excluded. Draw exact-minimum allowance boundaries without duplicate lines.
- `ledgeHang` is a static derivative of the mantle's first two-hand grip pose,
  not a paused mid-crouch frame. Its cloned root track is calibrated to the
  actual hand bones once during setup, so both hands meet the lip in all four
  directions. No additional asset was downloaded or modified.
  Retain its outgoing planar root contribution through crossfades into climbing
  or descent; otherwise resuming causes a visible release snap.
  Budget caps must stop in a loop/hang pose before an unaffordable mount, or
  finish standing on a supported top-edge point if descent entry is unaffordable.
  Never hold a partially played mantle or recovery action.
- [SelectionEffects](./src/scene/token-adapter/SelectionEffects.js) owns the
  selection marker's support-surface transform. Project attached markers to the
  actual wall plane with a 0.02-world-unit outward offset, centered on the exact
  posed bounds of visible body geometry. Exclude the invisible collider and
  marker itself; do not center on the logical feet or grid-space anchor.
  Do not simply rotate a ground marker: it is a child of the yawed token.
  Convert world normals with
  the transpose of the token world matrix so non-uniform transforms also work.
  Movement/manual-height changes and post-neutralization held-pose frames use
  the same transform helper. Cache exact body bounds until geometry, bone,
  bind, morph or mesh transforms change; re-skinning an 84,816-vertex body every
  frozen frame cost about 7.88 ms in the repro. Cached updates measured 0.039 ms.
  Approach, exit, release and ground states restore the original flat marker
  and manual-height compensation; cinematic visibility rules are unchanged.
- Recheck selection/suppression after asynchronous marker creation. Concurrent
  requests must share one owned marker, and removed/replaced token meshes must
  not gain orphaned rings. Report rendering failures rather than silently
  swallowing transform errors.
  [SelectionIndicatorSurface.test.js](./tests/unit/scene/token-adapter/SelectionIndicatorSurface.test.js)
  covers all cardinal faces, tile scales, yaw/non-uniform transforms, height
  tracking, ground restoration and delayed lifecycle races. Native verification
  moved the ring from X=5.84 to X=5.98 on a wall at X=6, with outward normal
  (-1,0,0) and zero vertex deviation from its offset plane. A controlled descent
  retained that plane at a new height; dismount restored normal (0,1,0) and
  ground Y=0.02. The revised upper-wall click kept the full band up to Y=7.2,
  cost 17.206 feet, and held at its Y=5.979 anchor with a real edge grip:
  maximum hand-height error was 0.000242 world units and plane error 0.001448.
  The wall ring's Y/Z center exactly matched the rendered body, at Y=6.704
  rather than the lower logical anchor. Older user scenes were not reloaded.
- The authored descent is
  [Climbing Down Wall.fbx](<./assets/animated-sprites/Climbing Down Wall.fbx>),
  downloaded from [Adobe Mixamo](https://www.mixamo.com/#/?page=1&query=Climbing%20Down%20Wall&type=Motion%2CMotionPack)
  on October 26, 2026 with user authorization. Export settings: FBX Binary,
  Without Skin, 30 FPS, no keyframe reduction, default Overdrive/Arm-Space,
  Mirror off and In Place off. The unmodified asset is 467,616 bytes, with a
  two-second / 61-frame clip, 65 bones and 53 tracks. Usage is subject to
  [Adobe's Mixamo terms and FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html);
  no account information or temporary signed download URLs belong in the repo.
  SHA-256: `2a74fdcdaff12089983c2f5230eaa2ea88f5db553209d31b04e8b9d13be27c31`.
- Prepare upward/downward wall clips against the same feet-relative root anchor:
  the downward source begins one authored cycle higher. Preserve each original
  root curve separately; use its signed direction to map increasing action time
  to descending world height. Real-FBX regressions cover 30/120 FPS and uneven
  timing, multiple cycles, held hands, continued phase and direction changes.
  A native wall click traversed three downward cycles with full steady action
  weight, maximum hand speed about 2.386 world units/second, and the unchanged
  37-foot cost for a 16-foot descent plus entry.
- Freeze the distance allowance for the accepted action and ignore retargeting
  until it finishes. Mode and Type are live: `applyMovementStyle` updates current
  locomotion plus the action's later waypoints, maintained goals, resume probe,
  and fall-resume context. Preserve progress rather than restarting locomotion.
  Run does not grant extra distance or automatically become Sprint.
  Default/Drunk independently select the existing walk/run animation families.
  Changes to the Speed distance allowance apply to the next action.
- Track actual completed-segment spending, not just the original route quote.
  A Run-to-Walk change before falling can require a partial wall stop, and can
  also shorten later ground waypoints. Neither may exceed the frozen allowance.
  Walk-to-Run during a descent releases to lower ground; charge only the climb
  already performed, not the fall. Once release/fall begins, Walk cannot catch
  the creature mid-air. Selecting Run while stationary on a wall does not drop
  it until a lower-ground destination is clicked.
- Planned-action mode/type take priority over stale path fields, including
  between cinematic phases. Use the existing movement-variant synchronization:
  it updates style flags without restarting a climbing clip, so its handoff
  resumes with the new gait. The intentional descent/drop transition is the
  exception; a started release/fall remains cinematic and completes safely.
- Terrain edits do not re-plan an already committed animation. Idle height
  resync keeps canonical and rendered positions together; do not reposition a
  token mid-climb/fall. Updated terrain and scale apply to idle highlights and
  subsequent requests. Invalidate the range for selection/settings, terrain,
  board/scale changes, scene replacement, and moving occupants changing cells.
  A held creature stays at its wall anchor. If its supporting wall is removed,
  release it into the existing fall/landing flow rather than leaving it stuck
  or teleporting it down.
- [PickingService](./src/scene/picking/PickingService.js) treats a miss on an
  existing terrain mesh as background. Do not intersect an infinite fallback
  plane and clamp that miss into an edge tile. Only use the analytic fallback
  before a terrain mesh exists, with known board dimensions and in-bounds cells.
  Exact real hits on the outer mesh edge still resolve to their adjacent tile.
  Pointer coordinates outside the map canvas cannot produce a destination, and
  coordinate-mapping failures are reported rather than silently replaced.
- A real creature-body ray hit may still select an overhanging creature when
  there is no ground hit. Use its actual grid cell, never a clamped background
  projection; exclude oversized invisible colliders for these body-only picks.
  Async/sync pointer resolution, grid-coordinate conversion and terrain-brush
  conversion must not revive an authoritative 3D miss through 2D fallbacks.
  Preserve the selected creature when ignoring an empty 3D click.
  Legacy coordinate fallback remains available when no 3D picker exists.
- [GroundPickBounds.test.js](./tests/unit/scene/picking/GroundPickBounds.test.js)
  uses real terrain geometry and cameras to cover all board sides, elevated
  perspective, framebuffer scaling, mesh holes, bounded pre-mesh fallback,
  actual edge hits and body-only selection. Input tests also cover background
  rejection, sync/async parity, brush bounds and selection preservation.
  Native repro: background pixel (1200,900) missed the terrain but raw cell
  (1,10) was clamped to (1,7). After refreshing only the fixed input methods in
  the running scene, three real background clicks left all positions, selection
  and camera unchanged; four valid grid cells, body hits and wall hits still
  resolved. The map was not reloaded. A new renderer in the empty scratch tab
  was unavailable, but the existing renderer was usable; no WebGL workaround
  was added, and the empty scratch tab was cleared afterward.
- Picking retains the exact wall hit point and height, separately from the
  legacy grid inset. Determine the solid side from neighboring terrain heights:
  production heightfield wall winding can point inward. Test the actual
  [TerrainMeshBuilder](./src/scene/terrain/TerrainMeshBuilder.js), not only a box.
  Ignore oversized invisible selection colliders for attached creatures; only
  actual body hits should select them. Logical grid/sprite fallbacks must not
  select a hanging creature when clicking the ground below it, or a creature
  standing above a wall hit.
- [MovementRangeOverlay](./src/scene/token-adapter/MovementRangeOverlay.js) uses
  depth-tested line segments only: edges shared by reachable cells are omitted,
  excluded holes are outlined, and vertical connectors join height changes along
  the perimeter. Union wall bands across coplanar strips, omit shared interior
  vertical edges, and omit ground/wall seams when both surfaces connect.
  Do not connect across unreachable wall gaps. There are no filled tiles or
  picking participation.
  Hide it while the selected token moves; show the new boundary on completion.
  Dispose replaced geometry and owned rendering resources on teardown/rebuild.
- Clip terrain look-ahead at the approved destination, so arriving next to a
  wall cannot trigger an unsolicited climb beyond the goal. A landing roll must
  fit the current approved segment; otherwise use the existing braced landing.
  A final climb can finish through the resumption path rather than normal path
  completion: explicitly restore idle when the approved action ends.
- Regression coverage includes 50-foot/ten-square edges, repeated climbs,
  non-unit tiles, terrain detours, profile isolation, all four gait combinations,
  busy rejection, keyboard disablement, live overlays, and resource cleanup.
  Boundary tests cover adjacent cells, irregular shapes, holes, ledge joins, scale,
  and empty ranges. Real controls switched all four gait combinations during one
  move: measured travel matched each active speed without changing the goal or
  action. Climb/fall replays retained their cinematic clip and resumed in the new
  gait; arrival still returned to idle.
  Actual-FBX checks also cover held hands, reverse mantles, up/down resumption,
  exact tile ownership after landing, and drop-to-idle completion.
  Native real-click checks on a 36-foot wall verified a 20-foot partial climb
  costing 45 including entry, subsequent 5-foot up / 10-foot down moves costing
  10 / 20, a 16-foot Walk descent costing 37 including entry, and a free Run drop.
  A live Run-to-Walk change spent exactly 50 and stopped 13.5 feet above the base.
  The preview retains one hanging creature and one on the ledge; no animation
  assets were edited.
  The test host throttles hidden-page animation frames; deterministic real-asset
  replays advance mixers, movement, route management, and root neutralization
  in the normal order, restoring the app callback afterward.

## Camera projection and view modes

- [CameraSystem](./src/scene/camera/CameraSystem.js) owns a cached perspective
  lens for normal 3D orbit and an orthographic lens for tactical top-down.
  `ThreeSceneManager.camera` always points to the active lens.
- Normal 3D uses a 35-degree field of view. Board dimensions, tile size, viewport
  aspect, and zoom determine orbit distance; perspective near clipping is positive.
  Framing is recomputed rather than keeping a stale board-size cache.
- Camera targets are three-dimensional. Preserve target height through pan,
  orbit, zoom, resize and projection changes; board reset restores height zero.
  Cursor anchoring uses the current focus-height plane, and the legacy rig must
  retain that height too. Resize the renderer after mounting its canvas:
  sizing it before mounting can extend the canvas under the sidebar and move
  the apparent center away from the usable map viewport.
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
- Renderer recovery must reuse its fallback canvas: interaction and terrain
  listeners are already attached to that element. Creating a new canvas lost
  right-drag rotation in software-WebGL test sessions. The container wheel
  fallback must ignore already-prevented events so canvas controls do not zoom
  twice. [Input recovery tests](./tests/unit/scene/ThreeSceneManagerInputRecovery.test.js)
  exercise actual DOM rotation, drag release, and wheel handling across recovery.

## Biome model placement and trunk support

- Oasis had two independent asset-path faults: its tropical node names did not
  match the actual FBX, so selection returned the complete pack; the instance
  pool then used only its first raw geometry, losing the model's scale, rotation,
  and pivot. Reproduced plants were about 57.3 world units tall instead of their
  2.4/3.6-unit targets. The corrected targets include 6.4-unit palms.
- [ModelAssetCache](./src/core/ModelAssetCache.js) now selects exact, verified
  tropical nodes. Missing or ambiguous requested nodes are explicit preparation
  failures, never a successful whole-pack fallback. Preserve the selected node's
  full parent transform.
- [ModelPostProcessing](./src/core/ModelPostProcessing.js) multiplies the authored
  scale when calibrating height. Ground and center static models using their
  basal two percent, not the center of an asymmetric canopy. The two Monstera
  leaf materials use their supplied RGBA color cutouts rather than absent FBX
  opacity images.
- [placeableModelGeometry](./src/scene/terrain/placeableModelGeometry.js) bakes all
  mesh transforms into owned geometry, retaining material groups and reflected
  triangle winding. Do not mutate or dispose geometry shared with cached assets.
  Dispose unpublished baked geometry when a map-reset epoch cancels its group.
  The existing pinned Three.js BufferGeometryUtils addon is mapped in the browser;
  Jest permits its ES-module addons so tests can parse actual OBJ/FBX assets.
- [Flora generation](./src/coordinators/terrain-coordinator/internals/flora.js)
  explicitly marks generated instances. For generated tree IDs only,
  [treeSupport](./src/scene/terrain/treeSupport.js) checks the basal footprint
  against the live coordinator heights and map bounds, with one percent of a
  tile as edge clearance. Full size is preferred; find the largest supported
  uniform scale down to 0.65, otherwise skip the site. This is the owner's
  selected policy, not global downsizing or canopy containment.
- Store the fitted scale in instance metadata so height resync does not enlarge
  trees again. Manual placements are not automatically fitted. Terrain edits
  after generation do not reselect/refit existing trees.
- Real-asset regressions cover all nine tropical entries and generated Oasis
  seeds 12345/1583664074, temperate forest seed 12345, and Mystic Grove seed 24680.
  Check the rendered trunk vertices, not just a nominal tile footprint.
  Additional cases cover cliffs, board edges, the 65% limit, compound models,
  canopy overhang, material isolation, and asynchronous reset/disposal.
- Fresh-load browser checks confirm calibrated Oasis geometry, rooted plants,
  supported palm-base vertices, and the Monstera alpha policy. The source FBX
  still references optional maps not supplied with the pack, so parsing can
  request missing maps (HTTP 404) and warn about unsupported channels. These
  references are not replaced with fabricated textures. Asset files remain unchanged.

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
- Height-segment boundaries must not restart or re-fade an already looping wall
  action. Repeated forced fades briefly reduced action weight to about 0.046,
  blending the skeleton toward bind pose and producing a 0.392-world-unit hand
  step. Keeping the action running reduces the 120-FPS step to about 0.018.
  Carry frame overshoot into the next geometric segment so uneven frame timing
  does not drift away from the action clock.
- [ClimbWallContinuity.test.js](./tests/unit/scene/token-adapter/movement/ClimbWallContinuity.test.js)
  builds the actual mannequin and climbing clips through the production setup.
  It measures the rendered skeleton's hands, steady cycle weight and phase
  alignment at 30/60/120 FPS and uneven deltas. Bone-pose coverage is essential:
  canonical position-only tests did not catch the repeated fade artifact.
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
- [FallPhases](./src/scene/token-adapter/movement/FallPhases.js) uses
  `32.174 ft/s²` gravity converted through the five-foot tile width, not terrain
  height-level counts. Vertical travel is quadratic in time; horizontal travel
  remains steady. The former level-based duration and tall-drop slowdown made
  20/36/60-foot drops last approximately 2.575/7.425/18.8 seconds instead of
  1.115/1.496/1.931. Do not reintroduce the old fall-loop speed/duration overrides.
- Keep airborne and recovery clocks separate. Start landing at its authored
  contact time before impact, carrying frame overshoot into the landing action.
  Short drops can skip excess pre-contact clip frames rather than extending
  airtime. Without a fall loop, hold the intro pose until its landing cue.
  Recovery remains at normal playback speed and cannot finish before contact.
- Position-only arrival tests did not detect the slow fall. Prevention is
  quantitative airtime/acceleration coverage across world tile sizes, elevation
  scales, 30/60/120 FPS and uneven deltas, plus actual-FBX contact and recovery
  checks. Native browser measurements were 1.499 seconds for a 36-foot ledge
  drop and 1.115 seconds for a 20-foot wall release; both ended at the requested
  ground position, idle, with the world lock released. At the 36-foot contact,
  the hard-landing clip was at 0.104 seconds and toe clearance was 0.031 world
  units. Runtime measurement callbacks were removed afterward.
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
