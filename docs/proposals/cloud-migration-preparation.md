# Cloud migration: preparation and verification

**Implementation branch:** `feat/cloud-accounts-multiplayer`. This evidence
describes that branch; mirroring this document into another checkout does not
merge its implementation or authorize production.

## Workspace evidence

`M0-02` completed November 10, 2026:

- Created `feat/cloud-accounts-multiplayer` in an isolated worktree directly from
  verified `main`, commit `25864ae4b551c19997da20e56f94126f4f53770c`.
- Verified the new worktree started clean before carrying the two approved
  planning documents; their transferred bytes match the existing drafts.
- Left the original feature/test checkouts, databases and access keys untouched.
- Read-only readiness requests to the existing hosts on ports 3002 and 57591 both
  returned HTTP 200. Their distinct data directories contain separate SQLite
  databases and key files; no key contents were read or displayed.

The [execution checklist](./cloud-accounts-and-multiplayer-checklist.md) in this
branch is the active work record. This preparation does not deploy cloud
resources, authorize production, or copy campaign data to the cloud.

## Payload and asset inventory

`M0-03` completed November 10, 2026 against the baseline assets. Measurements are
bytes, not JavaScript string lengths. This inventories inputs; it is not the
final public deployment allowlist, migration selection, or legal clearance.

### Reproduction and privacy

Run the [inventory command](../../tools/migration-inventory.js) from the migration
worktree, substituting the explicit local data directories:

```powershell
node tools\migration-inventory.js `
  --source local-a=C:\TavernTableData\source-a `
  --source local-b=C:\TavernTableData\source-b
```

The version-1 JSON report contains tracked asset paths/sizes/SHA-256 hashes and
labeled aggregate local measurements. It does not contain local directory paths,
campaign names/IDs, character names, record keys, private image bodies/hashes,
or credentials. Host access-key files are never opened.

SQLite is opened with `readOnly: true` and `query_only`, and related reads share a
read transaction. Existing backup files are measured by filename eligibility
and filesystem byte size, not parsed/exported. Incomplete staging files are
excluded. Backup-name eligibility reuses the existing backup Module.

[Regression coverage](../../tests/unit/campaigns/MigrationInventory.test.js)
checks exact UTF-8/binary lengths and hashes, untracked-file exclusion, catalog
integrity mismatch, database/key byte preservation, private-image accounting,
the 1 MiB boundary, backup/staging separation and CLI privacy. Together with
existing backup tests: **2 suites / 11 tests passed**; changed JavaScript lint
passed. This is targeted evidence, not a new full application-suite run.

### Tracked asset totals

| Family                              |     Files |           Bytes |
| ----------------------------------- | --------: | --------------: |
| Items                               |         1 |       5,095,908 |
| Animated sprites/models/clips       |        86 |     142,890,875 |
| Data/catalogs/notices               |        21 |      16,156,898 |
| Images                              |        15 |           7,209 |
| Sprites                             |         2 |       1,750,632 |
| Terrain/model/texture source assets |     1,019 |     336,215,062 |
| **Total**                           | **1,144** | **502,116,584** |

- Unique content: **1,107 hashes / 436,058,630 bytes**. The remaining 66,057,954
  bytes are repeated content, not a reason to delete source assets blindly.
- Largest tracked model: **20,107,744 bytes**. A tracked authoring texture is
  **16,777,260 bytes**. The entire tree must not be sent on every join.
- Canonical asset-list digest: SHA-256
  `e1c7fbc84eed5ff916ed6ae85fdf06d204fb83891a2e717140ebc22685015cec`
  over UTF-8 `JSON.stringify(report.assets.files)` in the command's sorted order.
- These are raw tracked inputs, including authoring formats/duplicates. Hosting
  output and added SDK/runtime dependencies require a fresh measured allowlist
  at `M4-07`, not an assumption that all 502 MB should be published.
- Existing Three.js/Cannon imports are pinned native ESM CDN imports in
  [index.html](../../index.html), not an existing application bundler. Account
  integration must not introduce a frontend-framework rewrite.

### Pinned resource packs and license records

The [resource manifest](../../assets/data/resources/manifest.json) contains
**16 packs / 15,131,548 bytes**. All recorded pack byte lengths and hashes match
their tracked bodies. **Seven packs are at or above 1,048,576 bytes**. They remain
versioned assets; they must not become Firestore documents.

| Evidence                                                                                                                  | Recorded declaration / implication                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Resource notices](../../assets/data/resources/NOTICES.txt) and manifest                                                  | Pack-level CC BY 4.0 / OGL 1.0a declarations and source/version attribution. Declarations are not a blanket license for unrelated models/images.               |
| [SRD notice](../../assets/data/SRD2014-NOTICE.txt) and [upstream license](../../assets/data/SRD2014-UPSTREAM-LICENSE.txt) | Preserve structured-data and underlying rules attribution.                                                                                                     |
| [Nature kit license](<../../assets/terrain/3d Assets/License_Pro.txt>)                                                    | Recorded CC0 declaration for that kit.                                                                                                                         |
| [Forest kit license](../../assets/terrain/plants/forest/Forest_Kit_License.txt)                                           | Recorded CC0 declaration for that kit.                                                                                                                         |
| Animated character assets and unrelated Items/sprites/images                                                              | No applicable per-family license/provenance record was found in the inspected tracked notices. Public redistribution must be reviewed before `M4-07` can pass. |

Do not treat the application's MIT package declaration, a pack's OGL notice,
or a nature kit's CC0 declaration as permission for every repository asset.
Optional-pack provenance and all required notices must be checked against the
actual public allowlist. No new public asset deployment is authorized here.

### Current local save measurements

Aliases identify the two already-running test data sources. No selection,
export, merge, or account claim was performed. Counts are across all campaigns
in each source, not a per-campaign backup-retention count.

| Measurement                               | local-3002 | local-57591 |
| ----------------------------------------- | ---------: | ----------: |
| Campaigns / saved scenes                  |      6 / 6 |       2 / 2 |
| SQLite campaign-record JSON bytes         |  1,578,526 |     729,563 |
| Metadata-only JSON bytes, excluding scene |      2,120 |         679 |
| Largest metadata-only record              |        362 |         340 |
| Canonical scene-string bytes              |  1,371,820 |     634,958 |
| Largest scene-string bytes                |    559,021 |     632,623 |
| Character/companion records               |         10 |           3 |
| Character/companion value bytes           |      6,730 |       1,966 |
| Largest character/companion value         |        679 |         660 |
| Embedded image occurrences                |          0 |           0 |
| Eligible backup JSON files                |         34 |           7 |
| Backup-file bytes                         | 13,624,566 |   2,197,691 |
| Largest backup file                       |    823,620 |     727,685 |

No measured local scene, metadata record, character value or backup reaches
1 MiB. That does **not** make embedding whole saves in Firestore safe: valid
future artwork/maps and seven current catalogs already establish larger cases.
Embedded-image tests cover encoded/decoded/unique byte accounting without
publishing private image content; actual local samples currently contain none.
Inventory does not establish semantic save validity or replace the migration
comparison/restore drill.

### Existing size contracts and cloud consequences

