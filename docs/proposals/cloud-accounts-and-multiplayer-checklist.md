# Cloud accounts and multiplayer: execution checklist

**Created:** November 10, 2026

**Design reference:** [Approved proposal](./cloud-accounts-and-multiplayer.md)

**Implementation baseline:** [PR #28](https://github.com/sandeand001/TavernTable/pull/28),
merged as `25864ae4b551c19997da20e56f94126f4f53770c`. Its tree matches the
tested integration commit `f53bc6cb95341f946d9bf297623cfbb3e26eaf52`.

This is the task, status, and completion-evidence record. The proposal remains
the decision/rationale record. This checklist does not deploy services, migrate
data, or grant production approval.

## How to track work

- `[ ]` means not complete. If started or blocked, add `Status: in progress` or
  `Blocked: <reason/decision>` beneath that task; leave its checkbox unchecked.
- `[x]` means all success criteria are met and completion evidence is recorded.
  Add `Completed: <date>; Evidence: <PR/tests/report and measured result>`.
- Keep task IDs stable. Add follow-up IDs rather than renumbering completed work.
- Dependencies are actual prerequisites, not a requirement to finish every
  earlier phase. In particular, `M4-01` can be implemented before M3 streaming.
- Before marking implementation complete, run the smallest relevant existing
  tests, add regressions for changed behavior, and pass applicable lint/layering
  checks. Run the full stable suite at milestone/release gates. A skipped test,
  mocked persistence success, or unverified deployment is not completion proof.
- Keep evidence reproducible and redacted. Do not commit credentials, tokens,
  private campaign exports, or personal account data to document a test.
- Approval tasks require an explicit recorded owner decision. Completing nearby
  engineering tasks does not satisfy an approval task.

**Initial status:** existing setup and the integration baseline are recorded
below. Cloud application implementation has not started. Email/password enablement
and the existing billing budget were reported, not end-to-end verified.
No new cloud verification or infrastructure changes were performed to create
this checklist.

**Current work:** the isolated SDK loop, backend account gate and private owned
campaign metadata API are verified in `feat/cloud-accounts-multiplayer`.
Immutable object/save publication (`M1-07`) is next, before browser account and
returning-login integration (`M1-04` / `M1-05`). Nonempty cloud saves are not yet
implemented. No application deployment or campaign-data write has occurred;
the narrowly approved synthetic Storage/IAM canary is complete and cleaned up.

## Approved requirements: do not reopen by accident

| Area         | Required behavior                                                                                                                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting      | Firebase Hosting frontend; Cloud Run authority in Oregon; participant-side GPU rendering. The website and sign-in remain available while the game backend sleeps.                                                               |
| Identity     | Google and Firebase-managed email/password; verified email before campaign use; recovery and proven provider linking without changing the Firebase UID.                                                                         |
| Permissions  | Per-campaign owner/member roles; invitation/approval-controlled initial participation; only the owner starts, ends, or manually keeps a live game active.                                                                       |
| Connectivity | Internet required. Between-game sheet work uses short backend wake-ups. No offline viewing/editor, durable offline upload queue, or automatic local/cloud merging.                                                              |
| Transport    | Authenticated HTTP commands plus direct Fetch-based SSE, not a WebSocket rewrite or a long-lived Hosting rewrite.                                                                                                               |
| Sleeping     | Warn at 55 minutes, pause at 60 minutes without meaningful accepted activity; owner keep-active; 15-minute all-disconnected grace; first applicable pause condition wins. No total session-duration cap.                        |
| Backups      | Twenty rolling complete backups, five-minute changed-state targeting, manual download, final changed-state backup on session end, restore-as-copy. No additional daily tier.                                                    |
| Spending     | Reuse the reported existing $25 monthly budget and alerts; verify currency, coverage, thresholds, and recipient. It is not a hard cap or permission to shut off billing.                                                        |
| Migration    | Explicitly selected, non-destructive copies; verified data, restore drill, rehearsal, and separate production/cutover approvals.                                                                                                |
| Architecture | Start with Account and Campaign Access plus a minimal Durable Campaign Commit slice. Preserve the local Adapter and [ADR-0001](../adr/ADR-0001-terrain-engine-event-seam.md); no second terrain owner or speculative framework. |

Proposed starting parameters still need an implementation record and measured
validation: seven-day invitation expiry; a reconnect journal bounded to 1,000
changes and 24 hours; Cloud Run resource/concurrency settings; upload, request,
cache, log, and retention limits. These are not new approvals or guaranteed
performance results.

## Recorded completed setup

These checkboxes describe prior setup only, not hosted-release readiness.
Revalidation in the intended environment remains part of M1 and M4.

- [x] **S-01 - Record the existing Firebase project and development identity setup.**
  - **Success:** public web configuration, Google provider, development login
    domains, and local development authorization are recorded; no application
    account or returning-login integration is claimed.
  - **Evidence:** [proposal section 2](./cloud-accounts-and-multiplayer.md#2-current-position-and-constraints)
    and the existing [Firebase configuration](../../firebase.json).

- [x] **S-02 - Provision the regional durable metadata database.**
  - **Success:** Standard Firestore `(default)` exists in `us-west1` with deletion
    protection. Browser access is not opened to compensate for missing backend code.
  - **Evidence:** recorded provisioning in proposal section 2.

- [x] **S-03 - Provision private regional object storage and record recovery settings.**
  - **Success:** the Oregon bucket has uniform access and public-access prevention;
    seven-day soft delete is recorded without object versioning or a retention
    lock. Retained deleted bytes must be counted in later cost evidence.
  - **Evidence:** proposal sections 2 and
    [10](./cloud-accounts-and-multiplayer.md#10-legacy-migration-backups-and-recovery).

- [x] **S-04 - Establish deny-by-default browser datastore/object rules.**
  - **Success:** deployed rules deny direct browser campaign access; public Firebase
    web configuration is not treated as an administrator credential.
  - **Evidence:** recorded setup and committed
    [Firestore rules](../../firebase/firestore.rules) /
    [Storage rules](../../firebase/storage.rules). Recheck effective access before
    a hosted release; this is not a production security sign-off.

## Milestones and exit gates

| Milestone                                | Initial state      | Exit requirement                                                                                                                      |
| ---------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| M0 - Baseline and preparation            | Partially complete | Verified baseline, isolated migration workspace, measured inventory, and verification/decision record.                                |
| M1 - Account/cloud vertical slice        | Not started        | Both login methods; one privately owned campaign saved/reopened durably; restart, failure, and second-UID denial proofs.              |
| M2 - Ownership and complete persistence  | Not started        | Owned/Joined access, invitations, all storage paths, backups/restoration, and permission/atomicity coverage.                          |
| M3 - Synchronization and cache           | Not started        | Authorized incremental updates and replay; safe reconnect/cache reuse; ten-client convergence.                                        |
| M4 - Lifecycle and isolated hosted pilot | Not started        | Approved sleeping behavior; restricted deployment; hosted correctness, performance, monitoring, and measured cost evidence.           |
| M5 - Migration and production cutover    | Not started        | Selected-source copy/verification, account-bound seats, rehearsal, restore/rollback drill, and explicit production/cutover approvals. |

### M0 - Baseline and preparation

- [x] **M0-01 - Consolidate and verify all selected pre-cloud feature work.**
  - **Success:** approved feature/QA ancestry is on `main`; the merged tree matches
    the tested tree; originals and running test hosts are preserved.
  - **Evidence:** PR #28; 283 suites / 3,749 tests passed with zero skips. Full
    lint/layering passed with zero errors and 39 pre-existing warnings.

- [x] **M0-02 - Prepare an isolated migration workspace from the verified baseline.**
  - **Depends:** `M0-01`.
  - **Success:** a migration branch/worktree starts from merged `main`, not an
    older test checkout. Identify the existing test hosts/data sources without
    overwriting them or changing their access keys.
  - **Verify:** record base commit, clean worktree status, and a non-secret source
    inventory. Existing local test sessions remain usable.
  - **Completed:** November 10, 2026. **Evidence:**
    [workspace verification](./cloud-migration-preparation.md#workspace-evidence);
    verified baseline, byte-identical planning-document transfer, and both
    existing hosts responding HTTP 200.

- [x] **M0-03 - Measure payloads, assets, and redistribution inputs.**
  - **Depends:** `M0-02`.
  - **Success:** inventory representative scenes, character records, artwork,
    source packs, models, manifests, and complete backups. Record UTF-8 bytes,
    binary sizes, content hashes, licensing/notices, and large-file cases.
  - **Verify:** reproducible size/integrity report identifies data exceeding
    Firestore's 1 MiB document limit or relevant request/object limits. No
    private exports are committed as evidence.
  - **Completed:** November 10, 2026. **Evidence:**
    [inventory and limits](./cloud-migration-preparation.md#payload-and-asset-inventory);
    1,144 assets / 502,116,584 bytes, 16 validated pinned packs, two read-only
    local sources, seven inventory regressions plus four existing backup tests.
    License gaps are recorded for `M4-07`, not declared cleared.

- [x] **M0-04 - Establish the verification matrix and implementation decision record.**
  - **Depends:** `M0-03`.
  - **Success:** map the proposal's acceptance checks to tests and evidence; record
    provisional limits/settings, explicit local/cloud modes, and environment
    isolation. Do not silently change approved scope or promise a delivery date.
  - **Verify:** identify test UIDs/roles using labels, representative campaigns,
    fault cases, clocks, network conditions, and required approval gates. The
    first planned slice is M1, not a broad rewrite.
  - **Completed:** November 10, 2026. **Evidence:**
    [verification matrix and starting decisions](./cloud-migration-preparation.md#verification-matrix-and-initial-implementation-decisions);
    synthetic identity cases, failure/overlap/byte-limit proofs, deferred
    phase-specific limits, environment isolation and explicit approval gates.

### M1 - Account/cloud vertical slice

- [x] **M1-01 - Design the first access and durable-commit Interfaces.**
  - **Depends:** `M0-04`.
  - **Success:** document the Account and Campaign Access Module and minimal Durable
    Campaign Commit Module Interfaces: UID/ownership, errors, schemas/revisions,
    receipts, immutable publication, and local/cloud Adapter selection.
  - **Verify:** review against [proposal section 11](./cloud-accounts-and-multiplayer.md#11-five-deepening-opportunities)
    and ADR-0001. Existing callers retain meaningful operations; terrain has one
    authoritative owner and no speculative framework is introduced.
  - **Completed:** November 10, 2026. **Evidence:**
    [first-slice Interfaces](./cloud-account-save-slice.md), compared against
    CampaignStore/Characters/Workspace, local identity/transport, atomic SQLite
    behavior and ADR-0001. This completes design, not application implementation.

- [x] **M1-02 - Add the minimal SDK and emulator development path.**
  - **Depends:** `M1-01`.
  - **Success:** introduce only necessary Firebase browser/Admin SDK and test
    dependencies through manifests. Auth, Firestore, and Storage tests use explicit
    emulator configuration, separate from live data.
  - **Verify:** documented startup/test commands work with the supported Node
    runtime; ordinary tests cannot accidentally write to the real project.
    No credentials are embedded in bundles or fixtures.
  - **Completed:** November 11, 2026. **Evidence:**
    [isolated SDK/emulator proof](./cloud-migration-preparation.md#isolated-sdk-and-emulator-feedback-loop):
    approved checksum-verified portable Java 21, engine-compatible pinned SDKs,
    three real integration cases, three Jest guard cases, direct browser denials
    and complete helper shutdown. No live project was used.

- [x] **M1-03 - Implement verified UID identity and initial application eligibility.**
  - **Depends:** `M1-02`.
  - **Success:** the backend verifies Firebase identity independently, distinguishes
    application eligibility from ownership, and enforces verified-email/private-group
    access. Local cookie/CSRF behavior remains an explicit separate Adapter.
  - **Verify:** anonymous, forged, expired, unverified, and ineligible requests are
    denied at protected operations, not merely hidden in the UI.
  - **Completed:** November 11, 2026. **Evidence:**
    [backend account gate](./cloud-migration-preparation.md#backend-account-gate):
    real token/approval/disablement/HTTP cases, distinct typed service failures,
    no global DM claims or local-key fallback. Production-mode token rejection
    remains a separate hosted gate.

- [ ] **M1-04 - Implement Google and email/password sign-in, verification, and recovery.**
  - **Depends:** `M1-03`.
  - **Success:** both choices are usable; unverified password accounts cannot use
    campaigns; verification and password recovery return the same account to use.
    Firebase owns password handling.
  - **Verify:** browser flows cover success, cancellation, wrong credentials,
    unverified email, verification refresh, and recovery. No password values are
    logged or stored by TavernTable.

- [ ] **M1-05 - Implement returning login and explicit account/error states.**
  - **Depends:** `M1-04`.
  - **Success:** persistence/token renewal retain the UID across browser reopening
    and backend restart. Signed-out, expired, denied, and network states are
    distinct; failures never create a new campaign or writable local fallback.
  - **Verify:** reload, new tab, sign-out/in, expiry, renewal, and backend restart
    tests preserve identity/access or show the correct recoverable denial.

- [x] **M1-06 - Create and list one privately owned test campaign.**
  - **Depends:** `M1-03`.
  - **Success:** a verified eligible UID can explicitly create and reopen its test
    campaign. UID, not name/email, is the ownership key; authentication does not
    grant global DM authority.
  - **Verify:** another UID cannot list/open/read/write that private campaign,
    including direct requests bypassing the launcher.
  - **Completed:** November 11, 2026. **Evidence:**
    [private owned metadata](./cloud-migration-preparation.md#private-owned-campaign-metadata):
    real UID-authenticated create/list/open HTTP, unrelated-UID denial,
    current-eligibility checks, UID-scoped atomic create receipts, changed-intent
    conflicts and four-instance contention. Empty initial state is readable;
    nonempty snapshot publication remains `M1-07`, not an implied completed save.

- [ ] **M1-07 - Implement immutable cloud objects and atomic revision-head publication.**
  - **Status:** in progress. The
    [explicitly approved real Storage proof](./cloud-migration-preparation.md#immutable-object-primitive-approved-production-proof)
    verified 412 overwrite rejection and original-byte preservation. The
    synthetic object and exact-object temporary read grant were removed.
    The Firebase emulator's missing precondition behavior is characterized, not
    misreported as an immutable-write guarantee; atomic save publication is next.
  - **Depends:** `M1-01`, `M1-02`, `M1-06`.
  - **Success:** validate canonical state, stage/verify immutable Storage objects,
    then atomically publish head, receipt, and compact change record in Firestore.
    Recheck access/revisions in the transaction; no external side effects occur
    inside retryable callbacks.
  - **Verify:** upload failures leave no dangling head; transaction retries/conflicts
    cannot overwrite another change. Scenes, artwork, and backups are not placed
    in oversized Firestore documents.

- [ ] **M1-08 - Wire truthful save acknowledgement and existing checkpoint timing.**
  - **Depends:** `M1-07`.
  - **Success:** scene/character/resource visibility remains coordinated; show
    Saving / Saved to cloud / Not saved distinctly. Preserve two-second quiet /
    ten-second maximum scene checkpoints and stable movement checkpoints.
  - **Verify:** only a durable publication reports success. Drag previews,
    camera movement, and animation frames do not become continuous writes;
    unload/shutdown/filesystem state is not required for durability.

- [ ] **M1-09 - Reopen the committed slice in a clean browser and backend process.**
  - **Depends:** `M1-05`, `M1-08`.
  - **Success:** the same UID reopens the exact committed scene and characters
    from cloud authority without relying on the first browser's cache or local disk.
  - **Verify:** compare canonical IDs, rules/source pins, state, and revisions
    after backend replacement and a clean-browser load; repeat second-UID denial.

- [ ] **M1-10 - Pass the vertical-slice durability and isolation gate.**
  - **Depends:** `M1-09`.
  - **Success:** the complete slice passes existing regressions plus emulator and
    fault tests before widening implementation.
  - **Verify:** terminate before/after publication; lose the response; retry the
    same command; overlap two backend instances. Exactly one acknowledged result
    survives, with no duplicate move, resource cost, or reroll.

### M2 - Ownership and complete persistence

- [ ] **M2-01 - Implement Owned / Joined campaigns and campaign-local roles.**
  - **Depends:** `M1-10`.
  - **Success:** one UID can own one campaign and play in another. Launcher,
    metadata, and operation permissions agree; display/contact fields cannot
    confer ownership.
  - **Verify:** owner/member/unrelated-UID cases and account switching show only
    permitted campaigns and controls, with backend enforcement.

- [ ] **M2-02 - Implement account-bound invitation and redemption semantics.**
  - **Depends:** `M2-01`.
  - **Success:** owner-issued invitations are hashed, expiring, single-use, and
    attach a verified UID to the intended seat without recreating characters.
    Record the selected expiry, starting from the proposed seven days.
  - **Verify:** redemption races have one winner; expired/reused/revoked links
    fail; assignments survive. Matching display names/emails do not claim a seat.

- [ ] **M2-03 - Implement revocation, removal, assignments, and access generations.**
  - **Depends:** `M2-02`.
  - **Success:** revoking an unused invitation differs from removing membership.
    Removal/reassignment revokes future reads/writes/live access without deleting
    campaign-owned characters.
  - **Verify:** stale sessions, in-flight operations, manifests, and subsequent
    reconnects cannot regain revoked access; owner-only assignment controls work.

- [ ] **M2-04 - Implement proven sign-in-method linking without splitting ownership.**
  - **Depends:** `M1-05`, `M2-01`.
  - **Success:** Google/password credentials link only after proving control of
    both credentials; the existing UID, Owned/Joined campaigns, and assignments
    remain unchanged.
  - **Verify:** provider-conflict, cancellation, wrong-credential, and matching
    unverified-name/email cases never silently merge or create access.

- [ ] **M2-05 - Cover all canonical campaign and gameplay persistence paths.**
  - **Depends:** `M1-07`, `M2-01`.
  - **Success:** scene, sheets, resources, turns, movement, doors, terrain, images,
    and settings use the cloud Adapter's revision/receipt contract. Preserve
    edition-specific rules, stable IDs, canonical serialization, and explicit local mode.
  - **Verify:** mutation/CAS/idempotency tests run through real Adapter Interfaces;
    overlapping instances and lost responses do not partially spend or duplicate
    results. Re-run local SQLite behavior.

- [ ] **M2-06 - Implement private asset upload, finalization, and authorized delivery.**
  - **Depends:** `M2-05`.
  - **Success:** large assets can upload directly/resumably where needed; validate
    size, type, integrity, ownership, and final contents before publication.
    Delivery grants only current participant-authorized bytes.
  - **Verify:** tampering, partial upload, wrong UID/campaign, expiry, and revoked
    access fail. Manifests use hashes, not persisted bearer tokens or reusable
    signed URLs; hidden images/names are not shipped wholesale.

- [ ] **M2-07 - Implement bounded import/export and large-payload handling.**
  - **Depends:** `M2-06`, `M0-03`.
  - **Success:** complete canonical files remain portable without trusting imported
    ownership claims. Large request/object paths obey actual platform limits
    measured in UTF-8/binary bytes.
  - **Verify:** representative largest files round-trip; oversized, invalid,
    wrong-edition, or corrupt input produces an explicit error, not partial state.

- [ ] **M2-08 - Enforce private-pilot usage limits and abuse controls.**
  - **Depends:** `M2-01`, `M2-06`.
  - **Success:** record and enforce campaign, upload, storage, request, and stream
    limits for eligible accounts. Authentication alone cannot create unlimited
    billable work or confer access to existing campaigns.
  - **Verify:** boundary/over-limit, concurrent, and unauthorized requests cannot
    bypass limits through another endpoint or instance.

- [ ] **M2-09 - Implement complete rolling backups and independent backup status.**
  - **Depends:** `M2-05`, `M2-07`.
  - **Success:** retain 20 complete automatic backups; when changed, target
    five-minute intervals during active work. Provide manual backup/download.
    Track due/pending/failed work durably without a permanent interval worker.
  - **Verify:** unchanged state creates no needless backup; the 21st replaces only
    the eligible oldest backup. Failed backups never change primary-save success
    or claim completion, and retry after wake works.

- [ ] **M2-10 - Implement verified restore-as-copy.**
  - **Depends:** `M2-09`, `M2-06`.
  - **Success:** an owner restores a complete backup into a new private campaign,
    with validated data and fresh authority. The source is not overwritten;
    credentials/invitation secrets are excluded.
  - **Verify:** restore and export again; compare characters, IDs, images,
    rules/source pins, topology, combat state, and resources. Other UIDs cannot
    restore/export the owner's private backup.

- [ ] **M2-11 - Implement race-safe orphan/superseded-object cleanup.**
  - **Depends:** `M2-07`, `M2-09`, `M2-10`.
  - **Success:** bounded maintenance preserves objects referenced by current heads
    and all retained backups, including concurrent publication/restore. Restore
    creates protected committed objects rather than reviving a deletion candidate.
  - **Verify:** commit/backup/restore/cleanup races cannot delete needed data.
    Respect seven-day soft-delete billing; do not enable retention locks or
    disable recovery protection without a separate approved decision.

- [ ] **M2-12 - Support online between-game sheet work without a live game.**
  - **Depends:** `M2-03`, `M2-05`, `M4-01`.
  - **Success:** authorized sheet reads/edits and DM preparation use short requests
    with normal conflict checks. They do not start a live session; world gameplay
    still requires one.
  - **Verify:** read/save while paused succeeds only for permitted records; world
    commands fail; no permanent game stream or offline upload queue is created.
    Verify actual cold wake/sleep later in `M4-12`.

- [ ] **M2-13 - Pass complete persistence and implemented-operation access coverage.**
  - **Depends:** `M2-03`, `M2-04`, `M2-05`, `M2-08`, `M2-10`, `M2-11`, `M2-12`.
  - **Success:** all implemented list/read/write/asset/import/export/backup operations
    pass owner/member/unrelated-UID, concurrency, and fault cases. Record policy
    coverage for upcoming stream/lifecycle operations, then retest their real wires.
  - **Verify:** permission/atomicity matrix, emulator evidence, and full stable
    suite are green; no cloud failure falls back to writable browser storage.

### M3 - Synchronization and participant cache

- [ ] **M3-01 - Define and enforce participant snapshots, manifests, and deltas.**
  - **Depends:** `M2-13`.
  - **Success:** authorize underlying data before constructing explicit projections.
    Preserve one assigned observer, closed-room concealment, authorized asset
    names/bytes, safe physical rendering, and private-sheet/NPC-budget exclusion.
  - **Verify:** inspect serialized public outputs for hidden rooms, origins,
    blueprints, sheets, budgets, and secret-bearing full-map images. UI fog is
    not the privacy test.

- [ ] **M3-02 - Implement ordered durable changes and bounded reconnect history.**
  - **Depends:** `M1-07`, `M3-01`.
  - **Success:** committed heads/receipts and compact changes recover across a
    commit-to-announcement crash. Each active instance observes shared changes
    and fans out safe updates without full-database refreshes per viewer/ping.
  - **Verify:** duplicates, missing/out-of-order/stale/incompatible changes are
    detected. Record/test the selected bound, initially proposed as 1,000 changes
    and no more than 24 hours; older gaps require a fresh authorized snapshot.

- [ ] **M3-03 - Implement direct authenticated Fetch-based SSE.**
  - **Depends:** `M1-03`, `M3-02`, `M4-01`.
  - **Success:** verified identity travels in authorization headers; streams use
    the Cloud Run address, exact allowed origins, deliberate preflight, and
    live-session access checks. Keep local cookie/CSRF transport intact.
  - **Verify:** no Firebase bearer token in URLs; no reliance on native EventSource
    custom headers or Hosting's long-lived rewrite. Expired/revoked/anonymous/
    cross-campaign streams fail.

- [ ] **M3-04 - Implement reconciliation, gap recovery, and intentional reconnects.**
  - **Depends:** `M3-03`.
  - **Success:** apply a contiguous authorized revision sequence or a fresh snapshot;
    refresh identity and reconnect with jitter before request timeout. Replacements
    converge without replaying historical movement.
  - **Verify:** timeout, lost event, duplicate, backend replacement, and token
    renewal tests converge. Paused/ended sessions stop retrying; world commands
    stay disabled until reconciliation completes.

- [ ] **M3-05 - Preserve native DM/player movement and animation presentation.**
  - **Depends:** `M3-04`.
  - **Success:** Free Play and combat restrictions remain correct; approved routes
    replay Walk/Run, backward movement, flight, falls, queued continuity, and
    cancellation without recharging costs.
  - **Verify:** real DM/player interactions cover both directions, resize,
    observer/door/visibility changes, stale origins, and asset-scope transitions.
    No animation-frame persistence or second terrain owner is introduced.

- [ ] **M3-06 - Implement account/view-scoped, integrity-checked cache storage.**
  - **Depends:** `M3-01`, `M2-06`.
  - **Success:** IndexedDB holds participant metadata/checkpoints; Cache Storage
    holds reusable binary assets. Partition private entries by UID, campaign,
    schema and access/view generation; public catalogs remain separate.
  - **Verify:** validate hashes/schemas; keep 2014/2024 resource databases and pinned
    versions separate. Campaign manifests never persist bearer tokens or reusable
    signed URLs, and campaign files do not use localStorage.

- [ ] **M3-07 - Implement progressive first join and bounded cache management.**
  - **Depends:** `M3-06`.
  - **Success:** load the active authorized area, assigned sheets, and required
    assets first; load other permitted areas on demand. Provide usage/clear-cache
    controls, bounded eviction, and best-effort persistence handling.
  - **Verify:** quota denial, browser eviction, corrupt bytes and stale schemas
    trigger explicit recovery/re-download. No cache becomes the only saved copy
    or an excuse to download the whole private campaign.

- [ ] **M3-08 - Prove warm-cache rejoin and authoritative state recovery.**
  - **Depends:** `M3-04`, `M3-07`.
  - **Success:** rejoin verifies current identity/access, revisions, hashes and view
    before enabling commands. Reuse valid unchanged assets and replace stale
    participant state when necessary.
  - **Verify:** network instrumentation shows **zero unchanged asset-body downloads**
    when valid entries remain present. Eviction/corruption causes an explicit
    download; do not count a cached UI appearance as proof of network reuse.

- [ ] **M3-09 - Implement logout, access-change, and connection-loss safety.**
  - **Depends:** `M1-05`, `M3-04`, `M3-06`.
  - **Success:** logout/account switching clears private cache state; membership/
    observer changes purge superseded scope and cancel stale work. Connection loss
    blocks new mutations and visibly preserves only already-unacknowledged edits
    for online recovery.
  - **Verify:** another UID never sees the previous user's view. Reauthenticate
    and reconcile before editing; no offline editor, durable offline queue, or
    automatic local/cloud conflict merge is introduced.

- [ ] **M3-10 - Pass ten-client convergence and synchronization acceptance.**
  - **Depends:** `M3-05`, `M3-08`, `M3-09`.
  - **Success:** ten concurrent clients converge to the same committed authority
    with participant-specific visibility, no duplicate gameplay costs, and
    no secret-bearing public output.
  - **Verify:** record convergence/reconnect tests, actual transferred bytes,
    receipt counts and replay behavior. Prepare the 200 ms RTT performance and
    idle-payload measurements for the hosted gate; run the full stable suite.

### M4 - Lifecycle, deployment, and isolated hosted pilot

`M4-01` is an early prerequisite for M2/M3, not permission to deploy M4 early.

- [ ] **M4-01 - Implement durable owner-controlled live-session state.**
  - **Depends:** `M2-01`, `M1-07`.
  - **Success:** distinguish account sessions, live games and combat turns.
    Owner-only start/end/keep-active is campaign-scoped; world commands require
    live status, while permitted between-game work does not.
  - **Verify:** role/state-transition tests persist across backend replacement.
    A membership or successful login cannot start/extend somebody else's game.

- [ ] **M4-02 - Implement meaningful-activity deadlines and owner keep-active.**
  - **Depends:** `M4-01`, `M2-05`.
  - **Success:** warn at **55 minutes**, pause at **60 minutes** without meaningful
    accepted activity. Authorized moves, rolls, sheet/terrain/door/turn actions
    or explicit owner keep-active reset the deadline; there is no total-duration cap.
  - **Verify:** controlled-clock tests prove heartbeats, reconnects, animations,
    camera movement, unchanged autosaves, invalid requests, duplicate retries and
    backend replacement do **not** reset it. Active games can continue beyond six hours.

- [ ] **M4-03 - Implement durable presence grace and earliest-pause evaluation.**
  - **Depends:** `M4-02`.
  - **Success:** everyone disconnected starts a **15-minute** reconnect grace;
    owner end, grace expiry, or inactivity expiry pauses at whichever applies first.
    Presence is coalesced, not a Firestore write for every participant ping.
  - **Verify:** evaluate stored deadlines on requests/reconnects after zero runtime;
    expiry remains correct without a continuously running timer. Test boundary
    races and reconnects without resetting meaningful activity.

- [ ] **M4-04 - Drain/pause/end safely and stop unwanted live traffic.**
  - **Depends:** `M4-03`, `M3-03`, `M2-09`.
  - **Success:** accepted work is durable; pause/end closes streams and stops
    reconnect loops. Schedule the final changed-state complete backup and retain
    pending/failure status. Preserve campaign, turn, HP, budgets and resources.
  - **Verify:** pause/end/disconnect during accepted work; backup failure remains
    separate. A paused lobby has no endless stream, and pausing one campaign does
    not shut down another active campaign.

- [ ] **M4-05 - Pass forced-restart and overlapping-instance lifecycle tests.**
  - **Depends:** `M4-04`, `M4-06`.
  - **Success:** runtime memory, local files and shutdown callbacks are not durability
    or lease authority. Duplicate delivery, replacement and temporary instance
    overlap cannot reset deadlines or publish conflicting state.
  - **Verify:** kill/replace the container at commit, notification, backup and
    reconnect boundaries; recover committed state and correct live status.

- [ ] **M4-06 - Package the cloud entry and bounded starting runtime configuration.**
  - **Depends:** `M1-10`, `M0-03`.
  - **Success:** a supported Node 24 image meets the project's Node 24.4+ floor,
    listens on `0.0.0.0:$PORT`, and uses managed credentials. Record initial
    request-based settings: 1 vCPU / 1 GiB, minimum 0, maximum 1, concurrency 40,
    and at most 60-minute requests, subject to load-test results.
  - **Verify:** container/readiness/configuration checks pass without a server GPU,
    developer ADC files, service-account keys, or reliance on a writable
    filesystem. Maximum-one-instance is not used as a correctness guarantee.

- [ ] **M4-07 - Produce a versioned, allowlisted public frontend package.**
  - **Depends:** `M0-03`, `M1-04`, `M3-07`.
  - **Success:** Hosting serves only approved app/catalog assets with required
    redistribution notices. It never publishes the repository root, server/admin
    tooling, credentials, SQLite files, backups or private campaign data.
  - **Verify:** inspect the actual deploy output/manifest and prohibited-path
    requests. Versioned asset/schema behavior supports deliberate compatibility
    handling and each participant still renders locally.

- [ ] **M4-08 - Obtain isolated hosted-test and identity/IAM configuration approval.**
  - **Depends:** `M4-06`, `M4-07`.
  - **Success:** record the approved test project, billable resources, runtime/
    deployment identities and least-required datastore/object/signing permissions.
    A Hosting preview is not mistaken for a separate Auth/database environment.
  - **Verify:** explicit owner approval precedes provisioning, IAM changes, or
    live writes. No downloaded service-account key or developer ADC enters an image.

- [ ] **M4-09 - Deploy and smoke-test only the approved isolated environment.**
  - **Depends:** `M4-08`.
  - **Success:** the default Hosting URL opens independently; browsers use the
    configured Cloud Run HTTPS address with exact origins/auth domains. Platform
    invocation permits browser access as needed, but application identity/access
    still protects every campaign operation.
  - **Verify:** real Google/password/verification/recovery flows, private save/
    reopen and asset delivery work there. No production campaign is migrated or
    source-of-truth switch performed.

- [ ] **M4-10 - Pass hosted identity, authorization, privacy, and configuration gates.**
  - **Depends:** `M4-09`, `M2-03`, `M2-04`, `M2-08`, `M3-01`.
  - **Success:** production-intended configuration rejects emulator/forged/expired
    identity and unauthorized operations; CORS/platform reachability never
    substitutes for Firebase verification or campaign access.
  - **Verify:** run the real HTTP/stream/asset/backup permission matrix; account
    linking/switching, revocation, origin preflight, quotas and private rule/IAM
    checks pass. Logs and deployed packages disclose no credentials/private bodies.

- [ ] **M4-11 - Configure observable operation/cost metrics and verify existing alerts.**
  - **Depends:** `M4-09`.
  - **Success:** measure active instance time, acknowledgements vs delivery,
    reads/writes per save, transfer by delivery path, reconnects, retained/soft-deleted
    bytes, backup failures, builds/images and bounded logs.
  - **Verify:** reuse the reported $25 budget; record its actual currency, project/
    product coverage, thresholds and recipient using redacted evidence. Review the
    proposed 5/10/15/25 alert milestones; verify notification configuration.
    Alerts are not a hard cap, and no automatic billing shutdown is introduced.

- [ ] **M4-12 - Pass hosted scale-to-zero, lifecycle, cache, and performance tests.**
  - **Depends:** `M4-09`, `M4-05`, `M3-10`, `M4-11`.
  - **Success:** the website/Auth work with no game instance; short authorized
    sheet work wakes the backend without starting a game/stream; inactive games
    let runtime sleep. Record cold-wake experience for owner acceptance.
  - **Verify:** with ten clients and representative **200 ms RTT**, ordinary
    commands target **p95 durable acknowledgement <= 2 seconds**, excluding bulk
    uploads; measure delivery separately. An unchanged board targets **< 2 KiB/min
    per participant** of app heartbeat/presence payload, excluding TLS/token renewal.
    No full-scene polling or per-heartbeat database writes; warm rejoin downloads
    zero valid unchanged asset bodies. Exercise 55/60/15-minute boundaries.

- [ ] **M4-13 - Produce and review the measured hosted-pilot cost/readiness report.**
  - **Depends:** `M4-10`, `M4-12`, `M2-11`.
  - **Success:** extrapolate measured representative work to **30 shared gameplay
    hours/month**, adding wake-ups, idle tail and all storage/operation/transfer/
    build/log categories. Include 20 backups, soft-delete retention, shared free
    allowances, and current region/delivery-specific prices without double counting.
  - **Verify:** compare in the verified budget currency against the $25 planning
    budget. If targets or forecast fail, fix/retest or obtain a revised owner
    decision; do not claim the initial $0-10 estimate as a measured guarantee.
    No convenience always-on database, connector or load balancer is added.

### M5 - Selected migration, rehearsal, and production cutover

- [ ] **M5-01 - Select migration sources and authorize a rehearsal copy.**
  - **Depends:** `M0-02`, `M4-13`.
  - **Success:** inventory both local test data sources; explicitly select
    campaigns, destination/test environment and owner UID. Prove trusted local
    DM access without making browser assertions or old keys into cloud ownership.
  - **Verify:** record owner approval for the selected rehearsal copies. Names/
    newest timestamps do not choose/merge campaigns; raw legacy keys/invitations
    are not copied to bundles, Git, chat or cloud logs.

- [ ] **M5-02 - Preserve independent original exports and show a migration preview.**
  - **Depends:** `M5-01`.
  - **Success:** make complete independent JSON exports/checksums before changes;
    preview selected records, roles/assignments, unsupported data and expected
    new private cloud copies.
  - **Verify:** original local data remains untouched and recoverable. The
    approved selection/preview matches actual source versions, not an older QA
    checkout or similarly named campaign.

- [ ] **M5-03 - Create non-destructive private rehearsal copies.**
  - **Depends:** `M5-02`.
  - **Success:** publish validated new cloud copies in the approved rehearsal
    environment under the verified UID. Existing cloud campaigns still require
    their current owner's authority.
  - **Verify:** repeated/interrupted import cannot partially replace a campaign
    or duplicate costs. Portable ownership claims and legacy secrets are not
    trusted; no local original is overwritten or silently kept in writable sync.

- [ ] **M5-04 - Compare all migrated data and complete the export/restore round trip.**
  - **Depends:** `M5-03`, `M2-10`.
  - **Success:** verify character counts/IDs, edition/source pins, scene topology,
    images/assets, terrain, combat state, resources and assignments. Document
    expected new-campaign metadata differences explicitly.
  - **Verify:** export the cloud copy, restore a separate private copy and compare
    canonical data/integrity again. Successful object upload alone does not pass.

- [ ] **M5-05 - Bind returning players to verified account seats.**
  - **Depends:** `M5-04`, `M2-02`, `M2-03`, `M2-04`.
  - **Success:** existing seats/character assignments attach through account-bound
    invitations without recreated records or display-name guessing. Cloud login
    no longer depends on a local host key or reusable bearer invitation.
  - **Verify:** intended participants return through both supported sign-in
    methods as applicable; removal/reissue/linking retains the correct data and
    never grants another seat's access.

- [ ] **M5-06 - Run a representative ten-client, full-session rehearsal.**
  - **Depends:** `M5-05`, `M4-12`.
  - **Success:** exercise a representative four-to-five-hour session: Free Play,
    combat, doors/rooms, assets, sheets, animation, reconnects, backup work and
    owner controls, with no divergence, disclosure or duplicate costs.
  - **Verify:** record actual latency, bytes, operations and retained storage;
    include forced replacement and quiet/forgotten/disconnected cases. Controlled
    time proves no fixed six-hour cap. Re-run the complete acceptance matrix.

- [ ] **M5-07 - Prove recovery and release rollback, not just backup creation.**
  - **Depends:** `M5-06`.
  - **Success:** restore a real complete backup to a separate private campaign;
    test compatible frontend/backend rollback and explicit rejection/draining of
    incompatible clients.
  - **Verify:** if local play is needed after cloud edits, export the latest cloud
    state to a separate local copy. Demonstrate that the preserved old original
    is not misrepresented as containing later cloud changes.

- [ ] **M5-08 - Obtain explicit production-deployment approval.**
  - **Depends:** `M5-07`, `M4-13`.
  - **Success:** the owner accepts the data comparison, permissions, restore drill,
    cold-wake experience, performance and measured cost forecast, and approves
    the named production resources/release.
  - **Verify:** record the decision and any conditions before production
    deployment/IAM/resource changes. Design approval, emulator success, or a
    checklist checkbox alone is insufficient.

- [ ] **M5-09 - Deploy the approved production release without cutting over data yet.**
  - **Depends:** `M5-08`.
  - **Success:** deploy only the approved frontend/backend/configuration with
    managed identities, effective private rules, compatible versions and working
    alerts. Do not silently switch the group's campaign authority.
  - **Verify:** production smoke tests use approved disposable data and check
    login, denial, durable save/reopen, asset delivery and sleep/wake. Record
    release identifiers and rollback readiness.

- [ ] **M5-10 - Obtain final selected-data cutover approval.**
  - **Depends:** `M5-09`.
  - **Success:** the owner approves the exact latest campaign copies, participant
    bindings and source-of-truth switch after production smoke testing. Account
    for local edits made since rehearsal by explicit verified copying, not merging.
  - **Verify:** record final comparisons/backups and the agreed transition of
    selected local authoring to cloud authority. Existing local copies remain
    preserved; two writable automatic masters are never introduced.

- [ ] **M5-11 - Execute cutover and verify the first production session.**
  - **Depends:** `M5-10`.
  - **Success:** the group uses the approved cloud campaigns through the single
    website; account return, primary saves, backups, access, sleeping and cost
    monitoring behave as verified. Local originals remain recovery material.
  - **Verify:** record the first representative production-session results,
    outstanding incidents and actual usage against the accepted forecast.
    Failures trigger the tested recovery/revised approval path, not silent local
    fallback or premature completion.

## Acceptance coverage map

This table points to the task containing the evidence; it is not a second set
of independently maintained completion checkboxes.

| Proposal acceptance requirement                                                                    | Primary evidence tasks             |
| -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Private campaigns isolated across unrelated UIDs, including streams/assets/exports                 | `M1-06`, `M2-13`, `M3-01`, `M4-10` |
| One UID owns one campaign and joins another without global DM authority                            | `M2-01`, `M4-01`                   |
| Both login methods; verification/recovery; proven same-UID linking                                 | `M1-04`, `M1-05`, `M2-04`, `M4-09` |
| Invite races, revocation, account switching and preserved assignments                              | `M2-02`, `M2-03`, `M3-09`, `M5-05` |
| Production rejects emulator, forged and expired identity; CORS is not authorization                | `M1-03`, `M3-03`, `M4-10`          |
| Every acknowledged save survives termination; conflicts/retries never partially spend              | `M1-07`, `M1-10`, `M2-05`, `M4-05` |
| Backup failures are independent; complete backup restores/exports as a private copy                | `M2-09`, `M2-10`, `M5-07`          |
| Free Play/combat, queued/native motion, resize and hidden-origin correctness                       | `M3-05`, `M3-10`, `M5-06`          |
| Gaps/timeouts/renewal/replacement reconcile without historical route replay                        | `M3-04`, `M4-05`                   |
| Warm cache transfers zero valid unchanged asset bodies                                             | `M3-08`, `M4-12`                   |
| Idle app heartbeat/presence < 2 KiB/min/participant, no scene polling/ping writes                  | `M4-03`, `M4-12`                   |
| Ten clients, 200 ms RTT, ordinary durable command acknowledgement p95 <= 2 s                       | `M4-12`, `M5-06`                   |
| 55-minute warning, 60-minute inactivity pause, owner keep-active, 15-minute grace, no total cap    | `M4-02`, `M4-03`, `M4-04`, `M5-06` |
| Sleeping/restarting preserves combat; between-game online work wakes briefly                       | `M2-12`, `M4-05`, `M4-12`          |
| Connection loss blocks mutations; no offline editor/queue or automatic merging                     | `M3-09`, `M5-10`                   |
| Thirty shared hours plus all cost categories fit the verified budget or receive a revised decision | `M4-11`, `M4-13`, `M5-08`          |
| Website/Auth independent of a sleeping game backend                                                | `M4-09`, `M4-12`                   |
| Originals preserved; selected verified migration and explicit production/cutover approval          | `M5-01` through `M5-11`            |
