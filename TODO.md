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
- [x] **Transactional height editing and history** - Raise, Lower and Wall
      preview without changing gameplay or saved heights; commit on release and
      cancel safely. Undo/Redo restores whole gestures and Reset Terrain, with a
      100-edit session history and explicit load/resize/generation resets.

---

## Terrain Foundation

- [x] **Complete the accepted terrain-engine migration** - Follow
      [ADR-0001](./docs/adr/ADR-0001-terrain-engine-event-seam.md). Live callers use
      the engine's authoritative state and event seam; the coordinator only wires
      input and scene adapters.
- [x] **Add public-interface integration coverage for the migration** - Verify
      that game height queries and tool selection use the engine, resizing keeps
      game and terrain dimensions consistent, and reset/load trigger scene updates.
      Cover editing input, biome/flora generation, and adapter attach/detach without
      relying on legacy 2D fixtures.
- [ ] **Paused layered shared-world proof** - Solid/void geometry, multiple
      supports, a bridge/cave/two-storey example and traversal tests are
      implemented. Final validation is paused; preserve the proof without
      extending its numeric volume editor. Separate connected grids replace
      the shared-board layering direction.

---

## Connected-grid Map Building

- [x] **Connected-map records and persistence foundation** - Independent map
      records carry physical anchors, quarter-turn rotation and render scale.
      Version-3 saves/backups preserve one creature collection, map-local poses,
      shared combat and inactive terrain/structure cover. Explicit legacy
      migration preserves positions and existing spell areas/history. Model
      transfers keep physical position and identity without refreshing movement
      or teleporting between floor elevations.
- [x] **Campaign-space targeting foundation** - Target range and obstruction
      queries include unrendered map geometry, finite interior slabs and openings,
      plus unsaved edits from the active terrain owner. Spell picks and overlay
      rendering use inverse physical/view transforms. Test projection eligibility
      in both directions without creating duplicate gameplay tokens.
- [x] **Local map/focus controls** - Maps & focus browses maps or explicitly
      focuses/centers an existing creature. Preserve canonical identity, positions,
      resources, turn budgets and shared roll history without creature transfers.
      Persist independent per-map cameras across reopening. Guard unfinished
      movement/actions/terrain gestures, roll back failed switches and never save
      a partial map load. Same-map refocusing keeps terrain Undo intact.
- [ ] **Independent participant views** - Separate shared creature locations
      from each participant's focused character, displayed map and camera. A
      player follows their own character; the DM can focus any character on any
      map without moving other viewers. Implement the ownership and shared-session
      synchronization needed for actual connected players.
      Independent local focus, live map/focus controls and persistent per-map
      camera histories are implemented and tested; authenticated networking remains.
- [x] **Render synchronized cross-grid projections** - Render visible off-map
      characters at their translated position, facing and animation. Resolve
      clicks and targeting to their original ID; do not duplicate state or grant
      sight through walls, floors or visually hidden roofs. Model loads are
      shared across refreshes and stale loads cannot reveal hidden/removed actors.
- [x] **Map-aware creature occupancy** - Translate foreign cells and body heights
      for supported, heightfield and flight movement. Preserve actual physical
      blockers without leaking local interior coordinates into exterior ranges.
      Keep local placement/selection lookups scoped to their map.
- [x] **Canonical character-sheet focus** - Opening a sheet, clicking/keyboard
      switching its tabs or focusing the remaining neighboring tab switches to
      the creature's actual map and position. Keep passive projected-token
      selection separate, preserve state, and refresh/unlock view controls.
      Report failed focus visibly without claiming success.
      Publish busy/ready combat availability for tab/view transitions so End Turn
      does not remain disabled after returning to the active creature. Exercise
      production services, same/cross-map tabs, keyboard and pop-out controls.
- [x] **Supporting terrain for visible projections** - Render a bounded preview
      of actual source-map terrain along character sight lines, including real
      support at narrow window edges. Preserve elevations/rotation/scale, avoid
      overlapping the active floor, remove hidden contexts and dispose resources.
      Keep this visual context separate from editable/navigation terrain.
