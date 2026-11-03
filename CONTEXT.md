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
  or geometry edits, including Reset Terrain heights. A whole gesture is one edit. New committed
  edits replace the redo branch; canceled previews and no-op edits do not.
  Loading, resizing or generating a map clears this history. It does not undo
  placeable removal, dice rolls, character actions or movement.
- **Creature token**: one logical gameplay instance with a stable ID, grid/world
  position, facing, movement settings and character-sheet tab.
- **Tactical token view**: a camera-driven rendering substitution, not a new
  gameplay instance. Enter at 80 degrees above ground; leave below 78 degrees.
  Circular name/portrait tokens retain the creature's position, selection and
  movement while its original model and animation state remain available.
- **Campaign**: a named, browser-local workspace with an explicitly chosen,
  immutable 2014 or 2024 ruleset. Startup offers Create/Open rather than silently
  resuming. Saved scenes contain either a legacy board or a connected map
  collection, never a separate campaign per floor. Switching campaigns flushes
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
- **Character images**: optional embedded raster images owned by the saved
  character and shared by its linked tokens. The center-cropped portrait is used
  for tactical tokens and sheet identity; separate proportional artwork belongs
  on Bio & notes. Uploads stay browser-local and travel in character/campaign
  backups. Renderer textures and temporary image-loading state are never saved.
- **Character speed**: the saved record's authoritative ground-distance setting for
  linked tokens and their grid ranges, editable only on Core. Combat displays
  remaining movement as feet/allowance and a progress bar. Pace (Walk/Run) and animation style
  (Default/Drunk) remain per token. Free play has a per-move allowance; manual
  combat shares remaining movement across committed routes. Walk/Run is not Dash,
  and there is no separate editable board-speed field.
- **Movement redirection**: the latest destination click replaces an active
  route at its next safe step, climbing hold or landing. Completed costs remain;
  the old untraveled reservation is refunded. An unreachable destination chooses
  the closest legal reachable point. Redirects retain one free-play journey's
  allowance and the existing combat turn budget, never resetting movement.
  Pending destinations are session-local and are not replayed from checkpoints.
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

## Connected-grid map-building direction (foundation implemented)

The user has replaced the layered shared-world direction with separate grids
for buildings, floors and larger areas. The connected-map data, physical-coordinate,
persistence and targeting foundation is implemented. The existing construction
proof remains paused and is not the chosen builder workflow. Sight-gated cross-grid
character projections now render the original creature's model. Live Maps & focus
controls switch local views without transferring creatures. Connection-driven
locomotion, the outline builder and actual multiplayer remain further
implementation chunks.

- **Connected grid**: an independently editable and viewable tactical map within
  one campaign. A building interior, another floor or a larger area can have its
  own grid. Character location belongs to the campaign world, not to whichever
  map a participant happens to be viewing.
- **Building outline**: a closed, straight-line footprint drawn on the map.
  Meeting the first endpoint completes the outline. The simplified tool starts
  with Build and a height choice, using 10-foot floor increments. It generates
  a hollow building and separate floor grids rather than filling a solid box.
  Cut/carving is undecided and deferred; curves, circles and manual floor
  removal are later work.
- **Grid connection**: a link between locations in different grids. Doorways
  and stairs use explicit Enter / Use stairs interactions, transferring only
  the acting creature. Only views following that creature switch maps;
  unrelated participants keep their current view.
- **Magical portal (planned)**: a transport-only connection represented by a
  floating circular gate or vortex, not an ordinary doorway/window opening.
  Portals do not transmit sight or targeting to the destination. Implement
  physical doors/stairs and two-floor sight validation before this later feature.
- **Spatial relationship**: the aligned position, orientation and elevation
  connecting grids in physical feet. Separate grids are not disconnected
  spaces: sight, attacks, flight and falling across openings are required from
  the outset. Walls, floors, ceilings and openings still determine obstruction,
  clearance and landing. Physical links are part of the foundation, not a
  later replacement for doorway-only teleportation.
- **Campaign spatial record**: one creature ID with a map-local position,
  transformed into campaign coordinates in physical feet. Maps carry an origin,
  quarter-turn orientation and physical render scale; camera zoom does not change
  distances. A projection is derived view data referring to that same creature,
  never a second token with its own HP, effects, occupancy or movement budget.
- **Cross-grid projection**: one viewer-local rendering of an off-map creature,
  using its original identity, translated position, elevation, facing and animation.
  The focused character's physical sight query gates the model; Blinded observers,
  invisible targets, walls and floors can hide it. Rendering and ray picking refer
  to the original creature, never an added gameplay token. Ordinary camera
  occlusion still applies. Hiding a roof or moving the DM camera does not grant sight.
  Networked animation synchronization and broader vision rules remain future work.
