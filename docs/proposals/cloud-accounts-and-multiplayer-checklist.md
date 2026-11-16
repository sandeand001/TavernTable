# Cloud accounts and multiplayer: execution checklist

**Created:** November 10, 2026

**Last updated:** November 16, 2026

**Implementation branch:** `feat/cloud-accounts-multiplayer`. Completion below
refers to that migration branch, not to an older checkout displaying this file.

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
- Update the progress count, milestone table and current status whenever a task,
  verification result, approval or blocker changes.
- When implementation uses a separate worktree, synchronize this checklist and
  its preparation/evidence log to the user's working checkout. Do not leave
  progress updates visible only in the implementation worktree.
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

## Current status

**59 of 65 tasks complete.** This includes the four setup tasks and excludes
the separately deferred routine-save UX task. M0 through M4 and `M5-01` through
`M5-05` are complete; the six remaining migration tasks are `M5-06` through
`M5-11`.

- **Current task:** `M5-06`, the representative ten-client, four-to-five-hour
  rehearsal. It is not complete. The latest attempt stopped after **44 minutes
  24.697 seconds**: one player's presence ACK returned `campaign-not-found`
  during renewal and the client latched a denial. The same verified UID still
  passes fresh original-seat access and participant-snapshot checks. This is
  reproduced and fixed locally as a channel-liveness/access-classification bug:
  **13 coupled lifecycle cases and 87 client/SSE unit tests pass**. The fixed
  image is now privately published and its live stale-ACK/reopen probe passes
  without any account or seat reset. A fresh fixed-release full-duration run is
  **running from 2026-11-16T21:08:32.666Z**; it is not yet a four-hour pass.
  All **83 accepted world
  commands** and the earlier helper failures are retained; no aborted time is
  credited to the required full-duration run.
- **Latest complete regression baseline (`103ac90...`):** **307 suites / 4,067 tests passed** in
  **1,820.696 seconds**, with open-handle detection. The focused native movement
  gate also passes **32 tests**, and three recovery-readiness emulator cases pass.
- **Private pilot:** API `00025-vt4`, implementation `f5d0d10...`, exact image
  `792fcc39...`, unchanged frontend `57cb5484...`. Gameplay is live only for the
  approved bounded private rehearsal. The previous run/probe ended safely with
  complete saved backup at generation **219**; the new run excludes that setup
  and every aborted attempt.
- **Owner-deferred check:** manual DM/player animation verification will be done
  by the owner after the remaining work. This is deferred, not an observed pass.
  A short delay is acceptable; disjointed live movement remains the concern.
  The original two-second benchmark failure is retained, not relabeled.
- **Next:** finish `M5-06`, then perform the actual private backup restore and
  compatible rollback/drain drill (`M5-07`). Separate production approval,
  deployment, selected-data cutover approval and first production-session
  verification remain (`M5-08` through `M5-11`).
- **Still deferred:** `UX-01`, disruptive save flashing/centered feedback, until
  after `M5-11`. Originals, host keys and the real owner account remain untouched.

Detailed completion evidence and historical measurements are recorded under each
task and in [the preparation log](./cloud-migration-preparation.md).

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
| Spending     | Owner-approved project-only USD 25 monthly alerts: 50/90/100% actual and 100% forecast, with existing billing/project-owner email recipients. No spend cap or automatic billing shutdown. M4-11 records the separately approved setup after finding no existing budget.                       |
| Migration    | Explicitly selected, non-destructive copies; verified data, restore drill, rehearsal, and separate production/cutover approvals.                                                                                                |
| Architecture | Start with Account and Campaign Access plus a minimal Durable Campaign Commit slice. Preserve the local Adapter and [ADR-0001](../adr/ADR-0001-terrain-engine-event-seam.md); no second terrain owner or speculative framework. |

Starting parameters and their measured validation are recorded in the completed
task evidence and preparation log. Defaults alone are not verification, new
approvals or guaranteed performance results.

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

| Milestone                                | Current status     | Exit requirement                                                                                                                      |
| ---------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| M0 - Baseline and preparation            | Complete: 4/4      | Verified baseline, isolated migration workspace, measured inventory, and verification/decision record.                                |
| M1 - Account/cloud vertical slice        | Complete: 10/10    | Both login methods; one privately owned campaign saved/reopened durably; restart, failure, and second-UID denial proofs.              |
| M2 - Ownership and complete persistence  | Complete: 13/13    | Owned/Joined access, invitations, all storage paths, backups/restoration, and permission/atomicity coverage.                          |
| M3 - Synchronization and cache           | Complete: 10/10    | Authorized incremental updates and replay; safe reconnect/cache reuse; ten-client convergence.                                        |
| M4 - Lifecycle and isolated hosted pilot | Complete: 13/13    | Approved sleeping behavior; restricted deployment; hosted correctness, performance, monitoring, and measured cost evidence.           |
| M5 - Migration and production cutover    | In progress: 5/11  | Selected-source copy/verification, account-bound seats, rehearsal, restore/rollback drill, and explicit production/cutover approvals. |

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

