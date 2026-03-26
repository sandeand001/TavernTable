# TavernTable — TODO

> Post-refactor tasks and known issues to address after the cleanup roadmap is complete.

---

## Mannequin Movement Polish

- [ ] **Fall animation edge cases** — Fall detection uses world-position-derived tile which can be slightly off at tile boundaries. Current fix (same-elevation guard) prevents cliff-edge oscillation but edge-adjacent destinations may still have issues where the sprite overshoots instead of stopping. Investigate smoother cliff-edge pathGoal handling.
- [ ] **Orientation deferral during path navigation** — `_advanceWalkPhase` calls `_ensureFallStepActive` before `_applyPendingOrientation`, so `_getMovementYaw` may use a stale `facingAngle` when checking which tile to evaluate for falls. Low-priority since the world-position fix mostly compensates, but a proper fix would apply pending orientation before fall detection.
- [ ] **Walk animation not playing for short paths** — Sprite slides instead of walking for short-distance navigation. Run animation works for longer paths. Investigate whether the `walk` action is failing to load or the animation fade-in is being skipped.
- [ ] **Edge tile destination overshoot** — Sprite cannot stop on destination tile when that tile is on the edge of an elevated area. May overshoot and fall off.
- [ ] **Sprint-to-climb on closely spaced elevations** — Odd behavior when sprinting across multiple elevation changes with only a single tile between the top of the first climb and the start of the second. May be related to sprint state persisting through climb continuation, or the single-tile gap not giving enough space for the approach phase.