- **Projection terrain context**: render-only supporting ground/floors from the
  visible creature's source-map checkpoint. A bounded sight corridor can join the
  viewed grid to the projection where actual terrain exists, instead of leaving
  an isolated floating sprite. Preserve actual elevations, rotations and scales,
  avoid duplicate active-map surfaces, and keep the creature's real support at
  narrow window edges. Character sight gates the context; hidden/invisible
  creatures and unfocused views do not reveal it. It never adds editable cells,
  navigation supports, gameplay creatures or saved geometry to the viewed map.
- **Interior wall cutaway**: a floor-map view renders the existing physical
  enclosure and its actual window/door cuts without ceiling coverage. Project
  shared source geometry into the current map and clip it to the room/story;
  interior-owned geometry uses the same roofless mesh query. The local wall
  layout is shown even without a focused creature, separately from sight-gated
  exterior sprites and their terrain context. Never delete physical roofs,
  duplicate authoritative walls, add navigation supports or save the cutaway
  meshes. Exterior rendering and character-sight geometry remain unchanged.
- **Map-aware occupancy**: translate foreign creature positions into the viewed
  grid and compare actual body elevations before blocking movement. Ground,
  supported-surface and flight ranges do not reserve another map's raw local
  coordinates. Real nearby creatures still block at their physical location,
  independently of whether a projection is visible. Local placement/selection
  lookup is scoped to the current map.
- **Participant view**: that participant's focused creature, displayed grid
  and camera. These are separate from shared character locations. A player can
  stay focused on their own character; the DM can explicitly focus a character
  on any map. A view follows its focused creature across transfers, but another
  character's transfer must not change it. Targeting a creature on another grid
  does not by itself change viewing focus.
- **Map view change**: a local view transaction, not a creature transfer or turn
  transition. Browsing clears focus; explicit creature focus selects its actual
  map and centers its local position. The live Maps & focus controls preserve
  canonical creatures, character resources, movement spent, combat and shared
  roll history. Each map's camera survives save/reopen independently of other
  local views. Same-map refocusing does not reload terrain or clear its Undo.
  Unfinished movement, actions and terrain gestures block a switch. Failed loads
  roll back the old view; a failed rollback blocks saving and actions until reload
  rather than persisting a partial scene.
  Opening or explicitly activating a character-sheet tab uses this transaction
  to focus its canonical map and local position, never a projected render
  position. Passive token-selection events still update sheets without changing
  viewing focus. Sheet-driven changes use the same loading/ready notifications
  and controls as direct Maps & focus changes.
  Publish combat movement/availability state at both view-transition boundaries:
  the animation loop is paused during the switch and cannot observe its temporary
  busy state. A tab must leave the canonical sprite selected and its turn controls
  ready without another sprite click, while preserving the active turn and costs.
- **Cross-grid creature transfer**: relocation of the same logical creature,
  not deletion and recreation or a character copy. Its stable ID, linked
  character, HP, conditions, concentration, resources and combat/movement ledger
  survive the transfer. Changing grids does not refresh a turn or grant movement.
- **Physical connection**: an optional version-3 scene record connecting two maps
  through an existing doorway, staircase, window or wall opening. Each end stores
  map-local physical feet; intermediate route points use campaign feet.
  A feature reference names
  the owning map and its opening/stair volume IDs, rather than duplicating
  authoritative geometry. Validate references on load/save and derive click bounds
  from those volumes using the maps' physical transforms.
  A climbable `window` references exactly one subtractive aperture and declares
  `outsideMapId`; it can represent a bare wall opening, not only a glazed window.
  A supported walk-through arch uses `opening`. Do not infer traversability from
  every arbitrary carve.
