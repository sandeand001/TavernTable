# Cloud migration: preparation and verification

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

### M4-10: hosted permission and identity gate in progress

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
ID token is held **only in memory** until its literal expiry; that check is still
running at this update. No application traffic is scheduled during the wait.
The registered synthetic fixtures intentionally remain until the run's automatic
exact cleanup; another fixture run must not overlap it.

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
The genuine expiry and declared seeded-counter/actual-stream quota checks
must finish before M4-10 is checked complete.

### M4-11: verified alerts and measured platform observability in progress

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

An isolated real per-save probe is prepared but not yet run: a quiet lead-in,
five validated paused sheet saves in one known provider minute, exact raw
Firestore read/write counters after the documented four-minute ingestion lag,
and matching observed client/Cloud Run request totals to reject contamination.
It then verifies a fresh scoped reopen. Separate timestamps distinguish
validated durable acknowledgement from remote SDK delivery, not animation
completion or a controlled-200-ms performance result.

M4-11 remains incomplete until those operation/timing measurements and the
remaining observation checks pass. No production campaign migration, new
runtime privilege, always-on service or automatic billing shutdown is authorized.
