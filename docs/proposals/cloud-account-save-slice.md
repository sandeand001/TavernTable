# First cloud slice: account access and durable campaign saves

**Status:** verified development account/owned-campaign and atomic save backend.
Browser integration and the M1 exit gate are incomplete; nothing is deployed.

**Scope:** the first pair of Modules selected in the
[approved proposal](./cloud-accounts-and-multiplayer.md#11-five-deepening-opportunities).

**Inputs:** [preparation, inventory and verification decisions](./cloud-migration-preparation.md).

## Constraints and choice

Keep the existing canonical campaign/character serialization, two coordinated
revisions, ruleset/source pins and native rendering. Retain the explicit local
cookie/CSRF/SQLite Adapter. The cloud edition must not turn a verified login into
global DM authority or a cache into writable authority.

The current [CampaignStore](../../src/campaigns/CampaignStore.js) and
[CampaignCharacters](../../src/campaigns/CampaignCharacters.js) expose meaningful
create/read/commit operations. The
[SQLite transaction Adapter](../../tools/campaign-storage.js) also supplies
atomic nested work used by authoritative gameplay. Firestore retry callbacks
cannot simply replace those callbacks: uploading an object or rolling dice
inside a retried callback would duplicate side effects.

| Candidate                                                                                                                        | Decision                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Replace low-level disk calls with Firestore/Storage calls inside existing transaction callbacks                                  | Reject: no shared object/database transaction; retry side effects and partial publication would escape the existing guarantee. |
| Introduce a new event-sourcing framework and rewrite canonical rules/terrain records                                             | Reject: unnecessary scope, two representations/owners and poor locality for this slice.                                        |
| Retain high-level store operations; prepare domain changes in isolation, then publish immutable objects and one CAS head/receipt | Choose: preserve callers and concentrate durable publication behind the existing storage Seam.                                 |

These are two deep Modules, not separate deployments. The cloud HTTP Adapter,
verified identity, canonical validation and publication can live in one Node
backend. [ADR-0001](../adr/ADR-0001-terrain-engine-event-seam.md) is unchanged.

## 1. Account and Campaign Access Module

### Browser-facing Interface

The account Adapter owns:

- Google and Firebase-managed email/password sign-in/registration.
- Auth persistence, renewal, sign-out and subscription to identity changes.
- Password-account verification/recovery and refresh after verification.
- Obtaining an ID token for a protected request, without putting it into URLs,
  campaign caches, logs or custom password storage.

The identity result contains a Firebase UID, verification/eligibility state and
explicit signed-out/error states. It does **not** contain a permanent global
`dm` role. Display name/email are not authority.

The existing local [SessionLogin](../../src/ui/sessions/SessionLogin.js) remains
the local Adapter. Cloud mode is selected explicitly by public runtime
configuration; an invalid cloud configuration or failed request does not select
local/browser storage. Load cloud-only SDK code only for that selected mode.
Preserve the native ESM approach; pin browser/test SDK versions together.

### Backend Interface

For each protected request:

1. Verify the Firebase ID token for the configured project, including validity
   and verification/revocation requirements.
2. Resolve application eligibility from server-owned data.
3. Resolve campaign-local owner/member access from current committed records.
4. Return a verified principal/access outcome to the requested operation.

The principal is server-created, never a request-body `uid`, `owner` or role.
M1 supports private owner creation/list/open/save. Joined seats, invitations,
provider linking and full player operation coverage remain M2 tasks.

Eligibility is separate from authentication and ownership. Emulator-only Admin
fixtures seed labeled eligible accounts; the browser cannot self-enroll as
eligible or claim an existing campaign. The real pilot's initial enrollment is
an explicit operator action, not "the first person to sign in owns everything."

### Permission and denial invariants

- UID-A can own a campaign; unrelated eligible UID-B cannot discover its
  private metadata, read snapshots, commit changes, or redeem another UID's receipt.
- A selected campaign's editor capability may be adapted to the existing owner
  UI, but it is scoped to that campaign and rechecked on the backend.
- Unknown/private campaign lookup must not disclose ownership through different
  detailed errors.
- Verification, eligibility and role denials remain explicit, without creating
  new campaigns, guessing identities or silently losing the current draft.
- Account linking must later prove both credentials and preserve UID; matching
  identity text is never a fallback.

The complete operation matrix remains in the checklist. M1 is not a multiplayer
release or a substitute for M2/M3/M4 permission, streaming and lifecycle gates.

## 2. Durable Campaign Commit Module

### Existing caller Interface to preserve

The browser cloud store Adapter retains the applicable high-level operations
used by [CampaignWorkspace](../../src/campaigns/CampaignWorkspace.js):

```text
create({name, ruleset, packIds})
list()
get(campaignId)
readCharacters(campaignId)
readScene(campaignId)
commitScene(campaignId, {ruleset, revision, charactersRevision, scene})
commitCharacters(campaignId, {ruleset, revision, records, scene?})
```

`records` remains the canonical `{key, value}` rows; `scene` remains the canonical
JSON string or null. Existing `CampaignCharacters` validation/staging and
`CampaignScene` encode/decode remain the rules/serialization authority.

Retain receipts and current-revision conflict fields expected by existing
callers. Cloud-specific storage preparation does not become knowledge required
by sheets, autosave, TerrainEngine or renderers.

Expose unsupported first-slice features through explicit capabilities/disabled
controls, not no-op success. Invitations, full backup UI, participant SSE and
cloud gameplay remain gated until their tasks pass. Owner preparation/save
proof is not a claim that live play is implemented.

### Snapshot/head representation

Use compact private metadata and immutable object references, conceptually:

```text
campaign head:
  schema version
  server-owned owner UID
  canonical campaign metadata/source pins
  monotonically increasing head generation
  scene revision + characters revision
  scene saved-at value
  scene object reference or null
  character-record object reference

object reference:
  private object path
  exact UTF-8 bytes
  SHA-256
  GCS generation
```

Keep large scene strings and character-record arrays in private Storage JSON
objects, not Firestore fields. Reuse unchanged referenced objects so a sheet
change need not upload unchanged terrain. Preserve embedded-image compatibility
initially; later participant manifests reference authorized asset hashes instead
of repeatedly transmitting image bodies.

Initial command JSON is capped at 24 MiB encoded UTF-8 bytes and immutable JSON
objects at 32 MiB, separately from canonical scene/character character limits.
Later large-asset transfer remains its own capability, not a local fallback.

Objects have server-generated campaign-scoped/content-addressed paths and
immutable creation preconditions. Existing content at an immutable path is
reused only after verifying its identity/integrity; a collision is not permission
to overwrite it. Reads bind the captured generation and verify reference
size/hash/schema before returning data.

All related references and both revisions come from one captured committed
head. Reading a newer scene with older characters is not allowed. The normal
workspace opening check can detect a subsequent head change and ask the user
to reopen rather than mixing revisions.

### Command/receipt contract

Every mutating cloud request carries a stable command ID. The backend binds
that ID to verified UID, operation, campaign/context, expected revisions and a
deterministic intent fingerprint. Reads do not manufacture writes.

- New command: prepare/publish once and return the committed receipt.
- Identical retry after a lost response: return the original result, with
  currently authorized state where applicable.
- Same ID with different intent: typed conflict, not a second mutation.
- Create uses UID-scoped durable receipts so retry cannot create another campaign
  merely because the server prepared another random campaign ID.

IDs/uncertain operations remain pending in memory for explicit online recovery;
this is not a durable offline upload queue. Token renewal retries preserve the
same command ID. New editing cannot conceal an unresolved save outcome.

Keep receipts compact in Firestore. Ordinary save receipts contain revisions
and timestamps; future large gameplay results require protected immutable
references rather than an oversized document. Do not copy the journal's
24-hour retention into receipts or permit receipt expiry to re-execute an old
command. Any pruning/epoch protocol needs its own tested correctness rule.

### Publication sequence

1. Authenticate, check eligibility/owner access, and read one committed head.
   Look up a prior durable command receipt before preparing work.
2. Load referenced private state and pinned catalogs. Validate canonical input
   using existing domain logic; prepare resulting state in isolated memory.
   Isolated preparation is not a second live terrain owner.
3. Stage and verify new immutable objects outside the Firestore transaction.
   Apply UTF-8 byte/request/object limits explicitly; large-file transfer is
   separate from compact head publication.
4. In a Firestore transaction, recheck current access, command receipt and both
   expected revisions. Publish the new head, compact receipt and durable change
   marker atomically. No uploads, physical rolls or external side effects occur
   inside retryable callbacks.
5. Return the committed receipt only after publication succeeds. The existing
   UI may then report Saved to cloud and adopt the new canonical state.
6. Deliver later participant updates only from committed state. Unpublished
   candidates are orphan-cleanup work, not successful saves.

If another instance wins publication for the same command, return its receipt.
If another intent changed the expected head, return a conflict without blindly
rerunning domain actions or replacing the newer state. An in-memory queue is
only an optimization; maximum-one-instance is not the consistency rule.

### Failure outcomes

| Condition                                                | Required result                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Missing/invalid/expired identity                         | Explicit unauthenticated response; renew/re-authenticate deliberately.  |
| Unverified/ineligible account or insufficient known role | Explicit access denial; no writes or local fallback.                    |
| Unknown/unrelated private campaign                       | Non-disclosing lookup denial; no metadata/object body.                  |
| Invalid schema/ruleset/record/scene/hash                 | Explicit validation failure before publication.                         |
| Byte/request limit exceeded                              | Explicit too-large error; never truncate or claim success.              |
| Expected revisions differ                                | `409 stale-revision` with authorized current scene/character revisions. |
| Command ID reused for another intent                     | `409 command-id-conflict`; no repeat cost.                              |
| Upload failure before publication                        | Head unchanged; staged garbage is not visible committed state.          |
| Lost response or forced termination after publication    | Retry/reopen recovers the original durable receipt/head.                |
| Backup delayed/failed                                    | Separate backup state; primary save acknowledgement stays truthful.     |

## 3. UI and runtime integration rules

- The normal account/owned-campaign flow must drive the real workspace/save
  paths; a console-only fake save is not the vertical-slice exit proof.
- Use explicit cloud/local configuration, verified account state and campaign
  capabilities at startup. Existing local and native-player startup remain
  regression-covered.
- Preserve `CampaignCharacters` mutation queues, coordinated scene captures and
  two-second/ten-second autosave timing. Saving/Saved to cloud/Not saved follow
  durable receipts, not page unload or local animation completion.
- Between-game preparation/sheet persistence does not itself start a live game.
  Do not advertise owner/member live gameplay before the corresponding
  lifecycle/authority tasks exist.
- A snapshot/reference/cache is serialized committed state, not another
  authoritative TerrainEngine. Render/camera/animation objects never enter saves.

## 4. Development and acceptance

Use one explicit `demo-taverntable` project with loopback Auth/Firestore/Storage
emulators. Reject missing/mixed endpoints and real-project fallback before
creating SDK clients. Do not change the existing real Firebase configuration or
browser deny rules to make tests pass.

M1 proof must use actual emulators, not mocked upload/transaction success:

Ordinary unit/UI regression checks remain on Jest. The real SDK integration
suite uses Node's built-in runner to preserve native SDK stream behavior; it
retains the SDK's default integrity checks and exact downloaded-byte assertions.

1. Both account choices, verification/recovery, persistence and renewal.
2. Eligible owner creation/list/open; unrelated eligible UID denial.
3. A snapshot above 1 MiB stored outside Firestore with exact hash/byte checks.
4. Joint scene/character publication and valid canonical reopen.
5. Upload/transaction/conflict/lost-response faults and independent backend
   overlap, with one result and no partial resource spend.
6. Clean-browser/backend restart recovery and no writable local fallback.
7. Relevant local regressions, lint/layering and the stable milestone suite.

The [verification matrix](./cloud-migration-preparation.md#tests-and-proof-required)
and execution checklist hold the completion evidence. Java 21+ is a tooling
prerequisite, not a reason to run tests against live resources. Hosted testing,
runtime IAM, licensing clearance, production deployment and real campaign
cutover retain their separate approval gates.