- **Traversal popup**: left-click a physical opening or staircase to offer
  Enter / Exit / Use stairs / Fly through for the selected canonical
  creature (or the focused creature when none is selected).
  Keep the prompt to a short question and cost-bearing action buttons.
  Show "Not enough movement." when unaffordable and retain genuine blocker/error
  messages; do not append rule explanations, actor/destination prose or falling
  paragraphs. Nearby clicks open the popup directly. A distant click explicitly
  requests an approach using normal supported movement, not a transfer: move
  toward the source entrance as far as the remaining allowance permits.
  Stop short if unreachable within that allowance; on arrival, offer traversal
  only if its remaining movement cost is affordable. Continue showing actual
  blocked-route reasons rather than treating every unavailable route as exhausted
  movement. Cancel, Escape and outside clicks dismiss an offer without transferring;
  completed walking is never refunded. A new destination, selection or view change
  supersedes the pending offer. No radial action, automatic proximity transfer,
  copied actor, free turn or alternative movement engine.
  Combat approach and traversal share the same turn ledger. Free play keeps its
  existing per-move allowance refresh after the completed walk, before offering
  traversal; do not introduce a combined-click speed cap outside combat.
  Preserve foreground sprite picking, opaque visual occlusion, camera gestures,
  terrain editing and active spell targeting.
  Confirmation revalidates the live route. The creature must be within
  five feet and on the viewed map; combat transfers require its active turn.
  Walking requires support; flying requires an already-airborne creature with
  effective flying speed. Flying approach explicitly pays vertical alignment
  and horizontal travel, then waits for confirmation. Door/window crossings
  preserve campaign-space altitude; stair flight pays its explicit route rises.
  Validate continuous support, real stair rises, swept standing clearance,
  occupied landings and remaining allowance. Include the approach, elevation and
  prone costs using the existing five-foot movement convention.
  Reserve movement, keep a safe source checkpoint, and acknowledge the destination
  with its completed cost before finishing the reservation. Restore/refund a
  failed load/save; a failed rollback requires reload and blocks partial saves.
  Free-play physical travel completes the per-move allowance, but a zero-distance
  map-only switch must not erase the cost of standing.
  A locally selected sprite also follows its confirmed crossing or physical
  lower-map landing, even without sheet/map focus. Unselected background actors
  do not move a view deliberately watching another creature.
  Other views and canonical actor identity,
  resources, combat and turn remain intact. Transfers remain atomic save
  operations. For ground window crossings, the following view switches first,
  then plays grounded climb/recovery clips forward for entering and reversed for
  exiting. Keep partial poses unsavable, permit presentation frames while input
  stays busy-blocked, and settle the final pose before committing the cost.
  Background transfers do not steal an independent view. Above a stairwell, render only the real connected
  lower treads as read-only context; the current floor still occludes them.
- **Opening hold**: saved `ledge` pose with map-local `world` and `openingId`,
  bound to the exterior of a real climbable aperture. Validate the wall/sill grip,
  exterior body clearance and owning map before capture/restore. Unsupported
  Climb out ends in this hold, not an automatic fall. A normal window crossing
  costs 5 ft in/out, separately from paid approach/ascent. Do not bill the
  animation clearance arc or force a nearby valid handhold to the opening centre.
  Wall ascent/descent spend double movement with five-foot-rounded totals; as with ordinary
  wall climbing, clear Prone first. Insufficient movement can stop at a safe
  jamb/wall hold across turns. Same-map progress
  must not rebuild terrain or erase editor history. Preserve height through
  normal height resyncs. Render a paused ledge or wall pose, neutralize embedded
  clip translation and align actual hands to the physical grip in the viewed
  map frame, including projections.
  Opening clicks now offer crossing only; ground/platform clicks provide the
  follow-up climb or free Drop actions. Drop clears attachment, animates descent
  and uses shared falling reactions, protections,
  damage and Prone. Like deliberate flight Drop, it relinquishes flight's own
  protection but not Feather Fall or Slow Fall.
- **Physical wall grip**: version-3 `grip` pose stores creature-local `world`
  and `{ mapId, pointFeet, normal, offsetFeet }` for a hand contact on real
  owner-map geometry. Validate the axis-aligned normal, finite reach, hand
  contact, body clearance and map transforms independently of any connection.
  Old opening holds remain readable and can become independent grips when moving.
  Window clicks offer crossing only. Ground/platform clicks while held offer a
  climb route or free Drop; wall clicks approach, climb and redirect at paid safe
  checkpoints. Preserve normal movement reservations and five-foot-rounded costs,
  including interrupted routes and the last climb waypoint before a free fall.
  Use the authored upward/downward clips rather than teleporting between holds.
  Keep their unwrapped cycle clocks through safe waypoints and resume held clips
  at the sampled phase. Use the existing authored root-height curves for physical
  progress, with short blends only when changing clips/attaching, not hard resets.
  Available clips also animate basic same-wall lateral travel; dedicated lateral
  clips and general corner routing are not yet implemented.
  Solid support is required throughout attached routes. Confirm vertical opening
  gaps before releasing into a shared animated fall and automatic physical catch.
  Apply normal catch damage/protections atomically with the new grip, suppressing
  Prone only for that catch, not by granting a character immunity. Each
  catch measures only unsupported descent to its grip, never distance to ground.
  Keep confirmations brief; catch distances and full-release Drop remain distinct
  in the rules and roll history. A failed catch save pauses and retries without rerolling; failed post-ack presentation
  requires reload and blocks overwriting the acknowledged grip. If damage leaves
  the creature unable to hold, release it into the normal falling pipeline.
  Platform routes can mantle reachable lips or clear nearby real railings from
  a supported wall hold, but never invent a climbing face beneath an overhang.
  Ground-to-window partial approaches also use animated wall movement. Full
  cross-map interactions remain separately confirmed transfers.
