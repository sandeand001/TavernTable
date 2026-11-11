# TavernTable domain context

- **Scene**: the active board, terrain, placed tokens and camera state.
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
- **Map pan chord**: Space + left-drag gives the camera priority over terrain,
  placement and construction input. A canvas grab can claim Space already held
  after using a UI control, without stealing the control's normal keyboard input.
  Cancel unfinished strokes/drags, retain the selected tool and restore its cursor
  when the pan ends.
- **Terrain history**: session-local Undo/Redo for the last 100 committed height
  or geometry edits, including Reset Terrain heights. A whole gesture is one edit. New committed
  edits replace the redo branch; canceled previews and no-op edits do not.
  Loading, resizing or generating a map clears this history. It does not undo
  placeable removal, dice rolls, character actions or movement.
- **Creature token**: one logical gameplay instance with a stable ID, grid/world
  position, facing, movement settings and character-sheet tab.
- **Creature interaction**: a short left-click selects a creature and opens its
  radial menu; right-click also opens the menu. Left-drag turns an idle creature
  without opening a menu, while right-drag retains camera orbit.
- **Tactical token view**: a camera-driven rendering substitution, not a new
  gameplay instance. Enter at 80 degrees above ground; leave below 78 degrees.
  Circular name/portrait tokens retain the creature's position, selection and
  movement while its original model and animation state remain available.
- **DM tactical overview**: overhead markers show canonical creatures on the
  displayed map and directly above/below its physical footprint, including
  roof/floor-occluded interiors, not unrelated campaign locations. Screen-space
  offsets and leader lines separate stacked floors; labels use structure and
  floor/level metadata. Focus links open the creature's map and center its camera
  without moving or copying gameplay instances.
- **Player physical sight**: published creature rows are filtered on the host
  from one active assigned creature, never the camera or combined party.
  Preserve published-map authorization and physical terrain/wall/floor/opening
  occlusion. Saved opaque tree/rock bounds add sight blockers without treating
  leaves as solids; legacy asset maps need a DM capture before publication.
  Fog of war, darkness, invisibility and other vision effects remain deferred.
- **Campaign**: a named, host-persisted workspace with an explicitly chosen,
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
  promises or in-flight animation frames. Actual saved-state changes schedule
  routine autosave after two quiet seconds, with a ten-second maximum wait.
  Short moves save at completion; long moves also save their last safe position
  and matching movement costs at that deadline, never at every waypoint.
  Safe ground steps and wall/ledge holds remain in memory for interruption/rollback;
  restoring a checkpoint never replays its unfinished route. Atomic
  character/resource/fall transactions still include their safe scene and cost.
  Finite-floor maps retain an explicit geometry snapshot even with no volume
  edits, so cellar access survives capture, focus changes and reopening.
  Completed rolls and turn
  budgets resume; unfinished rolls/routes are not replayed. Undo receipts and open
  sheet windows remain session-local. A creature's linked character and sheet tab
  share its name.
- **Local campaign host**: a loopback-only Node 24.4+ process serving the app and
  persisting campaigns in SQLite outside browser profiles and the served project.
  A successful save receipt follows a committed disk transaction with full
  synchronous durability. Chrome and VS Code share the host's data directory;
  renderer objects, catalog caches and unfinished animations are not saved.
  Host failure never silently falls back to IndexedDB. Authenticated DM/player
  sessions require same-origin cookie identity and a session-specific CSRF
  credential for writes. The initial player scope is assigned sheets and
  published read-only views, not authoritative movement/combat. Reload and sign
  in again after a host restart. Browser-only storage remains
  explicit for tests and migration, with non-destructive Copy to host and JSON
  backup import/export. Agent-created browser tabs may have in-memory storage;
  flushing such a profile does not make it survive an editor restart.
- **Automatic JSON snapshot**: an independent complete campaign backup after
  committed changes, scheduled every five minutes and bounded to 20 files per
  campaign. Manual backup flushes active changes first; restore creates a
  separate private campaign. Backup failure is reported separately from the
  acknowledged primary save. Credentials and access assignments are not included.
