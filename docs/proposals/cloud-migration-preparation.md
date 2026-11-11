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

`M1-05` and `M1-08` remain in progress.

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
cloud-board success is inferred from account/launcher tests. Actual Chrome/GPU,
clean-browser/backend replacement, the complete native emulator rerun and the
full stable/forced-termination M1 gate remain pending.
