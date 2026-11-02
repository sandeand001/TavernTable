# TavernTable domain context

- **Scene**: the browser-local board, terrain, placed tokens and camera state.
  Campaign autosave preserves committed scene checkpoints, not unfinished
  terrain previews, routes or animation frames.
- **Terrain editing colors**: temporary elevation visualization while Terrain
  Mode is active. Leaving the mode restores normal/biome colors without
  discarding edited heights.
- **Terrain wall**: a dragged rectangle of edited terrain, previewed and committed
  on release. Filled changes the whole area; Outline changes only its one-cell-wide
  perimeter. Single-row/column drags remain lines. Its target top
  elevation is absolute and exact, raising or cutting cells, including below
  zero for trenches. It is not a
  separate building object and uses ordinary terrain traversal.
- **Terrain owner**: TerrainEngine holds the authoritative heightfield, tool,
  brush and biome state. Live editing, game height queries, resizing and campaign
  capture/restore use its public interface. TerrainCoordinator wires the input
  and 3D scene adapters; it does not hold a parallel height store.
- **Terrain edit**: a complete, release-to-apply height gesture. Previews do not
  change gameplay support or saved heights. Escape, blur, leaving the canvas,
  changing tools or brush size, and leaving Terrain Mode cancel the preview.
  Wall height and fill style can update a pending rectangle without committing it.
- **Terrain history**: session-local Undo/Redo for the last 100 committed height
  edits, including Reset Terrain. A whole gesture is one edit. New committed
  edits replace the redo branch; canceled previews and no-op edits do not.
  Loading, resizing or generating a map clears this history. It does not undo
  placeable removal, dice rolls, character actions or movement.
- **Creature token**: one logical gameplay instance with a stable ID, grid/world
  position, facing, movement settings and character-sheet tab.
- **Campaign**: a named, browser-local workspace with an explicitly chosen,
  immutable 2014 or 2024 ruleset. Startup offers Create/Open rather than silently
  resuming. Each campaign owns one automatically saved board. Switching flushes
  acknowledged changes; reopening restores terrain, creatures/links, camera and
  committed combat/history instead of starting another campaign's scene.
- **Campaign-owned character**: a character belongs to exactly one campaign.
  Reuse is an explicit same-ruleset copy/import, not a global shared library.
  Character, rest, custom-ability and layout changes must commit atomically before
  the UI reports success or combat spends its in-memory costs.
- **Saved scene checkpoint**: plain versioned campaign data, never renderer objects,
  promises or in-flight animation frames. Restore the last completed safe ground
  step or stable wall/ledge hold and its movement cost. Completed rolls and turn
  budgets resume; unfinished rolls/routes are not replayed. Undo receipts and open
  sheet windows remain session-local. A creature's linked character and sheet tab
  share its name.
- **Source pack**: an attributed, edition-compatible content collection pinned to
  an explicit version. Core SRD content is always enabled; optional packs are
  opt-in. Disabling a pack prevents new additions without erasing owned content
  or changing its pinned source version. Alternate game systems are not editions.
- **Edition-local catalog**: a physically separate IndexedDB resource database
  for each edition, selected through the campaign's ruleset. Missing or unsupported
  rulesets are errors, never a fallback to 2014. Edition-specific mechanics belong
  to separately selected rules implementations; generic math and UI may be shared.
- **Bundled seed**: reviewed, versioned resource data downloaded during development,
  validated and shipped with the app. Runtime installation uses same-origin files,
  never live provider APIs or automatic mid-campaign content updates. Campaign
  backups include settings and characters, not the bundled databases or scene.
- **Saved character**: a persistent rules record, independent of a
  creature token's name, appearance and ephemeral scene ID. A token can load a
  record through `characterSheetId`; saving the record does not save the board.
- **Character speed**: the saved record's authoritative ground-distance setting for
  linked tokens and their grid ranges, editable only on Core. Combat displays
  remaining movement as feet/allowance and a progress bar. Pace (Walk/Run) and animation style
  (Default/Drunk) remain per token. Free play has a per-move allowance; manual
  combat shares remaining movement across committed routes. Walk/Run is not Dash,
  and there is no separate editable board-speed field.
- **Manual combat turn**: a scene-memory owner and action/bonus/reaction/attack
  ledger. Start/End Turn is explicit, not initiative ordering. Starting a turn
  refreshes that creature's budgets and global turn-limited custom uses; ending
  it does not refresh them. Persistent slots/resources are separate.
  **Attacks left** is derived from unspent actions and any ongoing Attack-action
  sequence, honoring class/level and manual attack-count overrides. The internal
  ongoing sequence starts at zero; it must not grant free attacks at turn start.
