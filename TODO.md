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

## Visual Features

- [ ] **Tree overhang on placement** — Investigate and fix the tree overhang issue when placing trees.
- [ ] **Tree orientation** — Investigate and fix incorrect tree orientation.
- [ ] **Tree variety** — Review and fix tree variety across generated biomes.
- [ ] **Unintended biome transparency** — Fix trees and other biome assets appearing transparent in biomes where they should remain opaque.
- [ ] **Water visuals** — Add visual water rendering for water-type biome tiles (rivers, lakes, swamps). Could include animated surface, transparency/depth effects, shoreline blending, and reflections.

---

## Deferred Platform Work

- Desktop packaging and shared-session multiplayer are future considerations,
  after the local gameplay and editing workflow is more complete.
- Procedural biome shader painting remains a future enhancement under ADR-0001.
