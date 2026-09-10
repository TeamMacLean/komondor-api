# Review request — fourth pass

Your third pass returned **NO-GO**. You confirmed the three original P0s as genuinely closed,
then reproduced **six new blockers**, flagged **five test-integrity problems**, and gave a
six-item "minimum before a supervised deployment" checklist. This is my response to that.

Read all of it before answering. As in every prior round, I am **not** asking for a rubber
stamp. This time I have specifically included:

- one finding of yours I **could not reproduce and did not fix** (section 5a),
- one finding I **verified as not a bug** and am pushing back on (section 5b),
- one decision from the last round that I have now **reversed** because you were right that it
  blocked normal recovery — replacing a blunt refusal with real merge logic, which is new and
  unproven (section 5c),
- a **process failure of mine** that should lower your confidence in my own "done" claims
  (section 7).

If you find yourself agreeing with everything, sections 5, 6 and 7 are where to look harder.

---

## 1. What I need

A **go / no-go** on a supervised deploy of the three branches below, tied to whether your six
blockers are actually closed.

The most valuable thing you can do, as before: **re-run your own reproductions** against the
current tree rather than reading my summary or my tests. Your last pass caught things precisely
because you executed them — a real tus POST/PATCH, a real index conflict, a real `link(2)`
analysis. Three rounds running, the bugs that got through were ones where **my tests shared a
false assumption with the code they tested**, so a fully green suite proved nothing. Assume that
is still true somewhere.

Where you still object, please say plainly whether it is _"this loses data or breaks a normal
workflow"_ (blocking) or _"this needs a deliberate attacker"_ — read section 2 first.

---

## 2. Operating context (unchanged — the lens to judge by)

Small single-institution research API on a private network. Consumers are three sibling apps
(komondor-web, komondor-power, komondor-nudge). Users are research scientists submitting
sequencing data — **not adversaries**. **One PM2 fork-mode process.** Small team; readability
and avoiding needless complexity are real constraints.

**Priority is robustness, not defence against sophisticated attackers.** Weight findings by what
fires **by accident** — a directory typo, a concurrent upload, a browser tab dying mid-upload, a
deploy landing mid-ingest, a transient DB blip — over what needs a crafted payload. A fix that
adds meaningful complexity to stop an attack nobody here will mount is a bad trade; say so if
you see me making one.

---

## 3. Current state

```
komondor-api    branch security/gates-1-2-3            HEAD ea10957
komondor-web    branch fix/tus-authentication          HEAD c138bc4
komondor-power  branch fix/ingest-completion-contract  HEAD bb3d1cc
```

Nothing is pushed or merged. This is a coordinated three-repo release — **web and api must
deploy together**, or uploads break.

- **komondor-api:** 51 suites / **1672 tests** green. Note this figure **excludes** the 5
  integration suites: `jest.config.js` puts `/__tests__/integration/` in
  `testPathIgnorePatterns` because they need a real `mongod`. Those 5 were run green earlier
  today against a local `mongod`, which I have since stopped. If you want them, run
  `yarn test:integration` with a live Mongo.
- **komondor-power:** 16 files / **253 tests** green (vitest), typecheck clean.
- This round touched 10 files in the API: **+992 / −151**, roughly half of it tests.

---

## 4. Your six blockers, and what I did about each

### B1 — my own previous fix could adopt the wrong bytes (`6dde70c`)

Last round I changed `adoptAlreadyMovedFile` to reconcile a moved file by **size** instead of
inode. You pointed out that with no declared MD5 and an hpc-mv source that legitimately persists,
size alone lets a retry adopt a **different file of the same length** — a legitimate
re-upload/overwrite between attempts — and call it success.
**Fix:** in the `sourceMayPersist` branch, `lib/file-utils.js` now hashes both source and
destination and refuses to adopt unless the content matches. Size is no longer sufficient
evidence anywhere on that path.
**Cost I accepted, please sanity-check:** this can hash two files up to `UPLOAD_MAX_BYTES`
(default **50 GiB**) on a recovery attempt. It is a cold path — it only fires after a crash or
DB blip left a collision — but if you think that can stall the ingest queue or trip a timeout in
a way a smaller check would not, I would rather hear it now.

### B2 — the sweep could delete a file mid-upload (`ea10957`)

The abandoned-upload sweep judged staleness from the **blob's mtime** only. A large upload that
is being actively resumed — paused, retried, or slow — has no protection: nothing about a live
resumed session necessarily touches the blob mtime within the window.
**Fix:** `cleanupAbandonedUploads` now takes `Math.max(stats.mtimeMs, record.updatedAt)` as the
real last-activity signal, falling back to mtime when no registration exists. Two tests cover
both directions (stale blob + fresh registration must survive; stale registration must not).

### B3 — Power reported a failed ingest as success (`bb3d1cc`, komondor-power)

`pollRunsUntilComplete` detected `ingest.failed`, logged a warning, and then **returned
normally** — so the CSV entry was reported to the user as a success. It was also unexported and
therefore untested.
**Fix:** exported it, and the failed-ingest branch now throws `RunStatusContractError`, which is
what actually marks the entry as errored. New suite
`tests/unit/pollRunsUntilComplete.test.ts` — 7 tests covering completion, ingest-failure,
run-error, unanswered ids, multi-tick polling, timeout, and chunking.