| Current contract                    | Existing limit / caveat                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local HTTP request body             | 64 MiB of received bytes in [local-host.js](../../tools/local-host.js).                                                                                                          |
| Scene string                        | 16,000,000 JavaScript characters in [CampaignStore](../../src/campaigns/CampaignStore.js); this is not a UTF-8 byte limit.                                                       |
| Character record / companion record | 4,000,000 / 1,000,000 JavaScript characters respectively in the existing store.                                                                                                  |
| Image input / persisted data URI    | 10,000,000 input bytes / 1,000,000 data-URI characters; portrait/artwork targets 512/1024 in [CharacterImages](../../src/config/characters/CharacterImages.js).                  |
| Existing complete-backup read       | 128,000,000 file bytes in [CampaignBackups](../../tools/campaign-backups.js).                                                                                                    |
| Firestore document                  | 1 MiB including document overhead; a payload just below that is not automatically safe as a field.                                                                               |
| Cloud Run HTTP/1 request            | 32 MiB according to [current Cloud Run limits](https://cloud.google.com/run/quotas), checked November 10, 2026. Ordinary non-streamed HTTP/1 responses also have a 32 MiB limit. |

Keep compact metadata/revision/receipt documents in Firestore and canonical
snapshots/artwork/complete backups in private Storage. Existing local request
limits cannot simply be copied to Cloud Run. Large owner imports/assets require
the staged/direct/resumable path before full persistence/migration gates pass;
larger inputs must receive explicit errors, never truncation or a fake success.

## Verification matrix and initial implementation decisions

`M0-04` records the test strategy and parameters; it does not mark future
behavior implemented.

### Environment and starting values

- **Local mode:** preserve loopback/cookie/CSRF/SQLite behavior and current
  committed-state semantics. Cloud errors must never select writable local mode.
- **Emulator mode:** use the explicit synthetic project `demo-taverntable`, with
  Auth, Firestore and Storage endpoints required to be loopback. Missing/mismatched
  endpoints fail before SDK initialization; the real default project/ADC must not
  become a fallback.
- **Test identities:** labeled synthetic verified eligible UID-A, eligible UID-B,
  unverified UID-C and ineligible UID-D. They are not real participant accounts.
  Emulator-only fixtures grant eligibility; the browser cannot grant it.
- **Runtime prerequisites measured:** Node 24.4.1, npm 11.4.2, Firebase CLI 15.11.0,
  Java 17.0.19. The installed CLI explicitly requires Java **21+** for Java-based
  emulators. Resolve that prerequisite for `M1-02`; do not downgrade the CLI or
  run against live resources as a workaround.
  An actual `firebase.cmd emulators:exec` attempt using
  [the loopback-only configuration](../../firebase.emulators.json), explicit
  `--project demo-taverntable` and Auth/Firestore/Storage selection failed before
  startup with that Java-version error. No live project was substituted.
- **Hosted starting configuration:** Oregon, request billing, 1 vCPU / 1 GiB,
  minimum 0 / initial maximum 1, concurrency 40, request timeout up to 60 minutes,
  reconnect earlier with jitter. These are recorded proposal defaults, not a
  configured deployment or a concurrency/durability guarantee.
- **Provisional invitation/journal defaults:** seven-day single-use invitations;
  at most 1,000 compact reconnect changes and 24 hours. Journal retention is not
  permission to discard durable idempotency receipts and re-execute an old command.
- **Upload/request/account/stream quotas:** select and enforce phase-appropriate
  measured values in `M2-07` / `M2-08`; full-size HTTP/1 proxying is not assumed.
  The first emulator slice must test Storage payloads above 1 MiB and explicit
  oversized/malformed rejection. It is not complete large-import coverage.
- **Cache/log/maintenance budgets:** finalize bounded policies in `M3-07`,
  `M2-11` and `M4-11`, using the actual allowlist and hosted measurements.
  Unresolved values remain release conditions, not silent unlimited defaults.
- **Approved fixed policies:** 55/60-minute inactivity and 15-minute disconnect
  grace, no total session cap; 20 rolling backups and five-minute changed-state
  targeting; $25 reported alert budget with currency/settings verification.
  No new approval is inferred from this implementation record.

### Tests and proof required

| Behavior                    | Feedback loop / expected proof                                                                                                                                                                        | Gate                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Identity and eligibility    | Real emulator Auth/Admin calls; reject anonymous/forged/expired/unverified/ineligible identities. Later verify production rejects emulator tokens.                                                    | M1-03, M4-10        |
| UID isolation               | Eligible UID-A explicitly creates; eligible UID-B cannot list/read/write its private data or fetch referenced objects through the application. No global DM role or name/email matching.              | M1-06, M2-13        |
| Both login methods          | Browser SDK flows, persistence, verification/recovery, sign-out/in and token renewal; retain the UID. Live provider smoke tests remain separate.                                                      | M1-04, M1-05, M4-09 |
| Atomic publication          | Actual Firestore/Storage emulator integration, including >1 MiB UTF-8 payloads; a head never references an unverified/missing object.                                                                 | M1-07               |
| Conflicts and overlap       | Independent backend instances read the same head; exactly one conflicting publication wins and the other returns typed current revisions.                                                             | M1-10               |
| Idempotency                 | Lose the response, repeat the same ID/intent and recover the original receipt; different intent with the same ID is a conflict. No repeated resource spend or reroll.                                 | M1-10, M2-05        |
| Crash boundaries            | Terminate before object upload, after upload, before transaction, after durable publication and before announcement. Only published state is visible; orphaned uploads are not success.               | M1-10, M4-05        |
| Reopen and truthful UI      | Clean browser cache/process and replacement backend load current canonical data. Saving/saved/error states follow durable receipts, not animation/unload.                                             | M1-08, M1-09        |
| Local compatibility         | Existing host/SQLite/character/autosave tests and full stable milestone/release regressions; no source-store mutation during inventory/migration rehearsal.                                           | M1-10, M2-13        |
| Private live/cache outputs  | Inspect actual serialized outputs; then ten-client reconnect/replay/access-change cases and zero unchanged asset-body downloads.                                                                      | M3-01 through M3-10 |
| Lifecycle boundaries        | Controlled time and real stream outcomes at 55/60/15 minutes; duplicates/heartbeats/replacement do not extend activity; no fixed six-hour cap.                                                        | M4-01 through M4-05 |
| Hosted performance and cost | Ten clients, 200 ms RTT, p95 durable acknowledgement <= 2 s for ordinary commands; idle app payload < 2 KiB/min/participant. Measure delivery separately and forecast 30 shared hours plus all costs. | M4-12, M4-13        |
| Recovery and cutover        | Complete backup restore/export into a separate private copy, selected-source comparison, rehearsal and explicit production/cutover decisions.                                                         | M5-01 through M5-11 |

Use the existing Jest/integration/browser tooling. SDK/emulator commands are
recorded when `M1-02` is implemented. Baseline verification was 283 suites /
3,749 tests; new focused inventory/backup checks add evidence, not a claim that
the cloud application already passes its future gates.

## Isolated SDK and emulator feedback loop

`M1-02` completed November 11, 2026. This is development infrastructure, not
application login, cloud campaign persistence or deployment.

- Portable Eclipse Temurin **21.0.13+9** was installed with explicit user approval
  under user-local TavernTable tools. The official archive SHA-256 was verified:
  `a4dbaa05fca4bd89d84584e58c459bd732efebb1722af80ab13c6516832004f9`.
  The system-default Java remains 17.0.19; no registry/global PATH change was made.
- Pinned official packages: **firebase 12.19.0**, **firebase-admin 14.5.0** and
  **firebase-tools 15.11.0**.
- Firebase 13.2.0's modular dependencies require Node 24.12+, so it was not retained
  on this project's Node 24.4+ floor. The selected 12.19.0 components support
  Node 20+. Admin's broad `0.x` peers are resolved to the matching browser SDK
  versions (`@firebase/app` 0.16.2 / `@firebase/app-compat` 0.5.18).
  `npm install --engine-strict` passed; warnings were not bypassed by upgrading
  system Node or forcing an incompatible peer range.
- [firebase.emulators.json](../../firebase.emulators.json) binds Auth 19099,
  Firestore 18080, Storage 19199, hub/logging 19400/19401 and Firestore websocket
  19402 to loopback. The UI is disabled. Browser rules remain deny-by-default.
- [The runtime guard](../../tools/cloud/emulator-runtime.js) requires explicit
  emulator mode, a `demo-` project and all three loopback endpoints. Conflicting
  SDK project/bucket/Storage settings fail before client initialization.
- [The runner](../../tools/cloud/run-emulator-tests.js) supplies the synthetic
  project `demo-taverntable` and closes all helpers after the integration run.
  Providing `JAVA_HOME` only affects the spawned tool process's PATH.

Reproduce on Windows with a Java 21+ location for this shell:

```powershell
$env:JAVA_HOME = Join-Path $env:LOCALAPPDATA `
  'TavernTableTools\temurin-jdk-21.0.13+9\jdk-21.0.13+9'
npm run test:cloud
```

**Verified:** three real-emulator integration cases passed, zero skipped:

1. Admin Auth/Firestore/Storage round trips with exact uploaded/downloaded UTF-8
   bytes and default SDK integrity validation.
2. Browser Auth SDK password sign-in produces a token independently verified
   for the demo UID/project and verified-email claim by Admin.
3. Signed-in browser SDK clients still receive actual permission denials for
   direct private Firestore/Storage reads and writes.

Jest remains the ordinary unit/UI runner. Real SDK integration uses Node's
built-in runner under the same emulators: the identical unchanged GCS upload
passed in native Node but failed in Jest's SDK/stream interop. Integrity checks
were not disabled and SDK code was not patched. The temporary diagnostic
probe was removed.

Focused Jest checks: **3 suites / 14 tests passed**, covering inventory/backups
and fail-closed emulator configuration; changed-code lint and layering passed.
This does not replace the required full stable milestone/release gate. No
application identity/eligibility, provider UI, membership or cloud-save task is
marked complete by these SDK checks.

## Backend account gate

`M1-03` completed November 11, 2026 for the development backend:

- [CloudAccountAccess](../../tools/cloud/account-access.js) verifies Firebase ID
  tokens with revocation/disabled-user checks, requires verified email, and reads
  current server-owned pilot eligibility for every protected request.
- Operator-owned eligibility records live at
  `pilotAccounts/{SHA-256(UTF-8 Firebase UID)}` with `{version: 1, uid, enabled}`.
  Hash keys safely accommodate UID characters; the stored UID/schema is checked.
  There is no browser enrollment/approval endpoint or first-login owner shortcut.
- The verified principal is `{uid, emailVerified: true}`, not a global DM role.
  Custom `role: dm` claims do not grant application eligibility or campaign access.
- [The HTTP Adapter](../../tools/cloud/cloud-http.js) exposes authenticated
  `GET /api/cloud/account`, exact secure/loopback frontend origins and deliberate
  preflight. It rejects URL credentials/identity claims and unsupported methods.
  Local cookies/CSRF keys cannot authenticate this route.
- Invalid credentials, verification/approval denials, service unavailability and
  malformed policy records remain distinct typed outcomes. Unexpected failures
  return a safe error and log only a fixed diagnostic category, not raw provider
  messages/objects, bearer tokens or structured credential data.

**Verified:** the native cloud suite passes **15 tests**, zero skipped. Account
coverage includes the actual HTTP wire plus forged/missing credentials,
expiry/issuer/audience, unverified email, global-role claims, live eligibility
disablement, Firebase account disablement, malformed records, CORS/preflight,
local-key rejection, query/method rejection and failure redaction. Two Jest
external-service fault cases verify typed/redacted identity/metadata outages;
changed-code lint passes.

Emulator token tests establish development routing/claim/policy behavior, not a
production signature/security sign-off. Production rejecting emulator identity,
real Google/password browser flows, memberships and production validation remain
their explicit later tasks. Initial private owner metadata is recorded below;
this does not enable cloud gameplay or acknowledge nonempty cloud saves.

## Private owned campaign metadata

`M1-06` completed November 11, 2026 for the emulator development backend:

- [CloudCampaignStore](../../tools/cloud/campaign-store.js) reuses the canonical
  campaign domain for ruleset, source-pin and metadata validation. Ownership is
  derived from the verified UID, never from request options, names or email.
- Initial heads live at `campaigns/{campaignId}` and contain compact metadata,
  owner UID, head generation and null initial object references. Initial empty
  state is explicit; nonempty snapshot reads cannot quietly return an empty save.
- UID-scoped receipts at
  `accountCommands/{SHA-256(uid)}/receipts/{commandId}` bind create intent to its
  original result. Head and receipt publish atomically. Another instance can
  recover a lost reply; reusing the ID for another intent is a typed conflict.
  Current eligibility and ownership still apply when replaying a receipt.
- Eligibility and captured metadata are checked in Firestore transactions.
  Retryable metadata failures retain SDK retry behavior; final outages are typed
  unavailable results, not false missing-campaign or approval denials.
- The [cloud HTTP Adapter](../../tools/cloud/cloud-http.js) adds protected
  create/list/get/initial-character-state routes under `/api/cloud/campaigns`.
  Account tests and campaign tests share the same real loopback server fixture.
  There is no running cloud preview or deployed endpoint yet.
- Cloud commands accept uncompressed UTF-8 JSON with a **24 MiB encoded-byte**
  ceiling, leaving room below Cloud Run's 32 MiB request limit. This is separate
  from canonical character/scene limits and later direct asset transfer.
  Malformed UTF-8/JSON is rejected without echoing private input.
  The shared bounded byte reader preserves the local host's existing 64 MiB
  limit and JSON behavior; it does not instantiate a local store for cloud mode.

**Verified:** **24 native emulator/HTTP tests passed**, zero skipped. Nine
campaign cases cover canonical creation/open, two UIDs, forged ownership options,
lost replies, intent changes, independent UID command namespaces, four concurrent
instances, current revocation, strict inputs and actual HTTP behavior.
An exact **24 MiB** JSON request succeeds and **one additional byte** returns 413;
an invalid UTF-8 sequence that would otherwise form a valid create is denied.
Jest coverage includes the local-host HTTP regressions and three redacted
identity/eligibility/campaign-metadata outage cases.
The targeted Jest run passes **3 suites / 11 tests**. Full existing lint/stylelint
passes with zero errors and the same 39 pre-existing warnings; layering passes.
The full stable application suite remains the M1 exit gate, not a result of these
focused runs.

This is private initial metadata, not an immutable object/save completion gate.
Browser sign-in, complete saves, multiplayer, hosted resources and cutover remain
their respective unchecked tasks. All proof uses synthetic demo identities/data.

## Immutable object primitive: approved production proof

`M1-07` is started but **not complete**. Initial real Storage tests preserve
Unicode JSON, independently verify stored SHA-256/byte counts, and reopen through
fresh backend SDK clients. Same-content concurrent stages also return the same
reference, but that is not proof of a create-only storage guarantee.

The stronger direct SDK test writes different bytes to an existing path with
`ifGenerationMatch: 0`. In two independent emulator runs it incorrectly succeeds
instead of returning 412, including with fresh SDK option objects.
The installed SDK forwards this precondition in the GCS upload query; the pinned
Firebase emulator's upload handler does not apply it. Firebase documents that
its server-side GCS emulation is a subset of production.

The diagnostic initially reported **26 passed / 1 failed**, exposing the missing
platform behavior rather than proving immutable writes. It is now an explicit
characterization of the pinned emulator limitation; production enforcement was
verified separately below. Checksums remain enabled and dependencies/SDK code
were not patched. The M1 save/publication gate is still incomplete.

The user explicitly approved one disposable sub-KiB synthetic object in the
existing private bucket. Its 60-byte create succeeded, but the follow-up metadata
read returned 403 before the overwrite/read proof could execute. The existing
Cloud CLI independently confirmed missing `storage.objects.get`, not a scope or
quota denial. Bucket role inspection returned only legacy bucket owner/reader
bindings; no member identities were printed or recorded.

The initial read-before-delete cleanup hit the same permission denial. A direct
delete of only the exact approved object succeeded, and a subsequent existence
check verified that no live object remains. The existing soft-delete policy
still applies. No additional objects, permission changes, infrastructure,
campaign migration, deployment or cutover were created.

The user separately approved a temporary read-only IAM binding restricted to
that exact synthetic object, repeating the same-path check, then removing both
object and binding. The binding used `roles/storage.objectViewer` with a condition
matching the exact object resource name and type, never a campaign prefix.
IAM updates preserved existing bindings and used ETags for concurrency.
Operator identity and credentials were resolved privately, not printed or saved.

**Verified against real Storage on November 11, 2026:**

- The same-path **60-byte** synthetic create succeeded.
- An attempted different-byte create-only overwrite returned **HTTP 412**.
- A generation-pinned, checksum-validated read preserved the exact original bytes.
- The test object was deleted and its live absence verified.
- The temporary read grant was removed and its absence verified.
- Independent Cloud CLI checks confirmed 404 for the object and the original
  two legacy bucket-role bindings, with no temporary canary condition remaining.

The existing soft-delete policy applies to removed test bytes. No live campaign
data, deployment, cutover, new infrastructure or lasting permission grant was
introduced. This narrow approval does not authorize further live tests or IAM
changes. The planned backend-identity task must explicitly provide object-read
permission; create/delete access alone is insufficient for verified saves.

The object Adapter's 412 race branch has a focused Jest external-Storage fault
case; actual successful SDK persistence and integrity remain native integration
tests. Same-content emulator staging is not substituted for the real 412 proof.

### Implemented immutable object layer

[ImmutableCloudObjects](../../tools/cloud/immutable-objects.js) now stages
versioned private JSON with server-scoped content-hash paths, create-only upload
conditions and generation-bound references. It verifies exact UTF-8 bytes,
SHA-256, scope, kind, schema and generation before returning data. Existing
candidates are checked before any upload; corrupt content cannot be silently
replaced or treated as a successful reuse. A raced 412 still requires full
verification. Unknown SDK failures propagate; known infrastructure/permission
failures and missing committed objects are explicit unavailable outcomes, not
empty snapshots or false application-access denials.

**Verified:** **30 native SDK/emulator tests passed**, zero skipped, including
fresh-client persistence, content corruption without replacement, invalid/foreign
references, missing objects and concurrent reuse. An actual **32 MiB** encoded
UTF-8 object round-trips exactly; **one additional byte** is rejected before upload.
That object cap is distinct from the **24 MiB command-wire** limit.
**3 Jest fault suites / 5 tests** cover identity, eligibility, campaign metadata,
production 412 and Storage permission failures; changed-code lint passes.

This layer alone is not a campaign-save acknowledgment. The subsequently
completed canonical preparation/publication proof is recorded below.

## Atomic canonical publication

`M1-07` completed November 11, 2026 for the development backend:

- [CloudCampaignStore](../../tools/cloud/campaign-store.js) captures one authorized
  head and any previous UID-scoped receipt before preparation. Duplicate recovery
  does not depend on a creation catalog, another upload or re-executing a change.
  Stored create results are canonically checked before acknowledgment.
- Pinned [HostResources](../../tools/host-resources.js),
  [CampaignStore](../../src/campaigns/CampaignStore.js),
  [CampaignCharacters](../../src/campaigns/CampaignCharacters.js) and
  [CampaignScene](../../src/campaigns/CampaignScene.js) validate real rules,
  character/companion records, actor links and geometry in isolated preparation.
  No new rules serialization or second live terrain owner was introduced.
- Immutable candidate uploads and verification happen outside retryable
  Firestore callbacks. Publication rechecks current pilot/owner access, durable
  receipt, head generation and both coordinated revisions. Head, compact receipt
  and server-timestamped change marker commit in one actual transaction.
- Reads use both object references from one captured committed head and recheck
  access after loading. A between-game character-only edit preserves the existing
  scene bytes/reference, revision and saved-at value.
- The [HTTP Adapter](../../tools/cloud/cloud-http.js) exposes bearer-protected
  GET/POST scene and character routes, preserves versioned receipts, and returns
  typed 409 conflicts with current coordinated revisions. Cookie/local-key
  credentials and CORS preflight do not grant campaign authority.

**Verified:** **45 native SDK/emulator/HTTP tests passed**, zero skipped. Coverage
includes real existing character callers, 2014 and 2024 rules/source pins,
current v3 connected-map transforms/actor IDs/view state, a greater-than-1-MiB
scene with a less-than-16-KiB head, and strict input/reference limits.
The existing scene fixture is shared by Jest and native Node through CommonJS;
its values and existing caller Interface are unchanged.

Failure/interleaving proof uses actual SDK state:

- Two distinct candidates finish real uploads before publication; one wins and
  the other receives a revision conflict, with no loser receipt/change.
- Four simultaneous identical commands return the same durable result and
  produce one revision/change, not repeated mutations.
- A simulated lost upload acknowledgment after real Storage persistence leaves
  no published head/receipt; the same command safely recovers exactly once.
- A real Firestore create-precondition failure rolls back head, receipt and
  compact change together; recovery after removing the injected fault is safe.
- Eligibility revoked during a real upload blocks publication and further reads.
  An unrelated approved UID cannot read or stage either private write type.
- Malformed rules, scenes, terrain, linked/companion records and durable create
  results fail explicitly without another campaign or partial publication.

The combined targeted canonical/local-host/cloud-fault Jest run passes
**8 suites / 52 tests**. Full existing lint/stylelint passes with zero errors and
the same 39 pre-existing warnings; the layering check passes.
At this backend checkpoint, the full stable application suite, browser account/save
UI, clean-browser/backend replacement and actual forced-process-termination exit
gates remained unchecked. Current browser evidence is recorded below; the full M1
exit gate is still incomplete.
All application tests stay demo-only. The sole real Storage/IAM primitive check
was separately approved and cleaned up as recorded above.

## Managed browser account access

`M1-04` completed November 11, 2026 for the local demo environment, not hosted
release readiness.

- [Explicit runtime configuration](../../src/campaigns/CloudRuntime.js) chooses
  local or cloud mode before startup. Malformed cloud configuration fails closed;
  it never selects host-key, cookie or browser-campaign authority.
- The pinned [managed account facade](../../src/campaigns/CloudAccount.js) loads
  Firebase Auth lazily, uses SDK-managed IndexedDB identity persistence, and
  exposes safe identity/error values. TavernTable neither stores passwords nor
  handles password hashing or recovery credentials.
- The [account dialog](../../src/ui/sessions/CloudAccountLogin.js) supports Google,
  email registration/sign-in, verification refresh/resend, recovery and sign-out.
  Password fields are cleared before awaiting the SDK, without trimming passwords.
  Verified email and current server-owned private-pilot approval are separate
  requirements; authentication grants no global DM identity.
- [Account-bound HTTP](../../src/campaigns/CloudAccountConnection.js) uses bearer
  credentials only, rejects late responses after identity changes, and allows one
  same-body identity renewal. Each HTTP attempt is aborted after 60 seconds;
  timeout is unconfirmed, not a save acknowledgment.
- `npm run dev:cloud`, using the same Java 21/demo endpoint guards as
  `npm run test:cloud`, serves the explicit emulator shell at
  `http://127.0.0.1:19410/`. The loopback development host has no local campaign
  authority and cannot serve private project files or legacy session APIs.

Actual integrated-browser checks used synthetic `.invalid` accounts and the
local `demo-taverntable` project only:

1. Google popup cancellation retained the signed-out state. An explicitly
   approved synthetic Google sign-in reached the distinct private-pilot denial;
   trusted emulator-only approval and refresh opened the cloud campaign picker.
2. Email registration cleared the password field and required verification.
   Resend produced a managed action code; applying that code through the real SDK
   and refreshing access reached the separate private-pilot denial.
3. Incorrect credentials produced a safe, explicit denial and cleared the field.
   Recovery was requested through the actual form. A real SDK password-reset
   action followed by email sign-in preserved the original verified UID.
4. Trusted emulator-only approval opened the email account's private picker.
   Account registration, recovery and login had created zero campaigns.

No production account, SMTP delivery, hosted provider configuration, deployment
or additional live IAM/storage write is claimed by this development evidence.

## Browser save feedback and returning identity

The initial browser integration evidence below was followed by the completed
`M1-05`, `M1-08` and `M1-09` development checks in the next section.

- [Cloud client storage](../../src/campaigns/CloudCampaignClientStore.js) validates
  high-level reads/receipts without opening browser campaign authority. A pending
  command keeps its immutable ID/body and original caller promise in memory;
  another mutation is refused until explicit recovery. This is not a durable
  offline queue.
- [Global save feedback](../../src/ui/campaigns/CloudSaveFeedback.js) is attached
  before the first campaign mutation and then observes the existing scene
  coordinator. Saving, Saved to cloud, Unconfirmed and Not saved are distinct.
  A dirty scene cannot keep displaying its previous Saved status during the
  quiet checkpoint delay.
- Pending/unconfirmed writes, offline access and definitive conflicts pause new
  input. Recovery retries the same command; definitive conflicts require
  reopening with an explicit unsaved-change warning. Safe sign-out/picker exit
  pause input across the final flush and account operation. Existing two-second
  quiet/ten-second maximum and stable-movement checkpoint rules are unchanged.
- The actual browser's HTTP seam deliberately discarded one successful creation
  reply after real Firestore publication. UI phases were
  `idle -> saving -> uncertain -> saving -> saved`; the original caller remained
  pending, the picker was blocked, and explicit retry sent byte-identical JSON.
  The caller opened the original published ID and exactly one new campaign
  existed. The fault wrapper and observation hooks were removed afterward.
- Reload and a new integrated-browser tab restored the same UID and the same two
  intentionally created test campaigns. A synthetic first HTTP 401 caused real
  SDK renewal followed by an approved same-UID profile; no campaign was created
  by restoration or renewal.
- Sign-out cleared the active tab and the other tab's private view. The hidden
  integrated webview delayed its Firebase persistence notification by about 44
  seconds; this is not evidence of immediate cross-tab notification. Foreground
  switching in actual Chrome remains to verify.

**Current checks:** the combined targeted run passed **11 suites / 66 tests**.
The six feedback cases include real client/domain/canonical scene coordination,
actual changed v3 camera state published before SDK sign-out, uncertainty,
offline access, conflict, shortcut isolation and exit-failure recovery. Existing
local/player menus and checkpoint regressions pass, as do the separate eight
existing local-host integration tests for the shared public-file resolver.
Full lint/stylelint has zero
errors and the same 39 existing warnings; layering passes.

The integrated Electron browser has no WebGL. It correctly refuses to open the
3D game after campaign selection, without resetting saved data. No rendered
cloud-board success is inferred from account/launcher tests; actual Chrome
acceptance is recorded below.

## M1 browser and restart acceptance

`M1-05`, `M1-08`, `M1-09` and `M1-10` completed November 11, 2026 for the emulator
development slice. Production deployment and selected-data cutover remain
separately gated.

### Actual Chrome and canonical restoration

- With separate explicit approvals, the installed Chrome signed into the
  existing synthetic Google fixture, created one named demo campaign and created
  `Migration scout`. The account retained its previous UID and saw none of the
  unrelated email fixture's campaigns.
- Chrome rendered through hardware graphics and durably saved a generated
  100-by-100 v3 castle, its terrain placements and a linked mannequin actor.
  Reloading the document restored the managed account without another sign-in,
  listed its existing campaign and reopened the saved board.
- A strict comparison found a real restore defect: loading the saved perception
  scale also invoked legacy smoothed 3D parity scaling, changing physical world
  elevation. A deterministic test using the real GameManager, TerrainEngine and
  scene adapter reproduced `0.73 -> 0.476`, not just a mocked notification.
- Terrain snapshot load notifications now identify `source: 'load'`. The scene
  adapter preserves the caller's canonical physical scale while still restoring
  perception settings; subsequent intentional elevation edits still work.
  The new regression plus existing terrain/scene/elevation checks pass
  **6 suites / 48 tests**.
- A controlled, input-paused Chrome reopen then preserved every canonical scene
  field, linked actor ID/character ID/map/cell/world position, camera and source
  pin. The exact character-object SHA-256 was unchanged. Saved world elevation
  remained `0.2313984`, rather than being recalculated.
- Renderer placement, sight-bound and cover-bound collections were compared as
  unordered records, matching their grouped-instancing representation. Only their
  iteration order changed; no object, bounds or other scene field changed. One
  representation-only startup publication advanced scene revision 62 to 63.
  This is not a claim that the complete encoded scene bytes stayed identical,
  nor permission for order-only restore publication to count as meaningful
  live-session activity.
- The user's disruptive flashing/centered save notice is explicitly queued as
  `UX-01` after `M5-11`. No change to that presentation was made while fixing
  the separate canonical-restore defect.

### Actual process termination

[Backend lifecycle tests](../../tests/cloud/BackendLifecycle.test.js) run real
API processes from separate empty temporary working directories against the
guarded demo Auth/Firestore/Storage services:

1. A real character/scene publication succeeds, its HTTP reply is deliberately
   lost, and Windows `Stop-Process -Id <owned PID> -Force` terminates the backend.
   A fresh process binds the same API address. Explicit retry sends the identical
   command body, resolves the original caller and reopens exactly the committed
   records through a fresh client. Another approved UID remains denied.
2. The external Firestore transaction boundary is paused after real immutable
   uploads but before transaction allocation/publication. Committed head and
   receipt remain unchanged while actual candidate objects exist. Terminating
   that process and retrying through its replacement publishes one generation
   and one original character, not duplicate preparation identities.

No graceful shutdown, first-process heap, private backend working-directory
files or client campaign database supplies the recovered state. All **52 native
SDK/HTTP cases pass**, zero skipped, including both actual termination cases,
after the terrain restoration fix. They used the runner's guarded
`--inside-emulators` mode against the already-running demo services, avoiding a
reset of the active Chrome fixture.

Large synthetic scene downloads emitted SDK `PassThrough` listener-count
warnings. These were not silenced or treated as corruption; generation/hash
checks passed. Hosted memory/performance profiling remains a later gate.

### Runner separation and completed development exit gate

The first full stable run passed **294 application suites / 3,790 tests**, but
its overall result failed because seven native Node suites were also discovered
by Jest. The existing `<rootDir>/tests/cloud/` regular expression did not match
Windows path separators. The corrected separator-aware expression retains every
application suite and excludes only that native directory; real Jest discovery
and explicit Windows/POSIX path checks verify the boundary. All native cases
remain in `npm run test:cloud`; none were disabled.

The corrected final complete stable run, including the restore regression,
passed **295 suites / 3,791 tests**, zero skipped, in 1,671.282 seconds.
It ran separately from the **52 passing native SDK/HTTP cases**. Full
lint/stylelint and layering passed with zero errors and the same 39 existing
warnings. This completes the development M1 gate, not the later membership,
complete persistence, multiplayer, hosted or migration gates.

No production deployment, additional live cloud write or new IAM grant was
performed.

## Initial campaign-local access projections

`M2-01` completed November 11, 2026 for the development access slice; joined
gameplay remains gated until the participant command/projection path exists.

- New authenticated `account/campaigns` and `campaigns/{id}/access` reads expose
  explicit Owned/Joined summaries. Projection fields are only campaign
  ID/name/rules/core version, campaign-local owner/member role and own seat ID.
  They contain no canonical scene, character records, private head references,
  owner UID or global DM claim.
- Server-owned UID-scoped membership records must agree with the current
  campaign seat. Malformed metadata fails explicitly, account disablement blocks
  reads, and stale/mismatched seats cannot preserve access.
- The cloud picker separates Owned and Joined campaigns. Joined entries cannot
  open the private owner workspace; they recheck access and explain that cloud
  player gameplay is not enabled yet. Existing canonical scene/character reads
  and writes remain owner-only.
- All **55 native SDK/HTTP cases** pass, zero skipped. The three new cases cover
  one UID owning and joining different campaigns, unrelated identities, direct
  private-operation denial, malformed membership data, current seat checks and
  actual bearer HTTP. The targeted client/picker/workspace/menu run passes
  **6 suites / 30 tests**. Lint/stylelint and layering pass with the same 39
  existing warnings.

The user selected invite-enabled verified-account participation and a seven-day
unused-invitation lifetime. An explicit account block must override invitation
redemption; accepted membership does not expire with its original link.
Invitation implementation is recorded separately below; membership fixtures
alone are not onboarding proof.

## Account-bound invitation implementation

`M2-02` is complete in the isolated demo environment. Production deployment,
actual campaign migration and player gameplay remain separate gates.

- Owners can issue seven-day, single-use invitations for new or existing
  unclaimed seats, inspect current invitation status and revoke unused links.
  Reissuing preserves the seat and character assignments while invalidating the
  old link. A joined seat cannot be reassigned by issuing another invitation.
- The browser creates a 32-byte cryptographic secret and sends only its SHA-256
  for issuance. Firestore invitations and durable command receipts store no raw
  secret/link. The owner sees the secret only after a validated durable issuance
  result; the original in-memory command and secret survive uncertain delivery.
  Closing the panel clears its displayed link; reissue is required if it is lost.
- Invitation links use a frontend URL fragment. Startup removes it from browser
  history before loading managed Auth or opening a provider popup. Malformed
  links fail without echoing their contents, and accepting is an explicit action
  after verified sign-in, not an automatic consequence of opening the URL.
- Only `account/invitations/redeem` accepts a verified but not-yet-enabled account.
  Normal campaign/profile routes retain their existing account gate. A valid
  redemption atomically enables a previously unapproved account, binds the
  intended seat, creates its UID-scoped membership and durable receipt, and
  consumes the invitation. Explicit account blocks are never overwritten.
- Acceptance receipts bind the result to the original invitation ID and a
  minimal member-access projection. Current membership/eligibility is rechecked
  on replay. The API never accepts a caller-selected UID or global DM role.
  Unused-link expiry does not remove accepted membership.
- A first explicit account/verification denial releases the sign-in form so the
  denied account can sign out. A denial after an earlier uncertain response does
  not falsely claim the invitation was never accepted; its original command is
  retained for explicit recovery. A definitive failure is cleared when switching
  accounts; an uncertain acceptance remains bound to its original UID and can
  only be retried after that identity returns.
- Same-document invitation navigation is handled as well as a fresh page load.
  An already-open sign-in screen immediately removes the fragment and requires
  explicit acceptance, invalidating any earlier in-flight profile result.
  From the launcher/current campaign, the existing save coordinator flushes
  canonical work and waits for pending receipts before a full invitation reload.
  Failed flushes do not navigate away or put the proof back in history.
- The cloud owner panel is accessible from Owned campaigns and the current
  campaign's Settings. Joined entries cannot open it or read canonical owner
  records. Player gameplay, removal and assignment controls remain separately
  gated; revoking a link is not a hidden player-removal operation.
- Invitation metadata does not change canonical scene/character revisions.
  Existing dirty checkpoints wait for in-flight invitation metadata rather than
  poisoning autosave with a concurrent-command error. Normal scene checkpoints,
  uncertainty guards and the explicitly deferred routine-save visuals remain
  unchanged.

The fifteen real account/Firestore/HTTP access tests currently pass, including:
exact seven-day minus-one-millisecond/expiry checks; losing-UID denial without
partial enrollment; identical issuance/redemption across four store instances;
explicit blocks; reissue/revoke; and an actual transaction precondition failure
that rolls approval, seat binding and consumption back together.

A real-client case creates actual campaign characters, retains their assignment
IDs and exact saved records, deliberately loses a successful acceptance reply,
replaces the HTTP API, and recovers the original receipt. Closing a pooled native
HTTP connection can reset the first retry (`ECONNRESET`); that attempt stays
unconfirmed and a further explicit retry retains the byte-identical command.
No automatic command replay or new identity is substituted.

The isolated preview was refreshed using an official local demo-emulator
export/import. The synthetic Google UID, owned campaign and exact character
bytes were verified unchanged. These local fixture exports are not migration
exports or production backups, and no export contents were displayed or
committed.

### Invitation acceptance gate

- The complete guarded native SDK/HTTP suite passed **68/68 cases**, zero
  skipped, in **52,716.1985 ms**. The final affected account, invitation, launcher,
  workspace, autosave, save-feedback and terrain-restore regression selection
  passed **14 suites / 84 tests**, zero skipped, in **7.919 s**.
- Full ESLint/stylelint and layering passed with zero errors and the same
  **39 existing warnings**. Tagged invitation diagnostics were absent. This is
  the invitation-slice gate, not a rerun or completion of the later full M2
  persistence/release gate.
- Actual browser testing registered a new synthetic recipient through the
  pinned managed email SDK. Acceptance stayed disabled while unverified, the
  password was cleared, and no application approval or seat binding existed.
  The real SDK applied its demo verification code; a verified ordinary profile
  request still returned `403 pilot-access-required` before explicit acceptance.
- Explicit acceptance then enabled that same UID and produced one Joined
  campaign, no Owned campaigns or owner-opening/invitation controls, one
  membership and one acceptance receipt. Reissuing the original unused link
  preserved its seat; acceptance retained that exact seat identity.
- Browser testing exposed a real same-document navigation defect: changing only
  `#invite=...` did not rerun startup. A fresh-document control succeeded. After
  the regression-backed fix, the already-open sign-in screen consumed a new
  fragment without a document reload. A signed-in launcher safely reopened a
  later invitation in a new document and still required explicit acceptance.
  Both cases removed the address-bar fragment without placing the proof in
  request URLs or local/session storage.
- The owner revoked the second unused link through the real panel. Attempted
  acceptance returned `410`, left the original accepted membership intact, and
  allowed continuing without acceptance. Reload, managed sign-out and email
  sign-in restored the same UID and original Joined entry, not another seat.
- After all browser actions, independent SDK reads found exactly one membership,
  the original bound seat, one acceptance receipt, one additional unclaimed
  revoked seat, and an unchanged canonical head at generation 1. Its before/after
  SHA-256 was
  `1592511af9e166e449cae6e2c5fc246bf6292b5c4efe3c87a467a23488112b69`.
  The real-client native case separately covers preserved actual characters and
  their assignments, rather than relying on this empty browser fixture.

These are account/launcher/invitation browser proofs, **not 3D rendering proof**:
the integrated Electron browser lacks WebGL. The earlier real-Chrome M1
render/reopen evidence remains separate. Only synthetic `.invalid` accounts and
the dedicated loopback demo services were used; no live account approval, IAM
change, real campaign write, deployment or cutover occurred. Routine save
flashing/centered feedback remains explicitly deferred to `UX-01`.

## Member lifecycle and access generations

`M2-03` is complete for the currently enabled private demo permission surfaces.
The user selected retaining assignments on a removed member's empty seat and
explicit owner-approved shared character control. The original local authority
already supports that model; no implicit exclusive transfer was introduced.

### Authority and protocol

- Owner-only `POST campaigns/{id}/members/remove` clears the current UID binding
  and its membership index atomically, advances that seat's access generation,
  and retains its saved-character assignments and all canonical records.
- Owner-only `POST campaigns/{id}/assignments` assigns/unassigns an existing
  campaign-owned character with an expected seat generation. Adding access
  validates a real pinned-catalog character snapshot outside transaction retries,
  then rechecks ownership, eligibility, canonical generation and seat generation
  at publication. Revoking a character grant does not depend on object-storage
  availability. A desired-state no-op records its receipt without advancing the
  access generation.
- The same character can be deliberately assigned to several seats. Each seat's
  generation changes independently; altering/removing one player's grant does
  not revoke another player's explicitly shared grant.
- Stored version-2 seats and membership indexes require matching, positive,
  safe-integer access generations. Exact known version-1 seat/index pairs
  explicitly start at zero and upgrade on a permission transition. Malformed or
  mismatched version-2 records fail, not fall back to zero.
- `GET campaigns/{id}/participant-access` returns only a strict access manifest:
  the current UID/campaign/role/seat/generation, minimal campaign summary and
  assigned character IDs. It is not a scene, sheet, asset manifest or owner
  snapshot. The existing minimal Owned/Joined and invitation receipt DTOs remain
  unchanged; admission alone is not a reusable live authorization grant.
- Supplying both `X-TavernTable-Seat` and
  `X-TavernTable-Access-Generation` makes that manifest read scope-bound.
  Missing, malformed, forged-owner or stale headers fail explicitly; scoped
  headers are rejected on unrelated owner endpoints. The client also binds the
  scope to its UID/campaign and captures immutable headers across token renewal.
- Owner seat projections are version 2 and expose only the current access
  generation in addition to the prior safe seat fields, never another account's
  UID or a reusable invitation secret. The client explicitly recognizes the
  prior version-1 projection for development compatibility.
- Existing canonical character-deletion/replacement commits also reconcile
  deleted character IDs against affected seat grants. Seat/index updates,
  canonical head, durable receipt and compact change publish in one transaction.
  A failing publication cannot revoke access while leaving the character saved,
  or delete it while leaving an old grant reusable.

### Browser behavior and recovery

- The owner panel exposes real saved-character checkboxes and a distinct
  **Remove player access** action. It states the retention/shared-control rules
  and refreshes controls after a definitive stale-generation failure.
- Access commands have a separate in-memory UID-bound client channel using the
  same bearer transport/receipt contract. An invitation or permission failure
  must not masquerade as a failed canonical scene save. Unknown delivery keeps
  its original command/body/proof, shows a same-change retry and prevents closing
  an unresolved operation. A first definite denial releases the form; a later
  denial cannot erase an earlier uncertain write.
- Joined access checks use the fresh participant-access manifest and refresh the
  Owned/Joined directory, so removed membership is not opened as owner data.
  Full player gameplay remains visibly unavailable.
- The preview API was restarted separately from its existing demo emulators;
  Auth identities and campaign objects were not reset or recreated.

Actual browser verification used the existing synthetic owner and member:
the owner assigned a real persisted scout, deliberately shared its assignment
with another empty seat, removed the first member, issued a new invitation to
that original seat and required explicit acceptance. The member remained the
same UID and followed the generation sequence **0 -> 1 -> removed 2 -> rejoined
3**. Both old and fresh reads were denied while removed; the earlier scope was
still denied after rejoining. Owner access operations produced only the existing
`saved` phase on the canonical save channel, not a new save/failed-save cycle.

Independent SDK checks verified exactly one rejoined membership, the same seat,
one identical saved character and both explicit assignments. Throughout the
permission operations, canonical generation stayed at **2**, head SHA-256 stayed
`09b68d9796fbc5256d6a78a5b54f0af717e3f3a9814226054821ea80cbd6282a`,
and the character-object SHA-256 stayed
`4d949034d563505032764b25f5c9eb526e6b505ff50fb2984386b17cd3a74c1e`.
Character preparation used the real public cloud-save API; these account/panel
proofs do not claim WebGL rendering in the integrated browser.

### Verification gate

- Complete guarded native SDK/HTTP runner: **81/81 cases**, zero skipped, in
  **70,765.0678 ms**. Coverage includes actual saved records, isolated shared
  grants, same-UID rejoining, strict header/UID/role boundaries, corrupted access
  generations, real competing/identical transactions, and cross-instance
  recovery of deliberately lost successful assignment/removal replies.
- Existing canonical deletion was first shown to retain a stale grant. The
  regression now passes. A real existing-document create precondition failure
  proves canonical deletion and access revocation roll back together; the same
  retained command then publishes exactly once after removing the fixture fault.
  Real Storage I/O delays also prove that later canonical or membership changes
  prevent an in-flight assignment from publishing.
- Final affected Jest selection: **15 suites / 100 tests**, zero skipped, in
  **9.171 s**. It includes account, transport, metadata receipt, owner/Joined UI,
  character/domain, autosave, save-feedback and terrain-restore behavior.
- Full ESLint/stylelint and layering pass with zero errors and the same
  **39 existing warnings**. No full-M2 persistence/release gate is implied by
  this slice's targeted application regression gate.

Live cloud gameplay/SSE, complete participant views, asset delivery/cache purges
and their revocation races remain gated for M3/M4 and must reuse the current
generation checks when implemented. No production rollout, IAM change, real
campaign cutover or new live cloud write was performed. The routine scene-save
flashing/centered-notice work is still deferred to `UX-01`; its presentation
component was not changed.

## Provider-linking emulator blocker

`M2-04` completed November 13, 2026 with owner-approved live acceptance. The
November 12 emulator gate and deferral are preserved below. The prototype two-step interface
first proves the current credential, then consumes a five-minute, single-use
in-memory proof to link another managed provider to the same Firebase UID.
Eleven focused account tests pass for both directions, wrong credentials,
unverified accounts, cancellation, exact expiry, account switching, conflicts
and explicit reconciliation after a lost reply. The browser UI is not yet
integrated or accepted.

The first real Google-to-password Auth/campaign integration case fails with
`auth/email-already-in-use`. A bounded direct public-SDK probe reproduced it
without TavernTable account logic:

- The current UID stayed unchanged through Google reauthentication.
- Admin token verification and the email-owner lookup both resolved that same
  UID, with only `google.com` linked.
- The unmodified pinned SDK sends `accounts:signUp` with the current `idToken`
  when adding password credentials.
- The Auth emulator rejects any existing email as `EMAIL_EXISTS` before parsing
  that token. This is visible in the installed Firebase CLI 15.11.0 and in the
  [released 15.36.0 source](https://github.com/firebase/firebase-tools/blob/v15.36.0/src/emulator/auth/operations.ts).
  Merely upgrading the CLI will not fix this case; no dependency pin changed.

The related production-side regression is documented as fixed in
[Firebase SDK issue #8057](https://github.com/firebase/firebase-js-sdk/issues/8057),
but that is not proof that this application's current live configuration works.
No live Auth canary is authorized by the earlier Storage/IAM approval.

The real acceptance test is still failing and has not been counted as a passing
gate. No email substitution, password-reset fallback, disabled enumeration
protection, SDK/emulator patch or fabricated success response was added.
Completing this slice needs a separately approved live Auth linking test with
an owner-controlled Google test account, or a corrected official emulator.
Alternatively, keep provider linking gated and continue independently ready
canonical-persistence tasks. No production account, campaign or IAM changes
have occurred.

**Selected November 12, 2026:** the owner chose to defer live provider-linking
testing and continue independent migration work. The prototype and its failing
real-SDK test were non-destructively parked in the local Git stash
`b31ff0e1067f98c8ab05de2323797ddc416ee6d4`, covering only the account module and
its two related test files. The active tree retains the verified prior account
behavior; no linking UI or unsupported fallback is enabled. The preserved
acceptance failure remains a blocker, not a passing or skipped milestone test.

**Reopened November 13, 2026:** the owner approved using the existing Firebase
project/current account for ongoing live testing in this personal project.
The prior live-Auth deferral is superseded; provider linking should be proved
live rather than removed from the multiplayer development dependency. Existing
campaign data is preserved, and new billing/IAM changes are raised before action.

The exact three-file stash was reapplied without dropping it. The restored
account/login compatibility gate passes **2 suites / 24 tests**, **2.072 s**.
Read-only live configuration checks confirm the approved project is reachable,
Google and email/password are enabled, and localhost/127.0.0.1 are already
authorized. No provider, IAM or billing configuration change was needed.

A separate loopback Auth-only Chrome check now loads the actual restored account
module and unmodified pinned browser SDK against the existing live project.
It uses session-only browser persistence, no campaign API/data access, rejects
private source paths and accepts no passwords/tokens at the local HTTP server.
The owner performs sign-in and new-credential submission in Chrome, not chat.
Actual linking success, integrated application UI and final same-UID acceptance
are still pending; neither the emulator failure nor an unobserved manual step
is counted as a passing gate.

**Live finding and confirmation correction:** the owner manually completed real
Google sign-in/reauthentication, password submission and password sign-in in the
Auth-only page. The observed account changed from Google-only to Google/password
with the same UID, and actual password sign-in succeeded. Firebase then reports
`emailVerified: false`. The provider link persisted, but the prototype's
post-link guard wrongly reused the verified-email prerequisite and reported an
unconfirmed mutation instead of a confirmed method with pending verification.

A focused regression first reproduced that false failure. Post-link
provider/UID confirmation now permits the observed pending-verification state;
verification before a fresh linking proof remains mandatory, and the UID is
checked again after refreshing. No backend eligibility rule was weakened.
The targeted account/transport/login gate passes **3 suites / 37 tests** in
**1.868 s**; actual managed-Auth/HTTP regression passes **17/17 cases**, zero
skipped, in **5,275.3276 ms**. The diagnostic UI explicitly distinguishes current
provider presence, new-link operation flags and pending email verification.
It exposes the existing normal verification-email flow for the owner to
complete, rather than changing the verification bit administratively.
Integrated application UI and final verified-account acceptance remain pending.

**Completed November 13, 2026:** the owner followed the normal live verification
email and the refreshed SDK now confirms Google/password on the same verified
account. The owner also confirmed the live screen's linked/verified state.
The in-app sign-in-method panel is wired into signed-in account access and the
cloud campaign picker. It requires fresh current-provider proof, clears all
password fields after use, prevents an account switch from submitting a captured
link, and separates confirmed linkage from required email verification.
An uncertain link cannot be reissued or cancelled into a false no-change
message; explicit same-account refresh reconciles provider state instead.
Opening already-restored provider metadata does not add a mandatory network
request, while explicit refresh and mutation proof still use managed Auth.

The final targeted real-SDK Auth/HTTP/linking gate passed **19/19 cases**, zero
skipped, in **13,827.8168 ms**. Native password-to-Google linking plus subsequent
password/Google logins preserve UID, Owned/Joined campaigns, assignments, exact
saved character rows and canonical head. The known emulator Google-to-password
failure is now an explicit safe-rejection/data-preservation test, not a skipped
test or claimed successful link. The separate positive Google-to-password
acceptance was observed against the actual live provider with the owner's
current account, including same-UID password login and normal email recovery.

The account/campaign/history/save-feedback gate passed **16 suites / 113 tests**
in **6.798 s**. UI cases exercise proof, uncertain refresh, UID changes, password
clearing and the pending-verification distinction; signed-in provider management
does not require or fetch campaign data. Full lint/stylelint/layering passed
with zero errors and the same 39 existing warnings. No dependency pin, SDK/
emulator implementation, account email, password-reset semantics or backend
eligibility rule was changed to obtain acceptance. No account merge, provider
unlink, administrative verification override or live campaign mutation occurred.
New billing/IAM changes and application deployment/cutover remain separate
approvals. Routine-save presentation remains untouched.

## Complete canonical persistence gate

`M2-05` is complete for the canonical cloud Adapter and currently enabled owner
surfaces. Player commands/live sessions, binary participant delivery and hosted
rollout remain separate M2/M3/M4 gates; no account-linking success is implied.

### Captured settings and atomic publication

- `GET campaigns/{id}/settings` returns only owner-authorized
  `{version: 1, generation, campaign}`. It does not change the existing minimal
  Owned/Joined projection.
- `POST campaigns/{id}/settings` takes a command ID, captured generation and
  explicit name/source changes. It verifies current account/ownership, prepares
  the existing domain update outside transaction retries, verifies any immutable
  objects, and rechecks the same captured generation at publication.
- Head, receipt and compact change publish atomically. Source changes preserve
  the existing local character-revision increment, so a previously empty campaign
  stages a real empty character object rather than publishing an invalid
  positive revision with a null reference. Existing scene and character objects
  retain their exact bytes/references.
- Input is captured before asynchronous work; changing the caller's request
  object cannot relax its compare-and-set condition or replace prepared intent.
  Replaying a completed command works even with an independent metadata-only
  backend that no longer has the preparation catalog or object client.
- The client requires its captured settings snapshot and predicts the result
  with the existing domain helper. A reply with another generation, name,
  revision or source pin remains unconfirmed. Unknown delivery retries the
  identical command/body, not freshly reread state or a newly generated ID.
- Owned campaigns expose the source editor; Joined campaigns cannot expose it
  or gain private metadata access. Each durable save advances the editor's
  captured snapshot, allowing another edit without silently weakening CAS.
  Explicit local storage and its update interface remain supported.

### Canonical-path acceptance

| Path                                        | Real-interface evidence                                                                                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name/source metadata                        | Empty-state consistency, unique winner, four-instance identical replay, stale/foreign/invalid source denial and exact captured-generation checks.                                                                                                         |
| Sheets, owned resources and layouts         | A real cloud character owns a supplemental spell and Favorite; disabling its pack retains the same owned ID, layout and source version, but blocks new additions. A stale sheet write cannot spend or replace records after the source revision advances. |
| Embedded image/notes records                | A valid generated PNG and notes survive in byte-identical character rows; canonical image data is not silently replaced with an external URL. Participant binary delivery is still `M2-06`.                                                               |
| Scene, doors, terrain, camera and positions | Real 2014/2024 connected-world snapshots include walls, doors/stairs, changed physical position/facing/run mode and committed movement/turn state. Settings publication and independent reopening preserve exact scene bytes and values.                  |
| Atomic spending and retry                   | Existing joint character/scene cases and new settings faults preserve the revision/receipt contract. A real publication precondition failure rolls back; a deliberately lost successful HTTP reply recovers the same command exactly once.                |
| Local compatibility                         | Existing local campaign, character, SQLite storage, host Adapter, scene/world and autosave tests continue to pass.                                                                                                                                        |

The actual browser signed in the preserved synthetic owner, created a separate
test campaign, edited its name and enabled a compatible pack through the visible
owner editor, then disabled that pack with a second save **without reloading**.
Reload retained the same UID, campaign and disabled version pin. Generations
advanced **1 -> 2 -> 3** and character revisions **0 -> 1 -> 2**, without creating
characters or scene data. Independent SDK reads verified its immutable empty
character object and head SHA-256
`899f0094cf7c1d6fb97e41b78932c4d2077e2abaa933c70dea7cf80aea76d21c`.
The earlier member-lifecycle campaign head and original Chrome character hash
were independently checked unchanged. This is an owner-settings/browser
acceptance proof, not a new full-board rendering or live-multiplayer gate.

### Measured verification

- Complete guarded native SDK/HTTP suite: **89/89 cases**, zero skipped,
  **84,838.9973 ms**.
- Affected application/domain suite: **20 suites / 137 tests**, zero skipped,
  **10.411 s**, including the existing SQLite and explicit local Adapter paths.
- Full ESLint/stylelint/layering: zero errors, the same **39 existing warnings**.

Provider linking remains parked under the approved `M2-04` deferral; that
unverified prototype is not included in these completed-gate counts. No live
Auth, Storage/IAM, production deployment or real-data migration occurred.
`UX-01` routine save-flashing/centered feedback remains explicitly deferred and
its presentation component was not changed.

## Private asset kernel progress

`M2-06` remains in progress. The owner selected accepting up to **16,000,000
decoded pixels**, with neither side exceeding **8192 pixels**, without silently
resizing stored bytes. Existing JPEG/PNG/WebP support, source-file/canonical-data
limits and client 512/1024 output targets remain unchanged.

- The new immutable asset primitive checks image headers before decoding, then
  verifies complete raster contents. The header parser and decoder are pinned
  runtime dependencies (`image-size` 2.1.0 and `sharp` 0.35.5). The existing
  `canvas` development dependency remains unchanged; it cannot decode the
  browser-generated WebP fixture, so it was not used as the production decoder.
- Caller bytes are copied before asynchronous work, content-addressed by their
  exact SHA-256 and scoped to the campaign. Storage metadata binds original
  content type, byte count, dimensions and immutable generation. Restaging never
  repairs or overwrites a corrupt existing content-addressed object.
- The owner upload domain Interface checks current eligibility/ownership before
  decoding/staging and again before atomic publication of asset metadata and its
  UID-scoped receipt. Replay does not create another upload or change canonical
  scene/character generations. No raw proof, URL credential or signed link is
  stored in the result.
- Seven real native asset cases pass, including PNG/JPEG/WebP byte preservation,
  a real 4000-by-4000 image at the exact pixel limit, corruption/oversized/MIME
  rejection before writes, reference tampering and owner-only upload/replay.
- The complete current native suite passed **96/96 cases**, zero skipped, in
  **83,167.0307 ms**. The affected image/cloud application checks passed
  **9 suites / 74 tests**, zero skipped, in **5.257 s**. The backend outage test
  now explicitly uses Node rather than the DOM-only environment for its Node
  dependencies. Full lint/stylelint/layering passed with the same 39 warnings.
- Targeted package audit reported no advisory entry for the changed image
  packages. The total audit still reports 48 findings in the wider dependency
  graph; no unrelated audit fix or forced dependency upgrade was applied.

Upload transport, current-member asset authorization, participant-safe manifests,
revocation races and complete lifecycle acceptance are still pending. This is
verified kernel progress, **not completion of private asset delivery or the
migration**. No live Storage/IAM changes or public deployment are authorized.

## Private asset delivery gate

`M2-06` is complete for currently supported custom character image assets in the
private demo slice. Canonical JSON stays portable and byte-compatible; broader
map/NPC viewpoint grants, cache reconciliation and large canonical transfers
remain later tasks. No new custom model/media format or public allowlist is
implied.

- Owner uploads use bounded authenticated HTTP, recheck current eligibility and
  campaign ownership before/after immutable staging, and atomically publish asset
  metadata plus a UID-scoped receipt. Current 10,000,000-byte image files fit the
  24 MiB JSON request bound; direct/resumable large canonical transfer is separate
  `M2-07` work. No expiring upload URL is issued or persisted.
- Canonical character saves finalize new image bytes before publishing their
  character/scene head. A corrupt image save cannot partially change records.
  Reused objects retain original bytes/generations; owner manifest reads can
  finalize compatible legacy embedded images without rewriting their rule data.
- Image manifests carry explicit current access scope, character revision and
  safe character/field/reference tuples. They exclude embedded image bodies and
  hidden NPC names/IDs/hashes. The client validates UID, campaign, reference shape
  and uniqueness; an unrelated or malformed manifest cannot become another
  account's cached view.
- Binary delivery verifies immutable size/type/hash/generation and requires the
  current owner's authority, or the current member's matching scoped assignment
  and canonical image hash. Auth/eligibility/access and character revision are
  rechecked after Storage I/O. Old scopes remain denied after unassignment,
  reassignment or membership removal.
- Actual native tests include a real Storage download delay followed by member
  removal, hidden NPC rejection, unchanged original PNG/JPEG/WebP bytes, complete
  decoding, exact 10,000,000-byte/16,000,000-pixel/8192-side bounds and explicit
  corruption/overflow denial. No special case accepts an unexpected SDK failure
  as a domain denial.

The browser saved a generated PNG through the existing cloud character caller,
received a body-free hash manifest, downloaded the private binary with managed
bearer authority, checked its SHA-256/size/content type and retained the same image
and owner after reload. Its 95-byte image SHA-256 was
`cba2053ea0db5c9d957edaeaf5cca13df55806345cbc05cbb9742e7c311d434c`.
Independent SDK reads verified the same private object and the unchanged earlier
member-lifecycle campaign head. This is API/image-persistence evidence, not a
claim that live player gameplay or asset caching is complete.

The first full transport gate reported an unexpected raw Firestore `3` in the
existing assignment-contention test (97/98 passed). That failure did not recur
in three bounded isolated probes; the assertion now preserves the SDK failure
message for future diagnosis rather than relaxing its expected domain error.
No production retry or error suppression was added. The subsequent full
unchanged-logic gate passed **98/98 cases**, zero skipped, in **94,070.1236 ms**.
The affected application/image/local checks passed **15 suites / 109 tests**,
zero skipped, in **7.387 s**, with full lint/stylelint/layering at zero errors and
the same 39 existing warnings.

No live Auth, Storage/IAM, deployment or real-data cutover occurred. Provider
linking remains under the approved deferral, and routine-save presentation stays
deferred to `UX-01`.

## Private-pilot usage limits and abuse-controls gate

The owner approved no enabled-account count cap and no daily custom-image
upload-volume cap; ten owned campaigns and 20 GiB of private object bytes per
owner; and 300 authenticated app requests per minute. The owner delegated the
live-connection choice: four per UID, with renewable 90-second crash-expiring
leases, not a total session-duration cap.

The development authority now enforces the selected policy:

- A mandatory shared usage ledger precedes new campaign publication. Its
  campaign-slot increment commits atomically with the new head and durable
  receipt. Joined campaigns do not consume ownership slots, and replay checks
  precede quota admission.
- Storage reservations bind exact encoded/binary bytes to campaign-scoped
  content-addressed paths. A coordinated checkpoint reserves all new objects
  together before any Storage upload. Concurrent campaigns/instances cannot
  oversubscribe the owner, and reused paths are charged once. Reservations
  survive uncertain staging/publication failures instead of guessing that
  bytes were never stored.
- Existing storage has a durable, leased and paginated initialization path.
  Current, noncurrent and soft-deleted generations count separately; duplicate
  listing results do not double-charge. Interrupted scans preserve partial
  accounting and resume after lease expiry. Missing ledgers with surviving
  reservation records, malformed counters and bucket mismatches fail explicitly
  rather than silently resetting the allowance. Existing reads remain available.
- All authenticated cloud routes share a per-UID rolling 60-second request
  ledger across instances, including invitation redemption without bypassing
  its account policy. Denials return HTTP429 and a bounded `Retry-After`.
  Static assets, preflights and managed Auth are not app-data admissions.
- Four per-UID stream slots use durable renewable leases and crash expiry.
  More than six hours of simulated-time renewal remains valid. The lease is
  not campaign authority or meaningful session activity; actual SSE admission,
  revocation, lease-loss closure and hosted concurrency headroom remain
  `M3-03`/M4 acceptance requirements.
- A process-wide four-request work bound covers command bodies and heavy
  snapshot/image reads; two full-raster decoders bound simultaneous image
  allocation. Saturation is an explicit retryable failure, not dropped data.
  Account reads remain responsive while heavy work is occupied.
- Fresh campaign/storage-capacity denials reject the original caller truthfully.
  Throttling, busy work and any capacity denial after an earlier lost reply
  retain the exact pending command until explicit recovery.

The first broad native gate passed 104/107 cases. Two fixtures assumed that
the first writable metadata transaction was canonical publication or did not
provide metadata access for the newly required HTTP limiter. They now use the
real account interface and pause after actual Storage upload, retaining the
original process-kill/preservation assertions. The third failure was a raw
Firestore `3 INVALID_ARGUMENT: Transaction is invalid or closed` during cold
concurrent creation. Three cold probes reproduced it in one run, while all
three pre-seeded probes succeeded. First-use ownership queries were removed
from competing publication transactions: all new writers require the shared
seeded ledger, then claim its slot atomically with publication. Three cold
four-instance races and three real-upload/process-kill recoveries passed after
the repair. No unexpected code was accepted as a domain denial, SDK patched,
or blanket production retry added.

The complete final native gate passed **108/108 cases**, zero skipped, in
**191,585.016 ms**. The affected application/local/image/account/UI gate passed
**17 explicit suites / 117 tests**, zero skipped, in **8.118 s**. Full
lint/stylelint/layering passed with zero errors and the same 39 existing
warnings. A too-broad application path selector was stopped; the reported
application result is the completed explicit-file gate, not that interrupted
run.

The actual browser retained its managed owner after backend replacement and
reload. With only the synthetic account's rolling-window usage seeded, a
normal source-settings save received real HTTP429. Independent SDK reads
proved the canonical head stayed at generation 5, character revision 4, with
its original hash and two earlier settings receipts. After the real minute
elapsed, **Retry same save** completed at generation 6 with exactly one new
settings receipt and unchanged character bytes/private PNG. Legacy accounting
initialized to exactly **3,004 bytes across five actual private objects and two
owned campaigns**. A second ordinary save restored the fixture's original name
without reopening the editor; reload retained the account and campaign at
generation 7/character revision 6. The earlier member-lifecycle head and M1
scene were independently verified unchanged. This is account/API/recovery
evidence, not a new complete 3D/live-game acceptance claim.

The 20 GiB boundary used seeded historical usage plus actual encoded/uploaded
bytes; no 20 GiB test upload was made. Noncurrent/soft-deleted metadata branches
use SDK-shaped external-service fixtures because the demo emulator ignores the
listing flags; real hosted behavior still requires its separately approved M4
gate. No live Auth, Storage/IAM, deployment, push/merge or actual cutover occurred.
Quota handling never deletes saved data, and cleanup must not release charges
before a generation is no longer billable. Provider linking remains deferred;
the routine save-flash/centered-notice presentation remains untouched for
`UX-01` after migration completion.

## Complete campaign portability and large-file gate

The owner approved a **cloud-only 128,000,000 UTF-8 byte limit** for complete
campaign files. Legacy local UI/parser defaults and existing scene, character,
image and immutable-object bounds remain unchanged. The shared domain parser
has an explicitly configured byte ceiling for the cloud Adapter and uses a
bounded encoding workspace; it does not allocate another complete file just
to count bytes. Malformed UTF-16/UTF-8 is rejected rather than replaced in transit.

Owner exports capture one coordinated immutable scene/character state and
recheck current access after Storage I/O. They preserve the existing versioned
JSON format, source pins and all canonical rows/scene bytes; they do not store
another object or consume a campaign slot. The actual HTTP response is chunked,
backpressured UTF-8 with exact byte-count/SHA-256 headers. This follows the
[official Cloud Run limits](https://docs.cloud.google.com/run/quotas):
HTTP/1 requests remain capped at 32 MiB, while the 32 MiB response limit applies
to non-streamed responses. Hosted gateway verification remains an M4 gate.
The browser checks the full declared count/hash and rejects truncation, extra
bytes, unsupported success responses and corruption. Progress renews an idle
deadline, not a short total-file duration limit.

Imports use the current bearer-authenticated API in **one-MiB raw parts** rather
than introducing browser Storage capabilities or a new credential-bearing URL.
Canonical base64 parts are stored as scoped immutable JSON, so the resulting
Storage byte overhead is included in the owner's ledger. A UID-scoped journal
and an immutable command-intent claim bind the file size/hash, target and part
indices. Reusing the command on another endpoint or for another file fails.
Missing claims and expired journals fail closed before new Storage work.
Different UIDs cannot use a pending transfer.

No campaign head or membership is created while source parts arrive. The
backend verifies all parts, the complete-file hash, UTF-8, rules/source schema,
real character state and physical scene. It reuses the canonical commit domain
to prepare a fresh authority with stable character IDs/rows and exact scene
data, discarding imported owner/role/key claims. Verified image metadata remains
private under the unpublished target. Normalized object reservations precede
uploads; large sets use bounded reservation batches. The final transaction
claims the campaign slot and publishes head, receipt, change marker and
completed journal together. A rejection closes the intent without a visible
partial campaign; an uncertain result retains one original caller/command.
Staged/reserved bytes remain charged until later race-safe cleanup, not
optimistically refunded or deleted.

Measured gates:

- A genuine **36,522,416-byte** image-heavy campaign contained **25 maps, 16
  characters and 32 image fields**. Exact rows, source pins, images and scene
  round-tripped through the real HTTP client. Its largest request was
  **1,398,126 bytes**, and its larger-than-32-MiB response was actually chunked
  with no `Content-Length`. The isolated case passed in **26,796.7926 ms**.
- An actual **128,000,000-byte** valid file imported successfully; **128,000,001
  bytes** failed before upload. The largest request was **1,398,127 bytes**.
  This limit dataset uses JSON whitespace, separately from the real-data
  campaign above; it is not presented as representative campaign content.
  The isolated boundary case passed in **44,588.573 ms**.
- Actual lost replies after start, part publication and final publication
  recovered the original caller without duplicate campaigns or chunk uploads.
  A real final-transaction conflict rolled back ownership count, head, receipt
  and journal completion together. An actual process kill after Storage upload
  resumed on a fresh backend with the same import and exact data.
- Both 2014/2024 paths retained complete data and private image delivery.
  Unrelated and joined-member backup requests are denied; UID-scoped staging,
  exact raw part/file bounds, storage/campaign contention, corrupt images,
  invalid JSON, wrong edition, hash mismatch and missing/expired intent fences
  produce explicit outcomes without changing the source.
- The complete native gate passed **127/127 cases**, zero skipped, in
  **310,312.9707 ms**. The affected application/local/account/image/backup/UI gate
  passed **18 explicit suites / 131 tests**, zero skipped, in **10.944 s**.
  Full lint/stylelint/layering had zero errors and the same 39 existing
  warnings. The final added joined-member and malformed-UTF regression
  assertions also passed their focused rechecks.

The managed browser restored the existing synthetic owner, exported the saved
image-bearing campaign into its read-only JSON view and imported a **1,528-byte**
file through the real file-control handler. The imported owner claim was ignored.
The new private copy remained in Owned after reload. Independent SDK reads
verified one import receipt, the same character ID/record hash and original
95-byte PNG under the new private campaign, while the source and earlier
member-lifecycle head stayed unchanged. Large previews are explicitly omitted
from the textarea, while a real DOM/Blob download test verifies the complete
original file is still supplied to the download helper.

The browser-tool surface initially opened a separate VS Code blob window
instead of reporting an OS-download event. The owner saved that window, and
the actual `M2-05-saved-browser-settings.json` file was independently verified:
**1,725 bytes**, with the exact canonical character record and original PNG.
Its SHA-256 was
`895a3366d76d4f58b0700a8ed161583d1b5d6ccf8a2aca6899b225df4625601b`.

The owner then approved a dedicated Chrome test window and one existing Google
demo-account sign-in at the loopback preview. Only that new test window was
used; the stale emulator session was renewed without changing an account,
provider or production permission. Chrome's actual **Download JSON** action
created `Chrome-cloud-M1-verification.json`: **709,228 bytes**, SHA-256
`568d265a377bdea16fd22af0c2f286d1c71aefb15987a0dcb9b5f52bf41cfdee`.
Independent file reads verified the exact original M1 scene and character
hashes. The intended-browser OS-save check is now complete. Hosted gateway
behavior and the later restore drill remain their own gates; browser telemetry
alone is not a new complete 3D/live-game acceptance claim.

No live Auth, Storage/IAM, deployment, push/merge or actual cutover occurred.
No new package or production upload capability was required. Automatic backup
history, restore from it and cleanup remain separate tasks; provider linking
remains deferred. The routine save-flash/centered-notice presentation is
untouched for `UX-01` after migration completion.

## Independent rolling complete-backup implementation

The M2 development implementation stores a standalone version-2 campaign JSON
file for every complete history point. Files live under
`campaigns/{id}/backups/{backupId}/{sha256}.json`, with create-only generation
preconditions, private/no-store metadata, exact UTF-8 length, full hash/read
verification and the approved 128,000,000-byte ceiling. An unchanged explicit
backup still creates an independent physical file. It is not a canonical
reference-only manifest, an import chunk envelope, or a public download URL.
New files reserve their actual object bytes before upload in the same private
bucket used by snapshots/assets.

The campaign's bounded `backupState/current` index contains at most twenty
public records: name, capture time, bytes and captured head generation. Private
`backups/{name}` manifests bind those records to exact immutable file references.
`backupJobs/{name}` retain the captured source while work is pending. UID-bound
`campaign.backup` claims/receipts prevent another endpoint from reusing an
unfinished intent and keep a retried manual caller on its original snapshot.
Index, manifest, job completion, receipt and eligible history retirement publish
in one transaction. Replaying a retired point never recreates it.

Changed content targets five-minute intervals. Ordinary owner campaign requests
and explicit history/status requests evaluate due work; pending/failed jobs
retry on natural wake. There is no backend `setInterval`, scheduler or added
infrastructure. One request processes at most one pending/due point, using a
process-wide large-file slot shared with streamed export/import finalization.
The first deadline is derived from the durable campaign creation time, so a
process loss before evaluation cannot erase an older campaign's due state.
The later live-session implementation must reuse this tracked-work interface
and stop unnecessary browser polling when a session pauses.

History sorts by captured canonical generation/time, not upload completion.
A delayed older job cannot become the newest restore point or move the automatic
baseline backwards. Recovering an older point while primary data has changed
leaves the newer state explicitly pending. Busy work is pending, not a falsely
failed or completed backup. Source revision-only bookkeeping is excluded from
the changed-state fingerprint; actual metadata and immutable payload hashes
remain included.

The managed client retains a separate manual-backup caller and command ID.
Backup uncertainty cannot occupy the canonical pending-save channel. Existing
primary HTTP receipts stay successful when due backup work fails. Workspace
switch/return/sign-out first flush primary changes, then request a final
changed-state point; primary flush failures still block unsafe exit, while an
explicitly reported backup-only failure does not block sign-out. Owner history
offers verified complete-file downloads. Joined/unrelated accounts cannot list,
run, create or download owner backups. Restore controls stay gated for M2-10.

Logical retirement does not immediately delete or credit old raw objects.
Retained files and pending source references remain protected for M2-11, which
will apply bounded race/grace fences and seven-day soft-delete billing.
Unpublished, failed and retired bytes remain conservatively charged meanwhile.

### Legacy-account issue found by the actual Chrome gate

Fresh-account tests passed, but the existing pre-quota Chrome fixture exposed
an admission-order bug: the first backup intent was created before the missing
initial usage ledger. The existing damaged-ledger fence correctly rejected a
missing ledger with a surviving claim; this was not bad campaign content or
a Storage permission failure. A new isolated pre-quota campaign/scene fixture
reproduced the exact error.

The fix checks the current owner/original receipt, initializes the account
before any fresh backup claim, and then captures the job. Receipt recovery and
the damaged-ledger fence are not weakened. For the one synthetic demo intent
created by this bug, the preview was stopped and guarded SDK reads proved one
current owned campaign, no usage ledger/reservations/imports, only that new
backup claim, no uploaded backup bytes, matching pending/source snapshots and
unchanged canonical hashes. A create-only initial ledger was seeded with
storage explicitly uninitialized; the original claim/job and all source data
were preserved. Full paginated inventory remains mandatory before file bytes
can be allocated. No existing ledger was reset or quota refunded.

The original pending demo job then completed after full byte inventory.
Chrome also exposed a presentation race: parallel status/history reads could
leave an old failure visible after the history request had completed that job.
A focused public-panel regression reproduced it. History now reads its status
after the potentially work-completing history request, rather than preserving
that stale error. The actual Chrome panel then showed a healthy five-minute/
twenty-point policy, retained the recovered point, and created an additional
manual point without altering the campaign.

Chrome's retained-point **Download JSON** produced
`campaign-a4e6f28a-f77e-4911-ad03-34d5874ddd25-f46157ed-91b2-4241-bc71-1f520f71d260.json`:
**709,228 bytes**, SHA-256
`568d265a377bdea16fd22af0c2f286d1c71aefb15987a0dcb9b5f52bf41cfdee`.
Independent actual-file and SDK reads verified exact campaign metadata,
characters and scene, both retained points, the original completed job,
head generation **64** and the original canonical character/scene hashes.
No new sign-in, provider change, credential submission or unrelated browser
window action was required.

### Completed development backup gate

- The final native SDK/HTTP/emulator run passed **140/140 cases**, zero skipped,
  in **375,911.4867 ms**, including thirteen new backup cases. The earlier
  139-case run preceded the Chrome-discovered legacy regression and is not the
  final compatibility claim.
- The affected application/local/account/picker/menu/history/save-feedback gate
  passed **15 explicit suites / 98 tests**, zero skipped, in **9.126 s**.
  Full ESLint/stylelint/layering passed with zero errors and the same 39 existing
  warnings. Existing SDK listener warnings remain visible.
- The representative 25-map, sixteen-character, 32-image-field world produced
  an independent **36,522,415-byte** retained complete file. Exact records, scene
  and source pins survived streamed delivery without Content-Length. The largest
  POST remained **1,398,126 bytes**. The unchanged complete-import boundary test
  still imported exactly **128,000,000 bytes** and rejected **128,000,001**.
- Measured regressions cover exact five-minute due boundaries, unchanged
  suppression, force/manual points, final primary flush, original-command reply
  recovery, exact 20/21 history, non-resurrecting retired receipts, cold competing
  work, two real backend processes finishing out of order, actual process
  termination after upload/before publication, missing intent after upload,
  corrupt metadata/file bytes without repair, pre-quota inventory, and unrelated/
  joined account denials across every history/work/download route.

M2-09 is complete in development. M2-10 restore-as-copy, M2-11 fenced cleanup,
M4 live-session scheduling/gateway/resource verification and hosted rollout
remain separate gates. No new dependency, production infrastructure, live
Auth/Storage/IAM test, deployment, push/merge or actual cutover occurred.
`UX-01` remains deferred until migration completion.

## Verified private restore-as-copy

The M2 restore path reuses `CampaignWorkspace.restoreBackup`: read the owner's
retained complete private file, validate its edition/catalog/character/scene
data, then use the existing bounded multipart import. No alternate privileged
importer, in-place overwrite, old object resurrection or new production route
is introduced. The new server-generated campaign has fresh ownership/authority,
new immutable object paths and normalized initial revisions. Original character
IDs, raw records and exact scene data remain intact.

Managed-workspace/native HTTP/SDK restore/export drills for both 2014 and 2024
cover three characters, two private PNG fields, source-owned spells/Favorites,
notes/HP, connected floors/maps, a locked door, physical run position, committed
turn and spent movement resources. The 2014 drill disables the additional
source after owning its spell and retains the exact source/version pins and
owned content. Re-exported rows/scene/pins match the retained source.
Restored private image delivery returns the original binary bytes under the
new campaign prefix.

Each source has an invitation and explicit assigned character. Restore creates
no seats or top-level campaign invitations and does not change the original
head, records, retained file, invitation or assignment. Unrelated and then
joined-account restore attempts fail before creating an import journal; the
other UID also cannot export the new owner's copy. Exported metadata carries
no owner/role/host-key/seat authority or invitation proof.

A lost final restore reply retains the same workspace caller/import ID.
Retry recovers one already-committed target rather than finishing or allocating
again. The source point remains readable and unchanged. After these real
backend acceptance checks, the existing owner **Restore as copy** control is
enabled. Its real-client-capability UI test passed red/green, retaining the
gated-off and local-adapter behavior. The dedicated Chrome owner window renders
the enabled controls and non-destructive explanation without a new sign-in.
Actual full restore execution is verified through the managed workspace/HTTP/
SDK drills, not claimed solely from that rendered button.

The complete affected native portability/backup/import/restore/process-lifecycle
gate passed **37/37 cases**, zero skipped, in **196,166.7065 ms**. It includes
the exact 128,000,000/128,000,001-byte import boundaries, the real 36.5 MB
image-bearing retained file, canonical/backend process termination, complete
history races and all three new restore cases. The preceding M2-09 full native
baseline passed 140 cases; this is a targeted affected-file gate, not a claim
that a new full 143-case catalog was run.

The affected application/local/account/UI gate passed **15 explicit suites /
99 tests**, zero skipped, in **9.527 s**. Full lint/stylelint/layering passed
with zero errors and the same 39 existing warnings. No new dependency or
backend authority/restore route was needed.

M2-10 is complete in development; M2-11 safe cleanup is next. Provider linking,
between-game permissions, live transport/session lifecycle, hosted rollout and
the post-migration save presentation remain their own gates. No production
Auth/Storage/IAM write, deployment, push/merge or actual cutover occurred.

## Fenced private object maintenance

The M2 cleanup implementation runs only during normal authenticated account/
campaign requests. A durable per-UID five-minute lease coordinates cold workers.
It rotates through bounded owned-campaign and UID-bound import-journal queries,
including failed/expired unpublished targets that are absent from the campaign
directory. A persisted object-page cursor scans at most **20 current objects**
and retires at most **four generations** per invocation. Backlog continuation
becomes eligible after five seconds, but only another real request runs it.
There is no backend interval, permanent worker or new frontend polling loop.
Large current-character reads share the existing process-wide large-file slot.

Current canonical scene/character references, their private image bytes, all
twenty retained standalone complete files, pending complete-file jobs and their
captured source references are protected. Image roots are loaded outside retryable
metadata transactions and their captured head generation is rechecked inside
the deletion claim. Pending-source lookup is candidate-specific: one blocked
backup does not protect unrelated obsolete snapshots indefinitely.

An unreferenced generation must remain quarantined for at least **24 hours**.
Storage reservations carry publication activity and a fifteen-minute per-attempt
publication window. Touching a candidate can postpone quarantine; a deletion
claim atomically fences later publication. A worker stalled past its window
cannot publish an old already-read reference. The same original command can
retry online with fresh verified objects; a durable receipt still recovers
before new work is attempted. These work windows are not game/session limits.

A separate delayed-404 drill exposed a quota gap: a missing-object lookup begun
before another worker created and retired that path could otherwise create a
fresh generation using only the retired generation's charge. Snapshot, private
image and complete-file primitives now refresh their existing reservation
immediately before a physical create after that lookup. The real SDK regression
proved both generations charged, the expired original publication refused,
and one subsequent same-command online publication without double-charging.

Physical deletion uses the exact string-valued GCS generation precondition.
A missing object is recoverable; generation changes or service errors retain
the charge and surface an explicit maintenance error. Deleting plans survive
process loss and resume even when their files no longer appear in live listing.
The generation-specific hold and completed cleanup marker publish in the same
Firestore transaction. This closes the tested lost-retirement-reply gap where
an older plan could otherwise outlive its accounting evidence.

Retirement does **not** subtract storage bytes. The exact retired generation
stays charged for at least seven days. Bounded current/noncurrent and soft-deleted
listing must prove that generation absent before an atomic, idempotent refund.
Still-present generations, incomplete pagination and failed inventory keep
their charges. A fresh same-path generation has a separate active reservation;
it cannot receive, duplicate or be deleted by the older generation's cleanup.
Never-materialized reservations and legacy retained-generation rows without
verified retirement evidence remain conservatively charged, rather than being
refunded from a missing live-file observation.

Active import journals protect their whole unpublished target prefix. Failed/
expired parts and completed-import source parts use the same grace and deletion
fences. Completed normalized data is protected by its new head; restore writes
a fresh private prefix rather than reviving a source deletion candidate.
Import intent claims, journals and receipts remain as tombstones, so source-part
cleanup cannot extend an expired intent or execute an old import again.
Maintenance failure records a safe durable error and logs it separately; it
cannot change a successful canonical command receipt or acknowledge a failed
primary save.

### Separately approved real Storage precondition proof

The official Storage emulator deletes even when given a wrong generation.
Normal tests therefore cannot establish that production guarantee. On
November 13, 2026 the user separately approved one fresh disposable canary,
then an exact-object read-only grant expiring within one hour because existing
managed credentials lacked object-get permission. No credentials were printed
or added to the repository.

The canary's two **66-byte** generations proved an actual **412** for stale
conditional deletion; the newer generation and exact bytes survived. Correct
deletion left no live object. Both soft-delete/hard-delete timestamps were
exactly seven days apart, leaving **132 soft-deleted bytes** until November 20.
The temporary conditional viewer binding was removed; independent verification
confirmed the live object absent, the original unrelated IAM bindings unchanged
and object-get permission removed. Both approvals are exhausted. No further
live writes, IAM changes, retention changes or deployment are authorized.

Normal acceptance remains demo-only. The overlapping-deleter fixture supplies
only the emulator's missing generation-precondition behavior, backed by that
real canary; actual object data and metadata transactions remain SDK-backed.
Other drills cover interrupted physical deletion, uncertain retirement replies,
fresh same-path publication, pending backup roots, twenty-first-point cleanup,
private-image restore, active/closed import staging, corrupt metadata, unrelated
UID denial, cold-worker lease replacement and a real **205-object** inventory
advanced across bounded pages.

### Completed development cleanup gate

The final complete native SDK/HTTP/process catalog passed **161/161 cases**,
zero skipped, in **576,428.2997 ms** after the physical-write reservation fix.
All **twenty** retained raw files were individually read and verified after
the oldest complete point's physical retirement. The affected application/
local/account/UI gate passed **15 explicit suites / 98 tests**, zero skipped,
in **8.183 s**. Full JavaScript/CSS/layering checks passed with zero errors and
the same 39 existing warnings. No dependency was added.

M2-11 is complete in development. Provider linking remains explicitly deferred;
between-game permissions, live transport/session lifecycle, hosted rollout and
the post-migration save presentation retain their separate gates. The 65-task
migration checklist now has **28 completed tasks**, excluding deferred UX-01.
The next runtime-packaging readiness probe found the Docker CLI installed but
its Linux engine unavailable; no Docker daemon was started and no cloud build
or deployment was attempted.

## Locally verified production API runtime package

`M4-06` is complete locally, not deployed. The owner updated/restarted Docker
Desktop, and the Linux/amd64 engine was verified at version 29.9.3. All builds
used its local Windows named pipe, not a remote Docker context. No existing
unrelated container was inspected, started, stopped or deleted.

The production entry uses the existing cloud authority and serves only cloud
API routes plus `/healthz`. It does not publish the website, repository files,
tooling or private data. Production requires explicit project/bucket/mode and
exact HTTPS frontend origins; emulator endpoint overrides, alternate project
settings, ambient Firebase configuration and credential-file configuration fail
explicitly without echoing their contents. The existing Admin SDK default
credential chain uses the managed service identity when hosted; no developer
ADC file or service-account key is copied/mounted. Demo and production adapters
share only SDK initialization and retain their separate configuration guards.

The Dockerfile pins the official Node 24 Bookworm-slim image index to
`sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`.
The built Linux runtime reports **Node 24.22.3**, above the Node 24.4+ floor.
Its Dockerfile-specific deny-by-default build context was **19.80 MB**:
application source, the required backend modules, dependency manifests and
versioned resource packs/notices. It excludes repository/history, tests, docs,
host databases, Auth exports, client Firebase settings and development/emulator
tools. Production dependencies use the existing lockfile with install lifecycle
scripts disabled to avoid development Git hooks; the actual Linux native decoder
is exercised below rather than assumed available.

Reproduce from the migration worktree with local Docker Desktop running:

```powershell
docker build --platform linux/amd64 --file tools\cloud\Dockerfile --tag taverntable-cloud:local-check .
node tools\cloud\check-container.js taverntable-cloud:local-check
```

The container check creates/removes only its own identified test container.
It publishes no ports and runs with **no network or mounts**, a **read-only
root**, **1 CPU / 1 GiB**, dropped capabilities and no privilege escalation.
Actual image execution proved:

- Non-root UID **1000** binds `0.0.0.0` at **18089**, demonstrating `$PORT` is
  honored instead of hard-coding the image's default 8080.
- Readiness is **200**; anonymous and unsigned/forged identities receive **401**;
  source/tooling requests receive **404**. Configuration failures exit nonzero
  with redacted startup errors. This is process/API readiness, not proof of
  external datastore/IAM connectivity.
- All **16 bundled resource packs / 15,131,548 bytes** match their pinned hashes,
  both 2014/2024 catalogs load, and a real **16,000,000-pixel** PNG decodes before
  an intentionally stopped admission callback, without making a Storage request.
- No developer credential, GPU, canvas development package or emulator/CLI
  tooling is present. The image's three runtime-module hashes match the final
  source files. SIGTERM exits **0**, without an OOM, and the test container is
  removed. The smoke helper's final RSS sample was **209,059,840 bytes**; it is
  not a production peak-memory/load or monthly-cost measurement.

The local image is `taverntable-cloud:m406-8fcb9250`, image index
`sha256:4eb77fb09cca679b00d02eda25a76c8120d55d1bd10d4e7b7e20b0eda9d4d51c`.
It was not pushed. The undeployed Cloud Run template records **us-west1**,
request-based CPU allocation, disabled startup CPU boost, service/revision
minimum **0** and maximum **1**, concurrency **40**, **1 CPU / 1 GiB** and
**3600-second** requests. Image, runtime identity, project, bucket and frontend
origin placeholders remain unfilled pending `M4-08`. Fields were checked against
the [official Cloud Run v1 YAML reference](https://docs.cloud.google.com/run/docs/reference/yaml/v1).
Maximum-one-instance is not used as a correctness guarantee, nor is request
timeout a total live-game duration cap.

The Git text policy now includes the new Dockerfile/YAML types. The final
LF-normalized recipe was rebuilt and the actual container gate rerun; its
runnable image manifest remained
`sha256:4ebb5fbf31640574c1091c7bd79b950bd514a4583243a08c4dab35bbeb14ddf7`.

Focused production/configuration and real demo SDK compatibility passed
**7/7 native cases**, zero skipped, in **6,915.1351 ms**. Existing runtime,
identity-outage and metadata-outage checks passed **4 explicit suites / 10
tests**, zero skipped, in **3.447 s**. Full JavaScript/CSS/layering checks passed
with zero errors and the same 39 existing warnings.

The first compatibility run found three `ECONNREFUSED` failures because the old
attached emulator process was no longer present, not because of a weakened
runtime guard. All four dedicated emulator ports were verified free before
restoring only the latest official `M2-11` preservation export into the same
guarded demo project. The rerun above passed. Independent SDK reads verified
the original M1 generation **64**, exact scene/character hashes and both
**709,228-byte** retained files. No Auth export contents were displayed.

Hosted service identity/IAM, public frontend packaging, Cloud Run wake/scale,
representative load and measured cost remain their own gates. No cloud build,
deployment, IAM change, live campaign write, push/merge or actual cutover was
performed. Provider linking remains deferred and routine-save presentation
remains untouched.

## Durable campaign-scoped live-game authority

`M4-01` is complete as the early development authority prerequisite for M2/M3.
It does not enable synchronized player gameplay or advertise the later lifecycle
UI as finished. Managed account sign-in, a live game and a saved combat turn
remain separate.

`liveSession/current` stores a versioned per-campaign state, monotonic control
generation and fresh live epoch. Initial reads return paused/not-started without
starting anything. Only the current campaign owner can start, end or keep-active;
a UID that owns another campaign gains no global DM privilege. Control state and
its UID/context-bound command receipt publish atomically. Duplicate delivery
recovers the original accepted transition rather than starting/resetting again.
Start after pause creates a new epoch; keep-active retains it.

Authenticated status reads and explicit admission use the same current membership
checks as other campaign operations. Paused games, old epochs and removed members
cannot obtain live admission. The transaction-time `requireLiveSession` seam
must be reused by M3 world-command publication and stream admission/renewal;
read-time admission alone is not a lasting grant. It returns explicit authorized
participant metadata, not arbitrary owner snapshots. Owner preparation remains
the separately authorized canonical editing path.

The owner selected **allow paused DM token repositioning without movement/action
costs**. A real connected-world checkpoint drill starts/ends a live game, changes
the token's physical/grid position while paused, and preserves exact character
rows, saved combat and movement/action state. The preparation does not restart
or keep-active the ended game. Player world actions still require live admission;
assigned between-game sheet behavior remains `M2-12`.

The managed client has a separate uncertain live-control channel, not the
canonical save or backup caller. It captures the original command/snapshot,
validates the exact transition/UID/campaign/epoch, and retries the same body.
An accepted old start receipt remains historical: refreshing current state after
another worker ended the game returns paused, not a falsely revived live game.
Malformed replies cannot acknowledge a primary save or become cached authority.

Real emulator/HTTP/process tests verify:

- Campaign-scoped owner/member/unrelated role isolation, including one UID owning
  another campaign; login/status reads do not start or extend a live game.
- More than six hours of owner renewals without a total-duration cap, and one
  stable epoch until explicit pause/restart.
- Cold competing start/replay and end/keep-active control races with one accepted
  generation, cross-endpoint command conflicts and fail-closed malformed state.
- Actual backend process termination/replacement with the same durable state and
  original owner receipt; canonical character/scene data remains unchanged.
- Paused/stale/revoked admission denial, zero-cost owner preparation and a fresh
  paused copy that does not inherit the source's live authority.

The complete affected authority/canonical/backend-process/production-runtime
gate passed **77/77 native cases**, zero skipped, in **206,039.7877 ms**.
The existing application/local/account/history/save-feedback gate plus the new
strict live-response checks passed **15 explicit suites / 100 tests**, zero
skipped, in **7.774 s**. Full lint/stylelint/layering passed with zero errors and
the same 39 existing warnings. This is an affected-file gate, not a claim that
the entire expanded native catalog or real player-gameplay wire was rerun.

The 55/60-minute inactivity evaluator, coalesced disconnected grace, safe
drain/final-backup and owner lifecycle UI remain their next explicit gates.
Current player gameplay remains visibly gated. No hosted deployment, live
Auth/IAM/Storage change or real-data cutover occurred; routine-save presentation
is untouched.

## Meaningful-activity deadlines and server-observed warnings

`M4-02` is complete for the development authority and managed-client slice.
`GET .../live/status` returns strict campaign-scoped session metadata plus
server-observed activity status: observation time, warning/pause deadlines and
active/warning/paused phase. Warning begins at **55 minutes**, not one timer
tick later; at **60 minutes** the stored state becomes paused with the original
deadline as its effective pause time, even when the next real request arrives
later. No permanent worker or shutdown callback is responsible for correctness.
The new status interface remains under ordinary current-account/membership,
origin, request and private-output checks.

Only newly accepted meaningful work renews a live game. Canonical world/sheet
publication compares validated saved content rather than trusting a client
activity flag. Changed movement, shared rolls, terrain, saved turns and sheets
renew the activity timestamp **in the same transaction** as the accepted head
and receipt. Camera, selection and connected-map view persistence are excluded.
Unchanged scene/sheet saves, rejected changes, old-command recovery and status/
admission/reconnect reads cannot renew. Existing explicit owner keep-active is
receipt-backed; retrying the original body returns the original renewal time.
The control generation is unchanged by ordinary accepted content activity, and
owner-end acknowledges the newer accepted timestamp rather than falsely
rejecting an otherwise valid end receipt.

Expiry is checked again inside transaction-time live admission. A late keep
cannot revive the old epoch: its natural request persists the due pause before
returning the explicit paused denial. Owner canonical preparation can still
finish after expiry, without starting a game or changing its last meaningful
timestamp. This preserves the approved paused-preparation policy and saved
combat/resources. Ordinary active renewal remains valid beyond six hours;
neither request timeout nor process age becomes a game-duration cap.

Focused red/green drills first reproduced the absent expiry denial, unchanged
activity timestamp and missing warning endpoint, then passed against actual
Auth/Firestore/Storage HTTP operations. Legacy-board and connected-world
checkpoints exercise meaningful and view-only differences. A separate real
child-process drill kills the warned backend and wakes its replacement after
the original deadline: reconnect and historical receipt recovery cannot renew
it. Another holds an actual owner object publication from minute 59 to minute
61; accepted preparation remains durable while the game stays paused at minute
60, including after another backend replacement.

The final affected authority/canonical/backend-process/production-runtime gate
passed **82/82 native cases**, zero skipped, in **252,378.732 ms**. The explicit
account/application/history/save-feedback gate passed **15 suites / 101 tests**,
zero skipped, in **8.422 s**. Full lint/stylelint/layering passed with zero
errors and the same 39 existing warnings. This is not a full expanded native
catalog or complete player-gameplay/SSE acceptance claim.

The actual changed backend was rebuilt as local image
`taverntable-cloud:m402-8fcb9250`, index
`sha256:958bad036300797bb1724887e3ad5ce7350449bfafab8123860ed6d02f2311d3`
and runnable manifest
`sha256:f93a09a2df186e6e455deac75c581367b72cc71c13c8c2de8a5d1da7fe4b94f7`.
The existing isolated check passed on Linux/amd64, Node 24.22.3, UID 1000,
read-only root, no network/mounts/credentials/GPU, one CPU and one GiB. It
verified custom port/all-interface health, anonymous account and live-status
401s, forged-identity 401, private-path 404, both catalogs, exact 16-pack resource
hashes and full 16 MP decoding. Source parity now covers six runtime files,
including the changed authority, router and shared protocol. SIGTERM exited 0
without OOM and the owned validation container was removed. Helper RSS
**208,039,936 bytes** is not representative production peak/load evidence.

Player command/SSE and visible lifecycle warning/control integration remain
their later gated M3/M4-04/M5 acceptance; status metadata alone does not advertise
synchronized gameplay. Coalesced presence/15-minute disconnected grace is next.
No live cloud provisioning, IAM/Auth/Storage test, image push, deployment or
cutover occurred. Provider linking remains explicitly deferred and routine-save
presentation is unchanged.

## Coalesced presence and earliest durable pause

`M4-03` is complete for the development authority/managed-client slice. Presence
bookkeeping is a private server transport interface, not a new browser heartbeat
endpoint, a world-access grant or an alternative to the existing global
four-stream quota. M3 must bind these callbacks to actual authenticated SSE
connections and their terminal outcomes.

Each campaign/runtime-instance pair stores one bounded summary: current live
epoch, connection count/generation and a **90-second observation lease**, shared
with the stream-lease timing convention. Private per-connection rows bind the
captured UID, campaign/epoch and current access generation. They avoid an
ever-growing participant array or a new participant-count limit. Once-per-minute
summary renewal coalesces all local participant pings; multiple workers keep
separate summaries, so one worker closing cannot declare another disconnected.
The bounded top-two expiry query is sufficient when replacing/removing one
worker's summary; its index is declared, not deployed.

The last explicit connection close starts **15 minutes** of reconnect grace at
its effective close time. After an unknown abrupt disappearance/process kill,
the last durable observation lease expires first, then the 15-minute grace
applies. This is the detection fallback for an unreported disconnect, not a
promise to know its physical instant without a running worker. Late cleanup
cannot restart that clock. Empty newly started games use their start time until
a real connection arrives.

Status/admission/owner controls and canonical publication evaluate the earliest
inactivity/grace deadline from shared metadata. Exact deadline races cannot
revive an old epoch. Owner keep-active renews meaningful inactivity only; it
cannot extend disconnected grace. A permitted reconnect before expiry clears
absence but does not renew meaningful activity. After expiry the owner must
explicitly start a fresh epoch. Current seat/eligibility checks still deny
revoked renewals even when no coalesced write is due; captured own-connection
cleanup remains possible after removal/disablement. Summary generations fence
late callbacks from closing or renewing a replacement. Invalid metadata fails
explicitly without silently repairing it.

Real emulator/HTTP/process evidence includes:

- Multiple connections on one worker plus another active worker: only the last
  close starts grace, and admission at grace-minus-one millisecond is valid
  while admission at the deadline persists the original disconnected pause.
- **Ten actual participant identities / 60 pings / two minutes:** exactly
  **two** summary writes, measured by actual Firestore update times, with the
  same original meaningful timestamp and control generation.
- Expired lease/generation, foreign UID, late cleanup, exact reconnect/keep race,
  fresh-epoch restart and started-but-unattached grace cases.
- Removed/disabled participants cannot renew, can close only their own captured
  connections, and corrupt presence is rejected over actual bearer HTTP.
- Actual backend termination and cold replacement at minute 17 pause at the
  original observation-expiry-plus-15-minute deadline, not at wake; saved
  canonical data remains unchanged.
- Presence-aware 55/60-minute, six-hour-plus renewal and real held-publication
  regressions continue to preserve activity/turn/resource behavior.

The first expanded native gate passed **107/108 cases** with one occurrence of
the already-recorded legacy assignment-contention
`3 INVALID_ARGUMENT: Transaction is invalid or closed`. The exact unchanged
contract then passed three bounded isolated probes; no production retry,
suppression or expected-error relaxation was introduced. The identical
authority/canonical/backend-process/global-quota/production-runtime recheck
passed **108/108 cases**, zero skipped, in **434,724.1744 ms**. All new presence
cases had also passed the first gate. The application/account/history/
save-feedback gate passed **15 suites / 101 tests**, zero skipped, in
**8.462 s**. Full lint/stylelint/layering passed with zero errors and the same
39 existing warnings. These are affected-path gates, not a full expanded native
catalog or complete player-gameplay/SSE claim.

The changed runtime was rebuilt locally as `taverntable-cloud:m403-8fcb9250`,
index `sha256:7fe0d53680d0ddf9d9d57264dfcb56ffe014fe843cecc5c71a276703764303ba`
and runnable manifest
`sha256:024792b381e12d7a42d1ed98d1d5a1a10044cb06545f622160573ff4e3e85986`.
The isolated non-root Linux/amd64 Node 24.22.3 check passed read-only root,
one CPU/one GiB, no network/mounts/credentials/GPU, custom-port health 200,
anonymous account/live-status and forged-identity 401s, private-path 404,
both catalogs/16 resource packs, full 16 MP decode and **seven** runtime source
hashes including the changed shared quota timing. SIGTERM exited 0 without OOM;
the owned validation container was removed. Helper RSS **205,852,672 bytes** is
not representative peak/load evidence.

No hosted project, IAM/Auth/Storage test, image push, deployment or cutover was
performed. Actual SSE, visible lifecycle controls/warnings and pause/drain/final
backup remain later integrated gates. Provider linking remained deferred at
that milestone; M2-04 subsequently passed same-UID live acceptance on the
owner-approved current account. Routine-save presentation is untouched.

### Approved bounded live API testing

The owner now approves ongoing live testing in the existing personal-project
Firebase project, `taverntable-489d5`; a separate project is not required.
The existing verified Google/password account must remain unchanged.

Read-only inspection found the Cloud Run and Artifact Registry APIs disabled.
The owner explicitly approved `approve_bounded_live_test` before provisioning:

- Enable Cloud Run, Artifact Registry and required IAM APIs.
- Create one private image repository and one `us-west1` test API, using
  request-based billing, minimum zero / maximum one instance, 1 CPU / 1 GiB.
- Give a dedicated runtime identity Firebase Auth read access, Firestore
  read/write access and object access to this project's campaign bucket.
  Do not grant Owner/Editor or download service-account keys.
- Permit HTTPS invocation at the platform while retaining Firebase identity,
  application eligibility and campaign-local authorization on protected routes.
- Use at most three disposable managed test accounts and two synthetic campaigns,
  then clean up those exact fixtures. Do not alter the current real account or
  existing campaigns.

The owner acknowledged possible cloud charges and that the existing $25 budget
alerts are not a spending cap. This approval does not authorize public frontend
cutover or migration of real campaign data. It enables incremental API checks;
it does not itself complete the later packaged-frontend, hosted performance,
cost, or migration-readiness gates.

### M2-12: online assigned sheets and real API acceptance

Joined **Assigned characters** uses the existing player-safe saved-sheet editor
with a fixed-campaign cloud Adapter. A fresh participant grant precedes the
assigned snapshot; responses contain only assigned character rows and explicitly
allowlisted metadata, never a scene, private NPC rows or owner object references.
Current eligibility, UID/seat/generation, assigned IDs and head generation are
rechecked after actual Storage IO.

Scoped writes share the legacy assigned-record policy rather than implementing a
second rules/source/trait/world merge. Unassigned rows remain exact; saved token
names can follow a sheet rename, but movement, combat and action resources do not
change. Canonical staging/head CAS/receipt publication remains atomic. The actor
is the member while storage/image/backup accounting uses the actual head owner;
no synthetic owner principal is constructed. Admission and publication recheck
current member authority, and member-owned other campaigns cannot lend quota.
An original eligible UID can recover its own minimal accepted receipt after
removal; it contains no sheets or new grant and cannot authorize a fresh read.

The UI performs short requests only, clears inaccessible tabs on account change/
denial, closes editing on offline transitions, and requires explicit online
refresh. Uncertain saves retain the original command/caller/body/scope and block
exit until recovery. Shared seats use ordinary canonical conflicts, not automatic
merging. Paused sheet work and DM preparation do not start or renew a live game.

Verification:

- **162/162 affected native cases**, zero skips/failures/cancellations,
  **704,588.6424 ms**: account-local authority, persistence, quota, private assets,
  backups/portability, actual backend replacement and production configuration.
  The new member paths include both editions, exact private-row/world preservation,
  owner 20 GiB admission, lost accepted reply/removal, revocation after actual
  snapshot download/new bytes upload, decoded private PNG and a due complete
  backup triggered by a short assigned read.
- **18 suites / 116 application tests**, **8.234 s**; full JavaScript/stylelint/
  layering: zero errors and the same 39 baseline warnings. Regression-first
  checks caught and fixed stale tabs after account switching and acceptance of
  unexpected private campaign metadata in assigned DTOs.
- Actual live API verification used the approved three temporary managed Auth
  identities and two synthetic campaigns. Production-mode browser-store
  transport/native SDK sign-in, Firebase token checks, Firestore publication,
  GCS images, owner billing, private/unrelated/world-command denial and lost-reply
  recovery after removal all passed. Invitation redemption correctly advances
  access generation; the initial harness's stale-zero assignment was denied,
  then corrected to fetch the current grant without changing production policy.
- Final live pass: **2026-11-13 21:04:51 UTC**. Verified cleanup completed
  **21:04:56 UTC**: all three Auth fixtures, both campaign trees, their own
  invitation/account branches and **eight live object generations** were removed
  by exact scoped paths/generation conditions. No listed object versions remain.
  Existing bucket soft-delete retention was not changed; tiny retained fixture
  bytes may remain billable under that policy. The current real account and
  existing campaigns were untouched.

The bounded service is
`https://taverntable-api-test-zp7b3oizna-uw.a.run.app`, revision
`taverntable-api-test-00002-wmc`, using private immutable image
`sha256:5eb8f8c628d2769618023a86d330756a3bd9d69b17c5896bb431d5be75c89f59`
(runnable Linux/amd64 manifest
`sha256:eae5702b6ffe5242dbcab275c9ef72d8ab574ac6e996c02aff0ab57280b7bef1`).
Runtime IAM readback confirmed only `roles/datastore.user` and
`roles/firebaseauth.viewer` at project scope, and conditional
`roles/storage.objectUser` for `campaigns/` objects plus bucket inventory.
Unrelated IAM bindings were preserved with ETags; no downloaded keys,
Owner/Editor grants or public repository binding was introduced.

Live testing exposed Cloud Run interception of public `/healthz`, not an
application/authorization failure: internal startup probes succeeded, `/` and
protected API requests reached the app, while `/healthz` returned Google's HTML
404 without a request trace. The
[official reserved-path guidance](https://docs.cloud.google.com/run/docs/known-issues)
recommends avoiding `z`-ending paths. Public/template/container readiness now uses
`/health`; the internal/local legacy alias remains. The failing public-path
regression is fixed; **3/3 production-host cases**, zero skips,
**1,678.749 ms**, cover GET/HEAD/405 and unchanged private/configuration guards.
Real HTTPS now verifies readiness 200, anonymous account 401, private file 404,
allowed preflight 204 and unapproved origin 403 without weakening any guards.

The final actual image passed the CPU-only/non-root/read-only/no-network/no-key
container check, exact eight runtime source hashes, both catalogs, 16 MP decoding
and clean SIGTERM exit. Helper RSS **209,653,760 bytes** is not peak/load proof.
The scoped validation container and ephemeral registry credential files were
removed. Request-based CPU, min 0/max 1, 1 CPU/1 GiB and concurrency 40 remain the
approved starting configuration, not measured sleep/performance/cost acceptance
or a spending cap. Full Hosting packaging, M4 release gates, real-data migration
and routine-save UX remain pending.

### M2-13: implemented-operation permission and persistence gate

The complete M2 implementation at `e6ebc53194328e2935f9c0b5e20c3409f48030a6`
remained unchanged throughout both milestone gates:

- The official `node tools/cloud/run-emulator-tests.js --inside-emulators`
  catalog passed **190/190 native SDK cases**, zero failures/skips/cancellations,
  **725,271.6615 ms**, using only the pinned official demo endpoints.
- `npm run test:stable` passed **298 suites / 3,861 tests**, zero failures/skips,
  **1,461.583 s**, with open-handle detection. This includes the existing local
  host/SQLite/session, player authorization, gameplay/undo, rendering, geometry,
  saved-turn and travel regressions; no source behavior changed during the gate.
- Full lint/stylelint/layering remains zero errors and the same 39 existing
  warnings. No assertion relaxation, blanket retry, writable cloud fallback,
  dependency update or unrelated baseline fix was introduced.

The actual HTTP classification and dispatch were reconciled with this matrix.
Each protected route derives its principal from verified bearer identity and
consumes the shared account request quota. Invitation redemption alone performs
verified-identity admission before its atomic eligibility/enrollment decision.
Scope headers are restricted to the explicit participant/assigned/image
interfaces. No public route accepts the internal resource-owner UID helpers as
an alternative to caller authentication or campaign authorization.

| Implemented surface                                 | Owner of this campaign                                                                             | Current member                                                                                           | Unrelated UID                                                           | Existing evidence                                                                                                                                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account and Owned/Joined directory                  | Own verified, eligible UID and campaign-local role                                                 | Same account checks; minimal current seat/index projection                                               | Own account/campaigns only; no foreign campaign data                    | [Account access](../../tests/cloud/AccountAccess.test.js), [browser account](../../tests/cloud/BrowserAccount.test.js), [campaign access](../../tests/cloud/CampaignAccess.test.js)                                                               |
| Sign-in-method linking                              | Same proven UID retains ownership                                                                  | Same UID retains joined assignments/access                                                               | No email/name matching or account merging                               | [Linking acceptance/rejection safety](../../tests/cloud/AccountLinking.test.js), M2-04 real-account proof                                                                                                                                         |
| Canonical snapshots, scene/sheet saves and settings | Explicit owned read/write, captured revisions/generation                                           | No raw owner scene/NPC table or owner canonical/settings write                                           | Denied before staging or delivery                                       | [Canonical store](../../tests/cloud/CampaignStore.test.js), [access](../../tests/cloud/CampaignAccess.test.js), [process replacement](../../tests/cloud/BackendLifecycle.test.js)                                                                 |
| Invitations, assignments, sharing and removal       | Current-generation owner administration                                                            | Verified single-use binding; no administration                                                           | No foreign management; one invitation race winner and no loser approval | [Lifecycle/races/faults/replay](../../tests/cloud/CampaignAccess.test.js), real invitation acceptance/removal                                                                                                                                     |
| Online assigned sheets                              | Existing paused preparation semantics                                                              | Current assigned rows only; scoped CAS save; minimal original receipt is not a renewed grant             | No assigned data/write; foreign/private/malformed projections rejected  | [Real scoped reads/writes/IO races](../../tests/cloud/CampaignAccess.test.js), [managed client](../../tests/unit/campaigns/CloudCampaignClientStore.test.js), [sheet UI](../../tests/unit/ui/CloudAssignedCharacterSheets.test.js), real API gate |
| Private images                                      | Validated immutable JPEG/PNG/WebP under owner ledger                                               | Only current assigned manifest/bytes; post-IO recheck; scoped sheet image edits                          | No foreign manifest, image or upload authority                          | [Private images](../../tests/cloud/PrivateAssets.test.js), [limits](../../tests/cloud/UsageLimits.test.js), real exact-byte PNG delivery                                                                                                          |
| Complete export/import/retained restore             | Full owned file; bounded own multipart intent; restore as fresh authority                          | Cannot obtain the owner's file/history; independent owned copies do not grant global DM authority        | Cannot inspect/resume foreign transfers or backups                      | [Portability](../../tests/cloud/Portability.test.js), [process recovery](../../tests/cloud/BackendLifecycle.test.js)                                                                                                                              |
| Independent rolling backups                         | Twenty complete points; captured source and separate failure/receipt state                         | Authorized short sheet requests can trigger private owner work, never receive owner history/files/status | No foreign backup work/file authority                                   | [Complete history/restore/failures](../../tests/cloud/Portability.test.js), [cold recovery](../../tests/cloud/BackendLifecycle.test.js), M2-12 due member-request backup                                                                          |
| Quotas and fenced cleanup                           | Atomic slots/whole-checkpoint bytes; generation-specific deletion and conservative retained charge | Changes charge the campaign owner, not the member's separate allowance                                   | No foreign accounting rewrite or prefix maintenance                     | [Usage/cleanup boundaries](../../tests/cloud/UsageLimits.test.js), [immutable bytes](../../tests/cloud/ImmutableObjects.test.js), [portability](../../tests/cloud/Portability.test.js)                                                            |
| Durable live foundation                             | Owner-only start/end/keep-active; paused free preparation                                          | Current status/live admission only; sign-in/presence never starts or renews meaningful activity          | No foreign status/admission/control                                     | [55/60/15-minute and lease cases](../../tests/cloud/CampaignAccess.test.js), [actual replacement](../../tests/cloud/BackendLifecycle.test.js)                                                                                                     |

This closes implemented M2 persistence coverage, not future protocol coverage.
Actual participant world/room snapshots and deltas, SSE transport and leases,
world commands/motion, authorized cache reconciliation and drain/final-backup
wires must pass their own M3/M4 gates before activation. Hosted scale-to-zero,
representative load, cost and full website acceptance remain separate as well.
The existing local Adapter and preserved original hosts/data remain unchanged.

### M3-01: authorized participant checkpoint, manifest and delta contract

The new managed participant HTTP interface admits only a verified current member
with explicit seat/access generation and an active owner-started live epoch.
It captures canonical state privately, rechecks eligibility/assignment/epoch/
head after Storage work, and constructs an explicit public projection rather
than deleting a few fields from a DM save. Both snapshot and image delivery deny
revocation, owner pause or newer canonical state during actual IO.

The existing public physical rendering policy remains authoritative: one assigned
real observer, closed-room concealment, no combined sight from another owned
creature/camera, and only permitted surfaces. Serialized checks cover closed-room
and unrelated-map names/origins, construction authoring notes, private NPC rows/
budgets, legacy terrain keys and canonical owner/object references.
Assigned records and visible actors contain no embedded portrait/artwork bytes;
typed image slots use verified immutable references. A visible NPC portrait can
be downloaded through the current observer's manifest without obtaining its
private character ID/sheet or broadening the existing assigned-image endpoint.
An explicit no-observer checkpoint clears prior vision.

Strict client/shared schemas bind UID/campaign/seat/generation, epoch, revisions,
actor ownership and image slots. Unknown private fields, foreign records/scopes,
bad metadata and corrupted graphic bytes fail explicitly. The graphic content
hash supports conditional omission of unchanged bodies. A view key binds the
current observer/render frame and authorized actor/asset set, not private
canonical contents.

The delta contract accepts only the captured base generation and its next
committed generation within the same access/epoch. Same-view deltas contain
changed actor/assigned rows plus necessary public metadata, not unchanged tables
or asset bodies. View changes replace the authorized checkpoint atomically, so
removed sightings/portraits are not retained or replayed. Duplicate/gap, foreign
UID, raw owner metadata, private NPC budgets and unassigned-row patches reject
without mutating the prior checkpoint. Durable journal fan-out and actual SSE
delivery remain the next tasks.

Verification:

- **81/81 affected native cases**, zero failures/skips/cancellations,
  **328,420.5164 ms**: participant/public image HTTP plus existing campaign access,
  private assets, actual backend replacement, dev host and production runtime.
  Eight new participant cases cover serialized room/blueprint/sheet/budget
  exclusion, conditional/hash/no-observer behavior, unrelated owner/forged scope/
  paused/stale epoch denials, scoped visible-NPC image bytes, after-IO admission
  fences and sparse delta/revoked-view application.
- **10 suites / 76 application tests**, **6.843 s**; full JS/stylelint/layering:
  zero errors and the same 39 baseline warnings. The local public player wire,
  assigned editor and local authority race behavior remain intact.
- Actual Node 24.22.3 Linux/amd64, UID 1000, 1 CPU/1 GiB, read-only/no-network/
  no-mount/no-key container checks passed both editions' participant projectors,
  sixteen resource packs, full 16 MP decoding, readiness/auth/private-route checks,
  eleven exact source hashes and clean SIGTERM exit. No dependency change was
  needed. Helper RSS **210,477,056 bytes** is not representative peak/load proof.

The real presence query initially failed `FAILED_PRECONDITION` because its
declared composite index had not been deployed. Read-only inspection confirmed
no such index; no test account or campaign was started to discover this failure.
The owner explicitly approved **only**
`livePresence`, collection scope, `sessionId ASC` / `expiresAt DESC`, acknowledging
normal index storage/write charges. It is READY as `CICAgOjXh4EK`; Firestore adds
`__name__ DESC`. Its exact formerly failing query now returns HTTP 200. No other
declared index, IAM grant, downloaded key or new service was introduced.

The approved single API test service now uses revision
`taverntable-api-test-00003-8th` and private immutable image
`sha256:01dbebc4ae3da239346c01b6fc81ec51770529e8c01cd380e1afc39ca7484be2`
(runnable manifest
`sha256:4f8d75bee1e2ca399e1405a0711e7fc5913fde03b1340c6bf69467ec60b7d3c5`).
Real acceptance passed **2026-11-13 22:44:12 UTC**: explicit owner live start,
current member/epoch projection, no private NPC sheet/embedded images,
observer-scoped exact NPC PNG bytes while the assigned-only endpoint still
denied them, no activity renewal from reads, conditional graphics omission,
a one-actor/zero-unchanged-row delta, duplicate-gap denial and post-pause
world-read denial. The paused assigned-sheet and historical receipt gates also
passed unchanged.

The same three approved disposable identities and two synthetic campaigns were
used. Cleanup verified their Auth users/campaign trees/invitation/account branches
absent and **ten live object generations** conditionally deleted with no listed
versions remaining at **22:44:17 UTC**. Existing soft-delete retention remains in
force; tiny retained fixture bytes may remain billable. Current real accounts/
campaigns, original hosts/data and routine-save presentation were untouched.
No full frontend/cutover or ten-client SSE/gameplay/cache/sleep/performance/cost
acceptance is claimed by this API contract gate.

### M3-02: ordered private journal and shared authorized observation

Campaign creation now commits compact event one with its head and UID receipt;
import/settings/canonical saves already publish their matching event atomically.
The private owner-only history reader validates exact fields, generation/document
identity, supported kinds, timestamps, revision order and agreement with the
captured head. It is not a member/private-data HTTP endpoint. Backend participant
observation uses a separately admitted current member scope and live epoch before
constructing any public update.

The selected reconnect window is **1,000 changes and no more than 24 hours**.
Exact 1,000/1,001 and 24-hour-minus-one-millisecond/expiry tests pass. Stale,
pruned and legacy-baseline cursors explicitly require a fresh checkpoint;
missing/incompatible metadata and a cursor ahead of the head fail explicitly.
Normal authorized requests retire at most **100 expired entries** per operation.
Deletion and a monotonic `prunedThrough` boundary commit together, with no
primary head/receipt/object change. This keeps work bounded after long sleep,
not dependent on a running timer. An invalid retention clock cannot delete recent
events or return a success-shaped history response.

Active participants share one per-campaign observation group for canonical head,
live control and access changes. An immutable private frame promise shares the
scene/character Storage bodies for each generation; eligibility, ownership,
scope, epoch, current head and public projection still execute for each viewer.
Two actual participant observers make **two total canonical body downloads**
per generation, not two per viewer. Ten real presence renewals add **zero**
canonical downloads. A controlled in-flight burst discards superseded frames
and sends the latest authorized checkpoint with no historical motion updates.
Warm subscribers receive no unchanged graphic body. Revocation/owner pause
close affected viewers, and the final subscriber releases watches/frame data.

Duplicate/gap deltas cannot rewind state. A regressing stored head closes
observation instead of becoming an older replacement checkpoint. Listeners
enqueue synchronously; unsupported asynchronous rejection and callback failures
are isolated, redacted and surfaced without killing other participants. The
backend observation seam grants neither an HTTP SSE connection nor a global
stream-quota lease; actual transport/presence binding is M3-03.

Verification:

- The initial seven-file native gate ran **165 cases**: 158 passed and seven
  directly related legacy assertions expected journal totals without creation
  event one. Those tests now capture the exact pre-operation count and assert
  the required zero/one/two-success increments; winner, receipt, precondition and
  rollback checks were not relaxed. Final full access/canonical recheck:
  **92/92**, zero skips/failures, **333,519.6709 ms**. The other **73 cases**
  passed unchanged in the broader gate.
- Five focused real SDK cases passed **28,870.972 ms** before the final
  conditional-graphics recheck. They include actual backend termination after
  commit and before delivery: a fresh child process reads one durable journal
  event, the original caller recovers the identical command receipt, and retry
  creates no duplicate event. Further focused tests found/fixed unsafe NaN-clock
  retirement, an escaping asynchronous listener rejection and backwards-head
  replacement. No blanket retry or raw SDK error relaxation was added.
- **6 application suites / 56 tests**, **8.138 s**; final full JS/stylelint/
  layering: zero errors and the same 39 baseline warnings.
- Actual Node 24.22.3 Linux/amd64, UID 1000, 1 CPU/1 GiB, read-only/no-network/
  no-mount/no-key runtime checks passed twelve exact source hashes, both edition
  projectors, sixteen resource packs, full 16 MP decoding and clean SIGTERM exit.
  The owned validation container was removed. Helper RSS **209,776,640 bytes**
  is not representative peak/load proof; no dependency change was needed.

The approved single API test service uses revision
`taverntable-api-test-00004-bqp`, private immutable image
`sha256:f2052f96753a7e9c785b64af7e2453c4a506bffba6b55445ea6e251195380740`
(runnable manifest
`sha256:2cb3f89d78f5e6a446775fc8bb1e779421a718ee344403f44325befe2a135272`).
Real acceptance passed **2026-11-13 23:56:31 UTC**. The actual six-field private
journal is ordered from atomic creation through the committed head. Aging one
owned fixture entry and issuing a normal owner GET deletes only that expired
entry and commits the retained floor, with exact primary head fields unchanged.
The first fixture used the local VM clock, which was about eight seconds ahead
of the service and correctly left the entry unexpired; the fixture was corrected
to use its actual server commit timestamp, not by weakening production policy.
The paused sheet, private image, participant, delta and original-receipt gates
also pass unchanged.

The same three approved disposable identities/two campaigns were used. Cleanup
verified all fixtures and **ten live object generations** absent at
**23:56:36 UTC**; the earlier fixture attempt was also cleaned (nine generations).
Existing soft-delete retention remains in force and tiny retained fixture bytes
may remain billable. No real account/campaign, IAM grant, index, service,
frontend/cutover or routine-save UX change was introduced. Shared observation
is real SDK/component evidence; actual hosted SSE delivery, gameplay/animation,
cache, lifecycle/load and cost gates remain pending.

### M3-03: direct authenticated Fetch SSE

The direct API POST `/api/cloud/campaigns/{id}/events` now admits the managed
bearer identity and current campaign scope/live epoch before opening transport.
Authorization and captured seat/access-generation travel in headers, never query
strings or cookies. Exact frontend-origin/preflight checks do not replace those
backend checks. Local cookie/CSRF transport remains unchanged; neither native
EventSource custom headers nor a long-lived Hosting rewrite is involved.

Member requests capture `{sessionId, observerTokenId, mapId, assetKey}` and receive
the existing explicit checkpoint/delta/resync DTOs from shared campaign observation.
Owner requests use the same active epoch with null observer/map/cache fields and
receive an independently owner-authorized `owner-head` event: version, access,
session ID and only generation/character revision/scene revision/save time.
There is no synthetic member identity or canonical body in this notification.
It is a transport notification, not completed owner gameplay/motion replication.

Actual stream startup acquires one of **four UID-global renewable leases** across
campaigns. Presence connects only after transport headers and is followed by a
final live/access fence before any queued checkpoint is sent. Every **60 seconds**
the original bearer is reverified, current role/scope/epoch is checked, and lease/
presence renewals finish with another current live check. These renewals do not
count as meaningful activity. Comment heartbeats are **three bytes every
25 seconds**. A **55-minute transport deadline** intentionally closes the stream;
it neither ends the game nor imposes a total game-duration cap.

Backpressure is bounded to **sixteen queued events / 32 MiB UTF-8** per stream.
Overflow, revoked access, pause or failure discards queued state instead of
flushing old private data. Cleanup serializes in-flight renewal and independently
attempts watcher/presence/final-lease release, even if another cleanup step fails.
Typed close controls contain no arbitrary provider messages/codes. Unknown failures
and unsuccessful cleanup are explicitly redacted and logged.

The managed client uses Fetch's readable body, validates incremental UTF-8,
CR/LF/CRLF and multi-line data framing, enforces event-byte/cursor/kind bounds, and
reuses current UID/access/epoch and participant/graphic-integrity guards. Initial
HTTP 401 retries once using renewed identity and the exact captured body/scope.
Account changes, stalled bytes, malformed/truncated frames and campaign close
cancel the reader and account observer, clear transport buffers and stop timers.
No scene polling, offline queue, browser authority or implicit local fallback was
added. World UI remains disabled; automatic reconnect/reconciliation is M3-04.

Verification:

- Final complete affected Auth/access/canonical/usage/process-replacement/
  production-host gate: **145/145 native cases**, zero failures/cancellations/
  skips, **596,211.1745 ms**. Actual HTTP cases cover scoped member changes,
  seatless owner notifications, four UID-global streams across two campaigns,
  fifth-stream 429, abrupt client abort/slot recovery, owner pause, epoch change
  and membership removal. Anonymous/expired/revoked/disabled/wrong-project/
  foreign UID/campaign/stale seat/generation/origin/query/body/GET admissions
  fail without a stream grant.
- **7 app suites / 94 tests**, **3.007 s**, with open-handle detection, including
  unchanged local and non-DOM transports. Focused failures first exposed and
  then verified fixes for close-versus-renewal races, cleanup short-circuiting,
  a live pause during presence startup, raw body/provider diagnostics and failed
  account-subscription cleanup. Exact queued-event and 32 MiB byte boundaries,
  55-minute deadline, heartbeat/stall handling and invalid UTF-8/cursors pass.
- Full JS/stylelint/layering: zero errors and the same **39 baseline warnings**.
  Actual Linux/amd64 Node **24.22.3**, UID 1000, read-only/no-network/no-key
  **1 CPU/1 GiB** runtime verifies **thirteen exact source hashes**, sixteen
  resource packs, full 16 MP decoding, anonymous/forged event denial and clean
  SIGTERM exit. The owned validation container was removed. Helper RSS
  **217,821,184 bytes** is not peak/load proof. No dependency change was needed.

The already approved single API test service now uses revision
`taverntable-api-test-00005-8bz`, private immutable image
`sha256:35700bc8f98ff8b2439fd7bdc2b8fa0c71133c0911559eda59408dedf19a8893`
(runnable manifest
`sha256:ad0609400b6cd880e4a8c4fee1fb3afccda73451c91993ba810e1d247a14d693`).
Real HTTPS acceptance passed **2026-11-14 00:52:33 UTC**: managed owner/member
streams delivered their authorized checkpoint/change/head events; the same durable
lease renewed after an actual 65-second observation interval with two real presence
connections and unchanged meaningful-activity state. Owner pause released both
leases/presence before closed controls/EOF. A subsequent real Auth token revocation
closed its active owner stream at bearer renewal and released lease/presence.
Existing paused sheets, private images, journal retirement and original receipt
recovery after membership removal also pass.

The same **three approved disposable identities / two synthetic campaigns** were
used. Cleanup verified their Auth records, exact Firestore document trees and
**ten live object generations** absent at **00:52:38 UTC**. Existing bucket
soft-delete retention is unchanged; tiny retained fixture bytes may remain billable.
No new API service, IAM role/key, index, real account/campaign, frontend/cutover or
routine-save UX change was introduced. Reconciliation, native animation,
account/view cache, final lifecycle drain and hosted load/cost gates remain pending.

### M3-04: managed reconciliation and recovery

The explicit client `observeEvents` operation now owns the live connection
lifecycle for a captured UID/campaign/access generation/live epoch/view. Its
readiness promise resolves only after the current authorized state has been
published synchronously. Status separates connecting/synchronizing/ready/
reconnecting from paused/ended/denied/error/closed. World UI remains disabled;
data readiness does not bypass backend world admission or finish GPU/UI loading.

Contiguous same-view member deltas publish live state. View replacements and
checkpoint/resync/rejoin events reconcile atomically, never replaying missed
movement. Missing/duplicate generations, truncated events, stalled transport and
network/backend loss reconnect to the latest authorized checkpoint. A backwards
replacement is a typed failure, not a rewind. Owner notifications remain the
separate compact authorized head protocol; full owner motion is M3-05.

Transient failures use exponential jitter bounded to **1-30 seconds**. Successful
state publication resets backoff. An intentional jittered **50-52-minute**
rotation refreshes the same managed identity before the 55-minute SSE deadline;
server deadline and expired-bearer controls also refresh before retry. Revoked
managed identity is not treated as an indefinitely renewable expired token.
Paused/ended epochs, changed account, lost campaign/eligibility access and invalid
authoritative responses stop retries. Identity remains observed during backoff,
not just while a readable body is open.

Cancellation now binds opening HTTP and readable-body lifetime to the same caller
signal. Close cancels retry/rotation timers, account observation and retained
state. Synchronous callback failure/unsupported asynchronous publication is typed
and redacted, rather than acknowledging unverified readiness. Existing local
cookie transport is unchanged. Graphic cache reuse stays in current UID/access/
view memory, is hash checked and omits valid unchanged graphic bodies on rejoin;
persistent account/view browser cache remains a later task.

Verification:

- **8 explicit app suites / 115 tests**, **2.834 s**, with open-handle detection.
  Exact lower/upper intentional jitter boundaries and the 30-second backoff
  ceiling pass. Real readable-byte/strict DTO tests cover missing and duplicate
  deltas, changed-view replacement, partial EOF, expired bearer recovery,
  revoked managed refresh, account switch during backoff, terminal pause/epoch/
  membership/eligibility controls and redacted callback failure.
- **5 native SDK/HTTP/process cases**, zero failures/cancellations/skips,
  **43,617.7534 ms**. The new actual-process test first publishes a normal member
  delta, kills the specific owned backend PID, commits an allowed assigned notes
  change through another backend, then starts a new process at the old endpoint.
  The original observation receives only the latest replacement checkpoint with
  current scope/epoch and no historical updates. Owner pause then stops retries.
  The first fixture attempted an unbound name/world rename and was correctly
  denied; it was corrected to the supported notes edit, not by weakening
  production validation. Four unchanged real SSE role/quota/auth/pause/epoch/
  membership regression cases also pass.
- Full JS/stylelint/layering: zero errors and the same **39 baseline warnings**.
  These changes are managed-client lifecycle behavior; backend authority/wire
  code and the already verified M3-03 runtime image are unchanged. No dependency
  or deployment change was needed.

Real acceptance against the same approved test API passed
**2026-11-14 01:36:56 UTC**. An actual HTTPS stream was aborted after the verified
member checkpoint; managed observation automatically reconnected to the same
UID/access/epoch and verified warm graphic key without retransmitting its graphic
body or replaying historical movement. Reconnect left meaningful activity
unchanged. Owner pause stopped retries and released lease/presence. A separate
real Auth revocation closed the bearer stream, made managed refresh fail and
terminated observation without publishing another state. Existing assigned-sheet,
private-image, journal and original-receipt acceptance also pass.

Only the same **three approved disposable identities / two synthetic campaigns**
were used. Exact cleanup verified their Auth/Firestore fixtures and **ten live
object generations** absent at **01:37:02 UTC**, with existing bucket soft-delete
retention unchanged. The API remains M3-03 revision `taverntable-api-test-00005-8bz`
and image `sha256:35700bc8f98ff8b2439fd7bdc2b8fa0c71133c0911559eda59408dedf19a8893`.
No new API service, IAM role/key, index, real account/campaign, frontend/cutover
or routine-save UX change was introduced. Native movement/animation, player
world UI, persistent cache, lifecycle drain and hosted load/cost remain pending.

### M3-05: native world authority and bidirectional presentation

This slice is verified by the directly affected local/SDK/native/runtime gates
and approved real HTTPS acceptance. It is not a frontend rollout or an enabled
full cloud-gameplay claim.

- Member `world-commands` accepts one native command ID/intent with its current
  live epoch and captured UID/seat/access-generation headers. The private draft
  reuses `executePlayerCommand`, pinned rules, physical geometry, movement/action
  budgets and trusted CPU dice. The shared publisher owns head CAS, quota
  reservation, immutable staging, current assignment/owner/epoch checks, journal
  and one durable receipt. Fresh responses carry native transient presentation;
  duplicate recovery returns only the original applied proof, never another
  debit, roll or historical animation. That caller can recover its minimal proof
  after membership loss without receiving a world view or triggering denied
  membership maintenance.
- Native owner scene/character saves can atomically publish validated FROM/route
  metadata for an explicitly bound live epoch. Private owner-charged immutable
  `presentations` objects store accepted routes, not animation frames. The head's
  optional presentation reference is protected by existing fenced maintenance;
  ordinary canonical/settings saves clear stale motion. Complete backups still
  capture canonical campaign, scene and character state, not transient routes.
  Owner/member pause or removal after upload prevents head/cost/receipt
  publication.
- Same-view member deltas carry only current authorized physical routes, omitting
  foreign budgets. Checkpoint, resync, rejoin and changed-view replacement have
  no historical motion. New owner-only `owner-state` and `owner-events` carry a
  full private checkpoint and bounded sparse keyed actor/record/object patches,
  without pretending the owner is a member. Admission is checked before and
  after body IO. One actor/note delta stays below **2 KiB** with more than **1 MiB**
  of unchanged portrait bytes in the full checkpoint; terrain/art is not resent.
- Cloud owner/player renderer Adapters reuse native models, locomotion, camera
  and one terrain owner. They consume streams rather than polling scenes.
  The originating player animates exactly once when SSE precedes HTTP; owner
  reconciliation cannot be suppressed as a local command echo. Player disposal
  hides its world immediately and serializes removal after pending model
  hydration, avoiding stale restoration of removed sprites.
- Owner Start/Pause/Keep Active and Joined-player bootstrap are wired but
  `sharedSessions` stays false pending progressive private artwork/assets and
  full-world acceptance. Ordinary preparation/login never starts a paused game.
  Explicit owner transitions flush pending scene/character work; manual pause
  reports final backup uncertainty separately. Cloud arrival/Undo/door/action
  matrix completion, account/view cache and automatic drain remain later gates.
  Legacy/native paths and the deferred routine-save flash/notice are unchanged.

Verified evidence:

| Gate                            | Verified outcome                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real official SDK/API authority | Final frozen **80/80 access/world cases**, no failure/cancel/skip, **460,966.3552 ms**. Both 2014/2024 off-turn denial and Free Play admission; actual owner/member streams, sparse owner delivery, queued combat steps, competing CAS, same-ID recovery after removal, hostile actor/observer/role/cost, private owner scope/origin/epoch denial with zero body IO, and owner eligibility loss after IO. |
| Other canonical regressions     | The other six directly affected canonical store/immutable/private-assets/quota/portability/process files retain **118 passing cases** on unchanged authority source. Together the corrected/rechecked gates verify all **198 distinct native cases**; the initial two failures and exact correction/recheck are retained below rather than hidden.                                                        |
| Native cloud flight/fall        | Actual 2024 takeoff, airborne step, 10-foot raise and 15-foot fall deliver native owner `fly`/`fall` routes with canonical movement **5/10/20/20 feet**; ground/prone/fall state retained. **1/1 case**, no skips, **18,123.2109 ms**.                                                                                                                                                                    |
| Native/local preservation       | **8 suites / 88 tests**, **119.303 s** with open-handle detection; physical sight, resize/hidden origins, queued native routes, 2014/2024 Free Play, flight/falls, physical dice, actions/Undo and existing receipt behavior preserved.                                                                                                                                                                   |
| Full directly affected app gate | **16 explicit suites / 209 tests**, zero failures/skips, **109.289 s** with open-handle detection. Includes transport/reconnect, saves, scoped public runtime/model teardown, commands, picker/bootstrap, native queued owner steps and both cloud sprite directions.                                                                                                                                     |
| Full JS/CSS/layering            | Zero errors and the unchanged **39 baseline warnings**.                                                                                                                                                                                                                                                                                                                                                   |
| Isolated Linux private runtime  | Exact **23 source/model/manifest hashes**, Node **24.22.3**, UID **1000**, read-only, no network/binds/GPU/ADC, **1 CPU / 1 GiB**, actual native d20 **501 frames / settled face 3**, RSS **261,050,368 bytes**, clean exit **0** and exact owned container removed.                                                                                                                                      |

The production-only runtime check first failed with `ERR_MODULE_NOT_FOUND` for
`cannon-es`. The existing exact **0.20.0** pin was promoted from development to
runtime without changing its version/transitive graph. Only the required native
`d20-gold.glb` was added to the private image allowlist, not a broad asset folder.
The candidate OCI index is
`sha256:a18b3cf98c68f4b56ce3fe7cf1aabb68d51b5156ce70bae1c0090233a55c498b`;
its runnable manifest is
`sha256:a3bab7a75833b6996db38c92c2ad0bab206b6cd07d4bc930bb3c9b018e009b56`.
Only that exact verified image was published to the existing private test
repository and deployed to the existing approved API service, revision
`taverntable-api-test-00006-rdp`. Runtime identity, conditional bucket access,
existing index, min **0** / max **1**, request-based **1 CPU / 1 GiB**, concurrency
**40** and **3600-second** request timeout are unchanged. No extra IAM/API/index
or public frontend was deployed.

The broader canonical recheck exposed an old backward-head fixture that changed
the head generation but not the newly validated command-origin generation.
Keeping both internally consistent preserves its original
`invalid-change-history` refusal rather than weakening production head checks.
The corrected exact SDK case passes. The other initial failure was Firestore
Emulator gRPC **3 INVALID_ARGUMENT: Transaction is invalid or closed** during
four-store identical invitation/acceptance; no broad production retry was added.
That unchanged case passes in isolation and in the final complete **80-case**
access/world recheck. The initial eight-file run recorded **196/198 passing
cases**, zero cancellations/skips, **1,043,504.2437 ms**; its remaining six
files are unchanged and passed.

Real acceptance passed **2026-11-14 04:36:29 UTC** against the exact approved
API image. A managed member received an active foreign turn without the hidden
NPC turn ID and was denied movement; an explicit owner Free Play transition
immediately restored native assigned movement. Its accepted route reached the
owner's private stream; a native owner route reached the authorized player
without foreign budgets/private NPC notes or records. Same-ID recovery had no
motion replay, the real CPU d20 returned its physical trajectory, and canonical
state contained no physics frames. Owner pause closed both streams and released
presence/leases; a new epoch rejoined at the current pose without historical
motion. Existing actual 60-second renewal, interrupted-stream/warm-graphics
reconciliation, journal/private-image/original-receipt and real managed Auth
revocation gates also pass.

Two first live fixture assertions were corrected without changing production:
foreign active turn IDs are intentionally null in the member protocol, and a
published map's permitted display label is not an unassigned NPC secret. The
fixture now verifies actual off-turn availability/command refusal and exact
private NPC note/record exclusion. Both failed runs performed exact cleanup.
Final same-fixture cleanup verified the same **three approved disposable UIDs /
two synthetic campaigns / 17 live object generations** absent at
**04:36:35 UTC**, with existing soft-delete retention and real accounts unchanged.
No real campaign migration, hosted frontend/cutover or deferred save-notice UX
change was introduced. Full cloud-gameplay activation remains gated until
progressive assets, cache/lifecycle safety and complete action acceptance.

### M3-06: account/view-scoped persistent cache storage

The storage Module is verified without activating an offline editor or claiming
current campaign authority from cached state. Checkpoints use the existing
atomic IndexedDB helper in a private database, separate from the public
2014/2024 resource databases. Keys bind UID hash, campaign/schema, member seat/
access generation and authorized view. Each bounded UTF-8 payload retains exact
byte length and SHA-256; reads revalidate both its bytes and participant schema.
A transaction prevents a delayed older snapshot from replacing a newer cached
generation.

Private binary image bytes use native Cache Storage and that same scope/view
namespace. The supplied current participant manifest must contain the reference.
Writes and reads verify MIME type, byte length and SHA-256; cache requests use
synthetic cache-only URLs without query credentials. Stored responses contain
only required integrity headers, never Authorization, cookies or reusable signed
URLs. Explicit checkpoint/image invalidation targets one exact entry rather
than clearing another user's/view's data. Missing entries are ordinary misses;
corruption and unavailable storage fail with typed errors for explicit online
re-download. Cache data is not a new write grant, sole saved copy or fallback.

The SHA-256 mechanism is shared with existing public resource installation and
managed complete-file hashing instead of adding a second implementation.
Dependency pins, public resource database identities and server contracts remain
unchanged.

Verified gates:

- **4 explicit app suites / 53 tests**, zero failure/skip, **2.533 s**, including
  open-handle detection. Five focused cache cases cover persistent reopening,
  UID/access/view isolation, independent invalid-schema refusal despite matching
  disk hash, corrupt binary-body rejection despite matching headers, immutable
  verified bytes, monotonic checkpoint writes and exact entry removal.
- Existing public edition/source installation and cloud save/import/retry/hash
  behavior pass in that same gate. A real official SDK managed browser multipart
  import retains its original caller and receipt (**1/1 case**, zero skips,
  **3,636.6565 ms**).
- An owned native browser page at the explicit demo preview writes a real
  IndexedDB checkpoint and native Cache Storage PNG. Page reload and a fresh
  Module instance recover the verified checkpoint and exact **88-byte** body.
  A different UID or access generation misses. Only the owned synthetic entries
  are deleted and confirmed absent; no account sign-in or other cache is altered.
- Full JS/stylelint/layering: zero errors and the same **39 baseline warnings**.

Progressive first join/private artwork loading, bounded eviction/cache controls,
zero-unchanged-body network rejoin proof and logout/access-change purge remain
`M3-07` through `M3-09`. No backend/image/IAM/index, public frontend, real campaign
or deferred routine-save UX change was required.

### M3-07: progressive join and bounded private cache management

The development player connection now reuses the verified private cache without
turning a stored checkpoint into current authority. Managed state publication
remains synchronous; required current-view artwork has separate readiness and
command admission. The initial view contains only authorized area geometry and
assigned-sheet records. Visible actor/active-character images load first;
other assigned-sheet artwork and permitted areas load on request, never through
an owner workspace or a whole-private-campaign download.

Binary image HTTP binds the captured UID, seat/access generation, live epoch,
view key and immutable image reference. Exact MIME type, length and SHA-256 are
checked; a single initial 401 renews only the captured managed identity/body.
Caller cancellation, account/verification changes and view replacement abort
idle readers. Failed identity observation is typed and redacted. Late old bytes
cannot populate a replacement view or a cleared cache.

Downloaded images decorate native display state through an authorized provider;
they do not enter raw checkpoints, canonical sheet edits or portable backups.
Artwork-only renderer updates preserve existing meshes, physical poses and
in-flight routes rather than rehydrating a saved placement. Existing streamed
acknowledgement, movement coalescing and authoritative combat costs remain
separate from binary image loading.

The user approved a **256 MiB default private-cache target per account/browser**,
adjustable in Settings. UID-wide checkpoint/binary accounting, bounded LRU
eviction and exact UID-only clear are separate from public edition catalogs and
cloud quotas. The active view is protected while loading/playing. Lowering a
target below its protected bytes reports the actual retained usage and temporary
over-budget state; release converges to the new target without evicting the
current screen mid-operation. The application disables private cache IO when
browser-wide coordination is unavailable. Cache schema upgrades leave public
resource database defaults unchanged.

Unavailable storage, corrupt entries, quota/target limits and browser eviction
produce typed, visible recovery. Only current online-authorized image bytes may
replace them. Browser persistence is best-effort and distinguishes accepted,
denied, unavailable and failed results. There is no offline editor, durable
upload queue or local/cloud authority fallback.

Verified gates:

- **12 directly affected app suites / 186 tests**, zero skips, **20.734 s** with
  open-handle detection. The first coupled run had **185 passes / one failure**
  because the new renderer fixture left its own Scout in localStorage. Exact
  fixture-owned character deletion corrected isolation; production authority was
  not changed to conceal that failure.
- **Four distinct actual SDK cases**, zero skips: protected raw/warm image
  delivery and unchanged managed multipart import (**14,189.0025 ms** together);
  native player acknowledgement without another snapshot and two unrendered
  accepted steps forming one continuous route with the final combat budget
  (**20,740.9912 ms** together).
- Native browser IndexedDB/Cache Storage and Settings show the 256 MiB default,
  persist a 128 MiB choice across page reload, account for **1,567 bytes** including
  a real **95-byte PNG**, protect the current view, defer a zero-byte target
  truthfully, then evict to zero when that view closes. The first protection
  probe failed before the loader acquired its current-view handle; the corrected
  loader passes the actual protected-byte/released-eviction check.
- Actual persistence denial reports that the cache may be evicted, without
  retrying or claiming cloud authority changed. Settings clear invalidates active
  work first, clears **1,567 bytes** for its UID, and leaves another synthetic
  UID's **1,569 bytes** untouched. Both exact synthetic namespaces are then
  cleared and verified empty; the test preference is reset to 256 MiB and the
  owned test controls/dialog/subscription are removed.
- Full JS/stylelint/layering: zero errors and the same **39 baseline warnings**.

The owned native browser helper became unavailable when close was attempted;
no successful close is claimed. Its synthetic entries had already been cleared
and confirmed absent. No sign-in/provider/account verification, real campaign,
original local host, backend/IAM/index, public frontend or deferred routine-save
UX was changed. `M3-08` still must prove authoritative warm rejoin with exact
network counts; `M3-09` still owns logout-wide purge and connection-loss safety.
The shared-game capability remains off until the remaining action and migration
acceptance gates pass.

### M3-08: authoritative warm rejoin and measured zero asset-body reuse

Warm rejoin reads a verified checkpoint candidate from the current
UID/campaign/member-seat/access-generation namespace. Its observer/map and
graphic-digest values are request hints only. Candidates are ordered by
most-recent cache use; ties retain IndexedDB enumeration order, and no canonical
generation or live-epoch freshness is inferred. A readable corrupt/stale-schema
candidate is removed with an explicit recovery error rather than silently
searching older authority. Managed rejoin still obtains fresh HTTP and SSE state
using the current constructor access/session, verifies the current view/revisions,
and waits for required artwork before commands become ready.

Currently authorized immutable images can reuse exact historical bytes within
the same UID/campaign across old seat/access/view/session namespaces. The current
manifest must contain the full reference, the historical checkpoint must validate,
and MIME type, byte count and SHA-256 must match. Ordinary scoped `readAsset`
behavior is unchanged. Reused bytes are promoted into the current namespace;
cached grants, sheet records, actors, capabilities and historical routes are never
returned as current authority.

Actual SDK/HTTP/SSE instrumentation verifies the requirement, not a cached UI:

- Cold default join: **one graphic body / 514 JSON bytes** and **one private PNG
  body / 86 bytes**.
- Warm default rejoin: **zero graphic/image bodies, zero asset bytes**, with
  **two fresh HTTP/SSE authority requests**. This is not a claim of zero total
  metadata/wire traffic.
- Other assigned-sheet artwork loads on demand. Corrupt graphics trigger a fresh
  graphic/image download. Corrupt or evicted binary bytes redownload one image
  without retransferring unchanged graphics; stale schemas re-download both.
  A changed current reference downloads its new image, while a rejected observer
  hint triggers fresh unhinted authorized geometry and retains valid image reuse.
- Current member-access, live-epoch and managed-UID mismatches deny readiness and
  issue **zero commands**. Superseded selections/work and cache-clear epochs fence
  late reads/puts. Checkpoints remain URI-free, `scene:null`, image-null and
  history-free. Native acknowledgement without another snapshot and queued steps
  with the final combat budget remain unchanged.

The final four actual SDK cases pass with zero skips in **64,041.5513 ms**.
The directly coupled application/public-resource/renderer gate passes **12
suites / 192 tests**, zero skips, **21.549 s**, with open-handle detection.
Full JS/stylelint/layering pass with zero errors and the same **39 baseline
warnings**. No dependency/runtime/backend/IAM/index, hosted frontend, real
account/campaign, original host or deferred routine-save UX change was made.
Logout/access-change purge and ten-client/full-stable acceptance remain later
gates; full shared gameplay remains disabled until they and the remaining
world-action acceptance pass.

### M3-09: private invalidation, purge and online receipt recovery

Managed account invalidation now notifies dependent private views and awaits
their cleanup during sign-out. HTTP controllers, live transport, loader/selection
versions, image providers and instance-owned protections are invalidated before
private purge begins. `privateStateSettled` covers the accumulated cleanup
promises. Missing browser storage in a Node client is explicitly detected without
claiming a successful browser clear or reviving an old view.

UID purge increments its persistent account epoch; campaign purge increments its
persistent campaign epoch. Checkpoints, asset metadata and Cache Storage bodies
are removed across every historical seat/access/view/session namespace in the
selected UID/campaign. Existing instances retain their first observed epochs,
so late IO cannot adopt a newer purge generation and repopulate it. Native
WebLocks serialize cross-context private cache operations; ordinary close
preserves warm copies, while logout/switch clears the entire superseded UID.
Membership/observer/map/view changes and rejected hints purge the affected
campaign. Public catalogs, other UIDs and acknowledged canonical backend data
remain separate.

Network loss blocks new mutations immediately. Only original already-submitted,
unacknowledged UID/body/command IDs remain in memory. Reconnecting forces managed
identity/current-state reconciliation, not a connectivity-only editing reset.
Same-command receipt recovery validates the original campaign/access/session and
canonical outcome. An ended-view recovery confirms only that receipt, marks it
recovered and requires explicit reopening; it never restores the ended world.
There is no offline editor, durable upload queue, auto-merge or local fallback.

Necessary owner/player feedback changes hide superseded private UI, protect
unconfirmed commands against navigation, and expose original-command recovery.
The routine-save flash/centered card/normal phase text and positioning/timing
remain unchanged, as requested. A new verification-error catch initially
conflated identity unavailability with account changes. The bounded correction
handles expected `CloudAccountError` with a generic unavailable message and
logs/rethrows unexpected errors without private provider details.

Verified gates:

- **21 directly related application suites / 272 tests**, zero skips,
  **25.161 s**, open-handle detection. Managed account/linking, owner/assigned
  sheets, cache controls, native player/renderer, source catalogs and recovery
  callers retain their directly coupled behavior.
- **5/5 actual SDK/HTTP/SSE cases**, zero skips, **84,451.93 ms**. Private bytes
  after switched UID and logout are **zero**. Original sheet/world commands make
  **two identical-body attempts** each but increment their canonical character/
  scene revisions **once**; offline world command count is **zero**.
- Unchanged-scope warm rejoin still transfers zero graphic/image bodies and
  retains two fresh authority requests. Purged membership scopes deliberately
  re-download current authorized bodies. Native acknowledgement and queued
  movement/final combat budgets remain unchanged.
- A native browser uses a real **95-byte PNG**, IndexedDB and Cache Storage with
  browser-wide coordination. After an older instance has observed its campaign
  epoch, a peer campaign purge denies its later write with `cache-invalidated`.
  Campaign and UID purge leave zero bytes. The initial fixture only observed
  account usage, not that campaign, and had the wrong fence expectation; adding
  the actual scope observation corrects the reproduction without modifying
  production cache behavior. Exact synthetic cleanup confirms zero checkpoints
  and assets. Its owned helper became unavailable on close; no successful close
  is claimed, and no alternate route is used to regain it.
- Full JS/stylelint/layering: zero errors / same **39 baseline warnings**.

No real account sign-in/provider/verification/password, real campaign, dependency,
backend/IAM/index, frontend rollout, original local-host data/key or deferred
routine-save UX change was made. Ten-client convergence, full stable acceptance
and the remaining world-action gates remain `M3-10` and later migration work.

### M3-10: ten managed clients and full stable acceptance

The actual SDK/HTTP/SSE acceptance uses one private owner observer and nine
distinct managed-UID member connections, each with its own seat/assigned actor.
Cold member admission is deliberately three at a time. All ten transports are
simultaneously live during steady-state command acceptance; this does not prove
ten simultaneous cold handshakes or change the four-stream-per-UID limit.

All ten converge to owner canonical **generation 29 / scene revision 7 /
character revision 21**, matching visible poses and each authorized native
budget projection. Serialized public outputs exclude private NPC/foreign-sheet
notes, foreign IDs/budgets and owner snapshot references. Five durable
`world.command` receipts represent three moves/two rolls and one **15-foot**
movement debit. A deliberately concurrent CAS has one winner and one explicit
409/stale-revision loser with no rejected-ID receipt; the loser makes one
fresh-authority/new-ID retry. Three duplicate acknowledgements, including
lost-reply recovery, have `outcome:"duplicate", presentation:null`. Original
lost-reply recovery uses two byte-identical body/scope attempts.

Latest reconnect returns a generation-29 checkpoint, not missed movement.
Duplicate physical frames, missed routes, replayed presentations and new offline
world requests are **zero**; persisted `publicScene.updates` remains empty.
One current membership removal clears state/artwork/command authority and leaves
**zero private bytes**. Two stale cache puts reject `cache-invalidated`; two
current-read probes reject 404/campaign-not-found. Closing all clients leaves
zero transports, live connections, in-flight work and convergence waiters.

Parent independently ran:

```powershell
node --test --test-concurrency=1 --test-name-pattern='^(ten managed SDK clients|private SDK lifecycle|authoritative cold and warm SDK rejoin|warm SDK rejoin|a cloud player retains|the cloud player connection publishes)' tests\cloud\WorldCommands.test.js
```

With the existing explicit demo-emulator settings, **6/6 cases pass**, zero
failures/skips/cancellations, **168,610.1096 ms**; ten-client acceptance takes
**85,670.6501 ms**. The five coupled cases retain UID-switch/logout purge, exact
original receipt recovery, zero-body warm rejoin, explicit cache recovery,
native acknowledgement and continuous queued movement/final combat budgets.

Latest parent ten-client measurements:

| Phase                                     | Canonical generation / scene / characters | Dispatch to all ready (ms) | First to last state (ms) |
| ----------------------------------------- | ----------------------------------------- | -------------------------- | ------------------------ |
| Cold admission, three members at a time   | 24 / 2 / 21                               | 15,730.46                  | 13,912.35                |
| Deliberately staged concurrent CAS winner | 25 / 3 / 21                               | 8,607.97                   | 18.35                    |
| Fresh-authority CAS retry                 | 26 / 4 / 21                               | 2,792.61                   | 807.38                   |
| Lost-reply committed command              | 27 / 5 / 21                               | 2,301.19                   | 19.22                    |
| Latest-only reconnect                     | 29 / 7 / 21                               | 1,025.25                   | 1,748.76                 |

Admission includes batches and CAS includes a staging barrier. Reconnect's
first-to-last spread includes peers' earlier delivery during the disconnected
period. None is a hosted acknowledgement p95 or 200 ms RTT result.

RX response bodies total **425,141 bytes**: graphic JSON **4,626**, PNG **774**,
presentation JSON **115,562**, and state/envelope **304,179**. This includes
**90,568** owner canonical-verification bytes; subtracting only those gives
**334,573**. Physical-frame JSON **99,345 bytes** is a subset of presentations,
not additional traffic. TX **9,119 bytes / 52 serialized request attempts** is
counted before injected offline failures, not confirmed wire transmission.
Counters cover cold join through verification, fault probes and lifecycle
closure. HTTP headers, TLS, Auth SDK and backend SDK traffic are excluded.
State/envelope bytes are neither metadata-only nor idle traffic. CPU dice frame
counts make presentation byte totals vary between runs; the retained agent run
measured 414,317 RX bytes, while the independent parent run above is the latest
exact measurement. Hosted idle/load/cost thresholds remain `M4-12`/`M4-13`.

The full existing `npm run test:stable -- --verbose=false` gate passes
**307/307 suites / 4,006/4,006 tests**, **1,908.483 s**, exit zero, no skips,
cancellations or detected open handles. Full JS/stylelint/layering passes with
zero errors and the same **39 baseline warnings**. Only the SDK convergence
test and its shared participant-storage test helper change; production source
is unchanged.

An exploratory emulator 500 during a fresh CAS retry produced only redacted
unexpected-campaign-error/campaign-request-failed evidence. Its root cause was
not captured or proven; a temporary diagnostic probe, the final unprobed SDK run
and independent parent acceptance did not reproduce it. Harness corrections
addressed CommonJS loading, batched cold admission and valid empty pre-observer
budgets, not production retries or blanket failure suppression.

Eight owned scratch logs and disposable fixtures were cleaned. Original hosts
3002/57591, the preview and emulators remain intact. Both `sharedSessions` and
`roomVisits` remain false: arrival/placement, cloud Undo/door/action/emote
completion and lifecycle drain are not silently enabled by convergence proof.
No real account/campaign, dependency, deployment/IAM/index, frontend/cutover or
deferred routine-save UX change was made.

### M4-04: safe pause drain and exact final-source backups

Every durable live-to-paused transition records the captured canonical source
as an existing private pending `backupJobs` entry in the same transaction.
Explicit owner end, natural status/admission, presence expiry/cleanup and an
allowed canonical publication at the deadline use that same seam. The accepted
publication's new head, not its old head, supplies the source. Its paused epoch,
canonical metadata and immutable scene/character references remain independent
of later paused preparation. This schedules server-side backup work, not an
offline client edit/upload queue or a new terrain owner.

Pause needs no complete-file allocation or backup-state validation. Existing
pending-job queries already protect captured source objects from fenced cleanup,
so no new index or alternative protection system is added. A natural worker
verifies the original source and promotes its owner-scoped claim before IO.
Unchanged automatic sources skip a copy. An explicit owner final confirmation
reuses a matching original job at the current canonical generation, preserving
same-job recovery and clearing its original failure rather than falsely leaving
an error behind after another copy.

Permitted paused status, assigned-sheet and owner backup requests run
bounded pending work through the existing owner-billed complete-file pipeline.
Status membership/eligibility is rechecked after IO; a removed member receives
404 rather than an earlier authorized result. Work does not return private backup data. Ordinary
pause acknowledgements, canonical saves and terminal SSE closure do not wait on
an after-response worker. Automatic SSE expiry leaves a durable pending source
until a natural online request supplies execution time. There is no permanent
timer, shutdown-only durability, endlessly reopening paused lobby or fixed total
game-duration cap.

The four focused actual SDK regressions cover:

- Immediate owner pause before the five-minute routine interval, followed by
  another paused sheet edit: the completed file equals the entire exact captured
  export, including active combat and a deliberately adjusted movement budget.
  End replay creates no extra point; an unchanged later end makes no copy.
- A scene HTTP reply held after actual durable publication: pause happens while
  that caller is unacknowledged, then its original receipt acknowledges once
  with one scene submission. Two owner/member streams terminate with null views,
  no member lease and no reopening after explicit reconnect plus **1.25 s**.
  Another active campaign's stream accepts a generation advance.
  Short member wake encounters both storage-preparation and file-copy failures;
  current paused status stays successful, private failure/source status survives,
  and original owner confirmation recovers the exact complete file.
- An accepted sheet publication at the **60-minute** inactivity boundary and a
  fresh-worker wake two minutes after the original **15-minute** disconnected
  grace: both remain paused at the stored deadline, retain their final source
  despite later permitted preparation and give members no backup export grant.
- Membership removal while a paused-status request holds actual backup IO:
  the removed member receives **404/campaign-not-found** after completion,
  while the already accepted owner backup still completes with its exact source.

The feedback loop first failed at the precise missing immediate final source.
The next slice failed because paused member status did not evaluate work.
Preparation failures then exposed `pending` instead of recorded failure status;
the existing backup failure handler now covers preparation as well as file IO.
Finally, explicit owner confirmation exposed a stale original error after a
different copy succeeded; exact matching-job reuse fixes that recovery.
These are root corrections, not retries that hide a failed lifecycle check.
The IO race also first returned the stale authorized result; status revalidation
closes that new seam without processing backup work on rejected world commands.

Verified gates:

- **34/34 directly coupled native lifecycle/paused-permission/complete-backup/
  source-cleanup cases**, zero skips/cancellations, **259,353.0883 ms**. Twenty
  rolling points, capacity failures, captured retries, due/cold competition,
  owner billing, edition/source rules and canonical resources remain intact.
- **6/6 actual managed SDK/HTTP/SSE convergence/warm-rejoin/private-loss/native
  cases**, zero skips/cancellations, **167,650.6666 ms**. Ten simultaneous
  steady-state UIDs still converge at generation **29 / scene 7 / characters 21**;
  five world receipts debit once, duplicates/replay/offline commands/revoked
  private bytes/open transports remain zero. Valid warm asset bodies remain zero
  with two fresh authority requests.
- **3 directly coupled application suites / 67 tests**, **2.049 s**, with
  open-handle detection. Full JS/stylelint/layering: zero errors / the same
  **39 baseline warnings**. The earlier M3-10 full stable gate is not represented
  as a new full-suite run for this backend-only change.
- Local **taverntable-cloud:m404-20261114-r2** is rebuilt and checked.
  OCI index **5b5bf940bf5fd5b6341e7b0efc2386ed6416ac16ce70c38d4acade24818e34c3**;
  runnable manifest **bdced8ff6f6330dd83a1116ad86a21d6ae1f043d47d8e3457e21a76ebf6ddc9d**.
  Linux Node **24.22.3**, UID **1000**, read-only/no-network/no-mount/no-credential/
  no-GPU, **1 CPU / 1 GiB**. All **23** actual source hashes match the worktree;
  readiness is 200, anonymous/forged account/live/world/event requests are 401,
  private paths are 404, sixteen packs total **15,131,548 bytes**, a 16MP image
  validates, native d20 settles over **501 frames** at face **3**, and graceful
  exit is zero. Its exact owned validation container is removed; image retained,
  not pushed. This is runtime parity, not hosted load/sleep/cost acceptance.

Only the authority/router and existing SDK test fixture/cases change. New
final-acceptance disposable campaigns and their objects are verified absent;
all eight UID-specific namespaces used by these fixtures are deleted and checked.
Earlier snapshots and other fixtures are not swept or overwritten.
The original local hosts, preview, emulators and real linked/verified account remain
unchanged. No frontend, capability, dependency, live deployment/IAM/index or
deferred routine-save UX change is made. Actual container-kill/overlap lifecycle
acceptance remains `M4-05`.

### M4-05: actual container replacement and overlap

The owner enabled Docker Desktop host networking and restarted. The exact
bounded connectivity probe then reached the original loopback emulator hub and
its Auth/Firestore/Storage endpoints; its container was verified removed.
Emulators were not rebound to the LAN or moved, and no existing service/key/data
was replaced. An initial inbound test listener bound only to the container's own
loopback and was unreachable from Windows; using `0.0.0.0` inside the test
container, matching the production entry, fixed that fixture-only issue.

The existing backend-lifecycle fixture now has two Adapters. Its default remains
an actual native child process. An explicit existing local image selects actual
Linux containers, without pulling or mounting source/credentials. The test-only
bootstrap uses the image's real Admin/authority/router/immutable-object/backup
code against the explicit demo emulators. It does not enable emulator variables
in the production entry or weaken runtime configuration guards.

Reproduction, after the usual explicit demo-emulator environment:

```powershell
$env:TAVERNTABLE_CLOUD_LIFECYCLE_IMAGE='taverntable-cloud:m404-20261114-r2'
node --test --test-concurrency=1 tests\cloud\BackendLifecycle.test.js
```

**15/15 cases pass**, zero failures/skips/cancellations, **103,020.799 ms**.
The runner exits naturally without forced exit. Across the cases, **29 exact
containers** are force-killed, including fixture teardown; each actual kill
checks exit **137**, not OOM, followed by exact-ID removal. Every worker verifies
**11 current runtime source hashes**. Inspected configuration is local-engine,
UID **1000**, read-only root, **1 CPU / 1 GiB**, no mounted source/data, developer
credential file or GPU. The retained M4-04 R2 image and its prior 23-source-hash
runtime smoke are unchanged; nothing is pushed or deployed.

Acceptance covers:

- Kill after immutable uploads but before canonical publication: no head/receipt
  advances prematurely; the original body/ID recovers one committed result.
- Kill after commit but before announcement, and after a deliberately lost
  successful reply: the original durable receipt and one ordered journal event
  survive replacement without a second revision or resource debit.
- A current member reconnects through a replacement to the latest checkpoint.
  Reconciliation contexts are initial/current-only, not missed-route playback;
  final owner pause terminates the managed retry loop.
- The **55-minute** warning and original **60-minute** inactivity pause survive
  replacement and historical control replay. A real SSE worker's original
  presence record remains after SIGKILL; abrupt stream loss is explicitly
  consumed as `cloud-stream-unavailable`, and cold wake pauses at its stored
  lease expiry plus the original **15-minute** grace, never restart time.
- Two overlapping container workers prepare different changes from one head:
  one winner and one stale-revision denial; two concurrent original-ID replays
  return the original receipt without changing canonical authority.
- A captured final-source uploader dies after its real file upload. A fresh
  worker completes that same file/job/receipt even after later permitted paused
  preparation, preserving that later canonical head and its separate pending
  changed-state backup. An overlapping worker can also finish the same original
  job while the first uploader is held/killed, without duplicate history/files.
  Delayed older manual backups cannot reorder history or move the baseline back.
- Missing intent, stalled object cleanup and interrupted multipart imports
  remain explicit failures or same-intent recovery, never success-shaped
  publication or a new campaign chosen by runtime memory.

The default native-process Adapter also passes **4/4 focused cases**,
**48,175.3215 ms**, zero skips/cancellations: both new overlap/final-source cases,
real abandoned SSE presence and original lost-reply recovery. Full JS/stylelint/
layering has zero errors and the same **39 baseline warnings**. This test-only
milestone does not represent a new full stable-suite run.

The first broad run passed all lifecycle behavior but failed one import fixture's
parallel cleanup DELETE with `ECONNRESET`. Its exact two remaining synthetic
campaigns, four objects, eight account namespaces and Auth UID were subsequently
removed and verified absent. Cleanup now serializes exact-generation deletes
and verifies absence, without adding a production retry or suppressing unknown
errors. The transport reset's underlying cause is unproven.

Container stderr also exposes pinned Storage SDK `PassThrough` listener warnings.
A bounded trace identifies Node pipeline setup through
`teeny-request/build/src/index.js:461`; the warnings are not suppressed and no
dependency workaround or listener-limit increase is added. Their origin is
recorded, not claimed fixed; sustained memory/load remains a hosted gate.
Temporary trace instrumentation and the owned oversized-output scratch are
removed after retaining this redacted evidence.

All container-mode campaign object generations, eight UID-specific namespaces
and synthetic Auth accounts are verified removed. Native-process fixture
persistence otherwise retains its existing behavior. Original local hosts,
preview and emulators remain intact; the real linked/verified account and
campaigns are unchanged. No production code, dependency, capability, frontend
deployment/cutover or deferred routine-save UX change is made.

### M4-07: public art provenance before packaging

The existing Firebase configuration has no Hosting public directory, and the
frontend remains pinned native ESM rather than a new framework/bundler. No public
output or deployment is created by this review. Catalog notices and the existing
CC0 nature/forest records remain available for the eventual explicit allowlist.

Current character catalog paths include the mannequin, Knight, Mutant, Erika
Archer, Paladin J Nordstrom and Yaku J Ignite. Several entries explicitly record
Mixamo names. No license/notice/README file is present in the animated-sprites
or Items directories. The official
[Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
permits royalty-free characters/animations in personal and commercial games.
Adobe's [distribution FAQ](https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400)
also distinguishes games from distributing raw assets. This is not a blanket
permission to publish every FBX as a reusable asset package, nor proof that every
local character/clip originated from Mixamo. Owner source confirmation and the
intended browser distribution must be resolved without silently stripping
animated gameplay or disguising raw assets to bypass licensing.

The built-in d20 GLB actually contains attribution metadata:
**D20-Gold Edition [FREE]**, author **Don42** (now displayed as VertexDon), source
[Sketchfab model](https://sketchfab.com/3d-models/d20-gold-edition-free-fde4f1f7e93f4ba0bf632613188eb4bd),
**CC-BY-SA-4.0**. Its source page identifies textures/materials from FreePBR and
separately discusses mesh commercial use and credits. Those terms need their
own notice/provenance treatment; the earlier broad inventory is not evidence
that this mesh has no license. The model's NoAI notice is not bypassed: no asset
content is uploaded to an image model, dataset or external processing service.

Owner input is requested before choosing the unchanged-art allowlist versus
rights-cleared substitutes. Existing assets, canonical save IDs, rendering,
dependencies and all public/cloud services remain unchanged. No public rollout
or source-of-truth approval is implied by deciding this packaging prerequisite.

The owner subsequently confirms **all characters and animation clips came from
Adobe Mixamo**, including the mannequin, and selects **keep current artwork and
resolve permissions first**. The supplied tree source is
[Remos isometric trees](https://remos.itch.io/isometric-tree-sprites); its creator
page specifies **CC-BY-3.0** with credit **Bleed - remusprites.carbonmade.com/**,
permits project use with attribution and prohibits reselling/claiming the asset
collection. A generic older itch.io search link is not a license for unspecified
files and is not treated as one.

Runtime tracing distinguishes these old 2D sprites from the current 3D family.
The tree palette explicitly removes the legacy image arrays and uses model keys.
Most current OBJ trees have the Quaternius CC0 kit notice, while the separate
forest kit has Asset Quest CC0. However, palms and tropical banana/monstera/fern
palette and biome entries actively resolve to **MZRa_Pack_M02P.fbx** and its
textures. No matching local notice or recognized embedded source/license URL is
found in that **2,075,868-byte** file. Public lookup did not identify an exact
source; licenses of merely similar tropical packs are not evidence. The Remos
2D sprite license does not establish this 3D pack's provenance.

The original [FreePBR terms](https://freepbr.com/about-free-pbr/) confirm free
noncommercial game/3D use and prohibit redistributing source texture sets; a
separate paid grant covers commercial use. These are not the terms of the
different FreePBRTextures site. The die's model page itself separates mesh and
third-party texture permissions, so the embedded mesh attribution is not used
as an unsupported blanket texture grant. Commercial texture use beyond those
terms would require matching permission; the exact tropical pack's source/license
remains unverified. No artwork or runtime code is changed.

The owner's next links identify the
[Quaternius Stylized Nature Megakit](https://quaternius.itch.io/stylized-nature-megakit)
for at least some 3D assets, consistent with the bundled Quaternius CC0 notice,
and the exact older gold-die source already embedded in the current GLB.
This confirms the die's identity, not a request to replace it with the newer
remake or an unrestricted commercial texture grant. Retain the current file
and its separate model/texture conditions.

The owner believes the remaining art is free to use, but no exact source or
license has yet been established for the active MZRa tropical family. Its first
import commit identifies only tropical plants; it supplies no source URL.
No new license is inferred from that belief, the generic itch.io catalog or a
different kit's CC0 notice. In accordance with the owner's keep-artwork choice,
that pack is neither removed/replaced nor publicly packaged. `M4-07` stays
pending; the verified **47/65** milestone is unchanged.

[itch.io game assets](https://itch.io/game-assets) is saved as a future-sourcing
reference, as requested. Each future listing still needs its own specific
source/license record; the catalog itself is not a blanket grant. No additional
asset is downloaded or imported during this review.

### M4-07: owner-authorized local frontend package

The owner explicitly directs continuing without the tropical family's formal
license record for now and retaining the artwork. This supersedes the earlier
local-packaging pause; it does not convert an unrecorded license into CC0, grant
unrestricted FreePBR commercial rights, or approve a public deployment. The
package records that distinction and retains the known original conditions.
No replacement artwork or additional model download is introduced.

`build:cloud:frontend` produces a new separate package, never the repository root.
The source HTML's native-ESM entry graph is parsed, including static/dynamic
module imports; undeclared/computed or escaping imports fail explicitly. Only
reachable application modules/styles, explicitly selected runtime model/image
families, pinned resource bodies and notices are copied. Source-kit authoring
archives, raw configuration files, backend/admin code, tests, SQLite and campaign
exports are not copied. Symlink traversal, malformed runtime/catalog metadata,
hash/length mismatches and overwriting an existing output fail before a published
package is acknowledged. There is no application framework rewrite.

Production-cloud mode is mandatory. The input Firebase file is validated as
public web configuration, not copied as a raw file; only that curated runtime is
injected into the shell with safe JSON escaping. Its values are not printed.
The generated Hosting configuration serves only its `public` directory, with
no Cloud Run/HTTP/API rewrite, Firestore/Storage deployment settings or local
campaign authority. Root/index redirects select a content-addressed release
while preserving query strings and browser fragments.

Every release file has an exact byte length/SHA-256 in
`frontend-manifest.json`. Versioned paths are immutable; the stable entry and
manifest are not cached as immutable app state. The manifest declares runtime,
participant and private-cache compatibility versions, not write authority.
`--previous` retains the current release from one verified preceding package;
older releases are deliberately not copied indefinitely. Both retained shells
must preserve the same explicit account/API runtime. Unknown schemas, missing
shells, forged local fallback or invented deployment approval fail verification
even if file hashes were recomputed. Deployments spanning older clients still
need the later explicit drain/reload plan, not an unbounded-compatibility claim.

Reproduction from the migration worktree:

```powershell
npm run build:cloud:frontend -- --firebase-config src\config\FirebaseConfig.json --api-origin https://taverntable-api-test-zp7b3oizna-uw.a.run.app --out build\cloud-frontend\<new-output-directory>
npm run build:cloud:frontend -- --verify build\cloud-frontend\m407-local-20261114-v1
node --test --test-concurrency=1 tests\cloud\FrontendPackage.test.js
```

For a subsequent local build, pass `--previous` with the preceding verified
package directory. No dependency installation, cloud deployment, IAM/index/
billing change or live API request is performed by these commands.

The actual retained package is
`build\cloud-frontend\m407-local-20261114-v1`, release
**c4f0402a35145ee8e7b9b765ac6889001d7f2279618fa49a0c5e56af4aa9bee9**.
Its **607 versioned release files / 289,219,649 bytes** are:

| Group                                         | Files |       Bytes |
| --------------------------------------------- | ----: | ----------: |
| Reachable application modules/styles          |   311 |   3,728,968 |
| Character models and animation clips          |    85 | 142,888,492 |
| Vegetation runtime models/textures/notices    |   173 | 122,292,876 |
| Resource manifest, packs and combined notices |    18 |  15,177,150 |
| Original gold die                             |     1 |   5,095,908 |
| Shell, construction icons and other notices   |    19 |      36,255 |

The root public manifest adds **191,507 bytes**, for an actual public-tree
inventory of **608 files / 289,411,156 bytes**. The generated **932-byte** Hosting
configuration is outside that public tree. The CLI's `files`/`bytes` counters
describe the versioned manifest entries, not the extra root metadata file.

All **158 exact-case configured character/clip/model/texture references** are
present. Nine pinned CDN module URLs remain external; the package does not
silently vendor or upgrade them. These are stored-output bytes, not a claim that
every connecting player downloads the whole package or that hosted cost fits
the budget. Existing progressive private images and edition-local public caches
remain separate.

Verified gates:

- **5/5 native packaging cases**, no failures/skips/cancellations,
  **2,198.9255 ms**. Deterministic output, explicit whitelist exclusions,
  current/previous/third-release retirement, corrupt/unsupported retained
  packages, secret-bearing/local/emulator configuration, computed/escaping
  imports, catalog integrity, undeclared output and overwrite denial pass.
  A focused red test exposed a verifier that trusted hashes around a local
  fallback or missing shell; current runtime/shell/provenance validation fixes
  that core verification gap without changing application behavior.
- **6 coupled application suites / 81 tests**, **2.916 s**, with open-handle
  detection: runtime configuration, account login, public Firebase settings,
  public resource loading, native player rendering and canonical client callers.
  Full JS/stylelint/layering: zero errors / same **39 baseline warnings**.
  The earlier full stable gate is not represented as a new full-suite run.
- Actual pinned **Firebase CLI 15.11.0 Hosting**, not a mock HTTP server:
  the root redirect is **302**, query strings survive, the versioned entry is
  **200**, **607/607** HEAD routes have the exact declared lengths/immutable
  policy, **30 prohibited root/versioned HTTP paths return 404**, and tropical,
  character and die body round trips match their exact size/SHA-256.
- A native browser preserves the root fragment after redirect. With the API
  origin deliberately blocked, production-cloud managed sign-in UI appears,
  with **zero API requests, zero failed landing resources/page errors and no
  local fallback**. This proves shell/sign-in availability, not completion of
  live Google/password/provider acceptance or hosted scale-to-zero timing.
- Native WebCrypto/IndexedDB installs the 2014/2024 core catalogs with
  **2,025 / 2,296** actual entries. The initial fixture incorrectly supplied full
  manifest rows instead of explicit selected-source pins and missed registering
  an unsuccessful database for cleanup; only the fixture is corrected.
  The exact old fixture database and both corrected synthetic databases are
  removed, with zero synthetic databases remaining.
- All **nine** configured tropical FBX nodes load as their own mesh; the
  character and original die load as two meshes each, with **39 decoded
  textures** and **zero protected API requests**. Owned geometry, materials
  and texture caches are disposed. No canonical/private campaign data is read
  and no real account sign-in/provider/verification/password action is performed.

The Windows-native Hosting probe exposed two tooling issues rather than a
package success: an absolute Windows public path does not behave like a relative
project path in the pinned static server, and `glob-slasher` converts URL patterns
to backslashes, which the Hosting matcher then fails to match. A minimal
relative-path server serves files but still misses redirects/headers; the exact
normalization/matcher result verifies the cause. No dependency, `node_modules`
or production configuration workaround is applied. The actual successful gate
uses the unchanged pinned CLI in a local Linux container with a relative
configuration, read-only public/tool/config mounts, no home credentials/GPU,
1 CPU/1 GiB and only a localhost-published Hosting port.

The native FBX loader emits its existing unsupported-material warnings and
requests five embedded metallic/opacity maps absent from the source pack.
Every one is verified missing in the repository and **404 in the original
19410 preview as well**. They are not omitted build inputs or fabricated
placeholder successes. All selected model textures above decode; no unrelated
model/texture repair is included, and no warning-free rendering claim is made.
The browser's bounded resource timing buffer/early event observer alone missed
these responses; the actual Hosting request log supplies the evidence.

Both owned Hosting fixtures/containers and generated configuration directories
are removed; the bounded Linux helper exits zero. The owned browser helper
becomes unavailable at close, so no successful close is claimed or alternate
route used to regain it. Its synthetic databases and owned graphics resources
were already cleared. Original local hosts, preview, emulators, real linked
account, canonical campaigns and both gameplay capability gates are unchanged.
No routine-save UX change is made. Public Hosting/API test rollout, live fixture
expansion and cost/performance acceptance still require the separate M4 gates.

### M4-08: explicit first-hosted-pilot approval

The owner approves the existing-project hosted pilot and up to **10 disposable
accounts / 2 synthetic campaigns**, and asks to record the tropical assets as
free use. Their status is accurately **owner-reported free use**: the original
creator/license remains unrecorded, no new creator grant or CC0/MIT label is
fabricated, and all original attribution/conditions remain intact. The notice
now records the bounded hosted-pilot instruction rather than the earlier
local-only packaging instruction. No artwork changes.

Approved targets are the existing `taverntable-489d5` personal project, its first
default Hosting website, the existing private `taverntable-test` image repository
and existing `taverntable-api-test` service in `us-west1`. This is not a separate
Auth/database environment or a source-of-truth cutover. Real campaigns and
original local hosts remain untouched; existing real-account UID, sign-in
providers, password and verification are preserved. No additional IAM privilege
or billing-setting change is authorized. The reported $25 alerts are not a hard
cap, and exact generation cleanup does not erase seven-day soft-delete billing.

Read-only inspection before rollout confirms:

- The owned ready service remains revision `taverntable-api-test-00006-rdp`,
  its original image and **100% latest-revision traffic**, not a foreign/manual
  traffic target.
- Both service/template limits remain **min 0 / max 1**, **1 CPU / 1 GiB**,
  request-based CPU, no startup CPU boost, **concurrency 40 / 3600 seconds**.
  The only four runtime variables remain explicit production mode, project,
  private bucket and the exact `https://taverntable-489d5.web.app` origin.
- Runtime project roles remain only `datastore.user` and `firebaseauth.viewer`,
  with conditional campaign-prefix object access. The image repository has no
  public binding and no service-account key is downloaded.
- Existing platform invocation already permits browser transport; protected
  application routes still require Firebase identity/access. The image-only
  update fence preserves the existing IAM fingerprint and never repairs/adds an
  invocation grant implicitly.
- The exact Hosting domain is already authorized for Auth, and Google plus
  email/password are already enabled. No provider/domain configuration change
  or real account mutation is performed by this inspection.
- An anonymous public-site check returns **404 / Site Not Found**. No earlier
  TavernTable public frontend is being replaced.

The rebuilt local API candidate
`taverntable-cloud:m409-20261114-8fcb9250` has OCI index
**cc93b46bdf920af5c727751f427de7f43e66d91ac444d68b530d01149326004e**
and runnable manifest
**32b8667f196a5ff87b29703bfd4d350bfbb9577d8f0a5ca5b71d36422789a070**.
Linux Node **24.22.3**, UID **1000**, read-only/no-network/no-mount/no-credential/
no-GPU validation passes all **23 current source hashes**, readiness/auth/private
file boundaries, both catalogs, 16MP decoding, native d20 **501 frames / face 3**
and graceful exit zero. The exact validation container is removed.
The image publisher pins only this verified digest and preserves the prior
image/tag for rollback; it uses temporary CLI OAuth Docker configuration that
is removed afterward, not downloaded service-account keys or global Docker
credential changes.

The updated owner-notice frontend candidate is
`build\cloud-frontend\m409-hosted-pilot-20261114-v1`, release
**b2c6177a01a1930c820b89240246c965f5ef21236b386183a074a8be744bac18**,
with **607 versioned files / 289,219,817 bytes**.
All **5 native package contracts pass**, zero skips/cancellations,
**2,391.4253 ms**, and the prior local release still verifies. The compiler's
`deploymentApproved:false` remains intentional: a compiler does not issue
operator approval. The actual owner authorization is this separate M4-08
record, not a mutable build-manifest permission bit.
Actual image rollout, public Hosting publication and fresh hosted acceptance
are recorded only after their separate `M4-09` verification.

### M4-09: published pilot, live regressions and owner sign-in

The approved pilot is now published at
[the default Hosting URL](https://taverntable-489d5.web.app). This is still the
existing personal project/test service, not a new isolated Auth/database
environment, production migration or source-of-truth cutover.
**M4-09 is complete; the checklist is 50/65** after the owner's normal browser
sign-in and campaign-home confirmation below.

The exact validated `cc93b46b...26004e` OCI index was published only to the
existing private image repository and the image-only service update succeeded:
current ready revision **taverntable-api-test-00007-vft**, same HTTPS URI and
100% latest traffic. The updater preserves the existing configuration and IAM
fingerprint without silently adding/repairing invocation grants. Min 0/max 1,
request-based CPU, region, identity, origins and other approved settings remain
unchanged.

Live acceptance found and fixed two issues before accepting the package:

- A fresh **HTTP 422** off-turn movement denial remained an unconfirmed pending
  client command, so the subsequent valid Free Play command was blocked.
  The existing first-attempt definitive-denial list now includes 422. A denial
  after an earlier lost reply still retains the original UID/body/ID; it cannot
  clear uncertainty or authorize a replacement. Two focused public HTTP-store
  regression cases reproduce the fresh-command failure before the fix and
  protect original-only recovery afterward. The coupled client/player suites
  pass **66/66 tests in 2 suites**, **1.575 seconds**, with open-handle detection.
  This is a frontend SDK fix; no backend runtime behavior or privilege changed.
- Actual Hosting **302** responses inherited the destination versioned HTML's
  one-year cache policy, despite the broad `no-store` rule. Read-only inspection
  confirmed correctly uploaded URL globs, not the Windows emulator glob defect.
  The builder now puts a final `no-store` override on versioned entry HTML.
  Stable redirects/metadata and entry HTML are uncacheable; other versioned
  assets remain one-year immutable, with unchanged content-addressed URL bytes.
  The original root `no-store` HTTP check fails before this correction and
  passes after it; that acceptance check was not relaxed.

An earlier unlabeled `1 !== 0` reconnect/pause assertion could not be reproduced
during the accepted M4-09 run. It was not declared fixed at that milestone.
The later M4-10 investigation below reproduces and identifies the deliberately
aborted sibling transport's independent cleanup, not historical replay or a
production authority failure. Useful failure labels remain; no production retry
or wait for lease expiry is introduced. Temporary diagnostic logs are removed.

The complete, unfiltered current API run passes at
**2026-11-14T22:47:59.753Z**, against the deployed `00007-vft`/`cc93...` API and
the corrected current client SDK:

- Managed identities, paused assigned sheets, private exact image bytes,
  campaign-local access, owner billing and journal retirement.
- Actual **65-second** stream-renewal interval, current durable UID leases/
  presence, no meaningful-activity extension from reads or presence.
- Deliberately interrupted real HTTPS transport, fresh same-UID/epoch/scope
  reconciliation, unchanged graphics omitted, no historical motion replay,
  owner pause ending retries and releasing leases/presence.
- Real off-turn denial followed by Free Play player admission; one five-foot
  debit, player-to-owner and owner-to-scoped-player native walk presentations,
  same-ID replay without repeated motion, CPU physical d20 and clean new-epoch
  checkpoint without historical routes.
- Original assigned-sheet receipt recovery after membership removal without
  access revival, and actual bearer revocation closing the managed stream on
  renewal, without reconnecting or retaining leases/presence.

That run's exact cleanup verifies **3 disposable accounts / 2 synthetic
campaigns / 19 live object generations** removed at
**2026-11-14T22:48:05.660Z**. Seven-day object soft-delete retention remains
unchanged and can still be billable; logical deletion is not physical erasure.

The final artifact is
`build\cloud-frontend\m409-hosted-pilot-20261114-v4`, content release
**f24257b18afd7f53684908d9e930a6728edd079a710b9b9c8647ff3fd931b664**:
**607 versioned files / 289,219,694 bytes**, plus the
**191,507-byte** stable manifest, for exactly **608 local public files /
289,411,201 raw bytes**. The first published `v3` had the same public content
but the unsafe redirect cache configuration; `v4` corrects only the generated
Hosting configuration. Earlier candidates remain preserved, not overwritten.
Latest native package contracts pass **5/5**, zero skips/cancellations,
**2,535.1945 ms**; scoped existing formatting/lint and whitespace checks pass.
The compiler still does not grant deployment approval or invent a formal
tropical asset license.

The explicit Hosting-only deployment uses the existing pinned CLI/project and
the generated config, never the repository root or an API rewrite. Current
finalized Hosting version is **7dc92269d2c03cf5**, release
**1794696901322000**. Actual public verification passes:

- Root and `/index.html` **302** to the correct content-addressed entry with
  `Cache-Control: no-store`; entry HTML and stable manifest are also `no-store`.
- **608/608** declared public HEAD routes, all `nosniff`; **606** non-HTML
  versioned asset routes have the one-year immutable policy.
- Six exact body length/SHA-256 comparisons: stable manifest, entry HTML,
  corrected client SDK, gold d20 GLB, tropical FBX and an animation FBX.
- **30** private/server/raw-config/test/database paths return **404**, with no
  Hosting-to-API rewrite.
- The platform reports **610** files because Firebase adds exactly
  `/__/firebase/init.js` and `/__/firebase/init.json`. An actual bounded file
  listing proves all 608 declared files present and no other extra paths.
  These managed bootstrap files expose only the expected public Firebase SDK
  configuration, matching the approved project/key/domain; no credential
  values are logged. This is separate from the local raw-package byte count.
- A fresh native browser reaches the sign-in dialog on the real HTTPS website,
  loading **250 resources with zero Cloud Run API requests**, in a secure
  context with no controlling service worker. This proves landing independence,
  not actual scale-to-zero timing, performance or cost acceptance.

A separate real managed-account action probe uses **one approved disposable
UID / zero campaigns**. An unverified bearer gets 403, a real Firebase-generated
verification code is checked/applied, reload/fresh token gets API 200, and real
Firebase password reset rejects the old random password while admitting the
replacement under the same verified UID. A consumed reset code is rejected.
Both action links return to the exact approved Hosting origin.
This passes at **2026-11-14T22:59:52.191Z** with verified cleanup at
**22:59:53.484Z**. Reserved `example.invalid` fixtures mean **actual email
delivery was not tested**. Codes/passwords stay in memory; no custom-token
impersonation, real-user password/verification/provider change or credential
logging is involved.

The automated browser could not complete its inaccessible Google popup;
cross-origin-opener polling warnings alone did not prove an application failure.
The owner instead completes normal Google sign-in in their own Chrome and
reports the deliberate private-pilot access restriction. With their separate
explicit approval, a single precondition-fenced operator action at
**2026-11-14T23:43:57.724Z** creates only the absent app eligibility record for
that existing verified, non-disabled Google/password-linked account. Read-back
confirms eligibility; before/after Auth identity/provider/verification
fingerprints are unchanged. No Auth write, password change, provider linking,
custom token, new UID, IAM change or campaign-role grant is performed. Account
identifiers are not added to repository files or documentation.

After refreshing the hosted website, the owner explicitly confirms
**"Campaign home opens"**. Their existing email/password was not manually
retested; the real disposable-account password, verification and reset-code
protocol checks above remain the corresponding automated evidence, without an
inbox-delivery claim.

The owned automated verification page was unavailable when closing was attempted;
no successful close is claimed and no alternate route is used to regain it.
The owner's separate normal Chrome session is not closed or modified.

Original local hosts/data/keys remain untouched. Full gameplay activation,
hosted permission/load/cost gates and real-data cutover remain separate tasks;
routine-save flash/toast UX remains deferred until after M5-11.

### M4-10: hosted permission and identity gate complete

The approved current API passes **49 actual HTTP role cases**, using only the
three whitelisted disposable UIDs and two synthetic campaigns:

- Canonical characters/world/settings, seats, backup metadata/current export
  and retained backup files are owner-only. A member owning another campaign
  gains no global owner/DM privilege.
- Assigned sheets/images exclude the private NPC; an unrelated UID cannot use
  another seat's captured headers or request the unassigned image.
- Originally valid captured owner scene/character/invitation/assignment/live
  commands are rejected for other UIDs, not merely rejected as malformed input.
- Forged/unsigned/emulator-style credentials fail; cookies and query credentials
  are not authentication. Query tests use only a non-credential sentinel.
- Direct Firestore and Firebase Storage requests with a valid end-user Firebase
  token get 403; the known existing private object is also inaccessible through
  anonymous GCS. Application access does not make the bucket/database public.

The full run also passes actual 65-second lease renewal, native Free Play/
bidirectional routes/physical dice, interrupted rejoin, original receipt recovery
after removal, and actual bearer revocation. A real, originally signed disposable
ID token is held **only in memory** until its literal expiry, with no scheduled
application traffic during that wait. At **2026-11-15T01:42:48.752Z**, Admin
verification confirms `auth/id-token-expired`, the original token gets API 401,
and a freshly managed token for the same unchanged UID gets API 200.
Automatic exact cleanup verifies **3 UIDs / 2 campaigns / 20 live object
generations** removed at **01:42:55.533Z**, with soft-delete retention unchanged.

The earlier reconnect-count failure is now reproduced and measured. **34 ms**
after the current connection's terminal acknowledgement, the only remaining
lease belonged to the **original deliberately aborted transport**, with
**73,104 ms** left before expiry. Its presence/lease explicitly clear by
**1,728 ms**, not by expiration. The server acknowledges cleanup of its own
stream, not a previously aborted sibling's independent cleanup. No exact claim
is made about whether network cancellation or transaction backoff accounts for
that measured delay.

The operational gate now still requires the acknowledged **current** lease to
be absent immediately. Any residual must be an identified old aborted lease,
must outlive the five-second observation deadline, and **all raw leases and
presence must clear within 5,000 ms**. Actual full runs exercise that branch at
**1,113 ms** and **775 ms**. Empty historical updates, scope/epoch, no activity
renewal and terminal pause assertions remain unchanged. No production code,
retry, expiry filtering or backend delay is added.

One matrix prototype also over-specified the exact cache header string.
`private, no-store` on private downloads is correctly accepted as a stricter
valid `no-store` policy; the gate checks the directive rather than requiring
the absence of `private`. This is not a cache-policy relaxation.

Read-only inspection verifies the current tested image/revision, only the four
approved production variables, min 0/max 1 at both levels, 1 CPU/1 GiB,
request-based CPU/no boost, concurrency 40/3600-second timeout, no emulator or
credential mounts, and exactly the original runtime project roles plus the
campaign-prefix/inventory conditional bucket grant. No IAM repair is performed.

Actual current-revision stdout/stderr inspection covers **2,058 entries /
11 bounded pages**, with zero seeded private-note, private-key, bearer/JWT,
synthetic email-body or image-data-URL matches. Raw logs are not printed.
A prior larger read returned a transient provider 500; the smaller read-only
query succeeds without application retry or logging configuration changes.
The final quota gate passes at **01:50:48.557Z**, using one whitelisted
disposable UID and one actual synthetic campaign:

- A declared 299-entry recent request-counter fixture admits the 300th request,
  denies the next with 429 and correct `Retry-After`, and leaves its counter
  unchanged on denial. A declared expired-window fixture recovers.
- Exact seeded **20 GiB** storage and **10-owned-campaign** counters deny with
  the repository's **409** state-conflict codes, not 429 throttling. The storage
  denial cannot publish a canonical change, and no second campaign is created.
  Original storage/ownership fields are restored with update-time preconditions.
- **Four actual SSE transports** for one UID are admitted; the actual fifth
  gets `stream-limit-reached`/429. Owner pause closes all four with terminal
  frames and zero remaining leases/presence.

The counter fixtures are explicitly seeded, not claims of 300 real network
requests or ten actual campaigns. A prototype used device time for expired
counter entries, but the device was about twelve seconds ahead of API time:
its nominal 61-second-old entries were only about 49 seconds old for the server.
The fixture now uses the API's actual `Date` header. No server/system clock or
quota policy is changed; temporary diagnostics are removed.
Final quota cleanup verifies **1 UID / 1 campaign / 2 live object generations**
removed at **01:50:50.468Z**. This completes M4-10; the checklist is **51/65**.

### M4-11: verified alerts and measured platform observability complete

Both `cloudbilling.googleapis.com` and `billingbudgets.googleapis.com` were
disabled. The owner explicitly approves enabling **only those two APIs** for
inspection. They read back enabled; project IAM binding fingerprints remain
identical. Monitoring and Logging were already enabled.

The linked billing account is open, enabled and **USD**, but both its unscoped
and explicit current-project budget listings contain **zero budgets**. The
reported existing $25 alerts were therefore not configured for this project.
No other financial account, recipient address or unrelated budget amount is
printed or added to repository files.

The owner separately approves one new alerts-only budget. A single POST creates
it, followed by exact read-only recovery/verification at
**2026-11-15T00:46:59.152Z**:

- **USD 25 / calendar month**, current project only, all its services, credits
  included.
- **50%, 90%, 100% actual** and **100% forecast** email thresholds, with existing
  billing-administrator/user and project-owner recipients enabled.
- No custom email channel, Pub/Sub topic, spend cap, shutdown hook, billing-link
  change or IAM-role grant.

Current official discovery uses `notificationsRule`, not the older
`allUpdatesRule`. The optional omitted ownership enum means unspecified, which
the API documents as equivalent to `ALL_USERS`. An initial overly exact
read-back assertion stops on that harmless omission; recovery lists/reads the
original uniquely named budget and proves **exactly one**, without submitting
another creation request. Budget alerts remain notifications, not a spending
cap or guarantee that notification delivery is instantaneous.

Existing metrics are queried rather than adding paid/custom metric resources.
Actual historical test/operator measurements include:

| Scope | Measured observation |
| --- | --- |
| API, 24-hour window | 1,877.48 billable instance seconds; corresponding 1 CPU and 1 GiB allocation-time metrics; 1,295 requests |
| API network, same window | 63,106,789 sent / 41,487,809 received bytes across network kinds, not assumed to be billable internet egress |
| Firestore, same window | 39,460 document reads; 4,103 creates/updates; 1,391 deletes |
| Firestore RPCs | 44,377 requests mirrored in legacy/new monitored resources; **not 88,754 unique requests** |
| Private bucket | 3,239 method/status-classified requests; 4,847,853 sent / 392,925 received bytes; region verified as US-WEST1 |
| Soft-deleted bytes | 146,391-byte regional sample at 00:50; retained/billable categories are not declared erased by logical cleanup |
| Logs | 2,360,447 ingested bytes in the window; default application retention 30 days, required audit retention 400 days locked; analytics disabled |
| Hosting | 5,223,900 transfer bytes in the window; 431,678,198 storage bytes sampled separately |
| Preserved images | 21 manifest records / 7 tags; no image deletion |

These are observed historical test totals, **not per-save attribution, a
30-hour forecast or ordinary-command p95**. Firestore API and document metrics
have legacy/new resource mirrors; only one family may be counted. Hosting
monthly gauges sample every eight hours with up to 70-minute ingestion delay
and must not be summed naively across different-time domain samples.

Registry accounting remains explicitly bounded rather than guessed: the
repository API reports **266,873,454 bytes**, summed image metadata reports
**1,135,814,229 bytes** with repeated layers, and an older Monitoring sample
reports **2,622,323,836 bytes**. These are not treated as interchangeable or
summed into a bill. Retention/rollback images remain preserved; readiness cost
work must disclose the discrepancy and use a conservative bound if unresolved.

The isolated real per-save probe is now verified end to end. It uses a quiet
lead-in, API-Date-calibrated UTC measurement minute, five validated paused sheet
saves, raw regional Firestore counters after the documented four-minute lag,
and matching client/provider HTTP totals to reject unrelated application traffic.
Both cohorts verify fresh scoped reopen and unchanged paused live state:

| Provider measurement minute (November 15, UTC) | Logical saves / actual HTTP requests | Document reads / writes | Mean reads / writes per save |
| --- | --- | --- | --- |
| 01:53-01:54 | 5 / 5 | 433 / 37 | 86.6 / 7.4 |
| 02:09-02:10 | 5 / 5 | 419 / 38 | 83.8 / 7.6 |

These are actual operation counts for this scoped paused-edit workload,
including its authorization/maintenance work, not assumed universal constants.
The first prototype continued an old owner baseline after five additional member
edits; its later live-scene change was correctly rejected as stale. The isolated
measurement itself was already valid. The operator action now ends after that
measurement instead of continuing the unrelated stale baseline, and its complete
rerun exits zero at **02:14:46.437Z**, with exact cleanup of
**3 UIDs / 2 campaigns / 14 live object generations** at **02:14:52.345Z**.

Separate live SDK callback timestamps measure the owner validated durable
response, player operation readiness and remote authoritative delivery, not
animation completion. The public player call waits for fresh SSE authority
after its validated store receipt; its whole duration is not a pure receipt:

| Ordinary movement sample | Validated durable receipt | Player SDK operation-ready | Remote SDK publication |
| --- | --- | --- | --- |
| Assigned player to owner | Not separately timed | 2,326.32 ms | 2,239.10 ms |
| Private owner to scoped player | 1,532.19 ms | Not separately timed | 1,952.77 ms |

The independently measured owner backup status is `saved`, with no recorded
error. Native routes, privacy and new-epoch/no-replay checks pass; exact cleanup
verifies **3 UIDs / 2 campaigns / 18 live generations** at **02:03:58.604Z**.
The small samples are **not a p95, controlled-200-ms or M4-12 performance pass**.
The player observation remains useful readiness evidence, but M4-12 must measure
the validated store receipt itself before applying the two-second target.

This completes M4-11; the checklist is **52/65**. No production campaign
migration, new runtime privilege, always-on service or automatic billing shutdown
is authorized. Hosted lifecycle/performance and the measured 30-hour cost report
remain separate gates.

### M4-12 progress: durable movement latency verified, lifecycle acceptance pending

The short hosted performance loop now measures the SDK-validated **store receipt**
before the public player call waits for current SSE authority. It reports SDK
operation readiness and all-ten-current delivery separately. Thirty accepted
ordinary moves use one private owner observer and nine separately authenticated,
assigned member connections on the same small flat board. Every committed
revision and canonical pose converges; raw member packets exclude the private
NPC and other assigned sheets.

Actual RTT is measured before and after the cohort, not inferred from a delay
setting. Acceptance requires a 200 +/- 10 ms median and samples within
180-235 ms at both ends. The test-only link compensates only measured **injected
outbound wait** when calculating the return delay; it never subtracts transport
or server processing. A slow-fake-server red/green case proves that distinction,
with all nine local delay, streaming and cancellation cases passing.

| Comparable real ten-UID cohort | Validated receipt median | Receipt p95 | Maximum | Network |
| --- | --- | --- | --- | --- |
| Original authority baseline | 2,520.95 ms | 2,768.99 ms | 2,819.15 ms | Actual RTT gate passed |
| Reserved-object renewal, R3 | 1,880.04 ms | 2,113.75 ms | 2,118.36 ms | Actual RTT gate passed |
| Batched head/membership, R5 | 1,698.62 ms | 2,028.92 ms | 2,636.36 ms | Actual RTT gate passed |
| Batched stored-seat lookup, R6 | **1,628.83 ms** | **1,822.65 ms** | **1,933.96 ms** | **203.14/202.90 ms pre/post medians** |
| Same movement admission after lease-timer correction, R7 | **1,401.84 ms** | **1,674.45 ms** | **1,681.49 ms** | **203.82/202.49 ms pre/post medians** |

R6 passes the unchanged **p95 <= 2,000 ms** target, with all thirty receipts
below two seconds. Its public SDK operation-ready p95 is **2,677.96 ms**,
not the receipt latency and not animation completion. R1/R2/R4 attempts whose
actual post-cohort network guard failed are not accepted performance evidence.
An unproven concurrent-reservation-read experiment was reverted rather than
retained on speculation.

Three bounded changes remove repeated work without weakening admission:

- Fresh change-history maintenance probes only the oldest retained document.
  If it is eligible by the existing 1,000-change/24-hour rules, the same
  authorized transaction still reads the original bounded 100-row prune batch.
  Corruption, ordering, legacy floors and exact time/count boundaries remain
  explicit.
- Canonical publication still reserves its **complete** scene/character/motion
  candidate set before uploads. The existing before-lookup and
  after-missing-lookup/before-write callbacks now renew an already charged
  object's activity epoch/writable window in one fresh transaction. Caller
  scope, live epoch, owner eligibility, bucket/schema, bytes and cleanup claims
  remain checked. Missing or uninitialized reservations use original full
  admission; a 24-hour-held missing lookup must regain quota before recreating
  bytes and still cannot publish its expired original command. Final CAS,
  references and acknowledged receipt publication are unchanged.
- Expected member scope batches the current campaign head, that UID's
  membership and the hinted seat in one metadata read. Stored records still
  decide ownership and access. A hinted seat is reused only when the validated
  membership names it; otherwise the actual stored seat is read and the original
  stale-scope denial remains. The ordinary owner path adds no membership read,
  and no authorization result is cached across transactions.

The full affected usage-limit/cleanup module passed **22/22** cases after
reservation renewal. The wider final member/seat/assignment/privacy/native
selection passed **46 other cases** but exposed a nondeterministic physical-d20
timeout in its ten-client case. Test-instance-only diagnostics located the
existing bounded non-settling throw in `D20Dynamics.advance`, not metadata
admission. The convergence fixture now uses the existing real `PhysicalDice`
engine with the same repeatable LCG seed used by container validation; production
physics is unchanged and no fake frames, numerical fallback or production retry
was added. The final fresh-grant/history/real ten-client selection passes **6/6**
in **84,996.5373 ms**, including the ten-client case in **72,663.2398 ms**.
The new public fresh-grant read-budget regression is red at four/three round
trips and green at two, retaining wrong-seat-hint, removed-membership and
stale-owner-scope denials. Earlier six coupled native SDK/movement/CAS/pause
cases also pass. These are targeted results, not a new full-stable-suite claim.

All temporary diagnostics are removed. Exact image
`sha256:83c6558111d0d6886d479acd9784a5896396cb186ef42080038107d28b45e0a3`
(runnable manifest
`sha256:5367daf48c819877993c788d922021f9cc58726fe735b4d1536de1accd4dd82a`)
passes the existing isolated non-root, read-only, no-network production check:
23 current runtime hashes, one CPU/1 GiB, sixteen resource packs, a real 16-MP
image, 501 physical d20 frames, authenticated/private boundaries and exit zero.
Its measured validation RSS is **258,961,408 bytes**, not a hosted peak-memory
claim. Only the image field of the approved test service was changed; revision
`taverntable-api-test-00013-gbd` retains the same region, limits, origins and IAM.

The first bounded lifecycle probe then added one second synthetic campaign
and owner stream: still ten UIDs, eleven total streams across two campaigns.
After three minutes it reached the idle byte/no-new-app-request checks, but
failed the exact current-generation/readiness comparison before warm rejoin.
The next safe-status probe proves all ten remain ready immediately after the
second-campaign setup, then enter error during idle. Its 82 bytes per client
include closure, not a healthy-idle payload acceptance result. No readiness
check was relaxed.
The complete failed probe still verifies exact cleanup at
**04:15:59.654Z** of **10 UIDs / 2 campaigns / 83 live object generations**,
without changing the real account.

#### Coalesced presence renewal diagnosis and correction

The minimized real control is one owner stream, which remains ready for
180 seconds without another application request. Adding one different-UID
assigned member sharing that campaign reproduces the failure at
**179,346.05 ms**: the owner receives the explicit terminal code
`live-presence-expired`. Both UIDs and all owned fixture bytes are cleaned.
This identifies lease renewal, not a permission denial, immediate cross-campaign
effect or malformed heartbeat. Heartbeats are the existing three-byte SSE comments.

The transport used a fixed 60-second renewal interval while presence writes
coalesce for 60 seconds under a 90-second lease. A peer/previous renewal can
shift the shared timestamp so a renewal correctly skips the write just before
the coalescing boundary, but waiting another full minute then exceeds the
retained expiry. A public transport fake-clock regression shifts the shared
timestamp by one millisecond: the original code closes during three minutes
(red), despite unchanged valid identity and live authority.

The correction preserves the existing cadence, coalescing and lease limits.
It retains the **actual returned presence result** and schedules the next
authenticated renewal from the earlier UID/presence expiry with the original
30-second headroom and 60-second maximum delay. Clock, malformed/expired
deadlines, identity, live epoch and current role/seat/access remain verified.
There is no broad client retry, heartbeat-triggered write, silent fallback or
meaningful-activity extension. In-flight-renewal cleanup and the independent
55-minute transport deadline are preserved.

The regression and coupled account/live/SSE gate pass **3 suites / 65 tests**
in **1.395 s**, with open-handle detection. Seven actual SDK stream, owner,
coalesced-presence, revocation, final-backup and 55-minute-warning/keep-active
cases pass **7/7**, **43,933.4121 ms**. The unchanged isolated container gate
passes for exact image
`sha256:a0ffa1318f0a5002c7c5c2035efe14bb1798d4741c523919721c25d4a12f1d66`
(runnable manifest
`sha256:6e3b2e2a14440049c8d077fb5d4b2a0338628310225cded0559b14a6ef53f9e7`);
the approved image-only update produces `taverntable-api-test-00014-p7g`,
without configuration or IAM changes.

The original real two-UID reproduction now remains **ready for 200,136.32 ms**
on that exact image, with both owner and player still current and **zero new
application HTTP requests for either UID**. Cleanup at **04:45:42.851Z** verifies
**2 UIDs / 1 campaign / 2 live generations**, with no real-account change.
The next real ten-UID cohort also passes the same thirty-move latency gate on
R7, with **1,674.45 ms p95**, **1,681.49 ms maximum** and the valid measured RTT
shown above. SDK operation-ready p95 is **2,462.39 ms**, still a separate value.
All ten remain ready/current after **180,007.38 ms** without a new application
request, transferring **21 heartbeat-body bytes each**, about **7 B/min** rather
than the 2-KiB/min limit. This is measured healthy continuity, unlike the earlier
closure-inclusive byte count.

The initial warm test incorrectly required both a snapshot GET and SSE. With
an explicit observer the existing production connection intentionally skips
that GET; fresh authenticated SSE admission and its validated current checkpoint
provide authority. The harness now verifies that actual requirement, exact
current UID/epoch/generation, command readiness, no historical motion and zero
unchanged graphic/image bodies instead of adding a gratuitous poll to satisfy a
request-count proxy. Full warm/long-duration/cold-wake acceptance remains pending.

**M4-12 remains open; the checklist remains 52/65.** The short latency pass
does not stand in for actual idle continuity, warm zero-body rejoin, real
55/60/15-minute boundaries, managed long-stream rotation, scale-to-zero or
authorized-sheet cold wake. The online-only design, both original local hosts,
gameplay capability gates and deferred routine-save UX remain unchanged.

#### Hosted disappearance and approved client-originated liveness

The actual R7 long run subsequently verifies owner Keep Active at
**05:48:38.404Z**, the second campaign's natural warning at **05:53:39.022Z**
and inactivity pause at **05:58:40.832Z**, with exact authoritative pause
deadline **05:58:24.493Z**. All ten managed identities and streams rotate;
the first campaign remains live for **3,693,320 ms**, beyond one hour.
There are **59** hosted memory samples, 04:59-05:57 UTC, with maximum
distribution mean **250,568,704 bytes**, below the existing 1-GiB limit.
These are component results, not an instantaneous peak or a completed M4-12.

The run stops at its restarted second-campaign disconnect check. A minimized
plain-Fetch reproduction, without injected latency, closes locally in
**0.4474 ms** but leaves server presence and its UID lease active after
**95 seconds**, including another server renewal. Local cancellation therefore
does not establish server-side disappearance on this reproduced hosted path.
This is not a claim about every browser or proxy. Exact cleanup completes at
**05:59:11.734Z** for the ten-UID/two-campaign run and **06:05:52.486Z**
for the one-UID/two-campaign reproduction. No real campaign is changed.

The owner approves client-originated liveness within the existing authenticated
HTTP/Fetch-SSE design and publication of updated pilot frontend/backend packages:

- Public SSE commits a version-2 presence connection before exposing its random
  channel ID in `X-TavernTable-Live-Connection`. The ID is ephemeral, not cached
  campaign authority.
- Captured-UID/seat/generation/epoch POST controls use bounded 512-byte JSON
  bodies. ACKs every **25 seconds** refresh last-client-seen proof with a
  **90-second** lifetime and **60-second** durable-write coalescing. Server
  renewal cannot advance proof to server time or revive an expired channel.
  Heartbeats, ACKs and reconnects never extend meaningful activity.
- ACK requests still share the **300 requests/rolling minute** limit.
  Precharged per-runtime/UID budgets reserve at most eight admissions for a
  60-second spend window. They remain durably charged for another full rolling
  minute, so consuming late cannot escape the global limit. Cached consumption
  rechecks eligibility without a per-ACK quota write; lost/unused capacity is
  conservative, not silently refunded.
- Best-effort close has an independent **five-second** bound. Same-worker close
  waits for the physical owner and final resource cleanup; cross-worker close
  removes owned durable presence but never prematurely frees another worker's
  UID quota lease. Missing ACKs bound an orphaned physical request by its stored
  client-proof deadline.
- The client validates the exact channel/receipt and stops ACKs, deadlines and
  authority on failure or closure. ACK requests have a ten-second bound and
  cannot overlap. Terminal server closure does not send a redundant close RPC.
  Expected network/authentication close failures are redacted warnings with
  proof-expiry fallback; unexpected failures are not swallowed.

Native validation exposed a concurrent-cleanup race: the transport registry
discarded its physical owner before its asynchronous presence/lease cleanup
finished, while the close route could start another presence transaction.
The emulator records transaction-lock timeouts followed by an invalid/closed
transaction for the observed close-route 500. A deterministic resource-ownership
regression is red before retaining that owner through cleanup. Explicit close
now first joins that scoped physical owner, then verifies durable removal.
Wrong-scope close cannot terminate it. The original adjacent warm-rejoin cases
now also require successful close responses on their healthy network.

The final local coupled gate passes **4 suites / 122 tests**, **1.924 s**,
with open-handle detection. A physical-stream fake-clock case verifies closure
at the last **90-second** client-proof deadline despite successful server lease
renewal. The actual HTTP/scoped-close and two adjacent warm SDK cases pass
**3/3**, **49,453.1958 ms**, without the previous unknown close error.
Earlier native proof/legacy/SDK selection passes **5/5**,
**25,853.1943 ms**; shared-rate/new-budget/legacy-300 selection passes
**3/3**, **40,052.1702 ms**. Changed-source formatting, lint and layering pass.
These are targeted results, not a new full-stable-suite claim.

**Publication is complete; final hosted acceptance remains pending.** Committed
source `5a9ceb10d18ff67818990025d3a1aece12f33466` passes normal hooks with an
unchanged validated tree. The new exact OCI index is
`sha256:de4bab754dfcf6083b55f6f10c918027d96eae136ec90e6ea71e0d4bfe4ee0c3`,
runnable manifest
`sha256:a3bbf2742cc93d4813500bf93a15845396ce9e3e04dcb660bd9fad4c70519989`.
The original isolated non-root/read-only/no-network production check passes:
23 runtime hashes, one CPU/1 GiB, sixteen packs, a real 16-MP image,
501 physical-d20 frames, private/authenticated boundaries and exit zero.
Its **260,706,304-byte RSS** is local validation, not a hosted peak.
The approved image-only update produces `taverntable-api-test-00015-rgg`,
with existing region/settings/origin/IAM and 100% latest traffic preserved;
actual readiness returns 200.

The approved existing default Hosting website now uses
`build/cloud-frontend/m412-client-liveness-20261115-v2`, release
`4217765d8a3ae47bc9b73da679e71a40ead90616e008df963040439ec9a13c42`.
It also retains the prior compatible immutable release, so old public asset
URLs and the old entry shell remain available. There are **1,215 files /
578,826,850 bytes**, including the **381,812-byte** stable manifest and both
release trees; a new browser does not download the old release as well.
Hosting version `ef7ac3c61b967953`, release `1794727250263000`, is published at
**07:20:50.263Z**. The previous version `7dc92269d2c03cf5` remains a rollback.
Actual public manifest and seven critical client/HTML/notice bodies hash
exactly; redirects, manifest and entry HTML are no-store, other versioned
assets are immutable for a year, and four private paths return 404.
Compiler `deploymentApproved:false`, truthful unrecorded tropical-license
provenance and both gameplay capability gates remain unchanged.

The original plain-Fetch prior-B-epoch/managed-refresh/new-B-close reproduction
now passes on R8. Explicit close takes **250.3135 ms**. B's real summary stays
at zero and its UID lease is absent at 0/5/10/30/95 seconds, with a stable
disconnect timestamp and exact 15-minute grace; A remains ready.
The hard-loss control keeps one real upstream SSE request open even after the
local reader cancels, while blocking only B's ACK/close/reconnect traffic.
Without fake metadata deletion, that held request terminates with
`client-presence-expired` after **90,310.8218 ms**. One ACK, one close and five
reconnect attempts are blocked; the server releases B's presence/quota and
leaves A as the sole UID lease and ready stream. Meaningful activity is
unchanged. The redacted close warning is the deliberately blocked-network
case, not an unexplained server error. Exact cleanup at **07:26:23.413Z**
removes **1 UID / 2 campaigns / 4 live generations**, preserving the real
account and bucket retention.

The first ACK-inclusive ten-UID probe verifies **180,006.7328 ms** of healthy
idle continuity. Every measured A participant transfers **1,575 bytes**:
**21 SSE + 742 outgoing ACK + 812 incoming ACK bytes**, or **524.9804 B/min**,
with seven real ACKs each. The owner's seven additional clock-campaign ACKs
are explicitly excluded from A's per-participant result. There is no scene
polling. Warm rejoin takes **1,528.8485 ms**, downloads zero unchanged image
and graphic bodies, and obtains one fresh validated SSE checkpoint without
a redundant snapshot GET.

That probe is **not accepted overall**. Its thirty-command subset has
**1,745.6254 ms p95 / 2,218.4365 ms maximum**, but all **35** ordinary
receipts, including the five cost-window moves, have **2,218.4365 ms p95 /
2,894.9881 ms maximum**. Both slow receipts remain in evidence. The first
cost-window move performs due complete-backup work; it is not relabeled as an
excluded bulk upload. Separately, the strict provider-minute gate sees **27**
requests versus **26** client/logged ACKs in the control minute and stops.
The work minute has **33** actual requests, 28 ACKs plus five moves.
The earlier warm SSE really ends at **07:32:50.182Z**, not as a ghost during
the 07:34 control minute. The provider discrepancy is not silently rounded
away or called successful attribution. Exact cleanup at **07:41:09.752Z**
removes **10 UIDs / 2 campaigns / 90 live generations**.

Before any retest, the fixed stronger sample is declared as **100 ordinary
cohort moves plus five cost-window moves**, with the same **p95 <= 2,000 ms**
bound. All prior R8 slow samples remain, and the cumulative R8 distribution
must also pass. The sample size is not adaptively increased again on failure.
This tests the five-percent tail over more continuous play without speculative
production backup-scheduling changes. To isolate minute counters from ACKs
right at their collection edges, only the cost-window ACK dispatches receive
a three-second guard on either side of each minute boundary: at most six
seconds of added ACK wait, bounded by the existing ten-second request deadline.
Ordinary commands and their representative 200-ms network timing are not
delayed or adjusted; no guard wait is subtracted from any receipt. The idle
and warm measurements above use the unmodified normal ACK cadence.
The strict per-minute provider/client count assertions remain unchanged,
and future raw counter observations are persisted before checking them.

The first fixed hundred-move retest has **1,871.2143 ms p95**, but is rejected:
its final actual RTT median is **187.019 ms**, below the unchanged 190-ms
floor. Stable physical RTT and local controls identify variable Windows timer
overshoot, not improved network latency. An 80-ms timeout takes about 94 ms;
`Atomics.waitAsync` has the same problem. The test-only link now uses one
isolated worker deadline queue, waiting out only its final timer quantum
without blocking client IO or changing global OS timer/clock settings.
A deterministic coarse-main-loop regression is red at **196.2582 ms** of
injection for a 160-ms budget, then green with precise header/body timing.
All **11** streaming, cancellation, concurrent-deadline and slow-server cases
pass. Twenty-one actual ready-endpoint probes measure **200.9888 ms median /
194.73-204.60 ms range**, with no managed fixtures. Server processing is never
subtracted; no application or deployed-image code changes for this correction.

The precise hundred-move cohort passes its initial/final RTT and receipt
checks, but its provider probe again fails the old metric comparison:
raw Monitoring HTTP buckets are **28 / 31**, while client and actual Cloud Run
request logs independently show **30 / 30**. Deferred ACK batches really arrive
at **03.49 seconds** after the boundaries; this is not a hidden extra request or
a failed guard. Equal calendar-event counts cannot be required of that different
minute-counter representation. The raw metric values and failed probe remain.
Cleanup at **08:26:16.596Z** removes **10 UIDs / 2 campaigns / 217 live generations**.

The corrected verification binds every synthetic HTTP request to a unique
noncredential User-Agent marker and its actual provider request log. It requires
exact identity, method, path, status and completion-minute agreement, rejecting
missing, duplicate, foreign or mismatched operations rather than merely comparing
aggregate counts. Raw Monitoring HTTP buckets remain separately reported.
The three public-contract tests include all those negative cases. A minimized
two-UID/one-campaign real probe remains ready for **200,117.6676 ms** and
verifies all **six** requests in one complete minute one-to-one; cleanup at
**08:38:55.331Z** removes both UIDs, the campaign and two live generations.
These are operational measurement corrections only, not a relaxed p95 target,
source/IAM change or completed long-lifecycle gate.

Before accepting M4-12, complete the stronger new-runtime latency/provider
gate and real lifecycle/zero-instance/cold-sheet gates.
Idle payload must include outgoing ACK JSON, incoming ACK JSON and SSE bodies,
remaining below **2 KiB/minute/participant**, with no scene polling.
Provider control/work windows must count ACK HTTP separately from gameplay and
remeasure operations/network costs. The R7 no-ACK numbers below are historical,
not the new protocol's acceptance measurements. No infrastructure, IAM, billing,
real-source cutover, capability gate or deferred save-notice change is approved
by this liveness work.

### M4-13 worksheet: measured costs, acceptance pending M4-12

This is a **draft cost/readiness worksheet**, not a completed M4-13 gate or a
production approval. R7's hour-long component results are recorded above; its
disconnect failure requires the approved client-proof update and new hosted
measurements before acceptance. The owner-approved budget is **USD 25 per calendar month,
alerts only**, not a spending limit.

#### Actual paired live-work observations

The current exact R7 revision has ten managed UIDs, one owner/nine member
connections on the measured board, and one additional owner stream on a second
synthetic campaign solely for the independent natural inactivity clock. The
background measurements therefore conservatively include **eleven streams and
two campaigns**, not ten separate billed instances.

After an API-Date-calibrated quiet lead-in, five accepted assigned moves occupy
one declared provider minute. All five client requests match the actual Cloud
Run request counter; no application polling occurs in the control/ingestion
wait. Raw regional document counters are read after their documented lag.

| November 15 UTC minute | App HTTP requests | Firestore document reads | Document writes | Run sent bytes, all network kinds |
| --- | --- | --- | --- | --- |
| 05:03-05:04, unchanged control | 0 | 1,202 | 41 | 574,468 |
| 05:04-05:05, five accepted moves | 5 | 1,747 | 64 | 3,123,657 |

Paired increments are **109 reads / 4.6 writes per accepted move**; the gross
work minute is **349.4 reads / 12.8 writes per move**, including its background
and opportunistic work. These are measurements of this workload, not universal
per-command constants. Tiny app heartbeats do not imply zero backend lease/watch
traffic or zero Firestore cost.

The work minute also records **7 WriteObject**, **49 successful metadata reads**,
**7 metadata NOT_FOUND** and **38 object reads** in the exact private bucket.
The model conservatively charges all 94 read/metadata attempts as Class B and
the seven writes as Class A. Backup work already included in that minute is
not added as a second operation charge. The quiet Storage minute emits no
samples; that absence is not relabeled a measured zero.

One backup-due observation is slower: the five validated receipts are
**2,799.85 / 1,347.20 / 1,412.85 / 1,383.66 / 1,338.08 ms**. It is not discarded.
Together with all thirty moves in the same live run, **35 accepted receipts**
have **p95 1,758.10 ms**, maximum **2,799.85 ms**, and one value above two seconds.
The initial thirty-move RTT gate passes; the cost slice is not presented as
an independent controlled-network p95.

The provider's `google` network kind includes responses through Google Cloud
load balancers as well as Google API traffic. It is **not proof of free internal
egress**. The forecast conservatively prices all observed sent bytes as Internet
transfer; it does not add that total to the same API response bytes again.
Static Hosting and same-region Storage-to-API delivery remain separate paths.

#### Verified USD units and shared allowances

The existing enabled Billing Catalog was read without changing billing or IAM.
The relevant public SKU prices are effective **November 14, 2026**:

| Category | Paid-tier unit used |
| --- | --- |
| Oregon request-based CPU / allocated memory | $0.000024/vCPU-second / $0.0000025/GiB-second |
| Cloud Run requests / North America Internet transfer | $0.40/million / $0.105/GiB first paid tier |
| Oregon Standard Firestore reads / writes / deletes | $0.03 / $0.09 / $0.01 per 100,000 documents |
| Firestore data and indexes | $0.15/GiB-month |
| US regional Standard GCS / Class A / Class B | $0.02/GiB-month / $0.005 per 1,000 / $0.0004 per 1,000 |
| Static Firebase Hosting storage / transfer | $0.026/GiB-month / $0.15/GiB |
| Artifact Registry storage | $0.10/GiB-month |
| Default log ingestion / chargeable extra retention | $0.50/GiB / $0.01/GiB-month beyond 30 days |

References: [Cloud Run](https://cloud.google.com/run/pricing),
[Firestore](https://cloud.google.com/firestore/pricing),
[GCS](https://cloud.google.com/storage/pricing),
[Firebase Hosting](https://firebase.google.com/pricing),
[Artifact Registry](https://cloud.google.com/artifact-registry/pricing) and
[Logging](https://cloud.google.com/products/observability/pricing).
Catalog SKU units, tiers, region taxonomy and effective dates are retained in
the private operator evidence; some Oregon Standard Firestore SKUs encode the
region in their description while listing the service region as global.

Free usage must not be multiplied by participant or project where it is
billing-account shared. Run's 180,000 CPU-seconds, 360,000 GiB-seconds and two
million requests are monthly shared allowances. Firestore's 50,000/20,000/20,000
document operations reset **daily** on the eligible database. Hosting transfer
uses the actual project/daily **0.3515625 GiB (360 MiB)** tier, not a pooled
monthly allowance. Its storage free tier is daily-prorated. GCS's eligible
5-GiB storage and operation allowances, and Registry's 0.5-GiB allowance, may
already be consumed elsewhere. None is assumed available in the gross model.

The bucket is the newer `firebasestorage.app` type and uses GCS pricing, not the
legacy `appspot.com` daily download tariff. GCS's eligible direct-download free
tier is **not applied to bytes forwarded through Cloud Run**. Same-region
GCS-to-Run and Registry image pulls are not charged Internet transfer again.
There is no GPU, connector, relational server or committed-use purchase.

#### Declared planning workload and conservative totals

The scenario is one group of ten with **30 shared gameplay hours/month**, not
300 billed participant-hours. It assumes **1,200 accepted moves/hour total**
(36,000/month), a deliberately busy continuous one-every-three-seconds workload,
not a claimed user habit. One allocated CPU/1 GiB costs **$2.862 gross** for the
thirty active hours; an additional **2.25 active hours** is reserved for starts,
short sheet work and unusually active tails. Idle non-minimum instances under
the current request-based/min-zero setup are not charged as active CPU merely
because a logical disconnect-grace deadline remains stored.

Two estimates avoid adding background twice:

1. **Paired plus reserves:** measured quiet background for the modeled active
   minutes plus the measured paired per-move increment.
2. **Gross-minute upper scenario:** the higher of the scaled gross work-minute
   or the background-only observation, not their sum.

Both reserve an additional **200 document reads and one write per move** for
mature-history pruning, bounded cleanup, retries and maintenance not fully
represented by the fresh five-move fixture. This is an explicit planning
allowance, not a measured universal limit. At the 1,000-change retention
boundary an eligible prune can read the original 100-row batch even if only
one row retires; the fresh one-row probe does not erase that later cost.

| Gross-minute upper scenario line | Gross monthly USD |
| --- | --- |
| Firestore reads, including maintenance reserve | 5.9335 |
| CPU allocation, including active-tail reserve | 2.7864 |
| All-kind API sent bytes, all priced as Internet upper estimate | 2.1993 |
| Firestore data/index planning reserve, 5 GiB | 0.7500 |
| Log-ingestion reserve, 1 GiB | 0.5000 |
| Retained-registry planning reserve, 5 GiB | 0.5000 |
| Firestore writes, including maintenance reserve | 0.4471 |
| Ten whole static-package downloads plus 1% overhead | 0.4083 |
| Entire owner retained GCS payload allowance, 20 GiB | 0.4000 |
| Allocated memory, including active-tail reserve | 0.2903 |
| GCS Class B / Class A | 0.2707 / 0.2520 |
| Cleanup deletes / commands and 1,000 extra HTTP requests | 0.0200 / 0.0148 |
| **Total, all shared free allowances already consumed** | **14.7725** |

The paired-plus-reserves estimate is **$12.3839**. The more conservative
**$14.7725** leaves **$10.2275** below the $25 alert budget before any available
free usage. These are workload estimates, not an actual invoice or a hard
upper bound on arbitrary public traffic, multiple owner datasets or bulk work.

The static allowance uses the exact **289,411,201-byte** public artifact and
assumes every browser downloads every file once, more than progressive loading
normally requires. Unchanged immutable files/warm private assets are not charged
as recurring complete downloads. Four full release-download waves instead of
one add about **$1.23 gross** under the same assumptions. Large extra exports
or higher traffic require a fresh calculation; roughly 100 additional GiB of
API Internet delivery alone would add about $10.50 before applicable allowances.

The current releases are built locally and uploaded directly: no Cloud Build
execution is requested by this workflow. Future CI builds must be priced
separately. Google/email managed identity for this small pilot introduces no
phone/SMS or new Identity Platform upgrade. The default 30-day log retention
is included in ingestion; the locked 400-day `_Required` bucket is not charged
the extra-retention line. Retained rollback images remain preserved.

#### Twenty backups, soft deletion and unresolved gauges

The GCS allowance already includes live data, twenty complete backups,
quarantined old checkpoints and billable soft-deleted generations. It is not
added to a second copy of the same backup bytes. As an illustration only,
twenty 40-MiB backups occupy 800 MiB; continuous changed-state work targets
twelve per active hour plus changed session-end captures, not another daily
tier. Pruned copies still consume their seven-day soft-delete retention before
physical reclamation. Standard storage has no Nearline-style minimum-duration
penalty. The 20-GiB owner payload limit can refuse further publication rather
than making those retained bytes free; operator/test churn and metadata still
need observation.

Read-only Registry data now reports **320,710,714 repository bytes** versus
**2,296,822,095 known logical image-metadata bytes**, with **42 retained rows**.
Fourteen OCI indexes legitimately omit `imageSizeBytes`; they are not silently
coerced to zero or used to claim a complete deduplicated bill. The older
Monitoring **2,622,323,836-byte** sample remains differently aged/accounted.
The 5-GiB planning reserve discloses that uncertainty without deleting rollback
images.

The combined Firestore data/index storage gauge returns **no samples** in the
queried recent window, not a measured zero. Its 5-GiB reserve is a planning
allowance, not an invented actual footprint; it must be reconciled with the
selected import/rehearsal. Operation metrics are one document-counter family,
not the sum of mirrored legacy/new RPC or document series. Gauge samples at
different times are not summed into stored capacity.

**Still pending:** hosted acceptance on the client-proof runtime, including
remeasured ACK-inclusive payload/operations/costs, actual 15-minute disconnect
grace, fresh zero-instance evidence, cold authorized sheet experience and
re-sleep. R7's verified rotation, 55/60-minute and sampled-memory components do
not replace that acceptance. This worksheet does not check M4-13,
select real migration data, enable full gameplay, authorize cutover or alter the
budget. The original source selection/rehearsal and production approvals remain
separate M5 gates.

### R8 ACK-inclusive measured report: accepted technical pilot

The exact deployed R8 backend and retained-release frontend identified above
now pass the strengthened latency, idle, warm and provider-request measurement
gates, complete real-clock lifecycle/zero-instance/cold-sheet checks and the
new full stable regression below. This completes technical **M4-12/M4-13**,
not real-data, full-game activation or production approval. Both gameplay
capability gates and UX-01 remain unchanged.

#### Current and retained command observations

The fixed current cohort contains **100 ordinary commands plus all five
cost-window moves**, including due-backup work. Its validated durable-receipt
**p95 is 1,789.4867 ms**, maximum **2,650.8548 ms**, with **2/105** above two
seconds. Initial/post-cohort actual RTT medians are **200.5638/201.8114 ms**;
the post-cost guard has **200.89 ms** median, with every guard sample within
the unchanged 180-235-ms range. No server work or ACK guard wait is subtracted.
Public SDK operation-ready p95 is separately **2,660.8373 ms**.

Earlier slow data is retained. The preregistered original-35/current-105 pool
has **140 commands**, **1,789.4867 ms p95**, maximum **2,894.9881 ms** and four
above two seconds. Including the earlier precise, counter-rejected cohort
gives **245 observations**, **1,815.4767 ms p95**, maximum **3,397.0299 ms**
and nine above two seconds. The distinct too-fast-RTT hundred-command run
remains rejected network evidence, not silently pooled as representative
200-ms performance. Cold ten-client admission is separately **13,487.3986 ms**,
not ordinary receipt latency or the later cold assigned-sheet measurement.

All ten remain ready for **180,015.3929 ms** without scene polling. Seven
participants transfer **1,575 app-body bytes / 524.9551 B/min**; three transfer
**1,800 bytes / 599.9487 B/min**, reflecting seven/eight actual ACK periods.
Those totals include **21/24 SSE + 742/848 outgoing ACK + 812/928 incoming ACK
bytes**. The second clock campaign's traffic is labeled/excluded from A's
per-participant result; HTTP headers, TLS and Auth SDK renewal are excluded as
specified. Warm rejoin takes **1,594.0787 ms**, with zero unchanged image or
graphic bodies and one fresh validated SSE/current UID/scope/epoch/checkpoint.

#### Actual matched provider windows

Every one of **59** actual requests is matched one-to-one to its client marker,
method, path, status and completion minute. The matched-identity SHA-256 is
`25bb9020c78da8323cdd14dd932a96f1f371b8473e667654c0b63ee1a51fc998`.

| November 15 UTC minute | Actual provider/client requests | ACKs / accepted moves | Firestore reads | Writes | All-kind Run sent bytes |
| --- | ---: | --- | ---: | ---: | ---: |
| 08:50-08:51 control | 31 | 31 / 0 | 1,470 | 72 | 920,819 |
| 08:51-08:52 work | 28 | 23 / 5 | 1,932 | 72 | 3,389,841 |

Raw Monitoring HTTP minute counters are separately **28 / 29**, not substituted
for those verified request identities. All five accepted moves fit inside the
work minute. The control/ingestion periods permit only scoped presence ACKs,
not polling or reconnects; the clock campaign is included in provider totals.
The cost-window-only ACK dispatch guard described above is disclosed, not
applied to ordinary commands or healthy-idle measurements.

Raw paired read difference is **92.4 reads/move**; the gross work minute is
**386.4 reads / 14.4 writes per move**, including background. Equal 72-write
minute totals do **not** mean free/zero-write moves: different ACK/coalescing
phases confound a short paired write difference. The conservative gross
scenario, not that zero difference, is the planning recommendation.

GCS work is **7 WriteObject OK, 38 ReadObject OK, 49 metadata OK and 7 metadata
NOT_FOUND**, conservatively **7 Class A / 94 Class B** operations. Due backup
work is already included, not charged again. The idle GCS query has no series,
not a measured zero; GCS operations use the gross work rate.

#### Complete monthly planning projection

The public regional USD tariffs and shared-free-grant treatment above remain
unchanged. Both scenarios assume those free allowances are already consumed:
one group, **30 shared hours**, one allocated CPU/1 GiB, **2.25 additional
active hours**, **36,000 accepted moves**, an additional **200 document reads /
one write per move** for unrepresented mature-history/cleanup/retry work.
Background is included once: paired baseline plus nonnegative difference,
or **MAX(gross work scaled by moves, background floor)**, never their sum.
ACK HTTP reserves use the larger observed **31 ACKs/minute** over the complete
active-time allowance, plus commands and 1,000 admission/account/sheet requests.

| Gross planning cost category | USD/month |
| --- | ---: |
| Allocated CPU and memory | 3.0767 |
| Firestore reads/writes/deletes, including maintenance reserve | 6.8521 |
| Firestore combined data/index reserve, 5 GiB | 0.7500 |
| Owner retained GCS payload, 20 GiB, and measured operations | 0.9227 |
| All-kind API sent bytes priced as Internet upper bound | 2.3867 |
| HTTP commands, ACKs and other admission allowance | 0.0388 |
| Hosting cold transfer plus retained-version storage reserve | 0.5386 |
| Registry retained storage reserve, 5 GiB | 0.5000 |
| Default 30-day log-ingestion reserve, 1 GiB | 0.5000 |
| Cloud Build jobs / additional log retention | 0.0000 |
| **Gross-minute upper planning total** | **15.5656** |
| **Paired-plus-reserves reference total** | **12.4285** |

The upper scenario leaves **USD 9.4344** against the approved **USD 25/month**
alerts budget. This is a declared-workload estimate, not an invoice, spending
cap, initial $0-10 guarantee or permission for arbitrary bulk traffic.
An additional 100 GiB of paid API Internet transfer adds about **$10.50**;
three extra full static-download waves add about **$1.23**. Substantially
larger/churning private assets, additional groups/hours or abuse require
remeasurement and can exceed the alerts.

Twenty complete backups and seven-day soft deletion are included in the
20-GiB owner retained-payload allowance, not duplicated as separate storage.
The 5-GiB Firestore/registry reserves retain their disclosed telemetry/accounting
uncertainties. A new explicit **5-GiB Hosting retained-version reserve / $0.13**
corrects that storage category's omission from the older draft. Read-only
Hosting inventory reports three finalized versions and **863,356,467 aggregate
version bytes**; it is not asserted to be a deduplicated billing footprint,
and no rollback version is deleted. A new browser's full current-release
transfer allowance is **289,607,156 bytes**, including the stable manifest,
not the entire two-release retained package. Ten such waves receive one
percent overhead; daily free Hosting transfer is not pooled across unused days.

Local Docker/frontend builds use no Cloud Build jobs or tariff; configured
default logging is thirty days, with no paid extra retention added. No SMS or
Identity Platform upgrade, always-on database/connector, external load balancer,
new IAM/billing setting or real campaign migration is introduced. The completed
M4-12 lifecycle/cold-wake evidence is recorded below; the separate M5 owner
approvals still gate real-data and production readiness.

#### Completed R8 real-clock lifecycle and cold-work evidence

The same exact R8 run subsequently completes all hosted technical checks and
exits zero, persisting `accepted:true` at **10:35:04.570Z**:

- Owner Keep Active advances meaningful activity at **09:35:25.396Z**.
  The independent campaign's actual 55-minute warning is observed at
  **09:40:25.914Z**, followed by natural inactivity pause at its exact stored
  deadline **09:45:24.636Z**. ACKs, token renewal and reconnection do not reset it.
- All **ten** managed identities and actual streams rotate. A remains live for
  **3,882,799 ms**, beyond one hour, without a total-session-duration cap.
  The **59** current-revision memory samples, **08:46-09:44 UTC**, have maximum
  distribution mean **257,257,472 bytes**, below the allocated **1 GiB**;
  this is not an instantaneous peak-memory claim.
- B's restarted epoch explicitly disconnects, drains actual presence/quota and
  stays live until its original **15-minute** grace deadline, then pauses
  exactly at **10:00:29.316Z**, while A remains live. Ending A then drains all
  actual remaining streams, presence and UID leases.
- Current 100%-traffic revision telemetry explicitly reports **active=0 /
  idle=0** at **10:16:00Z**, read **10:16:37.793Z**. Fetching the actual
  **23,071-byte** website entry and forcing managed Auth renewal issues no
  game-API request. Another fresh explicit **0/0** point at **10:17:00Z**,
  read **10:17:38.480Z**, verifies both work without a game instance.
  Absent telemetry is never interpreted as zero.
- The first authorized assigned-sheet read from that genuine cold state takes
  **5,221.4614 ms**, including the representative network link. The actual
  permitted notes edit succeeds and a fresh read confirms the exact value.
  The session remains paused and all stream/live-connection counts remain
  zero; no game or permanent connection is started.
- That short sheet work re-sleeps: explicit **0/0** at **10:34:00Z**, read
  **10:34:49.775Z**, is fresh by **49,775 ms** with no intervening application
  traffic. This is measured cold-read/save/re-sleep behavior, not inferred from
  a static readiness endpoint or a configured minimum.

Exact cleanup at **10:35:39.575Z** removes **10 disposable UIDs / 2 synthetic
campaigns / 220 live object generations**; the persisted UID/campaign/invitation
fixture lists are empty. The real account and original local stores remain
untouched, and bucket retention is unchanged. Read-only final inspection
confirms the exact image/revision, min0/max1, one CPU/1 GiB, request-based CPU,
concurrency 40, 3,600-second timeout, existing origin and IAM; no permission
repair or configuration mutation is performed.

The checklist's full-stable milestone regression now passes on the
client-proof implementation: **307/307 suites, 4,017/4,017 tests**,
**1,762.935 seconds**, no snapshots or open-handle warnings, through the
existing `test:stable` runner. The older 4,006-test result is not reused as a
new full-regression claim. Real-source selection/rehearsal, production
deployment and final data cutover still require their explicit M5 approvals;
both gameplay capability gates and deferred routine-save UX remain unchanged.

### M5-01 through M5-05: selected private rehearsal and returning accounts

**Completed November 15, 2026; not production cutover.** The owner explicitly
delegated choosing one original testing campaign and authorized private
rehearsal in the existing pilot using the verified Google owner. Names/newest
timestamps did not select or merge source data.

Fresh read-only inventories cover both preserved hosts: port 3002 has seven
campaigns/ten records; port 57591 has two campaigns/three records. The selected
local-3002-candidate-5 provides eight sheets, eight placed actors, 42 maps and
116 connections, with 2014/core 5.1, one enabled pack, inactive combat and no
embedded images. Its building-assembly value of 1 is a schema marker, not an
assembly count. Deep shared-domain, catalog and scene validation passes.

The source's existing key is used only for a fresh trusted loopback DM session.
The returned data directory matches the selected source exactly; only that
newly created session is logged out. Independent read-only SQLite and trusted
host complete exports match **653,323 UTF-8 bytes**, SHA-256
`d72595326b2cdbf252239c46c2f4742483f8a534fb6c5f491d6a0f264d8dcfb1`.
Both original databases, the separate legacy access store and host-key bytes
remain unchanged. Those independent files and a safe preview persist privately
outside Git; no legacy credentials are copied into cloud ownership or bundles.

The owned browser page is explicitly loaded at the current immutable published
release. Read-only managed account UI confirms the existing Google/password
links and verified email without changing credentials or provider settings.
The actual authenticated file importer creates a fresh private rehearsal
campaign. Its stored owner matches the actual managed Google UID and a fresh
server Auth read, not a browser assertion or custom-token impersonation.

| Complete export | UTF-8 bytes | SHA-256 |
| --- | ---: | --- |
| Original, both independent methods | 653,323 | `d72595326b2cdbf252239c46c2f4742483f8a534fb6c5f491d6a0f264d8dcfb1` |
| First authenticated private copy | 653,322 | `ce778321ca6fe6e1614329c02dffb37c91914451b78925a11573d63b83d04248` |
| Authenticated export/import verification copy | 653,322 | `b77a6ec9b512852a22c83f0b24b627b9124a680c25440f4ec422659681c4eabf` |

The first copy's actual complete JSON export is fed as a JSON `File` into the
real authenticated importer, creating one further private verification copy.
Its actual complete export is compared with both predecessors. All eight sheet
rows/values, source pins and the entire terrain/map/connection/placement/combat
scene match exactly; only fresh campaign ID, revisions and creation/save times
differ as intended. Fresh private object prefixes and authoritative owners are
checked for both copies. The original complete source digest is still unchanged.
The integrated browser did not expose a native download event, so this evidence
uses the repository-supported complete copy-text export and actual file import;
it does not claim a confirmed local cloud download or a product download failure.

The source's separate access database contains two legacy test players with
six assignments, grouped **4 + 2**, not 3 + 3. Two approved disposable verified
identities redeem fresh single-use invitations created through the owner UI;
acceptance enables them automatically, with no manual pilot grant. Owner
assignment controls bind those exact six existing records to new account seats.
Isolated named Firebase apps use in-memory persistence and do not sign out the
Google owner. Actual managed sign-out/sign-in followed by a fresh cloud store
preserves each UID, seat, access generation and exact 4/2 assigned rows. Neither
participant receives owner privileges or the full scene. The owner's entire
export remains byte-identical to the first-copy digest after these access changes.

The private credential bridge is deleted after loading; fixture passwords and
consumed invitation secrets are cleared after the returning-account drills.
The two disposable identities remain exactly tracked for the upcoming session;
the two real-owner rehearsal copies are tracked separately, not included in old
synthetic-campaign cleanup. Raw owner identifiers/emails and credentials are not
published in this report or Memory.

This completes **59 of 65** migration tasks. Both gameplay capabilities remain
off while missing native full-game paths are finished and tested. The actual
ten-client four-to-five-hour rehearsal, recovery/rollback, explicit production
approval, selected latest-data cutover and first production session remain open.
The routine-save flash/centered notice remains deferred until `M5-11`.

### M5 native Undo development gate

The valid native-turn regression initially reproduced the actual cloud gap:
Dash committed with zero remaining actions, but the first live authoritative
player HUD reported `canUndo:false`. Cloud execution/projection omitted the
shared engine's transient receipts; saved combat intentionally excludes them.

The existing local bounded receipt policy is now shared with cloud execution
and projection. It retains at most 256 sessions, 64 actors/session and ten
receipts/actor, pinned to both committed revisions. Cloud scope includes the
actual UID, campaign, seat/access generation, live epoch and server-verified
Firebase `auth_time`, not token-refresh `iat` or a client Undo claim.
Malformed/missing provider authentication time is rejected explicitly.
Only successful canonical publication installs receipts; a campaign/UID/
command-scoped completion barrier prevents the first head notification from
publishing a stale Undo HUD. Cold replacement still drops transient receipts,
as intended, without losing saved budgets or history.

The actual SDK/HTTP/SSE regression proves accepted Dash -> Undo restores the
action once, managed token refresh retains current availability, and a real
returning login with a new provider authentication time has the saved spent
budget but cannot use the former sign-in's receipt. Its unavailable command
returns `undo-unavailable`, after correcting the client's missing safe-denial
mapping; no server message/private body is relayed.
Six adjacent native cloud cases pass, including original Free Play, same-ID
recovery, concurrent CAS, post-stage membership removal and foreign-scope denial
(**53.350 seconds**). Existing local Undo/account/store/transport tests pass
**4 suites / 47 tests**, with open-handle detection. The native account gate
separately passes **13/13**, retaining its minimal public account response.

This is a development gameplay slice, not a new hosted release, full stable
milestone, completed four-to-five-hour rehearsal or gameplay capability enablement.

### M5 native player-door development gate

The actual cloud SDK initially rejects `doorState` as an unwired operation on
valid native three-map door geometry. It now uses a strictly validated
cloud-specific `door.state` variant through the existing world-command
reservation, UID/seat/live-epoch admission, both-revision CAS, atomic publication
and durable same-ID receipt path. The shared gameplay command list is unchanged,
so existing participant states retain their supported command vocabulary.

The native five-foot, physical-sight and locked-door policy is shared with the
local host rather than duplicated. Players can open/close, never lock/unlock.
The cloud receipt retains only door ID/open/locked, not connection geometry or
hidden map metadata. It returns the existing player application's door receipt
shape and waits for current authoritative state. Door publication clears
transient action Undo consistently with the local host's external scene commit.
The separate `playerCommand` operation rejects the cloud-only door variant
before submitting a mutation with an incompatible result shape.

The real SDK regression opens a physically nearby door, verifies unchanged
action/movement budgets and the owner's canonical saved state, then checks
owner locks, forged lock overrides, the wrong operation and a distant relocated
observer. Every denied request leaves exact canonical state unchanged.
It passes in **17.627 seconds**. The existing local door geometry/locks/visits
and camera-safe update gate passes **3 tests / 2 suites**, **3.911 seconds**;
the existing cloud client/receipt/reconciliation gate passes
**71 tests / 2 suites**, **1.659 seconds**, with open-handle detection.

This completes the basic native cloud door operation, not cloud room-discovery
persistence, arrival grants, full-session acceptance or publication. Both
gameplay capabilities remain off and the approved hosted R8 release is unchanged.

### M5 owner-approved actorless cloud arrival development gate

The owner selected **DM-granted render-only preview** in the focused privacy
approval: only the granted area's terrain, no NPCs/other actors, no fabricated
observer and no movement authority. This task-specific approval does not enable
production, real-data cutover or either full-game capability.

Players and invitations now exposes the existing explicit area/zero-based-cell
workflow for assigned saved characters. The owner command validates current
seat/access generation and actual canonical board bounds, reusing native grant
validation. One grant per character is stored on the seat, with its secure
command ID, destination and surface. The same transaction publishes the durable
receipt and a new head/change generation so a connected unplaced player sees
the grant without polling or a fake scene write. Reissue replaces the grant;
assignment, member removal and canonical character revocation clear old grants.
Preparation does not start a live game or renew meaningful gameplay activity.

An explicitly selected current grant permits native render-only artwork for its
area, with no actors, observers, door controls or owned-token movement budgets.
The checkpoint carries an explicit arrival mode; generic no-observer reads still
return no world. Normal hash verification, private UID/seat/view cache and fresh
online authority apply. No cached grant becomes offline permission. The native
arrival renderer receives its existing preview interface, rather than a second
renderer or invented sheet-only world actor.

Placement uses the existing native model/floor/occupancy/combat checks in a
private canonical draft. Only its committed real actor becomes the observer.
The durable minimal placement receipt includes the actual actor ID so a lost
reply/same-ID retry cannot create a duplicate or return a null actor.
Original sheet values remain exact. The matching current revision, membership,
seat generation and live epoch are rechecked before final publication.

Verification:

- Actual owner/player SDK: grant notification arrives live with no automatic
  world disclosure; unknown grants and member grant issuance are denied;
  explicit actorless preview renders only the authorized map; native Next sprite
  placement preserves every original sheet row and retries only once.
- A separate backend authority over the same real emulator stores recovers the
  grant without original process memory. Reissue denies the old destination.
  The original receipt replays without reverting the new grant or advancing the
  head again. Unassign/reassign cannot revive the superseded destination.
  These two native cases pass **22.579 seconds**.
- Existing current-membership, closed-room/observer/construction-note privacy,
  private image-manifest and delta-replacement gates pass **5 native cases**,
  **30.436 seconds**.
- Owner form, existing local arrival UI and cloud lifecycle:
  **24 tests / 3 suites**, **7.403 seconds**.
- Existing private cache, image, cloud receipt and native public renderer:
  **94 tests / 4 suites**, **3.390 seconds**, with open-handle detection.

The first grant attempt caught a summary-map/board-map distinction and the
replacement test caught a missing durable receipt-kind admission. Both are
fixed and re-tested; temporary tagged diagnostics are removed. No hosted image
or frontend is published in this slice. Room-discovery persistence, remote
action/emote completion and the actual full-session rehearsal remain open;
the canonical checklist remains **59/65**.

### M5 durable room-discovery development gate

The actual native-cloud regression initially returned no remembered room after
the assigned actor physically entered it. Cloud seats now retain visited floor
IDs using the same physical-occupancy rule as the local authority. New room
entries update only affected assigned seats in the canonical publication
transaction, including owner relocations while players are disconnected.
Assignment to an already placed room character records that current visit.
Fresh verified participant reads can backfill a pre-upgrade current visit once,
with matching live epoch, seat generation and canonical head.

Ordinary steps within an already occupied room do not trigger another seat
scan/write for discovery. Repeated reads and transport ACKs do not create visit
writes. Room IDs are history, not render grants: the participant's active real
observer still controls all current maps, actors, image manifests and doors.
The portable scene/backup format and original data are unchanged.

The native test proves exact discovery for only the assigned character, retains
it after leaving and through a separate backend authority, and keeps both
closed interior maps absent from the returned exterior artwork. Assigning an
already placed upstairs character adds only that legitimate historical ID,
without granting its room to the other active observer; a fresh read leaves the
seat's actual datastore update time unchanged. The coupled discovery, arrival
and staged-revocation gate passes **3/3**, **31.018 seconds**. The unchanged local
door/discovery regression passes **1/1**, **2.488 seconds**, with open-handle
detection. The new shared helper is explicitly included in the container
allowlist and exact runtime hash gate.

Full gameplay activation and the actual ten-client full-session rehearsal
remain gated. This is not a hosted rollout or a completed M5-06 claim.

### M5 native DM route-capture correction

Full-game tracing finds a gap not exercised by manually submitted backend route
packets: cloud autosave already requests shared movement, but the native stable
checkpoint recorder still accepts only local-host storage. The new real
humanoid-movement regression first produces an empty outgoing route for a live
cloud owner.

The recorder now uses the same explicit live-cloud presentation binding as
autosave while preserving local-host behavior. An inactive/unbound cloud
checkpoint discards obsolete pending presentation routes. A resumed native move
starts from its latest safe paused pose under a fresh presentation ID, not an
old route origin. This changes neither canonical movement costs nor saved poses.

The native capture/pause/resume case, complete stable wall/checkpoint cases and
actual local/cloud DM walk/run/queued/reconciliation renderer gates pass
**12 tests / 3 suites**, **29.990 seconds**, with open-handle detection.
This closes the actual outgoing native capture gap before full-game activation;
it is not a claim that the earlier manually submitted hosted movement cohort
tested this UI path. No new hosted release or gameplay capability is enabled.

### M5 live visual-action and authoritative Cover development gate

The actual cloud visual-action regression first finds an accepted emote with no
live presentation packet. The real player menu then exposes a separate gap:
canonical emote availability was not projected, and an idle action did not send
its selected variant. These are fixed through the actual native input,
authority, managed SDK, HTTP/SSE and renderer paths, not just manual route JSON.

Visual packets contain only a bounded command ID, actor ID, canonical action/
animation variant and committed placement. Cover additionally carries its
authorized FROM. No arbitrary clip URL, sheet record, private target, cost or
foreign budget is accepted into this packet. Both live directions work:
player to owner/visible participants and DM to visible players, including a
second owner tab. Native playback deduplicates own HTTP/SSE echoes without
restarting the clip. Cosmetic entries remain separate from coalesced movement.
Checkpoints, resync, duplicate receipts and later visibility do not replay them;
the complete canonical scene/backup never stores animation command frames.
Both FROM/end must pass current map/physical-sight filtering for another actor.

#### Owner-approved physical Cover, not an in-place approximation

The owner explicitly selected `authoritative_wall_alignment` after inspection
showed that native Take Cover changes position and facing while the old server
emote returned an unchanged scene. The cloud now preserves that native,
wall-aligned stance within the same supported cell without spending movement,
actions or character resources.

Trusted measurements are generated from **all six actual native model and
retargeted animation pipelines**, with **seven source-FBX SHA-256 inputs**.
The development-only local file/DOM sampler invokes the real adapter and authored
Cover clip; it does not guess an inset or trust client measurements. Shared wall
selection/destination math is reused by native and server execution. The
checked-in data is small JavaScript; production requires no FBX/texture load,
DOM, GPU or new infrastructure.

```powershell
npm run resources:cover
npm run resources:cover:check
```

The first command regenerates formatter-stable data after a deliberate native
asset change. The second recomputes all measurements and fails on drift.
Regeneration alone is not acceptance: server/native final positions and facing
are compared to six decimals for every appearance, and the receiving native
renderer verifies its prepared destination before playing.

The canonical commit includes the accepted stance and a minimal durable command
receipt. A live FROM/end presentation starts the same Cover animation instead
of teleporting to the held pose or applying the alignment twice. Native owner
capture does not turn Cover into a false walking route. Receiving DM animation
does not schedule an echo save; an issuing player's later HTTP receipt cannot
interrupt its already streaming Cover.

Model templates retain the tile size used for normalization. Replaying a visible
actor on a differently scaled floor converts pose measurements into that actor's
source-map units, independent of the viewing map. Approved projected playback
does not relax the normal off-map manual-input prohibition.

#### Coupled development evidence and remaining gates

- **262 tests / 12 Jest suites**, **234.622 seconds**, all pass with
  open-handle detection: all native Cover/idle/wave/model/parity and projected
  scale cases, local gameplay, bidirectional walk/run/queue/reconciliation,
  actual radial input, DM/player receipt echoes, cache/transport and host updates.
- The native Cover group includes **36 cases** over all six appearances,
  preserving existing cover-wall removal, unsupported-cover refusal, Dodge
  out-and-back motion and logical-position behavior.
- **Six actual emulator HTTP/SSE cases**, **76.838 seconds**, pass for atomic
  Cover stance/cost preservation/same-ID recovery/no-wall rollback, both visual
  directions, hidden-actor denial and no replay after room visibility, current
  Undo, existing native owner routes and forged-epoch/endpoint/private-field
  rejection. The player SDK also consumes and acknowledges the non-motion entry,
  rather than testing only a raw transport packet.
- `resources:cover:check` passes against the actual source assets. The isolated
  package smoke gate now also executes Cover for both rulesets and asserts that
  animated sprite files are absent; a newly built image must pass it before use.

This is a focused development gate, not a new hosted release, full stable-suite
milestone or completed rehearsal. The remaining control-family UI acceptance,
exact runtime/frontend packaging, actual four-to-five-hour ten-client session,
recovery/rollback and separate production/cutover approvals remain open.
Both gameplay flags remain off, the published R8 pilot is unchanged, and the
canonical checklist stays **59/65**. Deferred routine-save feedback is untouched.

The exact committed development implementation `e97038089b93571ccc61cbfeb9378b445c64e6b9`
also passes its newly built isolated Linux package gate:

- Local tag `taverntable-cloud:m5-native-actions-20261115-e970380`.
- OCI index `sha256:7a9daa8c47c97238782bce9ce6168233aa39b9c9a3e913271aae70acadd289b5`;
  runnable manifest `sha256:f49aa4dbf5dc56b4058b3e3c6658730cc2240b1a5598b4bc8edbcfc7cbfa83b2`.
- **28 exact runtime hashes** match the committed source. Linux Node **24.22.3**,
  UID **1000**, read-only root, no network/mounts/GPU, **1 CPU / 1 GiB**;
  startup, anonymous/forged denials, private-file 404s and graceful exit zero pass.
- Both rulesets execute authoritative Cover with unchanged character/combat
  state, without animated sprite files. Sixteen pinned resource packs,
  **501 actual d20 frames** and the **16,000,000-pixel** native-image guard pass.
  Final local-check RSS is **253,784,064 bytes**, not a hosted peak-memory claim.
- The exact validation container is stopped/removed. The image remains local:
  no registry push, test-service update, frontend publication, settings/IAM
  mutation, production release or selected-data cutover is performed.

This image records the visual/Cover slice, not the still-unfinished complete
player-control UI gate; later runtime changes require their own exact image check.

### M5 actual player-control development gate

Direct successful gameplay RPCs had not proved that players could operate their
real controls. Native input, sheet, radial-menu and dice-button tracer tests
reproduced missing eligibility, absent Undo/traversal controls, and a local-only
entrance-approach path. This development slice connects those existing controls
to current server authority without creating a mutable player combat session.

- Dash uses the native filtered action list, spends one action once, and exposes
  the committed 60-foot allowance. Sheet Undo consumes only the current server
  receipt, restores the action/allowance once, then disappears.
- Facing, Walk/Run/style preferences and ordinary dice remain usable between
  turns without changing base Speed or rule budgets. The actual dice button
  displays the same result recorded by authority.
- Stand Up displays and spends 15 feet for a 30-foot maximum Speed, clears
  persistent Prone and spends no action. Repeating it is unavailable.
- A real scene-granted Fly spell enables the actual radial menu even when base
  flying speed is zero. Loaded native FBX models interpolate takeoff, elevation
  and Drop without replacement; unaffordable elevation options disable. Drop
  works between turns, spends no movement/action and retains concentration.
- The player application mounts the existing traversal popup. Public geometry
  reuses native read-only connection planning; approach and crossing submit
  separate authoritative commands rather than mutating local scene/combat.
  Local/server crawling costs share one rule, so a five-foot doorway costs a
  prone actor ten feet. Escape cancels the later offer, not an already committed
  approach. Players do not receive owner lock/unlock controls.
- Observer/map/arrival changes and failures dispose private traversal offers
  together with targeting, dice and world rendering. Malformed boolean flight
  visibility and private restore fields fail closed before actor hydration.
- Actual cloud HTTP reproduced a physical floor refusal being converted from
  `422 flight-blocked` to an uncertain `503 invalid-cloud-response`, and a
  non-prone Stand Up returning `500 campaign-request-failed`. Constant safe
  native-denial mappings and the shared native standing guard now preserve
  definitive `422` responses. Failed intents change no canonical data; subsequent
  new commands work instead of being trapped behind the original pending intent.

Validation:

- **302 tests / 19 Jest suites**, **188.685 seconds**, all pass with open-handle
  detection. Includes actual UI/input and loaded sprites, all local authoritative
  gameplay cases, existing owner traversal/approach, native physical d20 replay,
  sheet/context controls, scoped clients, Undo and private-state rejection.
- The complete world-command emulator file passes **29 actual HTTP/SSE cases**,
  zero failures/skips/cancellations, **369.397 seconds**. Its ten managed SDK
  clients converge through CAS contention, duplicate/lost replies, reconnect and
  revocation; private bytes and remaining transports after cleanup are zero.
  Warm rejoin still transfers zero valid unchanged graphic/image bodies.
- Formatting, affected-source ESLint and architecture layering pass.
  The isolated-package hash gate now includes the shared traversal-cost source.

This is not a new whole-repository stable result, hosted latency/cost acceptance,
image acceptance, deployment or completed M5-06. The earlier exact `e970380`
image does not contain these later changes. Both gameplay flags and the published
R8 pilot remain unchanged; the checklist stays **59/65**, and UX-01 is untouched.

One complete-world input edge remains explicit: a flying entrance approach at a
different elevation currently asks the player to match that elevation first.
Native automatic vertical-then-horizontal approach, including non-five-foot
opening heights, still needs its own authoritative tracer before complete native
acceptance. Matching final runtime/frontend packaging, the actual four-to-five-hour
ten-client rehearsal, recovery/draining and production/cutover approvals remain
separate gates.

### M5 airborne restore and native entrance-approach parity

The preceding different-elevation entrance limitation is now removed in
development. A real loaded-sprite tracer first exposed an earlier startup bug:
orientation capture treated an incoming airborne actor as grounded before
model creation, rejected its unsupported ground position and removed the model.
Canonical flight state is now installed before that native initialization.

The existing movement intent accepts an optional finite map-local
`elevationFeet` destination and explicit boolean `closest` consent. It still
accepts no client pose, cost, role or resource authority. Grid coordinates must
be safe integers. Normal moves keep their old shape and altitude behavior.

- Native entrance approach now pays for its vertical sweep before the horizontal
  route, including the actual one-foot clearance of a six-foot door. The existing
  five/ten/fifteen/twenty-foot radial choices remain unchanged.
- Native and server closest-legal selection share the same distance/cost
  comparator. A flyer with two feet remaining descends only those two feet;
  it does not cross, overspend or receive a later unaffordable traversal offer.
- Ground elevation claims, below-floor descent, solid ceilings, strict
  over-budget destinations and malformed opt-ins are definitive refusals with
  unchanged canonical state. Explicit closest consent cannot bypass a solid.
- A destination exactly at real support lands normally, retains the saved
  character and action economy, and creates no fall damage/Prone. Same-ID
  recovery cannot debit it again.
- Actual cloud owner SSE receives the vertical waypoint followed by the
  horizontal waypoint and the correct nine-foot debit; same-ID recovery
  returns no historical route or second canonical write.

Current coupled validation is **434 tests / 25 Jest suites**, **237.742 seconds**,
all passing with open-handle detection, including prior control, owner approach,
native movement-range/redirect, sheet and private-state cases. **Three actual
cloud HTTP/SSE cases**, **42.113 seconds**, pass for fractional approach,
existing takeoff/elevation/fall and definitive native refusals. The earlier
complete 29-case cloud-world gate remains separately recorded, not relabeled as
a new whole-file run. Formatting, affected-source ESLint and layering pass.

The isolated runtime gate now checks **31 exact input hashes** and exercises
fractional flight as well as native Cover for both rulesets without sprite
assets/GPU. That gate still requires a fresh exact image build. No new hosted
release or full-session acceptance is implied; both gameplay flags, the R8
service and the **59/65** canonical completion count remain unchanged.

The exact committed source `87fd2c54bbbbb4795261abf615084fec98927c07`
(tree `79bc6aeaf7119058ae97e9d8240182b45038422d`) now passes fresh local
runtime and frontend packaging:

- Image tag `taverntable-cloud:m5-native-controls-87fd2c5`.
  OCI index `sha256:a21f1c75e1e888a3f719387e3696a9bdbda4664edbc556487619aa58087de678`;
  runnable manifest `sha256:89a02305b16199b6c3fada97cbcf438173be3e4364b656e812aea7a29978c8b8`.
- **31 exact hashes** match source. Linux Node **24.22.3**, UID **1000**,
  read-only root, no network/mounts/GPU, **1 CPU / 1 GiB**. Actual Cover and
  fractional-elevation flight execute for **both rulesets** without sprite files.
  Sixteen pinned packs, **501 real d20 frames**, the 16-MP native-image guard,
  authentication/private-file denials and graceful exit zero pass.
  Check RSS is **251,576,320 bytes**, not a hosted peak-memory measurement.
- The exact isolated check container is stopped/removed; the image stays local.
- Verified frontend output is
  `build/cloud-frontend/m5-native-controls-87fd2c5`, release
  `e133f097293c362521fc4dc3127fd0505671da08806b037f9466dcb8731ef391`.
  It retains the currently published `4217765d8a3ae47bc9b73da679e71a40ead90616e008df963040439ec9a13c42`
  static tree: **1,215 files / 578,487,102 bytes** across two releases.
  The compiler verifies every allowlisted body/import and existing runtime;
  `deploymentApproved:false` and truthful unrecorded tropical-license provenance
  remain unchanged. Retaining assets is not certification of backend/data
  rollback compatibility; M5-07 still owns that proof.

These are local artifacts, not publication or activation. The existing private
API/website and both user-facing gameplay gates remain unchanged. The next
hosted step must deliberately lift those gates for the approved private rehearsal,
without implying production deployment, source-data cutover or M5-06 completion.

### Approved private-pilot gameplay activation

After the preceding exact local gates, the owner explicitly selected
**pilot_only**: enable the existing private pilot's multiplayer/room launch
switches, publish matching verified website/API packages, and continue the
approved four-to-five-hour ten-client rehearsal. This does not authorize
production, selected-source cutover, IAM/runtime/billing-setting changes,
real-account credential/provider changes or changes to either original host.

The client launch capabilities are now enabled in the migration branch.
They are not authorization: verified managed identity, the existing private
pilot enrollment gate and current per-campaign/seat/epoch checks remain required.
The existing picker already displays its enabled live-game workflow without
opening a Joined player as an owner. Its independent disabled-store/cache
settings path remains supported.

The directly affected client/picker/scoped-player gate passes **77 tests /
three suites**, **6.809 seconds**, with open-handle detection; affected formatting
and ESLint pass. Fresh activation packages and their existing-service-only
publication still need completion. The earlier `87fd2c5` local artifacts retain
their exact recorded meaning; they are not relabeled as containing this launch
switch change.

### Private publication and returning-entry recovery

The approved activation source `25c2deb329e8c75f077c66ab2191bc02c62d4750`
passes its own fresh exact Linux gate: **31 source hashes**, both-ruleset
Cover/fractional flight, real d20, non-root/read-only/no-network CPU1/GiB1,
authentication/private-file checks and clean exit. Its local image
`taverntable-cloud:m5-private-gameplay-25c2deb` has OCI index
`sha256:8cdbd4ea32bede2f700f380ea9b4dfb3d6b152091ffcac509d304f9d86d4e572`
and runnable manifest
`sha256:43b6689b1a254b42da52b418308dcd103e85d27d5395b6fb0c75da09021106ca`.
Local-check RSS **247,263,232 bytes** is not a hosted peak claim.

The exact index is published only to the existing test registry and applied
as an image-only update to `taverntable-api-test-00016-4rr`. Actual readiness
is 200 and anonymous account access 401. Existing service account, runtime
settings, origin, latest traffic and invocation IAM fingerprints are preserved.

Matching frontend
`8fb7dbee4f99b897ce023e65cab27e938e515f0ef54282bc0b87b97291289a98`
is published only to the existing private website, initially Hosting version
`16fb0312910f1798`. Actual manifest plus nine critical client/HTML bodies match
local hashes; root/metadata/entry no-store, immutable asset caching and four
private-path 404s pass. The original owner remains normally authenticated; the
selected rehearsal campaign is still paused.

Actual returning-browser navigation nevertheless follows a previously cached
stable redirect to the older `f24257b` entry and receives 404 after that third
static tree is pruned. Clearing the browser cache or navigating directly to the
new hash would hide, not fix, the returning-user problem.

The builder now carries known retired entry IDs forward separately from the
two retained static trees and emits exact no-store 302s from only those entry
shells to the current shell. Unknown paths/assets never become redirects;
current/retained entries cannot loop. Missing history in an older version-1
manifest remains valid, while null/malformed/duplicate/retained-loop metadata
is rejected. The complete **six-case** native package gate passes,
**2.440 seconds**, with unchanged privacy, integrity and no-overwrite checks.
Fresh repaired Hosting publication and the same returning-browser URL must
pass before starting gameplay. No production, source cutover, account changes
or original-host changes are performed.

The repaired Hosting package, still the same `8fb7dbee` application bytes,
is published as version `83d94432953afc8b`. Actual retired entry returns
302/no-store to the current 200 entry; unknown entry hashes, retired asset paths
and private configuration stay 404. Reloading the actual failed `f24257b` URL
and then navigating the same browser through the stable root both reach the
current app without cache clearing. The real owner remains signed in.

### Native owner startup request adaptation

Opening the selected private cloud copy through its actual enabled picker
then exposes a separate `400 invalid-campaign-request` on the initial board save.
The save is definitively rejected before publication, not acknowledged; the
selected live session stays paused and the full-session rehearsal has not begun.

The native scene facade adds `trackRoomVisits:true` for the local host.
Activating the cloud room capability exposed that untranslated hint in a strict
canonical cloud request. The client adapter now consumes exactly that known
true hint for both scene and nested atomic character/scene saves, just as it
already separates native presentations. It does not broaden backend fields,
turn room discovery off, accept caller-selected visit data or mutate the
caller's captured object. False/null/string overrides fail before HTTP.

The actual native `CampaignCharacters.saveScene` and bound character-edit path
reproduce the rejection and now pass through real emulator HTTP while paused.
**Three real HTTP/SSE cases**, **36.040 seconds**, also retain server-derived
room discovery/privacy and scoped native owner routes. The coupled client,
picker, player-session and actual native shared-model gate passes **85 tests /
four suites**, **33.107 seconds**, with open-handle detection; affected
formatting, ESLint and layering pass. This is a client transport correction;
the existing private API image/permissions/settings need no change.
Fresh client publication and retry of the same normally authenticated owner
startup remain required before continuing the rehearsal.

### Full-world private admission diagnosis and scoped native reuse

The matching client-only publication lets the actual returning owner open the
selected board normally: eight original records/actors, 42 maps, ready and clean
autosave. Under the owner's private-only activation approval, nine disposable
managed member identities retain their invited seats and original/shared
assignments. The first three member startups do not become ready. Temporary
`503 cloud-requests-busy` follows; health, identity denial, CORS preflight and
unchanged service/IAM checks do not establish a persistent CORS/configuration
failure. The pending original end action is recovered by same-ID retry, all
member observations are closed, and the actual server is paused. There is no
cohort readiness timestamp: the required four-to-five-hour rehearsal has not
started.

A single unshaped participant read on this actual large copy takes
**25,237.7 ms**. Read-only local replay of its independent approved source
reproduces **7,110/6,842 ms** cold/repeated public projection without network or
authority writes. CPU profiling identifies repeated native targeting sight,
repeated complete map copies and duplicate full-world/view materialization,
not resource catalog loading. A supposed unresolved-ready leak is not asserted:
the actual participant subscription already rejects pending readiness on close.

The correction reuses only native work tied to the exact snapshot:

- Native world query maps are deeply immutable per-map snapshots; ordinary
  editable copies and canonical replacement behavior remain unchanged. The
  actual public-player location adapter implements the same query seam.
- One physical sight pass checks each reachable connection once, and native
  targeting shares one result within its existing resettable query lifetime.
- Weak source identity plus complete captured-content, catalog and ruleset
  checks protect shared source geometry. At most 32 source-local render views
  are keyed by exact assignments, observer, displayed map and arrival grant;
  failed preparation is evicted and still rejects its callers.
- Already filtered owned gameplay is not computed for hidden actors. The
  current server-derived observer sight is reused only for that same actor;
  other controlled actors and actual commands retain native sight queries.
  Membership, live epoch and current head are still verified before and after
  materialization. Sheets, image slots, Undo and current gameplay are never
  taken from another participant's response or cached authority.

The actual source's complete public result matches committed code exactly;
all eight source observers preserve the original physical sight results and
canonical input is unchanged. Latest local readings are **697.802/28.234 ms**
cold/warm, with **843.057 ms** for nine representative member views. These
CPU-only figures exclude managed identity, Firestore, Storage, hosting, network
and imposed RTT and do not replace hosted acceptance.

A synthetic, publicly reproducible generated castle has **51 maps, 134
connections, eight actors and four spellcasters**. The same test fails against
the committed pre-fix projector at **7,275.516/6,930.700/6,852.472 ms**, then
passes the unchanged two-second per-projection requirement at
**1,009.122/400.600/400.320 ms**. The focused cache tests also verify assignment,
private-sheet/image and hidden-budget isolation, zero unchanged warm artwork,
no canonical mutation, and same-object record/geometry invalidation.

Final coupled native gate: **227 tests / 16 suites**, **185.378 seconds**,
open-handle detection enabled. This includes actual traversal popup
crawling/approach/cancellation/fractional flight after completing the public
map-query adapter. The complete managed HTTP/SSE world gate passes **31/31**,
**411.119 seconds**, including ten SDK identities, revoked access, warm cache,
native movement/doors/Undo/flight and no historical route/action replay.
The three focused projection cases pass in **2.587 seconds**. Affected ESLint
and layering pass. These are focused current gates, not a new whole-repository
stable result.

The existing private runtime/frontend must still be packaged, checked,
published and exercised with the retained real owner before admission can be
declared resolved. No work-slot, concurrency, timeout, resource, IAM, production,
source-cutover or deferred routine-save presentation change is part of this fix.

### Published admission success and retained slow real receipt

The private-only exact release is now published: API source
`727c74468b121ab8795833a16ff1584e2880a249`, revision
`taverntable-api-test-00017-m5r`, OCI index
`sha256:51aa807f3b81160235bb1fee64b9121ffe68f2a3f1ba573e76a753059d2f41ff`
and runnable manifest
`sha256:7819f4708fc6fad9fbefdb0e80df2df311dee1c43ab9f715bbc2316225d3c251`.
All **36 exact source checks** and the existing native/authentication/container
gate pass at CPU1/GiB1, with no network/GPU, non-root/read-only execution and exit
zero. The actual approved source in that image takes **1,188.148 ms** cold;
nine exact fixture scopes take **1,211.471 ms**, then **252-288 ms** warm,
with identical committed/host public output, unchanged canonical input, zero
unchanged warm artwork bodies and no historical updates. Local RSS is
**237,707,264 bytes**, max RSS **249,008,128 bytes**, not hosted peak memory.

The matching static application is
`ece3f79fe69fa8d9bd792736b883fa847cfe3e7806458c4c289208d35b02f1af`,
retaining `0055d54f...` and three exact retired-entry bridges. Actual live
entry/code hashes, health 200, identity denial 401, allowed-origin preflight
204, runtime settings and IAM are rechecked. The actual normal returning root
and picker preserve the real owner's authentication and all 42 maps/eight
actors/eight records; no source host is changed.

Nine existing disposable seats are reauthenticated, not reinvited/recreated;
original returning assignments remain **4 + 2**. The calibrated game-API-only
link measures **202.2 ms median / 206.2 ms p95**, 200-206.5 ms range, with a
two-MiB body in **202.4 ms**, real upstream cancellation and zero leftover
timers. Provider/product clocks and provider transport are unchanged.
All **ten actual authenticated streams** become ready at the same canonical
generation. Member cold SDK readiness is **3,559-6,521 ms**; no
`cloud-requests-busy` response occurs. Every current assigned-record scope,
canonical placement and visible-owned budget is verified. Consumed fixture
password files are deleted; no real owner authentication setting changes.

The real rehearsal begins **2026-11-16 03:27:36.739 UTC**. Its first facing
command commits exactly one scene generation and reaches the actual native
owner and all nine members, but the finite durable HTTP receipt takes
**11,347.400 ms**, SDK readiness **11,349.200 ms**, all-member convergence
**11,351.600 ms**. This observation is retained, not dropped as warm-up.
The attempt is stopped, all nine member observations close with zero close
failures, transport wrappers are removed, the owner end action is confirmed
paused and no pending command is discarded. The owner UI also later reports
an invalid shared update after a presence acknowledgement times out.

A separate unshaped control with **zero live observers** still takes
**8,249.800 ms**, restores the original facing once, and finishes paused.
Thus local observer CPU improvements alone cannot establish the required
durable receipt performance. Local emulator profiling distinguishes a
roughly 1.1-second canonical commit from later observer/event-loop work, but
does not identify the dominant hosted wait. The next private-only diagnostic
records bounded stage durations, transaction attempts/read RPCs and process
CPU time, never identities, command bodies, sheets, tokens or passwords.
It preserves the exact request work order, quotas, live authorization,
durability and follow-up work. Its `[DEBUG-m5-receipt]` instrumentation is
temporary and must be removed after diagnosis. The completed full-session
gate remains open; this short aborted attempt is not four-hour acceptance.

### Measured observer scheduling and receipt-formatting corrections

The exact diagnostic image `60a6091` passes **37 source hashes** and the
unchanged isolated Linux gate, then publishes only as private revision
`taverntable-api-test-00018-ssp`. Its first zero-observer control reports
**3,495.830 ms** handler time and **1,870 ms** process CPU; the following
warm controls report **1,811.510/1,554.474 ms** handler time and
**820/930 ms** process CPU. Browser completion is separately
**1,997.400/1,746.800 ms**, unshaped and without observers. These few controls
do not establish p95 or ten-client acceptance.

The source-specific emulator feedback loop shows a real observer contribution:
durable completion is **2,597/2,718 ms** with ten observers versus
**1,417 ms** without them, including a **1.1-1.4-second** event-loop stall.
The source is shared once, not rebuilt independently for every viewer.
Profiling also attributes repeated complete native geometry serialization to
single entrance/door queries. The corrections are:

- Queue pure participant projections cooperatively between I/O turns without
  moving request work after response, weakening source/authority checks or
  dropping failed requests.
- Carry forward only immutable compiled geometry into fresh query-world forks
  when complete map contents match. Mutable edit operations, actor/combat data
  and participant outputs are not shared; changed heights and transforms
  invalidate the optimization.
- Select and defensively copy the requested native volume rather than saving
  every volume and private construction definition for each entrance or door.
- Build receipt budgets from the existing native combat/location rules, with
  lazy native world creation only when intermediate physical route conversion
  needs it. Command execution and complete outgoing scene validation remain
  authoritative and unchanged.

A focused query-fork regression fails before implementation and now proves
fresh actors, independent geometry edits and physical terrain/transform
invalidation. Rejected participant views do not poison the next queued
authorized view. Actual native control/receipt/flight/door/privacy regression
passes **251 tests / 19 suites**, **188.656 seconds**, with open-handle
detection. All **31** real managed HTTP/SSE world cases pass in
**413.283 seconds**. The generated 51-map/134-connection/eight-actor projection
gate passes at **696.622/218.904/220.660 ms**. A source-specific local HTTP
profile improves to approximately **1,505/1,509 ms** with ten observers;
its conservative 1.5-second diagnostic margin is still missed by 5-10 ms,
and is not relabeled a hosted pass.

The supported browser opener also permits separate owned test pages; it does
not require or authorize arbitrary isolated browser-context creation. The
primary managed player, other eight SDK clients and actual owner renderer are
being separated so one test page's native rendering/JSON work cannot
artificially block another client's measured receipt callback. Existing seats
and original assignments remain verified; no real owner sign-in method or
credentials change. The required actual 200-ms-RTT hosted p95 and complete
four-to-five-hour run remain open. No slow sample is discarded.

The matching optimized private revision `00019-wz4` and frontend
`f7d3fe51...` pass **38 exact source checks** and published-byte checks.
Supported separate owner/primary/eight-observer pages preserve all ten managed
identities and original seats. All three links independently recalibrate to
approximately 200 ms RTT, but the first isolated receipt still takes
**10,450 ms**. Its server trace attributes **2,232.884 ms** to canonical
command work and **7,759.111 ms** to assigned backup follow-up before response,
with **9,420 ms** process CPU across that window. Later valid receipts also
remain slow; they are retained and the private game is confirmed paused again.
This disproves treating test-page separation or admission CPU fixes as a
completed end-to-end performance fix.

Temporary diagnosis is therefore extended with a single in-process CPU sampler,
bounded to **15 seconds** and the **24 hottest function frames** per sampled
request. It opens no inspector network port and records no locals, arguments,
identities or payloads. Stage/CPU observations from this instrumented revision
are diagnostic, not latency acceptance; all temporary profiling code still
requires removal before the final release.

### Immutable public assets and location obstacles: private candidate

The bounded revision-20 control retains its **11,096.8-ms** durable receipt.
Its diagnostic handler takes **10,713.552 ms**, with **10,360 ms** process CPU
and **1,896.786 ms** sampled garbage collection. Static obstacle construction,
surface sight and native geometry allocation are hot. Elapsed backup spans
include concurrent observer work; they do not prove backup computation alone
uses the whole span. The nine member observations and raw owner observation
are now closed, and the actual owner session is verified **paused**, with zero
owner streams and no pending live control.

The candidate reuses deeply immutable, revision-checked location obstacle
snapshots; explicit preview geometry bypasses them. Query forks never inherit
unpublished geometry mutations, including a regression reproduced red before
the fix. Public asset graphs are fully validated before deep freezing and
structural certification. Mutable previously valid inputs, merely frozen
roots and failed certification cannot acquire that shortcut. Bounded static
artwork reuse requires exact map/connection/location contents and the current
visible-map selection. Fresh poses, sheets, image slots, gameplay, Undo and
authorization are not cached as authority. Location renames and physical edits
invalidate artwork reuse.

All temporary request-stage/inspector code, its store/HTTP hooks and its image
allowlist/checksum entry are removed from candidate source. The HTTP handler
still awaits canonical commit, applicable automatic backup work and change
maintenance before sending the receipt. Exact-image coverage now includes
the shared scene-data freezing module.

Local feedback remains explicitly distinct from hosted acceptance:

- The first unprofiled demo HTTP loop retains **1,927.355/1,723.747 ms** with
  ten observers, versus **1,657.986 ms** without observers. Its conservative
  **1,500-ms** local diagnostic margin fails; those observations are retained.
- A later isolated CPU-profiled loop records **769.157/804.460 ms** with ten
  observers, versus **660.321 ms** without. Combined local server/client CPU
  is **594/672 ms**, and event-loop stalls are **255.984/223.085 ms**.
  Environmental I/O variation and diagnostic sampling preclude treating these
  local values as the hosted receipt gate.
- Read-only, networkless Linux Node **24.22.3**, UID **1000**, CPU **1**/GiB **1**
  feedback uses the exact private 42-map/eight-actor source. Cold projection is
  **1,254.008 ms**; nine-view rounds are **823.614/134.834/95.565/89.473 ms**.
  RSS is **208,293,888 bytes**, maximum **217,260,032 bytes**. The committed
  public-result hash matches exactly, canonical input is unchanged, and there
  are zero historical updates, unchanged warm artwork bodies or authority writes.
- **252 native tests / 19 suites** pass with open-handle detection in
  **234.589 seconds**; all **31** real managed HTTP/SSE cases pass in
  **428.994 seconds**. All **five** focused projection cases pass, including
  fresh cross-generation poses/location metadata and certification trust.
  The generated 51-map/134-connection/eight-actor case projects in
  **757.033/233.296/228.329 ms**. Changed-source lint and layering pass.

These are candidate gates, not a new whole-repository stable result or a
completed M5-06. A matching existing-pilot image/frontend release, actual
200-ms-RTT ordinary receipt distribution and the complete real four-to-five-hour
session remain required. Production and selected-data cutover remain unapproved.

### Conservative vertical sight rejection: measured follow-up

The immutable candidate is published only to the existing private service as
`00021-9g2`, source `0afdf93...`, with matching frontend `0a99c475...`.
Its actual image passes **38** source hashes, both-edition native Cover/flight,
501 d20 frames, authority denials, CPU1/GiB1 isolation and graceful exit.
Published entry/native bytes and stable/retired/private-path routing match.
The normal stable-root/picker path preserves the real Google owner. Current
SDK classes reuse the exact nine already signed-in fixture principals without
credential changes; original returning assignments remain **4 + 2**.

All ten current observations reach generation 14 under separately recalibrated
200-ms links, with member startup **1,316-6,789.1 ms** and zero 503 responses.
Four valid ordinary facing commands are retained: durable receipts
**5,029.2/2,157.9/1,985.1/1,911 ms**, and SDK readiness
**5,031/4,250.4/4,019.1/3,976.7 ms**. All eight other member observations
reach generation 18; the native owner remains current without its earlier
sharing error. This is neither a twenty-sample receipt gate nor the full
session. All nine members are closed again; normal owner Pause is confirmed,
with zero owner streams/pending live control, restored transports and all
three precision workers stopped.

An isolated changed-generation feedback loop distinguishes repeated new heads
from cheap unchanged-frame cache hits. On exact revision-21 source, each of
four changed frames performs **126** geometry loads, **3,684** Add/Subtract
operations, **42** query clones and **1,081** surface sight queries. Geometry
cloning takes only **17-38 ms**; surface sight takes **431-544 ms** of each
**779-791-ms** frame. That evidence rejects more geometry-cache complexity as
the first fix.

The follow-up adds one shared native segment-sight helper. A conservative
vertical interval check rejects only solids entirely above or below the actual
ray before running the unchanged point-inside/exact convex intersection tests.
There is no new cache, spatial index, changed visibility rule or skipped
canonical validation. Floors, ceilings, observer-on-boundary behavior,
near-parallel rays and endpoint trimming remain covered.

With the same read-only/networkless CPU1/GiB1 source replay, changed frames
take **449.426/450.369/439.082/383.804 ms**; surface sight takes **57-94 ms**.
The same 126 loads/3,684 operations/42 clones/1,081 rays still occur. The exact
public-result hash and all eight observers match the committed unpruned
native world, and canonical input is unchanged. The generated
51-map/134-connection/eight-actor projection takes
**569.884/120.487/120.762 ms**. All five focused projection cases,
**253 native tests / 19 suites** with open-handle detection
(**232.203 seconds**), and **31** real managed HTTP/SSE cases
(**425.925 seconds**) pass. These local candidate results do not replace the
still-required hosted receipt distribution or actual four-to-five-hour run.

### Actual managed movement exposes repeated motion-world construction

The sight candidate is privately published as `00022-pdx`, source
`3d14ae1...`, frontend `57cb5484...`, with unchanged service/IAM settings.
Its exact image again passes 38 hashes and native/isolation/exit gates.
Current SDK classes preserve the original nine signed-in fixture principals;
the real owner uses the normal stable-root/picker path. All ten observations
start at generation 18 under 200-ms-RTT calibration.

Two valid facing receipts take **5,127.9/2,473.5 ms**, with SDK readiness
**5,130.2/4,448.6 ms**. The first actual five-foot move has HTTP 200 in
**3,639.3 ms** and is independently confirmed at canonical scene revision 21,
but six member presence acknowledgements abort and SDK readiness ends with
`stream-closed`. The game itself stays live, three other member observations
reach generation 21, and the native owner remains current. The move is not
resent or counted as a ready-client success.

Existing private revision request logs independently show server durations
**4.868191/2.217027/3.025643 seconds**, so the receipt tails are not solely
browser callback delay. ACKs that reach the server return quickly; the failed
client requests must not be relabeled successful from those server logs.
Hosted/original complexity checks retain the same eight records (5,410 bytes),
42 maps, eight actors, 116 connections and 1,228 volumes, with no added
placeables, sight/cover bounds or effects. Isolated real-SDK controls with zero
observers still take **3,626.6 ms** for movement and **2,215.5/2,057.5 ms** for
facing under the same added RTT. The moving actor is legitimately returned to
its original cell and preflight facing. All observers are then closed, the
game is verified paused, transports restored and precision workers stopped.

The private local feedback loop is corrected to use nine actual
`CloudPlayerSessionConnection` instances and a draining owner observation,
including real movement, SDK readiness and all-client convergence. Earlier
raw-stream receipt probes did not cover this complete consumer path.
That loop exposes **eleven** native world constructions for each move, versus
two for facing: live motion filtering reconstructs the complete source world
separately for every participant after their ordinary snapshot projection.

The candidate reuses the already validated, exact-content/catalog/ruleset-bound
projection source for movement filtering and uses immutable map query snapshots
for waypoint bounds. Per-recipient actor visibility, route clipping, private
cost removal and final fresh access/head checks remain unchanged. The local-host
fallback still builds its own world, with a focused equivalence/hidden-actor
regression.

In the complete local managed-client loop, movement world constructions fall
from **eleven to two**. Out/back SDK readiness changes from
**4,124.382/3,994.473 ms** to **2,500.587/2,437.583 ms**; all-client convergence
changes from **5,311.211/5,140.279 ms** to **3,062.458/2,953.510 ms**, and
combined process CPU from **4,297/4,220 ms** to **1,548/1,328 ms**.
Finite receipts still vary around **1.37-1.63 seconds**, missing the unchanged
1.5-second local diagnostic margin in some cases; this is not a hosted pass.
All **31** real managed HTTP/SSE cases pass (**425.218 seconds**), all **six**
projection cases pass, and **seven** directly related legacy authorization/Undo
tests pass in two suites (**2.246 seconds**). The generated 51-map projection is
**591.423/121.056/116.581 ms**. The twenty-sample hosted distribution and complete
four-to-five-hour rehearsal remain open.

### Same-transaction authorization metadata reuse: candidate

The shared-motion backend is privately published as `00023-rz7`, source
`0ba906c...`, with unchanged matching frontend `57cb5484...`. Its exact image
passes the existing 38-hash/native/isolation/exit gate. Two actual out/back
five-foot moves are accepted at generations 26/27. The primary and all eight
other member observations remain ready at generation 27 without stream errors
or 503 responses, and the native owner remains current. Free Play accepts both
moves while retaining zero turn-restricted movement debit. Durable receipts
still take **3,420.8/3,494.9 ms**, with SDK readiness **4,822/5,793.3 ms**;
those valid tails remain failures, not a twenty-sample or full-session pass.
All nine observations are closed again, normal owner Pause is verified, and
transports/precision workers are restored/stopped.

Further local stage timing attributes **380-457 ms** to whole-checkpoint quota
reservation and roughly **130 ms** to each repeated renewal, with full immutable
reads below 20 ms. A bounded multi-object staging/batched-renewal experiment
passes its new lease-ordering and revocation tests plus all 30 storage/quota
cases, but does not establish a latency improvement. Its uncommitted changes
are therefore completely reversed rather than published or retained as extra
complexity. The private patch and observations remain outside Git. Existing
immutable-object preflight lookups, delayed-lookup renewal and full-byte
verification remain unchanged, including protection against the pinned
emulator's missing create-only enforcement.

The next candidate removes duplicate campaign-head/seat reads from the same
Firestore authorization transaction. Internal access/live contexts retain those
already validated values; public grant/live projections still return their
original explicit fields. Snapshot preparation, current-head verification,
assigned backup/history work and native world authorization use the current
transaction's head instead of fetching the same document again. No context is
shared across requests or final checks: quota, publication, pause, pilot,
membership, access-generation and epoch validation still execute in their
original fresh transactions. Native world publication reuses only a head
returned by its own fresh authorizer, never the older preparation capture.

The complete local managed-client feedback loop now passes its unchanged
1.5-second finite-receipt diagnostic margin for every retained command:
**1,355.938 ms** without observers; **1,401.078/1,435.026 ms** for facing with
all ten clients; and **1,379.930/1,379.300 ms** for real out/back movement.
SDK readiness is separately **2,242.434/2,174.593/2,575.427/2,396.750 ms**,
and all-client convergence **2,325.429/2,264.946/2,905.200/2,710.070 ms**.
Movement still constructs only two native worlds. These are local candidate
measurements, not hosted acceptance; directly coupled authority/lifecycle
regressions and another exact-image/private-pilot gate remain required.

The coupled access/store/lifecycle/world gate completes **151 cases** in
**615.467 seconds**, initially **150 passing / one failing**. Its sole failure,
the paused-image due-backup fixture, reproduces unchanged against the exact
committed store as well as this candidate. The fixture starts its injected
clock at a fixed midnight while campaign creation uses the domain's actual
creation timestamp, so its original first backup was not yet due. The test now
advances explicitly to campaign creation plus five minutes and asserts that
the first due read completed a backup before testing subsequent private image
edits. The full original privacy/complete-backup/billing checks then pass on
both current (**8.906 seconds**) and committed (**9.164 seconds**) code.
No production backup interval or real/provider clock is changed. The other
150 coupled cases remain passed; this corrected isolated rerun is not claimed
as a new whole-repository stable result.

### Fixed forty-command hosted preflight: stable but latency gate failed

The metadata candidate is committed as `103ac90...` and published only to the
existing private API as `00024-2ps`, image `049eb798...`. Its exact CPU1/GiB1
runtime again verifies 38 source hashes, both-edition native controls, 501 d20
frames, auth/private-file denials and graceful exit. No frontend source changes
were needed: `57cb5484...` remains the matching current package.

The actual fixed sample retains **40 accepted commands**, equally split between
**20 five-foot moves and 20 facing controls**, across all nine existing member
identities and the actual native owner. The original returning assignments
remain 4 + 2. Source canonical generations are contiguous **28-67**. Before/after
actual link p95 is **206.8/209.4 ms** for the owner, **205.8/204.4 ms** for the
primary, and **205.9/205.7 ms** for the other clients. Product/provider clocks
are unchanged. One-second inter-command pauses are outside each measurement,
not removed from its receipt timing. No cold, backup or other valid tail is
discarded.

Nearest-rank results:

| Retained sample | Count | Durable median | Durable p95 | Durable maximum | SDK-ready p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| All accepted controls | 40 | 1,897.1 ms | **3,854.6 ms** | 4,473.2 ms | 4,591.3 ms |
| Actual movement | 20 | 1,992.1 ms | 4,369.3 ms | 4,473.2 ms | 4,813.1 ms |
| Facing controls | 20 | 1,804.9 ms | 2,920 ms | 3,854.6 ms | 4,064.8 ms |

Fifteen of forty durable receipts exceed two seconds. The all-command p95
therefore **does not meet the approved <= 2-second gate**. The three largest
receipt samples coincide with independently listed complete automatic backup
generations **28/35/50**; other ordinary valid tails also remain above target,
so backup work is not claimed to be the only cause.

All nine member SDK connections are still command-ready at generation 67 with
no access/stream errors; the native owner remains current, and there are zero
503 responses. Free Play movement costs are authoritative five-foot routes
with no incorrect turn-restricted debit. This demonstrates stable current
delivery, not a completed representative session or full rendered-animation
acceptance.

Normal owner Pause is verified after closing the nine members. Owner streams,
pending live control and pending world commands are all zero. Transports are
restored and all three precision workers stopped; real owner Auth and both
original local hosts remain untouched. Owner backup status is independently
**saved**, latest complete generation **67**. API, Firestore and the private
bucket are all confirmed in **us-west1**, so no cross-region mismatch explains
the result. The forty raw timing rows and prior failed preflights remain in
private operational state outside Git.

M5-06 remains open at 59/65 overall. The four-to-five-hour run, restore-as-copy
and compatible rollback proof, production approval and selected-data cutover
are not completed or implied. No queue, background service, new IAM permission,
CPU/limit change or relaxed latency requirement is approved by this result.

### Native motion priority and focused regression recheck (2026-11-16)

The owner clarified that a short delay is acceptable. The concern is a live
participant seeing a sprite jump from start to destination while another
participant sees normal walking/running. Immediate acceptance therefore focuses
on continuous native movement on the initiating view and other authorized
visible views, in both DM-to-player and player-to-DM directions. This does not
require identical animation-start times, grant hidden actors/routes, or change
the rule against replaying historical movement after reconnect.

No replacement numeric latency threshold was selected. The proposed 5/6/10-second
limits were not approved, and the retained two-second benchmark failures remain
honestly recorded rather than relabeled as passes. Receipt timing and client
readiness are not measurements of rendered animation.

The unchanged current source passes the focused native movement gate:
**32 tests / four suites, 120.261 seconds**, with open-handle detection. The gate
covers streamed player walk/run, received DM-view walk/run, another visible
creature without control grants, own receipt echoes, queued routes,
reconciliation, native locomotion clips and unchanged movement costs/camera.
Approved flight/fall and backward-motion regressions also pass.

The actual foreground hosted visual check is still incomplete. Desktop setup
did not reliably select the intended test view/control and encountered a user
input interruption. A current-release native render fixture was loaded but not
connected, then removed; this is neither a visual pass nor a reproduced current
product failure. A fresh authority read confirms the game remains paused, owner
streams are zero, no save/live/world command is pending, and the selected actor
remains at its original test cell. Fixture connections remain closed, temporary
render setup is removed, and no account persistence, real owner Auth, original
host, cloud setting or deployment changed.

The owner then explicitly instructed: "for now lets assume its successful and
move on. i will check wihen everythin gis complete". The manual native animation
check is therefore deferred to the owner rather than blocking continued private
migration, extended rehearsal and recovery work. It is not recorded as an
observed visual pass. The original timing observations remain unchanged, and
this instruction does not authorize new infrastructure, production deployment
or selected-data cutover.

### Extended real-clock rehearsal started; recovery preparation (2026-11-16)

The existing nine named, in-memory fixture identities and actual native owner
are freshly admitted on the same private API `00024-2ps` / source `103ac90...`
and frontend `57cb5484...`. No new account or infrastructure was created.
Pre-run added-RTT calibration p95 is **205.5 ms** for the owner, **205.5 ms** for
the primary member and **209.8 ms** for the other eight. Initial managed
admissions are **1,868.8-5,972.9 ms**, with native owner startup **3,429.6 ms**.
These are setup observations, not time credited to the representative session.

The first extended attempt lasted **67.0555 seconds**, not four hours. Eleven
real mixed commands applied, and an off-turn move was correctly refused without
changing generation 69. The run then stopped because the private harness loaded
the resource manifest relative to its deliberately retained old document instead
of the imported current-release module. The retired asset URL correctly returned
404; no note write had begun. All observations are retained, all ten scopes were
current at generation 82, and no pending command or 503 remained. Only the
private helper changed to pass the explicit current resource base URL. A focused
actual assigned-note save/read/restore then passed, advancing character revision
3 to 5 and reaching generation 84 without changing the original notes.

The replacement actual rehearsal starts at client UTC
**2026-11-16T18:52:20.077Z**. It does not count preparation or the aborted attempt.
Its initial hosted sequence verifies combat refusal/off-turn dice, Dash and Undo,
turn end, Free Play walk/run without turn-restricted movement debit, a live emote,
another exact assigned-note roundtrip (character revision 7 to 9), and warm
rejoins for the primary and an original returning account. The measured private
image bodies on those rejoins are zero; that image counter alone is not a
separate inline-graphics-body proof. All ten scopes are current at the recorded
generation 111 (scene revision 107, character revision 9), with no pending
operation or 503. The extended run is still in progress, not accepted as a
four-hour or rendered-animation pass.

Independent recovery readiness checks pass **three actual emulator cases /
33.560 seconds**: 2014/2024 complete restore preserves exact sheets, private
images, topology and resources, and uncertain restore keeps its original caller
and recovers one copy. The shared demo cluster is not reset. Existing SDK
PassThrough listener warnings are retained rather than suppressed. This is not
the actual real-owner restore or hosted rollback drill.

A read-only private API inspection confirms the same revision, min0/max1,
CPU1/GiB1, request-based CPU, concurrency 40, timeout 3600, origins and unchanged
IAM. A broad provider window including preparation and the aborted attempt has
42 nonempty memory samples, maximum **sample mean 409,264,128 bytes** against
1 GiB; this is not an instantaneous peak. Its coarse counters are 2,210 HTTP
requests, 53,498 Firestore reads, 2,228 writes and 971 Storage requests. They are
not attributed per command or falsely equated across provider windows.

The current complete stable gate now passes **307 suites / 4,067 tests** in
**1,820.696 seconds**, using `--detectOpenHandles --runInBand`, exit 0. This is a
fresh whole-suite result for the current implementation, unlike the earlier
focused gates or older 4,017-test baseline. It does not complete the ongoing
real-clock hosted rehearsal or the owner-deferred manual animation check.

### Extended attempt stopped; visible tracker corrected (2026-11-16)

The second extended attempt stopped after **1,173.8126 seconds** at client UTC
**2026-11-16T19:11:53.889Z**. The private helper's instantaneous readiness check
reported "The native owner is not ready" during a stream reconnect. The new
owner-events request began 992.6 ms before the assertion, and its successful
headers arrived 270.8 ms afterward. The owner recovered without a pending
mutation or 503, and all scopes reached generation **131**. This is not a
four-hour pass. A helper correction that waits for bounded normal reconciliation
is prepared separately; it has not yet been used for a completed run.

The game is now verified paused. All nine member observations are closed; owner
streams and pending save/live/world operations are zero. Test transports are
restored, all three latency workers and the private control channels are closed,
and the complete final backup is **saved at generation 131**, error null. Named
fixture sign-ins, real owner Auth, original campaigns/keys and cloud deployment
settings remain unchanged.

The owner identified that the working-checkout checklist still showed its
initial **5/65** state while progress had been recorded only in the isolated
migration worktree. This was a tracking workflow error. The checklist now has
a dated current-status summary, accurate **59/65** count, current milestone
states, explicit remaining/deferred checks and the fresh 4,067-test evidence.
Its working-checkout copy and this supporting evidence log are synchronized;
the unrelated edited proposal and the checkout's branch/code are not changed.
Future status updates must reach the working-checkout tracker as well as the
implementation worktree.

### Reconnection-aware extended rehearsal resumed (2026-11-16)

The private helper's correction is now exercised through an actual owner stream
reconnection, not only a syntax check. The bounded health check waits
**2,496.6 ms** and returns with the native owner and all nine managed member
scopes current at generation 131, with no pending mutation. The helper does not
change server clocks, authoritative permissions or the application release.

All prior attempts and valid observations are retained. The same nine named
fixture identities are freshly authorized/admitted, preserving the original
returning **4 + 2** observer assignments. Pre-run added-RTT calibration p95 is
**204.3 ms** for the owner, **204.0 ms** for the primary and **204.3 ms** for the
other eight. Native owner startup is **2,820.6 ms**; managed member admission is
**1,733.1-5,572.8 ms**. Setup is excluded from session duration.

The fresh actual run begins at client UTC **2026-11-16T19:48:10.195Z**. Initial
hosted turn/Free Play checks, Dash/Undo, an emote, the exact assigned-note
save/read/restoration (character revision 11 to 13), and two warm rejoins pass.
Transferred private image bodies are zero on those rejoins; inline graphic
bodies are not inferred from that image-only counter. The run remains in
progress and no four-hour completion is claimed. A bounded local checkpoint
timer only prompts inspection of real browser state; elapsed timer completion
is never acceptance evidence.

The actual implementation remains source `103ac90...`, API `00024-2ps`,
frontend `57cb5484...`, with unchanged private-only approval and runtime/IAM.
The owner's manual native animation check remains explicitly deferred. Updates
to this evidence and the checklist are mirrored into the working checkout.

### Ongoing checkpoint and fenced recovery preparation (2026-11-16)

At **1,685.204 seconds** of the third real-clock attempt, the native owner and
all nine managed members are current at generation **188** (scene revision 182,
character revision 13). There are **52 accepted world commands**, no pending
operation or permanent member access error, and no 503. The helper retained
normal reconciliation waits of **990.7 ms** and **7,000.3 ms**, separate from
durable receipt timing and the earlier 2,496.6-ms preflight proof. One aborted
owner presence ACK is retained and is not reported as a successful request.
The run remains in progress, not a four-hour pass.

Read-only recovery preparation successfully reads and validates the real retained
generation-131 complete file: **654,129 bytes**, version 2, eight records/eight
actors, 42 maps and 116 connections. Portable owner/role/key/seat claims are absent.
The file is held in private operational memory, not committed. No restore copy
has been created.

Artifact Registry confirms the exact current `049eb798...` and previous
compatible-candidate `ec364e4c...` OCI indexes and existing tags remain available.
Their source bindings come from the earlier verified publication fences;
availability is not misrepresented as a new image/runtime gate. Read-only Hosting
checks return 200/no-store for both current `57cb5484...` and retained
`0a99c475...` entries, 302/no-store from the retired `ece3f79f...` entry to current,
and 404/no-store for an unknown retired asset. Hosting has not changed.

A local recovery package activates the retained compatible frontend while
preserving **both complete frontend trees**, all **six known retired-entry
bridges**, the same explicit account/API runtime and unchanged provenance.
Existing package verification passes **1,216 files / 578,532,930 application
bytes**, with every application file hash unchanged. It is not published.
A temporary incompatible participant-contract package is rejected with
`invalid-frontend-package` before artifact reads/deployment; the exact temporary
files/directories are removed. This is a package guard, not a live client-drain
test.

A private operator helper is pinned only to the two already approved image
digests. Mutation requires an actual completed-rehearsal evidence file and keeps
the existing ETag, image-only update, settings, latest-traffic and IAM guards.
Syntax, refusal without that evidence, and read-only live preflight pass.
No image, Hosting, infrastructure, IAM, production or source-of-truth change is
performed. Actual owner restore-as-copy, live compatibility/rollback and
incompatible-client drain proofs remain outstanding.

### Real presence-renewal denial isolated; rehearsal remains incomplete (2026-11-16)

The third attempt stops after **2,664.6971 seconds** at client UTC
**2026-11-16T20:32:34.892Z**. It is not a four-hour pass. The primary member
entered terminal `denied`/`campaign-not-found`; the owner and eight other members
remain current at generation **219** (scene revision 213, character revision
13). There are **83 accepted world commands**, no pending mutation and no 503.

The failed 404 is specifically the existing `/live/presence/ack` request.
The downstream SSE abort is not mistaken for the original failure. The fixture
still has the same UID, verified token claims and an unexpired credential.
Fresh access with the original seat/access generation succeeds, and a fresh
participant snapshot also succeeds at generation 219 for the original observer.
No account, UID, seat or permission is reset to obtain those proofs.

Source inspection identifies the relevant distinction: presence acknowledgement
and renewal first validate current campaign eligibility/access, then currently
report a missing/foreign channel as campaign-not-found. The managed live client
treats that as terminal campaign denial, whereas it already retries the typed
client-presence-expired outcome. A focused regression will verify the stale
channel path and preserve uniform foreign/missing-channel privacy plus genuine
membership-revocation denials before any fix is accepted.

All nine member observations are now closed. Normal owner Pause is verified,
with zero owner streams/pending operations and complete final backup **saved at
generation 219**, error null. Transports are restored; all three precision
workers and private control channels are closed. All accepted data/timings and
diagnostic captures are retained. The original hosts/keys and real owner Auth
are unchanged. Recovery packages remain local/read-only preparation; no rollback,
production deployment or cutover occurred.
