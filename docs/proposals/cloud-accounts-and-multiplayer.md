# TavernTable: cloud accounts and multiplayer proposal

**Status:** Section 14 design decisions approved November 10, 2026; implementation and production cutover remain separate approvals  
**Prepared:** November 9, 2026  
**Initial workload:** One group of approximately ten concurrent participants,
five or six sessions per month, four or five hours per session.

**Scope clarification, November 10:** Internet access is required. Character
editing between games uses brief backend wake-ups, not offline drafts or queued
uploads. Local caching remains a performance optimization.

## 1. Executive recommendation

Move the hosted edition of TavernTable to:

- **Firebase Hosting** for the public website and versioned, redistributable
  application files.
- **Firebase Authentication with Google or email/password sign-in** for one
  returning account containing both owned and joined campaigns.
- **Cloud Run in Oregon** for authoritative gameplay, campaign access checks,
  saves, and live updates. Start with one small deployment that can scale to zero.
- **Firestore Standard** for small account, membership, revision, receipt, and
  live-session records.
- **Private Cloud Storage** for large campaign snapshots, custom assets, and
  complete backups.
- **Each participant's browser/GPU** for rendering, movement presentation, and
  a persistent cache of that participant's authorized data.

Players would bookmark one website. The DM's computer would not have to host the
game or remain switched on. The website would remain reachable between games;
the game backend would not need to remain continuously active.

Plan for approximately **US$0-10/month for the stated workload**, with
**$25/month as the approved planning budget, not a spending cap**, reusing the
budget reported configured in Firebase. Verify its currency and settings before
deployment. The higher budget is not an expected spending level. That forecast
requires cached assets, bounded history, efficient updates, available free
allowances, and no server left fully active around the clock.

This is a substantial application integration, not just a Firebase deployment.
The current local edition should remain intact until the hosted edition passes
the acceptance gates below.

## 2. Current position and constraints

### Already configured

- The Firebase project, Google sign-in provider, and development login domains.
- Email/password was also enabled in Firebase, as reported November 10;
  application integration and end-to-end verification remain pending.
- A $25 monthly Firebase budget was reported configured November 10; its
  currency, project/product coverage, thresholds, and recipient must be verified
  before deployment.
- Standard Firestore in `us-west1`, with deletion protection.
- A private default Storage bucket in Oregon, with uniform bucket access and
  public-access prevention.
- Deny-by-default browser rules for Firestore and Storage.
- Public web configuration and locally authorized development credentials.

### Not implemented or deployed

- Application account login with either method, account-owned campaign lists,
  or joined memberships.
- Cloud campaign persistence, account-bound invitations, or legacy migration.
- Production Hosting, the Cloud Run deployment, or the cache/session policies in
  this proposal.

### Existing behavior to preserve

The current implementation is a loopback Node host, durable SQLite storage,
cookie identity, and server-sent events (SSE). Its live messages largely notify
clients to refresh; they are not yet a complete incremental synchronization
system. See [local-host.js](../../tools/local-host.js),
[session-authority.js](../../tools/session-authority.js), and
[SessionConnection.js](../../src/campaigns/SessionConnection.js).

Campaign scene and character changes have coordinated revisions and atomic
commit behavior. Routine scene checkpoints use two quiet seconds with a
ten-second maximum wait; unfinished animation frames are not save data. Preserve
those distinctions rather than promising that every local preview is already
saved. See [CampaignStore.js](../../src/campaigns/CampaignStore.js) and
[CampaignAutosave.js](../../src/campaigns/CampaignAutosave.js).

The interactive multiplayer QA checkout contains the Free Play and remote
movement-animation fixes. The main development checkout has additional
door/room, terrain, and character work and unrelated uncommitted changes. The
first milestone must reconcile these deliberately; copying an older QA tree
over the main checkout would lose work.

The terrain ownership decision in
[ADR-0001](../adr/ADR-0001-terrain-engine-event-seam.md) remains in force. A network
snapshot or browser cache is not a second authoritative terrain owner.

## 3. Initial scope

### Included

- Google and Firebase-managed email/password login, recovery, and reliable
  returning login.
- Per-campaign DM ownership and player membership.
- A unified **My Campaigns: Owned / Joined** launcher.
- Account-bound invitations and preservation of existing character assignments.
- Complete cloud saves, independent backups, and non-destructive migration.
- Authorized first-join snapshots, incremental live updates, and reconnect sync.
- Versioned local caching of relevant assets and participant state.
- Online character editing between games without starting a live game session.
- Explicit live-session controls, automatic sleeping, and cost safeguards.
- A hosted pilot with ten participants and measurable correctness/cost results.

### Deferred

- No-Internet use, including offline viewing, character editing, queued updates,
  movement, combat, rolls, or automatic merging of offline gameplay.
- Peer-to-peer hosting or using a player's computer as the production authority.
- GPU rendering or video streaming from the cloud.
- Built-in voice/video conferencing.
- Co-DM permission hierarchies, a public multi-group product launch, and complex
  ownership-transfer workflows.
- Redis, Cloud SQL, an always-on VM, a paid load balancer, or a framework rewrite
  without measured evidence that they are needed.