### B4 — Power 400s for the full poll window on any CSV over 100 runs (`bb3d1cc`)

It called `komondorApiClient.batchRunStatus(runIds)` with the whole list; the API caps a batch at 100. A CSV creating 101+ runs therefore 400'd on **every** poll tick until the 30-minute timeout.
**Fix:** `fetchBatchRunStatus` chunks at `BATCH_STATUS_CHUNK_SIZE = 100` and merges the
responses. Covered by a >100-run test.

### B5 — the retention copy was neither crash-safe nor actually pinned (`d6cd5e4`)

Two problems in the same block of `models/File.js`:

1. The `keepSource` (HPC retention) branch wrote **directly to the final path** via
   `fs.copyFile`. An interrupt mid-copy left a permanently truncated file sitting at the real
   destination name, which then blocked every future retry with "destination already exists" —
   the rest of this file already used a write-partial-then-promote idiom; this path did not.
2. It called `fs.copyFile(pinnedPath, …)`, which **reopens by path**. The whole point of pinning
   an open handle earlier is that the path can be swapped underneath us; a path-based syscall
   throws that guarantee away and copies whatever is at the name at that moment.
   **Fix:** one shared `copyPinnedSourceTo(sourceHandle, pinnedSource, fullNewPath, file)` streams
   from the **already-open handle**, writes to a deterministic `.part-<id>` file with `flags: "wx"`,
   verifies the byte count against the pinned source, then promotes with `link` + `unlink` and
   cleans up the partial on any failure. **Both** the retention branch and the cross-device fallback
   now call it, replacing two divergent implementations. See section 6 — this is the change I most
   expect to have gotten subtly wrong.

### B6 — pairing and reingest (`91ec6e8`, `ba78681`)

- A local-filesystem entry declaring `paired: true` **with no `rowID`** was accepted and silently
  ingested **unpaired**. Now rejected at validation, with a group check that a `rowID` group under
  `label === "Raw file"` contains exactly two entries.
- A reingest could not correct **one** broken file in a pair without resubmitting the delivered
  rest — see section 5c, this is the reversal.

### Also fixed, from your "minimum before deployment" list

- **Index preflight (`9ef37df`):** `scripts/check-run-duplicates.js` compared only keys and
  `unique`, so a same-name, same-keys index carrying a `partialFilterExpression` or `collation`
  passed as "safe" and then failed startup with `IndexKeySpecsConflict` anyway. Now
  `isEquivalentToSchemaIndex` checks the full option set. Separately, `--fix` drops and recreates
  non-atomically; I **documented that honestly** rather than pretending otherwise (the docblock
  previously claimed it was safe to run live, which was false), added a duplicate re-check
  immediately before the drop, and made a post-drop `createIndex` failure loud and fatal instead
  of swallowed. The window is narrowed, **not closed** — the only real answer is quiescing Run
  creation, which the docblock now says.
- **Stale web E2E assertion (`c138bc4`):** the upload spec asserted
  `/uploads/files/<id>` — the path shape of `tus-node-server`, the library the API **replaced**.
  `@tus/server` generates `/uploads/<id>`. That assertion could only ever have passed against a
  server nobody runs. Corrected against a real running server.

---

## 5. Where I did not do what you asked

### 5a — the CORS/OPTIONS test-integrity finding: I could not reproduce it, and did not fix it

You flagged that `__tests__/routes/uploads.test.js` asserts CORS/capability headers that
production does not actually send. **I looked and could not find the gap.** Rather than invent a
fix for something I could not demonstrate was broken, I am handing you what I found:

- The test mounts the **real** router, with its real embedded `cors(corsOptions)`.
- `Tus-Max-Size` — the header I assumed you meant — is **not** supplied by CORS'
  `exposedHeaders` mechanism at all. `routes/uploads.js:263-266` sets it in an explicit
  middleware mounted **before** `cors()`, with a comment saying exactly why: `cors()` answers the
  preflight before the tus handler ever gets a chance to advertise it. So production does send
  it, on every request, including OPTIONS.
- `requireUploadAuth` (`routes/uploads.js:251`) exempts OPTIONS deliberately, because browsers
  send the preflight without credentials.

**The one thing I think is genuinely worth your attention here**, and which may be what you
actually saw: `corsOptions.origin` is `process.env.WEB_APP_URL`. If that were ever unset, `cors`
falls back to `*` — which would be a real hole. I believe it is closed:
`lib/utils/validateEnv.js:238` makes an unset `WEB_APP_URL` a startup error, and the test file
sets it explicitly to a production-shaped value. **Please check that reasoning rather than take
it.** If your finding was something else entirely, tell me what you actually executed — I would
rather fix it than keep defending it.

### 5b — the `ingest: null` vs `undefined` claim: I believe this is not a bug

I traced this through and could not make it fire. If you disagree, please give me the concrete
input that produces the wrong branch, because I could not construct one.

### 5c — I reversed last round's decision, and the replacement is new logic

