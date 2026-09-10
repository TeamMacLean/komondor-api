# Review request — fifth pass

Your fourth pass returned **NO-GO**, with B1, B5 and B6 not closed, four additional B6 failures,
several test-integrity findings, and a six-item "smallest path to GO". This is my response.

Read all of it before answering. The most important section is **5**, not 4: after fixing your
findings I ran an internal adversarial review over my own five commits, and **three of them had
introduced new bugs** — including one where the fix for _your_ CORS finding created a fresh
regression on the same endpoint. That is the third round running where my first draft of a fix
broke something adjacent, and it is the pattern I most want you attacking.

I am not asking for a rubber stamp. Section 6 lists two things you flagged that I deliberately
did **not** fix, and section 7 is where I think I am still wrong.

---

## 1. What I need

A **go / no-go** on a supervised deploy of the three branches below.

The single most valuable thing you can do, again: **re-run your own reproductions** rather than
reading my summary or my tests. Every round so far, the bugs that survived did so because a test
and the code shared a false assumption — and in round 4 I used one of those tests to argue
_against_ a finding of yours that was correct.

Where you still object, say plainly whether it is _"this loses data or breaks a normal
workflow"_ (blocking) or _"this needs a deliberate attacker"_ — read section 2 first.

---

## 2. Operating context (unchanged — the lens to judge by)

Small single-institution research API on a private network. Consumers are three sibling apps
(komondor-web, komondor-power, komondor-nudge). Users are research scientists submitting
sequencing data — **not adversaries**. **One PM2 fork-mode process.** Small team; readability and
avoiding needless complexity are real constraints.

**Priority is robustness, not defence against sophisticated attackers.** Weight findings by what
fires **by accident** — a concurrent upload, a browser tab dying, a JWT expiring mid-transfer, a
`chmod -R` landing during a copy, a deploy landing mid-ingest — over anything needing a crafted
payload. If you see me adding complexity to stop an attack nobody here will mount, say so.

---

## 3. Current state

```
komondor-api    branch security/gates-1-2-3            HEAD 3b230a9
komondor-web    branch fix/tus-authentication          HEAD d8e1c4c
komondor-power  branch fix/ingest-completion-contract  HEAD 3e6a70d
```

Nothing is pushed or merged. This is a coordinated three-repo release — **web and api must
deploy together**, or uploads break.

- **komondor-api:** 51 suites / **1698** unit tests, plus **5 suites / 15 tests** of integration
  against a real MongoDB 7.0.29. The unit figure excludes the integration suites by config
  (`jest.config.js` ignores `__tests__/integration/`); run them with
  `MONGODB_URI=... yarn test:integration`.
- **komondor-power:** 16 files / **253** tests; `yarn run verify` green (typecheck + eslint +
  prettier + tests).
- **komondor-web:** 16 files / **499** tests.
- This round: 16 files, **+1963 / −188** in the API.

---

## 4. Your six blockers

**B2, B3, B4** you marked closed; I have not touched them except as noted in section 6.

### B1 — retained symlink source could never be reconciled — FIXED (`8a684bf`)

You were right and the cause was exactly where you pointed. `calculateFileMd5` opens
`O_NOFOLLOW`, so a permitted leaf symlink raised ELOOP, and hashing it behind a bare
`.catch(() => null)` turned "this is a link" into "content unverifiable", i.e. never adopt.
The hash now takes the same ELOOP fallback the move itself uses (`openPinnedSource`), and
re-vouches for the target with `assertWithinReal` rather than trusting the link. A symlink whose
target does **not** match is still refused — there is a test holding that in place.

### B5 — source mutated mid-copy — FIXED (`205e1be`, corrected in `3b230a9`)

Your reproduction (same inode, same size, rewritten after the first 4096 bytes) is now refused:
the copy re-stats the source before promoting and rejects on a size or mtime change.

Two things worth your attention here:

- It stats **by path**, not through the handle: `pipeline()` destroys the read stream on
  completion, which closes the FileHandle with it. A same-inode guard is what makes the path
  safe to trust for that one question. **Tell me if you can defeat that.**
- I originally also compared **ctime**, and removed it. I measured `chmod` and `link()` bumping
  ctime with content, size and mtime untouched — and `HPC_TRANSFER_DIRECTORY` is a shared inbox
  other people's tooling operates on, so a `chmod -R` during a multi-hundred-GB copy would have
  failed the whole move. It bought nothing against corruption, since a content write always moves
  mtime. **Is there a rewrite that preserves mtime and size that I should worry about?** I could
  only construct one with a deliberate `utimes()` call afterwards.

