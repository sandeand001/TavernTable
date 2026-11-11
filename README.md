# TavernTable

A local, browser-based tabletop scene editor built with JavaScript and Three.js.
The current app includes terrain and biome tools, 3D placeables, mannequin tokens,
animated navigation, and dice rolling.

## Getting started

Open this project directory in VS Code: the directory containing this file and
[package.json](./package.json), not the surrounding workspace directory.

Requirements:

- Node.js 24.4 or newer with npm (the local host uses built-in SQLite).
- A modern browser with WebGL 2.
- Internet access for the pinned Three.js modules and the large d20's cannon-es
  physics module loaded from jsDelivr.

Verified development environment: Windows, Node.js 24.4.1 and npm 11.4.2.
Node 24.4 currently prints an experimental-feature notice for its SQLite module.

Run these commands from the project directory:

```powershell
npm ci
npm start
```

Open <http://localhost:3000>. Stop the server with `Ctrl+C`.
If port 3000 is occupied, use `npm run serve:alt1` and open
<http://localhost:3001>.

Sign in as the DM with the private key in the host's `host-access-key` file.
The terminal prints that file's location; on Windows the default is
`%LOCALAPPDATA%\TavernTable\host-access-key`. Do not send this key to players.
Players use their own invitation links instead.

There is no application build step. The Node host serves the application and
acknowledges campaign saves only after committing them to disk. Open the app
through this host rather than a static file server or an HTML file directly.
It binds to loopback only. Authenticated player sessions use the shared game
client; world actions require versioned host gameplay capabilities.
No internet endpoint or firewall rule is created automatically.

After changing code, hard-refresh the browser (`Ctrl+Shift+R`) and reopen the
saved campaign. Do not regenerate or remodel an existing board just to refresh
the client. There is no hot reload, and an open tab can retain old JavaScript
modules and cached models.

## Current state

- Rendering uses Three.js. The former PIXI renderer has been removed, but some
  compatibility helpers and old renderer-oriented test fixtures remain.
- The orbiting 3D view uses natural perspective. Tactical top-down stays
  orthographic, with parallel edges and no distance-based foreshortening.
- OBJ/FBX model loading and instanced placeables are wired into the 3D scene.
- Automatic biome flora uses concrete model-backed plants, not virtual family
  menu entries. Instance-group creation is shared per model and invalidated
  when a map is cleared or regenerated.
- Token navigation is animation-based and currently click-only. Cliff traversal
  retains aligned climbing/recovery and contact-timed landings. Rolls require
  enough flat landing space and room within the approved route. Remaining movement follow-ups are in
  [TODO.md](./TODO.md).
- The creature palette includes Mannequin, Knight, Mutant, Female Archer,
  Armored Knight and Zombie, using one shared humanoid animation and movement pipeline.
  The picker grows with the roster; shorter windows use the sidebar scrollbar.
- Click a creature to select it and open its radial menu; right-click also works.
  Menus retain emotes, add eight visual-only **Actions**, and open an in-app
  tabbed character sheet. Other planned commands share a
  disabled placeholder.
- The single large d20 uses rigid-body physics and reads its actual resting face.
  Other dice types and multiple-die rolls retain their existing behavior.
- **Roll Dice** and the right-side **Menu** each collapse with their header button.
  Only small tabs remain; click them to reopen. Collapse both for a full-width map.
  These choices are remembered in this browser, and opening a Compendium entry
  automatically reopens the sidebar.
- Campaign identity, save/retry status, **Campaigns**, **Players & sharing**,
  **Sign out**, and **JSON backups** are under **Settings > Campaign & session**.
  Only the DM's compact **Maps & focus** control remains over the map.
- The terrain-engine migration is **partially implemented**.
  [TerrainEngine](./src/terrain/TerrainEngine.js) exists, but the live
  [TerrainCoordinator](./src/coordinators/TerrainCoordinator.js) still owns a
  separate height store. Do not treat the accepted
  [terrain design](./docs/adr/ADR-0001-terrain-engine-event-seam.md) as completed.
- Campaign autosave restores the DM's committed scene and characters from the
  local host. The interactive player client reuses the native renderer and
  receives an authorized public projection, never a private scene restore.
  Combined-host/external-Chrome multiplayer acceptance and desktop packaging
  remain separate verification milestones.

## Interactive player contract

Player invitations preserve their private fragment while opening the normal
game entry. The authenticated session determines the role; URL flags do not.
The client requires `publicScene.version === 1` and requests
`playerState({ presentationVersion: 1, ... })`. Missing or invalid public
geometry, models or capabilities fail visibly instead of falling back to the
old marker viewer, fake NPC records or client-local gameplay.

- Native terrain, materials, saved flora placements, models and tactical
  portraits are hydrated separately from host-filtered actor poses.
  `assetKey` caches authorized location assets, not actor movement or budgets.
- Commands use the flat versioned `tokenId`/`view` envelope with acknowledged
  scene/character revisions and a fresh command ID. Only intent is sent.
  Accepted results include `applied`, a minimal receipt and fresh authorized
  state. Uncertain submissions retain the same ID for retry; duplicates never
  replay movement or dice.
- Completed approved movement is presentation-only. A newer revision cancels
  obsolete visual replay; this is not host in-flight retarget or cancellation.
  Actor/model identity and independent cameras survive ordinary refreshes.
  DM and player moves publish their actual map-local waypoints for authorized
  receiving clients to animate. Foreign movement never includes private budgets.
  Busy-only animation notifications do not create another canonical save.
- The host simulates physical D20s. Player dice display the original gold GLB
  with its verified geometry key and actual recorded positions/quaternions.
  No client face, forced orientation or substitute D20 result is submitted.
  Cocked results require an explicit new user roll.
- The DM starts/advances turns; players may end only their advertised active
  turn. Existing trusted self HP, speed and resource edits remain available
  through assigned-record commits. These allowances are not anti-cheat.
  Ending combat enables assigned-player free movement without an active turn.
  Each free move uses the existing free-play allowance, not a spent combat budget.
- Players reach DM arrival grants from their assigned roster. Actorless
  previews show only authorized terrain and create no observer, sprite or
  budget. Unknown unplaced records require a canonical **Next sprite** choice.
  These choices are UI-local, not a new saved preference. Placement/retrieval
  obey host capabilities and combat restrictions.
- Clean saved idle DM views can reconcile accepted canonical updates at a safe
  checkpoint. Dirty/pending work pauses with an explicit conflict. It is not
  silently rebased or saved over accepted player actions. Explicit discard
  confirms the local generation before refetching a fresh canonical base.
  Initial live notices wait for the first saved checkpoint so restoring the
  board and its initial save are not mistaken for a conflicting DM draft.

Per-kind eligibility and public floor/join metadata must match the authority
and construction producers. Fixture and isolated HTTP tests are not a claim
that a live deployment or external-Chrome multiplayer QA has completed.

## Durable campaign storage

Normal startup requires the local host. The picker displays the actual data
directory, and **Saved to host** means the server acknowledged a committed disk
transaction, not a write to a temporary browser profile.

- Windows default: `%LOCALAPPDATA%\TavernTable\campaigns.sqlite`.
- Other systems: `$XDG_DATA_HOME/TavernTable/campaigns.sqlite`, or
  `~/.local/share/TavernTable/campaigns.sqlite` when that variable is unset.
- Override the directory with `TAVERNTABLE_DATA_DIR` or
  `node tools/local-host.js --port 3000 --data-dir "C:\CampaignData"`.
  Data must remain outside the served project directory.

Chrome, Edge and VS Code use the same host campaigns even if their browser
profiles or local ports differ, provided the host processes use the same data
directory. Bundled catalog caches remain browser-local and can be reinstalled.
Browser/editor restarts do not remove acknowledged host saves. A missing,
unwritable or disconnected host reports an error instead of silently switching
campaigns back to IndexedDB. After a host restart, reload the page to reconnect.

Existing browser-only campaigns are not erased or automatically overwritten:
the picker offers **Copy to host** for each one visible in that browser profile.
This validates a complete backup and creates a separate host campaign. Campaign
**Export** remains the portable, independent backup mechanism. Stop the host
before copying its data directory for a consistent whole-database backup; retain
the directory's SQLite companion files if they are present.

The host uses the same edition/source validation, atomic character-and-scene
transactions and stale-write checks as browser storage. Two tabs cannot silently
overwrite newer campaign revisions; reopen a stale campaign before continuing.
The host bounds each JSON request to 64 MiB in addition to the existing scene,
character and backup limits; oversized requests fail explicitly.
Authenticated sessions enforce DM/player access. Players use the same game
renderer and controls, with assigned-sheet access and host-authorized gameplay
commands rather than unrestricted scene writes or local combat authority.

Application source under `src/` is explicitly ES modules so Node can reuse the
browser's campaign validation. Existing tooling outside `src/` remains CommonJS.

Assistant-created VS Code browser tabs can have in-memory agent storage even
when the ordinary browser setting is persistent. Flushing IndexedDB does not
make such a profile survive an editor restart. Browser-only mode is now an
explicit programmatic test/migration option (`storage: 'browser'`), not normal
startup's fallback. Previously lost in-memory campaigns cannot be reconstructed
by switching storage modes.

## Automatic JSON backups

The host snapshots changed campaigns every **five minutes**, keeping the latest
**20 snapshots per campaign** under `backups/<campaign-id>/` in its data directory.
Only complete, committed campaign data is copied. Unchanged campaigns do not
continually create duplicate scheduled snapshots.

Use **JSON backups** in the campaign picker or above an open board to:

- **Back up now**: flush the current campaign's acknowledged changes, then write
  an independent JSON snapshot.
- **Download JSON**: download a selected snapshot.
- **Restore as copy**: validate and import a snapshot into a separate campaign.
  The current campaign is never overwritten, and the restored copy starts
  private with no invitations or published maps.

Snapshots include saved characters, source pins, layouts, resources, terrain,
creatures and committed combat/history. They do not include bundled catalogs,
host credentials, player invitation secrets or access assignments. Those access
records are durable separately in `access.sqlite`; the host key is a separate
private file. Protect the entire host data directory when making a whole-host
backup, and stop the host before copying its SQLite files.

The primary SQLite save and a JSON snapshot are separate acknowledgments.
**Saved to host** remains true for an acknowledged primary save if a later JSON
backup fails. The board's JSON-backup indicator and backup dialog report that
failure explicitly; they do not falsely roll back character costs or pretend a
failed backup succeeded. A host shutdown attempts to flush pending snapshots,
but an abrupt power/process loss can leave JSON history up to one interval old.

## Initial local multiplayer sessions

1. Sign in as the DM and open a campaign.
2. Create or load saved characters normally; characters do not need to be
   recreated when players reconnect.
3. Open **Players & sharing** above the board. Create a private invitation for
   each player and assign their existing saved characters.
4. Place each assigned character in its location. Its connected rooms/floors
   become accessible automatically; there is no separate per-area publication
   step. Other independent locations and unassigned characters' private records
   are not sent as part of that location view.
5. Open each player's private link in another browser/profile or private window.
   The same browser profile shares its sign-in across tabs, so use separate
   profiles to test distinct people.

Players can open and edit only assigned saved sheets, including manual stats,
HP, notes and equipment. Reusable invitations reconnect to the same player and
character IDs. Reissuing/revoking a link invalidates old links and sessions.
Assignments, invitations and map publication survive host restarts; browser
sign-ins are intentionally renewed after a restart. Sign out before deliberately
switching identities in the same browser profile.

Player invitation links open the normal game page with its native terrain,
materials, saved flora, animated creature models, tactical tokens, dice panel,
camera controls, collapsible panels and assigned-character roster. DM authoring
and private records remain restricted. A player's camera, sheet selection or
area browsing never changes the active sight origin or another viewer's camera.
The client requires `publicScene.version === 1` and advertised gameplay
capabilities; an older host fails explicitly instead of falling back to a
marker viewer or pretending a local action succeeded.

Public location assets exclude canonical characters, combat state, DM notes and
the DM camera. Cached asset keys keep actor/budget updates from regenerating
saved flora. Accepted movement uses host-approved routes and budgets; retries
reuse the same command ID and duplicate receipts never animate or spend again.
**End Combat / Free Play** enables assigned-player movement without an active
turn. Each completed free-play journey refreshes its per-move allowance; combat
still requires the assigned actor's active turn and preserves spent movement.
Committed routes replay on receiving DM/player models using their locomotion
variants, including Walk/Run, rather than jumping directly to the destination.
DM saves carry their actual safe waypoints separately from the scene checkpoint;
replay never spends another movement budget or changes another viewer's camera.
Compatible queued moves retain a continuous route and animation phase. A changed
map or newer non-movement checkpoint replaces obsolete presentation; loading a
checkpoint does not replay old routes. Hidden origins/waypoints and unassigned
actors' private movement budgets are not transmitted.
Routine refetches wait for an acknowledged visual movement checkpoint.
Ending access removes world sightings and closes character data.

Use **Settings > Active character** to choose one of the
server-authorized, assigned creatures. This uses the actual
creature token ID, not a temporary sheet token. Opening another saved sheet or
browsing a different internal area does not change the active sight origin.
Selecting an assigned character in another location switches to that location.
Visibility is never combined across all assigned characters.

The server returns the allowed viewpoints and selected observer with each
update. Removing an assignment or publication refreshes those options; a
forbidden area first requests the selected character's current location; a
revoked character selection requests a new authorized default. With no placed,
assigned observer, sheets remain editable but no location geometry or creature
sightings are shown.
Old sightings are cleared while changing viewpoints, and outdated in-flight
responses cannot restore them. Authorized tactical markers draw over visual
roofs/floors so camera occlusion is not mistaken for character line of sight.

Gameplay remains capability-gated:

- Movement and other world actions are enabled only when the host advertises and
  validates the matching command. Unsupported actions explain their availability;
  there is no client-local movement, turn or resource fallback. Players cannot
  submit arbitrary scene saves.
- World conditions, flight protection and concentration still require DM
  adjudication. Manual assigned-sheet editing is not a replacement for validated
  gameplay commands.
- Terrain, decorative placeables and creature animations reuse the production
  game systems. Shared rolls, action effects, flight and spell visuals require
  their own authoritative protocol slices; a client physical d20 face is not
  accepted as proof of a gameplay result.
- An accessible internal area shares its rendered terrain in full; this is not
  fog-of-war or a promise to hide secret regions within that area. DM area gates
  and interactive door/window locks remain planned work.
- Live updates use authenticated same-origin event notifications and HTTP
  commands in the existing Node host. This avoids introducing a second state
  owner/framework during the first slice. Conflicting writes are rejected, not
  silently merged; finish an in-progress action/save or resolve its conflict
  before retrying. An idle, saved DM client reconciles accepted player updates
  without resetting its camera, loaded actor identities or sheet drafts; its next
  autosave preserves the accepted canonical actor positions.

### Independent locations and connected areas

A **location** is a separate physical/rendered space, such as a village or a
dungeon. Its aligned rooms, floors and cellars are **connected areas**, not
independently published worlds. Different locations can reuse local coordinates
without sharing sight, targeting, collision, support, flight or falling.

In **Maps & focus**, use **Create empty location** to save a new independent
location with an empty main area. **Location** selects the DM's browsing space;
**Map** selects an area inside it. These controls do not move or recreate
characters and do not move other viewers. The explicit selected-character/party
transfer workflow remains capability-gated.

The player's **Current location** and **Area** options derive from the active
assigned creature. Internal areas need no additional publication checkbox.
The view follows authoritative changes to that creature's map; switching the
DM's own browsing location does not affect it.

Existing single-board and connected-map saves load as one implicit location,
without rewriting their physical coordinates. Explicit locations use an
optional `locations` collection and per-map `locationId` in version-3 scenes;
new generated floors inherit their exterior's location. Saves, JSON snapshots
and imports preserve this grouping. Physical doorway/stair links cannot connect
independent locations; cross-location movement needs an explicit DM relocation,
not an enormous coordinate offset or an ordinary physical transfer.

### Secure internet hosting setup

Local testing does not publish the game to the internet. To prepare a trusted
HTTPS tunnel/reverse proxy, configure its exact public origin:

```powershell
node tools/local-host.js --port 3000 --public-origin https://table.example.com
```

`TAVERNTABLE_PUBLIC_ORIGIN` provides the same setting. The proxy must preserve the
public Host header and set `X-Forwarded-Proto: https`; proxy requests without the
configured HTTPS origin are rejected. The actual Node listener stays bound to
loopback. Player cookies are HttpOnly/SameSite and Secure for the public origin;
host administration sign-in is allowed only directly on the host computer.
Private invitation secrets use URL fragments and are removed from the address
after joining, not sent as query strings in ordinary HTTP logs.

Provisioning a domain, trusted tunnel/proxy and end-to-end remote validation is
still a deployment task. Do not expose the raw HTTP listener by port forwarding
or assume that setting the origin alone provisions TLS or creates a tunnel.

## Graphics driver and fallback

Rendering requests a high-performance WebGL 2 GPU context first, rejecting major
performance caveats. If that request cannot be satisfied, the same input canvas
tries a relaxed WebGL 2 context so software rendering can remain a fallback.
Software fallback produces a visible warning rather than being reported as GPU
rendering. If WebGL 2 is completely unavailable, the existing fallback input
surface remains available.

**Settings > Graphics driver** shows the active adapter and whether it is GPU,
software fallback, or unverified because the browser hides adapter information.
The debug frame overlay also reports the rendering mode. These are runtime
diagnostics, not saved campaign settings. Context loss marks graphics unavailable
while the browser attempts recovery; restoration rechecks the actual adapter.

Enable graphics acceleration in Chrome and prefer the dedicated GPU in Windows
Graphics settings when needed. The application's high-performance preference
cannot override a browser or embedded host that forces software rendering.
For VS Code on Windows, a changed per-application Graphics preference requires a
full VS Code restart, not merely a page refresh. Verify **Graphics driver** after
restarting rather than assuming that a high-performance setting guarantees GPU use.
Microsoft Basic Render Driver, WARP, SwiftShader and llvmpipe indicate software,
not the installed NVIDIA/AMD/Intel GPU. Hardware rendering does not move terrain
editing, rules, animation control or persistence work off the CPU.

Wait for campaign autosave to report **Saved** before restarting a browser or
host. Host-backed campaigns are shared across browsers using the same host data
directory. Legacy browser-only campaigns remain profile-specific until explicitly
copied to host storage.

## Camera views

In **Settings**, enable **Top-Down View** for an orthographic tactical map.
Disable it to return to natural 3D perspective: nearby edges appear larger than
distant edges rather than looking like an ambiguous parallel projection.

Hold the **right mouse button and drag** over the map to rotate and tilt it.
Hold **Space + left mouse button and drag** to grab and pan the map in either
view. The cursor changes to a hand; release Space or the mouse to stop. Panning
does not move creatures, change their facing, or paint terrain. Space shortcuts
also work in **Terrain Mode**, including after using terrain/build controls.
A canvas drag can claim an already-held Space key and returns keyboard focus to
the map. Unfinished brush strokes and construction drags are canceled without
changing the selected tool; releasing Space restores the editing cursor.
Typing and normal control activation still work until you grab the map.
Controls remain attached when the 3D renderer recovers from a fallback surface.

Switching views preserves the current focus and zoom, and returning to 3D
restores the previous orbit angle. Top-down pitch stays locked while rotating.
Mouse-wheel zoom remains anchored to the ground beneath the cursor. Camera
changes do not rescale terrain heights or token movement.

At a camera pitch of **80 degrees or higher**, creatures and characters switch
to circular tactical tokens, whether you use the top-down toggle or rotate
overhead manually. Tokens show their name and, when supplied, their portrait.
Tilting below **78 degrees** restores the original models; this small buffer
prevents flickering near the switch point. Selection and hover highlight the
token's rim. Movement, facing, character links and combat state are unchanged.

On the DM's connected-map overview, tactical markers show creatures on the
displayed map and directly above/below its physical footprint, including through
roofs and floors. Interior views do not show unrelated structures elsewhere in
the campaign. Name labels identify the owning structure and floor/level;
overlapping markers are offset with leader lines to their true positions.
Choose **Focus** beside a marker to open that creature's actual map and center
the camera on it. This changes presentation only, not creature positions, map
ownership or movement.

The multiplayer publication API filters creature data using the **active assigned
character's physical line of sight**, not the player's camera or combined party
vision. Solid terrain, walls, floors and roofs block sight; physical openings can
permit it. Captured opaque tree/rock bounds also block sight, but leaf canopies
are not treated as solid boxes. For older maps with these assets, the DM must
reopen and save each map to capture its sight blockers before publishing.
This first pass does not add terrain fog of war, darkness, invisibility or
special senses. The active-character selector is wired into the authenticated
player viewer; extended vision and exploration effects remain in the backlog.

## Terrain editing and walls

Open **Terrain** and enable **Terrain Mode**. Elevation colors are an editing
aid only: turning the mode off restores the normal grid color or the selected
biome palette while keeping the edited heights.

Raise, Lower and Wall now preview the complete gesture without changing
gameplay heights. Release on the board to commit it as one edit. Escape, losing
focus, leaving the canvas, changing tools or brush size, or turning Terrain Mode
off discards the unfinished preview. Wall height and Filled/Outline settings can
be adjusted while a wall preview is open without applying it.

**Undo** and **Redo** are in **Edit History**. **Ctrl+Z** undoes;
**Ctrl+Shift+Z** or **Ctrl+Y** redoes (Command works instead of Ctrl on macOS).
Shortcuts are active only while editing terrain and do not replace text-field
undo. One undo restores a complete gesture, including overlapping brush cells.
Reset Terrain is also undoable. History keeps the last **100 terrain height
edits** for the current session; loading, resizing or generating a map starts a
new history. Placeable removal is not part of terrain height history.

Campaign autosave stores committed terrain, not previews or undo stacks.
Existing version-1 campaign scenes and older unversioned terrain snapshots remain
compatible. Terrain state, tool selection, biome metadata and height queries now
share one owner, following [ADR-0001](./docs/adr/ADR-0001-terrain-engine-event-seam.md).
That foundation also owns the visual structure builder below.

### Connected-map building

The image-based **Build** palette places and edits physical structures on the
current map. New rectangular buildings and turrets generate separate connected
interior grids every 10 feet, with stairs, windows and a selectable roof. Doorways and
stairs require Enter / Use stairs interactions. Each participant keeps their
own character focus, map and camera; the DM can focus characters across maps.
Cross-grid sight, attacks, flight and falling use their physical geometry.
Free-form carving and the closed-outline footprint tool remain deferred. See
[domain context](./CONTEXT.md) and [the backlog](./TODO.md).

The first connected-map foundation is implemented behind the existing workflow:
version-3 campaign checkpoints preserve independent map records and one creature
collection, physical-coordinate transforms, inactive map poses and shared combat.
Existing version-1/2 campaigns remain valid and are not automatically converted on load.
Explicit migration also preserves existing spell-area sizes and positions.
Cross-grid targeting accounts for finite floors, walls, openings and saved
structure cover without loading another map's character sprites; spell previews
transform back into the displayed grid. Independent local view objects keep
focus and camera histories separate.

Visible off-map creatures now render as synchronized projections of the same
creature, with translated position, elevation, facing and animation. Picking
resolves to the original ID. The focused character's current sight checks gate
visibility, including walls, floors, Blinded and invisible; ordinary camera
occlusion still applies. Projections do not add another gameplay token.
Movement occupancy likewise uses physical translations and body elevations,
not the foreign map's raw cell numbers, so interior creatures do not create
phantom blocked squares outside.

Visible projections also bring a bounded strip of supporting terrain along their
line of sight, using the source map's real ground and floor heights. The creature's
own supporting surface remains visible at narrow window edges. This is render-only
context, not an extra editable grid or a new movement path, and it disappears when
the focused character loses sight of the creature.

Interior floor views also show a roofless cutaway of their physical walls,
including the real window and doorway openings. Shared exterior structures are
projected into the interior grid, and higher floors/roof layers do not cover the
current room. The wall layout remains visible while browsing without character
focus. This is a read-only view, not a second editable copy: exterior roofs and
the physical geometry used by sight rules remain intact.

#### Doorways and stairs

Connected scenes can now contain saved physical doorway and stair connections.
Select a creature, then **left-click the actual opening or staircase**. From more
than five feet away, the creature walks toward the entrance using normal pathing,
up to its remaining movement. If it cannot reach the entrance, it stops at the
closest reachable point. If it reaches the entrance but cannot afford the
remaining route, it stops without offering traversal.

Otherwise, a small popup asks for confirmation, with the cost on **Enter** /
**Use stairs** and a **Cancel** button. Nearby clicks open this popup
directly. There is no radial-menu travel action, automatic transfer, or turn
refresh. The approach is charged as ordinary walking; cancelling the offer never
refunds movement already walked. Escape, another destination or another creature
selection cancels a pending offer.
Outside combat, the existing allowance refresh after each completed walking move
is unchanged.

Normal movement handles approach obstacles, occupancy, elevation and prone costs.
Blocked openings, occupied landings and unfinished actions still show their
unavailability reasons. Confirmation rechecks the current route and allowance.
Sprite clicks, camera gestures and spell targeting keep their existing behavior.

Travel keeps the same creature and character, resources, active turn and movement
ledger. A confirmed crossing follows the locally selected sprite as well as an
explicitly focused creature; opening its character sheet is not required.
Other independently watching views stay put. The destination and paid
movement are saved together; a failed load or save restores the source and refunds
the reservation. Stair openings viewed from above show the actual lower treads as
read-only context. Upper-window sight samples a creature's centre and head, while
solid floors, walls and roofs still block it.

The [two-floor development example](./src/campaigns/examples/ConnectedTravelExample.js)
provides an exterior, two interior grids, windows, a five-foot doorway route and
a twenty-foot staircase with normal grid-aligned landings. Connections reference
existing physical opening/stair geometry; arbitrary existing holes do not
automatically become transfers. Connection authoring belongs to the planned
builder.

#### Flight, windows, balconies and falls

The same click-to-confirm interaction supports flying through doors, windows and
wall openings. An **already-airborne** creature flies toward a body-fitting entry
height, paying for both elevation changes and horizontal approach, then receives
**Fly through** if enough movement remains. Confirmation preserves physical
altitude, flight, the canonical creature and its active turn. It does not grant
automatic takeoff or cross a boundary without confirmation.
Ordinary ground and balcony clicks also work while airborne: they retain
altitude above lower surfaces, while higher surface/wall destinations pay for
the required vertical alignment. A creature with flying speed can Take flight
directly from a physical wall hold instead of first returning to ground.

Nonflying creatures can **Climb in** and **Climb out** through configured windows
and climbable bare wall openings. Stand up before climbing, as with ordinary
wall climbing. Climbing costs two feet of movement per foot,
with route totals rounded up to five feet. The window crossing itself costs
**5 feet in either direction** when already at the opening. Any approach or
ascent to reach it is charged separately; the animation's hoist/settling arc is
not additional movement. A low opening can end on nearby
support; an unsupported high exit ends in a saved, physically attached hold.
An opening click offers crossing only: **Enter/Exit**. It does not own all
future control of the creature.

- Click solid wall to choose a handhold and climb to that point. Actual wall-climb/down
  clips play through intermediate positions; long climbs stop at paid safe
  holds and can continue on later turns.