The local SQLite edition remains an explicit development/local-play option.
Local and cloud campaigns will not silently become two writable copies that
automatically merge with each other.

## 4. Hosting and connection design

```text
Participant browser
  |-- Website and public versioned files --> Firebase Hosting
  |-- Account login --------------------> Firebase Authentication
  |-- Authenticated commands + SSE ------> Cloud Run
  |                                         |-- Firestore
  |                                         `-- Private Cloud Storage
  `-- Authorized asset downloads --------> Storage / browser cache

Rendering and animation stay on the participant's device.
Cloud Run owns permission checks and authoritative gameplay decisions.
```

### Public address and deployment shape

Use Firebase's default Hosting domain initially; a paid custom domain is not
required. The browser will use the configured Cloud Run HTTPS address internally.
Participants still need only the website bookmark.

### Availability while the game backend sleeps

| Activity                                      | Proposed behavior                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| Open the website                              | Firebase Hosting serves it without a running game instance               |
| Google or email/password sign-in              | Firebase Authentication remains available independently                  |
| View current campaigns or character data      | An authenticated request briefly wakes the backend                       |
| Edit/save an assigned character between games | Short validated requests save online; no live game session is required   |
| Join live gameplay                            | Requires an active owner-started live session and its ongoing connection |

Zero running instances is an intentional sleeping state, not an unavailable
website. Incoming requests start an instance automatically, potentially with a
short startup delay. Ordinary requests finish and permit sleeping again.
An actual backend outage is different: the website can still load, but current
data and save operations cannot succeed until the backend recovers.

Retain **HTTP commands plus SSE**, rather than replacing the existing transport
with WebSockets solely for this migration. Bidirectional gameplay is already
possible: commands travel in requests, and approved updates travel in SSE.

Do not route the long-lived stream through a Firebase Hosting rewrite:

- Hosting documents a 60-second request timeout.
- Hosting generally strips cookies other than `__session`.
- The existing native `EventSource` implementation cannot attach a Firebase
  bearer-token header.

Instead, use an authenticated **Fetch-based SSE Adapter** for cloud connections,
behind the existing connection Seam. Keep the cookie/CSRF Adapter for explicit
local mode. Cloud requests use verified Firebase identity in the authorization
header, not credentials in query strings or URLs.

Configure exact allowed frontend origins, authenticated commands, and deliberate
preflight handling. CORS is not a substitute for campaign authorization. The
local host's existing same-origin/cookie protections must not be weakened to
make cloud mode work.

Cloud Run's platform invocation policy and Firebase identity verification are
different. Permit browser HTTPS invocation at the platform as required, then
require application-level Firebase authentication for every protected operation.
A Firebase ID token is not a Cloud Run IAM invocation token. Public reachability
must not grant anonymous campaign access, and the runtime identity's datastore
and object permissions remain restricted.

### Starting Cloud Run configuration

These are proposed starting settings, subject to the ten-client load test:

| Setting                 | Initial recommendation                                                |
| ----------------------- | --------------------------------------------------------------------- |
| Location                | `us-west1`                                                            |
| Container               | Supported Node 24 image; satisfy the project's Node 24.4+ requirement |
| CPU / memory            | 1 vCPU / 1 GiB                                                        |
| Billing                 | Request-based                                                         |
| Minimum instances       | 0                                                                     |
| Maximum instances       | 1 initially                                                           |
| Request concurrency     | 40, allowing live streams plus ordinary requests                      |
| Maximum request timeout | 60 minutes; reconnect streams earlier with jitter                     |
| Rendering hardware      | No server GPU                                                         |

Use a cloud entry Adapter that listens on `0.0.0.0` and the supplied `PORT`.
Do not simply deploy the loopback host unchanged.

A one-instance setting is a cost control, not a correctness guarantee: deployments
and replacements can temporarily overlap. Revision checks, durable receipts,
and shared change records must remain correct with overlapping instances.

Publish only an allowlisted frontend output. Never publish the repository root,
admin tooling, credentials, SQLite files, backups, or server configuration.
Confirm redistribution rights and preserve notices for bundled assets and
source packs before public Hosting deployment.

## 5. Accounts, permissions, and returning players

### Account model

Use the Firebase UID as identity. Names and email addresses are display/contact
data, not ownership keys.

- A campaign has one DM owner initially.
- The same account can own some campaigns and join others.
- Characters remain campaign-owned; player membership grants assignment access.
- Successful authentication with either method never makes someone DM of every
  campaign.
- Mutable campaign roles should not be treated as permanent global token claims.

For the first release, keep application participation **invitation/approval
controlled** for the intended private group. Authentication alone should
not let arbitrary Internet users create unlimited uploads or long-running games
on this billing account. Application eligibility must not grant ownership of
any existing campaign.

### Sign-in methods

Offer Google and Firebase-managed email/password. Firebase manages passwords;
TavernTable must not create its own password database or log password values.
Provide email verification before campaign use and password recovery for
email/password accounts.

Support linking sign-in methods to the same Firebase UID after proving access
to the existing account and the new credential. Existing owned/joined campaigns
and character assignments must remain attached to that UID. Do not merge access
merely because two accounts claim the same name or email address.