### B6 — FIXED, all five parts (`22f988a`, corrected in `3b230a9`)

- **One-mate correction returned 400.** Whole-list rules (pair completeness, sibling
  resolvability) now run only on the MERGED list, not the raw partial submission. The fixture
  that should have caught this called itself "a paired submission" and declared neither `paired`
  nor `rowID`; it does now, and reverting the split turns it red.
- **Pooled delivered names.** `deliveredFileNames` returns `{raw, additional}`. The caller
  asserts that shape rather than defaulting it — silently substituting an empty set would drop
  the guard, which is exactly how a stale double keeps passing.
- **Self-pairs, one-way links, cycles.** A pair is now exactly two files that each name the
  other.
- **Renaming a mate had no legal payload.** `sibling` is excluded from the delivered-entry
  fingerprint (it points at another entry rather than describing this one's bytes), and the merge
  takes the resubmitted pointer. Un-pairing works too — see 5.4, I got that wrong first.
- **`A.fq` vs ` A.fq`.** See 5.3 — my first fix for this was insufficient and I have replaced it.

### Also from your "smallest path to GO"

- **Index preflight (`1f5e19e`).** Rewritten around `findIndexConflicts`, which walks **every**
  index. Verified against real MongoDB 7.0.29: a custom-named equivalent index is refused (85);
  `storageEngine` is refused (85); `partialFilterExpression`/`sparse` are refused (86); a
  **non-equivalent** same-keys index under another name is genuinely fine and is not reported.
  The option check is now an allowlist, not a denylist, because a denylist can only ever cover
  what it thought of. End-to-end verified: poison → detect (exit 3) → `--fix` → the app's own
  equivalent build is then accepted.
- **Integration helper database name (`1f5e19e`).** You were right that it claimed the app's
  fallback and used a different database, so the spawned-server test poisoned an index that
  server never looked at. `MONGODB_URI` is now required outright — copying the app's fallback
  would have pointed a suite that empties every collection at the developer's own `komondor`.
- **Power (`3e6a70d`).** `yarn run verify` is green. Note the reason your run failed the way it
  did: **`yarn check` is a yarn 1 builtin** (package integrity) that silently shadows a script of
  the same name, so it never ran the checks at all — it failed on an unrelated `better-sqlite3`
  engine mismatch. There is now a `verify` script that cannot be shadowed.
- **Power MD5 fixtures.** Corrected to the real enum (`pending | in_progress | complete |
failed`). Nothing in Power branches on the value, so this was a fixture describing a fictional
  API rather than a live bug — but you were right that it was wrong.
- **Web lint (`d8e1c4c`).** The 2 errors this branch introduced are fixed. The other 19 are
  pre-existing on master across five unrelated files and are deliberately left — a formatting
  sweep there would bury the two-file auth change.

### And one correction to you, on 5a

**You were right that I was wrong, and I want to be precise about how.** You said the test
asserts CORS behaviour production does not have. It does. `app.js` mounts a global `cors()` long
before the upload routes, and `cors()` _answers_ an OPTIONS preflight and ends the request, so the
router's capability middleware never ran. I could not see it because every test in that file
builds its own Express app around the router alone — reading that suite told me the header was
set, because in that topology it is. New tests now require `app.js` itself.

---

## 5. What my own review found afterwards — three of my five fixes regressed

I ran an adversarial review over the five commits above. Every item below was reproduced by
execution and is fixed in `3b230a9`; each new test was mutation-verified against the code as it
stood before that commit. **This is the section to attack.**

### 5.1 — my fix for YOUR CORS finding broke every 401 on /uploads

Skipping the global `cors()` for `/uploads` looked equivalent to letting the mount answer its own
preflight. It is not: `routes/uploads.js` guards with
`router.use(TUS_ROUTE, requireUploadAuth, uploadApp)`, so an unauthenticated request is answered
**before** reaching `uploadApp`'s own `cors()`. Measured: `POST /uploads → 401` with no
`Access-Control-Allow-Origin` at all, where it had one before my change. A JWT expiring
mid-upload would then show the browser an opaque CORS failure instead of
`{"error":"Authentication required"}` — which the web app cannot tell apart from the network
dying, and which the tus client sees as a transport error rather than a status.

Now uses `preflightContinue` for that prefix: sets the headers **and** lets the preflight through.
Also, my predicate was case-sensitive while Express routes case-insensitively, so `/Uploads`
reached the tus mount but took the other branch — the same bug, one capital letter away.

### 5.2 — duplicate names in a reingest payload were silently collapsed

I moved the duplicate-name check behind the new `crossEntry` gate along with the pairing rules.
But `mergeReplacementList` indexes by name into a `Map`, so two entries sharing a name collapsed
**last-wins** and the merged list looked clean to the re-validation afterwards. A client that
double-adds a correction got 200 with the second copy quietly winning; it used to be a 400. A
duplicate is a defect in the submission itself, so the check now runs before the gate.

### 5.3 — comparing names canonically was not enough

My first fix for your `A.fq`/` A.fq` finding made validation _compare_ canonically. That is
insufficient, because only half the code canonicalises: `lib/file-utils.js` stores
`safeBasename(name)`, but `siblingLinks` and `planRawFileStage` match the **raw** payload string.
So `{name:"A.fq", sibling:" B.fq"}` + `{name:"B.fq", sibling:"A.fq"}` passed my new mutuality
check and **still delivered half-paired** — I closed the one-way door and opened a whitespace one
in the same function.

Names and siblings must now already **be** their own basename. That makes raw and canonical the
same string everywhere downstream, which is the only version of this that does not depend on
remembering to canonicalise at each site. **Please check I have not missed a third site** — and
note that `planRawFileStage` and `pendingAdditionalFiles` in `lib/ingest-queue.js` still match
raw strings for payloads **stored before this deploy** (see 7.3).

### 5.4 — a delivered file could be re-pointed but not un-paired

The sibling override fired only when the key was present, so dropping a mate kept the original's
dangling pointer and 400'd on the merged list — the same dead end I had just written the fix to
remove, in the opposite direction.

### 5.5 — the mutation guard's ctime comparison

See B5 above.

### And in the preflight script

- The drop loop sat **outside** the try that prints the FATAL "no index enforcing uniqueness"
  warning, so a failure on the _second_ of two drops left the collection in exactly that state
  with no warning.
- An empty `conflicts` array was treated like an omitted one and dropped `INDEX_NAME` anyway —
  "I looked and found none" is not "I did not look".
- `--fix` now re-classifies **after** rebuilding instead of trusting `createIndex`. A collection
  carrying `indexOptionDefaults` stamps them onto the rebuild too, so the fix could have reported
  success and sent an operator round the same loop. **I could not execute this case** — it is
  reasoned, and I would like it checked.
- The test double for that script returned one frozen index list no matter what `dropIndex` and
  `createIndex` had done to it — a database that cannot exist, and the reason `--fix` could not
  be tested for what it leaves behind. It is stateful now. **Fifth round running for this
  pattern, this time in a mock I had written the day before.**

### One place I checked and think you were half right

You suggested `--fix` drops a _healthy_ index when an equivalent one exists under a custom name,
since it is already enforcing the constraint. I executed both halves: the constraint **is**
enforced (a duplicate insert against it is refused, 11000) — **but `Run.init()` rejects with 85**,
and `server.js` awaits it, so the app does not boot at all. So it stays a blocker, and the
message now says exactly that. Dropping a healthy index would be indefensible if the cost were a
log line; it is defensible when the alternative is a deploy that will not start. **Tell me if you
disagree with that trade.**

---

## 6. Two things you flagged that I did NOT fix

Both were in your "follow-up work, not the original defect" notes. I am listing them rather than
quietly dropping them, and I would like your read on whether either should block.

### 6.1 — a single PATCH longer than the idle window loses its quota reservation

You wrote: _"activity is touched only at request start, so a PATCH lasting over the 60-minute
idle window can be pruned from quota accounting when another upload is admitted."_ Confirmed:
`touchUpload` is called once when the request arrives, `pruneIdleUploads` (`lib/upload-quota.js`)
drops any registration whose `updatedAt` is older than `UPLOAD_IDLE_MINUTES` (default 60), and it
runs on every admission. `UPLOAD_MAX_BYTES` defaults to **50 GiB**, so a single slow PATCH
exceeding 60 minutes is entirely ordinary here, not an edge case.

It partially self-heals — `authoriseUploadAccess` re-admits an upload whose reservation has gone
— but between the prune and the next request, the free-space floor is computed without it.

**I judged this out of scope for this round rather than safe.** Given your framing (accident, not
attacker) I think it may actually be the most likely-to-fire item left. **Should it block?** If
you think so I will fix it before deploying; the obvious fix is a periodic touch from the tus
`POST_RECEIVE` hook, which already fires.

### 6.2 — Power polls 30 minutes before reporting a terminal error

You wrote: _"A failed ingest paired with a still-pending Run can nevertheless poll for 30 minutes
before a generic timeout after the API's best-effort Run update fails."_ Not fixed. The entry does
end up correctly marked as errored — this is a latency and error-message-quality problem, not a
correctness one, which is why I left it. Confirm that reading or correct it.

---

## 7. What I most expect to be wrong

Least confident first:

1. **A fourth regression in `3b230a9` that my own review did not catch.** It found three in five
   commits. There is no reason to think its own hit rate was 100%.
2. **The canonical-name requirement is now stricter at the door.** A payload that was legal
   before (a name with a leading space, a `sibling` with one) is now a 400. If any client sends
   that shape today, this breaks it. I believe komondor-web does not, but I have not proven it
   against the real client.
3. **Stored payloads from before this deploy.** The merged list is re-validated with the new
   rules, including entries the caller never sent. A failed `IngestJob` whose stored payload was
   legal under the old rules (a one-way `sibling`, a non-canonical name) will now 400 on a
   reingest-with-replacement, complaining about an entry the caller did not submit. A plain
   no-payload reingest still works. **Classic deploy-lands-mid-flight — is this acceptable, or
   does it need a migration?**
4. **`planRawFileStage`/`pendingAdditionalFiles` still match raw payload strings** against a Map
   keyed on canonical `originalName`. New payloads can no longer be non-canonical, so this cannot
   arise going forward — but a stored one can still hit it. Pre-existing and unfixed.
5. **`entryFingerprint` is blind to nested objects.** `JSON.stringify(file, keyArray)` applies
   the allowlist at every nesting level and the list is built from top-level keys only, so
   `{name:"A", data:{md5:"aaa"}}` and `{name:"A", data:{md5:"bbb"}}` produce the same string.
   Pre-existing, not introduced by the `sibling` exclusion, but `openapi.yaml` declares these
   entries as free-form objects so nested payloads do occur.
6. **A sixth instance of "the test agrees with the code on a false external assumption."** It has
   been there in all five rounds.

---

## 8. Knowingly accepted / deferred (argue any you disagree with)

- **Not verified on Linux.** Still Darwin only, and this matters more this round than last:
  `copyPinnedSourceTo` now carries `link`/`unlink` promotion on a path that previously used
  `copyFile`, and the whole B5 guard rests on `fs.stat` timestamp semantics. A real Ubuntu run is
  still my top recommendation before shipping. You ran a Debian/Node 24 subset last round — if
  you can run the full API suite plus the HPC-retention tests there, that is the gap I most want
  closed.
- **Mongoose 5→7 not attempted.** One critical advisory open; a blind major ORM upgrade without a
  real-Mongo compatibility suite is riskier than the advisory here.
- **Shared HPC inbox** stays a flat shared directory. Mitigated by attribution logging, not
  prevention, per the owner's decision.
- **Login/LDAP rate-limiting and SMTP TLS verification** not done — trusted internal network.
- **19 pre-existing web lint errors** left alone (section 4).

---

## 9. What to return

1. **Go / no-go.**
2. For B1, B5, B6 and the preflight: closed / not closed, with a re-run reproduction rather than
   a code read.
3. **Attack section 5.** Specifically: can you defeat the stat-by-path mutation guard (5/B5), and
   is there a third un-canonicalised site (5.3)?
4. **6.1 — should the idle-prune reservation loss block this deploy?** That is a genuine question,
   not a rhetorical one.
5. **7.3 — do pre-existing stored payloads need a migration**, or is a plain reingest a good
   enough escape hatch?
6. Any sixth instance of the test-hides-a-false-external-assumption pattern.
7. The smallest set of things that still block a **supervised** deploy, if any.

Be direct. If the honest answer is still no-go, say why. If these hold up now, say that too — but
only after re-checking, not from this summary.