- While held, click ground or a supported platform for **Climb down/onto surface**
  or **Drop**. After reaching the ground, any remaining approach uses ordinary
  movement. A new wall or ground destination can redirect the current climb at
  its next safe checkpoint, without resetting movement or revisiting a window.
- Same-wall lateral routes currently reuse the available climbing clips; dedicated
  sideways animations and general corner traversal remain future work.
- Window gaps are not imaginary handholds. A downward route can explicitly
  confirm **drop and re-grab**, using the first reachable real wall below.
  The unsupported distance costs no movement and uses normal falling damage and
  protections at the catch, but does not make an attached creature Prone.
  Damage uses only the unsupported distance before each catch, not height above
  ground. A five-foot gap causes no falling damage even high on a building.
  Prompts keep only the action confirmation and movement/error feedback, without
  explanatory falling-rule paragraphs.
  Upward/sideways gaps still require a supported route.

Stable grips reference physical geometry, not an original window, and survive
save/reopen and map-focus changes. A following view switches to the destination
before window entry/exit plays the existing climb/recovery animation (reversed
for exiting). Movement and saving stay locked until the supported landing or
exterior hold is reached. The final placement and cost are saved together;
animation/load/save failure restores the source and refunds the reservation.
Other independently watching views are not forced to switch.
Up/down climbing keeps its authored animation phase across paid waypoints and
held-pose resumption instead of restarting the clip at every checkpoint.

**Drop** from a hold costs no movement and animates the actual fall. Shared falling rules
handle damage, Prone, Feather Fall, Slow Fall and other protections; deliberate
release does not use flying speed itself to cancel the fall. Existing flight
**Drop** uses that same pipeline. Falls through upper-floor holes find real
support on lower maps, committing the landing and damage together. A failed
landing save stays unresolved and offers Retry without rolling or damaging twice.

Balconies are clickable elevated slabs with physical railings, not cosmetic
attachments. Existing surface navigation handles walking on them; valid wall
routes can climb to them across turns and clear real railings before landing.
Unsupported overhangs are not climbable air. An unrailed edge can lead to a real
fall. Floors, walls and roofs still block flight and sight even when hidden by
an interior cutaway. Exterior views render real interior floor slabs even when
no creature is visible inside, so window views do not show an empty shell.

The [three-floor opening example](./src/campaigns/examples/ConnectedOpeningsExample.js)
adds low and high windows, a bare ground arch, an elevated wall opening and a
balcony with a deliberate unrailed test gap. Connections reference the actual
subtractive aperture; climbable windows also identify their exterior map.
Arbitrary holes do not automatically become traversal links. No travel actions
were added to the radial menu, and magical portals remain separate later work.

#### Maps & focus

Connected-map campaigns show a compact **Maps & focus** tab for the DM only:

- **Map** browses a different grid without moving any creatures and clears
  viewing focus.
- **Focus creature** switches to that creature's actual map and centers it.
  **No focus - browse map** leaves the current map open without creature focus.
- **Center focused creature** recenters the camera without reloading terrain.

Each map remembers its camera framing, including across campaign reopening.
Browsing or focusing preserves creature identities, positions, character resources,
movement spent, the active turn and shared roll history. Opening a character sheet
or activating its tab explicitly focuses the creature's actual map and position,
not its mirrored model. This also applies to keyboard tabs and pop-out sheets.
Tab activation selects that sprite and refreshes turn/action availability as
soon as the view is ready; another sprite click is not needed to use End Turn.
Passive map selection and targeting do not change viewing focus or another local
view.

Controls wait for complete scene changes and reject switching during movement,
pending actions or unfinished terrain gestures. Failed switches restore the
previous view; partial map loads are never autosaved. Legacy version-1/2
single-board campaigns keep their existing workflow and hide these controls.
Focus changes wait for an in-flight character save. An invalid source checkpoint
reports its save problem and releases the view controls instead of waiting
indefinitely with a paused scene.

The outline builder, magical portals and authenticated networked participants
remain subsequent chunks. Changing the viewed map is not a creature transfer.

#### Visual structure builder

Open **Terrain Mode → Build**. Illustrated cards select **Wall**, **Turret**,
**Dome**, **Building**, **Cave**, **Tunnel**, **Castle wall** or **Cellar**. This replaces the numeric
Add/Carve/proof panel and consolidates the old Wall button into the same workflow;
Raise/Lower sculpting and flora controls remain.

- Drag a wall or tunnel to choose its length and direction, including diagonals.
  A translucent ghost and a length readout preview the placement; release commits.
  **Escape** cancels without changing physical geometry.
- Walls offer **Plain wall** or **Battlements**, plus an optional door opening.
- **Castle wall** is the direct battlement preset, including optional **Parallel
  wall stairs** sitting flush along one side. Drag its length normally. Stairs
  need enough wall length for their actual run; disabling the stairs permits
  shorter walls.
- Select a wall to **Flip ascent direction**, **Swap wall side**, or edit
  **Stair position along wall** without rotating the wall itself. The blue stair
  handle also slides the stairs along the wall. Button/field changes preview
  until **Apply size**; handle drags commit on release. Stair movement uses
  5-foot steps, or half-foot steps with **Shift**, and stays within the wall.
- **Automatic** stair layout uses straight stairs up to 10 feet and compact
  switchbacks above that. Solid masonry flights ascend progressively toward the
  wall, with the highest flight nearest it—not floating treads above a lower run.
  Switchbacks need 55 feet along the wall and 7.5 feet outward per flight
  (15 feet outward for a 20-foot wall, 45 feet for a 60-foot wall), with risers up
  to 1.25 feet and wide turn landings.
  **Straight** remains available explicitly. Existing saved straight stairs keep
  their geometry until edited; choose **Automatic → Apply size** to update one.
- **Turret** places a castle-style crenellated tower, with a walkable battlement
  deck and stairs to it. For a roofed round building, use **Building → Round** and
  select its roof. Existing conical turrets keep their saved roof; select
  **Battlements → Apply size** to change one.
- **Ruined** gives built shapes broken crowns and breaches, including manually
  placed forest/desert ruins.
- Click to place round structures or buildings. **Rotate 90°** changes entrance
  direction before placement.
- **Building base** offers **Square / rectangular** and **Round** footprints.
  Round uses the turret body and diameter controls. Existing buildings can preview
  a base change and commit it with **Apply size**; occupied or incompatible edits
  are rejected without relocating creatures or discarding interior work.
- Choose **Select / resize**, then click a built structure. Domes and turrets have
  diameter handles; rectangular structures have side/corner handles. Drag to
  stretch with the opposite edge anchored. Footprints snap in 5-foot increments;
  hold **Shift** for half-foot sizing. Drag the top handle for height.
  New buildings start with 10-foot storeys; custom room heights are supported below.
  Handle drags commit on release,
  not during the preview. Numeric fields remain available with **Apply size** /
  **Cancel**; canceled gestures never become later edits.
- The **centre handle moves a placed building or structure**. It uses 5-foot
  movement, or half-foot movement with **Shift**, and commits on release.
  Building floors, stairs, interior terrain/furniture and saved room views move
  with it; independent cellars stay where they were authored. Existing connections
  must still physically fit, or be unlinked before moving.
- Rectangular buildings can share real interiors. Bring a building within
  **10 feet** of another compatible face, select it, choose **Connect interiors
  to**, then **Preview connected interiors -> Apply size**. Matching floor
  elevations gain a supported opening through both walls; a face needs at least
  10 feet of overlap. **Cancel** changes no saved geometry, rooms or connections.
  The preview compiles both member floors and their opening topology. Apply
  revalidates current occupancy/resources rather than replaying preview state.
  Occupied floors and unrelated protected construction reject the edit.
- A connection is one Undo/Redo edit, including both poses, floor maps and
  openings. Reopening retains the member-floor identities. Normal walking and
  member-floor crossing use the actual movement allowance, not free teleporting.
  Joined interior cutaways show the connected room footprints, not the empty
  corners of a large bounding box; each room keeps its own ceiling limit.
  An unsafe occupied Undo is rejected without
  moving the creature or restoring old resources.
- Use **Disconnect interiors for editing** before moving or reshaping a linked
  member independently. Its shared walls close without moving the building;
  Undo restores the connection. Whole-compound rigid movement is not a separate
  tool. Manual snapping adopts both generated members so later regeneration
  preserves the authored connection.
- Each new building/turret storey owns a finite, separately editable floor grid.
  A 30-foot building has floors at 0, 10 and 20 feet; roof rise is separate.
  Automatic switchback stairs link successive floors. Use **Maps & focus** to
  inspect a floor without moving a creature, or click the actual entrance/stairs
  to travel normally.
- **Floors and room height** edits individual levels. Choose a **Level**, enter
  its height in 5-foot steps (minimum 10 feet), then **Preview height → Apply size**.
  Higher levels and the roof move together. Interior terrain/objects move with
  their floor; occupied levels must be vacated before raising or lowering them.
- **Remove whole floor → Apply size** removes an upper slab without lowering the
  floors above it, creating a taller open room. The base floor remains. Move or
  remove custom windows/balconies anchored to that floor first.
- **Draw floor opening** highlights the selected floor plane. Click-drag one or
  more 5-foot-snapped rectangles; release commits the cut, and **Escape** cancels.
  **Fill selected opening** closes a cut again. Openings are physical: walking or
  falling through one lands on the actual support below, with normal fall rules.
  An opening in the ground floor can open the surface cap into a cellar below.
- **Add level** previews another upper floor, or a deeper cellar floor. Use
  **Apply size** to commit. Height/removal/cut edits share compound Undo/Redo.
- Choose an illustrated **Flat**, **Gabled**, **Hipped**, **Conical**, **Domed** or
  **Open / none** roof, or a **Battlements** deck. Roofs are physical geometry, not decoration; movement
  follows the existing slope, step and clearance rules. New rectangular conical
  roofs use a pyramidal profile and rectangular domes use a squared curved vault,
  covering the footprint corners. Round bases retain true round cones/domes.
- Windows are automatic and editable. Select the building, choose **Window** and
  a feature floor, then click a wall to add one or an existing window to select it.
  Blue edge/corner handles change width and height; the centre handle moves it
  along the wall or adjusts its sill. Window sizing snaps to half a foot, or a
  tenth of a foot with **Shift**. Precise width/height/sill fields are also
  available with **Apply feature size**. Merely selecting a feature changes nothing.
- Windows can be small openings or span several storeys. Existing floor slabs
  remain intact. Each reached storey has its own correctly clipped interaction;
  upper exits can grip the real floor edge. Wide rectangular windows can be
  crossed at the nearby clear portion rather than forcing a return to the centre.
  Small openings retain real sight/collision geometry, but cannot be traversed
  when the creature lacks clearance. **Remove feature** deletes the selected
  window; the floor selector and **Apply size** can move it to another floor.
- Balconies are manual: choose **Balcony**, select an upper floor, click its wall
  and drag sideways/outwards for width/depth. Release adds a real deck, railing
  and connected doorway. Click an existing deck, railing or doorway to select it;
  blue deck handles resize width/depth after placement. The centre moves it along
  its wall. Balcony sizing uses 5-foot steps, or half-foot steps with **Shift**,
  with numeric fields for precise changes. They use the existing walking, flight
  and falling rules.
- Placement, resizing and removal each share the normal one-edit Undo/Redo history.
  Building edits include their floor maps/connections in that transaction.
  Existing interior edits survive stretching. Creatures always keep their world
  positions: an occupied structure cannot be moved or otherwise edited until its
  creatures leave.
  Undo restores removed interior data without restoring old HP or turn resources.
  Edits that trap creatures, remove occupied floors/support/grips, or break manual
  connections are rejected. Edit an assembly from its exterior map.
- **Show interiors (hide roofs)** changes presentation only. Hidden roofs still
  block sight, flight and falling. New hollow structures include real floors.

The same faceted geometry drives rendering, support, ceilings, body clearance and
sight. Angled wall grips retain their real horizontal unit normal and use paid
up/down and same-face sideways climbing. Curved ground movement follows its real
support, including off-center landings. General wraparound/corner climbing,
freehand curved walls and creature-size-specific collision remain later work.

Geometry version 3 saves editable structure records and their grouped volumes.
Earlier box/curved geometry and campaign scenes remain supported; old low-level
proof geometry is retained, not silently rebuilt into new editable shapes.
Older editable building shells offer **Preview upgrade to storeys**. Review and
**Apply size** to add floors, windows and stairs; opening an old campaign does not
silently convert its structures.
Version-1 building profiles also retain their saved roof silhouette. Reapply a
roof or base choice and **Apply size** to update a round-on-rectangular roof;
explicit feature edits use the newer profile as well. If the browser still shows
the old controls, wait for **Saved** and hard-refresh with **Ctrl+Shift+R**.
Existing earlier switchbacks retain their saved recipe until an explicit edit;
**Automatic → Apply size** updates them to the solid wallward layout.

#### Cellars and underground levels

**Build → Cellar** places a separate, resizable underground footprint. It can be
larger than the building above or placed independently, with real excavation and
finite floor grids at negative elevations. Depth, room heights, added levels and
partial floor openings use the same level controls. The surface stays intact
except for deliberately authored access/openings.

**Access** can be **Unlinked**, **Stairs**, or **Ladder**. Choose **Exterior surface**
or a building in **Connect to**. Access coordinates are relative to the cellar
centre; after placement, **Place access on map** positions the hatch on the
ground-floor plane. The landing/hatch and stair run must fit their connected maps
and have real body clearance. A failed edit leaves the previous geometry intact.
Ladders use the climbing animations and normal doubled vertical movement cost;
long routes may need more movement or Dash.