- **Flight**: a per-token airborne travel state using the character's effective
  flying speed. Take flight rises 5 feet. Raise/Lower offer 5, 10, 15 and 20 feet,
  spending one foot of flying movement per vertical foot. Horizontal routes retain
  absolute altitude, not a free terrain-following offset. Walking and flying share
  movement spent; Dash increases each travel speed's allowance without resetting it.
  Lowering exactly to ground lands normally. Drop relinquishes flight for a
  zero-movement-cost fall and ignores flight's own damage protection, not Feather
  Fall or other protections. It does not erase the ability or cancel concentration.
  Base/manual flight stays in Flying speed; reviewed Fly supplies a separate
  scene-owned grant to selected token IDs. Use the higher active speed and combine
  Hover/support without modifying base traits or granting every character clone flight.
  Other spell/item flight remains manual. Loss of support or a lower speed interrupts
  a route at its stable checkpoint, refunds its unfinished tail, and falls if unsupported.
  A hovering animation is visual; the Can hover rules trait remains independent.
  Campaign checkpoints save completed stable airborne waypoints and their costs,
  not unfinished routes, animation frames or unresolved falls.
- **Falling**: an actual vertical terrain/airborne drop, measured in feet.
  At impact, roll 1d6 per complete 10 feet, capped at 20d6; apply temporary HP
  first, then current HP. Positive damage imposes Prone unless immune. Damage
  avoidance does not clear existing Prone. Interrupt damaging routes and refund
  their untraveled tail. HP, condition, completed roll and movement ledger commit
  with the safe ground checkpoint, not an unfinished airborne animation.
- **Prone**: a persisted character condition, not a temporary emote. Hold the
  sleeping/lying pose through idle, turns, rests and reloads. Movement crawls at
  double cost; ordinary attacks have disadvantage. Standing is an explicit sheet
  choice costing half current maximum Speed, rounded down, with no action,
  bonus action or reaction. Do not use half remaining movement or half Dash's
  allowance. Core condition clearing uses this same operation.
- **Fall protection**: available flight/hover, an explicitly active Feather Fall,
  Monk Slow Fall, flat manual reduction and Prone immunity. Prompt for an available
  Monk reaction before descent; its damage reduction is 5 times Monk level.
  Slower descent/softer landing are cosmetic. A deliberate flight Drop uses
  `ignoreFlight` without disabling Feather Fall or Slow Fall. The selected
  edition owns incapacitated flight and Stunned movement differences.
- **Combat use**: a declared attack, spell or feature that reserves its cost,
  selects targets, resolves any roll, revalidates the actor/board, then commits
  persistent and turn costs. Cancelled/stale/failed uses spend nothing; each completed
  projectile retains its own single-use roll context even when the use is canceled.
  Hits, damage and saves remain manual. Reviewed Fly automatically applies its
  temporary flight grant; other spell mechanical effects remain manual.
- **Targeting profile**: an edition-local reviewed definition or an explicit static
  override in the action companion. The first set reviews 27 spells per edition;
  unsupported spells require explicit manual confirmation rather than guessed rules.
  Profiles describe range, minimum/maximum allocations, repeated projectiles,
  creature restrictions, sight, area shape/origin and visual duration. Weapon modes
  distinguish reach, thrown and normal/long range, including enhanced variants.
  Candidate legality is shared by availability, preview and final confirmation.
- **Fly effect**: willing Touch targets, including self, explicitly confirmed by
  the caster; Friendly does not imply willing. One target at level 3, plus one
  per higher slot. Grants flying speed 60 for 100 later caster turns (10 minutes),
  tied to the caster's owned spell concentration ID. 2024 grants Hover; 2014 magic
  holds its targets aloft even when Prone or unable to move. Casting grants the
  capability, not takeoff. Replacement, concentration ending, expiry, End spell
  and Undo remove the source; preserve natural flight and other active grants.
  Casts and concentration-changing expiry/end operations stage the scene ledger
  with character costs. Character-only copies and unlinked token base-trait saves
  never contain temporary grants. Restore effects before flight support checks.
- **Targeting tags**: saved per-token allegiance, biological creature type and size,
  not humanoid appearance IDs. Defaults are Neutral/Humanoid/Medium. Friendly/Hostile
  are relative sides; neutral tokens are not automatically hostile. Heavy weapons
  use the selected edition's size/attribute rule.
