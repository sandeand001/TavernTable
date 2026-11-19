# TavernTable codebase audit

**Audit date:** 2026-11-17
**Revision:** `feat/curved-structure-shapes`, commit `dd22a1041245`
**Target:** complete current working tree, including pre-existing uncommitted
proposal documents
**Mode:** read-only implementation audit; this document is the only file added by
the audit

## Scope and limits

The audit covered runtime code, terrain and geometry, rendering and assets,
campaign persistence, local hosting, gameplay rules, UI, tests, tooling,
dependencies, Firebase configuration and repository documentation.

It also incorporates the owner's
[correction backlog](../proposals/Items%20that%20need%20correction.md) and the
remaining release gates in the
[cloud accounts and multiplayer checklist](../proposals/cloud-accounts-and-multiplayer-checklist.md).
Owner-reported behavior is identified separately from code-confirmed defects.

This is a code and verification audit, not a browser-GPU performance profile,
penetration test or cloud infrastructure inspection. The performance findings
are exact code paths with an expected mechanism, not claimed frame-time
measurements. Production-scale measurements should precede optimization.

The implementation and test evidence belongs to the checked-out revision.
Cloud migration documents in the working tree explicitly describe another
implementation branch, and are treated as pre-existing documentation rather than
proof that those modules exist in this revision.

## Executive summary

TavernTable has unusually strong domain documentation, a broad test inventory
and several sound architectural decisions. Terrain ownership, revision-checked
saves, source-pinned catalogs, campaign authorization and backup retention are
clearer than in many personal projects. The main gaps are:

1. **The current verification baseline is red.** A complete run found 47 failing
   tests across 13 suites. Representative UI, interior checkpoint, castle-door
   and real-rig movement failures reproduced in isolation.
2. **Several expensive operations are repeated at frame or snapshot frequency.**
   Map projections, tactical layout, terrain notifications, character-sheet
   rebuilds and combat snapshot copies all have code-confirmed hot paths.
3. **The source and runtime assets are not cleanly separated.** The tracked
   asset tree is 502,116,584 bytes (478.86 MiB), including source formats,
   duplicate representations and textures. That payload is understandable for
   authoring but should not be the public runtime package.
4. **The dependency declaration is overloaded and currently reports registry
   advisories.** Most packages under `dependencies` are toolchain transitives or
   unreferenced candidates rather than application runtime dependencies.
5. **Lifecycle and persistence seams need stronger ownership.** Some browser
   listeners and process maps lack teardown/expiry, and backup imports are
   accepted before semantic validation. These are narrow but important
   consistency and retention risks.
6. **Documentation and release facts have drifted.** Current documentation
   records several incompatible baselines and contains branch/deployment claims
   that do not apply to this checkout. There is no checked-in CI workflow.
7. **The correction backlog contains several distinct user-visible contracts,**
   not merely visual polish: non-meaningful changes currently trigger saves,
   player views are not bound to an assigned creature, radial menus are
   intentionally left-clickable, zoom remains board-scale limited, and
   generation lacks a biome-specific recipe step.
8. **Cloud production remains gated.** The checklist records 60/65 migration
   tasks complete, with `M5-06` and `M5-08` through `M5-11` incomplete.
   Hosted correctness, production deployment and cutover should not be inferred
   from private-pilot evidence.

### Measured repository shape

| Measure                                      |                                  Value |
| -------------------------------------------- | -------------------------------------: |
| Tracked files                                |                                  1,773 |
| Tracked JavaScript files                     |                                    592 |
| Files under `src/`                           |                                    314 |
| Files under `tests/`                         |                                    265 |
| Audited text files (`src`, `tests`, `tools`) |                    593 / 143,772 lines |
| Tracked assets                               | 1,144 / 502,116,584 bytes / 478.86 MiB |
| Terrain assets                               |                              320.6 MiB |
| Animated character assets                    |                              136.3 MiB |
| Resource/data assets                         |                               15.4 MiB |
| Other tracked visual assets                  |                                6.6 MiB |

These sizes are a reason to create an asset packaging boundary, not a reason to
delete source assets or reduce model/texture quality in place.

## Verification baseline