**Show underground** is available at the top of Build before selecting anything.
It reveals the saved cellar outlines and changes the exterior to a faint wireframe
while Terrain Mode is active. Click a revealed cellar to select it; **Level**
chooses the underground floor shown with a grid and handles. The centre handle
moves the cellar; side/corner handles resize it. Choosing **Cellar** also enables
the view, and placement ghosts remain visible through the surface.
Turning the view off, leaving Terrain Mode, or browsing an interior restores the
normal materials. This is an editor-only view: it does not remove ground, change
collision/sight, move creatures, or save wireframe settings. Passive outlines and
selected-floor meshes are cached rather than rebuilding world geometry per frame.

Buildings and turrets have clickable on-map identifiers in Terrain Mode, matching
the **Building 1 / Turret 2** names in menus. The selected cellar's connection target
is outlined and labelled **gold**. **Connect to** lists only nearby structures whose
actual inner footprint contains the current hatch and landing, including rotated
and round targets. Move the cellar preview near the desired building first, then
choose it, or position the access after placement. A previous target that no longer
fits stays visibly unavailable rather than silently switching; Apply still checks
the real route and body clearance.

Use **Edit cellar** to select a buried structure from the exterior as an alternative, and
**Maps & focus** to inspect its underground rooms. Character travel still uses
the actual stairs/ladder and confirmation popup, never a radial command.
Room data, access, cutouts, movement and the canonical actor survive save/reopen.

#### Biome structures and landmarks

The **Biomes** tab includes **Village / Town**, **City**, **Castle / Fortress**,
**Cliffside Castle**, **Mountain Fortress**,
**Ruined Village / Town**, **Ruined City** and **Ruined Castle / Fortress**.
**Structures & landmarks** controls inclusion when **Generate** is
explicitly used; opening a map or changing its palette never inserts buildings.
Seed lock reproduces the same layout without accumulating duplicate structures.

Settlement profiles have different architectural compositions, not a shared row
of identical buildings:

- **Village / Town**: irregular cottages around a green and fountain, winding
  lanes, an inn, forge, bellhouse and gated garden plots. Warm plaster,
  half-timbering, signs and varied clay, wood and slate roofs give houses their
  own identities.
- **City**: denser two- and three-storey trade districts, alleys and avenues,
  a mercantile hall, bell tower and six-stall market square. Brick, stone and
  painted plaster are coordinated by district rather than applying one colour
  to every building.
- **Castle / Fortress**: seeded citadel, bailey and palace compositions with
  different keep footprints/heights, rectangular or flared curtain walls, tower
  counts/heights, gatehouses and supporting buildings such as guardhouses,
  barracks, chapels and great halls. Solid wall stairs and the arched main gate
  remain playable. Large castles keep their architectural hierarchy rather than
  scattering random parts; small maps receive compact fortifications. Unlock the
  seed before **Generate** to vary the actual structure, not only its colours.
- **Cliffside Castle**: a fortified keep, complete curtain and towers stand on a
  high escarpment painted with positive and negative grid elevations. An arched
  approach crosses the ravine; its drops are real falling space, not decorative
  rock piles.
- **Mountain Fortress**: a fortress emerges from the lower face of a painted
  mountain, with below-zero wards and, on full-sized sites, a connected embedded
  hall. The mountain heightfield remains intact beneath underground structures.
  Both terrain-site variants retain full castle compositions on 50 x 50 and
  60 x 60 boards; compact variants keep a four-tower fortification. Landforms use
  existing editable grid heights, not new shape types or added landform solids.
  Existing saved scenes are not remodeled on load; changes require explicit
  generation or editing.
- **Ruins**: the same seeded town/city footprints with varied roof loss,
  breaches, rubble and collapsed upper-floor sections. Floor openings keep stair
  attachment points intact; destruction is real geometry, not just darker tint.

Fresh empty default canvases grow to **35 x 35** for villages, **45 x 45** for
cities, **50 x 50** for ordinary castles and **60 x 60** for the cliff/mountain
sites. Terrain castles require at least **20 x 20** squares. An automatically sized, unedited settlement
can grow for the next selected biome during the same session, but never shrinks
automatically. Populated maps, custom sizes and manually edited terrain/structures
keep their dimensions. Palette selection alone never resizes a map.

Building appearance is saved with its authoring definition. Original procedural
plaster, masonry, timber, slate and paving patterns share vertex-coloured
materials. Façade frames, beams, cornices and banners are batched render-only
details; they do not change aperture clearance or add traversal shortcuts.
Exterior views batch the linked floor slabs into one draw while retaining the
original per-map meshes for accurate picking; growing the castle does not require
one render submission per storey.

New buildings use restrained automatic windows: residential, civic and fortress
layouts have different spacing and at most two automatic windows per wall per
floor. New seeded recipes also vary width, height, sill and position, with
deliberate blank wall sections and occasional tall hall windows rather than one
identical column on every floor. Tall openings do not remove floor slabs.
New standalone turrets place automatic windows on their entrance side;
generated castle towers restrict them to courtyard-facing walls. Ordinary
traversable openings retain their existing clearance rules; arrow slits are not
silently substituted. You can still add, move, resize or remove manual windows
on any wall.

The optional versioned window-layout recipe is saved with the building.
Version 2 saves its composition seed; version-1 spacing recipes and existing
saved buildings without a recipe keep their old automatic windows, including
on resize; loading never removes manual features or silently changes a facade.
New construction or explicit regeneration uses the new recipes.
Generated variable windows use the normal feature controls: resize one to save a
manual override, or remove it without respawning its automatic counterpart.

New ordinary **Castle / Fortress** layouts use the same shared-wall connection
rules for their main building. Grand layouts join a high keep, residential wing,
great hall, court wings, gatehouse and northern watch around an open-sky courtyard;
their heights and rooflines differ. Compact 25- and 40-square layouts retain
connected halls without cramped wing stairs. Existing grid sizing is unchanged,
and reopening never remodels a saved castle. Visual acceptance remains open.

Suitable hills, mountains and underground biomes can contain three joined
chambers, connecting passages and a surface entrance. The chambers share one
floor, and their rooms and tunnel bores are carved after the joined rock shells
so intersections stay open. Editing one chamber preserves that carving order.
Eligible natural landscapes, including forests, deserts and grassland, can
occasionally contain intact homes, broken buildings or castle remnants on dry,
gentle sites without changing the underlying biome. Oasis and coastal sites also
leave the shoreline vegetation band clear. Masonry, roofs and rock use
biome-aware palettes, including weathered forest stone and desert sandstone.
Generated flora avoids structures, streets, plazas, stalls and garden fences.

Regeneration preserves manually authored structures and the ground beneath them.
Resizing a generated structure adopts it as manual work. Natural landmarks retain
the eight-structure / 220-volume budget. Settlement budgets allow meaningful
density while remaining bounded: **16 / 800** for towns, **32 / 1200** for cities
and **20 / 1100** for castles (structures / generated volumes). Linked floor-map
budgets are also bounded. Unsuitable or protected sites are skipped.
New layouts and appearances apply on **Generate**, not when reopening an existing
saved map. Lightweight drag ghosts do not rebuild the world's collision solids.
Palette selection alone changes colours; it does not replace the existing castle
or other generated structures. Generation progress, success and the actual failure
reason appear directly beside **Generate**. Occupied structures cannot be replaced:
move the creature off the structure, or remove test creatures before regenerating
the whole board. Generation also refuses changes that would remove a creature's
support or put it inside solid geometry. Rejected geometry changes retain the previous
terrain, creature positions and seed.
Full geometry is rebuilt on commit, not on every pointer event.
Idle floor rendering reuses its meshes and map geometry; actor-only checkpoints
do not invalidate that geometry cache. This does not guarantee a particular frame
rate on software rendering.
Movement queries use five-foot footprint buckets to find candidate volumes and
solid fragments before running the same exact geometry checks. Each range search
reuses support results and skips already-approved states before clearance work;
this avoids main-thread input stalls on larger settlements without changing
movement costs, animation speeds, collision or cross-map falling.
Stair anchors outside the reachable movement horizon are skipped, and cross-map
support searches run only when nearby foreign geometry can supersede local
support. More complex castle variants retain the same navigation safety rules.

## Creature menus and character sheets

Left- or right-click a creature and choose **Character Sheet** to open its sheet
inside the app. Use **Pop out** in the sheet title bar to move the sheets to a
separate browser window, which you can drag to another monitor. **Emotes** retain their existing
animations. **Actions** offers Wave, Sit, Take Cover, Jump, Punch, Hit Reaction,
Dodge and Cast Spell. Other unfinished commands are represented by one disabled
**Not yet available** option.