- **Combat controls**: Action/Bonus/Reaction choices are separate from free skill
  checks. Combat omits duplicate Search/Study cards while keeping their domain
  definitions and action costs; a DM correction can account for a declared check
  action. Empty Bonus sections explain unavailable/spent options. Saved play
  ordering remains intact. Pace/Style/manual Roll mode use pressed buttons;
  targeting tags live only on Core. Spell cards distinguish fixed base level
  from the expended slot level, and only unreviewed targeting gets a compact gear.
- **Casting level selection**: available slot-level buttons live in the targeting
  popup, not spell cards. Preview choices recalculate upcasting while keeping the
  original reservation immutable. Confirmation revalidates that reservation before
  replacing its casting choice; committed costs use the confirmed level. A canceled
  preview spends nothing. Roll-only spell damage retains the last confirmed level.
- **Targeting geometry**: 3D five-foot grid distance, feet/center-point area inclusion,
  and terrain/instanced-structure clear-path bounds. Full creature volumes, partial
  cover, door openings and 2014 around-corner propagation require manual confirmation.
- **Active spell area**: a plain visual record in combat checkpoints, never renderer
  objects or automatic damage/conditions/movement/visibility. Durations tick only on
  later matching caster-token start/end turns. Concentration replacement/ending,
  manual ending and Undo synchronize the visuals. Fixed areas can outlive token
  removal; caster-following areas cannot. Selection previews are never saved.
- **Custom ability**: a saved activation/reminder with either its own use limit
  and reset policy or a link to an existing class pool, never a duplicate pool.
  Definitions/attack overrides and non-turn usage live in an action companion;
  per-turn usage lives in the scene ledger.
- **Play layout**: per-character, per-page section/card ordering and Favorites in
  a separate companion record. Customize mode disables play uses while arranging.
  Favorites move cards rather than duplicating them; their real costs and
  availability never change. Layout reset is page-scoped, not a resource reset.
- **Health adjustment**: a manual current/max HP bar operation. Damage consumes
  temporary HP before current HP; healing caps at maximum. Temporary HP is separate
  from maximum HP. This is not automatic attack/spell effect resolution.
- **Rest state**: persistent spent Hit Dice and class-use counters in a companion
  record, separate from the primary version-1 character shape but included in
  edition-scoped version-5 character backups alongside custom abilities/usage and play layouts. Recovery follows the
  resource's short/long/daily policy. Rest recovery is unavailable during combat.
- **Short rest**: a declared qualifying game-time rest, not a real-time timer.
  It restores supported short-rest resources and Pact slots, then allows optional
  one-at-a-time Hit Dice healing with Constitution. It does not refill ordinary
  spell slots, Hit Dice, temporary HP or every class ability.
- **Long rest**: a declared qualifying rest restoring HP/slots and tracked
  short/long-rest uses. Hit Dice and resource recovery follow the campaign's
  edition: 2014 recovers at most half total Hit Dice, rounded down with a minimum
  of one, while 2024 recovers all spent Hit Dice. Calendar-day counters require
  an explicit new game day; 2024 Arcane Recovery uses its long-rest reset instead.
- **Compendium entry**: a locally bundled, attributed resource with a
  stable content ID, rules text and explicit automation coverage. It is not a
  humanoid appearance definition or access to a paid rulebook.
- **Compendium destination**: the selected creature or explicitly chosen saved
  character in the standalone sidebar. Browsing does not need an open sheet;
  dragging onto a sheet uses that sheet, while Add confirms its chosen destination.
- **Owned equipment**: an inventory instance with quantity, equipped and attuned
  states. Ownership alone grants no equipped bonuses. Supported active effects
  derive effective values without overwriting base ability scores.
- **Prepared spell**: a saved spellbook choice, separate from casting. Casting
  spends an available slot and tracks concentration. Reviewed profiles automate
  targeting, projectile attack rolls and lingering-area visuals, not hits, saves,
  damage/healing or mechanical timed effects.
- **Sheet roll**: a shared-dice request using the current derived modifier.
  Generic checks/saves and follow-up damage/healing do not cast, apply effects
  or spend another action. Declared Attack/Cast buttons use the combat ledger.
- **Character history**: session-memory uses and sheet rolls keyed by saved
  character, separate from token turn budgets and persistent backups. The fixed
  right-hand rail filters All versus the current manual turn. Rolls retain the
  character/turn captured when requested; ending combat/resting does not erase
  them. Old follow-ups remain usable, and Undo never removes actual dice results.
