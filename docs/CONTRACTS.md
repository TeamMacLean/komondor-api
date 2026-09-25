# Consumer contracts

How komondor-api's HTTP surface is described, who depends on it, and what has
to happen before that surface changes.

The short version: **`openapi.yaml` in this repo is the description of record**,
it describes what the server _does_ rather than what anyone wishes it did, and
API changes are gated against consumer contract suites rather than against
hand-maintained lists kept in step by memory.

## Who consumes this API

| Repo               | How it talks to us                                                                                                                             | What breaks it                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **komondor-web**   | Nuxt 2 + axios, `baseURL: process.env.API_URL`. Interactive UI; the `@nuxtjs/auth` local strategy posts to `/login` and reads `/me`.           | Response _shape_ changes, and status codes — its `plugins/error-handler.js` acts on 401 globally and leaves everything else to call sites. |
| **komondor-power** | Nuxt 3 server routes via `server/utils/komondorApiClient.ts`. Bulk CSV ingest: creates projects, samples and runs in sequence.                 | Idempotency semantics and the `detail` field. It retries, so a create that is not idempotent duplicates data.                              |
| **komondor-nudge** | **Does not use HTTP at all.** A scheduled worker that connects to the same MongoDB and reads the `projects` and `groups` collections directly. | _Schema_ changes, not API changes. It has its own read-only mongoose models in `models.js`.                                                |

That third row is the one people forget. komondor-nudge is a consumer of the
**data model**, not of the API, so an OpenAPI spec cannot protect it and a
change that is invisible over HTTP can still break it. Its models file says so
explicitly: the only field it writes is `Project.nudges`, via `$push`.

## ENA administrator creation access

The API's `ENA_ADMINS` grants cross-group reads and permission to create
projects, samples and runs in any active group. It accepts JSON arrays,
single-quoted arrays (as used by komondor-web), or comma-separated usernames;
matching is by complete username. `/groups` returns all active groups for these
users, which populates the existing New Project dropdown. Samples inherit the
project's group and runs inherit the sample's group.

This capability also permits run ingestion through duplicate `/runs/new`
submissions and `/runs/{id}/reingest`, including adding staged files to an
existing run when its ingest job is missing. Existing jobs retain the queue's
idempotency and failed-job retry rules. Deleted groups and read-only project
storage still reject creation/ingestion.

`FULL_RECORDS_ACCESS_USERS` alone remains read-only across groups. Keep the
ENA admins in that list as well for accessions export and HPC staging tools.
ENA membership does not set `isAdmin`, expand the token's membership claims, or
grant group administration and other general write permissions. Ordinary users
still need membership of the target group. Restart the API after changing its
environment; existing tokens need no new admin claim.

## The drift list

Each of these is a place where a consumer's belief and this server's behaviour
came apart. All of them are documented in `openapi.yaml` as current behaviour —
several are flagged there as `DRIFT` or `DEFECT`, because the spec's job is to
describe reality, not to describe the intended design.

### 1. Routes are mounted at the ROOT, not under `/api`

`app.js` calls `app.use(authRoutes)` with no path prefix. Login is
`POST /login`.

The stale comment `// Add POST - /api/login` above the handler in
`routes/auth.js` is where the belief came from. komondor-power's client still
tries `${baseUrl}/auth/login` first and falls back to `${baseUrl}/login` when
that 404s — every login it performs costs a wasted round trip, and the fallback
is commented "based on code inspection inference", which is exactly the thing a
published spec exists to replace.

### 2. Bearer tokens must carry an `exp` claim

`lib/utils/getUserFromRequest.js` rejects a correctly signed token with no
`exp`, raising `TokenExpiredError` → 401. See the commit _"refuse legacy tokens
without an expiry claim"_ and BREAKING_CHANGES §14.

Two consequences worth stating to consumers:

- Tokens minted before this landed are dead. There is no migration; the user
  signs in again.
