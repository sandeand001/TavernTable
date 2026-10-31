# TavernTable — TODO

> Current backlog. Setup and the last verified test baseline are in
> [README.md](./README.md). Historical audits are not the current task list.

---

## Terrain Editing

- [x] **Restore normal colors after Terrain Mode** - Refresh baked mesh colors
      after saving heights, including selected biome colors and delayed exits.
- [x] **Simple wall and box drawing** - Click-drag lines, Filled rectangles or
      hollow Outline boxes in any direction, with separate style/height controls,
      live 3D preview, release-to-place, and
      cancellation before committing. Set the exact target elevation, including
      cutting higher terrain and negative-level trenches.

---

## Terrain Ownership Follow-up

- [ ] **Complete the accepted terrain-engine migration** - Follow
      [ADR-0001](./docs/adr/ADR-0001-terrain-engine-event-seam.md). The engine and the
      legacy coordinator currently maintain separate height stores. Move live
      callers to the engine's state and event seam; do not merely extract more
      pass-through helpers. This larger refactor was explicitly deferred from the
      October 2026 housekeeping pass.
- [ ] **Add public-interface integration coverage for the migration** - Verify
      that game height queries and tool selection use the engine, resizing keeps
      game and terrain dimensions consistent, and reset/load trigger scene updates.
      Cover editing input, biome/flora generation, and adapter attach/detach without
      relying on legacy 2D fixtures.

---

## Mannequin Movement Polish

Completed items have regression coverage and actual-FBX browser replays described
in [HANDOFF.md](./HANDOFF.md). Broader or unreproduced reports remain open.

- [x] **Climb, crouch-to-stand, and fall alignment** — Correct root-space scale/rotation, continuous wall and mantle motion, authored recovery poses, foot grounding, and contact-timed landings for click and keyboard control.
- [x] **High-wall animation cycle continuity** - Keep the wall action running
      across height segments and retain fractional frame time; verify actual
      skinned-joint motion and action weight at fixed and uneven frame rates.
- [x] **Natural falling speed** - Use world-scaled gravitational acceleration
      instead of level-based slow constant descent, retain contact-timed normal-speed
      recovery, and verify actual airtime for ledge drops and wall releases.
- [x] **Orientation deferral during traversal** — Preserve facing throughout committed climbs and falls, retain requested post-climb turns, and evaluate navigated falls using the actual world-space goal direction.
- [x] **Edge tile destination overshoot** — Arrival obeys the movement budget and reaches the exact destination without consuming the tolerance as a final snap. Verified a running arrival beside a cliff without falling off.
- [x] **Sprint-to-climb on closely spaced elevations** — Verified two eight-level rises with a single intermediate tile, including sprinting approach and continued navigation.
- [x] **Multiple in-line falls animation** — Verified two consecutive ten-level drops. Unsafe rolls use a braced landing; the next fall begins normally and releases its world lock before movement resumes.
- [ ] **Broader fall edge cases** — Continue stress-testing irregular/diagonal terrain and retargeting during animated transitions. World-space edge tracing replaces the old stored-grid/same-elevation guard, but the validated cliff fixtures are not exhaustive coverage.
- [ ] **Walk animation not playing for short paths** — Loaded-clip short walking paths now replay correctly. Reproduce the original cold-loading slide before declaring this report resolved.

---

## Dice Rolling

- [x] **Natural large d20 rolls** - Replace the scripted extended travel, three-axis
      spin, and late face snap with rigid-body physics. Read the real numbered
      facet, retain cocked dice for a manual reroll, and never substitute a random
      result for an unreadable physical die. Other dice types and multiple-die
      rolls are unchanged. Launch momentum now carries the die across the board
      and supports physical banks off its boundary walls.

---

## Character Sheets

- [x] **In-app character sheet window** - One movable/resizable non-modal
      window with per-creature tabs, two-way map/tab selection sync, retained
      layout on close, movable minimized title bar, and tab cleanup on token removal.
- [x] **Sheet-tab camera focus** - Center on the selected creature's current
      world position without zoom/orbit changes, including elevated creatures.
- [x] **Distinct duplicate creature names** - Number copies when duplicates are
      placed, update existing menu/sheet labels, and do not reuse deleted numbers
      during the current session.
- [x] **Movement settings and reachable tiles** - Per-creature distance allowance,
      live Walk/Run and Default/Drunk controls, cost-based perimeter outlines, click-only
      constrained routes, significant-climb costs, and no retargeting while moving.
- [x] **Partial wall climbing** - Double-cost vertical climbs, held mid-wall poses,
      smooth near-five-foot destinations, vertical wall outlines and fresh-action
      resumption. Walk climbs down; Run drops freely to lower ground. Live mode
      changes respect the original allowance, including partial wall stops.