### Returning login

Use Firebase browser authentication persistence and token renewal. The backend
verifies identity independently on requests and reconnects. A Cloud Run restart
must not destroy account identity or require a new host key.

Show explicit signed-out, expired-identity, denied-access, and network-error
states. Never silently create a new account/campaign or downgrade to a writable
browser-only save after an authentication or cloud failure.

### Invitations

Recommend expiring, single-use invitation links that attach an authenticated UID
to an existing campaign/player seat. Store invitation hashes, not raw links.
Initial proposed expiry: seven days.

Preserve the seat's saved-character assignments when the player joins. Do not
recreate characters or guess identity from matching names.

Distinguish these owner actions in the UI:

- Revoke an unused invitation: prevents future redemption.
- Remove player access: revokes membership and live access, without deleting
  campaign-owned characters.

This makes invitation/account semantics explicit instead of carrying the old
reusable bearer-login behavior forward invisibly.

### Permission coverage

Check campaign access consistently for:

- Lists, metadata, opening campaigns, and live connections.
- Scene/character reads and writes, movement, combat, doors, and room visibility.
- Inviting/removing players, assignments, and publication controls.
- Images, asset manifests, uploads, downloads, imports, exports, and backups.
- Starting, extending, and ending live sessions.

Use explicit participant projections, not raw campaign records with a few
properties removed. Membership is not permission to download a full DM save.

## 6. Durable cloud saves

### Storage responsibilities

| Location        | Responsibility                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Firestore       | Profiles, campaign summaries/ownership, memberships, revision heads, command receipts, compact change records, live-session leases |
| Private Storage | Immutable scene/character snapshot objects, custom assets, complete backup files                                                   |
| Browser         | Replaceable cache and clearly marked unacknowledged drafts                                                                         |

Do not place complete scenes, embedded artwork, or campaign backups in Firestore
documents. Its document limit is 1 MiB.

For the first cloud Implementation, retain compatibility with the current
canonical campaign/character serialization through a storage Adapter. Large
canonical snapshots can remain private JSON objects. The participant wire
representation should reuse asset hashes rather than repeatedly transmitting
embedded image bytes. Avoid a simultaneous rewrite of all rules records.

### Atomic publication

Firestore and Storage do not provide one shared transaction. Preserve atomic
scene/character visibility using immutable objects and one committed revision
head:

1. Authenticate and authorize; read a consistent head and its referenced data.
2. Validate the command with the existing campaign, ruleset, and gameplay logic.
3. Upload and verify any new immutable objects without modifying existing ones.
4. In a Firestore transaction, recheck access, expected revisions, and the command
   receipt, then atomically publish the new head, receipt, and compact change
   record.
5. Acknowledge **Saved to cloud** only after that transaction succeeds.
6. Deliver participant updates from committed state.

Keep external uploads and other side effects outside retryable transaction
callbacks. A failed upload must not publish a dangling head. A conflict must not
overwrite another character change. Failed unpublished objects are collected
later, not treated as successful saves.

Use command identifiers and durable receipts so retries after a lost response do
not spend resources twice, duplicate a move, or reroll a completed result.
Preserve scene and character revision semantics and atomic resource costs.

Use compare-and-set conflict handling, not whole-campaign last-writer-wins.
An in-memory queue is an optimization, not the cross-instance consistency rule.

### Save timing and failures

Preserve existing two-second/ten-second scene checkpoint behavior and stable
movement checkpoints. Gameplay operations requiring atomic character/resource
commits remain durable before success is reported. Temporary drag previews,
camera movement, and animation frames are not continuous cloud writes.

Show separate **Saving**, **Saved to cloud**, **Not saved**, and
**Backup delayed/failed** states. Do not rely on page unload, shutdown hooks,
or the container's filesystem for acknowledged data.

Use authorized direct/resumable Storage uploads for large files where needed;
the backend must validate size, type, integrity, ownership, and final contents.
Check actual UTF-8 byte sizes against platform limits rather than relying only
on JavaScript string length.

## 7. Live synchronization and animation

Replace broad "something changed; reload everything" behavior with ordered,
bounded participant changes.

- Start with a current authorized snapshot and asset manifest.
- Deliver changes relative to a known committed revision.
- Each active backend instance observes a compact durable change journal and
  fans out participant-safe updates. Do not create a full database refresh for
  every viewer and every heartbeat.
- Retain bounded reconnect history; a proposed initial bound is the most recent
  1,000 compact changes, no longer than 24 hours. Large gaps use a fresh snapshot.
- Detect missing, duplicate, stale, and incompatible updates explicitly.
- Persist command results before announcing them; a crash between commit and
  announcement must still be recoverable from the journal/head.

Authorize and filter the underlying data **before** constructing a participant
delta. A delta must not reveal hidden origins, NPC budgets, unrelated rooms,
private sheets, or asset names that expose unrevealed encounters.

Approved movement should carry the validated route/presentation metadata needed
for local walking, running, backward movement, flight, and falls. Do not send
animation frames or apply gameplay costs again during remote presentation.

Preserve the QA fixes for Free Play permissions, route coalescing, animation
continuity, and cancellation. Late joins/reconnects restore current positions;
they do not replay minutes of historical walking. Map resizing, observer changes,
and changed visibility must safely invalidate obsolete presentations.