- **Player invitation**: a reusable, revocable private credential for one
  campaign/player identity. Reissue/revocation invalidates previous access
  without deleting the player's saved characters. Invitations/assignments persist;
  browser session cookies expire or require renewal after host restart.
- **Character assignment**: permission to edit an existing campaign-owned saved
  character ID, independent of temporary scene tokens. Player writes merge only
  assigned records, preserve unrelated records, validate against pinned rules and
  cannot replace campaign scenes or grant permissions.
- **Player location access**: derive public render data and visible creature
  positions from one active assigned creature's physical location. Connected
  areas in that location do not require individual publishing permission.
  Other locations and unassigned private sheets are not transmitted as part of
  that view. Cameras are participant-local; switching assigned characters can
  switch locations, while opening a sheet alone does not change the observer.
  The first viewer is deliberately passive; area access is not fog-of-war within
  that map. Internet access requires a configured exact HTTPS origin through a
  trusted proxy/tunnel; no listener or firewall exposure is created automatically.
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
  backups include settings, characters and committed scenes, not bundled databases.
- **Saved character**: a persistent rules record, independent of a
  creature token's name, appearance and ephemeral scene ID. A token can load a
  record through `characterSheetId`; saving the record does not save the board.
- **Saved character roster**: the Tokens menu lists all campaign records for the DM;
  player workspaces retain assigned-only access. Unplaced sheets reuse the same
  library through isolated presentation tokens, never canonical world actors or a
  new rules record. Placing first acknowledges a validated scene checkpoint,
  then creates a linked sprite without resetting character resources. Existing
  actors are focused/opened, not duplicated or moved. Removing a sprite retains
  its record. Unplaced sheets cannot spend world actions or stand without movement.
  A next-placement model choice is explicit UI-local state for this workspace
  session; placed actor `type` and character portraits keep their existing
  persistence. No serialized saved-character model preference is introduced.
  Unknown unplaced records require an explicit canonical next-sprite choice;
  neither a portrait nor the current palette default supplies a saved model.
- **Character images**: optional embedded raster images owned by the saved
  character and shared by its linked tokens. The center-cropped portrait is used
  for tactical tokens and sheet identity; separate proportional artwork belongs
  on Bio & notes. Uploads stay in the local host's records and travel in character/campaign
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
  Safe airborne waypoints and their costs remain in memory during the move.
  Routine saves include the last safe airborne waypoint and its costs at the
  ten-second deadline during long flights, and save again after completion.
  Unfinished routes, animation frames and unresolved fall outcomes are never saved.
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
  override in the action companion. All 319 classic and 339 revised core spells
  have an explicit initial-casting definition: 297/313 structured profiles and
  22/26 specific manual cases at base level. Complex or unsupported modes require
  explicit manual confirmation rather than guessed rules.
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
  from the expended slot level, and manual/complex targeting gets a compact gear.
- **Casting level selection**: available slot-level buttons live in the targeting
  popup, not spell cards. Preview choices recalculate upcasting while keeping the
  original reservation immutable. Confirmation revalidates that reservation before
  replacing its casting choice; committed costs use the confirmed level. A canceled
  preview spends nothing. Roll-only spell damage retains the last confirmed level.
- **Spell template choice**: supported wall/ring/sphere/dome options are preview
  choices in the same popup. Confirmation revalidates the original reservation
  before committing the chosen template and slot. Static overrides are one
  explicit template; resetting restores the reviewed choices.
- **Spell reminder**: a scene-only recipient list or point marker with a caster-turn
  duration or an explicitly manual-ended lifetime. It does not apply HP, conditions,
  movement grants or other statistics. Declared-target reminders can be pruned
  after manual saves; the last removal ends matching concentration. Recasting
  Mage Hand, Light, Minor Illusion or Simulacrum replaces the previous matching
  source marker and Undo restores it.
