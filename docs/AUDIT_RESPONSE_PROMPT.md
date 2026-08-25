# Prompt for the auditing model

---

You audited the `komondor-api` codebase and recommended blocking the next unattended
production release. That audit was accurate and useful — I verified every release blocker
you raised against the code before acting on it, and reproduced the two that mattered most.
Remediation is now complete and I want your judgement on whether it is safe to ship.

Please read all of this before responding. There is a deliberate change of framing in
section 2 that changes what "correct" means for several of your recommendations, and I want
you to engage with that framing rather than restate the original audit.

---

## 1. What I need from you

A go / no-go on deploying branch `security/gates-1-2-3`, plus anything you think is still
wrong.

I am explicitly **not** asking you to rubber-stamp this. I have included below the decisions
that went against your recommendations, the risks that were knowingly accepted, the residual
items, and a mistake I made and had to recover from. If you think any of those is wrong,
say so plainly and say what you would do instead. An approval extracted by a selective
summary would be worthless to me — if you find yourself agreeing with everything, re-read
section 6 and push on it.

Where you disagree, please distinguish:

- **"This will break or lose data"** — blocking.
- **"This leaves an opening a determined attacker could use"** — read section 2 first, then
  tell me if you still think it blocks.
- **"This is untested"** — I care a lot about this one; see section 5.
- **"This is more complexity than the problem warrants"** — also blocking, for reasons in
  section 2.

---

## 2. The framing change — read this before judging anything else

Your audit was written in a security register, and I initially remediated in the same
register. The repository owner pushed back, and he was right. His words:

> "I appreciate the security sophistication, but I work with dumb scientists who hate
> computers. These kinds of attacks are not just close to never happening, it's also at a
> level of sophistication whereby if someone had that prowess they could attack other parts
> of the company's system to greater effect.
>
> What I don't want to do is introduce so much complexity to the web app it becomes
> human-unreadable and/or the performance isn't optimal. We're not winning awards here,
> we're just making a simple API robust for the web apps that consume it."

The operating context this actually runs in:

- A single-institution research API on an internal network, consumed by three sibling web
  apps (`komondor-web`, `komondor-power`, `komondor-nudge`).
- Users are research scientists submitting sequencing data. They are not hostile. The
  realistic failure mode is a tired person mistyping a directory name, not a crafted payload.
- One PM2 fork-mode process. A small team maintains it. Readability is a real constraint,
  not a nicety.
- Anyone sophisticated enough to mount the exotic attacks has better targets in the estate.

**So the goal is robustness, not security.** The distinction that ended up mattering most,
and the one I would like you to apply when judging this:

| Fires by accident, on an ordinary Tuesday | Requires a deliberate, skilled adversary |
| --- | --- |
| A file move silently overwriting a colleague's data because two runs share a filename | Log-record forgery via a newline embedded in a filename |
| Accepted work vanishing when a deploy lands mid-ingest | NoSQL operator injection via hand-crafted JSON |
| A health check reporting "ok" while Mongo is unreachable | Planting a symlink to escape a managed root |
| A cross-group-read user accidentally writing to the wrong group | Claiming another user's in-progress upload by guessing its id |
| Malformed client input producing a 500 instead of a 400 | |

Most of your findings sit in the **left** column once re-read this way, and I mis-sold them
by describing them in attack language. The left column is where I have invested. The right
column has been deliberately de-emphasised, and in two cases deliberately reversed.

I would like your verdict under this framing. If you believe the framing itself is wrong —
that this API is more exposed than described, or that one of the "adversary-only" items is
actually reachable by accident — that is the single most useful thing you could tell me.

---

## 3. Repository state

```
branch:        security/gates-1-2-3   (9 commits on top of master @ 9418c82)
working tree:  clean, nothing uncommitted
not pushed:    no remote branch created; nothing merged to master
```

```
94 files changed, 24,849 insertions(+), 2,732 deletions(-)

  source (lib, routes, models, server.js, app.js)   +5,579  -1,051
  tests (__tests__)                                +13,316    -620
  docs + CI (.github, openapi.yaml, docs, *.md)     +5,533      -6
  scripts                                              +97       0
```