Reconnect before the cloud request timeout, refresh identity, and use backoff
with jitter. A paused or ended live session is not a network failure: clients
must stop automatic live reconnect attempts.

## 8. Participant caching and online reconnection

### First join

Download the active authorized area, assigned sheets, and required assets.
Progressively load other permitted areas as needed rather than downloading every
map in a large campaign.

Reuse the existing pinned version/hash approach in
[ResourceSeeds.js](../../src/resources/ResourceSeeds.js). Keep the 2014 and 2024
resource databases separate; no silent edition fallback or mid-campaign source
upgrade.

### Local storage

Use IndexedDB for participant metadata/checkpoints and Cache Storage for reusable
binary assets, with versioned schemas and content hashes. Do not use the small
`localStorage` mechanism for campaign files.

Separate public catalog files from account-specific state. Partition private
caches by UID, campaign, and view/access generation. Never persist bearer tokens
or reusable signed download URLs in campaign manifests.

Provide cache usage, clear-cache controls, bounded eviction, and recovery from
quota denial or browser eviction. Persistence requests are best effort; a cache
is never the only saved copy.

### Rejoin

1. Verify the current account and current campaign access.
2. Compare the cached revision, schema, asset hashes, and participant view.
3. Apply a contiguous set of authorized changes, or replace stale state with a
   fresh authorized snapshot.
4. Reuse unchanged cached asset bytes.
5. Enable world commands only after authoritative reconciliation.

Never restore another signed-in person's cached view. Clear private cache state
on logout and purge superseded access-scoped data when membership or viewpoint
changes.

### Privacy and connection-loss behavior

Do not download DM secrets and merely hide them with fog or UI controls.
Secret-bearing images may require authorized tiles rather than shipping a whole
hidden map. Preserve current physical sight, closed-door room concealment, and
single-assigned-observer rules.

Previously disclosed bytes cannot reliably be "unlearned" or remotely erased.
Short-lived authorized asset links and cache purging limit future access; they
cannot guarantee revocation of a file somebody already copied.

Internet access is required for supported campaign viewing, character editing,
and world actions. Cached bytes avoid repeat downloads; they do not provide a
standalone offline mode.

On connection loss, show disconnected/not-saved status and disable further
mutations. Preserve any already-in-progress unacknowledged edit visibly for
recovery rather than claiming it was saved. Reauthenticate and reconcile current
state before editing resumes. Do not add an offline character editor, a durable
offline update queue, or automatic merging of offline changes.

## 9. Live-session lifecycle and sleeping

Keep authentication sessions, live game sessions, and combat turns distinct.
Pausing hosting must not reset a combat turn, movement budget, HP, or campaign.

### Approved inactivity policy: November 10

| Event                              | Policy                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Open website/dashboard             | No permanent game stream; brief authenticated requests as needed                                                      |
| Owner starts live session          | Restore committed state and initialize a one-hour inactivity deadline                                                 |
| Members join                       | Open authorized live streams while the session is live; joining/reconnecting does not reset inactivity                |
| Meaningful participant action      | Reset the hour after a permitted action in this campaign is accepted                                                  |
| Quiet roleplaying / forgotten tabs | Warn at 55 minutes without meaningful actions; owner may click Keep Session Active to reset the hour                  |
| Owner ends session                 | Finish pending accepted work, record pause, close streams, stop retries                                               |
| Everyone leaves                    | Allow 15 minutes for reconnect, then require a new start                                                              |
| One-hour inactivity expires        | Pause gameplay and close live streams unless a meaningful action or explicit owner keep-active has reset the deadline |

There is **no fixed total session-duration limit**. Accepted token moves, rolls,
sheet edits, terrain/door changes, and turn actions by any authorized participant
in the live campaign count as meaningful activity. Background heartbeats,
reconnects, animations, unchanged autosaves, invalid requests, and duplicate
command retries do not. Camera movement alone does not reset the backend clock.

The owner-only Keep Session Active control handles quiet roleplaying without
requiring a fabricated world action. Between-game edits do not start a live
session. The first applicable pause condition wins: owner end, the all-disconnected
grace expiry, or the meaningful-inactivity expiry.

A logical reconnect grace period does **not** require keeping a physical instance
warm. Store deadlines durably and evaluate them on reconnect/commands; do not
depend on a background timer running while scaled to zero.

Keep ordinary presence/heartbeat traffic lightweight. Do not write a Firestore
record for every ping from every participant. If durable presence summaries are
needed for crash recovery, coalesce them at campaign level.

Authorized sheet edits and DM preparation can remain available between games as
short requests with ordinary conflict checks. World gameplay requires an active
live session. A browser sitting in a paused lobby must not hold an endless stream.

Once all active campaigns have closed their streams and requests finish, Cloud
Run can scale down. One paused campaign must not shut down another active one.
Open streaming requests count as active runtime even when little happens.

Handle graceful shutdown, but assume forced termination can occur. Accepted
state is already durable; reconnect restores it. Cloud Run's shutdown warning
is not a substitute for save-on-commit.

## 10. Legacy migration, backups, and recovery