- [x] **Authored downward climbing** - Import Mixamo's Climbing Down Wall FBX
      and play its downward cycle forward for controlled descents, retaining
      smooth loops, held poses, resumption, double cost and separate Run drops.
- [x] **Wall-aligned selection rings** - Keep hanging-creature markers flat
      against their wall face and centered behind the rendered body; follow
      pose/height changes and restore ground markers after dismounting.
- [x] **Stable ledge hangs** - Keep affordable upper-wall areas selectable and
      finish in a two-hand edge grip rather than a paused crouch. Preserve safe
      movement-budget cutoffs, smooth resumption, and separate platform goals.
- [x] **Board-boundary input** - Ignore empty off-board clicks instead of clamping
      them to an edge destination. Preserve selection, valid edge/body/wall hits,
      and bounded fallback behavior without reviving 3D misses through 2D input.
- [x] **First-pass character contents and local persistence** - Editable campaign-owned
      identity, abilities, HP, proficiencies, notes, saved-character library and
      validated JSON backups, independent of ephemeral scene tokens.
- [x] **Open SRD compendium and supported automation** - Local searchable
      item/spell data, drag/drop and Add alternatives, inventory/equip/attune,
      derived checks/AC/attacks, prepared casting, slot/concentration/rest tracking
      and shared dice rolls. Reference-only effects are labeled explicitly.
- [x] **Minimal campaign system and immutable edition** - Startup Create/Open
      picker, campaign-owned characters, explicit 2014/2024 rule implementations,
      source settings and acknowledged board saves before returning to the picker.
- [x] **Versioned local resource databases** - Separate edition IndexedDB catalogs,
      reviewed and hashed SRD/Open5e/5e-bits bundles, compatible opt-in sources,
      attribution/licenses, and preserved owned content when sources are disabled.
- [x] **Acknowledged persistent writes and scoped backups** - Atomic queued character
      commits with revision conflict checks before UI/economy success; same-edition
      character copies and scene-inclusive campaign backups excluding catalog databases.
- [x] **2024 equivalents for existing automation** - Casting/Action Surge rules,
      save-based Grapple/Shove, Monk Focus/dice/bonus options, Paladin features,
      level-1 casting and revised rest/resource recovery. New conditional effects
      remain manual rather than inheriting 2014 mechanics.
- [x] **Independent sidebar compendium** - Browse without opening a sheet; default
      Add to the selected creature or choose a saved character. Preserve drag/drop,
      show destination confirmations and route sheet Details to the same sidebar.
- [x] **Equipment mechanics in Details** - Show armor/shield AC, Dexterity handling,
      minimum Strength and Stealth disadvantage alongside price/weight.
- [x] **Unified visible movement controls** - One saved-character speed drives
      linked-token range; edit it on Core and show remaining movement as a Combat
      progress bar. Walk/Run buttons and Default/Drunk style remain shared.
      No duplicate allowance controls or changes to traversal rules.
- [x] **Compact health bar** - Current/max bar, separate temporary HP, Damage/Heal
      and direct-edit controls; temp absorption, healing caps, validation and
      persistence, without automatic target damage application.
- [x] **Prominent rest and Hit Dice controls** - Short/Long Rest beside health,
      optional one-die-at-a-time healing with Constitution, persistent remaining
      dice, 2014 partial long-rest recovery and shared dice/log integration.
- [x] **Rest-aware common class resources** - Manual usage counters with correct
      short/long/daily recovery, Pact Magic and optional Wizard Arcane Recovery;
      preserve usage in edition-scoped version-5 character and campaign backups.
- [x] **Campaign world autosave** - Restore terrain, explicit flora placements,
      stable creature IDs/names/character links, facing, camera and safe ground,
      wall or ledge checkpoints. Resume committed turn budgets and sheet/shared
      rolls without replaying unfinished work; report save failures/conflicts.
- [x] **Shared editable creature names** - Edit the standalone sheet title on
      every page; Enter/blur saves and Escape cancels. Only the title and tab show
      the name during normal play. Linked labels and persistence stay synchronized.
- [x] **Sheet settings disclosure** - A gear holds saved-character management,
      new/import/export/delete and Compendium controls outside the normal play view;
      operation failures remain visible when the settings panel is closed.
- [x] **Grouped character information and compact initiative** - One plain-text-style
      identity card across every sheet page; class is read-only, other values remain
      editable, and initiative is a smaller neighboring roll widget.
- [ ] **Character builder / charactermancer** - Determine class during guided
      character creation/progression and replace the temporary manual class dropdown
      currently in Core. Do not treat the overview card as class selection.