```
4e80481  security(gate1): contain filesystem escape and silent overwrite on ingest
30f88c9  security(gate1+2): authenticate the TUS mount, add quotas, drop tus-node-server
24f4d21  security(gate1+2): split read from write authorization, close injection and IDORs
9cce120  feat(gate2): durable ingest queue with startup recovery
042a541  fix(gate1+2): truthful readiness, ordered startup, validated config
d533f6b  security: audit the shared HPC staging area, refuse groupless callers
900e166  build(gate3): CI, OpenAPI contract, coverage ratchet and migration plan
3831bdd  security: close the re-verification findings, and test the controls that had no test
366f656  refactor: fit the hardening to the actual threat model
```

Test suite: **50 suites / 1,579 tests, green.** Coverage 82% statements / 77% branches /
73% functions / 82% lines, with thresholds committed at 75/70/66/75 so it cannot regress.

Dependency audit (`yarn audit --groups dependencies`): **121 findings (4 critical, 41 high)
→ 19 findings (1 critical, 4 high)**, 288 packages → 161. The remaining critical is
`mongoose`, discussed in section 6.

---

## 4. Your findings, and what happened to each

### Critical — authenticated filesystem escape and overwrite
**Fixed.** `safeBasename` reduces every user-supplied filename to a basename;
`resolveWithinReal` resolves the path and refuses anything escaping the configured root,
including via a symlinked ancestor with a not-yet-existing leaf. The move itself changed
from `fs.rename` (which silently overwrites) to `fs.link` + `fs.unlink`, so an existing
destination fails `EEXIST`. The cross-device branch opens its partial with `wx` and promotes
by link, not rename. Source paths are validated too — a poisoned stored `path` could
previously move or delete any readable file.

Note for the framing in section 2: the no-clobber half of this is the part that earns its
keep. Two scientists using the same filename is routine, and the old code silently destroyed
one of them.

### High — anonymous, unbounded resumable uploads
**Fixed.** The TUS mount had no authentication of any kind; a probe returned
`412 Tus-Resumable Required`, not `401`. It is now behind `isAuthenticated` at both the
outer mount and the inner app. Added per-user concurrency and in-flight byte caps, a global
free-space floor, upload ownership recorded at creation, and an abandoned-upload sweep.
Admission reserves synchronously before any `await` — the first implementation was
check-then-act and every cap was bypassable by concurrent requests.

`tus-node-server@0.3.2` replaced with `@tus/server` + `@tus/file-store`. This is where the
bulk of the dependency reduction came from (it pulled in `aws-sdk` v2).

I want to flag that this one is **not** an exotic attack — "anyone who can reach the host
can fill the disk" needs no skill at all — which is why it was fixed without hesitation
despite the framing change.

### High — global-read permission silently grants global write
**Fixed.** `Group.GroupsIAmIn` now takes `{ mode: "read" | "write" }`. Only `isAdmin` gets
all groups in write mode; `FULL_RECORDS_ACCESS_USERS` fall through to real membership.
`lib/utils/groupAccess.js` is now the single authorization module; the three duplicated
`userCanAccessGroup` copies and `userBelongsToGroup` are gone. Token issuance was also
changed to stamp in write mode — without that the split was defeated, because a full-access
token carried every group id as apparent real membership.

Sub-items: `/accessions/new` and `/project/toggle-nudgeable` now authorize the loaded
entity's group; soft-deleted groups authorize nobody; `ldapGroups` and group rename are
admin-only; global vocabularies require admin for writes; sample and run creation derive the
group from the parent rather than trusting the request body.

### High — reachable operator injection and cross-tenant disclosure
**Fixed.** I confirmed your finding empirically before acting: `M.find({sample:{$ne:null}}).cast()`
does preserve `{"$ne":null}` through Mongoose 5 casting. Every `req.body` / `req.query` value
reaching a query is now type-guarded; the returned entity is authorized before being sent;
and the group is derived from the parent. An independent reviewer re-ran `{"$ne":null}`,
`{"$gt":""}`, `{"$regex":"."}`, arrays and nested objects against every such value in every
route file and found no survivor.

