# TavernTable domain context

- **Scene**: the browser-local board, terrain, placed tokens and camera state.
  Reloading does not currently preserve an edited scene.
- **Terrain editing colors**: temporary elevation visualization while Terrain
  Mode is active. Leaving the mode restores normal/biome colors without
  discarding edited heights.
- **Terrain wall**: a dragged rectangle of edited terrain, previewed and committed
  on release. Filled changes the whole area; Outline changes only its one-cell-wide
  perimeter. Single-row/column drags remain lines. Its target top
  elevation is absolute and exact, raising or cutting cells, including below
  zero for trenches. It is not a
  separate building object and uses ordinary terrain traversal.
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
- **Flight**: a per-token airborne travel state using the saved character's active
  flying speed. Take flight rises 5 feet. Raise/Lower offer 5, 10, 15 and 20 feet,
  spending one foot of flying movement per vertical foot. Horizontal routes retain
  absolute altitude, not a free terrain-following offset. Walking and flying share
  movement spent; Dash increases each travel speed's allowance without resetting it.
  Lowering exactly to ground lands normally. Drop relinquishes flight for a
  zero-movement-cost fall and ignores flight's own damage protection, not Feather
  Fall or other protections. It does not erase the ability or cancel concentration.
  Flight grants from spells/items remain manually applied through Flying speed;
  source/target effect automation is separate from casting and inventory ownership.
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
  resolves any roll, revalidates the actor, then commits persistent and turn
  costs. Cancelled/stale/failed rolls spend nothing. Targets and effects are manual.
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
  spends an available slot and tracks concentration; targeting, timed effects,
  extra projectiles and application of damage/healing remain manual.
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

Terrain ownership migration, multiplayer, full combat rules
and guided character progression remain separate work. Free-play movement
allowances and visual actions are not silently converted into turn enforcement.

Campaign settings and characters use acknowledged, revision-checked IndexedDB
commits. The scene and session-memory combat/history are deliberately separate.