| Check                                      | Result                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test -- --runInBand --ci`             | **Failed:** 13/254 suites and 47/3,438 tests failed; 241 suites and 3,391 tests passed. Duration: 1,115.404 s.                       |
| Targeted reruns of representative failures | The character-sheet heading, empty-interior checkpoint, complex castle door and real-rig movement failures reproduced in isolation.  |
| `npm run lint:all`                         | Passed with 0 errors, 39 warnings; architecture-layer check passed.                                                                  |
| `npm run format:check`                     | Failed only on `tools/.eslintrc.json`.                                                                                               |
| `npm ls --depth=0`                         | Passed; direct dependencies are installed and valid.                                                                                 |
| `npm outdated --json`                      | Registry-reported stale direct/major versions; representative results are listed below.                                              |
| `npm audit --json`                         | Registry-reported 19 vulnerable package entries: 14 high, 4 moderate and 1 low; 0 critical. All entries reported a fix as available. |
| `node tools/find-unused-exports.js`        | Heuristic candidates only; not a proof of dead exports.                                                                              |
| `node tools/cycle-scan.js`                 | No simple relative ESM cycles; limited static scan, not a general cycle proof.                                                       |
| CI workflow inventory                      | No `.github/workflows/` files in this checkout.                                                                                      |

The failed suite is a **release-confidence finding**, not evidence that every
failure has the same cause. It is likely a mixture of real regressions and stale
test expectations, especially after batching, checkpoint normalization, closed
door rules and movement redirection changes. Root-cause triage belongs before
new feature work or dependency upgrades.

## Ranking method

Findings are sorted by potential impact, then by implementation complexity.

- **Impact 5:** can affect release correctness, data integrity, visual quality or
  essentially every user's startup/network experience.
- **Impact 4:** can materially affect frame rate, memory, reliability or
  maintainer productivity across major features.
- **Impact 3:** important but localized or recoverable.
- **Impact 2:** bounded optimization or hygiene issue.
- **Impact 1:** small or debug-only cost.
- **Complexity 1:** isolated, testable change.
- **Complexity 2:** several files or one subsystem.
- **Complexity 3:** coordinated refactor with compatibility tests.
- **Complexity 4:** cross-subsystem architectural or rendering work.
- **Complexity 5:** build/deployment pipeline and asset-format work across the
  repository.

## Prioritized improvement opportunities

| Rank | Opportunity                                                        | Impact | Complexity | Confidence                                    |
| ---- | ------------------------------------------------------------------ | -----: | ---------: | --------------------------------------------- |
| 1    | Restore and enforce a green baseline                               |      5 |          3 | Confirmed                                     |
| 2    | Separate source assets from an optimized runtime package           |      5 |          5 | Confirmed size; solution requires measurement |
| 3    | Replace frame-driven full projection/layout work with invalidation |      4 |          4 | Code-confirmed; not profiled                  |
| 4    | Batch terrain writes and notifications                             |      4 |          2 | Code-confirmed                                |
| 5    | Remove/contain the obsolete second terrain generation path         |      4 |          2 | Code-confirmed                                |
| 6    | Reduce biome-generation peak copies                                |      4 |          3 | Code-confirmed; needs large-map profiling     |
| 7    | Establish CI and an explicit release/publishing workflow           |      4 |          2 | Confirmed repository gap                      |
| 8    | Correct the package manifest and address registry advisories       |      4 |          3 | Registry-confirmed; compatibility untested    |
| 9    | Separate character-sheet work from full-view reconstruction        |      4 |          3 | Code-confirmed; needs interaction profiling   |
| 10   | Semantically validate campaign imports before commit               |      3 |          3 | Confirmed                                     |
| 11   | Make room-discovery persistence recoverable with scene commits     |      3 |          3 | Confirmed consistency risk                    |
| 12   | Bound combat snapshot copying and use declared targeting revisions |      3 |          3 | Code-confirmed; needs scaling benchmark       |
| 13   | Add explicit interaction/sidebar listener teardown                 |      3 |          2 | Confirmed lifecycle gap                       |
| 14   | Bound local-session and rate-limit retention                       |      3 |          2 | Confirmed process-memory risk                 |
| 15   | Make failed model loads retryable                                  |      3 |          1 | Confirmed                                     |
| 16   | Reduce camera/overview and terrain-signature micro-work            |      2 |          2 | Code-confirmed; not benchmarked               |
| 17   | Clean lint warnings, stale shims and dead-code candidates          |      2 |          2 | Confirmed warnings; dead exports unconfirmed  |
| 18   | Repair documentation links and reconcile branch/status facts       |      2 |          1 | Confirmed                                     |

## Owner-requested corrections and cloud-release crosswalk

These items come from the two requested documents. “Owner-reported” means the
behavior needs an exact reproduction and acceptance test even if a base module
passes in isolation. It is not weaker evidence: it defines the required
product contract.

| Priority | Opportunity                                                                                | Impact | Complexity | Evidence                                                                       |
| -------- | ------------------------------------------------------------------------------------------ | -----: | ---------: | ------------------------------------------------------------------------------ |
| C1       | Resolve concurrent-player pending/input-response delay and visible discontinuity           |      5 |          4 | Open `M5-06`; owner-observed click delay, out-of-sequence facing and DM reload |
| C2       | Stop non-meaningful camera/selection interactions from creating saves or interrupting play |      5 |          3 | Confirmed in this checkout; cloud private-pilot fix recorded elsewhere         |
| C3       | Bind player camera/presentation to the selected assigned creature                          |      5 |          4 | Current player viewer allows independent OrbitControls and map browsing        |
| C4       | Reproduce cavern-to-castle generation failure as a full-campaign transition                |      4 |          2 | Owner-reported; direct engine-only transition succeeded                        |
| C5       | Add biome-specific generation choices before destructive Generate                          |      4 |          4 | Current Generate uses seed/structure/density only                              |
| C6       | Make underground geometry grounded and visually distinct                                   |      4 |          4 | Point-height placeable positioning and shared cave recipe                      |
| C7       | Increase settlement/castle variability and scale use                                       |      4 |          4 | Fixed default profiles, structure caps and template branches                   |
| C8       | Make radial menus right-click-only and assignment-authorized                               |      4 |          2 | Current DM interaction intentionally dispatches on left-click                  |
| C9       | Correct castle wall/tower joins and use intentional window rhythm                          |      4 |          4 | Separate wall/turret generators plus randomized facade composition             |
| C10      | Permit closer zoom without degrading large-map overview                                    |      3 |          1 | Fixed max zoom and board-scaled framing                                        |
| C11      | Add 3D models for the remaining dice                                                       |      2 |          3 | Only the single d20 has a physical model/collider                              |

### Cloud checklist: remaining release blockers

The checklist is part of a different implementation branch. Its completion
evidence is valuable, but it cannot be counted as proof against commit
`dd22a1041245` without merging and re-verifying the identified source.

- **`M5-06` — in progress and not accepted.** The November 17 two-window
  check observed a multi-second click-to-movement delay, out-of-sequence facing
  and a DM reload during overlapping actions. The same section reports a
  local false conflict caused by camera zoom or creature selection marking the
  DM scene dirty. The checklist requires every user in a ten-client cohort to
  submit overlapping valid actions, conflicting commands to be rejected without
  kicking anyone out, and intermediate locomotion to appear in all authorized
  views without a destination snap. The audit's frame-driven projection issue
  is directly relevant to that acceptance gate, but the hosted native result is
  not replaced by a local unit-test result.
- **`M5-08` — explicit production-deployment approval is not complete.**
  Performance, owner acceptance, cold wake and the exact release must be
  accepted before infrastructure changes.
- **`M5-09` — deploy without data cutover is not complete.** It must include
  disposable-data smoke tests for identity, save/reopen, private assets and
  sleep/wake, plus rollback readiness.
- **`M5-10` — selected-data cutover approval is not complete.** The exact
  campaign copies, participant bindings and latest local edits require an
  explicit verified source-of-truth decision.
- **`M5-11` — production cutover and first session are not complete.** The
  old sources remain recovery material; an outcome must never silently fall
  back to a second writable master.
- **`UX-01` — completed on the private-pilot branch, not audited in this
  checkout.** The cloud correction hides routine saves, checkpoints and confirmed
  saves while retaining explicit recovery/error feedback. It is supported by
  77 focused tests recorded in the checklist. This behavior must be merged or
  recreated in the target branch and regression-tested alongside the stronger
  “camera interaction does not save” rule.

These five unchecked `M5` tasks are a release sequence, not optional polish.
Do not mark the current repository or hosted frontend production-ready while
`M5-06` remains an unaccepted responsiveness/visual gate.

### C1-C2. Save only meaningful state, do not interrupt play

The correction list asks for background saves only, no routine save indicator,
no gameplay flash, and no save for camera-only changes. This is partly a
requirement clarification, not only an implementation defect.

In this checkout, every camera state change is serialized at
[CameraSystem.js](../../src/scene/camera/CameraSystem.js#L10) and schedules
autosave. Zoom, pan, target changes and reframing flow through that path.
[SceneWorld.js](../../src/campaigns/SceneWorld.js#L211) captures the camera in
the scene checkpoint. [CampaignAutosave.js](../../src/campaigns/CampaignAutosave.js#L46)
publishes “Saving...” and “Saved to host”, and
[CampaignLauncher.js](../../src/ui/campaigns/CampaignLauncher.js#L358)
renders that state into a visible output.

The existing domain model says per-map cameras persist, while the correction
list says the view angle does not need to be saved. This is a product-policy
conflict that should be closed explicitly:

- minimum compatible change: camera movement no longer makes a scene dirty, but
  its last value may still accompany a later meaningful save;
- stricter owner request: camera state becomes session-local and is omitted from
  campaign checkpoints entirely.

The stricter version requires updating schema expectations, SceneWorld,
per-map view tests and the domain documentation. It should not be inferred from
a `generation` or `acknowledged` counter test alone.

**Acceptance:** repeated zoom/pan/orbit/selection creates no write or revision;
terrain, actor and committed rules state still save; routine success is silent
and nonmodal; failure and uncertain durability remain visible; a dirty camera
change cannot cause a cloud conflict or keep a second command pending.

### C3 and C10. Player camera follows the selected assigned creature

The player viewer creates unrestricted
[PublishedMapViewer.js](../../src/ui/sessions/PublishedMapViewer.js#L38)
`OrbitControls`, targets the center on map changes, and does not follow actor
position or bind its pan range. The player application also exposes a map
selector in [PlayerApplication.js](../../src/ui/sessions/PlayerApplication.js#L160)
and distinguishes “opening a sheet, moving the camera or browsing maps” from
sight authority. Authorization is sound; presentation lock is not.

The DM camera uses board-scaled framing in
[CameraSystem.js](../../src/scene/camera/CameraSystem.js#L50), with a fixed
maximum zoom of 3 in [ThreeSceneManager.js](../../src/scene/ThreeSceneManager.js#L94).
Large maps therefore remain coupled to whole-board framing even at maximum
zoom.

**Recommended Interface:** a participant-camera policy chooses owner/DM free
camera, or player-locked camera with a selected observer. The player **Seam**
receives authorized actor location changes and constrains target, orbit and zoom
around that actor. Server authorization continues to limit visible terrain and
assigned observers; client camera state never changes sight.

**Acceptance:** the selected assigned creature stays centered or within a
small owner-approved dead zone, its character-sheet selection changes the
follow target, orbit/zoom remain bounded but usable, unauthorized maps cannot be
opened, and the DM retains full browsing/focus controls. Large maps allow a
measured close-view threshold; overview/reset remains available.

### C4. Cavern-to-castle state transition

The report does not reproduce the owner’s issue in the isolated terrain
generator: direct `cavern → castle` generation succeeded at 25×25, 50×50 and
60×60, replacing a cavern with 7–10 castle structures. Therefore the base recipe
sequence is not sufficient to explain the report.

The likely next seam is the full campaign transaction: existing generated
geometry, actors, placeable flora, connected maps, pending saves, UI biome
selection or scene participant application. The capture in
[CampaignBiomeGeneration.js](../../src/campaigns/CampaignBiomeGeneration.js#L34)
protects authored/occupied scenes and may roll back rather than begin.

**Required reproduction:** fresh and saved cavern, then select Castle and use
Generate; repeat with zero actors, one idle actor, one moving actor and
connected cave content. Record the exact status/error, save generation,
biome/geometry before and after, and whether an unrelated selection causes the
transition to unlock. Add a single regression at the full `generateCampaignBiome`
or browser interaction seam, not only another `TerrainEngine` test.

### C5. Biome-specific generation recipe instead of a blind Generate

The current Generate control in
[SidebarController.js](../../src/ui/SidebarController.js#L397) uses the
current grid, a seed, the Structures checkbox and asset density. Settlements may
auto-grow only a safe default empty canvas through
[CampaignBiomeGeneration.js](../../src/campaigns/CampaignBiomeGeneration.js#L77);
an existing/custom map keeps its dimensions.

The requested interaction is a deepening opportunity: a Biome Generation
Recipe Module with a small review/confirm Interface. It should expose only
choices applicable to the selected biome—descriptive size, density, surroundings,
water/clearance, entrance and exit count, castle scale, settlement outskirts,
and similar options—while retaining a locked, versioned seed and previewable
summary. The generator receives normalized recipe data; UI and seed logic do not
each invent parameter defaults.

**Acceptance:** cancel is non-destructive; generation intent and resolved
numeric values are saved/versioned; locked seeds reproduce exactly; unsupported
choices cannot reach the generator; large/custom canvases are never silently
shrunk; quality/performance stays measurable at every recipe tier.

### C6. Underground grounding and distinctness

The owner reports floating placeables, an over-clustered Crystal Spires and
underground biomes that share the same entrance/exit pattern.

Current pool placement in
[PlaceableMeshPool.js](../../src/scene/terrain/PlaceableMeshPool.js#L370)
samples one cell height, multiplies it by elevation scale and uses that as the
instance origin. Models are grounded at their lowest support point by
[ModelAssetCache.js](../../src/core/ModelAssetCache.js#L698), but one sampled
height is not a guarantee that a trunk/rock footprint contacts an uneven or
steep rendered surface.

Current cave structures in
[BiomeStructures.js](../../src/terrain/generation/BiomeStructures.js#L217)
reuse one recipe: three cave volumes, their connecting tunnels and one mouth.
Crystal Spires separately receives a 0.12-density rock profile in
[FloraProfiles.js](../../src/config/terrain/FloraProfiles.js#L107), so the
clustered visual result is plausible without procedural-crystal authoring.

**Recommendation:** use a support-footprint sample over the rendered terrain
for placement, not only one cell point; keep collision/sight simplifications
separate from visual root/contact adjustment. Introduce biome-specific chamber
recipes rather than one shared cave/tunnel template. Preserve source model
quality and compare the visual result at fixed seeds and scales.

**Acceptance:** each generated rock/tree/mushroom has measurable contact with
the support surface, no visible air gap on a slope, Crystal Spires uses
intentional spacing/landmark clusters, and the underground families differ in
room count, entrance direction, route shape, relief and placeable composition.

### C7-C9. Castle joins, composition, scale and window rhythm

The correction list is structurally broader than a cosmetic adjustment:

- walls and corner turrets must connect at intended right angles, with rotated
  doors/openings where needed;
- a seed should alter topology and room/ward organization, not merely dimensions
  or names;
- larger maps should use their extra area for more meaningful structures and
  surrounding context;
- castle windows should read as intentional and symmetric, except documented
  spiral-stair/tower asymmetry.

Current defaults in
[SettlementProfiles.js](../../src/config/biome/SettlementProfiles.js#L1)
set fixed 35×35 town, 45×45 city, 50×50 castle and 20/32/20 settlement structure
bounds. Auto-sizing is deliberately conservative.
[CastleSites.js](../../src/terrain/generation/CastleSites.js#L13) scales and
quarter-turns one site frame, while
[BuildingModel.js](../../src/terrain/BuildingModel.js#L534) gives version-2
window composition a seeded position/size shift, creating asymmetry by design.

The current generator is not shallow: it has physical floor, window, door and
stair contracts. The improvement should therefore be a deeper Architectural
Module, not a visual-only randomizer. Separate topology planning, physical
attachment, appearance and window rhythm, each behind one small generation
Interface; validate every produced wall/tower join through actual connection,
support, clearance and ray/sight tests.

**Acceptance:** no gap/overlap at castle joins unless explicitly ruined,
rotated turret doors match the connected wall, multiple seeds produce distinct
usable ward topologies, larger maps consume their added area with proportionate
structures/context, and facade apertures have mirrored or intentionally exempted
arrangements.

### C8. Radial menu trigger and player access

The DM input contract currently calls the radial menu when a token is
left-clicked in [InteractionManager.js](../../src/managers/InteractionManager.js#L425),
and [InteractionManager.test.js](../../tests/unit/managers/InteractionManager.test.js#L5)
explicitly codifies that behavior. Right-button radial capture also exists.
The requested correction is therefore a confirmed behavior change, not an
ambiguous styling request.

The local player sheet Module only creates assigned-character records in
[PlayerCharacterSheets.js](../../src/ui/sessions/PlayerCharacterSheets.js#L19).
However, hosted participant rendering and the owner-observed cloud behavior
must be checked independently. Displaying a private DM sheet or permitting a
player to select one is an authorization/UI defect even if actions remain
disabled.

**Acceptance:** left-click selects or moves as applicable but never opens a
radial; a short right-click on an allowed token opens it; right-drag retains
orbit; unassigned or unrelated tokens cannot open any radial or sheet; the
server remains the authority for sheet/control permissions.

### C11. Additional physical dice

The physical dice path is deliberately d20-specific:
[DiceModelManager.js](../../src/systems/dice/DiceModelManager.js#L8) loads one
GLB, and [D20Dynamics.js](../../src/systems/dice/D20Dynamics.js#L102) constructs
the d20 collider. Other dice retain their existing 2D/randomized path.

This is an asset/model expansion rather than a prerequisite for cloud release.
Add it behind one Dice Model Interface with face-center calibration, stable
settling, board-clearance and fallback behavior shared by d4/d6/d8/d10/d12/d20.
Do not multiply separate animation/simulation implementations.

## Existing decisions that the correction list deliberately changes

The correction documents conflict with three current commitments and should be
recorded, not quietly overridden:

1. per-map camera persistence versus no camera save;
2. left-click radial menus versus right-click-only;
3. independent player camera browsing versus character-centered presentation.

The current camera/radial behavior is tested. Updating those contracts should
replace the old tests and domain wording in the same change; otherwise the
implementation will oscillate between “authoritative save/view continuity”
and the owner's desired interaction model.

## Detailed findings

### 1. Restore and enforce a green baseline

**Impact 5 / Complexity 3 / Confirmed**

The full test run completed with 13 failed suites and 47 failed tests. The
failure surface is not isolated:

- Character-sheet linking returns the token name `Knight` while the test expects
  the saved character name `Mira`.
- Interior checkpoint capture adds empty `geometry` and `sightBounds` fields not
  present in an input fixture, while the neighboring physical-wall assertions
  still execute.
- Exterior physical-floor batching produces one batch instead of three child
  meshes expected by a test.
- Generated castle, cliffside and mountain routes now encounter closed-door
  guards in tests that previously planned crossings directly.
- A number of connected-travel and real-rig movement tests disagree with
  redirection/queue semantics.
- Several real-FBX contracts disagree about whether a queued move is a
  successful return or an unavailable request.

Representative failures reproduced independently:

- `tests/unit/ui/CharacterCompendium.test.js:181-184`
- `tests/unit/scene/token-adapter/InteriorWalls.test.js:274-277`
- `tests/unit/terrain/CastleVariation.test.js:170`
- `tests/integration/scene/token-adapter/HumanoidContracts.test.js:211-213`

**Why it matters:** release work, dependency upgrades and optimization cannot be
evaluated reliably when the tests already disagree with the implementation.
The current unfiltered `npm test` command is not a trustworthy merge or release
gate.

**Recommended direction:** classify every current failure first as a confirmed
regression, an intentional contract change with a stale test, or a timing/order
fluke. Add the resulting contract to the smallest appropriate test seam; do not
weaken broad end-to-end assertions merely to get green. Then make the same
commands mandatory in CI.

**Verification:** the entire suite is green with no skipped tests unless a skip
has an explicit tracked reason. Keep the existing real-geometry/animation
coverage and preserve the current visual behavior.

### 2. Separate authoring assets from a quality-preserving runtime package

**Impact 5 / Complexity 5 / Confirmed payload; optimization proposal**

The tracked asset payload is 502,116,584 bytes across 1,144 files. The main
working tree contains:

| Asset group                     |   MiB |
| ------------------------------- | ----: |
| Terrain models/textures/source  | 320.6 |
| Animated character models/clips | 136.3 |
| Resource/data packs             |  15.4 |
| Items, sprites and images       |   6.6 |

The tracked migration inventory in
[cloud-migration-preparation.md](../proposals/cloud-migration-preparation.md#tracked-asset-totals)
agrees with this byte total and identifies about 66 MB of repeated content
within the raw inputs. Largest individual authoring files include 19.18 MiB,
18.88 MiB and 18.68 MiB character FBX files, a 16 MiB TGA texture and a
4.86 MiB d20 GLB.

`three` and `cannon-es` are also loaded from jsDelivr at runtime via the import
maps in [index.html](../../index.html#L17) and
[player.html](../../player.html#L12), although package copies also exist for
Node/tests.

**Why it matters:** source-model formats, unoptimized textures and duplicate OBJ/
glTF/texture representations are useful to development but costly to download,
decode, cache and publish. The runtime has no repository-defined production
asset allowlist, and CDN loading makes startup depend on another network
service.

**Recommended direction:**

- preserve all authored source assets and licensing/provenance files in the
  repository;
- introduce a deterministic runtime packaging Module that chooses only required
  assets, hashes them and emits an immutable manifest;
- convert/quantize runtime copies, not source masters, to format-appropriate GLB,
  texture and animation formats;
- deduplicate runtime content by hash and lazy-load biome/character families
  rather than treating the entire repository as the default website;
- evaluate local vendoring of the exact Three.js/Cannon modules or use a stable
  immutable runtime bundle to remove CDN variability;
- add visual/geometry parity gates: representative rendered screenshots, model
  support bounds, materials, animation duration and d20 collision behavior.

This is high-complexity work because it spans build, deployment and visual
quality. It is not an invitation to lower texture resolution, polygon quality or
animation fidelity without measured and owner-approved parity.

### 3. Replace frame-driven full projection/layout work with invalidation

**Impact 4 / Complexity 4 / Code-confirmed; not production-profiled**

[Token3DAdapter.js](../../src/scene/Token3DAdapter.js#L175) starts
`syncMapProjections()` every rendered frame.
[MapProjections.js](../../src/scene/token-adapter/MapProjections.js#L43)
then rebuilds token membership, recomputes line of sight, updates projection
meshes and syncs supporting terrain. Its asynchronous model-loading path is not
coalesced against another frame-triggered call.

The same frame loop requests:

- tactical-token mesh/selection/material updates in
  [TacticalTokens.js](../../src/scene/token-adapter/TacticalTokens.js#L81);
- overview projection/layout, DOM positioning and line geometry in
  [TacticalOverview.js](../../src/scene/token-adapter/TacticalOverview.js#L149);
- billboard matrix work across every live billboard after camera changes in
  [PlaceableMeshPool.js](../../src/scene/terrain/PlaceableMeshPool.js#L727).

The overview text itself is change-guarded, but projection and layout work still
repeat. This distinction matters: the issue is repeated geometry/DOM work, not
proven that every label is redrawn.

**Deepening opportunity:** create one deep render-invalidation Module that owns
the rules for dirty observer, actor, geometry, camera, visibility, model-loading
and map-view changes. Callers submit a fact that changed; the Module schedules
the smallest update and coalesces in-flight reconciliation. Lightweight
animation/position updates stay on the frame path. That concentrates knowledge
in one **Implementation**, increases **Locality**, and gives the rest of the
renderer a smaller **Interface**.

**Verification:** count line-of-sight checks, outstanding refreshes, instance
matrix writes, projected DOM positions and label updates while stationary.
Stationary state should settle to zero reconciliation work between true
invalidations. Existing concurrent-load/removal/visibility race tests must keep
passing.

**Progress 2026-11-18:** map projections now use a coalesced invalidation key
over world, map, observer, actor, visibility, terrain and placeable revisions.
Forced campaign updates remain synchronous; frame-driven stationary state no
longer repeats line-of-sight or supporting-terrain reconciliation. Settled
normal-camera frames also skip tactical membership scans until presentation
changes. Tactical overview projection, collision layout and DOM positioning now
run only when camera, actors, viewport, map or focus state changes.

### 4. Batch terrain writes and notifications

**Impact 4 / Complexity 2 / Code-confirmed**

[TerrainDataStore.set](../../src/terrain/TerrainDataStore.js#L29) assigns a cell
and notifies all listeners. A committed edit in
[TerrainEngine.js](../../src/terrain/TerrainEngine.js#L1042) calls `set` for each
changed cell, then copies the full working grid into the base store. A large
brush or wall gesture therefore produces per-cell listener fan-out plus a
full-grid copy as one logical edit.

The store also clones grids on several other operations in
[TerrainDataStore.js](../../src/terrain/TerrainDataStore.js#L74).

**Recommendation:** add a single batch transaction at the authoritative terrain
store. Apply all cell changes without intermediate notification, validate
the complete result, swap/persist the snapshot and emit one edit event. Keep
preview data non-authoritative. Benchmark before deciding whether the base
snapshot can be transferred rather than cloned.

**Verification:** exact height/save results, one Undo receipt, one semantic
notification and unchanged renderer/biome behavior at small and large board
sizes. Existing gesture cancellation and invalid-edit tests must remain.

### 5. Reduce biome-generation peak copies

**Impact 4 / Complexity 3 / Code-confirmed; requires profiling**

Generation constructs a complete height field, saves the previous terrain, then
passes the field into generation code that clones the heights again in
[BiomeStructures.js](../../src/terrain/generation/BiomeStructures.js#L68).
[TerrainEngine.js](../../src/terrain/TerrainEngine.js#L455) subsequently restores
the result into a store that maintains `base` and `working` copies. A generation
failure needs a valid rollback, but the current implementation does not
demonstrate that every intermediate copy is necessary.

**Recommendation:** profile peak memory and allocation count on the largest
supported board. If material, make generated inputs immutable or transfer
ownership only at the commit seam; retain an explicit snapshot solely for
rollback. No renderer or campaign Module should acquire a second terrain owner.

**Verification:** exact-height and geometry equality on success; full state,
history and UI consistency after fault injection at generation, participant
apply and rollback phases.

**Progress 2026-11-18:** biome elevation now scales, smooths and quantizes its
first generated field in place. Unsmoothed recipes allocate one height matrix;
smoothed recipes allocate only that field and one scratch matrix. Exact seeded
output remains covered, while structure/store rollback copies still exist at
their commit seam.

### 6. Contain the obsolete second terrain generation path

**Impact 4 / Complexity 2 / Code-confirmed**

[ADR-0001](../adr/ADR-0001-terrain-engine-event-seam.md) requires one terrain
state owner and a wiring-only coordinator. The live coordinator retained a
duplicate generation path that directly mutated `c.dataStore` without an
active production caller, while
[TerrainEngine.js](../../src/terrain/TerrainEngine.js#L448) owned the active
operation.

**Risk:** an apparently harmless helper can reactivate duplicate state and undo
the accepted ownership decision. The conflict is confirmed as stale code, not a
claim that live callers currently use it.

**Recommendation:** prove all references across production, tests and dynamic
entry points; then delete or quarantine the obsolete path and its imports.
Keep [TerrainCoordinator.js](../../src/coordinators/TerrainCoordinator.js)
as wiring rather than extracting another pass-through facade.

**Verification:** all generation entry points reach the authoritative engine;
coordinator tests still validate only wiring; campaign capture/restore and live
editing remain exact.

**Resolved 2026-11-18:** production-reference tracing found that the old
coordinator generation, activation, tile, brush and rendering modules were no
longer imported. Those modules and their no-op-only tests were removed. The
active flora generator moved under `src/terrain/flora/`, and engine picking stays
covered through `TerrainInputHandlers`.

### 7. Establish CI and an explicit release workflow

**Impact 4 / Complexity 2 / Confirmed**

The repository has no `.github/workflows/` files. `lint:all` and the test
commands exist in [package.json](../../package.json#L6), but no checked-in
workflow enforces them. `format:check` also has a known failure.

**Recommendation:** add separate, visibly named CI jobs for:

- install with `npm ci`;
- JavaScript and CSS lint;
- layering validation;
- formatting;
- fast unit tests and selected browser/geometry integration suites;
- the complete test matrix on the protected branch;
- dependency advisory summary;
- asset-manifest validation and no-secret scans for release packages.

Keep slow real-animation/geometry suites, but parallelize them rather than
silently excluding them. Publish one canonical JSON/JUnit result and require a
green baseline.

### 8. Correct the package manifest and address registry advisories

**Impact 4 / Complexity 3 / Registry-confirmed; compatibility untested**

[package.json](../../package.json#L69) places a broad lint/build toolchain
graph under production `dependencies`, while another toolchain is correctly
declared under `devDependencies`. Runtime references are limited to
`three`, `cannon-es`, `debug` and `once` in the audited project paths.

Tool/test-only direct candidates currently listed as production dependencies
include `acorn`, `fast-glob`, `globals`, `ignore` and `table`.
`fake-indexeddb` is already correctly in `devDependencies`. Most remaining
direct dependency entries had no project reference and may be promoted transitive
dependencies. Removing a package from the direct list is safe only after
checking `npm explain`, tool imports and lockfile ownership.

Registry checks on 2026-11-17 reported:

- **19 vulnerable package entries:** 14 high, 4 moderate, 1 low, no critical;
- direct reported entries included `brace-expansion`, `fast-uri`, `flatted`,
  `js-yaml`, `minimatch`, `nanoid`, `picomatch`, `postcss` and `source-map-js`;
- all entries reported a fix available;
- Jest/Babel Jest: `30.0.5` installed versus registry-reported `30.5.2`;
- Stylelint: `16.22.0` installed versus `16.26.1` in-range and `17.16.0` latest;
- ESLint: `8.57.1` installed versus registry-reported `10.15.0` latest;
- Three.js: `0.170.0` installed versus registry-reported `0.187.0` latest.

Treat registry output as a starting point, not permission for a bulk major
upgrade. The reported future-dated/current-version combinations should be
revalidated before any package work.

**Recommendation:** reconstruct the dependency manifest from actual imports,
classify each package as runtime or dev-only, then remove unnecessary direct
entries. Run one upgrade family at a time against the full test/build and visual
regressions. Avoid `npm audit fix` as an unreviewed bulk action.

### 9. Reduce full character-sheet reconstruction and fix listener ownership

**Impact 4 / Complexity 3 / Code-confirmed**

[CharacterSheetContent.js](../../src/ui/components/CharacterSheetContent.js#L335)
recomputes stats, reconstructs saved-character options and replaces the main
markup for a broad render path. A narrow change can therefore pay for the whole
sheet and risk transient focus/selection state.

[InteractionManager.js](../../src/managers/InteractionManager.js#L101) installs
anonymous canvas, document and window callbacks but exposes no matching
disposal path for all registrations. Repeated setup or canvas replacement can
retain closures and duplicate input. The manager does already remove a subset
of active-drag global listeners around [lines 888-903](../../src/managers/InteractionManager.js#L888).

[SidebarController.js](../../src/ui/SidebarController.js#L83) adds closures to
global synchronization arrays without a visible unsubscribe path. Dataset
guards reduce duplicate registration on one element, but do not retire a
controller when its DOM is replaced.

**Deepening opportunity:** keep the sheet as the rendering **Interface**, but
organize stable sections behind revision-aware updates instead of rebuilding
the entire **Implementation**. Give `InteractionManager` and sidebar
subscriptions explicit lifecycle ownership. Existing collaborators are
substantive modules; line count alone is not a reason to split them.

**Verification:** focus preservation during unrelated combat updates; setup,
dispose, replace and repeated-event tests; stable canvas and global callback
counts after repeated controller creation.

**Resolved 2026-11-19:** interaction and sidebar lifecycle teardown was fixed in
earlier cleanup commits. The character sheet now caches roster membership and
unchanged identity, core, equipment, spell and notes markup; one validated
character snapshot feeds movement, conditions, stats, spell, rest, custom-action,
layout and history consumers. Play action availability receives the same
validated snapshot instead of rereading each action's character and resources.
Live combat and player-authoritative data remain
recalculated on each refresh, and local/campaign/player library adapters expose
the same invalidation interface. A settled sheet refresh now performs one
persisted-character read, no saved-character rescan and no redundant derived-stat
calculation while preserving the focused DOM control. The focused character/UI
set passed 68 suites and 760 tests, followed by the full **308-suite / 4,095-test**
baseline; lint, layering and repository formatting checks also pass.

### 10. Semantically validate campaign imports before commit

**Impact 3 / Complexity 3 / Confirmed**

[CampaignStore.js](../../src/campaigns/CampaignStore.js#L190) validates backup
record shapes and bounded values, but an imported scene can be accepted as a
nonempty bounded string. Character records are likewise checked structurally
before [importBackup](../../src/campaigns/CampaignStore.js#L335) persists them.
The semantic scene/character validation used when opening the application is
not guaranteed at the import boundary.

**Risk:** a shape-valid but unusable campaign can be acknowledged and later fail
when opened. An atomic transaction protects creation from a thrown import, but
currently not from all malformed semantics that wait until open.

**Deepening opportunity:** make a single Campaign Import Module own record,
ruleset, companion and scene validation behind one small Interface. The local
and future cloud Adapters should depend on this Module, not repeat partial
checks. This improves **Leverage** because both paths receive the same
validation, and **Locality** because backup semantics live in one place.

**Verification:** malformed character JSON, orphan companion records and invalid
scene JSON are rejected without campaign creation or partially persisted state.

### 11. Make room-discovery persistence recoverable with scene commits

**Impact 3 / Complexity 3 / Confirmed consistency risk**

[local-host.js](../../tools/local-host.js#L413) commits a scene in the campaign
database, then records room visits in the separate access database through
[session-authority.js](../../tools/session-authority.js#L221). A process failure
between the operations can lose visits for the acknowledged scene.

**Recommendation:** either include the visit delta in the same durable
checkpoint representation, or use a recoverable outbox/reconciliation record
with monotonic campaign/scene revision. The retry must be idempotent and not
grant access incorrectly.

**Verification:** inject failure after the campaign commit and before access
write, restart, and demonstrate exact visit recovery without historical
duplication.

### 12. Bound combat snapshot copying and avoid effect serialization for equality

**Impact 3 / Complexity 3 / Code-confirmed; scaling not measured**

[CombatSession.js](../../src/entities/characters/CombatSession.js#L724)
copies histories, rebuilds maps, copies states and JSON-roundtrips every effect
while staging a snapshot. Additional JSON copies occur earlier in the same
class. Snapshot cost therefore grows with accumulated data even when one
small action changed.

[TargetingController.js](../../src/ui/characters/TargetingController.js#L160)
compares two effects with whole-object JSON serialization. Equality depends on
property order and serialization compatibility rather than a declared ticket
or revision.

**Recommendation:** use explicit snapshot ownership and targeted copies for
persistent checkpoints, and version targeting-relevant effect state instead of
serializing it. Preserve deep isolation for mutable effect data. This is a
deepening of the checkpoint **Interface**, not a request to mutate shared state
in place.

**Verification:** large history/effect fixtures, one small mutation, stable
identity of unchanged records, complete isolation of nested mutable fields,
and targeted stale-ticket tests.

### 13. Bound local-session and login-attempt retention

**Impact 3 / Complexity 2 / Confirmed process-memory risk**

[session-authority.js](../../tools/session-authority.js#L42) retains issued
session entries until that same cookie is authenticated again. Expired sessions
without reuse are not independently swept. `loginAttempts` similarly retains
entries keyed by remote endpoint/address without a global retention bound.

This matters more once the loopback host is intentionally placed behind an
external HTTPS origin.

**Recommendation:** use an expiring, bounded store for sessions and sign-in
throttling. Sweep by TTL or use a bounded LRU with explicit expiry. Preserve
current authentication, revocation and rate-limit semantics.

**Verification:** issue many unused sessions and distinct throttling keys;
prove the maps remain bounded while valid sessions and retry/backoff behavior
remain correct.

### 14. Make failed model loads retryable

**Impact 3 / Complexity 1 / Confirmed**

[ModelAssetCache.js](../../src/core/ModelAssetCache.js#L399) stores an in-flight
promise and removes the matching entry only after `await` succeeds. A rejection
skips deletion. Subsequent calls receive the same rejected promise, so a
transient failure cannot be retried for the key.

**Recommendation:** remove the in-flight slot in `finally` while preserving the
successful cache, or replace the failed entry with an explicit bounded retry
state. Keep model-load deduplication and error reporting.

**Verification:** first load rejects, second retries and succeeds, concurrent
calls still deduplicate, and cache/disposal race tests remain green.

### 15. Reduce lower-cost repeated work without sacrificing quality

**Impact 2 / Complexity 2 / Code-confirmed; not measured**

These are good follow-up optimizations after the frame/terrain baseline has
instrumentation:

- [GridOverlay.js](../../src/scene/grid/GridOverlay.js#L151) emits four
  segments per tile, duplicating every shared interior edge. Preserve exact
  uneven-terrain line geometry while emitting shared edges once.
- [PlaceableMeshPool.js](../../src/scene/terrain/PlaceableMeshPool.js#L727)
  checks `freeIndices.includes(index)` during whole billboard passes and
  rewrites every live matrix. Use O(1) live/free membership and separate
  translation from orientation-only changes.
- [TerrainRebuilder.js](../../src/scene/terrain/TerrainRebuilder.js#L336)
  serializes complete structure specs to make a construction-detail signature
  on every rebuild. A mutation revision is less work and still preserves exact
  cache invalidation; retain an optional debug comparison if needed.
- [ThreeSceneManager.js](../../src/scene/ThreeSceneManager.js#L474) returns a
  fresh metrics object each frame and publishes it at lines 1028-1037. Export
  metrics at a lower cadence or only when metrics collection is enabled.
- `[TargetingController.js](../../src/ui/characters/TargetingController.js#L160)`
  JSON-compares full effects for stale tickets. Prefer a declared revision or
  only targeting-relevant fields.

Each change should come with exact counts or benchmark deltas; visual fidelity
and hit/picking behavior must remain unchanged.

## Architecture and organization

### Accepted direction to preserve

[ADR-0001](../adr/ADR-0001-terrain-engine-event-seam.md) remains the correct
direction: one authoritative terrain owner with renderer Adapters subscribed
through an event **Seam**. The audit does not recommend additional terrain
stores, camera/render-only collision stores or campaign-specific geometry
owners.

The strongest architecture benefits will come from making the existing
Interfaces deeper:

1. **Render invalidation:** high leverage behind one invalidation scheduler;
   camera, actor, model and geometry changes become small caller facts.
2. **Terrain edit commit:** one batch operation owns validation, rollback,
   history, events and snapshot state.
3. **Campaign import:** one semantic import Module owns backup validation and
   publication for all storage Adapters.
4. **Combat checkpoints:** one snapshot Module owns persistence shape and copy
   semantics, keeping turn/UI callers from understanding full history shape.
5. **Construction workflow:** the
   [TerrainConstructionPanel](../../src/ui/TerrainConstructionPanel.js)
   remains a UI Module, while one workflow Module owns preview/apply/remove and
   participant coordination.

Do not split these into pass-through files. Apply the deletion test: if deleting
a proposed Module only moves its complexity into every caller, it is too
shallow to earn its keep.

### Module-size signals

Line count is an organizational signal, not a defect by itself. The following
large files deserve seam-oriented review because their responsibilities span
state, behavior and presentation:

| Module                                       | Lines |
| -------------------------------------------- | ----: |
| `src/ui/styles.css`                          | 4,395 |
| `src/ui/TerrainConstructionPanel.js`         | 2,032 |
| `src/ui/components/CharacterSheetContent.js` | 1,209 |
| `src/terrain/BuildingModel.js`               | 1,206 |
| `src/scene/ThreeSceneManager.js`             | 1,200 |
| `src/entities/characters/CombatSession.js`   | 1,198 |
| `src/terrain/TerrainEngine.js`               | 1,170 |
| `src/ui/UIController.js`                     | 1,148 |
| `src/scene/terrain/PlaceableMeshPool.js`     | 1,099 |

The project convention already permits `internals/` extraction for large
classes. Prefer cohesive deep Modules with tests at the Interface rather than
many helpers that merely expose the parent's entire `this` state.

### Positive architectural practices

- Campaign scene and character changes use coordinated revision checks.
- Character plus scene saves use one SQLite transaction.
- Player writes are restricted to assigned characters and player scene/combat
  writes are rejected.
- Backup filenames, paths, staging/rename and retention are bounded.
- Model requests deduplicate concurrent loads and cache successful roots.
- Terrain and scene disposal work includes epoch/race protections and geometry
  replacement.
- Targeting uses centralized validation/geometry Modules rather than duplicating
  D&D rules in the DOM layer.
- Construction and dice Modules expose explicit disposal in several important
  paths.
- Layering checks pass: lower layers are not importing `src/ui`.

## Dead code, stale code and cleanup

### Confirmed cleanup

1. **39 lint warnings.** They include unused palette helpers, coordinator
   arguments, token-adapter imports, logger helpers, `LOG_LEVEL` and UI/manager
   variables. The pass is currently configured to tolerate them. After
   confirming each is not a mixin/config false positive, remove or explicitly
   eliminate the stale symbols and make new warnings fail CI.
2. **The obsolete coordinator generation helper** described in finding 6.
3. **`tools/.eslintrc.json` formatting drift.**
4. **Broken retained-doc links:** [README.md](../../README.md#L1973) and
   [HANDOFF.md](../../HANDOFF.md#L1322) refer to `docs/archive/`, which is absent
   from this checkout.
5. **Stale baseline claims.** [HANDOFF.md](../../HANDOFF.md#L25) reports 128
   suites/1,032 passing tests, while this revision contains 254 suites/3,438
   tests and does not currently pass.

### Not yet confirmed dead code

`find-unused-exports.js` listed candidates such as
`ActionRequestCancelledError`, `BIOME_GROUPS`, `createD20Simulation` and
`D20_FIXED_STEP`, but the script scans only static references under `src` and
does not account for tests, tools, dynamic imports or robust re-export use. These
remain review candidates, not findings.

`cycle-scan.js` found no simple relative ESM cycle. It excludes CommonJS,
dynamic imports and several other relationship types, so it is useful hygiene
evidence rather than a proof.

## Documentation and branch coherence

The checked-out branch is `feat/curved-structure-shapes`. Pre-existing
uncommitted files describe a
[`feat/cloud-accounts-multiplayer`](../proposals/cloud-migration-preparation.md#L1)
implementation branch, deployment state and an execution checklist. The local
README still describes the local-host edition, while cloud documents record an
advanced hosted implementation elsewhere.

This is not a code defect in the cloud branch. It is a **working-tree provenance
risk**: someone can reasonably read these documents as claims about the current
checkout. The same problem can affect release selection and code review.

**Recommendation:** each generated/long-running migration document should carry
the implementation branch, exact source hash, deployment/release identity and a
prominent “does not describe this checkout” caveat. Keep canonical local-host
documentation separate from cloud execution evidence. Consider generated status
pages rather than editing a single multi-thousand-line narrative forever.

## Security and privacy observations

No penetration test or secret scan was performed. Confirmed code-level risks
are the unbounded process retention in finding 13, semantic import acceptance
in finding 10, the two-database consistency gap in finding 11 and the
registry-reported dependency advisories in finding 8.

The following existing controls are worth preserving:

- loopback-by-default local host and private host key;
- same-origin/CSRF/session checks;
- campaign assignment checks for player writes;
- bounded JSON request sizes and path-safe backup names;
- no automatic host-data fallback after failure;
- authoring assets and public configuration kept distinct from access secrets.

If the host is exposed through a trusted proxy, rerun retention, origin, login
throttling and denial tests against that actual deployment mode. If cloud code
is reviewed later, it needs a separate security assessment in its actual
branch/container, IAM and rules configuration.

## Quality-preserving implementation sequence

### Phase 0: restore confidence

1. Triage the 47 failing tests without changing assertions first.
2. Add exact reproductions for the correction backlog, beginning with
   cavern-to-castle transition, save/camera false conflicts, player follow-camera
   behavior and concurrent-play responsiveness.
3. Keep `M5-06` open until native overlapping ten-client play, facing order,
   intermediate animation and pending-input behavior pass together.
4. Make a documented test result part of every CI run.
5. Add the requested performance counters and representative large-map
   fixtures before optimizing.
6. Re-run the full suite after each contract decision.

### Phase 1: low-complexity, high-confidence improvements

1. Retry rejected model loads and add the regression test.
2. Batch terrain notifications at the existing store seam.
3. Remove/quarantine the obsolete terrain generation path.
4. Bound session and rate-limit retention.
5. Deduplicate grid interior edges.
6. Correct formatting, dead symbols and broken documentation links.
7. Implement the owner-decided camera-save policy, hide routine save feedback
   and align the local branch with the already-published `UX-01` behavior.
8. Change the radial contract to right-click-only and enforce assigned-sheet
   access at the player Interaction/authority seam.
9. Raise and measure close-zoom limits without changing reset/overview behavior.

### Phase 2: deep modules at the highest-leverage seams

1. Render invalidation/coalescing.
2. Campaign import validation.
3. Combat snapshot and targeting revision ownership.
4. Character-sheet sectional rendering and listener lifecycle.
5. Reconcile two-database room discovery durability.
6. Participant camera policy: DM free camera and player observer-centered
   orbit/zoom bounds.
7. Biome Generation Recipe, then biome-specific size/density/surroundings/
   entrances choices.
8. Castle topology planning, wall/tower attachment and intentional window
   rhythm.
9. Underground support-footprint grounding, Crystal Spires spacing and distinct
   chamber recipes.

### Phase 3: dependency and deployment hygiene

1. Normalize direct dependencies and dev ownership.
2. Update one dependency family at a time with full regressions.
3. Resolve registry advisories and record false positives/upgrades.
4. Add CI, format, dependency and release-manifest gates.
5. Align the working-tree, cloud and local-release status documents.
6. Re-verify that the external implementation branch includes `UX-01`,
   `M5-06` responsiveness fixes and the correction-list behavior; do not infer
   this from copied documentation.
7. Keep production deployment and cutover blocked until `M5-08` through
   `M5-11` receive their explicit evidence and approvals.

### Phase 4: runtime packaging without visual sacrifice

1. Build the hashed runtime asset allowlist.
2. Keep source assets unchanged; optimize runtime copies.
3. Compare visual, support-bound, material and animation parity.
4. Lazy-load needed families and verify cache/recovery behavior.
5. Measure startup, GPU upload, browser memory and network transfer on a
   representative desktop before deciding further LOD/instancing work.

## Final assessment

TavernTable's strongest quality is its explicit domain model and broad
behavioral coverage. Its largest immediate risk is not missing features—it is
drift between the implementation, tests, dependency metadata and operational
documents.

The highest-return work is to restore a green baseline, then create measurable
seams around frame invalidation, terrain edit batching and runtime assets. These
improvements preserve the current visual and gameplay quality while reducing
work. Dependency cleanup and CI should follow the baseline because otherwise a
tool update may hide or compound an already-failing source tree.

The owner correction list and cloud checklist change the release order:
routine-save/camera noise and player-camera/permission UX are not deferred
polish, and concurrent-player responsiveness is a production blocker. The
cloud checklist is evidence from a separate branch, while this branch needs
its own tested implementation and acceptance.

No implementation changes or commits were made by this audit. The pre-existing
proposal edits in the worktree were left untouched.