- **Spell-effect movement**: a source-owned ongoing effect action, not another cast.
  Measure from its previous origin, preserve duration and concentration, and spend
  the reviewed Action/Bonus action. 2024 Magic actions obey Action Surge restrictions
  but do not enter the spell-casting/slot-use ledger. Moonbeam becomes movable on
  later turns. Stage location, history and costs atomically; failed, canceled or
  stale movements spend nothing, and Undo cannot resurrect an ended effect.
- **Targeting geometry**: 3D five-foot grid distance, feet/center-point area inclusion,
  and terrain/instanced-structure clear-path bounds. Full creature volumes, partial
  cover, door openings and 2014 around-corner propagation require manual confirmation.
- **Active spell area**: a plain visual record in combat checkpoints, never renderer
  objects or automatic damage/conditions/creature movement/visibility. Durations tick only on
  later matching caster-token start/end turns. Concentration replacement/ending,
  manual ending and Undo synchronize the visuals. Fixed areas can outlive token
  removal; caster-following and movable source-bound areas cannot. Until-dispelled
  areas have no invented finite timer. Selection previews are never saved.
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

Campaign settings, characters and scene checkpoints use acknowledged,
revision-checked host transactions. The same campaign rules support an explicit
IndexedDB adapter for legacy migration and tests. Session-local Undo receipts and
unfinished visuals are not substituted for committed scene/combat history.

## Connected-grid map-building direction (foundation implemented)

The user has replaced the layered shared-world direction with separate grids
for buildings, floors and larger areas. The connected-map data, physical-coordinate,
persistence and targeting foundation is implemented. The visual parametric Build
palette replaces numeric construction controls; automatic outline-to-floor-grid
authoring remains separate work. Sight-gated cross-grid
character projections now render the original creature's model. Live Maps & focus
controls switch local views without transferring creatures. Physical connection
travel and parametric building assemblies are implemented; the closed-outline
builder and actual multiplayer remain further implementation chunks.

- **Campaign location**: a separately rendered physical space within a campaign.
  Optional version-3 `locations` records and per-map `locationId` distinguish
  independent spaces without invented giant offsets. Legacy maps share one
  implicit location until explicit location creation. Spatial queries, targeting,
  occupancy, projections and spell visuals remain within one location; a raw
  coordinate is not an identity shared by every location.
- **Connected grid**: an independently editable and viewable tactical area within
  one location. A building interior, another floor or a larger area can have its
  own grid. Character location belongs to the campaign world, not to whichever
  map a participant happens to be viewing.
- **Building outline**: a closed, straight-line footprint drawn on the map.
  Meeting the first endpoint completes the outline. The simplified tool starts
  with Build and a height choice, using 10-foot floor increments. It generates
  a hollow building and separate floor grids rather than filling a solid box.
  Cut/carving in the builder is undecided and deferred; curved outline editing
  and circles are later work; whole-floor removal and rectangular cutouts are
  already available for parametric structures. The separate curved-volume
  foundation and playable shape proof do not implement that closed-outline
  workflow. Parametric rectangular buildings and turrets already generate
  connected floors through the illustrated Build controls.
- **Grid connection**: a link between locations in different grids. Doorways
  and stairs use explicit Enter / Use stairs interactions, transferring only
  the acting creature. Only views following that creature switch maps;
  unrelated participants keep their current view.
- **Magical portal (planned)**: a transport-only connection represented by a
  floating circular gate or vortex, not an ordinary doorway/window opening.
  Portals do not transmit sight or targeting to the destination. Implement
  physical doors/stairs and two-floor sight validation before this later feature.
- **Spatial relationship**: the aligned position, orientation and elevation
  connecting grids within one location in physical feet. These connected grids are not disconnected
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
- **DM location browsing**: selecting or creating an independent location changes
  no actor position, character resource or player viewpoint. Empty-location
  creation is acknowledged on disk before updating the local world. Player views
  follow their active assigned character's authoritative location/area changes.
  Selected-character/party relocation commands and their active-combat policy
  remain a separate milestone; ordinary physical transfers cannot cross locations.
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