The Knight (Mixamo's **Knight D Pelegrini**), Mutant, Female Archer
(**Erika Archer**), Armored Knight (**Paladin J Nordstrom**) and Zombie
(**Yaku J Ignite**) use the same one-square footprint, movement settings, wall
climbing, ledge hangs and falling rules as Mannequin. They are appearances, not
separate movement implementations. App labels describe appearances; source names
remain provenance metadata.

Zombie is the undead **Yaku J Ignite** appearance previously labeled Monk.
Its legacy creature ID is preserved for saved boards; automatic token names
refresh to Zombie when a board is saved or reopened. Custom names and saved
character names are retained. This appearance label is independent of the
**Monk** character-sheet class.

The new actions are animation previews, not combat or movement rules:

- Wave and Sit loop. Take Cover requires an adjacent wall high enough for the
  crouched creature; it turns and makes a short within-cell adjustment to put
  the creature's back against the wall. It then holds the crouch. Moving,
  changing facing, or removing the wall releases cover. No armor/cover bonus
  is applied.
- Jump, Punch, Hit Reaction, Dodge and Cast Spell return to idle when their
  animation finishes. Jump is a complete jump in place, not the existing
  Rumba Dance animation.
- Dodge now visibly sidesteps and then takes an authored recovery step back,
  rather than playing in place or rewinding. Its gameplay position and
  allowance stay unchanged; the short out-and-back performance completes
  before another movement or facing request can begin.
- Other preview actions keep the token's gameplay position and allowance unchanged,
  except Take Cover's permitted alignment within its existing cell.
  They do not deal damage, grant cover, evade attacks, create spell effects,
  or add new traversal abilities.
- Manual actions require a stationary creature on the ground. They cannot
  interrupt a route, a climb, a held wall pose or a fall.
- New clips load on first use. A failed or interrupted load is reported instead
  of being marked as successfully played.

Adding another compatible character or action requires an asset and one catalog
entry, not another creature class or command switch. See the
[import and authoring workflow](./HANDOFF.md#shared-humanoid-imports-and-action-authoring).

Character sheets share one non-modal window:

- **Pop out** moves all character tabs into a separate browser window without
  starting another game. Edits, rolls, combat controls and map selection stay
  connected to the original game. Keep the game page open while using the pop-out.
  If your browser blocks it, allow pop-ups for this site and try again.
- Resize or move the pop-out using your operating system's window controls.
  **Dock**, or closing the browser window, returns the same sheets to the game
  with their tabs and previous in-app size and position. Reopening Character Sheet
  from the map focuses an existing pop-out rather than opening another one.
- Inside the game, drag the title bar to move it, and the bottom-right handle to resize it.
  The map remains interactive around the window.
- In-app **− (Minimize)** collapses it to a movable title bar. **□ (Restore)** brings back
  its tabs and previous full size.
- Selecting creatures while minimized updates the selected sheet but leaves the
  window collapsed. Choosing **Character Sheet** from a creature menu restores it.
- Each creature gets its own tab. Selecting a creature on the map creates or
  selects its tab **while the sheet window is open**. Selecting a sheet tab
  also selects its creature on the map, including when navigating tabs with
  the keyboard.
- Selecting a tab centers the camera on that creature's current position,
  including its terrain height, without changing zoom or viewing angle.
  This is a one-time recenter, not automatic following. Map-to-tab synchronization
  does not pan the camera; click the active tab to recenter again.
- **× (Close)** hides the window without losing its tabs, size, or position.
  In a pop-out, this sheet button also closes the browser window and leaves the
  returned in-app sheets hidden; closing the native browser window returns them visibly.
  Selecting creatures does not reopen a closed window; use Character Sheet again.
- The `x` on a tab closes just that sheet. Deleting a creature also removes its tab.
- Each tab includes the selected campaign's character sheet and a health bar. **Core** holds
  editable speed; **Combat** shows remaining movement with a progress bar.
  Pace/style controls stay available across sections. The **Compendium** has its own sidebar tab.
  Character records persist locally; the board, token links and window layout
  do not yet persist across page reloads.

The first creature of a type is initially unnumbered. Placing a second gives
them names such as **Mannequin 1** and **Mannequin 2**, including in existing sheet
tabs and the creature menu. Further copies increment the number independently
for each creature type; deleted numbers are not reused during the app session.

Open any creature's sheet and its **Character settings** gear to find
**Character images**. Upload or remove a **Token portrait (headshot)** and,
optionally, separate **Character artwork (full body)**. JPEG, PNG and WebP
uploads under 10 MB are resized locally: portraits are center-cropped to a
square up to 512 pixels, while artwork retains its proportions up to 1024 pixels
on its longest side. Prepared images are saved as JPEGs with a white background
for transparency. The portrait appears on tactical tokens and the sheet's
information card; artwork appears on **Bio & notes**. Every token linked to
the same saved character shares its images. No upload goes to an image server.

### Campaigns and rulesets

Startup always opens the **Create / Open Campaign** picker. A campaign needs a
name and an explicit choice of **2014 / SRD 5.1** or **2024 / SRD 5.2.1**.
That choice is immutable: it selects separate rule implementations and physically
separate resource databases, not a filter over a mixed catalog.

- Characters, rest resources, custom abilities and play layouts belong to one
  campaign. There is no global character library. Reuse a character by explicitly
  exporting/importing a same-ruleset copy; cross-edition conversion is not provided.
- Core SRD content is always enabled. Compatible optional packs are opt-in.
  Use **Sources & settings** beside a saved campaign to rename it or change enabled
  sources. Disabling a source prevents new additions without removing owned
  content, changing its source pin or breaking its Favorites.
- Each campaign automatically saves its board: working terrain heights, biome and
  placed flora, creatures and character links, names, facing, movement settings,
  selection and camera. **Saving... / Saved** above the board reports acknowledged
  local storage; errors remain visible with a retry control.
  Routine saves follow actual saved-state changes, not unrelated clicks or
  typing. Edits are grouped after **2 seconds of quiet**, with a **10-second
  maximum wait** during continuous activity. Short moves save after completion;
  longer moves also save their last safe position and matching movement costs
  at that deadline, rather than writing at every waypoint. Safe checkpoints
  remain in memory for interruption and recovery. The status shows
  **Waiting for the current action to finish...** while the latest action is not
  yet saved. Explicit campaign changes wait for completion too. Character
  resources, fall damage and their scene/turn state still commit atomically; those
  transactions are not postponed or split apart.
- Creature and saved-character names are shared. Click the standalone name above
  the sheet to edit it directly, without a visible text box. **Enter** or leaving
  the title saves; **Escape** cancels. The title and tabs are the only name
  displays on the normal sheet, including Combat and Non-combat.
  Linked creatures and sheet tabs update together. Naming does not use a radial
  menu or native prompt. Placing another copy does not overwrite a linked name.
- The **gear** beside the title opens **Character settings**: Saved character,
  New, Export JSON, Import JSON, Delete and the Compendium shortcut. These controls
  are hidden during normal play. Escape or Close hides the settings again;
  errors remain visible even when settings are closed.
- A single **character information** card groups Class, Level, Ancestry, Background
  and Alignment on every sheet page. Values use plain-text styling; Level and the
  descriptive values remain directly editable. Enter or leaving a field saves,
  while Escape restores its saved value. Class is display-only in this card.
  The manual class dropdown now lives in **Core > Class selection (temporary)**;
  a future character builder/charactermancer will replace that control.
- **Initiative** is a smaller roll card beside the character information, separate
  from the grouped AC, proficiency and passive-perception cards. On narrow sheets
  it moves below the information card. Its modifier and roll behavior are unchanged.
- Reopening restores the last acknowledged safe checkpoint, including a stable
  wall climb or ledge hang, rather than replaying an interrupted animation.
  While the tab is running and storage is healthy, routine changes reach a
  checkpoint within 10 seconds, including during long moves. Force-closing can
  still lose changes that have not yet been acknowledged; storage failures remain
  visible rather than reporting a successful save.
  Active combat resumes its turn, remaining movement/actions/attacks and completed
  sheet/shared roll history. Unfinished dice requests are not replayed or charged.
  Undo receipts, open sheet tabs, window positions and transient visual animations
  remain session-local.
- **Campaigns** above the board saves before returning to the picker. Each campaign
  restores its own board; a new campaign starts blank. Do not force-close while
  **Saving...** or after a save error if you need the latest unacknowledged edits.
- Campaign **Export** / **Import campaign backup** includes settings and complete
  character and board state, including committed combat/history, but not the large
  bundled catalogs. Version-2 backups include the scene; older version-1 campaign
  backups remain importable without a board. Import creates a separate campaign
  and validates its edition, resource versions, characters and scene references.
- Campaign data is stored by the local host in SQLite. Clearing browser data
  removes catalog caches and any unmigrated browser-only campaigns, not host saves.
  No online account or multiplayer synchronization is introduced.

### Character data and compendium

Opening an unlinked creature's sheet creates a saved character. Edit its name,
single class/level, abilities, HP, proficiencies and notes; committed field
changes save automatically. In the sheet's gear menu, **Saved character** loads an
existing record onto the current creature. **New** starts another record without
deleting the old one. A map token's appearance is independent of its saved
character; their linked name is shared.

The **Tokens** menu has a **Saved Characters** roster directly below the creature
palette. The DM can search all campaign characters, create or import an unplaced
record, and open its sheet without making a new sprite. Players still see only
their assigned records; opening a sheet never changes their active observer.

- **Place**, then click a supported floor, or drag **Place** onto the board.
  Occupied or blocked cells are rejected, not replaced. Retrieval reuses the saved
  character ID, HP, equipment, spells and sheet layouts. Removing its sprite keeps
  the character in the roster.
- Already-placed characters offer **Open sheet** and **Focus sprite**, reusing the
  existing actor rather than copying or teleporting it.
- Unplaced sheets edit saved character data, not world movement, targeting,
  standing, rolls, rests or combat actions. Place the character to use those controls.
- **Next sprite** chooses a canonical palette appearance for placement. A placed
  sprite or a choice made in this workspace supplies its known model; otherwise
  explicitly choose **Next sprite** before **Place** is enabled. Portraits do not
  select a 3D model. A placed
  sprite's appearance and saved character portraits/artwork retain their existing
  scene and backup persistence. An unplaced next-placement choice is **workspace
  session only**, not a permanent character-model preference or a field in character
  JSON. No existing sprite or portrait is replaced by changing that choice.

The **System Reference Document (SRD)** is published, reusable D&D rules content,
not the complete paid rulebooks. The local **2014 SRD** compendium contains
**319 spells and 746 equipment/magic-item entries**, including generated +1/+2/+3
equipment variants. Its expanded core has **2,025 entries** including reference
creatures, ancestry, backgrounds, feats, classes, features, conditions and rules.
The separate **2024 core has 2,296 entries**, including **339 spells and 1,095
equipment/magic-item entries**. Reference categories do not pretend to automate
character creation or monster placement.

There are **16 bundled source packs / 8,950 entries across both editions**, with
14 optional compatible 2014 packs. Alternate systems, including Advanced 5e and
Black Flag, are excluded. Open5e's current `open5e-2024` fixtures still reference
its 2014 document, so that pack is deliberately not relabeled as 2024 content;
no validated supplemental 2024 pack is bundled yet.

Open the **Compendium** sidebar tab to browse without opening a sheet. Search
names or descriptions, filter resource categories, and open **Details** for rules and
automation coverage. **Add to** defaults to the selected creature and also lets
you choose a saved character. Add confirms its destination without forcing the
sheet open. Dragging onto an open sheet uses that sheet as the destination.
Equipment/spell **Details** buttons on the sheet open the same sidebar entry.

- Items enter inventory without applying equipped bonuses. **Equip**, **Add &
  equip**, or the equip drop area activates supported calculations. Equipping
  another suit of armor or shield replaces the previous equipped one.
- Required **attunement** is separate from equipping, with a three-item limit.
  Supported effects include Ring/Cloak of Protection, Gauntlets of Ogre Power,
  Headband of Intellect and unarmored/unshielded Bracers of Defense. Identical
  effects do not double-stack; effective ability changes preserve base scores.
- AC, ability modifiers, proficiency, saves, skills/expertise, initiative,
  passive Perception and equipped weapon attack/damage values update from the
  supported data. Weapon proficiency can be overridden manually.
- Armor Details show AC, Dexterity handling/caps, minimum Strength and Stealth
  disadvantage when applicable; shields show their AC bonus. Conditional
  restrictions shown in the text are not all automatically enforced.
- Added spells enter the spellbook without spending slots. Prepare them when
  required, choose a cast level, then **Cast / use slot** to consume a remaining
  slot and track concentration. Casting values, supported upcast/cantrip damage
  and class spell-slot progression are calculated. Concentration can be ended
  explicitly; **Long rest** restores HP/slots and clears concentration.
- Roll buttons use the shared dice system and Dice Log. Normal d20 checks use
  the physical d20 when available; advantage/disadvantage and damage rolls are
  digital. Rolling damage does not cast a spell or spend another slot.
- **Reference** labels mean inventory/rules text only, not automated effects.
  Reviewed targeting profiles automate selection and projectile attack rolls,
  not hits, damage, saves or effect application. Unreviewed spells explicitly
  require manual targeting or a configured profile. Prepared-spell limits, armor proficiency
  restrictions, ammunition, charges and conditional rules are not enforced.

This is a first version, not a complete 5e rules engine. Common class costs and
rest recovery are tracked, but ability effects, most conditional class/subclass
rules, multiclassing, feats and guided level-ups are not automated.
Changing level updates proficiency and slots, not max HP or feature choices.

### Combat and Non-combat play

**Core** remains the configuration page. The two play tabs use a compact identity
header and read-only check/save buttons instead of editable ability boxes.

- **Combat:** choose **Start Turn** to enable scene-wide manual turn tracking.
  End the current turn, select the next creature, and start its turn. There is
  no automatic initiative order. **End Combat / Free Play** removes turn
  enforcement without restoring persistent spell slots or limited uses.
- Actions, bonus actions, reactions and remaining attacks have separate budgets.
  Combat choices are grouped into **Attacks**, **Spells** and **Other actions**
  inside each action-cost section. Spell attacks stay under Spells; weapon attacks,
  unarmed strikes, Grapple and Shove appear under Attacks. Empty categories are hidden.
  The **Bonus action** section remains visible even if this character has no
  available bonus-action abilities, and explains when its budget is spent.
  It follows Action in the default layout; saved custom section ordering is retained.
  **Attacks left** includes the attacks available if you spend your remaining
  actions on attacking, plus attacks left in an Attack action already started.
  It starts at the class/level count (or manual override), decreases as attacks
  are used, and drops when an action is spent on something else. Additional
  actions such as Action Surge contribute additional possible attacks; bonus
  attacks and reactions are separate. The action is not spent until you attack.
  Spent choices disappear. Supported base-class **Extra Attack** leaves the
  remaining attacks available without reopening other action choices; **Finish
  attack action** explicitly forfeits those attacks.
- Consecutive grid moves share one allowance, using the actual navigation and
  traversal costs. **Dash** spends an action and adds the character's speed.
  Walk/Run only changes movement pace. Movement must finish before changing turns.
  Token placement/drag editing remains a manual DM repositioning tool, not a
  charged route.
- **Manual / DM turn corrections** can adjust remaining movement and action
  counts without changing saved speed. Corrections invalidate older Undo entries.
  **Undo last use** refunds tracked costs, not dice results or target effects,
  and cannot refund Dash movement that has already been used.
- Casting uses the spell's action/bonus/reaction timing, preparation and slots.
  The targeting popup's **Cast at level** buttons choose the **spell slot level**
  to expend, not the spell's fixed base level. Only levels with a usable slot are
  shown, with remaining counts. Higher levels update supported projectile counts
  and area sizes before confirmation, plus the committed damage follow-ups. Changing levels spends
  nothing; cantrips explicitly say they use no spell slot.
  A 2014 campaign enforces its bonus-action casting restriction. A 2024 campaign
  instead allows only one expended spell slot per global turn, including off-turn
  reaction casting. Off-turn reactions use their own pool. Longer casting/activation times are
  available only outside combat. Ritual casting is not automated.
- Common class cards use existing resource counters: for example Action Surge,
  Second Wind, Rage, Cunning Action and edition-appropriate Monk Ki/Focus options. Conditions, positioning,
  active effects and assigned spell choices still require manual resolution.
- Under **Core > Custom abilities & attack settings**, create/edit abilities with
  action, bonus, reaction or no-action activation. Use an existing class pool, or
  track separate uses with turn/short-rest/long-rest/game-day/manual resets.
  Override attacks per Attack action for unmodeled features if needed.
  In a 2024 campaign, mark a custom action as **Uses the Magic action** when
  applicable so it cannot use Action Surge's restricted action credit.
- **Non-combat:** checks, saves, useful spells/abilities and carried-item Details,
  without an action budget in free play. Slots and limited uses still apply.
  Switching tabs or saved profiles does not refill an active combat turn.
- Ordinary checks/saves are free; explicit **Hide/Search** options spend their
  declared action. Damage/healing rolls remain in **Recent uses & follow-up
  rolls** after their original options disappear. Applying results is manual.
  Equipment/Spells controls share the same combat costs; spell roll-only buttons
  do not cast or spend another action.
- At 0 HP, normal combat actions and voluntary movement are blocked. The death
  save button only rolls: unconsciousness, stabilization and special exceptions
  remain manual. End combat before taking rests or resetting daily uses.

Pace, Style and Roll use pressed buttons rather than drop-downs. Style changes
Default/Drunk animation; Roll selects manual Normal/Advantage/Disadvantage and
still combines with automatic targeting modifiers. Neither spends movement or
an action. Creature allegiance, biological type and size are editable only on Core.
Search/Study cards are omitted from the Combat action menu because their checks
are available below. Those ordinary skill rolls remain free; use a Manual / DM
action correction if a check represents a Search or Study action. Tactical Hide
and class bonus-action options remain tracked choices.

The live turn ledger is scene memory captured in acknowledged campaign checkpoints.
Reopening a campaign restores committed budgets, history, token links and board edits,
never an in-flight selection or unfinished dice roll. Character-only backups carry
custom abilities and rest-limited usage, not a board encounter.

2024 automation also uses the revised Action Surge restriction, target-save/DC
Grapple and Shove workflows, Martial Arts dice and independent bonus strikes,
level-10 Flurry credits, Paladin bonus-action features/Channel Divinity, class
resource recovery and level-1 Paladin/Ranger spell slots. Weapon Mastery and
unimplemented conditional effects remain explicitly manual/reference-only.

### Attack and spell targeting

On the spatial board, weapon attacks appear only when another viable token is in
range with a clear path. Choose a target before rolling or spending the use. Melee,
reach, thrown and normal/long ranged distances are separate; a dagger's melee and
thrown modes can be selected in the targeting panel. Long range and conscious hostile
creatures within 5 feet impose ranged disadvantage, not a blanket minimum range.
Nearby allies do not impose it. The panel also accounts for tracked Prone, Blinded
and Invisible conditions. Manual advantage/disadvantage combines with these flags.
The close-combat rule applies to ranged **spell attack rolls** such as Fire Bolt
in both editions, regardless of how far away the chosen target is. It does not
penalize a spell's saving throw or Magic Missile's automatic hits. A spell with a
single listed range has no weapon-style normal/long-range penalty.
Grapple and Shove also require another creature in reach and no more than one size
larger; their edition-specific contest/save and outcomes remain manual.

- **Core > Targeting tags:** set each token's Friendly/Hostile/Neutral side,
  biological creature type and size. Untagged tokens default to Neutral, Humanoid
  and Medium; these are not inferred from their appearance. Matching non-neutral
  sides are allies, opposite sides are enemies. Healing profiles prefer allies
  without forbidding otherwise legal healing of enemies.
- **Select targets:** click a token or its panel button. Repeated-target spells
  let each click allocate another projectile, with a minus button to remove one.
  Allocate all Magic Missile darts, Scorching Ray rays or Eldritch Blast beams
  before confirming. Each attack projectile rolls separately; damage rolls and
  applying the results remain manual.
- **Choose casting level:** levelled spells select their slot in this same popup,
  not on the spell card. Existing targets and locked areas are retained while the
  preview updates. If changing level makes an allocation too large or incomplete,
  correct the allocations before Confirm. Cancellation creates no area and spends
  no slot or action. Spellbook roll-only damage follows the last confirmed cast level.
- **Beneficial Fly:** select willing creatures within **Touch (5 feet)**, including
  the caster, and check the willingness confirmation. Allegiance does not establish
  willingness; a willing enemy can be selected with the Any filter. A level 3 cast
  targets one creature, with one additional target per higher slot level.
  Confirmation automatically grants **60-foot flying speed**, without taking off
  or overwriting base flight. The 2024 spell grants **Hover**; the 2014 spell
  instead keeps its targets aloft by magic, including while Prone or unable to move.
  Use **Take flight** on the recipient's radial menu to begin flying.
- **Preview an area:** move the pointer over the board and left-click to lock it.
  Caster-origin cones/lines begin along the creature's actual facing. Point-origin
  cones, lines, cubes and straight walls use two clicks: origin, then direction. The panel shows
  affected creatures and supports chosen exclusions where the spell allows them.
  Point origins can be elevated above terrain. Empty areas are valid casts.
  **Template** buttons choose supported wall/ring/sphere/dome alternatives before
  confirmation. Mass Cure Wounds and Slow require excluding creatures until their
  recipient limit is satisfied. Location/object spells preview a small point marker;
  that marker is not a creature, terrain object or spell damage radius.
- **Confirm / Cancel:** confirmation rechecks current positions, range, cover,
  target counts and resources before committing. Cancel or Escape spends nothing.
  Canceling a later projectile retains every already-completed roll, but does not
  spend the spell slot or action. Right-button camera gestures remain available.
- **Lingering visuals:** Grease, Entangle, Fog Cloud, Darkness and Spirit Guardians
  are joined by Moonbeam, Web, Black Tentacles, Sleet Storm, magical walls and other
  reviewed areas. Only the corresponding
  caster's later turns count, not other creatures' turns or repeated UI refreshes.
  Ice Storm's residual terrain lasts through the end of the next caster turn.
  Following areas move with their caster; fixed areas stay placed. Concentration
  replacement/ending removes the appropriate visuals. Duration expiry also ends
  matching concentration. **End spell** ends concentration and removes its visuals;
  **End area** removes only a visual without refunding the cast or ending concentration.
  Conditions and other mechanical changes remain separate manual controls. Undo removes the new visual and restores
  a concentration area that the undone cast replaced.
- **Move an existing spell:** use **Move** in Active spell effects or its available
  spell-action card. Moonbeam moves up to **60 feet from its previous origin** on
  later turns, costing an Action in 2014 or a Magic action in 2024. This is not a
  new casting: it spends no slot, does not reset duration and respects 2024 Action
  Surge's Magic-action restriction. Flaming Sphere moves up to 30 feet for a Bonus
  action. Arcane Eye, Mage Hand, Unseen Servant and image markers have reviewed
  movement controls with their applicable destination limits. Paths, obstruction
  interactions, conditional endings and triggered attacks/saves/damage remain manual.
  Cancel and failed/stale saves spend nothing; Undo restores the previous position
  and cost. A moved effect cannot be undone after it has ended or otherwise changed.
- **Recipient and location reminders:** Haste, Mage Armor, Bless and similar spells
  track declared token targets without applying statistics or conditions. Purple
  rings follow recipients; point markers track stationary chosen locations.
  **Remove target** corrects reminders after manual saves or early endings, without
  spending another use; removing the last target also ends matching concentration.
  Until-dispelled and special durations remain explicitly manual-ended. Higher-slot
  durations that need individual adjudication are labeled rather than given a
  guessed timer. Outside manually advanced caster turns, no wall-clock timer runs.
- **Fly lifetime:** the active-effects panel lists recipients and the remaining
  **100 caster turns (10 minutes)**. Its cyan rings follow recipients along the ground
  beneath them, aligned with the yellow selection ring instead of rising during flight.
  They remain visible outside portrait-token rims and do not draw through creature visuals.
  Ending/replacing concentration, **End spell**, expiry or Undo removes the
  temporary grant. Duration expiry and End spell also end its concentration.
  An airborne recipient falls through the normal damage/Prone rules unless another
  active flight source can keep it aloft. Natural flight and other casters' Fly
  grants remain intact. Undo restores a replaced concentration grant or area.
- Areas, remaining durations, tags and completed target/roll records survive
  campaign checkpoints and campaign backups. A fixed area may survive caster-token
  removal; use End area when its caster no longer has a token to take turns.

Every bundled **core SRD spell** has an explicit initial-casting profile or a specific
manual explanation. This pass does not expand optional third-party spell packs.

| Core coverage at base spell level | 2014 | 2024 |
| --------------------------------- | ---: | ---: |
| Catalog spells                    |  319 |  339 |
| Structured initial targeting      |  297 |  313 |
| Explicit complex/manual cases     |   22 |   26 |

Manual cases include chained targets (Chain Lightning, conditional Chromatic Orb),
multiple independent origins (Meteor Swarm, Dancing Lights), connected cube layouts
(Fire Storm), combined movable construct attacks (Spiritual Weapon, Arcane Hand/Sword),
mixed transformation modes, remote destinations and bespoke Wish effects. Their
popup explains the missing control instead of presenting a misleading single
template. Major Image's permanent/no-concentration upcasts and Bestow Curse's
level-5+ concentration exceptions also stay explicitly manual.

Supported upcasting and cantrip counts come from the chosen cast level/character level.
Edition differences include
2014 Acid Splash's paired targets versus the 2024 sphere, revised Sleep's smaller
area and concentration, Hold Person's removed upcast spread restriction, Sleet Storm's
changed radius/height, Chill Touch's ranged-to-melee change, revised Holy Aura and
the 2024 conjuration emanations. Classic lances retain their close-range
penalty; Heavy weapons use creature size in 2014 and Strength/Dexterity in 2024.
Magical +1/+2/+3 weapon variants retain their base reach/thrown targeting.

**Core > Targeting configuration** opens static
overrides for other spells/custom abilities: range/minimum range, target/projectile
counts, sight, shape/dimensions, origin, exclusions and duration/expiry. Weapon
mode edits retain other modes; feature overrides can ignore close-quarters or
long-range disadvantage. Reset returns to the campaign's reviewed rules. Static
overrides do not infer future upcasting or subclass/feat mechanics.
Manual/complex spell profiles have a small targeting **gear** on their play cards; ordinary
weapon and reviewed-spell cards do not carry large configuration buttons.

This is targeting assistance, not complete automatic adjudication. Range uses
five-foot grid diagonals, including altitude; area inclusion uses token feet/center
points rather than full creature volumes. Cover checks use terrain columns and
transformed structure bounds, not doors/openings, partial-cover AC/save bonuses or
other creatures as cover. Confirm boundary cases and large-creature emanation
coverage manually. 2014 Fireball/Fog Cloud corner-spreading coverage is explicitly
flagged for manual confirmation, not simulated propagation. Lingering areas are
**visual only**: they do not automatically obscure vision, alter movement, deal
damage, make saves or apply/end conditions. Spell-wall templates do not create
terrain, collision, physical cover or openings. Summoning markers do not instantiate
creature stat blocks or automate commands; multiple creature positions and counts
remain manual. Later Sunbeam/Call Lightning attacks, automatic cloud drift and
other spell-specific repeated actions remain manual unless a control is shown.
Sleep and other creature-held effects
do not leave a persistent area merely because their conditions have a duration.
Concentration areas follow the owned spell's concentration flag, disappear when
another concentration spell replaces it or concentration is ended, and do not
erase another caster's area or non-concentration zones. Concentration saves after
damage and other mechanical ending conditions still require manual resolution.
Fly's temporary flight grant is mechanical, not just a visual. Other beneficial
spells can select legal targets using reviewed/configured profiles, but their
healing, buffs and conditions still require manual application.

### Arrange play pages and Favorites

On **Combat** or **Non-combat**, choose **Customize layout**:

- Drag a section's handle to move it before another section. Drag card handles
  to reorder cards within their section. **Earlier / Later** buttons provide
  the same controls with the keyboard. In Combat, cards reorder within their
  automatic category; Favorites retains its freely arranged order.
- Choose **Favorite**, or drag a card into **Favorites**, to move it there
  without a duplicate in its original section. **Unfavorite** returns it to its
  normal section; dragging it back can also choose its position.
- Play buttons are disabled while customizing. Unavailable options are shown
  only for arrangement; after **Done customizing**, spent choices still disappear
  and every favorite uses its original action/resource cost.
- Arrangements save automatically per saved character, separately for Combat and
  Non-combat. They survive reloads and travel in character backups. Switching
  characters/pages exits customization without resetting a turn.
- **Reset this page** asks for confirmation and clears only that page's order and
  Favorites, never character statistics, resources or the other page.

Health, movement budgets, turn controls and the right-hand history rail stay fixed.
Checks/saves and carried
reference items can also be arranged or favorited; item buttons remain Details,
not automatic item-use effects.

### Uses and roll history

**Recent uses & follow-up rolls** is a vertical panel on the right of the character
window. It stays visible while the main sheet scrolls and has its own scrollbar.
In narrow windows it stacks above the sheet instead of squeezing the controls.
Character names are omitted from this per-character panel; the shared Dice Log
still identifies who rolled.
Both logs show compact results such as **Longsword attack: 23**. Hover over the
dotted-underlined total for the actual dice, modifiers, kept advantage/disadvantage
die and physical/digital source. Totals can also receive keyboard focus and expose
the breakdown to assistive technology. Non-roll uses/messages remain plain text.

- **All rolls** shows the selected saved character's recorded uses and
  character-sheet rolls from this session: attacks, spells, checks/saves,
  damage/healing follow-ups and short-rest Hit Dice. It is not limited to the
  last five/ten entries and does not include unrelated board-dice rolls.
- **This turn** shows entries from the current manual combat turn, including
  off-turn reactions. It does not mean the character's last own turn. Without
  an active combat turn it displays an explicit empty-state message.
- Follow-up buttons remain available on older uses without charging another
  action or resource. New follow-up results are logged when rolled, not backdated
  to the original use. Applying damage/healing effects remains manual.
- A roll finishing after a turn/profile change stays with its original
  character and starting turn. Committed uses are logged once; successful rolls
  from cancelled/uncommitted uses are labeled as rolls, not paid uses.

History remains across End Combat, rests and campaign reopening through scene
autosave; character-only JSON backups do not contain it. Undo marks the use's
costs as undone without deleting the actual roll results.

**Saving and backups:** records live in the local host's campaign database, not
only in browser storage. Reopening its campaign restores
the saved board and character links. To load another record, open the sheet's gear
and choose **Saved character**. **Export JSON** in that same settings panel requests
a file download and also shows the complete,
copyable snapshot; if an embedded host does not offer downloads, save that text
as a `.json` file. Export again after later edits. Version-5 character backups include
the ruleset, required source pins, Hit
Dice, class-resource usage, custom abilities/usage, attack overrides, play layouts
and Favorites, plus optional portraits and character artwork. Character JSON
backups may be up to 4 MB and include the image data, not temporary file links.
**Import JSON** creates a validated same-ruleset copy, preserving
owned instance IDs so layouts remain meaningful. Unscoped legacy backups and
cross-edition conversion are intentionally not supported by the campaign UI.
Clearing browser data does not delete acknowledged host campaigns and characters.
Different browser profiles share host saves when using the same host data
directory. Browser-only legacy data and catalog caches are still origin-specific.

Catalogs are bundled locally and seeded into edition-local IndexedDB databases.
No Roll20 account or runtime rules-provider API is needed.
It is SRD content, not the complete paid PHB/DMG or Roll20 compendiums. Attribution,
licenses, pinned upstream revision and input hashes are retained in
[the source notices](./assets/data/resources/NOTICES.txt), per-pack provenance and
[checksum manifest](./assets/data/resources/manifest.json). Regenerate reviewed
seeds with `npm run resources:sync`; the maintenance tool downloads pinned public
Open5e and 5e-bits source snapshots, not data during play. Review changes and bump
the seed revision before publishing an update; campaigns retain their source
version pins rather than changing mid-adventure. Missing/corrupt data fails visibly.
Unsupported or conditional dice scaling stays manual instead of silently reusing
a lower-level formula. The application's existing Three.js/Cannon CDN imports
are unchanged; this is not desktop packaging or a fully self-contained installer.

### Health

Health is displayed as **current / maximum HP** with a proportional, color-changing
bar and a separate temporary-HP badge. **Damage** and **Heal** open compact amount
controls. Enter final damage after any resistance or other adjustment: temporary
HP is used first, current HP cannot fall below zero, and healing stops at maximum
HP without changing temporary HP. **Edit** opens current/max/temp fields for direct
corrections; Cancel or Escape dismisses unfinished changes.

These changes save with the character. Attacks/spells do not yet automatically
deduct or restore target HP.

### Rest and recovery

**Short Rest**, **Long Rest** and **Resources** are beside health, available from
every sheet section rather than buried in Spells.

- **Short Rest:** confirm a qualifying rest of at least one game hour. Supported
  short-rest resources recover even if no Hit Dice are spent. You may then roll
  and spend one class Hit Die at a time, see its healing and choose whether to
  spend another. Add Constitution to each die: minimum zero healing in 2014,
  minimum one HP in 2024. A 2024 short rest must start with at least 1 HP;
  cap healing at maximum HP and leave temporary HP unchanged. Remaining Hit Dice
  persist across rests and page reloads.
- **Long Rest:** confirm a qualifying eight-hour rest. This restores HP/slots and
  short/long-rest class uses. In 2014, recover up to **half your total Hit Dice,
  rounded down, minimum one**; in 2024, recover **all spent Hit Dice**.
  At least 1 HP is required at the start. The once-per-24-game-hours restriction
  is a DM declaration, not a real-time timer.
- **Resources:** adjust remaining class-use counters after using abilities.
  Counters cover common base-class pools such as Rage, Bardic Inspiration,
  Channel Divinity, Wild Shape, Second Wind/Action Surge/Indomitable, Ki,
  Lay on Hands/Divine Sense, Sorcery points, Stroke of Luck, Mystic Arcanum,
  edition-appropriate Eldritch Master/Magical Cunning and Wizard recovery/signature
  uses. This marks usage; it does
  not activate abilities, apply their effects or spend combat actions.
- Short rests automatically restore **Warlock Pact Magic** slots, not unrelated
  higher-level/ordinary slot overrides or Mystic Arcanum. Wizards keep spent
  slots unless they optionally choose **Arcane Recovery**: once per declared game
  day in 2014 or once per long rest in 2024, combined restored slot levels at most
  half Wizard level rounded up, with no slot above level 5. Bardic Inspiration
  gains short-rest recovery at level 5. The 2014 level-20 Sorcerous Restoration
  restores four points; 2024 offers an optional level-5+ short-rest choice to regain
  up to half Sorcerer level, once per long rest. Revised partial recovery for Second
  Wind, Rage, Wild Shape and Channel Divinity follows the 2024 resource policies.
- **New game day (DM)** resets daily-use counters explicitly. Long Rest does not
  silently advance the calendar day; 2024 Arcane Recovery resets on its actual long-rest policy. Party bonuses such
  as Song of Rest, item effects, attunement requirements and unsupported
  class/subclass/condition effects still need manual handling.

All rest data is local and included in current backups. Use the current sheet's
Export JSON when backing up rest usage; older app versions cannot export counters
they did not track.

### Movement

Set base speed on **Core**. The shared movement strip keeps **Walk / Run** buttons
and a **Default / Drunk** style dropdown; **Combat** has a compact, read-only
**Remaining movement** bar:

- **Core > Character speed (feet)** is the ground-distance setting for a linked
  character and its token/grid range. Flying uses **Core > Flying speed (feet)**.
  New saved characters default to **30 feet** on the ground and no flying speed.
  Loading a saved character applies its speed; tokens sharing that record share
  speed, while retaining their individual pace/style. There is no second editable
  board allowance. Unlinked prototype tokens retain the legacy 50-foot fallback.
- **Remaining movement:** available feet / this turn's allowance, with a matching
  progress bar. Moving drains it, Dash increases the allowance, and DM corrections
  update it without changing base speed. Between turns it shows that movement is
  unavailable; outside combat it previews the full per-move allowance.
- **Walk / Run:** Run changes ground pace and traversal, not the allowance; its downward
  wall movement is a free fall rather than a controlled descent.
- **Style:** Default or Drunk. Drunk uses the existing drunk animations without
  random movement or changes to the requested route.

Speed changes refresh the idle range and apply to the next accepted move.
Pace/style can update during movement without retargeting the committed route.
Free play uses a per-move allowance; manual combat shares one remaining allowance
across committed moves. Run is not Dash.

**Changing destination while moving:** click another map location at any time
during a click-to-move route. The latest click replaces the remaining route at
the next safe point: a completed ground/stair step, stable climbing hold, or
jump/fall landing. There is no separate Stop control; choosing a nearby
destination shortens the journey. Out-of-range or occupied destinations are
adjusted to the closest legal point in the remaining reachable area.

Completed movement stays charged, and the unused tail of the previous route is
refunded before the replacement route is reserved. Repeated redirects are one
continuous free-play move, not fresh allowances; combat continues using the same
turn budget. Jumps and falls finish safely before turning, and any landing
damage/conditions are applied before the new route is planned.

**Flight:** a creature with an active flying speed gets **Take flight** in its
radial menu. This rises **5 feet** and spends **5 feet** of flying movement.
While airborne, it is replaced by **Raise**, **Lower** and **Drop**. Raise and
Lower each offer **5, 10, 15 or 20 feet**, displayed directly as signed amounts
(**+5 ft** through **+20 ft**, or **-5 ft** through **-20 ft**) without needing
hover. Their chosen vertical distance is paid at one movement foot per vertical foot.
Unaffordable or obstructed choices are
disabled. Lowering exactly to terrain lands safely; choices below the surface
are unavailable. The radial status shows height above ground, flying speed and
the remaining flying allowance.

Click-to-move retains absolute altitude over lower terrain, with the same
five-foot horizontal/diagonal costs. Flying and ground movement share distance
already spent during a combat turn; changing travel mode never refills it.
Dash increases each mode's own allowance. Free play retains its per-move policy.
Other creatures block overlapping vertical space; unmeasured solid placeables
remain blocking. Both the selection marker and reachable-area outline project
onto the terrain beneath the flyer rather than floating at flight altitude.

**Drop** relinquishes flight and starts the shared falling lifecycle without a
movement cost. Sufficient falls roll damage and may leave the creature Prone;
Feather Fall, Slow Fall and other protections still apply. Drop does not erase
natural flying speed or cancel a spell. Losing flight during a route interrupts it
at the last stable waypoint and refunds its unfinished tail; losing support starts
a fall. A reduced flying speed also interrupts the route so it can be replanned
against the remaining allowance. Completed airborne positions
and movement costs survive campaign save/reopen; unfinished animations/routes do
not replay.

The sheet's Flying speed field represents **base/manual flight**. The reviewed
**Fly** spell adds a scene-owned, token-specific temporary grant, using the higher
of base and granted speeds. It persists with concentration, recipients and duration
in campaign saves/backups, but never becomes a character-only exported trait or
grants every token sharing a character record flight. Other spell/item flight
effects still require manual application and cleanup; preparing/owning them does
not activate them. **Can hover** is a
rules protection, independent of the stationary hover animation.

Flight uses lazy, retargeted **Floating.fbx** and **Flying.fbx** locomotion
clips in `assets/animated-sprites/`, with a quarter-second blend between hover
and travel. They are not emotes and their root translation cannot change logical
position or grant free elevation. Powered flight translates at twice the selected
ground Walk/Run pace, with the existing minimum waypoint duration retained for
smooth short moves. This visual rate does not change movement allowances, costs,
animation playback timing or the gravity-driven Drop trajectory.

Select a creature to outline the perimeter of its reachable area, without filling
the tiles. Excluded holes receive their own boundary, and the outline follows
terrain height and reachable sections of sheer walls. Each straight or diagonal
step costs **5 feet**, so 50 feet permits ten flat-ground steps. Routes account
for intervening terrain, other creatures, and existing blocking-placeable data.
You can move diagonally past the corner of one creature without entering its
occupied space, so a reachable square behind it does not require an extra
five-foot detour. Two occupied side cells still prevent squeezing between
creatures. Solid plant/structure corners and cliff corners remain blocked;
cliffs require a face-on approach. Flight uses the same distinction at the
creatures' actual overlapping altitude.

**Facing:** left-click and drag directly on an idle creature to turn it to one of
eight grid-relative directions. The heading follows the drag in both perspective
and tactical views, even after camera rotation. A short creature click selects it
and opens its radial menu; a facing drag does not. Ground clicks retain movement
behavior, and right-drag still orbits the camera. Turning does not
move the creature or cost movement. Escape or focus loss cancels a facing drag;
facing is protected during movement, wall attachment and committed actions.
Short climbs, descents, vaults and wall-aligned cover share the same world-facing
convention, so entering an animation does not reverse the corrected drag heading.

**Height transitions** use actual vertical feet, not the number of terrain levels:

- Steps up to **1.5 feet** blend their height continuously instead of snapping.
- Waist-high ledges, up to **2.5 feet**, use a short authored mantle upward,
  controlled lowering in Walk, and an authored hop down in Run.
- Higher transitions use the appropriate full mantle, wall climb or
  gravity-driven fall. Controlled climbing still costs double vertical distance.
- Landing recovery uses physical height. Damaging rules-driven falls collapse
  into Prone; protected falls use a softer landing. Visual-only traversal retains
  the braced and clearance-checked rolling variants.

**Vaults:** Run routes can vault over a waist-high terrain obstacle no more than
one square thick when a clear, supported landing at the starting height exists.
Vaults approach a wall face rather than cutting diagonally across its corner.
They cost the normal two horizontal steps (**10 feet**) plus double the vertical
rise. The complete vault must fit the allowance; there are no mid-vault stops.
An already aligned Run approach flows straight into the vault without an
in-place turning pause. Clicking the obstacle's top still stops on top. Walk uses
controlled climbing: crouch/stand recovery keeps its authored foot contacts, and
ordinary walking steps cover the remaining distance to the cell center.
Switching to Walk before a queued vault converts it to up/down traversal, while
an already committed vault finishes safely.

Climbing uses **2 feet of allowance per vertical foot**, both upward and during a
Walk descent. A creature already hanging on a wall with a 50-foot allowance can
climb at most **25 vertical feet** in that action. Ground approach steps still
count: 10 feet of ground movement plus 20 feet climbing costs 50 feet, and one
grid step onto a 10-foot-higher ledge costs **25 feet**. Small non-climbing steps
retain their normal grid cost. Vertical feet use the same world scale as the
5-foot-wide squares, not raw terrain-height levels.

Click inside the outlined area to move. Out-of-range clicks do nothing and keep the
creature selected. Empty background outside the rendered board is also ignored,
rather than redirecting the creature to an edge tile. Visible creature parts near
the board edge remain selectable. Each accepted click gets a fresh allowance; new movement
clicks for that creature are ignored until its current move finishes. The outline
hides while it moves and returns at its new position afterward.

Click a reachable wall point to stop partway up or down. Destinations prefer
nearby **5-foot height intervals**, but the creature moves continuously to that
point rather than snapping there. Exact allowance boundaries and terrain ends
may lie between those intervals. The creature holds its climbing pose until
another move, which receives a fresh allowance. Wall movement is vertical-only;
changing columns requires returning to ground or the ledge first.
A hanging creature's selection ring lies flat against its wall face, centered
behind its rendered body rather than its logical grid anchor. Getting off the
wall restores the normal horizontal ground ring.

The upper wall remains selectable when the allowance can reach a stable
**ledge hang**. Click the wall near the lip to hang with both hands on the edge;
click the top ground surface to finish climbing onto the platform. These are
separate movement destinations and costs. Entry/exit animations never freeze
mid-crouch. If the remaining allowance cannot reach a safe wall pose, the
creature stays standing at the edge instead of stopping halfway through entry.

In **Run**, click reachable lower ground to drop without vertical movement cost.
There is no mid-air catching; use **Walk** to descend to another wall point.
Changing the mode while already hanging does not release the creature by itself.
Controlled mannequin descents use a dedicated **Climbing Down Wall** animation
instead of playing the upward wall loop backward. Mid-wall holds and resumes
retain the downward cycle's pose and timing.

Falls accelerate under gravity at the grid's physical scale rather than drifting
at a constant speed. A 20-foot fall takes about **1.1 seconds airborne**; a
36-foot fall takes about **1.5 seconds**. Landing contact follows that trajectory,
while recovery normally retains its authored pace. Choosing Slow Fall slows the
descent and softens recovery visually; its rules effect is damage reduction.

Changing **Mode** or **Type** updates the current gait and travel pace immediately,
without resetting the original allowance. Switching an active controlled descent
to Run starts a drop to ground. Switching Run to Walk before a drop starts can
make the destination too expensive: the creature stops at its remaining allowance,
including mid-wall when needed. A drop/release already in progress finishes
safely, then adopts the new gait. Changes to **Speed (feet)** apply to the next move.

Keyboard creature movement and turning are disabled for now. Space-drag map panning,
mouse map rotation and keyboard navigation within sheets still work. Token-placement/drag editing
remains separate from distance-limited click navigation. Free play retains a
per-move allowance; manual combat shares one remaining allowance across moves.

## Falling damage, Prone and standing up

Running off a ledge or dropping from a wall uses the campaign's falling rules.
At **ground contact**, each complete **10 feet** of vertical fall deals **1d6
bludgeoning damage**, capped at **20d6**. Horizontal travel and animation height
do not add damage. Temporary HP absorbs damage before current HP.

A damaging fall makes the creature **Prone**, unless it is immune to that
condition. Completely avoided damage does not newly impose Prone. Falling never
clears an existing Prone condition. The current route stops at the landing, and
unused route movement is refunded rather than charging the entire requested path.

- **Stand Up** is always in the sheet's condition bar, regardless of the selected
  page. It spends **half the current maximum Speed, rounded down**, and consumes
  **no action, bonus action or reaction**. It is not half the remaining movement
  and does not become more expensive after Dash.
- For example, with Speed 30 and 10 feet already spent, a fall leaves 20 feet.
  Standing costs 15 feet, leaving **5 feet**. A creature at 0 HP, with Speed 0,
  restrained/grappled, or without enough movement cannot normally stand.
- Prone remains through idle animations, turn changes, rests, saves and reloads
  until the player stands. Clearing the Core Prone checkbox uses the same
  cost-tracked standing operation; it is not a free shortcut.
- Moving while Prone **crawls at double movement cost**. Stand before climbing or
  vaulting. Weapon, unarmed and spell attack rolls automatically receive
  disadvantage; an independently selected advantage cancels it. Advantage or
  disadvantage for attacks _against_ a prone target remains manual targeting.
- In free play, standing reduces the **next per-move allowance**. Completing that
  move refreshes the usual allowance. In combat, it reduces the shared turn
  budget and never refreshes that budget.

**Slow Fall:** a level 4+ Monk with an available reaction is prompted **at the
start of the fall**. Choosing it spends the reaction in manual combat and reduces
damage by **five times Monk level**. The airborne animation takes twice as long,
and the landing plays more gently. These are visual timings, not extra movement
or a change to the feature's rules. If damage remains after reduction, the
creature still lands Prone. Declining does not spend the reaction.

**Other protections:** Core has Flying speed, Can hover, Feather Fall active,
other flat fall-damage reduction and Prone immunity. Available flight can avert
a ledge fall; hovering or magical support differs from merely owning a fly
speed. Incapacitated flight and Stunned movement use the selected 2014/2024
rules. A flight **Drop** deliberately relinquishes flight protection but still
honors Feather Fall and Slow Fall. Feather Fall is an already-applied effect,
slows descent to 60 feet per game round, prevents fall damage, and ends on landing;
its checkbox does not cast or spend a spell slot. Other conditional defenses,
damage-triggered concentration checks, unconsciousness and death resolution
remain manual.

HP, Prone, completed fall rolls and movement costs are committed together with
the safe landing checkpoint. A failed save pauses with an explicit Retry prompt,
reusing the completed roll instead of rerolling or applying damage twice.

The shared [animation catalog](./src/config/HumanoidActionCatalog.js) uses
Mixamo **Fall Flat** for the in-place landing/collapse, **Sleeping Idle**
(face down) for the held pose, **Getting Up** (From Stomach) for recovery, and
**Prone Forward / Crawl Backwards In Prone** for crawling. Exports are FBX Binary,
Without Skin, 30 FPS, no keyframe reduction, retargeted from Yaku J Ignite to the
shared humanoid rigs. Lying bodies are grounded by their actual skin bounds,
not just their feet. The lying clip's heading is matched to the end of the
collapse on each rig, avoiding an authored sideways turn without changing the
creature's logical facing or position. These assets retain [Mixamo's terms](https://www.mixamo.com/);
they are not separately relicensed by the application's code license.

Fall impact uses a balanced 0.18-second blend; transitions between collapse,
lying, getting up and idle use balanced 0.4-second blends. Both clips retain full
combined pose weight, and standing releases the lying-body grounding correction
gradually instead of snapping upward. Refreshing a prone creature does not
restart its held pose. These visual blends do not delay impact damage or spend
additional movement/actions.

## Large d20 rolls

With **Count: 1**, press **d20** to throw the gold die onto the board. Bounces,
tumbling, friction, and quiet-body settling come from a fixed-step physics
simulation rather than a scripted tour and a final face snap.
The low forward launch scales with the board's usable span, sending the die
across the board with end-over-end tumble and a modest rebound from its boundary
walls. Surface resistance keeps the finish from dragging on.

The displayed result comes from the resting numbered face. If the die is caught
between faces, the result says **D20 is cocked. Roll again.** The model stays
visible for inspection, no number is logged, and you can press d20 again.
Clicking the die dismisses it; dismissing during a throw cancels that roll.
On very small boards, its size is reduced enough to leave rolling room.

Only an unavailable 3D renderer uses the existing 2D d20 fallback. A failed or
unreadable physical roll never silently becomes a random result.

## Exotic biome appearances

All biomes marked `exotic` use biome-specific appearances, including those listed
outside the Exotic menu group. Choose a biome and press **Generate** to apply
its population and appearance.

| Biome             | Generated asset appearance                                                | Opacity range |
| ----------------- | ------------------------------------------------------------------------- | ------------- |
| Blood Marsh       | Crimson, burgundy, and muted red tones; suitable shallow-marsh vegetation | 65-85%        |
| Mystic Grove      | Teal, mint, lavender, and pale gold                                       | 60-80%        |
| Feywild Bloom     | Pink, aqua, lilac, and lime                                               | 50-75%        |
| Shadowfell Forest | Muted blue-violet and ghostly gray dead trees                             | 30-60%        |
| Crystal Spires    | Blue-purple rocks and pebbles                                             | 45-80%        |
| Eldritch Rift     | Violet and eerie teal dead trees, fungi, and rocks                        | 30-65%        |
| Lava Fields       | Dark ember-tinted rocks and pebbles only; no plants or foliage            | 80-95%        |
| Astral Plateau    | Original natural texture colors, with transparency only                   | 35-65%        |
| Arcane Ley Nexus  | Unnatural magenta, cyan, violet, and blue tones                           | 35-70%        |

Lower opacity means more see-through. Variation is stable for the same biome,
seed, model, and position, so locking the seed also preserves the appearance
pattern. The palettes and opacity levels are defined in
[ExoticBiomeAppearance.js](./src/config/biome/ExoticBiomeAppearance.js).

Fantasy tinting retains the original texture detail and cutouts rather than
substituting the generic multicolored atlas. Astral retains the original texture
colors as well. Material copies are isolated from cached assets, so generating
an exotic biome does not tint or fade a later ordinary biome.

The **Asset Density** control scales generated trees, plants, and rocks. Changing
the biome palette alone recolors the ground; regenerate to replace the assets.

## Biome plant placement

Oasis uses individual palm, banana, Monstera, and fern models, not the complete
tropical asset pack. Instancing preserves their calibrated size, authored
transforms, materials, and ground-level root anchor. Monstera leaves use the
cutouts already present in the supplied color textures.

Generated trees keep their normal size wherever the trunk base fits supported
ground. Near a terrain drop or map edge, generation uniformly shrinks a tree
only as much as needed, down to **65% of its normal size**. If that is still too
large, the site is skipped. Canopies may naturally overhang; they do not determine
the required ground footprint.

Manual placement is not automatically resized. The fit is calculated during
generation; later terrain carving does not automatically refit existing trees.
Hard-refresh and regenerate to apply these changes to a new map.

## Development commands

| Command                                | Purpose                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `npm test`                             | Run the full Jest suite, including real-asset integration tests                 |
| `npm run test:unit`                    | Run fast unit and mocked-boundary tests without the real-model suites           |
| `npm run test:integration`             | Run integration tests that load actual FBX, OBJ, and GLB model assets           |
| `npm run test:stable -- --watch=false` | Run the full Jest suite serially with open-handle detection                     |
| `npm run test:watch`                   | Run tests in watch mode                                                         |
| `npm run test:coverage`                | Generate a new coverage report                                                  |
| `npm run lint:all`                     | Run JavaScript, stylesheet, and architecture-layer checks                       |
| `npm run format:check`                 | Check formatting of configured source, test, tool, and documentation data files |
| `npm run format`                       | Format those files                                                              |

Run commands from the project root. The root package manifest is the only
package manifest for this app; lint configuration remains under
[tools](./tools/).

### Test suite organization

- [tests/unit](./tests/unit/): deterministic logic, UI, and mocked-boundary checks.
- [tests/integration](./tests/integration/): real-model contracts and simulations,
  including humanoid retargeting/motion, rendered facing, generated tree support,
  tropical model calibration, and the physical d20.
- [tests/helpers](./tests/helpers/): shared fixtures used by either group.

Use `npm run test:unit` for quick local feedback. Run `npm test` before merging;
the real-asset regressions remain required coverage, not optional replacements.
The existing stable, watch, coverage, and CI commands still include both groups.
Both test directories mirror the corresponding source paths.

Prefer assertions about observable results and exact boundaries over permissive
smoke checks. Consolidate overlapping cases around the public behavior they
protect; keep meaningful table-driven inputs and remove obsolete coverage
alongside its unused production code.

Coverage check (October 30, 2026): the existing 60% global branch threshold is
unmet both at the starting commit (56.82%) and after this cleanup (56.83%).
All test cases pass; the threshold and full-suite coverage selection are unchanged.

### Verification snapshot: October 28, 2026

- Last full Jest baseline: **113 suites, 964 tests passing**.
- Speed editor/movement-bar follow-up: **3 focused UI suites, 57 tests passing**.
- Play layouts/Favorites: **14 focused suites, 208 tests passing**, including
  character backups, turn rules and real navigation.
- History rail/roll attribution: **17 focused suites, 223 tests passing**.
- Compact roll summaries/tooltips: **12 focused suites, 120 tests passing**.
- JavaScript lint: **0 errors, 40 existing unused-variable warnings**.
- Stylesheet lint and architecture-layer check: **passing**.
- The repository-wide formatting check flags the unchanged
  [lint configuration](./tools/.eslintrc.json). Changed JavaScript and tests pass
  a focused formatting check.

The humanoid contracts replay actual FBXs on every registered appearance:
grounding, shared locomotion, live gait changes, movement budgets, double-cost
climbs, frozen wall poses, two-hand ledge grips, gravity-driven falls, every
manual action, asynchronous failures and removal/loading races. Browser checks
also decoded the imported 2048-pixel textures and exercised body picking and the
eight-action menu. The earlier `webgl_unavailable` result was caused by an
overly strict application startup check, not missing browser support. The
check now accepts working software-backed WebGL, matching the renderer's
default policy. Live grid and character rendering in VS Code is verified.

Cliff-motion regression coverage includes real Three.js hierarchy transforms,
animation/root blending, terrain-edge detection, exact arrival budgets, input
release, and landing clearance. Fresh-load browser replays with the actual FBX
clips also cover walk/run/sprint, both inputs, adjacent height changes, elevation
scales, and 30/60/120 FPS. See [HANDOFF.md](./HANDOFF.md) for motion invariants and
remaining limits; a green suite alone does not close every older movement report.
Wall-cycle tests use the actual skinned skeleton at 30/60/120 FPS and uneven
frame intervals, checking joint continuity, action weight, and animation/controller
clock alignment rather than only the final token position.
Partial-climb coverage also checks frozen hand poses, smooth up/down resumption,
reversed mantles, live-mode allowance caps, canonical tile ownership, and real
heightfield-face picking.
Fall regressions measure acceleration and airtime independently of recovery,
including different tile/elevation scales, uneven frames, short drops, and actual
FBX foot-contact timing.
Large-d20 tests additionally use the real GLB geometry to cover all 20 numbered
faces, physical ground contact, bounds/terrain, frame-rate independence, short
throws, cancellation, cocked rolls, and result/log consistency.
Camera tests use real Three.js projections to cover near/far edge widths,
landscape/portrait framing, non-unit tiles, stored view modes, cursor zoom,
ground-plane pan math, and picking after projection switches.
Biome placement regressions parse the actual tropical FBX and terrain OBJ assets.
They cover individual species selection, calibrated geometry, root anchors,
compound meshes, reflected transforms, and supported trunk vertices across
generated Oasis, temperate-forest, and exotic scenes.
Character-sheet tests cover duplicate naming, per-token tabs, selection and
removal events, hide/reopen behavior, drag/resize bounds, menu routing, and
preserved emotes. Compendium/character coverage also exercises search/drop/add,
equipment and attunement reversal, effective abilities, proficient magic weapons,
prepared casting, slot depletion, concentration/rests, validated JSON backups,
storage failures, shared dice and keyboard/draft preservation. Browser checks
cover actual placement, token selection, window gestures, map input, native
compendium dragging, derived equipment/spell values and settled-d20 rolls.
Movement-allowance tests additionally cover perimeter geometry and holes, live
gait changes and continuation, exact ten-square boundaries, diagonal
and climbing costs, reachable detours, all four gait combinations, ignored
out-of-range/busy clicks, disabled keyboard input, live range updates, and
overlay cleanup. Actual-FBX replays verify constrained climbs/falls and the
return to idle after arrival.

## Project layout

- [src](./src/): application and rendering code.
- [tests](./tests/): Jest tests and test setup.
- [assets](./assets/): models, textures, animation files, and their licenses.
  Keep these resources and license files intact.
- [tools](./tools/) and [scripts](./scripts/): development and asset-inspection utilities.
- [docs/adr](./docs/adr/): accepted architecture decisions.
- [docs/archive](./docs/archive/): historical reports, not the current task list.

Dependencies and generated coverage output are ignored by Git. Do not use an old
coverage report as evidence of current test health.

## Documentation

- [CONTEXT.md](./CONTEXT.md): shared domain vocabulary.
- [TODO.md](./TODO.md): current engineering follow-ups and feature backlog.
- [CONVENTIONS.md](./CONVENTIONS.md): code organization and conventions.
- [HANDOFF.md](./HANDOFF.md): concise maintenance handoff and cleanup context.
- [March 2026 conventions audit](./docs/archive/CONVENTIONS-AUDIT-2026-03-30.md):
  historical findings that must be rechecked before acting on them.