### Migration: copy, verify, then cut over

1. Inventory both existing local test data sources. They contain separate saves
   and access keys; do not automatically merge records based on campaign names
   or whichever timestamp looks newest.
2. Take complete independent JSON exports before changes.
3. Sign into the chosen Firebase account and prove existing DM access on the
   trusted local host.
4. Select campaigns explicitly and show a migration preview.
5. Create new private cloud copies owned by the verified UID. Any claim or
   modification of an existing cloud campaign still requires its owner.
6. Validate character counts/IDs, rules/source pins, scene topology, images,
   combat state, assignments, and a restore/export round trip.
7. Rebind legacy player seats through account invitations without recreating
   saved characters. Do not infer identity from display names.
8. Complete a hosted rehearsal, then make the cloud copy the selected source of
   truth. Leave local originals untouched.

The local host can validate its own host key. The cloud backend must not trust a
browser assertion that "I was the local DM" as permission over someone else's
cloud campaign. Raw legacy keys and invitations do not belong in source control,
chat, client bundles, or cloud logs.

### Backups

Preserve the existing independent complete JSON backup behavior:

- When changed, target a snapshot at five-minute intervals during active work.
- Retain the newest 20 automatic complete backups per campaign initially.
- Keep the original rolling policy only; no additional daily restore-point tier
  was selected for the initial scope.
- Support explicit backup/download and a final changed-state snapshot on session
  end.
- Report backup failures separately from primary save success.
- Restore into a new private campaign, not an in-place destructive overwrite.
- Exclude credentials, invitation secrets, and trusted ownership claims from
  portable backup authority.

Do not depend on the current permanent `setInterval` backup loop in a sleeping
container. Evaluate due backups during active work and execute them as tracked
request/live-session work. Persist pending/failure status for retry after wake;
never claim an uncompleted backup succeeded.

Retain objects referenced by current heads and retained backups. Clean abandoned
uploads and superseded objects with bounded maintenance work, not an always-on
worker. The cleanup design must prevent deleting an object that a concurrent
commit or retained backup still needs. Restore/import creates new committed
objects rather than resurrecting an unprotected garbage-collection candidate.

Read-only inspection confirmed that the current Standard bucket has seven-day
soft delete, without object versioning or a bucket retention policy. Soft-deleted
objects can continue to incur storage charges during that recovery window.
Include those retained bytes in the forecast; logical cleanup does not mean
instant removal from billed storage. Keep that recovery protection initially
rather than disabling it without an explicit recovery/cost decision.

Do not enable irreversible retention locks or silently expand backup retention.
Longer daily/offsite retention is a separate policy decision.

### Rollback and outages

- Keep local originals and verified exports throughout the pilot.
- A cloud outage means visible read-only/disconnected behavior, not silent local
  writes presented as cloud saves.
- Roll back frontend/backend releases only across compatible data/protocol
  versions; drain or reject incompatible clients explicitly.
- If returning to local play after cloud edits, export the latest cloud data into
  a separate local copy. Do not pretend the old local original contains those edits.
- Test restoration, not merely backup creation.

## 11. Five deepening opportunities

These are five code Modules, **not five separate cloud deployments**. Exact new
Interfaces and file layouts should be designed after selecting a candidate for
deeper review. Each proposed Module should pass the deletion test: deleting it
would scatter necessary complexity back across its callers.

### 1. Account and Campaign Access Module

- **Files:** [SessionLogin.js](../../src/ui/sessions/SessionLogin.js),
  [CampaignLauncher.js](../../src/ui/campaigns/CampaignLauncher.js),
  [session-authority.js](../../tools/session-authority.js),
  [local-host.js](../../tools/local-host.js).
- **Problem:** local identity currently carries a global DM/player role and
  in-memory sessions. Cloud ownership, returning membership, and invitation
  redemption would otherwise be repeated in many callers.
- **Solution:** deepen the identity/access Seam so local-cookie and
  Firebase-identity Adapters share clear campaign-access outcomes, without
  granting global DM authority.
- **Leverage:** one Interface handles verified identity, campaign ownership,
  membership, and denial behavior.
- **Locality and tests:** access policy resides together. Test owned/joined lists,
  every permission-bearing operation, restart identity, invitation races, and
  revocation through the Interface.

### 2. Durable Campaign Commit Module

- **Files:** [CampaignStore.js](../../src/campaigns/CampaignStore.js),
  [CampaignCharacters.js](../../src/campaigns/CampaignCharacters.js),
  [CampaignAutosave.js](../../src/campaigns/CampaignAutosave.js),
  [campaign-storage.js](../../tools/campaign-storage.js),
  [campaign-backups.js](../../tools/campaign-backups.js).
- **Problem:** SQLite currently supplies transaction/durability guarantees that
  cannot be obtained by merely replacing disk calls with unrelated cloud writes.
- **Solution:** deepen the existing asynchronous storage Seam with a cloud
  Adapter that owns immutable publication, revision conflicts, receipts, and
  backup coordination. Keep the SQLite Adapter for explicit local mode.
- **Leverage:** callers keep meaningful save/commit operations instead of learning
  object staging and Firestore retry behavior.