`GET /users` no longer returns the whole collection.

**Partially accepted, not fixed:** the transfer-directory listing and reading. See section 6.

### High — accepted work can disappear during deploys
**Fixed.** `POST /runs/new` now writes an `IngestJob` row and awaits it before responding.
A worker claims jobs with a single atomic `findOneAndUpdate`; `completeJob`/`failJob` are
fenced on `workerId`; startup recovery reclaims jobs held by a worker that is no longer
alive. "Ingested" is decided by stat-ing the destination, not by a row existing — and the
`Read` row is now written *after* the move, so a failed move leaves nothing claiming success.
`POST /runs/:id/reingest` requeues a permanently failed job.

This is squarely a robustness fix, not a security one, and I would rate it the highest-value
change on the branch.

### High — readiness is factually wrong
**Fixed.** `app.listen` moved inside the Mongo-connect success continuation. `/health` is
liveness only; `/ready` checks Mongo, the required mounts and ingest-worker freshness and
returns 503 naming the failed check. A refused shutdown now sets draining first, so `/ready`
stops answering 200 during the window before PM2's `SIGKILL`.

Startup config validation added: `MONGODB_URI` must carry a database name (a URI missing it
has caused a production incident here before), plus secrets, origins and mount access,
aggregated into one error.

### High — dependency baseline fails
**Substantially improved, not closed.** 121 → 19; 4 critical → 1; 41 high → 4. The remaining
critical is `mongoose` 5.13.23, which needs ≥6.13.6. **I deliberately did not attempt that
upgrade** — see section 6.

`nodemailer` could not be moved: `package.json` pins `^6.10.1` and 6.10.1 is already the
newest 6.x, so clearing its advisories needs a major that changes the API surface
`lib/utils/sendEmail.js` uses.

### Conditional critical — development credentials can escape local use
**Contained, not eliminated.** `routes/auth.js` still carries the hardcoded `DEV_USERS` list
gated on `NODE_ENV === "development"`. Startup now refuses to run in development mode on a
non-loopback bind. The list itself was left in place; the residual is recorded in
`BREAKING_CHANGES.md` under known issues, with an `ALLOW_DEV_USERS` opt-in suggested as a
second belt. Tell me if you think network-level containment is insufficient here.

### Other material risks you listed
- **CSV formula injection** — fixed on the sample and accession exports.
- **Raw production error details** — *not changed.* This is deliberate and pre-existing:
  `routes/_utils.js` documents that `komondor-power` is an internal client and needs the
  underlying message for diagnostics. Argue it if you disagree.
- **Unthrottled login / LDAP** — **not done.** Still open. See section 6.
- **SMTP certificate verification** — **not fixed.** `lib/utils/sendEmail.js` still sets
  `rejectUnauthorized: false`. Startup now emits a loud warning about it, which is all that
  was done.
- **Stale seven-day authorization claims** — partially addressed by the read/write split at
  token issuance; the underlying token lifetime is unchanged.
- **Transfer-root symlink traversal** — see section 6, this one was reversed.

### Sibling contract drift
`openapi.yaml` now describes the API's actual current surface, including every drift you
identified: routes mounted at root rather than `/api`, the JWT expiry requirement,
`Group.deleted`, the idempotent 200-vs-201 creates, `LibraryType.indexed`, the
`{ error, detail, requestId }` envelope, and the fact that the server derives
`project.nudgeable` and ignores the client's value. Where current behaviour is a defect the
spec documents what the server does and flags it.

`project.nudgeable` itself was fixed — the hardcoded group ObjectId is gone.

`docs/CONTRACTS.md` records the consumer-contract policy. **No sibling repository was
modified.** Generating clients into web/power/nudge needs their owners' agreement.

