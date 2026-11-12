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

`M2-04` is blocked and deferred, not complete. The prototype two-step interface
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

| Path | Real-interface evidence |
| --- | --- |
| Name/source metadata | Empty-state consistency, unique winner, four-instance identical replay, stale/foreign/invalid source denial and exact captured-generation checks. |
| Sheets, owned resources and layouts | A real cloud character owns a supplemental spell and Favorite; disabling its pack retains the same owned ID, layout and source version, but blocks new additions. A stale sheet write cannot spend or replace records after the source revision advances. |
| Embedded image/notes records | A valid generated PNG and notes survive in byte-identical character rows; canonical image data is not silently replaced with an external URL. Participant binary delivery is still `M2-06`. |
| Scene, doors, terrain, camera and positions | Real 2014/2024 connected-world snapshots include walls, doors/stairs, changed physical position/facing/run mode and committed movement/turn state. Settings publication and independent reopening preserve exact scene bytes and values. |
| Atomic spending and retry | Existing joint character/scene cases and new settings faults preserve the revision/receipt contract. A real publication precondition failure rolls back; a deliberately lost successful HTTP reply recovers the same command exactly once. |
| Local compatibility | Existing local campaign, character, SQLite storage, host Adapter, scene/world and autosave tests continue to pass. |

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