New campaigns still start single-board. Version-3 scene
checkpoints store independent maps, one campaign-wide creature collection,
shared combat state, a local default view and optional per-map camera histories;
live capture/restore,
host saves and backups preserve inactive maps and their creature poses.
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
the durable local host is not an authenticated multiplayer session server.
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

## Visual construction and biome structures (implemented)

Clipped ellipsoids, rotated cylinders and convex prisms extend the terrain owner's ordered
Add/Subtract volumes. Their faceted convex boundaries are shared by rendering,
support/ceiling queries, body clearance and physical campaign sight/flight queries.
They are not decorative meshes or staircase heightfield approximations. The
primitive's center/radii remain independent of its clipping bounds so shrinking
a board crops a shape rather than squashing it.

Editable structure records and grouped volumes use geometry version 3. Curves
without authoring records use version 2; legacy box-only version-1 geometry
and the existing campaign-scene versions remain supported. Visibility is still
presentation-only. Undo/Redo, save/reopen, stable surface IDs, physical feet,
map rotation/scale and normal movement accounting are preserved.
Gentle curved ground routes follow the physical support between grid centers.
Fall landings retain their actual position rather than snapping to a different
support height at the cell center. Walking/takeoff clearance accounts for the
supporting slope without relaxing headroom, foreign-map obstruction or step limits.

The illustrated Build palette places walls, turrets, domes, rectangular buildings,
caves and tunnels. Plain walls and battlements share one arbitrary-angle drag
workflow with ghost preview. Select / resize edits diameter, height and applicable
length/width through direct side/corner/top handles as well as numeric fields.
Handle release commits; numeric fields require Apply. Footprints snap to 5-foot
sizes, or half-foot sizes with Shift, with the opposite edge anchored.
Placement, resizing and removal are atomic
Undo/Redo actions. Changing a structure cannot trap a creature, remove its support
or grip, or break a manually linked opening. Angled wall climbing uses real
horizontal unit normals and swept-body geometry, preserving movement accounting.
General curved-wall wraparound and corner routing remain later work.

New rectangular buildings/turrets have a versioned building definition. Default
spacing is 10 feet; custom profiles support taller rooms. Roof rise is not another storey. A linked assembly
owns one finite floor map per storey, stable managed door/window/stair connections,
automatic editable windows, and manually wall-dragged balconies with deck, rails
and doorway. Flat/gabled/hipped/conical/domed/open roofs use the same physical
geometry as support, collision and sight. Convex polyhedra represent pitched roofs.
Turret apertures use the four cardinal wall directions. Stair voids and landing
clearance constrain automatic openings and balcony doors.
Optional `building.windowLayout` version 1 records residential/civic/fortress
spacing and allowed local wall sides. Version 2 adds a saved composition seed
and deterministic dimensions, sill heights, staggered arrangements, blank rows
and tall hall features. New construction/generation opts into version 2; old
version-1 recipes and saved profiles without the field keep their previous grid.
Sparse layouts cap automatic windows at two per facade/floor, and generated
castle turret sides are chosen by their physical inward normals. Manual window
definitions override the automatic pattern and remain editable on any wall.

The exterior remains the shell owner; interior maps own their slabs and stairs,
not duplicated upper floors in exterior geometry. Small interiors use the normal
minimum tactical grid dimensions with unused margins physically carved away.
Stretching preserves the interior grid lattice, manual content, physical actor
positions and per-floor cameras. A synchronous prepared geometry participant
coordinates topology with the terrain edit. Rejected edits leave both unchanged;
Undo/Redo archives managed interior maps/cameras, never HP, resources or combat.
Occupied removed floors and manual connections are protected. New assemblies
cannot be nested inside owned interior floors. Serialize topology edits against
pending scene writes so an old acknowledgement cannot replace newer floors.
Legacy shells keep their old semantics until an explicit upgrade preview/Apply.

