# TavernTable domain context

- **Scene**: the browser-local board, terrain, placed tokens and camera state.
  Reloading does not currently preserve an edited scene.
- **Creature token**: one logical gameplay instance with a stable ID, grid/world
  position, facing, movement settings and character-sheet tab.
- **Character definition**: a reusable humanoid appearance and rig, not a separate
  movement implementation. The prototype characters share the current one-square
  footprint and movement rules.
- **Reference character**: the existing Mannequin, whose established movement
  clips and normalization are preserved while new appearances use compatible
  retargeted clips.
- **Animation role**: a clip used by existing locomotion or traversal behavior,
  such as walking, wall climbing, a ledge grip or landing recovery.
- **Manual action**: a user-triggered visual performance. It does not implement
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

Terrain ownership migration, scene persistence, multiplayer and new combat rules
are outside this import/authoring work.