- [x] **M1-04 - Implement Google and email/password sign-in, verification, and recovery.**
  - **Depends:** `M1-03`.
  - **Success:** both choices are usable; unverified password accounts cannot use
    campaigns; verification and password recovery return the same account to use.
    Firebase owns password handling.
  - **Verify:** browser flows cover success, cancellation, wrong credentials,
    unverified email, verification refresh, and recovery. No password values are
    logged or stored by TavernTable.
  - **Completed:** November 11, 2026 for the emulator development slice.
    **Evidence:** [managed browser account access](./cloud-migration-preparation.md#managed-browser-account-access):
    actual Google success/cancellation, managed email registration, password
    clearing, wrong credentials, real verification/recovery action codes,
    unchanged recovered UID, distinct pilot denial and approved account access.
    Real hosted provider validation remains a later environment gate.

- [x] **M1-05 - Implement returning login and explicit account/error states.**
  - **Depends:** `M1-04`.
  - **Success:** persistence/token renewal retain the UID across browser reopening
    and backend restart. Signed-out, expired, denied, and network states are
    distinct; failures never create a new campaign or writable local fallback.
  - **Verify:** reload, new tab, sign-out/in, expiry, renewal, and backend restart
    tests preserve identity/access or show the correct recoverable denial.
  - **Completed:** November 11, 2026 for the emulator development slice.
    **Evidence:** [M1 browser/restart acceptance](./cloud-migration-preparation.md#m1-browser-and-restart-acceptance):
    reload/new-tab restoration, Google return in real Chrome, actual SDK renewal,
    managed same-UID recovery and actual backend replacement. Failures never
    create a campaign or select local authority. Hidden integrated-webview
    sign-out notification took about 44 seconds; immediate cross-tab notification
    is not claimed.

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

- [x] **M1-07 - Implement immutable cloud objects and atomic revision-head publication.**
  - **Depends:** `M1-01`, `M1-02`, `M1-06`.
  - **Success:** validate canonical state, stage/verify immutable Storage objects,
    then atomically publish head, receipt, and compact change record in Firestore.
    Recheck access/revisions in the transaction; no external side effects occur
    inside retryable callbacks.
  - **Verify:** upload failures leave no dangling head; transaction retries/conflicts
    cannot overwrite another change. Scenes, artwork, and backups are not placed
    in oversized Firestore documents.
  - **Completed:** November 11, 2026. **Evidence:**
    [atomic canonical publication](./cloud-migration-preparation.md#atomic-canonical-publication):
    45 native SDK/HTTP cases cover real character callers, 2014/2024 and v3
    connected-map preservation, large scene separation, overlaps, identical
    retries, mid-upload revocation, actual transaction rollback and safe errors.
    The separately approved real Storage canary proved 412 enforcement and was
    fully cleaned up, including its exact-object temporary IAM grant.
    Browser save UX and complete M1 termination/reopen gates remain unchecked.

- [x] **M1-08 - Wire truthful save acknowledgement and existing checkpoint timing.**
  - **Depends:** `M1-07`.
  - **Success:** scene/character/resource visibility remains coordinated; show
    Saving / Saved to cloud / Not saved distinctly. Preserve two-second quiet /
    ten-second maximum scene checkpoints and stable movement checkpoints.
  - **Verify:** only a durable publication reports success. Drag previews,
    camera movement, and animation frames do not become continuous writes;
    unload/shutdown/filesystem state is not required for durability.
  - **Completed:** November 11, 2026 for the emulator development slice.
    **Evidence:** [M1 browser/restart acceptance](./cloud-migration-preparation.md#m1-browser-and-restart-acceptance):
    actual browser lost-reply recovery, rendered scene/character persistence,
    truthful dirty/checkpoint feedback, offline/conflict/exit guards and unchanged
    checkpoint regressions. All 52 native SDK/HTTP cases pass. The disruptive
    routine-save presentation is separately deferred as `UX-01`, not silently
    treated as post-migration polish already completed.

- [x] **M1-09 - Reopen the committed slice in a clean browser and backend process.**
  - **Depends:** `M1-05`, `M1-08`.
  - **Success:** the same UID reopens the exact committed scene and characters
    from cloud authority without relying on the first browser's cache or local disk.
  - **Verify:** compare canonical IDs, rules/source pins, state, and revisions
    after backend replacement and a clean-browser load; repeat second-UID denial.
  - **Completed:** November 11, 2026 for the emulator development slice.
    **Evidence:** [M1 browser/restart acceptance](./cloud-migration-preparation.md#m1-browser-and-restart-acceptance):
    actual Chrome document reload restores the saved v3 castle and linked
    character; canonical scene fields, source pins, actor identity/position and
    exact character bytes survive. Separate real HTTP tests kill/replace backend
    processes with empty working directories, reopen the exact committed data
    through fresh clients and repeat unrelated-UID denial.

- [x] **M1-10 - Pass the vertical-slice durability and isolation gate.**
  - **Depends:** `M1-09`.
  - **Success:** the complete slice passes existing regressions plus emulator and
    fault tests before widening implementation.
  - **Verify:** terminate before/after publication; lose the response; retry the
    same command; overlap two backend instances. Exactly one acknowledged result
    survives, with no duplicate move, resource cost, or reroll.
  - **Completed:** November 11, 2026 for the emulator development slice.
    **Evidence:** [M1 browser/restart acceptance](./cloud-migration-preparation.md#m1-browser-and-restart-acceptance):
    52 native SDK/HTTP cases, zero skipped, including actual process termination
    before/after publication and identical-command recovery. The corrected full
    stable run passed 295 suites / 3,791 tests, zero skipped, including the new
    canonical-restore regression. Lint/stylelint and layering pass with the same
    39 pre-existing warnings. The runner-boundary failure and correction remain
    recorded; this is not a production-deployment or cutover approval.

### M2 - Ownership and complete persistence

- [x] **M2-01 - Implement Owned / Joined campaigns and campaign-local roles.**
  - **Depends:** `M1-10`.
  - **Success:** one UID can own one campaign and play in another. Launcher,
    metadata, and operation permissions agree; display/contact fields cannot
    confer ownership.
  - **Verify:** owner/member/unrelated-UID cases and account switching show only
    permitted campaigns and controls, with backend enforcement.
  - **Completed:** November 11, 2026 for the development access slice.
    **Evidence:** [campaign-local projections](./cloud-migration-preparation.md#initial-campaign-local-access-projections):
    actual UID/Firestore/bearer HTTP ownership/member isolation, malformed
    metadata/current-seat checks, strict client projections and account-switch
    guards, plus the role-aware picker. Joined gameplay remains explicitly
    unavailable until its participant path is implemented; membership does not
    grant canonical owner reads or edits.

- [x] **M2-02 - Implement account-bound invitation and redemption semantics.**
  - **Depends:** `M2-01`.
  - **Success:** owner-issued invitations are hashed, expiring, single-use, and
    attach a verified UID to the intended seat without recreating characters.
    Unused invitations expire after the selected seven days.
  - **Verify:** redemption races have one winner; expired/reused/revoked links
    fail; assignments survive. Matching display names/emails do not claim a seat.
  - **Selected November 11, 2026:** a valid invitation also enables a new verified
    account for the app. Existing explicit account blocks override invitations.
    Expiration does not remove a membership that has already been accepted.
  - **Completed November 11, 2026; Evidence:** [invitation implementation](./cloud-migration-preparation.md#account-bound-invitation-implementation):
    real hashed issuance/reissue/revocation, exact expiry, invite-enabled
    verified-account onboarding, one-winner and identical-command contention,
    actual rollback and replacement-API recovery pass. All 68 native cases and
    14 affected Jest suites / 84 tests pass, with zero skipped. Actual browser
    registration, verified-but-unapproved denial, explicit account-enabled
    acceptance, same-document navigation, revocation and same-UID returning
    login pass without recreating a seat or changing the canonical head.
    Full lint/stylelint/layering pass with the same 39 existing warnings.
    Joined gameplay, removal and assignment controls remain gated.

- [x] **M2-03 - Implement revocation, removal, assignments, and access generations.**
  - **Depends:** `M2-02`.
  - **Success:** revoking an unused invitation differs from removing membership.
    Removal/reassignment revokes future reads/writes/live access without deleting
    campaign-owned characters.
  - **Verify:** stale sessions, in-flight operations, manifests, and subsequent
    reconnects cannot regain revoked access; owner-only assignment controls work.
  - **Selected November 11, 2026:** keep assignments on a removed member's empty
    seat, and preserve explicit owner-approved shared character control.
    No character records are deleted and no implicit exclusive transfer occurs.
  - **Completed November 11, 2026; Evidence:** [member lifecycle/access gate](./cloud-migration-preparation.md#member-lifecycle-and-access-generations):
    81 native SDK/HTTP cases and 15 affected Jest suites / 100 tests pass, zero
    skipped. Actual owner assignment, shared assignment, removal and same-seat
    reacceptance pass in the browser; older scopes stay denied and exact
    canonical head/character bytes remain unchanged. Actual deletion-publication
    rollback, in-flight canonical/membership changes, one-winner contention and
    lost-reply recovery pass. Full lint/stylelint/layering pass with the same
    39 existing warnings. This completes the currently enabled permission
    surfaces and scoped-access contract; live-stream/gameplay and asset/cache
    revocation remain explicitly gated for `M3-01`, `M3-09` and `M4-10`.

- [x] **M2-04 - Implement proven sign-in-method linking without splitting ownership.**
  - **Status:** completed November 13, 2026 with owner-approved live acceptance
    on the existing Firebase project/current account, integrated account controls,
    and preserved emulator-limitation coverage.
  - **Depends:** `M1-05`, `M2-01`.
  - **Success:** Google/password credentials link only after proving control of
    both credentials; the existing UID, Owned/Joined campaigns, and assignments
    remain unchanged.
  - **Verify:** provider-conflict, cancellation, wrong-credential, and matching
    unverified-name/email cases never silently merge or create access.
  - **Retained emulator limitation:** [provider-linking emulator diagnosis](./cloud-migration-preparation.md#provider-linking-emulator-blocker):
    the emulator rejects the signed-in user's own existing email before checking
    the supplied token during password linking. The latest released CLI retains
    this behavior. Do not bypass it by changing emails, disabling protections,
    patching SDKs or substituting a password-reset operation.
  - **Selected November 12, 2026:** keep linking gated and continue independently
    ready migration tasks. No live Auth linking test is approved.
  - **Revised November 13, 2026:** that live-test deferral is superseded. Use the
    existing project/current account for ongoing live verification, without
    weakening the linking gate or creating another environment by assumption.
    New billing/IAM changes still require confirmation. Real Google/password
    providers and loopback Auth domains are already enabled. The restored
    account/login gate passes **2 suites / 24 tests**, **2.072 s**. An Auth-only
    Chrome check is ready; the owner enters/submits credentials locally.
    Successful live linking and campaign/access acceptance remain unclaimed.
  - **Live finding:** the owner completed Google reauthentication and password
    submission against the real project. Google/password are now both present
    on the same UID and password login succeeds. Firebase reports that email
    verification is required again; the post-link confirmation incorrectly
    treated this as an unconfirmed mutation. A focused regression reproduced
    that defect, and the fix preserves strict pre-link proof/current-UID checks
    while reporting the confirmed provider plus pending email verification.
    **3 account/transport/login suites / 37 tests** pass (**1.868 s**);
    **17 actual Auth/HTTP cases** pass (**5,275.3276 ms**), zero skips.
    Normal email verification and integrated linking UI acceptance remain
    pending; no administrative verification override or access relaxation.
  - **Completed gate:** the owner completed the normal live verification-email
    flow; a fresh SDK refresh confirms both providers, the same account and
    verified email. Account controls are available from signed-in account access
    and the cloud campaign picker, require fresh proof, clear password fields,
    reject account switching and require refresh rather than resubmitting an
    uncertain link. Viewing restored provider state adds no mandatory Auth RPC.
    **19/19 native Auth/HTTP/provider/campaign-authority cases**, zero skips,
    **13,827.8168 ms**; **16 app suites / 113 tests**, **6.798 s**;
    full lint/stylelint/layering: zero errors and the same 39 existing warnings.
    Native password-to-Google success preserves Owned/Joined/assignments/head/
    character data. The emulator's Google-to-password case verifies safe
    rejection, not successful linking; positive acceptance is the separate real
    live Google-to-password/password-login/verification proof.
    No SDK patch, email substitution, password-reset fallback, administrative
    verification override, account merge or development-gate waiver was used.

- [x] **M2-05 - Cover all canonical campaign and gameplay persistence paths.**
  - **Depends:** `M1-07`, `M2-01`.
  - **Success:** scene, sheets, resources, turns, movement, doors, terrain, images,
    and settings use the cloud Adapter's revision/receipt contract. Preserve
    edition-specific rules, stable IDs, canonical serialization, and explicit local mode.
  - **Verify:** mutation/CAS/idempotency tests run through real Adapter Interfaces;
    overlapping instances and lost responses do not partially spend or duplicate
    results. Re-run local SQLite behavior.
  - **Completed November 12, 2026; Evidence:** [canonical persistence gate](./cloud-migration-preparation.md#complete-canonical-persistence-gate):
    89 native SDK/HTTP cases and 20 affected Jest suites / 137 tests pass,
    zero skipped. Source changes preserve owned spells, Favorites, real PNG
    bytes and exact scene data. Both editions preserve doors, terrain, physical
    positions and committed turns; stale writes, publication failure, lost
    replies and competing settings updates cannot partially publish or duplicate
    work. Actual owner settings/returning browser flow passes. Local SQLite
    coverage and full lint/stylelint/layering pass with the same 39 warnings.
    Participant wire assets and live commands remain separate later gates.

- [x] **M2-06 - Implement private asset upload, finalization, and authorized delivery.**
  - **Depends:** `M2-05`.
  - **Success:** large assets can upload directly/resumably where needed; validate
    size, type, integrity, ownership, and final contents before publication.
    Delivery grants only current participant-authorized bytes.
  - **Verify:** tampering, partial upload, wrong UID/campaign, expiry, and revoked
    access fail. Manifests use hashes, not persisted bearer tokens or reusable
    signed URLs; hidden images/names are not shipped wholesale.
  - **Selected November 12, 2026:** current JPEG/PNG/WebP formats and canonical
    file/data limits remain unchanged. Imported image validation allows at most
    16,000,000 decoded pixels and 8192 pixels on either side. Reject larger or
    corrupt images explicitly; do not silently resize saved bytes.
  - **Completed November 12, 2026; Evidence:** [private asset delivery gate](./cloud-migration-preparation.md#private-asset-delivery-gate):
    full current native suite passes 98/98 cases, zero skipped; affected
    application checks pass 15 suites / 109 tests. Owner-only HTTP uploads,
    exact binary delivery, canonical image finalization, current-member scope,
    hidden NPC isolation, reassignment and in-flight removal are verified.
    Actual browser save/hash/download/reload and independent SDK byte verification
    pass. Current image files fit the bounded direct HTTP path; larger canonical
    transfer belongs to `M2-07`, and map/NPC view grants remain gated with `M3`.

- [x] **M2-07 - Implement bounded import/export and large-payload handling.**
  - **Depends:** `M2-06`, `M0-03`.
  - **Success:** complete canonical files remain portable without trusting imported
    ownership claims. Large request/object paths obey actual platform limits
    measured in UTF-8/binary bytes.
  - **Verify:** representative largest files round-trip; oversized, invalid,
    wrong-edition, or corrupt input produces an explicit error, not partial state.
  - **Completed:** November 12, 2026.
  - **Policy:** owner approved 128,000,000 UTF-8 bytes per complete cloud file;
    local import defaults and individual scene/record/image/object limits remain
    unchanged. One-MiB immutable parts use the current authenticated API; exports
    use actual HTTP streaming, not an oversized ordinary JSON response.
  - **Evidence:** [complete-file gate](./cloud-migration-preparation.md#complete-campaign-portability-and-large-file-gate).
    **127/127** native cases and **18 suites / 131 application tests** passed,
    zero skipped; full lint/layering had zero errors and the same 39 existing
    warnings. A real 36,522,416-byte, 25-map, 16-character image-heavy campaign
    round-tripped, and an actual 128,000,000-byte file succeeded while one more
    byte failed before upload. Largest measured POST was 1,398,127 bytes.
    Backend kill/replacement, lost replies at every transfer stage, final
    transaction rollback, quota/UID/claim fences, both editions and browser file
    input/reload pass without changing source data or imported authority.
    Actual OS-saved JSON files from the VS Code popout and a separately approved
    Chrome test window were independently verified against original scene/
    character/image hashes.

- [x] **M2-08 - Enforce private-pilot usage limits and abuse controls.**
  - **Depends:** `M2-01`, `M2-06`.
  - **Success:** record and enforce campaign, upload, storage, request, and stream
    limits for eligible accounts. Authentication alone cannot create unlimited
    billable work or confer access to existing campaigns.
  - **Verify:** boundary/over-limit, concurrent, and unauthorized requests cannot
    bypass limits through another endpoint or instance.
  - **Completed:** November 12, 2026.
  - **Policy:** no enabled-account or daily custom-image-volume cap; ten owned
    campaigns, 20 GiB private object bytes, 300 requests per rolling minute and
    four renewable stream leases per UID. Existing image bounds and application
    eligibility remain enforced. No quota deletes acknowledged data or imposes
    a total game-duration cap.
  - **Evidence:** [usage-controls gate](./cloud-migration-preparation.md#private-pilot-usage-limits-and-abuse-controls-gate).
    **108/108** native SDK/HTTP/process-restart cases and **17 suites / 117
    application tests** passed, zero skipped; full lint/layering had zero errors
    and the same 39 existing warnings. Exact-byte atomic admission, competing
    instances, corrupt-ledger failure, legacy inventory and actual browser
    HTTP429/retained-command recovery are verified. The upcoming SSE wire must
    apply the tested lease interface and current access checks in `M3-03`.

- [x] **M2-09 - Implement complete rolling backups and independent backup status.**
  - **Depends:** `M2-05`, `M2-07`.
  - **Success:** retain 20 complete automatic backups; when changed, target
    five-minute intervals during active work. Provide manual backup/download.
    Track due/pending/failed work durably without a permanent interval worker.
  - **Verify:** unchanged state creates no needless backup; the 21st replaces only
    the eligible oldest backup. Failed backups never change primary-save success
    or claim completion, and retry after wake works.
  - **Completed:** November 12, 2026. **Evidence:** standalone immutable private
    JSON files, a bounded twenty-point index, captured-generation ordering,
    UID-bound intent/receipt recovery, durable due/pending/error work and
    request-bound natural-wake retries pass the development gate. Exact
    five-minute and 20/21 boundaries, unchanged suppression, independent primary
    HTTP success during backup failure, real process kill/replacement, missing
    claims, two-process out-of-order completion, corruption/no repair and
    pre-quota first-use inventory are verified. Explicit workspace exit flushes
    primary data before requesting the final changed point; live-session
    integration remains an M4 gate.
    Final native gate: **140/140 cases**, no skips, **375,911.4867 ms**.
    Application/local/account/UI gate: **15 explicit suites / 98 tests**,
    **9.126 s**. Full lint/stylelint/layering: zero errors and the same 39
    existing warnings. A real **36,522,415-byte** image-bearing complete point
    streamed/read back exactly. Actual Chrome recovered the original pre-quota
    demo intent, created a separate manual point and downloaded **709,228 bytes**;
    independent file/SDK verification preserved exact metadata, characters,
    scene and canonical generation 64. Retired bytes remain charged for M2-11
    cleanup. Restore controls stay gated for M2-10. No production change or
    routine-save presentation change is claimed.

- [x] **M2-10 - Implement verified restore-as-copy.**
  - **Depends:** `M2-09`, `M2-06`.
  - **Success:** an owner restores a complete backup into a new private campaign,
    with validated data and fresh authority. The source is not overwritten;
    credentials/invitation secrets are excluded.
  - **Verify:** restore and export again; compare characters, IDs, images,
    rules/source pins, topology, combat state, and resources. Other UIDs cannot
    restore/export the owner's private backup.
  - **Completed:** November 12, 2026. **Evidence:** reused the verified owner
    complete-file read and bounded import path, then enabled the existing owner
    restore control. Real managed-workspace/HTTP/SDK drills for both editions
    preserve exact character IDs/rows, two private PNG fields, source-owned
    spells/Favorites/HP/notes, disabled-source/version pins, connected topology,
    locked door, physical pose and committed turn/movement resources.
    New targets have fresh ownership and private prefixes, no seats or campaign
    invitations. The source head, records, retained file, invitation and
    assignment stay unchanged. Unrelated/joined UIDs cannot begin restore;
    they create no transfer or false acknowledgement. A lost final reply keeps
    one original caller/ID and recovers one copy. Native portability/backup/
    import/restore/real-process gate: **37/37 cases**, no skips,
    **196,166.7065 ms**. Affected app gate: **15 explicit suites / 99 tests**,
    **9.527 s**. Full lint/stylelint/layering: zero errors and the same 39
    warnings. Real-client-capability UI click proof and Chrome's enabled owner
    controls are verified; complete execution is proved by the real HTTP/SDK
    drills, not inferred from rendering alone. No new backend authority path,
    production change, dependency or routine-save presentation change.

- [x] **M2-11 - Implement race-safe orphan/superseded-object cleanup.**
  - **Depends:** `M2-07`, `M2-09`, `M2-10`.
  - **Success:** bounded maintenance preserves objects referenced by current heads
    and all retained backups, including concurrent publication/restore. Restore
    creates protected committed objects rather than reviving a deletion candidate.
    Active import journals protect their uncommitted target prefixes. Completed,
    failed and expired source parts become eligible only through the same safe
    grace/fencing process; intent/receipt tombstones cannot permit old-command
    re-execution. Storage charges are not released while any corresponding
    generation remains billable.
  - **Verify:** commit/backup/restore/cleanup races cannot delete needed data.
    Respect seven-day soft-delete billing; do not enable retention locks or
    disable recovery protection without a separate approved decision.
  - **Completed:** November 13, 2026; owner/intent-authorized maintenance runs
    on natural account requests with a durable UID lease, target cursors and
    **20-object / four-deletion** bounds. Current checkpoints/images, retained
    complete files, pending backup sources and active unpublished imports remain
    protected. Twenty-four-hour quarantine and publication/deletion fences
    survive cold-worker overlap; retirement and its exact-generation byte hold
    commit together. Delayed missing-object lookups renew quota before physical
    creation. Storage stays charged for at least seven days and until complete
    bounded generation inventory proves absence; ambiguous/legacy reservations
    are not optimistically refunded. Closed import parts retire without removing
    intent/receipt tombstones. Every current retained point remains physically
    readable after oldest-point deletion. A separately approved and cleaned-up
    live canary proved actual **412** enforcement and seven-day soft deletion;
    its temporary exact-object viewer grant was removed. Normal acceptance stays
    demo-only. Final full native catalog: **161/161**, zero skipped, in
    **576,428.2997 ms**; affected application gate: **15 suites / 98 tests**,
    **8.183 s**. Full lint/stylelint/layering: zero errors and the same 39 existing
    warnings. No production deployment, retention change or routine-save
    presentation change; no live approval remains.

- [x] **M2-12 - Support online between-game sheet work without a live game.**
  - **Depends:** `M2-03`, `M2-05`, `M4-01`.
  - **Success:** authorized sheet reads/edits and DM preparation use short requests
    with normal conflict checks. They do not start a live session; world gameplay
    still requires one.
  - **Verify:** read/save while paused succeeds only for permitted records; world
    commands fail; no permanent game stream or offline upload queue is created.
    Verify actual cold wake/sleep later in `M4-12`.
  - **Completed:** November 13, 2026. Joined **Assigned characters** opens the
    existing player-safe sheet editor through current UID/seat/generation
    requests, without loading the owner world/NPC table or starting a game.
    Shared local/cloud policy preserves unassigned rows, enabled sources,
    protected traits and world budgets; owner-billed staging/publication
    rechecks member authority. Scope revocation after actual reads/uploads,
    exact owner byte admission, private images, due complete backups and
    lost-reply recovery after removal pass. Account switching clears stale tabs;
    malformed/foreign/private DTOs cannot acknowledge or populate the editor.
    Affected native gate: **162/162**, zero skips, **704,588.6424 ms**.
    Affected application gate: **18 suites / 116 tests**, **8.234 s**; full
    lint/stylelint/layering: zero errors and the same 39 baseline warnings.
    Owner-approved real HTTPS/Firebase Auth/Firestore/Storage acceptance passed
    with three fixture identities/two synthetic campaigns; exact image bytes,
    owner billing, paused world preservation and historical own receipt without
    access revival were verified. All fixtures/live object versions were removed.
    The deployed immutable image has eight matching source hashes and a passing
    CPU-only/read-only/no-credential container check. Cloud Run's reserved
    public `/healthz` path was discovered and replaced by `/health`; focused
    production runtime recheck: **3/3**, zero skips, **1,678.749 ms**.
    No real campaign cutover, frontend rollout, hosted sleep/load/cost acceptance
    or routine-save presentation change is claimed.

- [x] **M2-13 - Pass complete persistence and implemented-operation access coverage.**
  - **Depends:** `M2-03`, `M2-04`, `M2-05`, `M2-08`, `M2-10`, `M2-11`, `M2-12`.
  - **Success:** all implemented list/read/write/asset/import/export/backup operations
    pass owner/member/unrelated-UID, concurrency, and fault cases. Record policy
    coverage for upcoming stream/lifecycle operations, then retest their real wires.
  - **Verify:** permission/atomicity matrix, emulator evidence, and full stable
    suite are green; no cloud failure falls back to writable browser storage.
  - **Completed:** November 13, 2026. Reconciled all implemented HTTP operations
    with the owner/current-member/unrelated-UID and persistence/failure matrix
    in the preparation evidence. Protected routes bind verified principal and
    request quota; only explicit participant/assigned/image interfaces accept
    scoped headers. Internal trusted-owner resource helpers are not public
    authority routes. Atomicity, conflict, revocation, capacity, integrity,
    original-caller retries, actual backend replacement, local-host compatibility
    and no-writable-fallback coverage pass. Complete official native SDK catalog:
    **190/190**, zero skips/failures/cancellations, **725,271.6615 ms**.
    Full stable regression with open-handle detection: **298 suites / 3,861 tests**,
    zero skips/failures, **1,461.583 s**. The tested implementation remained
    unchanged throughout both gates. M2-12's real HTTPS/Auth/Firestore/Storage
    permission/image/recovery proof and verified fixture cleanup remain valid.
    Full lint/stylelint/layering retains zero errors and 39 baseline warnings.
    Upcoming participant room/world projections, deltas, SSE, gameplay, cache
    revocation and drain/final-backup wires remain explicitly gated; their
    future M3/M4 acceptance is not claimed by this implemented-operation gate.

### M3 - Synchronization and participant cache

- [x] **M3-01 - Define and enforce participant snapshots, manifests, and deltas.**
  - **Depends:** `M2-13`.
  - **Success:** authorize underlying data before constructing explicit projections.
    Preserve one assigned observer, closed-room concealment, authorized asset
    names/bytes, safe physical rendering, and private-sheet/NPC-budget exclusion.
  - **Verify:** inspect serialized public outputs for hidden rooms, origins,
    blueprints, sheets, budgets, and secret-bearing full-map images. UI fog is
    not the privacy test.
  - **Completed:** November 13, 2026. Managed HTTP checkpoints require the current
    member scope and active live epoch, then recheck authority/head after actual
    Storage reads. Shared physical/public rendering uses one assigned observer;
    explicit root/actor/record/manifest guards exclude canonical/legacy data,
    closed/unrelated rooms and origins, authoring notes and private NPC sheets/
    budgets. Image references replace embedded bytes; separate observer-scoped
    delivery preserves the existing assigned-only image interface. Conditional
    graphics validate hashes; no-observer state clears old vision.
    Sparse deltas bind the exact base/next generation and unchanged access/epoch;
    view replacement drops revoked data without historical motion replay.
    Affected native gate: **81/81**, zero skips/failures,
    **328,420.5164 ms**. Application gate: **10 suites / 76 tests**, **6.843 s**.
    Full lint/stylelint/layering: zero errors and the same 39 baseline warnings.
    Actual non-root CPU-only/read-only/no-key image checks match eleven source
    hashes and exercise both editions. The separately approved required
    `livePresence` composite index is READY and its exact query succeeds.
    Owner-approved real HTTPS/Auth/Firestore/Storage acceptance passed using the
    same three disposable identities/two campaigns; ten live object generations
    and all fixtures were verified removed afterward. No real account/data,
    extra IAM/key/service or frontend/cutover change occurred.
    This verifies the projection/delta contract, not durable stream delivery,
    gameplay/animation, player UI or browser-cache activation.

- [x] **M3-02 - Implement ordered durable changes and bounded reconnect history.**
  - **Depends:** `M1-07`, `M3-01`.
  - **Success:** committed heads/receipts and compact changes recover across a
    commit-to-announcement crash. Each active instance observes shared changes
    and fans out safe updates without full-database refreshes per viewer/ping.
  - **Verify:** duplicates, missing/out-of-order/stale/incompatible changes are
    detected. Record/test the selected bound, initially proposed as 1,000 changes
    and no more than 24 hours; older gaps require a fresh authorized snapshot.
  - **Completed:** November 13, 2026. Creation now atomically records event one;
    import/settings/canonical events share the strict private sequence reader.
    Selected bounds are **1,000 changes / 24 hours** with exact boundary tests.
    Bounded natural wake-ups retire at most **100 entries** with the retained
    floor in the same transaction, leaving primary head/receipts/bytes unchanged.
    One active campaign observation group shares head/live/access watches and
    canonical Storage body reads across viewers; per-view authorization/projection
    remains mandatory. Ten real presence pings add zero canonical downloads;
    overlapping updates resync the latest pose without replaying old motion.
    Warm graphics omission, listener rejection isolation, backwards-head denial,
    scope/pause teardown and actual commit-before-announcement process death pass.
    The initial 165-case native gate exposed seven old total-count assumptions
    about the newly added creation event; exact captured-baseline assertions
    preserve their rollback/concurrency requirements. Final recheck:
    **92/92** access/canonical cases, zero skips, **333,519.6709 ms**, plus
    **73 unchanged passing cases** from the broader gate.
    Application gate: **6 suites / 56 tests**, **8.138 s**; full JS/stylelint/
    layering: zero errors and the same 39 baseline warnings. The actual
    read-only/non-root/no-key runtime matches twelve source hashes.
    Bounded real API acceptance verifies ordered compact creation history and
    natural expiry retirement/atomic floor without primary mutation; all three
    test identities/two campaigns/ten live object generations were removed.
    No public private-journal endpoint, always-on watch, extra IAM/index/service,
    SSE transport or player gameplay activation is introduced.

- [x] **M3-03 - Implement direct authenticated Fetch-based SSE.**
  - **Depends:** `M1-03`, `M3-02`, `M4-01`.
  - **Success:** verified identity travels in authorization headers; streams use
    the Cloud Run address, exact allowed origins, deliberate preflight, and
    live-session access checks. Keep local cookie/CSRF transport intact.
    Apply `M2-08` lease admission, recheck current campaign access on renewal,
    and close the connection when its lease cannot be renewed.
    Wire `M4-03` connect/renew/disconnect presence callbacks to actual transport
    outcomes; presence bookkeeping alone grants neither a stream nor world access.
  - **Verify:** no Firebase bearer token in URLs; no reliance on native EventSource
    custom headers or Hosting's long-lived rewrite. Expired/revoked/anonymous/
    cross-campaign streams fail.
  - **Completed:** November 14, 2026. **Evidence:**
    [direct authenticated transport](./cloud-migration-preparation.md#m3-03-direct-authenticated-fetch-sse).
    Final affected native gate **145/145**, no skips, **596,211.1745 ms**;
    **7 app suites / 94 tests**, **3.007 s**, open-handle detection enabled.
    Exact four-UID-lease admission, scope/epoch/role denials, actual abort/pause/
    membership cleanup, queued-event/UTF-8 byte bounds and renewal failure races
    pass. The actual CPU-only runtime verifies thirteen source hashes.
    Real Cloud Run owner/member delivery, 60-second renewal, no meaningful
    activity renewal from presence and actual revoked-bearer stream closure
    passed **00:52:33 UTC**; exact approved fixture cleanup passed
    **00:52:38 UTC**. Owner events are compact owner-authorized head notifications;
    automatic reconnect, world/motion and full player UI activation remain
    `M3-04`/`M3-05` and subsequent gates. No local transport, real account,
    frontend/cutover or routine-save UX change.

- [x] **M3-04 - Implement reconciliation, gap recovery, and intentional reconnects.**
  - **Depends:** `M3-03`.
  - **Success:** apply a contiguous authorized revision sequence or a fresh snapshot;
    refresh identity and reconnect with jitter before request timeout. Replacements
    converge without replaying historical movement.
  - **Verify:** timeout, lost event, duplicate, backend replacement, and token
    renewal tests converge. Paused/ended sessions stop retrying; world commands
    stay disabled until reconciliation completes.
  - **Completed:** November 14, 2026. **Evidence:**
    [managed reconciliation and recovery](./cloud-migration-preparation.md#m3-04-managed-reconciliation-and-recovery).
    **8 app suites / 115 tests**, **2.834 s**, open-handle detection enabled;
    **5 real SDK/HTTP/process cases**, no skips, **43,617.7534 ms**. An actual
    backend PID kill, a separately committed assigned change and replacement at
    the old endpoint converge through a fresh latest member checkpoint, while
    an ordinary prior delta remains live. Exact 1-30-second backoff and
    50-52-minute identity rotation, gaps/duplicates/partial EOF, scope/account
    loss and callback failures pass. Real HTTPS transport interruption recovers
    the same scope/epoch without unchanged graphic bodies or historical replay;
    actual managed-token revocation stops retries. Acceptance passed
    **01:36:56 UTC**; the same approved fixtures/ten object generations were
    verified cleaned at **01:37:02 UTC**. Backend/wire deployment is unchanged
    M3-03; no new infrastructure, real account, full player UI, world/motion
    activation, browser cache or routine-save UX change.

- [x] **M3-05 - Preserve native DM/player movement and animation presentation.**
  - **Depends:** `M3-04`.
  - **Evidence:** **16 app suites / 209 tests** pass with open-handle detection,
    including native animated sprites, queued steps, own-command echo, current
    reconciliation and model teardown. The final frozen access/world gate is
    **80/80 SDK cases**, no skips, **460,966.3552 ms**; the other six directly
    affected canonical/object/asset/quota/backup/process files retain **118
    passing cases** on unchanged authority source. Both 2014/2024 off-turn and
    Free Play behavior, authoritative costs, current actor/scope/epoch,
    native flight/fall and private owner/member motion pass. The isolated
    read-only **1 CPU / 1 GiB** Linux image verifies **23 exact source hashes**
    and real native CPU d20 physics. Real HTTPS off-turn/Free Play, both route
    directions, foreign-budget omission, minimal duplicate, CPU dice, pause and
    new-epoch/no-history rejoin passed **November 14, 2026, 04:36:29 UTC** on
    `taverntable-api-test-00006-rdp`. Exact same **three approved disposable UIDs /
    two campaigns / 17 live object generations** were cleaned **04:36:35 UTC**.
    No IAM/index/real account/campaign/frontend/cutover or routine-save UX change.
    Start/Pause/Keep Active and Joined launch are wired but activation remains
    gated for progressive private assets and full-world acceptance; later
    arrival/Undo/door/action and automatic-drain gates are not silently enabled.
  - **Success:** Free Play and combat restrictions remain correct; approved routes
    replay Walk/Run, backward movement, flight, falls, queued continuity, and
    cancellation without recharging costs.
  - **Verify:** real DM/player interactions cover both directions, resize,
    observer/door/visibility changes, stale origins, and asset-scope transitions.
    No animation-frame persistence or second terrain owner is introduced.

- [x] **M3-06 - Implement account/view-scoped, integrity-checked cache storage.**
  - **Depends:** `M3-01`, `M2-06`.
  - **Success:** IndexedDB holds participant metadata/checkpoints; Cache Storage
    holds reusable binary assets. Partition private entries by UID, campaign,
    schema and access/view generation; public catalogs remain separate.
  - **Verify:** validate hashes/schemas; keep 2014/2024 resource databases and pinned
    versions separate. Campaign manifests never persist bearer tokens or reusable
    signed URLs, and campaign files do not use localStorage.
  - **Evidence:** the private cache Module uses the existing atomic IndexedDB
    Interface and native Cache Storage, separate from public edition catalogs.
    Exact UID/campaign/schema/seat/access/view keys, UTF-8 size/SHA-256 and
    participant schema checks protect checkpoints and referenced binary bytes.
    Delayed older writes cannot rewind cached generations; corrupted bodies or
    matching-hash/invalid-schema entries fail explicitly and exact invalidation
    leaves other namespaces intact. **4 app suites / 53 tests**, zero skips,
    **2.533 s** with open-handle detection; a real managed multipart import
    preserves the shared hash Interface (**1/1 SDK case**, **3,636.6565 ms**).
    Actual native browser IndexedDB/Cache Storage survive page reload, verify
    exact **88-byte** PNG bytes and UID/access isolation, then remove only the
    owned synthetic entries. Full lint/stylelint/layering: zero errors / same
    **39 baseline warnings**. No dependency/runtime deployment, public frontend,
    real account/campaign or routine-save UX change. Cache candidates are not
    authority; progressive use, eviction/UI, warm network proof and logout-wide
    purge remain subsequent gates.

- [x] **M3-07 - Implement progressive first join and bounded cache management.**
  - **Depends:** `M3-06`.
  - **Success:** load the active authorized area, assigned sheets, and required
    assets first; load other permitted areas on demand. Provide usage/clear-cache
    controls, bounded eviction, and best-effort persistence handling.
  - **Verify:** quota denial, browser eviction, corrupt bytes and stale schemas
    trigger explicit recovery/re-download. No cache becomes the only saved copy
    or an excuse to download the whole private campaign.
  - **Evidence:** verified November 14, 2026 in the development gate. First join
    publishes current authority synchronously, loads the active authorized area/
    assigned sheets and required artwork, and requests other permitted views/
    sheet artwork on demand. Protected binary requests validate captured managed
    identity, access/view/epoch, exact MIME/bytes/hash and cancel superseded work.
    Raw/cache checkpoints and canonical edits stay image-free; late artwork does
    not reposition sprites or replay motion.
    The explicitly approved **256 MiB per-account/browser** private-cache target
    is adjustable in Settings with exact usage, UID-only clear and best-effort
    persistence status. Bounded eviction protects active views; lower targets
    report retained protected bytes until those views close. Missing browser-wide
    coordination disables application cache writes instead of overrunning a
    shared target. Typed corruption/quota/unavailability recover only through
    currently authorized online bytes.
    **12 app suites / 186 tests**, zero skips, **20.734 s**, open-handle detection;
    **4 distinct actual SDK cases** retain protected raw/warm image delivery,
    managed multipart imports, native acknowledgement and queued combat routes.
    Native browser Settings verify 256/128 MiB, page-reload preference retention,
    exact **95-byte PNG** accounting, current-view protection/released eviction,
    persistence denial, and own-UID clear leaving another UID unchanged; exact
    synthetic entries are cleared and confirmed absent. Full lint/style/layering:
    zero errors / same **39 baseline warnings**. No dependency/backend deployment,
    public frontend/cutover, real account/campaign or routine-save UX change.
    Authoritative warm-rejoin network proof and logout-wide purge remain
    `M3-08`/`M3-09`; full shared-game capability remains gated.

- [x] **M3-08 - Prove warm-cache rejoin and authoritative state recovery.**
  - **Depends:** `M3-04`, `M3-07`.
  - **Success:** rejoin verifies current identity/access, revisions, hashes and view
    before enabling commands. Reuse valid unchanged assets and replace stale
    participant state when necessary.
  - **Verify:** network instrumentation shows **zero unchanged asset-body downloads**
    when valid entries remain present. Eviction/corruption causes an explicit
    download; do not count a cached UI appearance as proof of network reuse.
  - **Evidence:** verified November 14, 2026 with actual managed SDK/HTTP/SSE
    authority and immutable private images. A cold default join transfers one
    **514-byte** graphic JSON body and one **86-byte** PNG; warm rejoin transfers
    **zero graphic/image bodies and zero asset bytes**, while retaining **two
    fresh authority requests**. Cached checkpoints are hints only; current
    constructor UID/access/session and fresh revisions/view remain authoritative.
    Exact current-manifest image references may reuse verified historical bytes
    inside the same UID/campaign without weakening ordinary scope isolation.
    Corrupt/evicted binaries, corrupt graphics, stale schema, changed references
    and rejected observer hints recover explicitly; current UID/access/epoch
    mismatches deny readiness and submit **zero commands**.
    **4/4 actual SDK cases**, zero skips, **64,041.5513 ms**, preserve original
    native acknowledgement and continuous queued movement/final combat budgets.
    **12 coupled app suites / 192 tests**, zero skips, **21.549 s**, open-handle
    detection; full lint/style/layering zero errors / same **39 baseline warnings**.
    No deployment, dependency, real account/campaign, original-host or routine-save
    UX change. Logout-wide purge and ten-client/full-stable acceptance remain
    `M3-09`/`M3-10`; complete shared gameplay remains gated.

- [x] **M3-09 - Implement logout, access-change, and connection-loss safety.**
  - **Depends:** `M1-05`, `M3-04`, `M3-06`.
  - **Success:** logout/account switching clears private cache state; membership/
    observer changes purge superseded scope and cancel stale work. Connection loss
    blocks new mutations and visibly preserves only already-unacknowledged edits
    for online recovery.
  - **Verify:** another UID never sees the previous user's view. Reauthenticate
    and reconcile before editing; no offline editor, durable offline queue, or
    automatic local/cloud conflict merge is introduced.
  - **Evidence:** verified November 14, 2026. Managed invalidation cancels
    streams/HTTP, selections, display data and owned protections before UID or
    campaign purge. Persistent account/campaign epochs remove and fence all
    historical private checkpoints/binary namespaces, including warm hints and
    late writes; other UIDs/public catalogs/canonical cloud state are preserved.
    Lost connectivity blocks new edits/commands. Original submitted UID/body/ID/
    scope remain only in memory for exact receipt recovery; ended views cannot
    revive and online status alone cannot re-enable editing.
    **21 directly coupled app suites / 272 tests**, zero skips, **25.161 s**,
    open-handle detection; **5/5 actual SDK cases**, zero skips, **84,451.93 ms**.
    Actual switched-UID/logout private bytes are **zero**; original sheet/world
    commands retry with **two identical-body attempts** each and increment their
    canonical revisions **once**; offline world commands are **zero**.
    Unchanged-scope warm join still transfers zero assets with two fresh authority
    requests; deliberately purged membership scopes re-download authorized data.
    Native browser persistent epochs reject an older observed campaign writer
    with `cache-invalidated`; campaign/UID purge leave **zero entries/bytes**.
    Full lint/style/layering: zero errors / same **39 baseline warnings**.
    Dependent identity-loss/recovery feedback is implemented without changing the
    deferred routine-save flash, centered card, timing or normal connected-save
    behavior. No dependency/deployment, real account/campaign or original-host
    change. Ten-client/full-stable acceptance remains `M3-10`; gameplay stays gated.

- [x] **M3-10 - Pass ten-client convergence and synchronization acceptance.**
  - **Depends:** `M3-05`, `M3-08`, `M3-09`.
  - **Success:** ten concurrent clients converge to the same committed authority
    with participant-specific visibility, no duplicate gameplay costs, and
    no secret-bearing public output.
  - **Verify:** record convergence/reconnect tests, actual transferred bytes,
    receipt counts and replay behavior. Prepare the 200 ms RTT performance and
    idle-payload measurements for the hosted gate; run the full stable suite.
  - **Completed:** November 14, 2026. One private owner observer and nine distinct
    managed-UID member connections have **ten simultaneous steady-state SSE
    transports**; cold admission opens three members at a time, not ten
    simultaneous cold handshakes. All ten converge to canonical generation
    **29 / scene revision 7 / character revision 21**, matching visible poses
    and each participant's authorized native budgets without private NPC/foreign
    sheet, ID, budget or owner-reference leakage.
    Five durable world receipts (three moves/two rolls) debit **15 feet** once.
    One concurrent CAS loser receives an explicit stale-revision denial and no
    receipt, then retries under fresh authority with a new ID. Three duplicate
    acknowledgements, including original-body lost-reply recovery, return
    `presentation:null`; duplicate physics and missed-route replay are **zero**.
    Current membership revocation clears state/artwork/command readiness and
    leaves **zero private bytes**; two old puts reject `cache-invalidated`.
    Final transports, live connections, in-flight work and waiters are zero.
    Parent **6/6 actual SDK cases**, zero skips/cancellations, **168,610.1096 ms**
    (ten-client case **85,670.6501 ms**). Full stable: **307/307 suites,
    4,006/4,006 tests**, **1,908.483 s**, no skips or detected open handles.
    Latest measured RX bodies **425,141 bytes** = graphic JSON **4,626** + PNG
    **774** + presentations **115,562** + state/envelope **304,179**, including
    **90,568** owner-verification bytes. Physical frames are a subset, not extra
    traffic. TX **9,119 bytes / 52 serialized attempts** includes fault probes,
    not confirmed wire transmission; headers/TLS/Auth/backend SDK are excluded.
    Local state spreads and reconnect timings are recorded separately from
    deliberate CAS barriers/admission. They do not satisfy hosted 200 ms RTT,
    acknowledgement p95, idle payload or cost acceptance.
    Full lint/style/layering: zero errors / same **39 baseline warnings**.
    Test/helper changes only; production source and both gameplay capability
    gates remain unchanged. An exploratory emulator 500 did not recur in the
    subsequent diagnostic and independent acceptance runs; its root cause is
    unproven, not masked by a production retry. No deployment, dependency, real
    account/campaign, original-host or deferred routine-save UX change.
    See [measured acceptance](./cloud-migration-preparation.md#m3-10-ten-managed-clients-and-full-stable-acceptance).

### M4 - Lifecycle, deployment, and isolated hosted pilot

`M4-01` is an early prerequisite for M2/M3, not permission to deploy M4 early.

- [x] **M4-01 - Implement durable owner-controlled live-session state.**
  - **Depends:** `M2-01`, `M1-07`.
  - **Success:** distinguish account sessions, live games and combat turns.
    Owner-only start/end/keep-active is campaign-scoped; world commands require
    live status, while permitted between-game work does not.
  - **Verify:** role/state-transition tests persist across backend replacement.
    A membership or successful login cannot start/extend somebody else's game.
  - **Selected November 13, 2026:** paused DM preparation may reposition tokens
    without spending movement/actions; player world actions remain live-only.
    Permitted sheet edits and map preparation do not start a live game.
  - **Completed:** November 13, 2026; separate campaign live-state/control
    generation and epoch, owner-only authenticated start/end/keep-active,
    UID-bound same-command recovery and current-role/epoch admission are verified.
    Real backend replacement preserves state and receipts. More than six hours
    of explicit renewal is valid; login/reads do not renew it. Paused owner
    repositioning preserves raw sheets, combat and movement/action state;
    campaign copies start paused with no copied live authority. Competing
    controls have one winner and malformed state fails explicitly.
    Affected native authority/canonical/lifecycle/runtime gate: **77/77 cases**,
    no skips, **206,039.7877 ms**. App compatibility: **15 suites / 100 tests**,
    **7.774 s**; lint/stylelint/layering: zero errors and the same 39 existing
    warnings. This early prerequisite verifies actual control/admission APIs,
    not complete cloud gameplay/UI: M3 world/stream publication must reuse the
    transaction-time gate; M4-02/03/04 still own inactivity/presence/drain behavior.

- [x] **M4-02 - Implement meaningful-activity deadlines and owner keep-active.**
  - **Depends:** `M4-01`, `M2-05`.
  - **Success:** warn at **55 minutes**, pause at **60 minutes** without meaningful
    accepted activity. Authorized moves, rolls, sheet/terrain/door/turn actions
    or explicit owner keep-active reset the deadline; there is no total-duration cap.
  - **Verify:** controlled-clock tests prove heartbeats, reconnects, animations,
    camera movement, unchanged autosaves, invalid requests, duplicate retries and
    backend replacement do **not** reset it. Active games can continue beyond six hours.
  - **Completed:** November 13, 2026 for the development authority/managed-client
    slice. Authenticated status projects a server-observed warning at exactly
    55 minutes; natural requests persist the original 60-minute pause before
    admission or a late keep-active. Accepted canonical movement/roll/terrain/
    turn/sheet changes renew in the same publication transaction. Legacy and
    connected-map camera/view/selection-only changes, unchanged scene/sheet
    saves, invalid changes and original-command retries do not renew.
    Historical receipts and actual cold replacement cannot revive/reset it;
    a real owner publication held across 59-to-61 minutes remains durable
    preparation without reviving the game. Existing six-hour-plus renewal
    proof still passes. **82/82 affected native cases**, zero skips,
    **252,378.732 ms**; **15 app suites / 101 tests**, **8.422 s**; full
    lint/stylelint/layering: zero errors and the same 39 existing warnings.
    A fresh isolated Linux runtime image passes including six source-hash
    checks for the actual changed authority/protocol/router. Player command/
    SSE and visible lifecycle integration remain later M3/M4-04/M5 acceptance,
    not an enabled cloud-gameplay claim. Routine-save presentation is untouched.

- [x] **M4-03 - Implement durable presence grace and earliest-pause evaluation.**
  - **Depends:** `M4-02`.
  - **Success:** everyone disconnected starts a **15-minute** reconnect grace;
    owner end, grace expiry, or inactivity expiry pauses at whichever applies first.
    Presence is coalesced, not a Firestore write for every participant ping.
  - **Verify:** evaluate stored deadlines on requests/reconnects after zero runtime;
    expiry remains correct without a continuously running timer. Test boundary
    races and reconnects without resetting meaningful activity.
  - **Completed:** November 13, 2026 for the development authority/managed-client
    slice. Private per-campaign/per-worker summaries coalesce all local participant
    pings, with current UID/seat/generation checks and no participant-array cap.
    Ten real identities sent 60 pings and caused exactly **two** summary writes,
    measured through Firestore update times. Overlapping workers cannot falsely
    declare each other gone; old connection generations cannot renew/close a
    replacement. Last explicit close starts the 15-minute grace; unknown abrupt
    disappearance uses the last 90-second observation-lease expiry. Cold wake
    preserves the original deadline, not the wake time. Keep-active cannot extend
    disconnected grace; permitted reconnect clears absence, never meaningful time.
    Exact grace-boundary connect/keep races cannot revive an expired epoch.
    **108/108 affected native cases**, zero skips, **434,724.1744 ms**;
    **15 app suites / 101 tests**, **8.462 s**; full lint/stylelint/layering:
    zero errors and the same 39 existing warnings. Rebuilt isolated Linux runtime
    passes seven source-hash checks. The first run's known legacy emulator
    assignment-contention error, three successful isolated probes and unchanged
    complete recheck are retained as evidence, without relaxing expected errors.
    Presence callbacks are not a public heartbeat endpoint or enabled SSE:
    `M3-03` still must combine actual transport outcomes, current live authority
    and the global four-stream quota; `M4-04` still owns draining/final backup.

- [x] **M4-04 - Drain/pause/end safely and stop unwanted live traffic.**
  - **Depends:** `M4-03`, `M3-03`, `M2-09`.
  - **Success:** accepted work is durable; pause/end closes streams and stops
    reconnect loops. Schedule the final changed-state complete backup and retain
    pending/failure status. Preserve campaign, turn, HP, budgets and resources.
  - **Verify:** pause/end/disconnect during accepted work; backup failure remains
    separate. A paused lobby has no endless stream, and pausing one campaign does
    not shut down another active campaign.
  - **Completed:** November 14, 2026. Pause/end and natural expiry atomically
    record the exact canonical final source as existing private pending backup
    work, without allocating a file or depending on backup storage. Later paused
    preparation cannot replace that source. Existing reference protection, owner
    quota, complete-file claims and twenty-point history are reused; unchanged
    automatic sources skip copies. Explicit owner final confirmation reuses the
    matching original job and clears its original failure, not a second backup.
    Bounded permitted status/sheet/backup HTTP requests run pending work;
    status access is rechecked after IO and members receive no private backup result.
    No always-on timer, after-response
    worker, shutdown callback or offline edit/upload queue is introduced.
    A held reply after durable scene publication acknowledges once after pause.
    Owner/member streams close with terminal paused status, zero retained views/
    member leases and no new attempts after explicit reconnect plus **1.25 s**.
    Another campaign continues receiving an accepted generation advance.
    Preparation and file-copy failures are logged, retain their original source/
    failure status and do not reverse pause or accepted primary data; recovery
    returns the exact complete scene/turn/budgets/sheets. Cold natural grace uses
    its original **15-minute** deadline; a permitted sheet publication at the
    **60-minute** boundary is preserved without reviving the live epoch.
    Revocation during held backup IO returns **404**, while the accepted owner
    backup still completes.
    **34/34 coupled native authority/backup cases**, zero skips/cancellations,
    **259,353.0883 ms**; **6/6 actual SDK convergence/warm/private-loss/native
    cases**, zero skips/cancellations, **167,650.6666 ms**.
    **3 app suites / 67 tests**, **2.049 s**, open-handle detection; full lint/
    style/layering zero errors / same **39 baseline warnings**.
    Rebuilt local Linux Node **24.22.3** runtime passes **23 exact source hashes**,
    non-root/read-only/no-network/no-mount/no-credential/no-GPU, native d20 and
    readiness/auth/exit checks. Candidate is local only, not pushed/deployed.
    No frontend, capability, dependency, real account/campaign, original host or
    deferred routine-save UX change. `M4-05` still owns actual container-kill/
    overlapping-instance lifecycle acceptance.
    See [drain evidence](./cloud-migration-preparation.md#m4-04-safe-pause-drain-and-exact-final-source-backups).

- [x] **M4-05 - Pass forced-restart and overlapping-instance lifecycle tests.**
  - **Depends:** `M4-04`, `M4-06`.
  - **Success:** runtime memory, local files and shutdown callbacks are not durability
    or lease authority. Duplicate delivery, replacement and temporary instance
    overlap cannot reset deadlines or publish conflicting state.
  - **Verify:** kill/replace the container at commit, notification, backup and
    reconnect boundaries; recover committed state and correct live status.
  - **Completed:** November 14, 2026, after the owner enabled Docker Desktop host
    networking and restarted. **15/15 actual Linux-container cases**, zero skips/
    cancellations, **103,020.799 ms**, cover uploads before commit, durable commit
    before announcement, lost replies, current-only member reconnect, original
    55/60-minute inactivity and 15-minute grace, backup publication and temporary
    overlapping workers. **29 exact containers** are force-killed (including
    fixture teardown), with exit **137**, no OOM and verified removal. Every
    worker runs the existing local M4-04 runtime with **11 exact source hashes**,
    UID 1000, read-only root, 1 CPU/1 GiB and no mounts/keys/GPU.
    A test-only demo-emulator bootstrap does not weaken the production entry.
    Two actual workers publish one CAS winner/one denial; two same-ID deliveries
    return the original receipt without another revision. One captured final
    source/file/receipt survives a killed uploader and later paused preparation;
    its later changed-state backup remains independently pending. A real SSE
    worker's abandoned presence remains stored after SIGKILL and expires at its
    original lease/grace, not shutdown/restart time. Current reconnect never
    replays missed movement. Native-process compatibility: **4/4 cases**,
    **48,175.3215 ms**, zero skips/cancellations.
    Container fixture objects are deleted with exact generation preconditions;
    eight UID namespaces and synthetic Auth accounts are verified removed.
    An initial parallel cleanup DELETE reset is recorded, not hidden by a
    production retry. Pinned Storage SDK pipeline listener warnings remain
    visible and recorded for the later load/memory gate; no warning-free-runtime
    claim is made. Full lint/style/layering: zero errors / same **39 baseline
    warnings**. No production source/dependency, real account/campaign, live
    deployment, original-host or deferred routine-save UX change.
    See [container acceptance](./cloud-migration-preparation.md#m4-05-actual-container-replacement-and-overlap).

- [x] **M4-06 - Package the cloud entry and bounded starting runtime configuration.**
  - **Depends:** `M1-10`, `M0-03`.
  - **Success:** a supported Node 24 image meets the project's Node 24.4+ floor,
    listens on `0.0.0.0:$PORT`, and uses managed credentials. Record initial
    request-based settings: 1 vCPU / 1 GiB, minimum 0, maximum 1, concurrency 40,
    and at most 60-minute requests, subject to load-test results.
  - **Verify:** container/readiness/configuration checks pass without a server GPU,
    developer ADC files, service-account keys, or reliance on a writable
    filesystem. Maximum-one-instance is not used as a correctness guarantee.
  - **Completed:** November 13, 2026; the owner updated/restarted Docker Desktop.
    The pinned official Node 24 image built locally and ran actual API readiness,
    anonymous/forged-identity denial, private-file exclusion, both edition catalogs
    and full 16,000,000-pixel decoding with **1 CPU / 1 GiB**, no network, no
    mounts, no credentials/GPU and a read-only root. UID 1000 listened on
    `0.0.0.0` at a nondefault `$PORT`, then exited cleanly on SIGTERM.
    The scoped validation container was removed; the local image remains.
    Shared SDK initialization preserves demo isolation. Focused native gate:
    **7/7 cases**, no skips, **6,915.1351 ms**; existing runtime/identity/metadata
    checks: **4 suites / 10 tests**, **3.447 s**. Full lint/stylelint/layering:
    zero errors and the same 39 existing warnings. The undeployed template records
    request-based CPU, min 0/max 1, concurrency 40 and 3600-second requests, with
    unfilled image/identity/project/origin approval placeholders. Hosted IAM,
    gateway/scaling, representative load and cost remain unverified M4 gates.

- [x] **M4-07 - Produce a versioned, allowlisted public frontend package.**
  - **Depends:** `M0-03`, `M1-04`, `M3-07`.
  - **Success:** Hosting serves only approved app/catalog assets with required
    redistribution notices. It never publishes the repository root, server/admin
    tooling, credentials, SQLite files, backups or private campaign data.
  - **Verify:** inspect the actual deploy output/manifest and prohibited-path
    requests. Versioned asset/schema behavior supports deliberate compatibility
    handling and each participant still renders locally.
  - **Selected November 14, 2026:** the owner reports that the tropical family is
    a free-use resource pack and explicitly directs continuing without the formal
    license record for now, keeping the artwork. This authorizes local packaging,
    not a verified CC0 declaration, unrestricted commercial texture rights or a
    public deployment. Existing Mixamo, Quaternius, Remos, die/FreePBR and catalog
    notices/conditions are retained rather than replaced by the application's MIT
    declaration.
  - **Completed locally:** November 14, 2026. A deterministic native-ESM module
    graph and explicit runtime-asset/catalog allowlist produce a separate
    static-only Hosting package: **607 versioned files / 289,219,649 bytes**, with **158
    exact-case configured asset references** present. Its root public manifest
    brings the complete public payload to **608 files / 289,411,156 bytes**.
    No repository root,
    server/admin tooling, tests, raw Firebase configuration file, credentials,
    SQLite, campaign backups, authoring archives or private campaign data enter
    the public directory. The curated public web configuration is injected into
    the production-cloud shell without logging keys; emulator/local mode fails.
    Versioned immutable URLs, schema/runtime verification, a current/one-previous
    release policy and query/fragment-preserving entry redirects are verified.
    There is no API rewrite, service worker, offline editor or activation change.
    **5/5 native packaging cases**, zero skips/cancellations, **2,198.9255 ms**;
    **6 coupled app suites / 81 tests**, **2.916 s**, open-handle detection.
    Actual pinned Linux Firebase Hosting serves **607/607** exact HEAD routes,
    rejects **30 prohibited HTTP paths**, and returns three binary model bodies
    with exact lengths/SHA-256. A native browser displays managed sign-in with
    the API deliberately blocked and **zero API requests**, loads both core
    catalogs (**2,025 / 2,296** entries), all nine configured tropical nodes,
    the character/die and **39 decoded textures**. Synthetic public databases
    are cleared and owned geometry/materials/textures disposed. Five missing
    embedded texture references are confirmed absent/404 in the original preview
    too, not packaging omissions; no unrelated artwork fix is made.
    Full lint/style/layering: zero errors / same **39 baseline warnings**.
    Temporary Hosting containers/configuration are verified removed; the browser
    helper became unavailable on close, so no successful close is claimed.
    No live deployment, new dependency, real account/campaign, original local
    host, gameplay capability or deferred routine-save UX change is made.
    See [package and measured gates](./cloud-migration-preparation.md#m4-07-owner-authorized-local-frontend-package).

- [x] **M4-08 - Obtain isolated hosted-test and identity/IAM configuration approval.**
  - **Depends:** `M4-06`, `M4-07`.
  - **Success:** record the approved test project, billable resources, runtime/
    deployment identities and least-required datastore/object/signing permissions.
    A Hosting preview is not mistaken for a separate Auth/database environment.
  - **Verify:** explicit owner approval precedes provisioning, IAM changes, or
    live writes. No downloaded service-account key or developer ADC enters an image.
  - **Completed:** November 14, 2026. The owner explicitly approves the first
    Hosting website at `https://taverntable-489d5.web.app`, updating the existing
    `taverntable-api-test` service with tested code, and up to **10 disposable
    accounts / 2 synthetic campaigns**, with cleanup. This uses the already
    selected personal project, not a separate Auth/database environment.
    No real campaign migration/cutover, local-host change, existing account UID/
    provider/password/verification change, new IAM privilege or billing-setting
    change is included. Reported budget alerts remain non-capping; deleted object
    retention remains seven days.
    Read-only inspection verifies the current owned API service, **min 0/max 1,
    1 CPU/1 GiB**, request CPU, **concurrency 40 / 3600 s**, exact Hosting origin,
    existing platform invocation and dedicated keyless runtime. Only
    `datastore.user`/`firebaseauth.viewer` plus the conditional campaign-object
    role apply; the image repository is private. The exact Hosting Auth domain,
    Google and email/password providers are already enabled; no provider
    configuration is changed. The default public site is currently **404 / Site
    Not Found**, not an existing TavernTable frontend being overwritten.
    The tropical pack is labeled **owner-reported free use**, as requested,
    without fabricating a creator's license or assigning CC0/MIT. Its formal
    provenance gap and the other original asset conditions remain recorded.
    The first pilot candidate is separately rebuilt/validated; actual publication
    and hosted acceptance remain `M4-09`.

- [x] **M4-09 - Deploy and smoke-test only the approved isolated environment.**
  - **Completed:** November 14, 2026. The approved existing-project pilot is published at
    [the default Hosting URL](https://taverntable-489d5.web.app). Real API,
    scoped private assets, Free Play/native movement, reconnect/revocation,
    managed verification/reset-code and public-package integrity gates pass
    with disposable fixtures and verified cleanup. The owner confirms normal
    Google sign-in and campaign-home access after explicitly approving app-only
    enrollment of their existing linked account. No UID, credential, provider,
    verification, IAM or campaign-role changes; no real campaigns migrated.
    Existing email/password was not manually retested by the owner; real
    disposable-account password/verification/reset protocols passed, with no
    actual email-delivery claim.
  - **Depends:** `M4-08`.
  - **Success:** the default Hosting URL opens independently; browsers use the
    configured Cloud Run HTTPS address with exact origins/auth domains. Platform
    invocation permits browser access as needed, but application identity/access
    still protects every campaign operation.
  - **Verify:** real Google/password/verification/recovery flows, private save/
    reopen and asset delivery work there. No production campaign is migrated or
    source-of-truth switch performed.

- [x] **M4-10 - Pass hosted identity, authorization, privacy, and configuration gates.**
  - **Completed:** November 15, 2026. All 49 actual hosted role cases, real
    private-store denials, scoped runtime-log privacy and deployed configuration/
    IAM checks pass. An original real signed token is rejected after literal
    expiry; a fresh same-UID token succeeds. Declared seeded-counter rate,
    storage and ownership boundaries plus actual four-stream admission/
    fifth-stream denial pass, with verified exact cleanup and no real-user
    credential or campaign-role changes.
  - **Depends:** `M4-09`, `M2-03`, `M2-04`, `M2-08`, `M3-01`.
  - **Success:** production-intended configuration rejects emulator/forged/expired
    identity and unauthorized operations; CORS/platform reachability never
    substitutes for Firebase verification or campaign access.
  - **Verify:** run the real HTTP/stream/asset/backup permission matrix; account
    linking/switching, revocation, origin preflight, quotas and private rule/IAM
    checks pass. Logs and deployed packages disclose no credentials/private bodies.

- [x] **M4-11 - Configure observable operation/cost metrics and verify existing alerts.**
  - **Completed:** November 15, 2026. Actual platform metrics, regional resources
    and retention are inspected. No existing budget was present; approved Billing/
    Budgets API enablement and one USD 25 monthly project-only alerts budget
    are verified, without IAM grants or billing-link changes. Two isolated
    five-save cohorts match actual provider/client request counts and measure
    reads/writes; owner validated receipts, player operation readiness and
    remote SDK delivery are timed separately. Exact cleanup passes. This is observability, not the
    controlled-200-ms p95, idle/performance or 30-hour cost acceptance.
  - **Depends:** `M4-09`.
  - **Success:** measure active instance time, acknowledgements vs delivery,
    reads/writes per save, transfer by delivery path, reconnects, retained/soft-deleted
    bytes, backup failures, builds/images and bounded logs.
  - **Verify:** record actual currency, project/product coverage, thresholds and
    recipient using redacted evidence. The owner-selected November 15 thresholds
    are **50/90/100% actual ($12.50/$22.50/$25)** and **100% forecast**, replacing
    the earlier proposed 5/10/15/25 milestones. Verify notification configuration.
    Alerts are not a hard cap, and no automatic billing shutdown is introduced.

- [x] **M4-12 - Pass hosted scale-to-zero, lifecycle, cache, and performance tests.**
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
  - **Completed:** November 15, 2026, on exact revision `00015-rgg` and matching
    verified retained-release frontend. The owner-approved client-proof protocol
    fixes the reproduced proxy-held request: explicit close takes **250.31 ms**;
    deliberately blocked ACK/close/reconnect with a genuinely held upstream
    expires in **90,310.82 ms**, preserving the other campaign's ready stream.
    All **105** ordinary receipts, including due-backup moves, have
    **1,789.49 ms p95 / 2,650.85 ms maximum** at verified representative RTT;
    public SDK operation readiness is separately **2,660.84 ms p95**.
    All **245** retained R8 observations have **1,815.48 ms p95**; earlier
    slow/rejected attempts are documented, not silently dropped.
    Ten healthy idle clients measure **524.96-599.95 B/min/person**, including
    outgoing/incoming ACK JSON and SSE, without scene polling. Warm rejoin
    takes **1,594.08 ms** with zero unchanged image/graphic bodies and fresh
    authenticated authority. Exact provider/client request identities match.
    Actual Keep Active, 55/60-minute warning/pause, all ten managed rotations,
    **3,882,799 ms** continuous play, and exact 15-minute disconnect grace pass.
    Fifty-nine hosted memory sample means stay below 1 GiB, maximum
    **257,257,472 bytes**, not an instantaneous peak claim.
    Fresh current-revision **active=0/idle=0** points precede and follow static
    website/Auth-only work, with no game request. Authorized cold-sheet read
    takes **5,221.46 ms**; an actual save/fresh reread succeeds without starting
    a game/stream, then another fresh **0/0** point verifies re-sleep.
    The full stable gate passes **307 suites / 4,017 tests**, **1,762.935 s**,
    with open-handle detection. Final exact cleanup at **10:35:39.575Z** removes
    **10 UIDs / 2 campaigns / 220 live generations**; originals, real account,
    settings/IAM, gameplay gates and deferred save feedback remain untouched.
    See [accepted R8 evidence](./cloud-migration-preparation.md#r8-ack-inclusive-measured-report-accepted-technical-pilot).

- [x] **M4-13 - Produce and review the measured hosted-pilot cost/readiness report.**
  - **Depends:** `M4-10`, `M4-12`, `M2-11`.
  - **Success:** extrapolate measured representative work to **30 shared gameplay
    hours/month**, adding wake-ups, idle tail and all storage/operation/transfer/
    build/log categories. Include 20 backups, soft-delete retention, shared free
    allowances, and current region/delivery-specific prices without double counting.
  - **Verify:** compare in the verified budget currency against the $25 planning
    budget. If targets or forecast fail, fix/retest or obtain a revised owner
    decision; do not claim the initial $0-10 estimate as a measured guarantee.
    No convenience always-on database, connector or load balancer is added.
  - **Completed:** November 15, 2026. The
    [measured R8 report](./cloud-migration-preparation.md#r8-ack-inclusive-measured-report-accepted-technical-pilot)
    uses **59** exact provider/client request identities, ACK-inclusive
    control/five-move windows, actual document/GCS/all-kind network counters,
    current regional USD prices and explicit storage/maintenance/log allowances.
    Raw Monitoring HTTP buckets are retained separately, not misused as exact
    request-event timestamps. All shared free grants are conservatively assumed
    consumed. Thirty shared gameplay hours plus **2.25 active-tail hours**,
    **36,000 moves**, backups/soft retention and all cost categories project
    **USD 12.4285 paired / USD 15.5656 gross-minute upper**, leaving
    **USD 9.4344** against the approved USD 25 alerts budget. The upper scenario
    is recommended; the confounded raw paired write difference is not treated
    as zero write cost. These are declared-workload estimates, not an invoice,
    hard cap, initial $0-10 guarantee, real-source approval or production cutover.

### M5 - Selected migration, rehearsal, and production cutover

- [x] **M5-01 - Select migration sources and authorize a rehearsal copy.**
  - **Completed:** November 15, 2026. The owner explicitly authorized selecting
    any original testing campaign for the existing private pilot, with the
    verified Google owner. Fresh inventories cover both original hosts;
    local-3002-candidate-5 was selected by saved-sheet/actor/map coverage, not
    names or newest timestamps. Trusted loopback DM access proves the exact
    source directory. Actual managed Google identity matches authoritative
    imported ownership; identifiers and credentials remain private.
  - **Depends:** `M0-02`, `M4-13`.
  - **Success:** inventory both local test data sources; explicitly select
    campaigns, destination/test environment and owner UID. Prove trusted local
    DM access without making browser assertions or old keys into cloud ownership.
  - **Verify:** record owner approval for the selected rehearsal copies. Names/
    newest timestamps do not choose/merge campaigns; raw legacy keys/invitations
    are not copied to bundles, Git, chat or cloud logs.

- [x] **M5-02 - Preserve independent original exports and show a migration preview.**
  - **Completed:** November 15, 2026. Independent read-only SQLite and trusted
    host complete exports match exactly: **653,323 UTF-8 bytes**, SHA-256
    `d72595326b2cdbf252239c46c2f4742483f8a534fb6c5f491d6a0f264d8dcfb1`.
    Deep shared-domain/catalog/scene validation and the owner preview confirm
    **8 sheets / 8 actors / 42 maps / 116 connections**, 2014/core 5.1,
    one pack, inactive combat and no embedded images. Both original databases,
    source access records and host-key bytes remain unchanged and recoverable.
  - **Depends:** `M5-01`.
  - **Success:** make complete independent JSON exports/checksums before changes;
    preview selected records, roles/assignments, unsupported data and expected
    new private cloud copies.
  - **Verify:** original local data remains untouched and recoverable. The
    approved selection/preview matches actual source versions, not an older QA
    checkout or similarly named campaign.

- [x] **M5-03 - Create non-destructive private rehearsal copies.**
  - **Completed:** November 15, 2026. The current published owner UI imports the
    selected complete file as a new private campaign under the actual verified
    Google account. Authoritative ownership and fresh private object prefixes
    are checked. Original IDs/data are preserved outside the new authority;
    portable owner claims, old host keys and invitations are not imported.
    Existing verified import-intent/CAS gates continue to cover uncertain retries.
  - **Depends:** `M5-02`.
  - **Success:** publish validated new cloud copies in the approved rehearsal
    environment under the verified UID. Existing cloud campaigns still require
    their current owner's authority.
  - **Verify:** repeated/interrupted import cannot partially replace a campaign
    or duplicate costs. Portable ownership claims and legacy secrets are not
    trusted; no local original is overwritten or silently kept in writable sync.

- [x] **M5-04 - Compare all migrated data and complete the export/restore round trip.**
  - **Completed:** November 15, 2026. Actual complete cloud export is
    **653,322 bytes**; the supported complete JSON copy-text path supplies a
    real JSON file to the authenticated importer for a second private copy.
    Its actual export matches the original and first copy across every sheet
    value/source pin and the whole scene, terrain, topology, placement and
    combat state. Only fresh campaign identity/revision/time metadata differs.
    Native browser download-event confirmation is not claimed.
    See [private rehearsal evidence](./cloud-migration-preparation.md#m5-01-through-m5-05-selected-private-rehearsal-and-returning-accounts).
  - **Depends:** `M5-03`, `M2-10`.
  - **Success:** verify character counts/IDs, edition/source pins, scene topology,
    images/assets, terrain, combat state, resources and assignments. Document
    expected new-campaign metadata differences explicitly.
  - **Verify:** export the cloud copy, restore a separate private copy and compare
    canonical data/integrity again. Successful object upload alone does not pass.

- [x] **M5-05 - Bind returning players to verified account seats.**
  - **Completed:** November 15, 2026. Two approved disposable verified accounts
    redeem fresh single-use owner-UI invitations; acceptance automatically
    enables them without a manual pilot grant. Original legacy assignments
    bind to their persisted seats as **4 + 2 existing character IDs**.
    Actual managed sign-out/sign-in in isolated in-memory Auth apps preserves
    each UID, seat, access generation and exact assigned rows, without owner
    privileges or full-scene reads. The verified Google owner's session/settings
    and complete campaign export remain unchanged; temporary credentials and
    consumed invitation secrets are removed. Same-UID provider linking remains
    covered by the earlier approved live `M2-04` gate.
  - **Depends:** `M5-04`, `M2-02`, `M2-03`, `M2-04`.
  - **Success:** existing seats/character assignments attach through account-bound
    invitations without recreated records or display-name guessing. Cloud login
    no longer depends on a local host key or reusable bearer invitation.
  - **Verify:** intended participants return through both supported sign-in
    methods as applicable; removal/reissue/linking retains the correct data and
    never grants another seat's access.

- [ ] **M5-06 - Run a representative ten-client, full-session rehearsal.**
  - **Status:** in progress. The owner approved gameplay activation and matching
    publication only to the existing private pilot; both gameplay capabilities
    are deliberately enabled there. Normal returning-owner startup, ten-client
    admission, Free Play movement and current scoped delivery work. Original
    returning assignments remain **4 + 2**; no real owner Auth or original-host
    changes were made. Measured projection/sight/motion and same-transaction
    metadata fixes are committed and privately published through API
    `00024-2ps`, source `103ac90...`, with matching frontend `57cb5484...`.
    The CPU1/GiB1 image passes 38 exact runtime hashes and native/isolation
    gates; temporary request/CPU diagnostics are removed. The subsequent
    backend-only presence fix is now privately deployed as API `00025-vt4`,
    source `f5d0d10...`, image `792fcc39...`; the unchanged frontend remains
    matching. Its exact 38-hash/native/isolation gate passes.
    A fixed **40-command** actual managed-client preflight includes **20 moves
    and 20 facing controls** across all nine member identities plus the native
    owner, under recalibrated 200-ms RTT. All ten scopes remain current through
    generation 67, with zero stream errors or 503 responses. **Latency still
    fails:** durable receipt median **1,897.1 ms**, p95 **3,854.6 ms** against
    **2,000 ms**, maximum **4,473.2 ms**. Cold, automatic-backup and other slow
    valid samples are retained. The earlier **11,347-ms** aborted-run result is
    also retained; neither run is a completed full-session pass.
    After that fixed preflight, the complete final backup was saved at
    generation 67, the private game was verified paused, all nine member
    observations were closed, and test transports/workers were restored/stopped.
    Full evidence and rejected experiments are recorded in
    [the preparation log](./cloud-migration-preparation.md).
    On 2026-11-16 the owner clarified that a short delay is acceptable; the
    concern is disjointed live views that replace walking/running with a
    start-to-destination teleport. Native DM-to-player and player-to-DM motion
    is the immediate acceptance priority, not another numeric timing proposal.
    The focused native movement gate passes **32 tests / four suites** in
    **120.261 seconds**. This is not a completed foreground hosted visual check,
    and no replacement numeric latency threshold has been approved.
    The current complete stable gate also passes **307 suites / 4,067 tests**
    with open-handle detection in **1,820.696 seconds**.
    The owner subsequently instructed continuing on an assumed-success basis
    and will perform the manual animation check after the remaining work.
    That check is **deferred, not passed**, and does not block continued private
    rehearsal/recovery work. The original timing observations remain recorded;
    no new numeric pass or production/cutover approval is implied.
    The latest extended real-clock attempt started at client UTC
    **2026-11-16 18:52:20.077** on the same private release and existing nine
    fixture identities plus the native owner. It stopped after **1,173.813
    seconds**, not four hours, when an instantaneous helper assertion sampled
    the native owner during stream reconnection. The replacement stream's
    headers arrived 270.8 ms after that assertion; the owner then recovered.
    Setup and an earlier 67.0555-second aborted harness attempt are excluded.
    Hosted checks cover a correct
    off-turn refusal, off-turn dice, Dash/Undo, turn end, Free Play walk/run with
    no restricted debit, an emote, exact assigned-note save/restoration and warm
    rejoins. All ten scopes subsequently reached generation 131 with no 503 or
    pending command. After that attempt the game was verified paused, the nine
    members were closed, transports/workers restored/stopped and complete final
    backup saved at generation 131.
    The version-3 private helper now waits for bounded normal reconciliation.
    An actual owner reconnect check passes in **2,496.6 ms**, with all nine
    members current and no pending write. Fresh pre-run calibration p95 is
    **204.3/204.0/204.3 ms** for owner/primary/other members. All nine original
    fixture identities are freshly admitted; returning observer assignments
    remain **4 + 2**. The new actual run starts at
    **2026-11-16T19:48:10.195Z**. Its initial hosted gameplay, exact note
    save/restoration (character revision 11 to 13), and primary/original-account
    warm rejoins pass with zero transferred private image bodies. The run is
    not a completed four-hour result. At **2,664.697 seconds**, one member's
    presence ACK returned 404/`campaign-not-found`, ending that client's world
    authority while the owner and eight other members remained current at
    generation 219. Diagnostic token claims are verified/current, and fresh
    access with the original seat/generation plus a fresh participant snapshot
    both succeed. No UID, seat or permission was reset. The failure is isolated
    to presence renewal rather than actual campaign removal. Both new focused
    regressions first fail against the deployed behavior: the stale channel is
    misreported as 404, and a real managed HTTP observer becomes denied.
    The local fix preserves fresh campaign authorization and classifies missing
    and foreign channels uniformly as retryable client-presence-expired.
    **13 coupled lifecycle cases / 106.622 seconds** and **87 client/SSE unit
    cases** pass, including genuine revocation denial. The fixed private API
    now returns the retryable denial for actual closed/unknown channel ACKs;
    the original member grant remains current and the normal managed player
    reopens at generation 219. This diagnostic is not a latency or animation
    acceptance test.
    All 83 accepted commands are retained with no pending mutation or 503.
    That failed attempt ended with the private game paused, all nine member
    observations and three latency workers/control channels closed, and complete
    final backup saved at generation 219, error null.
    A fresh fixed-release run starts at **2026-11-16T21:08:32.666Z**. New added-RTT
    calibration p95 is **205.6/205.6/205.8 ms** for owner/primary/other members;
    returning observer assignments remain 4 + 2. Initial hosted commands, exact
    note save/restoration (character revision 15 to 17), and warm image-cache
    rejoins pass. The game is now live for this new run, not left paused; no
    earlier aborted/setup time counts toward its duration.
    **The four-to-five-hour rehearsal, production approval and selected-source
    cutover remain incomplete/unapproved.**
  - **Depends:** `M5-05`, `M4-12`.
  - **Success:** exercise a representative four-to-five-hour session: Free Play,
    combat, doors/rooms, assets, sheets, animation, reconnects, backup work and
    owner controls, with no divergence, disclosure or duplicate costs.
  - **Verify:** record actual latency, bytes, operations and retained storage;
    include forced replacement and quiet/forgotten/disconnected cases. Controlled
    time proves no fixed six-hour cap. Observe native walk/run movement in both
    directions on the initiating view and other authorized visible views:
    intermediate positions and locomotion must render without a destination
    snap, echo restart or duplicate movement cost. A short presentation-start
    delay is acceptable; reconnects still restore current state rather than
    replaying historical movement. Re-run the complete acceptance matrix.

- [ ] **M5-07 - Prove recovery and release rollback, not just backup creation.**
  - **Preparation:** three current-source emulator restore cases pass in
    **33.560 seconds**: both rulesets preserve exact sheets, private images,
    topology and resources; an uncertain restore recovers the same copy.
    The actual real-owner restore-as-copy and hosted rollback/drain drill remain
    unperformed.
    Read-only inspection verifies the retained generation-131 complete file
    (654,129 bytes, eight records/actors, 42 maps, 116 connections), both approved
    image digests and both retained frontend entries. A local rollback package
    is fully verified with all **1,216 application file hashes unchanged**,
    retaining both full frontend trees and all six retired-entry bridges.
    A separately fenced image helper refuses mutation without real completed
    rehearsal evidence; only its read-only preflight and negative guard ran.
    Incompatible package metadata is rejected before deployment. None of these
    preparation checks substitutes for the actual restore/rollback/client drain.
    Earlier backend recovery fences predate the presence fix and must be
    refreshed before use; an image with the confirmed denial bug is not silently
    accepted as a production fallback.
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

## Post-migration follow-ups

These are explicitly deferred user requests, not additional migration exit tasks.

- [ ] **UX-01 - Remove disruptive routine-save feedback.**
  - **Status:** deferred until the migration is complete, as requested.
  - **Depends:** `M5-11`.
  - **Report:** saving flashes the screen and presents a centered "Saved to cloud"
    box, interrupting play.
  - **Success:** routine saves do not flash, steal focus or display a centered
    notice. Durable, unsaved and error states remain truthful and accessible.
  - **Verify:** exercise repeated scene/character autosaves and confirm gameplay
    stays visually stable; failed or uncertain saves remain explicit.
  - Do not implement this follow-up during the migration.

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