- **Group membership is a login-time snapshot.** `groups` is baked into the
  token by `getUserForToken` and never re-read. Adding a user to a group has no
  effect until their token expires (`JWT_EXPIRES_IN`, default `7d`). The expiry
  is the upper bound on that staleness — which is the actual reason the expiry
  requirement matters, not merely hygiene.

The 401 body is not uniform, and clients need both shapes:
`{ error: "Authentication required" }` from a route's `isAuthenticated` guard,
and `{ error: "Invalid or expired authentication token", detail }` from the
app-level middleware in `app.js`.

### 3. `Group.deleted` is a soft-delete flag

`POST /groups/delete` sets `deleted: true` and saves. Nothing is removed: not
the document, not its directory under `DATASTORE_ROOT`, not the projects
pointing at it. `POST /groups/resurrect` reverses it.

Consumers used to filter this themselves. komondor-nudge declares `deleted` on
its read-only group model specifically so it can skip those projects, recording
the decision as `GROUP_DELETED` — a client compensating for a server behaviour.

**The server now decides.** `Group.GroupsIAmIn` excludes soft-deleted groups
for everybody, admins included, in both read and write mode. A deleted group
therefore stops authorising anyone and disappears from `GET /groups`. The
komondor-nudge filter is now redundant rather than wrong.

Two consequences worth knowing:

- `POST /groups/resurrect` and `POST /groups/delete` fetch by `Group.findById`,
  which is not the filtered path, so a deleted group can still be resurrected.
- Since nothing else lists them, an admin may pass `GET /groups?includeDeleted=true`
  to discover what there is to resurrect. Without it, komondor-web's admin
  "Deleted" tag can never appear — that page must send the parameter.

### 4. `Project.nudgeable` is honoured only as a real boolean; otherwise the group decides

`POST /projects/new`:

```js
const explicitNudgeable = asBoolean(requestedNudgeable);
const nudgeable = explicitNudgeable ?? targetGroup.sendToEna === true;
```

This replaced a hard-coded '2Blades' group ObjectId, which was a stand-in for
exactly this flag but only ever covered one of the two groups carrying it. So:

- A `nudgeable` sent as a **real JSON boolean** is stored as sent.
- Anything else — notably the strings `"true"` / `"false"` — is discarded in
  favour of the group default, with a `[projects/new] Ignoring non-boolean
'nudgeable'` warning naming the type and the user. komondor-power carries a
  `project_nudgeable` column through its entire CSV validation pipeline, but as
  of this writing it is not sent on this call at all — see "Needs coordinated
  action in komondor-power" below.
