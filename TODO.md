# TavernTable — TODO

> Current backlog. Setup and the last verified test baseline are in
> [README.md](./README.md). Historical audits are not the current task list.

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

- [x] **In-app character sheet placeholder** - One movable/resizable non-modal
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
- [ ] **Character sheet contents and persistence** - Add actual sheet data and
      editing beyond Movement, and integrate it with a future scene save/load design.

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