### Testing pipeline
CI added: frozen install on pinned Node, syntax check, unit tests with coverage, coverage
ratchet, dependency audit failing on critical, and open-handle detection. A pull-request job
provisions an ephemeral MongoDB — but `__tests__/integration/` does not exist yet, so that
job is honestly named as a placeholder and will fail the day someone adds a test to it.

---

## 5. How thoroughly this was verified — the part I most want you to attack

I did not trust the remediation. Three independent adversarial review rounds ran against it,
executing attacks rather than reading code. They found real defects in my own work:

**Round 1** found 1 critical, 5 high, 11 medium, 5 low in the freshly-written remediation.
The critical: the ingest retry treated "a database row exists" as "the file arrived", so a
batch whose moves all failed would be skipped on retry and the job marked done with the
files still in staging — reintroducing the exact failure the queue was built to remove,
relocated from memory into the database.

**Round 2** found that three of the round-1 fixes had *moved* the bug rather than removed it:
- The owner-based read grant was stripped from the list endpoints but left on five
  per-record endpoints, so a caller in no group still got 200 on any record naming them as
  owner.
- Completion-by-stat skipped the pairing and status-writing steps whenever zero files needed
  moving, leaving runs permanently incomplete.
- The wedged-worker detection could never fire, because the heartbeat proving the worker
  alive also counted as progress.

**Round 3** was a mutation audit: 60 security-relevant controls were deleted one at a time in
a scratch copy and the suite re-run. **56 were caught.** The gaps became work: the one
genuinely uncaught control (`O_NOFOLLOW` in the checksum helper) is now covered in three
places, and second, differently-shaped assertions were added to the four gates that rested
on a single test.

Every fix on this branch was mutation-verified: the fix is reverted in a scratch copy, the
test confirmed red, then restored and confirmed green. A test that passes against the
unfixed code proves nothing, and that failure mode turned out to be endemic — at one point a
reviewer deleted *every* audit call site and the entire 1,398-test suite stayed green.

**My own error, for completeness:** while removing a middleware I used an over-broad text
edit that deleted more tests than intended, including the ones binding the audit log to its
call sites and the `O_NOFOLLOW` test. A verification agent caught it. I restored them and
re-proved all three controls by mutation (deleting the audit calls now reddens 8 tests;
stripping `O_NOFOLLOW` reddens 1; reverting the log escaping reddens 13). I mention it
because it is exactly the class of silent regression this whole exercise is about, and it
happened to me, mid-exercise, on the controls I had just finished defending.

**If you want to attack one thing, attack this section.** Ask whether the mutation results
are meaningful, whether the in-memory Mongo fake the queue tests run against can support the
atomicity claims made on top of it, or whether 56/60 is the right denominator.

---

## 6. Decisions taken against your recommendations, and accepted risks

These are the ones you should scrutinise hardest.

### 6.1 The Mongoose upgrade was deliberately not attempted
Your audit called for it, and one critical advisory remains open because of that choice.
Reasoning: a major ORM upgrade with no integration suite against a real database is exactly
the change that breaks production quietly. `MONGOOSE_MIGRATION.md` inventories the real
blockers in this codebase at file:line (eight `execPopulate()` call sites removed in v6, the
`useCreateIndex`/`useNewUrlParser` options, `strictQuery` default change, removed
`Model.count`/`update`, `findByIdAndUpdate` return semantics, Mixed-type behaviour). The CI
job that provisions ephemeral Mongo exists specifically to gate it.

**Do you accept deferring this, given the deployment context in section 2?** If you think the
remaining critical blocks the release on its own, say so.

### 6.2 The shared HPC staging directory — accepted, not fixed
`HPC_TRANSFER_DIRECTORY` is one flat inbox shared by every group, and nothing records which
group owns a subdirectory. A member of group A can name group B's directory in a run
submission; the file is linked into A's datastore and unlinked from B's inbox — cross-group
disclosure *and* destruction.

The owner reviewed this and chose to accept it rather than impose a directory naming
convention, because real uploads arrive under names like `/WGS_Test/01.RawData` that carry no
group, and enforcing a convention would break the existing `scp` workflow on the day it
deployed.