- **Character definition**: a reusable humanoid appearance and rig, not a separate
  movement implementation. The prototype characters share the current one-square
  footprint and movement rules.
- **Reference character**: the existing Mannequin, whose established movement
  clips and normalization are preserved while new appearances use compatible
  retargeted clips.
- **Animation role**: a clip used by existing locomotion or traversal behavior,
  such as walking, wall climbing, a ledge grip or landing recovery.
- **Manual action (visual)**: a user-triggered creature-menu performance, separate
  from a cost-tracked sheet action. It does not implement
  combat or consume movement. Dodge returns to its original logical position;
  cover alignment may shift within the same cell. Committed cinematic movement
  must remain protected.
- **Facing**: one of eight grid-relative headings, independent of camera orbit.
  Changing facing does not translate the creature.
- **Traversal**: a committed terrain transition, including stepping, mantling,
  controlled lowering, hopping, vaulting, wall climbing and falling. Height bands
  use physical feet rather than raw terrain levels.
- **Vault**: a Run-only crossing of a one-cell waist-high obstacle onto clear,
  same-height support. The whole movement must be affordable and cannot end
  midway through the airborne action.
- **Rig compatibility**: verified bone mapping, bind-pose/proportion handling,
  root-motion scale, grounded feet and contact timing. Matching names alone do
  not establish compatibility.
- **Character catalog**: the shared source of playable character identity, labels
  and model metadata.
- **Action catalog**: the shared source of animation and manual-playback metadata,
  so adding a clip does not require independent loading, menu and dispatch edits.

Multi-level map geometry, multiplayer, full combat rules
and guided character progression remain separate work. Free-play movement
allowances and visual actions are not silently converted into turn enforcement.

Campaign settings and characters use acknowledged, revision-checked IndexedDB
commits. The scene and session-memory combat/history are deliberately separate.

## Connected-grid building direction

Separate connected grids replace the original shared-board layering plan.
The map state, physical-coordinate and persistence foundation is implemented;
player-facing map controls and the outline builder remain planned.

- **Connected grid**: an independently editable and viewable map inside one
  campaign, such as an exterior, building interior, floor or larger area.
- **Campaign spatial record**: one creature identity and map-local position,
  translated into physical campaign feet using the map's origin, quarter-turn
  orientation and grid scale. Camera zoom does not change physical distance.
- **Participant view**: independent focused creature, displayed map and per-map
  camera history. Following a creature changes only that view when it transfers.
  Targeting another creature does not change viewing focus. Local view records
  are implemented; connected-player ownership and networking are not.
- **Cross-grid projection**: planned synchronized rendering of an off-map creature,
  not a second token or character record. Position, facing and animation refer
  to the original creature. Physical sight queries distinguish walls and openings;
  sprite rendering, picking and full player visibility remain further work.
- **Grid connection**: planned Enter / Use stairs interactions between aligned
  maps. Transfers preserve creature identity, resources and combat/movement state.
  Changing the grid reference never grants a free elevation jump or a fresh turn.
  Cross-grid flight, falling, sight and attacks must use physical connections.
- **Building outline**: the planned Build-only tool with height in 10-foot floor
  increments and a closed straight-line footprint, completed when endpoints meet.
  It generates a hollow exterior and separate floor maps. Carving is deferred;
  curves, circles and manual floor removal are later extensions.
- **Connected checkpoint**: version-3 scene data containing map records, one
  campaign-wide creature collection, shared combat and a local default view.
  Capture/restore, acknowledged IndexedDB saves and backups retain inactive maps.
  Versions 1 and 2 remain supported without automatic conversion.
- **Interior floor**: a finite half-foot slab, not earth extending downward
  through other floors. Openings remove actual support rather than leaving a
  phantom floor below.

The retained numeric box-volume construction proof is paused, not the desired
builder workflow. It implements solids/cuts, multiple supports, stairs, cave
ceilings, bridge underpasses and next-floor landing. Version-2 scenes preserve
its geometry and support IDs; hidden layers remain physical. Constructed-wall
climbing, broader shape editing and full-size creature collision are not included.
Heightfield-only maps keep their original traversal.

Terrain ownership still follows
[ADR-0001](./docs/adr/ADR-0001-terrain-engine-event-seam.md): one authoritative
terrain owner per grid, with renderer adapters rather than parallel height stores.