- **Physical support across maps**: query real finite floors/platforms below the
  campaign-space position, using live geometry only for its owner. Interior
  floor holes are not imaginary local ground, and balconies remain physical
  support even when another map owns them. Hidden floors/roofs still block
  flight, navigation and sight.
  Adapter ground-ring positions use the viewed map frame; convert from that
  frame, not the creature's home map, for campaign-space targeting. Read-only
  queries without a live terrain owner use the saved physical geometry.
  Exterior physical floor slabs render independently of visible creature context;
  they retain source ownership, real occlusion and read-only geometry. Picking
  interior cutaway walls and these slabs retains the owning map reference.
  For a lower-map fall landing, stage the destination placement only in that
  fall's character/combat commit so HP, Prone and landing persist atomically.
  Keep the safe source checkpoint while unresolved; retry failed storage without
  rerolling or double damage. After acknowledgement, settle other motion before
  rebuilding a following view. A post-commit presentation failure requires
  reload, never a false rollback of acknowledged damage or position.
  A view change may wait for an already-running character save. Its checkpoint
  flushes must not indefinitely retry SceneNotReady while the view has paused the
  very frames needed to settle; expose the error and release view-busy state.

New campaigns still start browser-local and single-board. Version-3 scene
checkpoints store independent maps, one campaign-wide creature collection,
shared combat state, a local default view and optional per-map camera histories;
live capture/restore,
IndexedDB saves and backups preserve inactive maps and their creature poses.
Versions 1 and 2 remain supported without automatic conversion. Explicit
migration preserves physical distances and rescales existing spell-area/history
coordinates exactly once. Participant-view objects keep focus and camera histories
independent, but are not authenticated network participants. Live map/focus
controls are hidden for legacy single-board scenes; those scenes are not
automatically converted.

Cross-grid targeting uses campaign feet, actual geometry from every relevant map,
the active terrain owner's unsaved edits, and stored cover bounds for unrendered
structures. Spell picks transform into campaign coordinates; overlays transform
back into the displayed map. Connected creature sight checks target centre and
head heights from the same observer eye, allowing upper windows without ignoring
physical floors, roofs or walls. Interior base floors are finite half-foot slabs,
not columns of earth extending through floors below.

Connected-player ownership and synchronization still require explicit work;
the development file server is not a multiplayer session server.
Terrain ownership continues to follow
[ADR-0001](./docs/adr/ADR-0001-terrain-engine-event-seam.md): each grid needs one
authoritative terrain owner, not duplicate gameplay and renderer height stores.

## Paused shared-world prototype

The retained proof implements bounded solid boxes, hollow box cuts, multiple
support floors, stairs, physical flight clearance and next-floor landing on one
board. Final prototype validation was paused when the direction changed.
The following terms describe that prototype, not the connected-grid plan.

- **Constructed geometry checkpoint**: version-2 campaign scene data contains
  ordered Add/Subtract volumes and stable creature support IDs. Legacy version-1
  heightfield scenes remain valid. Views and Undo/Redo are session-local.
- **Surface navigation**: constructed maps route between clear floor supports
  and stair tops, spending existing five-foot grid costs (double while prone).
  A drop from a platform uses the shared falling lifecycle. Connected version-3
  scenes also support physical wall grips/climbs; standalone version-2 scenes
  retain their supported-floor navigation for this slice. Size-specific
  full-volume creature collision remains future work; heightfield-only maps
  retain their existing traversal pipeline.

- **Layered shared world**: one physical 3D board with common coordinates and
  real elevations. Floors can be edited and viewed separately without becoming
  disconnected gameplay maps. Stairs, shafts, bridges, flight and falls connect
  space within that same world.
- **Level layer**: a named authoring and visibility group, such as a basement,
  ground floor, upper floor or roof. The prototype can isolate and hide layers;
  locking and duplication remain planned. Hiding a layer does not remove its physical geometry
  or change collision and traversal.
- **Prototype structure**: editable constructed geometry, including walls, floors,
  ceilings, roofs and openings. A structure can span level layers and belongs
  to the shared world rather than being a raised terrain rectangle.
- **Walkable surface**: a valid support at a position and elevation. Multiple
  surfaces can occupy the same horizontal map position, such as a path beneath
  a bridge. Navigation, landing, flight clearance and saved token support must
  distinguish those surfaces.
- **Volume edit**: a bounded 3D addition or subtraction that can produce solid
  geometry or actual empty space, including cave chambers, tunnels and arch
  openings. Lowering a heightfield alone is not a hollow volume.
- **Hybrid authoring (prototype)**: combine outdoor terrain sculpting with
  editable construction and targeted volume edits. The revised builder keeps
  outdoor sculpting and simplifies construction; carving is not currently
  required.
- **Grid-aware detail**: preserve five-foot-grid gameplay while allowing smooth
  curves, thinner walls and sub-grid construction dimensions. Shape detail does
  not silently change movement distances or rules.