What was done instead: every list, read, checksum and claim emits one `[HPC-AUDIT]` line
naming the caller and resolved path. It is attribution, not prevention, and it is not
adversary-proof — fields are JSON-quoted so a filename cannot split one record in two, but
anyone who can write to the inbox can still fill the log with plausible entries. It is
documented as operational forensics ("where did group B's file go after someone mistyped a
directory name"), which is how this actually goes wrong here.

**Is accepting this defensible in this environment?** If not, what would you do that does not
break the `scp` workflow?

### 6.3 Symlink containment was deliberately loosened
This one reverses a hardening, and it is the change I most want a second opinion on.

The first remediation refused any symlink resolving outside the guarded root. Testing against
realistic cluster behaviour showed this refuses:

```
symlink -> large file on scratch storage      REFUSED
symlinked project directory                   REFUSED
```

Symlinking a large file or a whole project directory into the staging area instead of copying
terabytes is ordinary practice on an HPC system. The refusal surfaced as a bare "invalid
path", which reads to a scientist as the API being broken.

`ALLOWED_LINK_ROOTS` now names storage roots a symlink may resolve into (colon-separated
absolute paths, e.g. `/scratch:/projects`). A link landing anywhere else is still refused,
and `../` traversal is refused regardless, so `/etc` remains unreachable. Each configured
root is `realpath`'d before comparison, because a root that is itself a symlink
(`/scratch` → `/mnt/scratch`) would otherwise never match and would fail silently as a
refusal.

**This is a genuine loosening of a control you flagged.** My argument is that the strict
version breaks legitimate work with near-certainty, while the attack it prevents requires an
adversary this deployment does not have — and that a control which breaks normal work will be
disabled by whoever gets the support call, which is worse than a scoped one. Tell me if you
disagree.

### 6.4 A membership check was removed
An earlier round added `requireAnyGroupMembership` to the three file-browsing endpoints,
refusing callers belonging to no group. It was removed under the section 2 framing: it added
a database query per request to defend against a principal this deployment does not produce.
Those endpoints are back to `isAuthenticated` alone.

### 6.5 Comment volume was cut deliberately
Files we touched reached 34–62% comment lines, with 40-line docblocks narrating attack
scenarios. For a small team that is worse than no comment — it buries the sentence saying
what the function does. Comments are now 15–30%, with the traps kept as one-liners at the
point where someone would undo them. Verified comment-only by parsing both versions with
babel and comparing token streams and normalised ASTs, not by eye.

If you think a specific piece of reasoning should have survived in the source rather than in
`BREAKING_CHANGES.md`, name it.

### 6.6 Known-open items, not addressed
- **Login / LDAP rate limiting — not implemented.** Still open from your audit.
- **SMTP `rejectUnauthorized: false` — not fixed**, only warned about at startup.
- **Production error `detail` — unchanged**, deliberately, for the internal client.
- **`__tests__/integration/` is empty** — the ephemeral-Mongo CI job runs zero tests.
- **The suite has a ~7.5% per-run transport flake** ("socket hang up") that lands on an
  arbitrary route test. It is **not** caused by this branch: it reproduces on `master`, and
  4,000 sequential express+supertest requests with none of this repository's code produce
  zero failures. Upgrading supertest 6→7 did not fix it (3 failures in 40 runs either way);
  disabling HTTP keep-alive did not fix it; it survives `--runInBand`; fake timers are ruled
  out. CI tolerates it narrowly — retrying only when *every* failure matches a bare transport
  error, capped at two, and refusing to retry when a suite failed to load or when coverage
  was the thing that failed. The root cause is unresolved and needs an owner. I consider this
  the weakest part of the release gate and would value your view on whether it blocks.

### 6.7 One operational step before deploy
`{ sample, name }` on `Run` is now a unique index. Mongoose builds indexes in the background
and only *logs* a failure, so one pre-existing duplicate means the index silently never
exists and the race stays open with nothing reporting a problem.
`scripts/check-run-duplicates.js` is a read-only pre-deploy check — safe against production
while serving, no locks, nothing written — printing either "safe to deploy" or the exact
offending pairs with their ids, plus the `getIndexes()` command to confirm afterwards.

---

## 7. What to give me back

1. **Go / no-go** on deploying this branch, under the section 2 framing.
2. If no-go: the specific blocking items, in order, and the smallest change that unblocks each.
3. Your view on the six decisions in section 6, individually. Say which you would reverse.
4. Anything in section 4 you think is claimed as fixed but probably is not — I would rather
   hear a false alarm than miss one.
5. Whether the verification in section 5 is strong enough to justify shipping without the
   integration suite that does not yet exist.
6. If you want to see specific code before answering, name the files and I will paste them.

Please be direct. If the honest answer is that this still should not ship unattended, say so
and say why.

---

## Round 2 — response to the second opinion

A second model audited this branch after the exchange above and returned a NO-GO, respecting
the robustness framing in section 2 throughout: every item it raised was an ordinary partial
failure — a directory typo, a long-running transfer, a restart — not an exotic attack. Each
finding was verified against the code before acting on it. What changed, mapped to the
sections above:

**§6.3, symlink containment.** `ALLOWED_LINK_ROOTS` resolved a symlinked directory correctly,
but `GET /read-file` and `POST /directory-files/verify-md5` still opened a symlinked *leaf
file* with an unconditional `O_NOFOLLOW`, refusing it regardless of `ALLOWED_LINK_ROOTS` —
exactly the "symlink -> large file on scratch storage" case §6.3 opens with. Both endpoints
now permit a symlinked leaf that resolves into a configured link root, the same allowance the
path-resolution step already had. See `BREAKING_CHANGES.md` §34.

**§6.2, the shared HPC inbox.** The disclosure risk in §6.2 is still accepted, for the same
reason. The destructive half is not: `hpc-mv` claims no longer unlink the source from
`HPC_TRANSFER_DIRECTORY` after linking it into a datastore, so a misdirected claim can no
longer erase the original owner's only copy. This trades staging-directory disk growth for
not destroying data on a typo. See `BREAKING_CHANGES.md` §35.

**§6.4, the membership check.** Restored on the same three endpoints, but reimplemented to
read the caller's `groups` claim already embedded in their JWT instead of querying `Group`
per request — so the cost objection that got it removed no longer applies. It is still only
"does this caller belong to any group", not the per-directory check §32 declines to add. See
`BREAKING_CHANGES.md` §32 (corrected) and `docs/CONTRACTS.md` §2 for the token-staleness
caveat this inherits.

**Ingest lease vs. readiness (section 4, readiness).** The worker's 6-hour job bound stopped
renewing a job's lease and stopped reporting progress in the same branch, so a genuinely
long-running transfer lost its lease at the same moment `/ready` correctly started reporting
a problem. These are now separate: the lease renews for as long as the worker is alive and
ticking — safe specifically because `ecosystem.config.js` pins a single fork-mode process, so
there is never a second worker for a "stale" lease to be handed to — and `/ready` still goes
stale past the same 6-hour bound. Not a general distributed-locking fix; revisit if
`instances`/`exec_mode` ever changes. See `BREAKING_CHANGES.md` §36.

**§6.7, the Run index.** `scripts/check-run-duplicates.js` now also detects an existing index
under the same name with different options, which duplicate-free data would not surface on
its own. `Run.init()`/`IngestJob.init()` failing at startup now exits the process rather than
relying on mongoose's log-and-continue default. See `BREAKING_CHANGES.md` §31.

**New, cross-repo, not fixed here.** The client-supplied `nudgeable` fix from an earlier round
(§4, sibling contract drift) is inert in practice: `komondor-power`'s `insertMetadata.ts`
sends `nudgeable: !doNotSendToEna` and never forwards its own `project_nudgeable` input, so
every project it creates still falls back to this API's group-derived default. This is a
`komondor-power`-side change; it is flagged, with the exact field names, in
`docs/CONTRACTS.md` under "Needs coordinated action in komondor-power", and nothing in
`../komondor-power` was modified from this repo.
