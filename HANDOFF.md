# TavernTable maintenance handoff

Campaign-owned IndexedDB persistence and separate 2014/2024 resources/rules now
extend the terrain, humanoid, sheet, rest and manual-play foundation.

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

- Latest complete Jest run: 128 suites and 1,032 tests pass, including the native
  fetch receiver contract and edition-scoped persistence/recovery regressions.
- The Core-speed/Combat-meter follow-up passes 3 focused UI suites and 57 tests.
- Play layouts/Favorites pass 14 focused suites and 208 tests, covering character
  persistence, rest/actions, sheets/compendium, turn rules and actual navigation.
- History rail/roll attribution passes 17 focused suites and 223 tests.
- Compact roll summaries/tooltips pass 12 focused suites and 120 tests.
- The fresh-turn attack-counter follow-up passes 6 focused suites / 84 tests.
  Native 2024 checks show 1 attack at Fighter 1, 2 at Fighter 5, 4 after Action
  Surge, 0 after spending the last action on Dash, and 2 after Undo. Display uses
  `status.attacksAvailable`; keep `attacksRemaining` as the already-started
  sequence for attack continuation, forfeit and DM ongoing-attack corrections.
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

## Terrain editing colors and wall tool

- The saved pre-terrain checkpoint is
  [3ea0cba](https://github.com/sandeand001/TavernTable/commit/3ea0cba9db9befde7f5e5871d580d8f202403725),
  pushed to `main` before this editing work began.
- Editing colors are baked into the 3D mesh, not just its opacity. Mode entry and
  exit request a terrain rebuild. Exit must first copy working heights to the
  base field, then restore normal colors; rebuilding before that copy can
  momentarily restore stale geometry after an idle period.
- [TerrainBrushController](./src/terrain/brush/TerrainBrushController.js) owns
  wall stroke origin, inclusive corner-to-corner rectangles, Filled/Outline
  selection, validated target levels and height prediction. Preview and
  application share the same footprint and height logic.
  Filled includes every rectangle cell; Outline includes only border cells
  without duplicated corners. Single rows/columns and points remain supported,
  and reversing either drag axis does not change the selected area.
  Every wall cell is set to the exact selected level, raising or cutting
  terrain. The owner explicitly chose this behavior after the raise-only
  clamp silently ignored negative targets on level-zero ground. Do not restore
  the old preservation clamp; preview and commit must agree for all 21 levels.
- [TerrainInputHandlers](./src/coordinators/terrain-coordinator/TerrainInputHandlers.js)
  starts a pending wall on mouse-down, previews without editing during drag,
  and commits once on a valid canvas release. Window capture and canvas release
  must not apply twice. Escape, Space pan, blur, leaving the canvas, tool/mode
  changes, resizing, and off-board/UI release cancel pending work.
- Preview uses the existing `ThreeSceneManager.setTerrainBrushPreview` surface
  with current and predicted levels. Do not route 3D previews only through the
  removed 2D terrain manager.
- The Wall height dropdown uses the shared terrain range and is separate from
  Raise/Lower brush size. A separate Box style dropdown selects Filled or Outline
  and persists across tool changes. Both controls update the pending preview
  without committing terrain. UI state and
  pressed buttons also follow keyboard tool changes through
  `taverntable:terrainToolChanged`. Invalid levels are reported through the
  standard input-warning handler, with the last valid value restored visibly.
  Keep the `.tool-group[hidden]` rule: the authored flex layout otherwise
  overrides the browser's default hidden-element styling.
- [Wall tests](./tests/unit/coordinators/TerrainWallTool.test.js),
  [wall UI tests](./tests/unit/ui/UIControllerWallTool.test.js), and
  [color lifecycle tests](./tests/unit/coordinators/terrain-coordinator/ActivationHelpers.test.js)
  cover the gesture, height control, cancellation, real mesh colors, selected
  biome restoration, delayed exits and preserved geometry.
- Real browser pointer checks created six-cell horizontal and vertical walls at
  top levels 4 and 2, respectively. The 3D preview changed no heights before
  release and Escape cancelled another stroke. The initial raise-only behavior
  was subsequently replaced by exact-level placement. Turning Terrain Mode off
  restored the exact
  original mesh color while retaining all twelve raised cells.
- The exact-level browser replay cut six cells from 0 to -4 (world Y -1.2),
  with no changes before release, and cut an existing level-6 wall to level 2.
  Both results persisted after leaving Terrain Mode; the trench floor returned
  to the same neutral vertex color as the rest of the board after the queued
  rebuild. All 21 selected levels have gesture-level preview/commit tests, and
  mode-exit geometry tests include negative elevations.
- Rectangular browser checks placed a 5x4 Filled block, a reverse-dragged 6x6
  Outline with all sixteen interior cells unchanged, a 5x4 negative Filled pit
  and a seven-cell line. All 67 changed cells persisted after mode exit with
  normal colors. Each preview matched the final footprint and changed no
  terrain before release.
- A whole-board 25x25 Filled preview rendered all 625 cells and cancelled
  without edits. Representative warm frame sampling stayed close to baseline
  (about 35 ms with preview versus 33 ms without) on the current software-backed
  renderer; no unrelated rendering refactor was needed.
- Live editing still uses the coordinator's working store. This feature does
  not migrate terrain ownership or introduce a global undo system.

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
  its tab even while hidden. The character editor retains this window; the
  compendium lives in the sidebar. One Core character-speed control drives linked
  token movement; manual combat shares a scene turn ledger.
  Characters and their board links persist in the campaign; open tabs/windows
  remain session-local.
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

## Campaign ownership, editions and offline resources

- [CampaignLauncher](./src/ui/campaigns/CampaignLauncher.js) gates startup with a
  Create/Open picker. The ruleset is required and immutable. Returning through
  Campaigns flushes character/world saves and reloads to a fresh picker. Reopening
  restores that campaign's saved board; no multiplayer is implied.
- [CampaignStore](./src/campaigns/CampaignStore.js) owns campaign metadata and raw
  character records in `taverntable.campaigns.v1`. Character keys are composite
  `[campaignId, key]`; revision-checked replacement of a campaign snapshot is atomic.
  Pack disabling retains its version pin. Ruleset/core-version updates are rejected.
  Scenes are optional opaque JSON on the existing campaign aggregate, with separate
  scene revision/date fields: no IndexedDB version upgrade or new store is required.
- [CampaignAutosave](./src/campaigns/CampaignAutosave.js) coalesces scene changes,
  reports acknowledged Saving/Saved/errors and flushes before navigation/export.
  Scene-only and character writes share the facade queue and check both revisions;
  never overwrite a stale window's scene. A character mutation projects its next
  shared names/links into the same atomic character+scene commit.
- [SceneWorld](./src/campaigns/SceneWorld.js) captures the live coordinator's working
  heights, explicit logical flora records/resolved scales, stable token IDs and
  poses, counters, camera and committed combat/history.
  [CampaignScene](./src/campaigns/CampaignScene.js) validates version-1 scene data
  against the campaign's edition/library before restoration or backup import.
  Invalid/failed restoration keeps the saved record intact and blocks editing;
  it must never autosave an empty partially hydrated world.
  Await the shared `GameManager.enableHybridRender()` initialization promise before
  hydration: a ready camera/render-mode flag alone does not mean adapters/pools
  have finished initializing. Terrain ownership remains the partial ADR migration,
  not a new authority switch to `TerrainEngine.save()`.
- [SavedPlacements](./src/scene/token-adapter/SavedPlacements.js) records completed
  ground checkpoints and stable wall/ledge holds, not animation tweens or falls.
  Restored holds seek their real loaded clip and re-establish legitimate controller
  world authority. Pending route reservations become only the completed checkpoint's
  movement cost. Prospective combat saves stage economy/history with resource costs,
  but read the live movement ledger at final capture after awaiting scene assets.
  Unfinished rolls/routes are not replayed; Undo receipts and open windows/tabs
  deliberately remain visit-local.
- [CampaignCharacters](./src/campaigns/CampaignCharacters.js) keeps synchronous,
  acknowledged reads over the computational kernel, but queues mutations on cloned
  snapshots and publishes them only after the asynchronous store commits. Never
  replace it with a fire-and-forget localStorage-shaped IndexedDB adapter.
  Compound Add & equip and character replacement use one commit. Slot adjustments
  read inside the mutation, not from stale UI arrays.
- [CampaignWorkspace](./src/campaigns/CampaignWorkspace.js) is the async application
  interface for opening, source settings and complete campaign backups. Import
  validates settings, source availability, character schema and companion ownership
  and the full scene before atomically creating a separate campaign. Campaign
  backup version 2 includes the scene; version 1 imports as no saved board.
  Bundled resource databases remain excluded. Character backup version 5 carries its ruleset and source pins;
  cross-edition/unscoped legacy imports are not a campaign migration feature.
- [ResourceStore](./src/resources/ResourceStore.js) uses separate physical databases
  `taverntable.resources.2014.v1` and `taverntable.resources.2024.v1`.
  [ResourceSeeds](./src/resources/ResourceSeeds.js) verifies same-origin seed bytes
  against the manifest before installation. Keep native fetch calls unbound:
  invoking a stored `Window.fetch` as a class method causes Illegal invocation.
- [sync-resources](./tools/sync-resources.js) generates 16 reviewed packs / 8,950
  entries from pinned Open5e and 5e-bits source snapshots. See the
  [manifest](./assets/data/resources/manifest.json) and
  [complete content notices](./assets/data/resources/NOTICES.txt). Images, A5E and
  Black Flag are excluded. Open5e's `open5e-2024` fixtures still declare its 2014
  document and are deliberately excluded rather than relabeled.
- The 2014 core has 319 spells, 746 items and 2,025 total entries; the 2024 core
  has 339 spells, 1,095 items and 2,296 total entries. Reference categories are
  searchable/readable but do not expose fake automatic character effects.
  Disabled sources remain resolvable for owned references, not new additions.
- [Rules registry](./src/rules/rulesets.js) requires an explicit identity and selects
  separate [2014](./src/rules/2014/rules.js) and [2024](./src/rules/2024/rules.js)
  implementations. Preserve paired behavior tests: casting per turn, Action Surge's
  restricted credit, Grapple/Shove saves, Monk dice/Focus/bonus attacks, Paladin
  activations, slots and rest/resource recovery. Missing rulesets never mean 2014.
- `CombatSession.commitAction` and Undo may return a Promise for a persistent
  adapter; UI callers must await them. Persistent costs commit before in-memory
  economy/history. Pending saves block action/turn changes. The synchronous kernel
  remains useful in tests; `afterCharacterCommit` preserves its immediate UI path.
- Conditional/choice dice formulas are explicitly manual at unsupported levels;
  do not let nearest-lower table lookup invent an upcast result. 2024 Monk/Rogue
  weapon training is curated against SRD properties, not stale provider class lists.
- Native browser checks use the real campaign picker, IndexedDB and shared dice:
  no default edition; 2014/2024 physical catalogs and independent character lists;
  Paladin level-1 slots 0 versus 2; Cure Wounds `1d8+3` versus `2d8+3`; and
  the 2024 slot limit even after a manual action-count correction. Four actual
  short-rest Hit Dice at level 5 leave 3 dice after a 2014 long rest versus 5 in 2024. Native version-5 copying retains owned spell IDs/Favorites, cross-edition
  import is rejected, campaign file import preserves the full snapshot, and
  disabling Deep Magic preserves owned content/pins/Favorites and readable Details.
  Provider API requests and unhandled page errors remain zero in these checks.
  The three explicitly owned QA campaigns and their characters were removed after
  verification; the preview was left at the fresh campaign picker. Other open
  boards and legacy browser data were not reloaded or cleared.

## Saved characters and compendium UI

- [CharacterLibrary](./src/entities/characters/CharacterLibrary.js) is the
  synchronous computational kernel over an explicit storage adapter and ruleset.
  Primary version-1 keys still use `taverntable.character.v1.<UUID>` inside the
  campaign snapshot, not global production localStorage. Its legacy backup codec
  is internal compatibility, not the campaign UI's import contract.
- A token's `characterSheetId` links to a record; it is not the ephemeral token
  ID or the humanoid appearance definition. Multiple tokens may load the same
  saved character. The campaign scene persists those token links.
- [CompendiumCatalog](./src/entities/characters/CompendiumCatalog.js) validates
  unique entry IDs and the required ruleset, searching only enabled compatible
  sources. All pinned entries remain available for owned-content resolution.
  Core classes have single-class slot progression; reference classes do not add
  unimplemented progression automation. Runtime sheet loading is local.
- [CharacterSheetContent](./src/ui/components/CharacterSheetContent.js) hosts the
  library, editing, equipment, spellbook, backup and roll workflows inside
  [CharacterSheetWindow](./src/ui/components/CharacterSheetWindow.js).
  Existing direct window callers retain legacy bounds; the normal UI entrypoint
  starts at 860 by 760, clamped to the viewport.
  The only name editor is the standalone `plaintext-only` contenteditable title
  above the sheet, not a Core/play-view input. Enter/blur commits and Escape
  cancels. Preserve its draft while refreshing tab labels; bind commits to the
  character ID captured when editing starts so tab/relink changes cannot rename
  the wrong character. Reuse acknowledged rename/name-sync services and keep
  failures visible rather than silently accepting invalid or rejected writes.
  A gear opens the hidden Character settings section for saved-character selection,
  New, Import/Export, Delete and Compendium. Keep operation errors outside that
  disclosure; ordinary save messages remain accessible without cluttering play.
- [characterServices](./src/ui/characters/characterServices.js) requires the selected
  campaign context for both sheet and sidebar; there is no global 2014 loader.
  Unlinked-token creation awaits its saved UUID and coalesces concurrent requests.
  The
  [CompendiumSidebar](./src/ui/characters/CompendiumSidebar.js) works independently
  of an open sheet, defaults Add to the selected creature, and supports an explicit
  saved-character destination. No destination means browsing/Details remain
  available but Add buttons are disabled with a visible prompt.
- The sheet no longer embeds a compendium. Its Compendium shortcut and item/spell
  Details use the window's `onOpenCompendium` port to open the real sidebar.
  Same-page `taverntable:characterChanged` events are game-manager scoped; an
  `origin` prevents echo loops. Refresh notifications must not republish themselves
  or discard focused drafts. Changes also keep destination names up to date.
- [CompendiumPanel](./src/ui/components/CompendiumPanel.js) supplies ranked search,
  category filters, paged results, details, keyboard Add/Add & equip alternatives
  and native drag data. The custom MIME payload carries an explicit ruleset,
  source/version pin and known catalog ID, never arbitrary dragged statistics.
  A matching ID in another edition must not be reinterpreted. All user/data text must remain escaped or use
  `textContent`. Armor Details include base/enhanced AC, Dexterity caps, Strength
  requirements and Stealth disadvantage, not just cost/weight. Preserve explicit
  `[hidden]` styling for the standalone sidebar as well as the sheet.
- Owned, equipped and attuned are distinct states. Supported effects apply only
  in the required state, identical item effects do not double-stack, and ability
  minimum effects do not overwrite base scores. Armor/shield replacement and
  removal reverse the derived effects. Only explicitly implemented magic effects
  are automatic; Amulet of Health remains reference-only because retroactive HP
  recalculation is not implemented.
- Supported calculations cover ability modifiers, level proficiency, saves,
  skills/expertise, initiative/passive Perception, armor/shields, magic weapons,
  casting values, supported spell scaling, slots and concentration. Prepared
  choices and inventory quantities persist. Long rest restores current HP,
  clears temporary HP, restores slots, ends concentration and resets tracked
  short/long-rest class counters, not unmodeled charges or effects.
- Adding/preparing spells never spends slots. Casting checks preparation/slots
  before consuming a resource. Roll buttons are separate from casting and do
  not apply damage/healing to targets. Prepared limits, spell eligibility,
  armor proficiency restrictions, class/subclass features, timed effects,
  additional projectiles and conditional effects remain manual. Declared sheet
  uses now share tracked manual-turn costs.
- [rollDiceExpression](./src/systems/dice/dice.js) accepts bounded numeric dice
  notation without evaluation and shares roll locking with the legacy boolean
  `rollDice(sides)` API. Normal single-d20 checks use the settled physical face;
  advantage/disadvantage use two digital d20s and keep one. Damage is digital.
  Cocked, unreadable and cancelled physical rolls must not fabricate a result.
  Missing-3D fallback is explicitly labeled/logged.
- [HealthBar](./src/ui/characters/HealthBar.js) owns current/max display, percentage
  and health colors, a separate temporary-HP badge, Damage/Heal and compact direct
  editing. `CharacterLibrary.adjustHitPoints` reads fresh data, absorbs damage
  with temporary HP first, clamps current HP at zero, caps healing at maximum and
  validates before one save. The widget never applies resistance or target
  effects automatically. Invalid edits remain visible and leave saved HP intact.
- [CharacterRest](./src/entities/characters/CharacterRest.js) owns rest state
  under `taverntable.character-rest.v1.<UUID>`, leaving primary version-1 records
  unchanged so already-open older readers do not reject new character fields.
  Absent companion state means unused resources; corrupt state must be reported,
  never silently replaced. Composite HP/slot/rest changes validate first and roll
  back prior writes on storage failure; rollback failures are explicit.
- [CharacterRestResources](./src/config/CharacterRestResources.js) declares
  supported 2014 base-class pools, capacities and rest policies. Use level/ability
  formulas and progression boundaries, not one generic reset-all. Bard level 5,
  Sorcerer level 20, unlimited level-20 Rage/Wild Shape, and higher Fighter/Cleric
  capacities have regressions. Class cards spend these same counters; Signature
  Spell/Arcanum assignment and effects remain manual, not ordinary slot casting.
- [RestControls](./src/ui/characters/RestControls.js) places Short/Long Rest
  and Resources by health on all sections. Qualifying rest duration and the
  once-per-24-game-hours long-rest limit are manual declarations, not wall-clock
  timers. Long rest requires at least 1 starting HP and recovers
  `min(spent, max(1, floor(level / 2)))` Hit Dice, not every die.
- Hit Dice come from class metadata and character level. Each shared-dice roll
  adds effective Constitution once, clamps that die's healing at zero, caps
  current HP and preserves temporary HP. Dice are committed only after a valid
  roll. Creature/class/level changes or stale pool/modifier snapshots cannot
  spend a different character's die. Short rest without dice is valid.
- Pact Magic recovery uses the Warlock's actual base Pact slot levels, not every
  slot override. Short rest preserves concentration, ordinary spent slots,
  temporary HP and Hit Dice. Arcane Recovery is optional and atomic, with a
  `ceil(wizardLevel / 2)` combined-level budget, slots 1-5 only and a daily-use
  counter. Daily reset is an explicit new-game-day action, not an automatic
  long-rest side effect.
- Current version-4 backup import/export preserves Hit Dice, resource usage,
  custom ability definitions/usage/attack overrides and play layouts, rebinding
  companion ownership to the new imported UUID. Invalid companion imports and
  failed writes leave no partial imported character. Delete removes all four keys.
  Legacy version-1/2/3 backups import without guessing missing companion usage/preferences.
- Native rest checks verify a Fighter's d10 roll of 6 plus CON 2 heals 8 HP while
  retaining temporary HP and spending one die; short-rest uses recover without
  dice, Pact slots recover without losing concentration, and Wizard level 7 can
  recover levels 1+3 while leaving a spent level-4 slot untouched. The version-2
  file-input import retains daily usage under a new UUID; New game day restores
  that daily use without restoring slots or HP. Rest buttons are visible beside
  health without scrolling at the normal bounds; the 900-by-700 layout has no
  horizontal rest/form overflow.
- Editing reconciles existing controls rather than replacing the form: preserve
  native focus, caret and Tab behavior. Key inventory/spell rows by instance ID.
  [reconcileContent](./src/ui/characters/reconcileContent.js) leaves explicitly
  marked child-widget islands alone; HealthBar owns its unfinished input state.
  Other-character storage events cannot discard drafts; same-character events
  defer form refresh while a field is focused and display an explicit notice.
  Grid range, health and rest displays still refresh without erasing that draft.
- Sheet errors use the existing warning/input notification path. Do not silently
  replace corrupt saved characters with blank records.
- `linkTokenCharacter` in [TokenMovement](./src/entities/creatures/TokenMovement.js)
  makes the saved record's speed authoritative for a linked token. A weak binding
  resolves current library data; linked tokens store pace/style, not a competing
  speed. Movement-setting API speed edits write the saved record. Link on every
  create/load/import path; a future scene loader must also establish that binding.
  Saved-character selection shares speed across linked tokens, not their pace/style.
  The duplicate board-movement fieldset is removed. New records use 30 feet;
  unlinked prototype tokens retain the old 50-foot default. Combat routes use the
  remaining scene ledger, not a new speed setting or a fresh allowance per click.
- Editable speed lives only in Core; shared Walk/Run/style controls remain visible.
  Combat renders a compact, muted remaining/total movement bar from the same ledger.
  The bar follows route reservations, Dash, Undo and DM corrections, distinguishes
  waiting/downed states, and previews base per-move movement outside combat.
  Zero speed uses an empty bar without division by zero. Native checks verify
  a 10-foot route against 40-foot base speed produces 30/40 feet and 75% fill;
  Dash produces 70/80 and 87.5%, without changing base speed.
- [CombatSession](./src/entities/characters/CombatSession.js) owns manual turns,
  separate action/bonus/reaction/attack credits, scene movement reservations,
  2014 bonus-action spell restrictions, global-turn custom limits and targeted
  Undo. One session is shared by sheet/sidebar/navigation through
  `connectCharacterServices`. It is scene memory, not a saved encounter.
- [combat/actions](./src/entities/characters/combat/actions.js) builds options
  from actual equipped attacks, owned spells, common class data and custom
  definitions. All sheet use paths, including Equipment/Spells, reserve and commit
  through the same session. Extra Attack preserves only remaining attacks;
  bonus/reactions/free options remain independent. Reaction refresh is at the
  actor's next turn. Longer activation times are unavailable during combat.
- [CharacterActions](./src/entities/characters/CharacterActions.js) stores a strict
  action companion under `taverntable.character-actions.v1.<UUID>`, not unknown
  primary fields or custom IDs in the fixed class-resource map. Own use pools and
  linked class pools are mutually exclusive. Turn uses stay in memory; other
  uses participate in atomic rest/day transactions. Backup versions 1/2/3/4 are
  accepted. `commitStorageChanges` provides scoped multi-key rollback.
- The Core custom editor supports activation, notes, own limits/reset policy or
  linked class costs, plus automatic/manual attacks-per-action settings. Explicit
  saves preserve usage. Preserve focused drafts and escape user labels/notes.
- Combat/Non-combat play views hide spent options and keep recent follow-up
  rolls. Generic checks/saves and damage/healing follow-ups are free, not another
  Cast/Attack. Costs/rolls are automatic; triggers, targets, hit/save confirmation,
  HP application and active effects remain manual, including Rage restrictions.
  Rituals, two-weapon fighting, subclass rules and initiative remain future work.
- Navigation reserves the route cost once, then settles actual controller costs.
  Never replace its immutable speed snapshot with a shrinking budget each frame.
  Interruptions refund untraveled costs; unexpected failures retain the committed
  cost with explicit logging and DM correction. Forced falls remain automatic.
  The adapter synchronizes movement-state transitions so turn controls re-enable
  after free-play routes or forced motion. Scene motion blocks turn changes.
- At 0 HP, ordinary combat uses and voluntary movement are unavailable; generic
  rolls and a manual-resolution death save remain available. Rest buttons/handlers
  and pending Hit Dice recovery cannot bypass combat. Manual resource corrections
  remain distinct. DM movement/economy corrections invalidate old Undo; Undo cannot
  refund already-used Dash movement or overwrite later HP/resource edits.
- Native combat checks verify consecutive 20-foot and 10-foot routes exhaust one
  30-foot allowance, the next route is rejected, and Dash adds 30 feet while
  spending the action. Equipment's first sword attack leaves one Extra Attack;
  Combat's second removes attack choices while damage rolls remain. Action Surge
  debits its actual pool. A custom bonus ability spends one of two uses and short
  rest restores both its uses and Action Surge. Wizard Misty Step suppresses
  Fireball/own-turn Shield while allowing Fire Bolt; off-turn Shield works, and
  the legacy Spells Cast spends the action and third-level slot exactly once.
  DM corrections preserve saved speed and spent slots; 0 HP hides uses/movement
  while retaining a manual death save. Version-3 native file-input import
  preserves custom definitions/uses under a new UUID; its temporary copy is removed.
  At a 900-by-700 viewport, the resized sheet has 434-pixel content with no
  horizontal play-view overflow; custom forms collapse to one column.
- [CharacterPlayLayout](./src/entities/characters/CharacterPlayLayout.js) stores
  strictly validated preferences under `taverntable.character-layout.v1.<UUID>`,
  leaving primary/rest/action companion shapes unchanged. Each page has section
  order, per-section card order and ordered favorite IDs. Missing state is default;
  corrupt state is explicit, never blanked. Version-4 backups rebind layout ownership;
  four-key imports/deletes roll back atomically. Legacy imports receive defaults.
- [PlayLayoutControls](./src/ui/characters/PlayLayoutControls.js) owns Customize
  mode, native drag handles, keyboard ordering, favorite/unfavorite and confirmed
  page reset. Drag payloads are scoped to one live drag, character and page, using
  their own MIME type; normal card categories cannot change. Switching context
  exits editing and cancels stale drags. Card IDs/order survive unavailability:
  spent options disappear only in normal play and return to their saved places.
  Favorite checks/saves stay ordinary free rolls. Restore enabled keyboard focus
  after moving to an edge or moving a card between sections.
- [RollHistory](./src/ui/characters/RollHistory.js) owns the fixed right-hand rail
  on every sheet section, with All rolls / This turn filters. The main editor
  and history scroll separately; narrow layouts stack the rail above the editor.
  Window bounds expose `--sheet-window-height` to keep the sticky rail inside
  the resized window. History refreshes during deferred Core updates without
  replacing focused drafts. Follow-up buttons are disabled while customizing.
  Legacy layout order entries for `recent` remain valid but no longer move it.
  The rail omits redundant character names; the shared Dice Log keeps actor attribution.
  Roll/use contexts retain the actor name captured at request time so even results
  completed after a rename can remove exactly that display prefix.
- Both logs use shared compact `name: total` markup with native hover titles and
  focusable, described totals. [rollSummary](./src/systems/dice/rollSummary.js)
  creates/copies validated numeric snapshots from real roll data, not parsed
  log strings. Expression rolls and ordinary tray rolls pass snapshots to
  `addDiceLogEntry` through its optional third argument; raw message text remains
  available for compatibility, and system/older text-only entries stay plain.
  Physical totals, compound dice/signs, modifiers and kept advantage/disadvantage
  dice remain in the breakdown. Invalid snapshots fail before action costs.
  Sheet history stores independent snapshots and suppresses duplicate verbose
  text when a compact result is available; follow-ups/costs/filters are unchanged.
- `CombatSession.history` retains the saved character's complete session history,
  independently of the ten-entry turn/Undo support list. Do not use
  `status().recent` to find older follow-ups; use `historyEntry`. End Combat
  clears turn budgets, not history. Committed history is saved/exported with its campaign scene.
  `captureRoll` snapshots owner/current manual turn before asynchronous dice;
  `recordRoll` consumes that context once without spending any economy.
  Generic checks, standalone/follow-up damage/healing and rest Hit Dice use this
  path. Costed rolls are folded into their committed use once; an actual
  completed roll from an uncommitted use is labeled as such, never a paid use.
  Cancelled/unreadable rolls do not fabricate results, and Undo keeps roll text.
- Native history checks verify attack/check/follow-up entries, 13 All versus
  10 current-turn entries, older follow-ups raising retained history to 14,
  retention after End Combat and free-play Hit Dice raising it to 15 while
  healing/spending a die normally. The 220-pixel rail stays within the window
  after 1,303 pixels of main scrolling and has its own scrollbar. At compact
  width it stacks to 406 by 220 pixels without horizontal overflow.
- Native layout checks verify card/section drag, drag-to-Favorites without
  duplicates, keyboard section movement, independent page preferences, actual
  Extra Attack through a favorite and spent-option hiding. Full reload preserves
  both page layouts. Historical kernel checks also cover version-4 copies; current
  campaign UI imports use edition-scoped version 5 and retain instance IDs.
  Compact editing has no horizontal overflow.
- [sync-srd-2014.js](./tools/sync-srd-2014.js) reproducibly generates the local
  snapshot from a pinned 5e-bits/5e-srd-api commit. Keep per-input hashes,
  [SRD attribution](./assets/data/SRD2014-NOTICE.txt), and
  [the upstream MIT notice](./assets/data/SRD2014-UPSTREAM-LICENSE.txt).
  Class slot extraction must exclude subclass feature-only rows; individual
  weapon proficiency IDs come from upstream proficiency references, not guessed
  plurals. Wizard levels 6/10 and Wizard dagger proficiency have regressions.
- Records are local to the browser/profile/origin. Export JSON before clearing
  browser data or moving between hostnames/ports. Export both requests a download
  and exposes a copyable, read-only snapshot so backup access does not depend on
  the embedded browser's download handling. The status must not claim that a file
  was saved to disk. No account sync, paid compendium access, full rulebook
  coverage, guided progression or multiplayer is provided.
- Rendered checks cover native item/spell dragging, carry/equip/attune AC changes,
  effective-ability and proficient +1 weapon values, upcasting and depleted slots,
  concentration/rests, exact character persistence after a page reload, and a
  copyable-export/file-input-import round trip under a new UUID. Physical d20
  and digital advantage/damage results match the visible log and shared locks.
  The sheet also fits a 900-by-700 viewport without horizontal form overflow,
  minimizes to 48 pixels, and restores/resizes correctly. Embedded-host download
  completion was not exposed to browser automation; copyable JSON is verified.
- The UI-first browser pass also verifies independent browsing with no sheet,
  native sidebar-to-sheet dragging, Details routing, hidden-sheet Add behavior,
  and a real linked-token range of four steps at 20 feet but not five. Editing
  HP to 20/30 with 5 temporary HP then applying 8 damage produces 17/30 and zero
  temporary HP; healing above maximum stops at 30/30.
- The read-only 3D metrics overlay must retain `pointer-events: none`; it otherwise
  intercepts clicks on the sidebar tab row. A public scene-initialization test
  and actual pointer clicks cover the fix.
- The static development server can serve cached ES modules in a newly opened
  tab: changing only the page query is not sufficient. Use no-cache routing
  before navigating a fresh QA tab and remove it afterward. Do not reload an
  edited board merely to update its scripts.

### Delivered manual combat scope

- Implemented after testing the sidebar/movement/health stage. Keep Core
  for configuration, separate from Combat and Non-combat play views. A more
  stylized identity/header can follow later; do not copy Roll20's layout.
- Use manual creature Start/End Turn controls first, not an initiative tracker.
  Movement must use one enforced, shared turn budget and the actual grid outline,
  with an explicit manual/DM adjustment. Switching views or clicking a new
  destination must not replenish the budget.
- Separate movement, action, bonus action, reaction and no-action abilities.
  Extra Attack commits the action to the remaining attacks; movement and valid
  bonus/reaction/free options remain available. Spent/unavailable options disappear,
  with recent-action damage/healing controls retained.
- Use a hybrid of automatic standard costs/common class abilities and custom
  entries for unsupported features. Reuse the now-implemented rest-resource
  counters for ability usage instead of creating duplicate pools. Extra Attack,
  costs and custom use/reset policies are implemented. Broader conditional
  activation rules and active effects remain future work.
- Track costs and produce rolls; targets, hit/save confirmation, application of
  damage/healing and complex conditional effects remain manual initially.
  Ordinary check/save rolls are not automatically actions. Automatic HP effect
  application is a later goal, not part of this first-stage health widget.
- Walk/Run retains existing traversal behavior, not a free Dash. The movement-type
  dropdown means Default/Drunk animation style, not new flying/swimming modes.

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
  Facing angles use `atan2(-dz, dx)`: positive facing turns toward world -Z.
  Using `atan2(dz, dx)` reflects the Z axis even when stored-angle tests pass.
  Real-FBX regressions compare rendered model forward with the drag and normal
  navigation under both lenses and multiple orbits, not just the numeric angle.
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
- [MotionRefinements](./tests/integration/scene/token-adapter/movement/MotionRefinements.test.js),
  [ManualActionMotion tests](./tests/integration/scene/token-adapter/ManualActionMotion.test.js),
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
6. Run [HumanoidContracts](./tests/integration/scene/token-adapter/HumanoidContracts.test.js),
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

| Asset                             |      Bytes | SHA-256                                                            |
| --------------------------------- | ---------: | ------------------------------------------------------------------ |
| `Knight T-Pose.fbx`               | 10,852,288 | `f2ea71e09b7a5d92a23efd318ae0493b67919085a65c83c3d2b19a0a3ff8dee2` |
| `Mutant T-Pose.fbx`               | 19,800,640 | `f8c5b872648d3e73e8d65246e4f1163c07238d1327d56d985e7424cf13a95f92` |
| `Waving.fbx`                      |    305,040 | `524107e646d9696a8aa44d72723cde03ec463be3bb1b2f58342005bcf6cfee39` |
| `Sitting Idle.fbx`                |    533,536 | `3f3cf77cafc64d59a4a3965e8c2411ea4e3c86658fa1ef257e7676b843f8f709` |
| `Punching.fbx`                    |    343,424 | `9e94f20c79af3d0153f1e26f773c4aae8f4f262699e6830e39494ea7e74e1439` |
| `Standing React Large Gut.fbx`    |    414,480 | `297b0b0ce7ab8c7eceadfb2660b3cbc1b52fbce5a3a94bb632b0a5b051602bf5` |
| `Standing Dodge Left.fbx`         |    356,384 | `d338d3e22137a87c265c4adb0f29d18365c16e8e5780fa87576d78741f1d2a1e` |
| `Standing 2H Magic Attack 01.fbx` |    568,592 | `036d68bfc32c724381ea1113c0146368dd911674e450bee88d589eb2dccbd8f1` |
| `Jumping.fbx`                     |    457,360 | `67770690d4bda8b0538d3518df6abdb1f96f9a27a4b6a8f0d3d2f155cbb5cfac` |
| `Vault Over Box.fbx`              |    627,568 | `7b69c635ec085290083fc5f9c20adf072aa1b6817717e4eb157b373faaf1b8a4` |
| `Jump Down.fbx`                   |    545,920 | `4f07f80f1e897f232577b05129b5bfe250225a4ef25e2624e8612c8efb565e17` |

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
- Space + left-drag pans independently of the disabled creature keyboard controls.
  The interaction manager filters editable/button targets, shows grab/grabbing,
  keeps global drag listeners until release and clears Space on focus loss.
  Capture-phase pan input wins over token pointer/facing gestures and terrain
  editing/removal; pending terrain strokes are cancelled, not committed.
  `panBy` accepts an optional CSS-pixel origin, preserving the actual grabbed
  focus-plane point under the cursor in perspective as well as top-down.
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
- [ClimbWallContinuity.test.js](./tests/integration/scene/token-adapter/movement/ClimbWallContinuity.test.js)
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