- [x] **Roofless interior wall views** - Show shared physical walls and actual
      window/door openings on interior grids, including unfocused/empty maps.
      Keep upper storeys and ceiling/roof coverage out of the current view,
      preserve map rotations/scales, and handle interior-owned structures too.
      Retain original exterior roofs, physics/sight data and source ownership;
      cutaway meshes are cached, cleaned up and never saved as new geometry.
- [x] **Clickable physical doorway and stair transfers** - Click an actual
      opening/staircase for an Enter / Use stairs confirmation popup, not a radial
      action or proximity trigger. Persist validated geometry references and
      supported routes, charge approach/elevation/prone costs, reject blockers and
      unaffordable travel, and preserve canonical actors, resources, turn and other
      views. Save the destination with its paid ledger; roll back/refund failures.
      Include the two-floor proof, grid-aligned landings, actual treads visible
      through the upper stairwell, and centre/head sight through upper windows
      without losing solid floor/roof occlusion.
- [x] **Automatic entrance approach** - A distant door/stair click uses normal
      pathing to walk toward its source entrance, stopping at the closest point
      reachable with the remaining movement. Offer explicit traversal only when
      close enough and affordable; otherwise stop without crossing or resetting
      the turn. Preserve obstacle/occupancy rules and charge walking normally.
      New destinations, actor selections and Escape cancel the pending offer
      without refunding walking. Retain the existing free-play per-move allowance
      refresh. Verify actual animated movement and exact costs.
- [x] **Physical flight, windows, balconies and falls** - Confirm Fly through
      after paid 3D approach alignment, preserving physical altitude and flight.
      Add low/high window and bare-opening climbing, supported balcony landings,
      saved exterior holds, partial ascents/descents and free Drop through the
      shared falling pipeline. Preserve real wall/floor clearance and movement
      ledgers without granting a free turn or elevation jump. Commit cross-floor
      landing and fall damage together; retry failed saves without double damage.
      Include the three-floor/balcony proof and actual humanoid animation tests.
      Cross-map crossings remain explicit atomic save operations, not seamless
      automatic transfers.
- [x] **Surface-based flight and wall controls** - Route real ground/balcony picks
      into normal flying movement. Replace window-bound hold controls with wall
      targets and ground/platform Climb / Drop choices. Animate physical wall
      travel, partial progress, safe redirects, platform mantles and confirmed
      window-gap drops/re-grabs. Save independent physical grips and atomic catch
      damage, retain exact movement costs, allow Take flight from a grip, and
      render empty interiors' physical floors. Wait for in-flight saves on focus
      changes without latching Changing map on an invalid checkpoint.
- [x] **Short animated window crossings** - Charge 5 ft to enter/exit when already
      at the opening, with genuine approach/ascent charged separately. Avoid
      synthetic hoist/settling charges and unnecessary centring detours. Switch
      a following view to the destination, animate with existing climb/recovery
      clips, then persist the final pose and movement. Keep confirmations brief
      and retain clear insufficient-movement/blocker errors.
- [ ] **Dedicated lateral climbing and corner routes** - Add suitable sideways
      clips and broader multi-face routing; current supported same-wall movement
      reuses available climb animations and never treats gaps as solid handholds.
- [ ] **Build-only outline tool** - Replace the numeric construction workflow
      with Build, height in 10-foot floor increments and a closed straight-line
      footprint. Generate a hollow exterior and separate floor grids from that
      outline. Complete when the endpoints meet; support preview/cancellation
      and an atomic build without partial structures or maps.
- [ ] **Magical portal transfers (later)** - Floating circular gates/vortices
      transport creatures between locations. No seeing or targeting through
      the portal. Keep this separate from physical doorway/stair connections;
      implement the two-floor physical travel/sight slice first.
- [ ] **Later builder extensions** - Add manual floor removal for tall rooms,
      curves/circles and further shape editing after the basic workflow.
      Cut/carving remains undecided and is not required for the first builder.

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

- Desktop packaging remains deferred. Shared-session multiplayer is part of
  the planned connected-grid participant-view work above; the current runtime
  remains browser-local.
- Procedural biome shader painting remains a future enhancement under ADR-0001.