- **Locality and tests:** fault-inject upload, commit, receipt, restart, backup,
  and concurrent-write failures through the Interface. The existing local and
  cloud Adapters make this a real Seam, not a hypothetical framework.

### 3. Participant Synchronization Module

- **Files:** [SessionConnection.js](../../src/campaigns/SessionConnection.js),
  [HostSessionUpdates.js](../../src/ui/sessions/HostSessionUpdates.js),
  [PlayerApplication.js](../../src/ui/sessions/PlayerApplication.js),
  [player-campaigns.js](../../tools/player-campaigns.js),
  [published-maps.js](../../tools/published-maps.js), plus the integrated
  interactive-player protocol and approved-motion Implementation.
- **Problem:** refresh coordination, private/public filtering, revisions, and
  movement presentation cross several callers; a connection change can affect
  both correctness and information disclosure.
- **Solution:** deepen the participant synchronization Seam with local-event and
  authenticated cloud-stream Adapters, ordered reconciliation, and one consistent
  participant projection policy.
- **Leverage:** callers consume authorized state/presentation changes without
  implementing retry, history, and visibility rules themselves.
- **Locality and tests:** exercise actual public outputs, duplicate delivery,
  reconnection, observer/door changes, revocation, and DM/player animations
  through the Interface.

### 4. Participant Cache Module

- **Files:** [ResourceSeeds.js](../../src/resources/ResourceSeeds.js),
  [CampaignWorkspace.js](../../src/campaigns/CampaignWorkspace.js),
  [HostCampaignStore.js](../../src/campaigns/HostCampaignStore.js),
  and participant-loading callers.
- **Problem:** existing resource caching is useful prior art, but it does not
  itself define authorized campaign caching, view generations, or cloud rejoin.
- **Solution:** deepen one cache Seam for integrity, account scope, asset reuse,
  eviction, and reconciliation. Reuse pinned catalog behavior rather than adding
  competing caches in individual screens.
- **Leverage:** one Interface supplies verified reusable bytes and reports cache
  availability without becoming authoritative game storage.
- **Locality and tests:** test UID changes, eviction, stale schemas, changed
  visibility, corrupted bytes, and exact network reuse through the Interface.

### 5. Live Session Lifecycle Module

- **Files:** [local-host.js](../../tools/local-host.js),
  [SessionConnection.js](../../src/campaigns/SessionConnection.js),
  [CampaignLauncher.js](../../src/ui/campaigns/CampaignLauncher.js), and the
  cloud entry Implementation.
- **Problem:** an open stream currently implies a running connection, with no
  durable business concept of starting, pausing, expiring, or resuming a game.
- **Solution:** deepen one lifecycle Seam that owns owner-controlled session
  idle deadlines, presence grace, pause/end behavior, and intentional reconnect policy.
- **Leverage:** UI and transport callers do not individually decide whether a
  game may remain live.
- **Locality and tests:** use controlled time and real connection outcomes to
  test quiet games, forgotten tabs, cold starts, explicit keep-active, and pause.

**ADR alignment:** none of these candidates reopens ADR-0001. Cloud mode is an
intentional addition to the current local-host domain described in
[CONTEXT.md](../../CONTEXT.md). After approval, add the new domain concepts and
record the hosting/persistence decisions; do not silently rewrite accepted local
behavior or duplicate terrain ownership.

## 12. Operating cost and safeguards

Rate-card amounts and illustrative usage costs below are USD before tax, based
on the referenced current prices, not actual project usage. The approved $25
monthly planning budget uses the existing Firebase budget; verify its configured
currency and convert the forecast appropriately before deployment.

### Workload forecast

| Item                                        | Planning expectation                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Shared gameplay runtime                     | 20-30 hours/month, not 200-300 server-hours                                              |
| Cloud Run compute                           | Likely within available request-based free allowances with one 1-vCPU/1-GiB instance     |
| Same compute without free allowances        | Approximately $1.91-2.86/month, excluding requests/network                               |
| Firestore document reads beyond free quota  | About $0.30/million                                                                      |
| Firestore document writes beyond free quota | About $0.90/million                                                                      |
| Firebase Hosting downloads                  | First 10 GB/month free; then $0.15/GB                                                    |
| Standard regional stored files              | Roughly $0.02/GiB-month before applicable free allowances; operations/downloads separate |

If a connected tab is forgotten after every game, the one-hour inactivity rule
can add up to five or six shared runtime hours monthly. The stated workload
would then be roughly 25-36 hours rather than 20-30. Closing all live connections
can let the backend sleep sooner; the 15-minute logical grace need not keep an
instance running.

Firestore's ordinary free document allowances are 50,000 reads and 20,000 writes
**per day**, not a pooled monthly balance. Six separate five-hour days with
180,000 reads and 18,000 writes each would incur roughly $0.23 in document
operation charges. This is an illustration, not a claim about measured traffic.

For Hosting delivery, ten users downloading 500 MB each on six occasions is
30 GB/month, or about $3 beyond its allowance. At 1 GB each per occasion, that
becomes 60 GB/month, or about $7.50. Actual cached reuse can reduce both.