- The two write paths are deliberately asymmetric: a non-boolean is a **400**
  on `PUT /project/toggle-nudgeable` (where `"false"` would otherwise set the
  opposite flag) but a **fallback** on create (where a 400 risks breaking
  komondor-power's whole upload over one column).
- `PUT /project/toggle-nudgeable` now requires **write access to the project's
  group**. It previously had no authorisation beyond "is logged in", so any
  authenticated user could flip the flag on any project.
- komondor-nudge distinguishes `false` from _absent_ (`NUDGEABLE_UNDEFINED`,
  gated by `NUDGE_INCLUDE_UNDEFINED_NUDGEABLE`). The API can no longer produce
  an absent value, but old documents have one.

**Deploy-time data check.** `Group.sendToEna` now decides this at creation, and
`add_default_groups.js` sets `sendToEna: false` for **both** `two_blades` and
`bioinformatics`. New projects in `bioinformatics` will therefore be created
non-nudgeable where the old hard-coded check made them nudgeable. Any group
document predating the field has `sendToEna` undefined and yields
`nudgeable: false`. If that is wrong, the fix is data — set `sendToEna: true`
via `POST /groups/edit`, which already accepts the field — not code.

### 5. `Run.status` and `Run.md5VerificationStatus` are different enums

| Field                   | Values                                         |
| ----------------------- | ---------------------------------------------- |
| `status`                | `pending`, `processing`, `complete`, `error`   |
| `md5VerificationStatus` | `pending`, `in_progress`, `complete`, `failed` |

Note `processing`/`in_progress` and `error`/`failed`. They mean analogous
things and are spelled differently. Do not map one onto the other.

Both are enforced by the mongoose schema, so an unknown value cannot be stored
— but a client that switch-cases on one enum and receives the other will fall
through its default branch.

### 6. `LibraryType.indexed` cannot be set through the options API

The field exists on the model with `default: false`. But
`registerOptionRoutes("/options/librarytype", …)` maps only `value`, `paired`
and `extensions` into the new document, so `POST /options/librarytype` always
creates it as `false`. Today it can only be set directly in MongoDB.

Because the default is `false` rather than undefined, documents predating the
field report `false` too — "not indexed" and "unknown" are indistinguishable.

`Run.libraryType` still stores a string rather than a reference. Run creation,
reingest replacement and the ingest worker now resolve that string against the
`LibraryType` collection and enforce its `paired`/`indexed` flags. Renaming or
deleting a value therefore does not silently change an old Run: a later retry
fails loudly as an unknown type. It still leaves an operational repair to do,
so treat `LibraryType.value` as immutable once Runs use it.

Before an API cutover, `scripts/inspect-ingest-backlog.js` checks unfinished
jobs against those exact option values and their paired/indexed flags. It
rejects duplicate values and casts legacy raw Boolean values exactly as the
worker's Mongoose model does. Run it again after writes are quiesced; an
earlier read-only result is not a lock.

### 7. Idempotent create: 200 means "already existed", 201 means "created"

`POST /samples/new` and `POST /runs/new` look for an existing record first
(sample: same `project` + `name`; run: same `sample` + `name`). If one exists
they answer **200** with the _pre-existing_ document and `idempotent: true`. A
real insert answers **201**.

```jsonc
// 200 — nothing was created
{ "sample": { … }, "idempotent": true, "message": "Sample with this name already exists for this project" }

// 201 — created
{ "sample": { … } }
```

Branch on the status code, or on the presence of `idempotent`. A client that
treats 200 as "created" double-counts; one that treats anything but 201 as
failure breaks on retry — and komondor-power _does_ retry.

Two asymmetries: the sample lookup only runs when both `name` and `project` are
present, so a nameless non-TPlex sample is never deduplicated; and
`POST /projects/new` has **no** idempotent branch at all — a repeated name hits
the unique index and fails.

And `POST /runs/new` returns its 201 **before doing the work**. The run record
and a durable ingest job are written first, but file movement, the overseer
email and MD5 verification all happen later in a background worker, so a 201
means "the run record exists and the ingest is queued", not "your files
arrived". Failures after that point can never reach the client; they land in
`run.status = "error"` with the cause in `statusError`, and in the job's own
`ingest.status`/`ingest.lastError`. Poll `GET /runs/{id}/status`.

**A failed ingest now has a retry.** `POST /runs/{id}/reingest` returns a job
sitting at `failed` to the queue: `attempts` back to 0, no lease, and the run
moved back to `pending` with `statusError` cleared. It requires creation/ingestion
access (group WRITE access or `ENA_ADMINS`) to the run's group and answers
**409** if the job exists but has not failed, so a
retry can never clobber a healthy or in-flight run.

Re-POSTing to `/runs/new` does **not** do this. The enqueue is keyed on the run
id and uses `$setOnInsert`, so it finds the dead job and changes nothing —
`/runs/{id}/reingest` is the only way to retry one. The idempotent branch of
`/runs/new` also requires creation/ingestion access to the **existing run's** group, which
can differ from its sample's group for runs predating the group remediation.

A reingest body is a partial correction by default. `rawFiles` and
`additionalFiles` entries omitted from it are retained whether or not they
have already reached the datastore; this prevents correcting one failed file
from silently deleting another failed file. Entries under delivered names may
change relationship metadata (`sibling`/`paired`) but not their immutable file
descriptor. A changed delivered descriptor returns **409**.

To make a submitted list the complete desired list, set `replaceRawFiles: true`
or `replaceAdditionalFiles: true` and provide the corresponding array. Only
omitted **undelivered** entries are removed; delivered entries cannot be
removed through reingest. The final merged raw list must still satisfy the
Run's stored `LibraryType` (all biological reads paired when required, index
reads present when required, and no contradictory flags), and the worker
repeats that invariant before moving bytes.