Last round I fixed "a reingest correction was silently discarded" by **refusing the whole
replacement payload once any file had been delivered**, and I asked you directly whether that was
too blunt. You were right that it is: it blocks the _normal_ recovery case, where one file of a
pair arrives corrupt and the scientist wants to resubmit **just that one**.

So `routes/runs.js` now **merges** instead:

- `entryFingerprint(file)` — stable comparison of a submitted entry against the original.
- `mergeReplacementList(originalList, submittedList, delivered)` — carries delivered files
  forward from the stored job payload, applies the correction to undelivered ones, and 409s
  **naming the specific file** if the payload tries to change something already delivered.
- Raw and additional file lists merge independently.
- New `validatePartialFilesPayload` for the pre-merge submission (which legitimately may not
  contain `rawFiles` at all, if the correction is only to `additionalFiles`);
  `validateIngestFilesPayload` still guards the **merged** result, which is always complete.

**This is the single largest behavioural change of the round and it is brand new.** Merge
semantics are exactly where silent data-loss bugs live — a carried-forward entry that should have
been replaced, or a replaced one that should have been carried. Please attack it directly.

I will also flag: while building this, I found that the **old** test for the delivered-file case
passed for the wrong reason — it never configured the job-lookup mock with a real original
payload, so the fingerprint comparison was trivially true regardless of the logic under it. That
is a fourth instance of the pattern you have now flagged three rounds running.

---

## 6. What I most expect to be wrong

Ranked by my own confidence, least confident first:

1. **`copyPinnedSourceTo` (`models/File.js`, `d6cd5e4`).** ~177 lines changed, and it collapsed
   **two** previously separate implementations into one shared function used by both the
   retention path and the cross-device fallback. Consolidation like that is where a case gets
   quietly dropped. Specifically worth checking: partial-file cleanup on every failure path; the
   `flags: "wx"` collision case; whether the byte-count check can pass on a source that changed
   size mid-stream; and whether the `link`/`unlink` promotion behaves the same on Linux as it
   does here.
2. **`mergeReplacementList` (`routes/runs.js`).** See 5c.
3. **The double-MD5 adoption cost.** See B1.
4. **`fixStaleIndex`'s non-atomic window.** Documented, narrowed, not closed. Tell me if you
   think documenting it is insufficient and it needs to be prevented in code.
5. **A fifth instance of "the test agrees with the code on a false assumption about an external
   system."** It has been there in every round so far, including this one. I would bet on it
   being there now.

While building B5's tests I hit this pattern in my own work in real time: my first TOCTOU test
hooked `fsp.unlink` to perform the path swap, but the **old** code never called `fs.unlink` on
that path — so the swap never happened and the test passed against the unfixed code. It only
became a real test after re-hooking to `fsp.open`, the one call both the old and new paths share.
Every new test this round was mutation-verified (revert the fix, confirm the test goes red), and
that one is why.

---

## 7. A process failure that should lower your confidence in my claims

I built and mutation-verified the B1 and B2 fixes at the **start** of the session, then moved on
to the Power work without committing them. They sat as uncommitted working-tree changes for the
entire rest of the session while my own notes recorded them as done. I caught it during final
cleanup with a routine `git status` — not because I was tracking it. They are committed now
(`6dde70c`, `ea10957`) and I diffed them against what I had built before committing.

I am telling you this because it means **my "done" claims can run ahead of the tree**. Verify
against `git show` and the working tree, not against this document.

---

## 8. Knowingly accepted / deferred (argue any you disagree with)

- **Not verified on Linux.** Still Darwin only. This matters more than usual: the `link(2)`
  symlink fix from round 3 existed _because_ of a Darwin/Linux divergence, and B5 adds new
  `link`/`unlink` promotion behaviour on a path that previously used `copyFile`. A real Ubuntu CI
  run remains my top recommendation before shipping.
- **Mongoose 5→7 not attempted.** One critical advisory open. A blind major ORM upgrade without a
  real-Mongo compatibility suite is riskier than the advisory for this deployment; there is a
  written migration plan and an integration harness to gate it.
- **Shared HPC inbox** stays a flat shared directory — a directory typo can still move another
  group's file. Mitigated by attribution logging, not prevention, per the owner's decision. The
  destructive half is reduced: retention keeps an independent copy, so a mis-typed claim no
  longer destroys the only copy.
- **Login/LDAP rate-limiting and SMTP TLS verification** not done — accepted for a trusted
  internal network.

---

## 9. What to return

1. **Go / no-go**, tied to whether your six blockers are actually closed.
2. For B1–B6: closed / not closed, ideally with a re-run reproduction rather than a code read.
3. **Am I wrong in 5a?** If your CORS finding was real, tell me what you executed.
4. **Attack `mergeReplacementList` (5c) and `copyPinnedSourceTo` (6.1).** These are the two new
   things most likely to lose data.
5. Any **fifth** instance of the test-hides-a-false-external-assumption pattern.
6. The smallest set of things that still block a **supervised** deploy, if any.

Be direct. If the honest answer is still no-go, say why. If these hold up now, say that too —
but only after re-checking, not from this summary.