The Oregon Storage bucket has its own pricing and qualifying free allowances.
Do not apply Hosting's $0.15/GB rate to every Storage download, or count the same
transfer twice. Account for live-state transfer from Cloud Run, object operations,
retained snapshots, deployment images, builds, and logs in the measured forecast.

Free allowances may be shared with other workloads, and destination/region/billing
mode can affect rates. A continuously active 1-vCPU/1-GiB instance for 30 days
would be about $63 at request-based active compute rates after those allowances,
before other charges. "Minimum instances zero" alone does not prevent this if
clients leave streams open.

### Safeguards

- Private-group access initially; campaign/upload/request quotas and authenticated
  streams, not unrestricted public account-driven resource creation.
- Minimum instances zero, initially maximum one, meaningful-activity idle expiry.
- No live stream in a paused lobby or permanent health-check traffic that keeps
  waking gameplay.
- Direct authorized asset delivery where appropriate; avoid proxying every large
  asset through the game backend unnecessarily.
- Bounded backups, reconnect history, staged uploads, caches, and log retention.
- Reuse the reported existing $25 monthly budget rather than create a duplicate.
  Verify currency, covered project/products, thresholds, and notification
  recipient before deployment. Suggested alert milestones are $5, $10, $15,
  and $25 in that currency; do not assume they are already configured.
- These are alerts, not hard caps. Billing reporting/notifications may lag usage;
  crossing a threshold does not automatically shut down games or disable billing.
- Review supported spend-cap options separately before claiming any exact cap.
  Do not disable billing as a casual safeguard: that can make stored data
  inaccessible.
- Measure active instance time, transfer bytes, operations per save, reconnects,
  and retained storage. Suppress token/body/secret logging.

Do not add a paid always-on database, network connector, or load balancer solely
for convenience; their baseline costs could exceed the entire expected budget.

## 13. Implementation milestones and approval gates

| Milestone                              | Deliverable                                                                                                     | Exit gate                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| M0: integration baseline               | Isolated integration checkout, reconciled QA/gameplay and current development work, payload/asset inventory     | Relevant gameplay tests characterized; no unrelated work overwritten; known baseline failures identified |
| M1: account/cloud vertical slice       | Both login methods, one owned test campaign, private cloud commit and reopen, second-UID denial                 | Restart preserves identity/state; wrong UID cannot obtain private data                                   |
| M2: ownership and persistence coverage | Owned/Joined launcher, invitation binding, all mutation/read/backup paths, idempotency, local Adapter preserved | Permission and atomicity matrix passes with emulator/failure injection                                   |
| M3: synchronization and cache          | Authenticated SSE, durable changes, authorized deltas, movement replay, cache/rejoin                            | Ten clients converge; no hidden-data disclosure or duplicate costs; unchanged assets reused              |
| M4: lifecycle and hosted pilot         | Sleep/wake rules, container/frontend packaging, runtime IAM, monitoring and alerts                              | Cold-start/forced-restart/lease tests pass in isolated hosted testing                                    |
| M5: migration rehearsal and cutover    | Explicit source selection, verified copies/backups, account-bound seats, full-session rehearsal                 | Owner approves data comparison, restore drill, and measured cost forecast                                |

Use the existing Jest/integration/browser tooling first, plus Firebase emulators
for owned cloud behavior. Add only necessary SDK/test dependencies. Expected
production SDK additions are Firebase's browser SDK and Admin SDK; no new
frontend framework is proposed.

Use emulator testing before live writes. A Hosting preview channel is not a
separate authentication/database environment. Prefer a separately approved test
project for hosted testing; include its usage in billing-account calculations.

Production needs a restricted runtime identity and deployment identity. Use
managed credentials, not developer ADC files or downloaded service-account keys
inside images. Grant only required datastore/object access and signing capability
where authorized download links need it.

No reliable delivery-date commitment should precede M0 and the first vertical
slice: integration differences and headless gameplay/runtime behavior are the
largest unknowns. These are gated milestones, not permission to ship unfinished
identity or persistence.

### Required acceptance checks

- Two unrelated UIDs cannot read, stream, alter, export, or obtain assets from
  each other's private campaigns.
- One UID can own one campaign and play in another without receiving global DM
  permissions.
- Production rejects emulator identity, forged identity claims, and expired
  tokens; allowed-origin handling never substitutes for identity verification.
- Both login methods, password-account email verification/recovery, and proven
  account linking work without changing UID-based campaign ownership or
  assignments. Matching unverified identity text cannot merge account access.
- Invite redemption races, revocation, account switching, and preserved character
  assignments behave correctly.
- Every acknowledged primary commit survives a forced backend termination.
- Upload failure, transaction conflict, lost response, duplicate command, and
  backup failure produce the correct receipt/error without partial resource costs.
- Free Play control, turn restrictions, ground/backward/flight/fall animations,
  queued movement, map resize, and hidden-origin filtering retain their intended
  behavior.
- Reconnect after gaps, timeout, token refresh, and backend replacement converges
  to the current authorized state without replaying old routes.
- Warm-cache rejoin fetches **zero unchanged asset bodies** when those entries
  remain valid and present; eviction/corruption causes an explicit re-download.