Because `{ sample, name }` is unique on `Run`, two concurrent retries of a lost
201 can both miss the lookup; the loser of the save race re-reads the winner
and returns the same idempotent 200 rather than a 500.

### 8. The error envelope, and the four routes that ignore it

`handleError` in `routes/_utils.js` and the terminal handler in `app.js` both
emit:

```jsonc
{
  "error": "Failed to create new project.",
  "detail": "E11000 duplicate key error …",
  "requestId": "1735689600000-k3j9x2p1a",
}
```

`detail` carries the underlying message and is present **even for production
500s** — komondor-power is an internal client and relies on it. `requestId`
correlates with the server log line.

The exceptions, all of which clients must special-case:

| Route                                    | Deviation                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /login`                            | Reports failure as `message`, not `error`. The only route that does.                                                                                                    |
| `GET /read-file`, `GET /directory-files` | Report failure as **HTTP 200** with `{ error }` — but answer a real 403 for a rejected path, so both branches are needed. Deliberately preserved (BREAKING_CHANGES §9). |
| `GET /me`, `/groups/*`                   | Bare `{ error }` — no `detail`, no `requestId`.                                                                                                                         |
| `POST /accessions/new`                   | Success is 200 with an **empty body**. Do not parse it as JSON.                                                                                                         |

`GET /read-file` goes further: on success it returns the file's **raw text**,
and on failure a **JSON object**. The body type depends on the outcome.

komondor-web's `utils/apiError.js` already documents all of this from the
client side. That file existing at all is the symptom this policy addresses:
a consumer reverse-engineered the contract and wrote it down in its own repo,
where this repo cannot see it go stale.

### 9. Storage state is Project-owned; its 409 is terminal for komondor-power

`Project.storage` is the only stored lifecycle. A missing field is legacy
`hpc`; Sample and Run responses derive `projectStorage` and never persist their
own copy. Consumers must use `projectStorage` on children even when a populated
relationship happens to include the Project's `storage` as well.

An authorised storage-bearing create or reingest against any state other than
`hpc` answers 409 with the stable code `PROJECT_STORAGE_READ_ONLY`. This is an
authoritative state decision, not a transient conflict. komondor-power must
keep 409 out of its retry set, stop creating later descendants, and report the
Project that needs operator attention. The API performs the check again before
side effects, so this response wins even if Power validated the Project before
an operator locked it.

The public `storage`/`projectStorage` summary is intentionally sanitised.
Migration ids, operator identities, manifest locations and digests are never
part of the HTTP contract. Detail routes supply a ready-made `location`; web
clients should not reconstruct an HPC or S3 root from entity paths.

## Needs coordinated action in komondor-power

**`POST /projects/new` honours a client-supplied `nudgeable`, but
komondor-power does not currently send its own value — this API-side fix is
inert until Power is changed to match.**

Drift item 4 above describes this repo's side: a real JSON boolean in the
`nudgeable` field of the `POST /projects/new` body is stored as sent, instead
of always being derived from the target group. That was fixed so
komondor-power's `project_nudgeable` CSV column could reach the database.

It cannot, today. `server/utils/insertMetadata.ts` in `komondor-power` builds
the create request as `nudgeable: !doNotSendToEna` — it does not forward its
own `project_nudgeable` input under that field at all. So regardless of how
`project_nudgeable` serialises, the value this API actually receives is the
negation of `doNotSendToEna`, not the column Power's CSV pipeline collected.
Every project komondor-power creates falls back to this API's group-derived
default in practice, exactly as it did before the fix — nothing observable
changed for that consumer.

This is a `komondor-power`-side change: `insertMetadata.ts` needs to send
`nudgeable: project_nudgeable` (or whatever that repo's parsed value is
called) instead of `!doNotSendToEna`. Not investigated further here — this
repo does not modify `../komondor-power` — but the field names above should be
enough for that repo's owner to locate and fix the call site.

## The policy

### 1. `openapi.yaml` describes reality

If the server does something ugly, the spec says so and flags it. A spec that
documents intent instead of behaviour is worse than none: consumers write
against it and are surprised in production. When a defect is fixed, the spec
and its `DEFECT` note change in the same commit.

### 2. The spec cannot silently rot

`__tests__/contract/openapi.test.js` loads every express router under
`routes/`, walks `router.stack`, and fails if a registered route has no path
entry — or if the spec documents a path that no longer exists. It runs in CI on
every push and pull request.

It reads the _live_ routers rather than pattern-matching source, so paths
registered through helpers (`registerOptionRoutes`, `registerEntitySearch`) are
caught too. What it does **not** verify is response bodies: it checks paths and
methods, not schemas. Body-level conformance is the job of the consumer suites
below.

### 3. Consumer contract suites gate changes — not env allowlists

This is the substantive rule.

The current mechanism for keeping a consumer in step is a pair of environment
variables in two repos that a human must remember to edit together.
`.env.example` says it out loud:

> Keep this in step with komondor-web's `ENA_ADMINS`: the export page is
> offered to the users listed there, and the API refuses anyone not listed
> here.

Two hand-maintained allowlists, in two repositories, with no test that they
agree. The failure mode is silent and user-visible: someone is offered the
accessions export page and gets a 403 from `GET /accessions/csv`. Nothing
fails, nothing alerts; a user files a bug.

**The rule going forward:** a change to this API is gated by running the
consumers' contract suites against it, not by a promise to update a matching
list somewhere else. Concretely:

- A behaviour a consumer depends on gets a test **in this repo** that pins it,
  and an entry in `openapi.yaml`. Those two are the contract.
- Where a consumer must know a server-side fact (who may export, which fields
  are derived, which statuses exist), it should **ask the API** rather than
  keep a parallel copy. `ENA_ADMINS` should become a capability the API
  reports; the drift disappears when there is only one list.
- When neither is possible yet, the divergence is recorded in the drift list
  above with the consumer named, so the next person changing that code can see
  who they are about to break.

### 4. Client generation into the sibling repos is a follow-up

Generating typed clients from `openapi.yaml` into komondor-web,
komondor-power and komondor-nudge would remove most of the hand-written
guessing described above — komondor-power's inferred `/auth/login` fallback and
komondor-web's reverse-engineered `apiError.js` in particular.

**This has not been done, and it is out of scope for this repo.** Those
repositories have their own owners, their own release cadence and their own
build tooling; generating code into them is their change to make, not ours.
It requires their owners' sign-off before anything is committed there.

Nothing in this repository writes to `../komondor-web`, `../komondor-power` or
`../komondor-nudge`. They were read to get the drift list right, and that is
all.

Suggested sequence when it is picked up:

1. Publish `openapi.yaml` somewhere the sibling repos can fetch it by version.
2. One consumer at a time, generate a client and run its existing suite against
   the generated types — the diff _is_ the drift report.
3. Add the consumer's suite to this repo's pull-request gate.
4. Only then delete the hand-written client code.

## Changing the API

1. Change the code.
2. Update `openapi.yaml` in the same commit. `__tests__/contract/openapi.test.js`
   fails if you forget a path; it cannot tell you that you changed a response
   body, so that part is on you.
3. If the change is breaking, add a section to `BREAKING_CHANGES.md` — that
   file is already the record for §1–§15 and consumers read it.
4. Name the affected consumers in the pull request. The table at the top of
   this document is the list to check against; remember that komondor-nudge is
   broken by _schema_ changes even when the HTTP surface is untouched.