- [x] **Space-grab map panning** - Hold Space and left-drag in either camera view
      without moving/facing creatures or painting terrain; preserve text input,
      outside-canvas release, focus-loss cleanup and autosaved camera position.
- [x] **Unreflected facing drags** - Align snapped pointer direction with rendered
      humanoid forward and the existing movement convention in both camera views;
      use one shared conversion for navigation, short climbs/descents, vaults/hops,
      wall holds and cover. Test the loaded rigs in every cardinal direction,
      including turns into climbs, rather than only stored angles or east-facing poses.
- [ ] **Guided progression and broader 5e rules** - Level-up choices, class/subclass
      features, multiclassing, additional conditional item/spell mechanics and
      resource models beyond the first-pass supported calculations.
- [x] **Combat / Non-combat play views** - Keep Core editing; add streamlined
      checks/saves, compact play identity and relevant play options.
- [x] **Customizable play layouts and Favorites** - Separate saved layouts per
      character/page; drag sections/cards or use keyboard ordering, move favorites
      without duplicates, auto-save and confirmed page reset. Preserve turn rules,
      spent-option hiding, backup compatibility and ordinary checks/saves.
- [x] **Visible character history rail** - Fixed right-hand, independently
      scrolling uses/rolls with All / This turn filters, complete session history,
      older follow-ups, checks/saves/rest dice and safe async attribution.
- [x] **Manual-turn action economy** - Start/End Turn, enforced shared movement
      tied to the grid, manual/DM adjustment, actions/bonus/reactions/free options,
      Extra Attack continuation, disappearing spent options and recent-action rolls.
- [x] **Ability/action cost integration** - Use the existing common rest-aware
      counters for actual costs; add persistent custom entries, turn/rest/day
      resets, linked class pools and attack-count overrides without duplication.
- [ ] **Broader conditional combat features** - Active Rage/conditions, subclass
      features, two-weapon fighting, rituals and conditional spell/ability effects.
- [ ] **Targeting and automatic effect application** - Later stage; keep hit/save
      confirmation and damage/healing/effects manual during the initial combat pass.
- [ ] **Initiative/encounter ordering** - Later than the manual-turn combat pass.

---

## Visual Features

- [x] **Shared humanoid character catalog** - Add Knight D Pelegrini and Mutant
      with generic creation, palette/model registration and the existing movement rules.
- [x] **Shared visual action catalog** - Preserve existing emotes and add Wave,
      Sit, Take Cover, Jump, Punch, Hit Reaction, Dodge and Cast Spell, with lazy
      loading, in-place previews, safe completion and traversal protection.
- [x] **Actual-rig compatibility contracts** - Verify all registered appearances,
      including reduced fingers, split skins, grounded feet, ledge contacts,
      climbing costs, falls and late-action loading/removal.
- [x] **Rendered visual pass for imported humanoids** - Confirm live board,
      Knight and Mutant rendering in VS Code. Fix the capability preflight to
      accept working software-backed WebGL rather than reject performance caveats;
      retain genuine unsupported-browser detection and add regression coverage.
- [x] **Eight-direction facing gesture** - Left-drag an idle creature to set a
      camera-aware snapped heading without moving it or breaking ordinary clicks.
- [x] **Natural dodge recovery and wall cover** - Animate the sidestep and return;
      require an adjacent eligible cover wall and align the crouched body to it.
- [x] **Height-aware traversal and narrow-obstacle vaults** - Smooth small steps,
      short mantles, controlled Walk descents, Run hops, physical-height fall
      selection and committed Run vaults with clear supported landings and
      complete movement-allowance checks.
- [x] **Generated tree trunk overhang** — Fit the actual trunk base to supported terrain and map bounds; shrink uniformly only as needed to 65% of normal size, otherwise skip. Allow canopy overhang.
- [ ] **Tree overhang on manual placement** — Manual placement and preview do not yet apply the generated-tree support policy.
- [ ] **Tree orientation** — Investigate and fix incorrect tree orientation.
- [ ] **Tree variety** — Review and fix tree variety across generated biomes.
- [ ] **Unintended biome transparency** — Fix trees and other biome assets appearing transparent in biomes where they should remain opaque.
- [ ] **Water visuals** — Add visual water rendering for water-type biome tiles (rivers, lakes, swamps). Could include animated surface, transparency/depth effects, shoreline blending, and reflections.

---

## Deferred Platform Work

- Desktop packaging and shared-session multiplayer are future considerations,
  after the local gameplay and editing workflow is more complete.
- Procedural biome shader painting remains a future enhancement under ADR-0001.