Building profile version 3 stores stable level identifiers, explicit physical
elevations and per-level rectangular openings. New ordinary buildings still start
at 10-foot intervals. Room heights are editable in 5-foot steps with a 10-foot
minimum; changing one shifts higher levels and the roof. Removing an upper slab
preserves higher IDs/elevations. Adding a level never reuses a removed ID. The
base/lowest floor stays, and custom windows/balconies anchored to a removed floor
must be moved or removed first. Occupied moved/removed/cut floors are rejected
atomically. Manual interior geometry moves vertically with its level, while
footprint reframing retains the existing grid lattice.

Stairs are real thin-tread switchbacks with 1.25-foot risers. Repeat alternating
flights and supported intermediate landings for larger gaps; never stretch eight
steps into unsafe jumps. A battlement roof adds stable deck ID 100 at shell height,
with connected stairs and masonry parapets/merlons, not a decorative cone.
The Turret card defaults to this castle crown; Building -> Round retains roofed
round buildings. A separate Castle wall preset exposes battlements with optional
parallel, flush side stairs. Their actual run constrains minimum wall length.

Wall stairs have independent ascent direction, wall side and along-wall offset,
not an implicit dependency on the wall's rotation. Normalization validates the
full stair footprint. Automatic layouts use straight runs through 10 feet and
55-foot-long switchbacks above 10 feet, with risers up to 1.25 feet and sufficient
landing/body clearance. New stair recipe version 2 uses solid masonry flights
stepping progressively wallward, with the highest flight adjacent to the wall.
Each flight needs 7.5 feet outward; higher runs spread out rather than filling
walking space under stacked flights. Saved earlier recipes remain loadable;
explicit editing opts into version 2. Saved walls without layout metadata retain straight
geometry until explicit editing. A position handle slides the stairs; field/button
previews and release-only commits share existing guards, history and persistence.

Grid centres alone are insufficient at stacked stair turns and arbitrary wall
angles. Terrain geometry exposes bounded physical tread/landing anchor points
only for authored wall stairs. Surface navigation joins nearby anchors with the
same paid five-foot edges, step-height/body/occupancy checks and physical support.
Exact swept-body hulls replace over-conservative diagonal AABBs where necessary;
they never relax headroom or permit a free rise. Animation and saved placement
use each approved physical waypoint rather than substituting its tile centre.

Placed structures have centre move handles as well as resize handles. Whole-building
translation moves its finite floor grids, lattice, furniture, manual terrain and
saved local cameras together, including fine half-foot shifts. Footprint stretching
remains a separate grid-reframing operation. Creatures never move with an authoring
edit: editing an occupied structure is rejected until the creatures leave, whether
they are assigned to a managed floor or physically occupy the exterior shell.
Manual links must be unlinked before relocation; independently authored cellar
connections must still fit their real access. Undo restores the prior complete
assembly without reverting character resources or positions.

Cellars are separate editable/excavated structure groups. They may extend beyond
an overlying building, own finite negative-elevation floor maps and preserve the
surface except for deliberate hatches/cuts. Access may be absent, stairs or a
ladder, attached to the exterior or an explicitly chosen building ground floor.
The access hole, landing and stair run must fit their maps and prevalidate body
clearance. Ladder travel animates the real route with doubled vertical cost and
the same canonical turn, identity and save transaction. Editing stays on the
exterior; an Edit cellar selector makes buried groups selectable. Interior
cutaways use the real level ceiling, including the natural ground cap over a cellar.
Curved-mesh rendering preserves finite wall/cutaway bottoms all the way to the
displayed cellar floor. An artificial render cap applies only to unbounded earth;
its original bottom provenance survives convex clipping without entering saves.

Castle, cliffside, mountain and ruined-castle generation now adds one native
Cellar with storage and deeper dungeon levels, extending beyond its keep. Safe
placement respects the active terrain scale, map margins and other underground
structures. The optional `building.cellarLayout` version-1 recipe saves a
`castle-dungeon` style and seed. Managed floor creation uses it to build real
room walls and doorways and name the storage/dungeon areas. Existing floor
geometry is preserved rather than regenerated on load or resize; manually
authored Cellars without the recipe remain unchanged.