- An unchanging live board targets under **2 KiB/minute per participant of
  application heartbeat/presence payload**, excluding TLS and token renewal;
  no full-scene polling or per-heartbeat database writes.
- Under ten clients and a representative 200 ms round-trip network, target
  **p95 durable acknowledgement within two seconds for ordinary game commands**,
  excluding bulk uploads. Measure update delivery separately.
- Warn after 55 minutes without meaningful activity and pause at 60 minutes.
  An accepted participant action or explicit owner keep-active resets the
  deadline; heartbeats, unchanged autosaves, duplicate retries, stream reconnects,
  and backend replacement do not. Expired/ended sessions close streams and stop
  retry loops.
- Sleeping and resuming preserve committed combat state; no shutdown-only save
  dependency or writable local fallback is introduced.
- Between games, an authorized character read/save wakes the backend briefly
  without starting a live session or opening a permanent live stream.
- Connection loss reports unsaved work and blocks new mutations; there is no
  supported offline editor or queued offline upload workflow.
- A complete backup can restore to a separate private campaign and export again.
- Replay a representative workload and extrapolate to 30 shared gameplay hours,
  counting all operation, storage, and transfer categories. Target the approved
  $25 monthly planning budget using its verified currency; if it fails, present
  the revised forecast or change the Implementation before production approval.

## 14. Decisions to approve before implementation

### Approval record: November 10, 2026

**All ten section 14 design decisions are approved.** Item **4's online-only
scope is confirmed**. Item **2 was approved with Google and Firebase-managed
email/password**, email verification, password recovery, account-linking handling,
and invitation/approval-controlled private-pilot access. Item **6 was revised
and approved as one hour of meaningful inactivity**, with a 55-minute warning,
owner-only keep-active, and the existing 15-minute all-disconnected grace.
There is no fixed total session-duration limit. Item **7 was approved as the
original 20 rolling backups**, without an additional daily restore-point tier.
Item **8 was approved using the existing $25 monthly budget and alerts, not a
hard spending cap**. Its configuration must be verified before deployment;
no automatic billing shutdown is authorized.

These approvals do not authorize application implementation, deployment, new
billable infrastructure, or campaign migration. Production and cutover gates
remain in place.

### Approved design choices

1. Remote hosting with Firebase Hosting plus Cloud Run in Oregon; local rendering.
2. **Approved with both methods:** Google or Firebase-managed email/password,
   verified email before campaign use, password recovery, proven account linking,
   and invitation/approval-controlled access for the private pilot.
3. Per-campaign ownership/membership; owner-only start/end/manual keep-active
   controls.
4. **Scope confirmed November 10:** local performance caching with Internet
   required. Character edits between games use brief wake-ups. No offline
   viewing/editor, offline update queue, or automatic local/cloud merging.
5. HTTP commands and SSE, with direct authenticated cloud streaming.
6. **Approved revised policy:** pause after one hour of meaningful inactivity;
   warn at 55 minutes; allow an owner-only keep-active reset; retain the
   15-minute all-disconnected grace. No fixed total duration limit.
7. **Approved original policy:** twenty rolling automatic complete backups, with
   changed-state five-minute targeting, manual downloads, and restore-as-copy.
   No additional daily restore-point tier.
8. **Approved revised budget:** reuse the existing $25/month budget with alerts,
   not a hard cap or automatic billing shutdown. Verify currency, coverage,
   thresholds, and recipient before deployment.
9. Non-destructive selected migration only after data verification and rehearsal.
10. Formal Interface design after selecting a deepening candidate, starting with
    Account and Campaign Access plus the minimal Durable Campaign Commit vertical
    slice. No speculative framework or broad unrelated refactor.

Approving the design would start implementation planning; production deployment,
new billable infrastructure, and the actual data cutover remain explicit gates.
This proposal itself changes no application behavior and migrates no data.

## 15. Official references

Platform constraints and prices were checked against current documentation on
November 9, 2026. Recheck before deployment:

- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud Run autoscaling](https://cloud.google.com/run/docs/about-instance-autoscaling)
- [Cloud Run container contract: port, filesystem, shutdown](https://cloud.google.com/run/docs/container-contract)
- [Cloud Run streaming/reconnect considerations](https://cloud.google.com/run/docs/triggering/websockets)
- [Firebase Hosting with Cloud Run, including Hosting timeout](https://firebase.google.com/docs/hosting/cloud-run)
- [Hosting caching and forwarded cookies](https://firebase.google.com/docs/hosting/manage-cache)
- [Hosting storage and transfer pricing](https://firebase.google.com/docs/hosting/usage-quotas-pricing)
- [Firestore Standard pricing and daily free quotas](https://cloud.google.com/firestore/pricing)
- [Cloud Storage pricing](https://cloud.google.com/storage/pricing)
- [Cloud Storage soft delete](https://cloud.google.com/storage/docs/soft-delete)
- [Firebase Storage location/free-tier eligibility](https://firebase.google.com/docs/storage/locations)
- [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)
- [Email/password authentication](https://firebase.google.com/docs/auth/web/password-auth)
- [Linking authentication methods](https://firebase.google.com/docs/auth/web/account-linking)
- [Backend Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Billing safeguards and limits of alerts](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills)