Generation passes an explicit authored-cellar protection context through the
building editor. Removing generated underground maps that contain edited walls,
painted terrain, furniture or custom names fails atomically. Ordinary editing,
removal and Undo retain their existing semantics. Seed-locked generation reuses
the saved floor identities and room content; stair access and internal floor
crossings use the existing paid, physically supported travel.

Show underground is a manual Terrain Mode toggle available before selection;
choosing the Cellar tool also enables it. A render-only scene adapter reveals all
cellar outlines and the selected level, with visible candidate previews and
underground resize/move handles. It clones/restores exterior materials, caches
outlines/active floor geometry, bounds large preview grids, and avoids authoritative
world-CSG work on idle frames or pointer drags. Normal rendering returns on disable,
deactivation, interior map changes and disposal. Reveal picking selects a buried
floor without changing gameplay raycasts, support, physical sight or saved state.

Structure display names are shared by map generation, editor menus and clickable
on-map labels. Selected structures retain blue outlines; a cellar's chosen
connection target has a separate gold outline/label without changing selection.
Candidate targets must contain the actual access hatch and landing inside their
inner footprint at the same elevation, rather than merely being on the same board.
Round/rotated footprints are checked physically, and unavailable previous links
remain explicit instead of silently defaulting to another building. Final topology
edits still validate real connection support, obstacles and body clearance.

Partial openings are 5-foot-snapped rectangles on a selected level plane, previewed
without rebuilding world solids and committed on release. Filling, whole-floor
removal, level heights and cellar access share compound history. Ground-floor
cutouts remove the corresponding exterior cap as well as the finite slab.
Falling through a hole transfers to the actual lower support, using the same
landing-placement helper as flight. Do not capture a stable placement in the old
map between finishing a fall route and atomically committing its new-map landing.
Ordinary shallow crossings to foreign stairs/floors still require their explicit
connection, rather than saving a pose on unsupported local terrain.

Building profile version 2 matches rectangular conical/domed roofs to the whole
footprint (pyramid or squared curved vault), while round turret bodies retain round
caps. Rectangular hipped roofs have a real ridge. Version-1 profiles keep their
stored silhouette until an explicit roof/base/feature edit opts into version 2.
The base chooser changes the whole building between rectangular and round, reusing
the existing building/turret recipes and stable structure/floor identities.
Incompatible off-centre features on a round base are rejected, not silently moved.

Selected windows and balconies have reusable edge/corner/centre gizmos. Selection
does not mutate a definition or reset its dimensions. Pointer drags use relative
plane deltas, preserve the opposite edge (or a round feature's centre), preview
without querying whole-world boolean solids, and commit only on release. Size
fields are a secondary precise control. Window dimensions can reach half a foot
and extend across storeys; sill/roof/post constraints remain authoritative.
Window dragging uses half-foot steps and Shift tenth-foot steps; balcony resizing
uses five-foot steps and Shift half-foot steps. Cancellation restores the draft.

Tall window definitions remain one authoring feature and one real facade cut.
Managed connections clip their interaction bounds to each overlapping room,
leaving all floor slabs intact. Narrow openings derive their normal from the
defined wall, not the shortest bounding-box side. Insufficient body clearance
produces an explicit denial. Wide rectangular apertures use the nearby clear
lateral position for ground/flight entry. Slab-edge holds may reference an
interior floor while the canonical actor remains outside; saved grip contacts
must reframe with their actual owner, separately from the actor's current map.

Crossings reuse physical entrance clicks and existing paid travel, climbing,
flight and falling; no radial traversal commands. A window crossing costs 5 feet
at its attachment, with actual approach/ascent charged separately. Window-drop
damage uses the actual fall from the hanging pose to the first physical support,
including balconies, rather than the height of the storey or exterior ground.
Actor-only checkpoints retain cached local map geometry. Map revisions invalidate
physical-floor/interior-wall meshes only when maps or the active terrain change;
idle frames must not repeatedly deep-copy boards or rebuild their meshes.
Point/swept clearance queries use a shared five-foot footprint broad phase for
ordered local operations, final solid fragments and foreign campaign obstacles.
Exact convex checks still decide collision; candidate indices invalidate with
terrain/geometry changes. Range-local support memoization and early visited-state
checks reduce repeated work without caching stale occupancy or turn allowances.

Structure recipes are deterministic, renderer-independent volume data shared by
manual authoring and seeded generation. Town, City and Castle/Fortress have
separate ruined variants, including Ruined Town and Ruined Castle. Settlement
ordinary foundations remain level. Towns use irregular green-side cottages, winding lanes,
gardens and local landmarks; cities use dense trade districts, alleys, a civic
hall and market. Ordinary grand castles join a high keep, residential wing,
great hall, court wings, gatehouse and northern watch around an open-sky
courtyard, retaining outer bastions and real arched access. Compact maps retain
connected halls without cramped wing stairs. Ruin openings leave stair attachment
points clear.
Castle geometry now follows a separate deterministic architecture stream:
citadel/bailey/palace compositions vary keep/wall dimensions and heights, flared
side walls, towers, supporting buildings and gatehouse presence. Locked seeds
repeat exactly; names/colours are not the only differences. Planner bounds include
actual wall rotation and stair footprints so optional buildings do not occupy
the stairs. Existing saved layouts only change on explicit generation/editing.
Rectangular building snaps use immutable, cancellable previews and matched
same-elevation floors. Commit adds ordinary subtractive openings and existing
`kind: 'opening'` connections between stable managed-floor IDs; transient
`buildingJoins` transaction context is not a saved scene/schema field. Scene v3
and buildingAssemblies v1 remain unchanged. Atomic construction Undo includes
poses, floor maps, cameras and owned joins, never historical character resources.
Preview prepares the same assembly transaction without applying it and exposes
a copied, frozen `buildingContext` for authoring only. Commit prepares again
against current actors/resources; unsafe occupied Undo rejects without resetting
positions or paid movement.
Manual snaps adopt both generated members and reject occupied/protected geometry.
Disconnecting a member restores its shared walls before independent editing.
Joined cutaways follow enabled same-level connections and union the individual
room footprints, not an enclosing box. Foreign source rendering uses the native
CSG cells rather than globally refining a large board at every construction cut.
Projected-facing updates remain visual-only and never checkpoint an actor against
the viewed map's geometry. Public render adapters use authorized
`map.floorContext` owner/member/level references, never private `map.building`.
They supply
`getBuildingFloorRenderContext(mapId)` with resolved world-foot ceiling (explicit
null for an unbounded deck), terrain thickness and floor appearance; missing
public context fails visibly rather than reading private structure definitions.
The shared `getBuildingFloorRenderContext(world, mapId)` export delegates to that
hook in public mode; native worlds retain canonical resolution of only
ceiling/thickness/floor appearance for authority projection. Public adapters read
authorized render data directly instead of invoking private scene restoration.
Do not publish `building.signature`: it contains the complete sorted authoring
definition, not an opaque hash. Ordinary castle visual signoff remains open.
Cliffside Castle and Mountain Fortress are explicit terrain-site biomes with
60-square defaults and a 20-square minimum. Full castles fit both 50- and
60-square boards; compact sites retain a keep, four towers and a complete
curtain. Cliff architecture stands on a high painted escarpment with positive
and negative elevations and an arched approach. Mountain architecture emerges
from the lower face of a painted mountain, with below-zero wards and, on larger
sites, an embedded hall. Preserve the mountain heightfield beneath below-zero
structures. Landforms use existing editable grid heights, not new shape types
or added mountain/terrace solids. Buildings, halls and supported stair exits
reuse existing construction/excavation geometry; ordinary wall stairs keep their
saved walkway exit. Revised site recipes use a distinct generated-ID namespace
on regeneration. Existing saved/manual structures and landforms are not
remodeled on load; changes require explicit generation or editing.
Per-structure appearance/names are saved; tint, material and generated-source
metadata survive convex clipping. Original procedural materials share a shader,
and façade details batch into a non-pickable, render-only mesh on terrain rebuild,
never a second collision model or an idle-frame authoring pass.
Linked floor slabs render in a merged batch, with the per-map source meshes kept
as the picking authority. Visibility masks retain construction material attributes.
Eligible natural terrain can contain connected cave/tunnel networks or sparse
intact/broken building landmarks on dry, gentle sites without changing the biome.
All five Underground biomes instead generate full-map interiors. Optional
`terrain.cavern` version-5 recipes save the seed, area kind and entrance sides.
They sculpt existing heightfield terrain: low floors and high irregular rock
ridges, using existing biome assets rather than procedural formations.
There are no new cave-wall volumes or floor-mask schema. Version-1 previews and
version-2 elevation-pillar recipes remain identifiable for explicit regeneration.
Version-2 authoring baselines are reconstructed before deciding whether an old
generated room has manual edits. The terrain geometry core remains unchanged.

Procedural stalagmite/stalactite generation and Build tools have been removed.
Prototype recipe versions 3/4 and their saved construction definitions remain
readable for save compatibility and explicit removal; they are not offered as
new construction tools. Regenerating adopts version 5 and removes generated
formations from the root and eligible automatic chambers, retaining the usual
authored-content and actor protections.
Native ground maps and `map.cavern` references identify the root and connected
side chambers. Cave passage connections retain real supported, paid movement
and separate visual areas, without copying actors or restoring old resources.
Terrain passage features reference bounded `terrainCells` instead of inventing
opening volumes. Existing volume-backed doors/windows/stairs retain their path.
The ordinary terrain renderer shows full wall relief rather than an eight-foot
cap; this pass does not create an overhead ceiling. Cave flora stays on low
floors and outside entrance corridors. Candidate filters treat those depressed
floors as dry cave terrain, not surface water. The grid follows cave floors in
normal viewing and shows all terrain tiles while editing.

Generate explicitly reconciles automatic side areas through the existing
transactional edit participant and scene capture. Same-seed areas keep
their saved content; edited/occupied areas and manual branches block destructive
regeneration. Ordinary capture/load never synthesizes missing cave areas.
Maps & focus can add a native chamber or winding tunnel on a free side, validating
map bounds, overlap, existing entrances and current occupancy before an
acknowledged scene save. The active cavern renders only its own visual area;
outdoor/manual cave shapes and building projections retain their previous paths.

Joined caves share a floor and apply all room/bore cuts after their additive
shells. Editing interleaved structure volumes preserves their CSG slots, so a
chamber edit cannot silently seal its neighbours. Masonry, roofs and rock follow biome palettes.
Generation runs only on explicit Generate, never on a palette change or load.
The Generate control displays its pending/success/error status inline, including
occupied-structure and unsupported-creature denials; it must not fail only in
the console. Generation passes a new random seed transactionally, so failed
attempts retain the prior seed and board. Only one selected biome is aria-pressed.
It preserves manual structures/ground and adopts resized generated structures as
manual. The Structures & landmarks option persists with the map. A generation
pass uses biome budgets: natural 8/220, town 16/800, city 32/1200, castle 21/1100
(structures/volumes), with finite floor-map budgets and the campaign map limit.
Flora avoids structures and paved/site feature footprints.
Generate may enlarge only a fresh empty default 25-square canvas, or an unedited
canvas already automatically sized in this session: town35, city45, castle50,
terrain castles60.
Manual edits, custom dimensions or creatures prevent automatic resizing, and
failed enlargement restores the previous scene. Existing saved maps do not adopt
new layouts or appearances merely by loading.

Previews tessellate only the small candidate shape, not the world's boolean
geometry. Coalesce pointer updates to one render-frame preview; bake authoritative
solids on commit. Preserve old low-level geometry as-is rather than attempting an
ambiguous automatic conversion to editable records.
