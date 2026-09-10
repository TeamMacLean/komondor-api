# Review request — sixth pass

Your fifth pass returned **NO-GO**: B1 and the CORS regression closed, B5, B6 and the Mongo
preflight not closed, and the upload-reservation gap promoted to blocking. Every one of those
findings was correct. I reproduced all of them before fixing, and **this round I found nothing in
your audit to push back on** — which has not been true in any previous round.

Read section 4 first. It is the disclosure that matters: the `rowID` contract you found me
enforcing was **invented in my own tests**, it appears nowhere in any client, and writing the
contract test you asked for immediately surfaced **a second break of the real web client that
your audit did not catch either**. Both would have 400'd ordinary uploads in production.

---

## 1. What I need

A **go / no-go** on a supervised deploy of the three branches below.

Same request as every round: **re-run your own reproductions** rather than reading my summary.
Five rounds in, every bug that survived did so because a test and the code agreed about something
the outside world does not do — and in round 4 I used one of those tests to argue against a
finding of yours that was right.

The specific thing I want hardest scrutiny on this time is **the client boundary** (section 4).
That is where both of us had a blind spot.

---

## 2. Operating context (unchanged — the lens to judge by)

Small single-institution research API on a private network. Consumers are three sibling apps
(komondor-web, komondor-power, komondor-nudge). Users are research scientists submitting
sequencing data — **not adversaries**. **One PM2 fork-mode process.** Small team; readability and
avoiding needless complexity are real constraints.

**Priority is robustness, not defence against sophisticated attackers.** Weight findings by what
fires **by accident** — a `cp -p` re-send, a slow upload, a JWT expiring, a `chmod -R` landing
mid-copy, a deploy landing mid-ingest — over anything needing a crafted payload.

---

## 3. Current state

```
komondor-api    branch security/gates-1-2-3            HEAD 21b77cf
komondor-web    branch fix/tus-authentication          HEAD ae99a15
komondor-power  branch fix/ingest-completion-contract  HEAD 3e6a70d
```

Nothing pushed or merged. **Deploy web FIRST, then the API** — you corrected me on that and you
were right; new web is backward-compatible with the old permissive endpoint, new API against old
web 401s immediately.

- **komondor-api:** 52 suites / **1723** unit tests, plus **5 suites / 15 tests** integration
  against real MongoDB 7.0.29. This round: 18 files, +1353 / −105.
- **komondor-web:** 16 files / **501** tests.
- **komondor-power:** 16 files / 253 tests, `yarn run verify` green. Untouched this round.

---

## 4. The contract I invented — and the one you missed too

You found the API demanding `rowID` on paired local-filesystem entries while the real web sends
`sibling` + `paired`. I checked, and it is worse than the finding states.

**`rowID` exists nowhere.** Not in komondor-web (only in commented-out code in
`components/AdditionalFileList.vue`), not in komondor-power (it emits `sibling` from
`read_siblingFullHpcPath`), not in komondor-nudge, not in any migration. The only occurrences in
either repository are **in my own tests**. I invented the shape in a fixture and then enforced it
in production code.

So the damage ran in both directions, and the first half predates the validation:

- `siblingLinks` read `sibling` only for `hpc-mv` and paired local reads by `rowID`. Since nothing
  sends `rowID`, **every paired local-filesystem upload has been landing silently unpaired** for
  as long as that split has existed — completing as "complete" with `sibling: null` on both Reads.
- Round 3 then turned that silent failure into a hard 400 on every paired local run.

**Fix (`141344b`):** `siblingLinks` pairs on mutual `sibling` for both methods, with `rowID` kept
as a fallback; validation accepts either mechanism. `__tests__/contract/web-paired-payload.test.js`
pins the exact serialised payload komondor-web emits and asserts **both** that validation accepts
it and that `siblingLinks` actually pairs it — the second half matters, because accepting a
payload the worker then leaves unpaired is the original bug. komondor-web carries the mirror
(`ae99a15`), so the two repos cannot drift in silence again.

### The second break, which your audit did not report

The contract test failed on its **first run** for a reason neither of us had named:

```
400 ... Raw file at index 0 has a non-string md5; Raw file at index 1 has a non-string md5
```

komondor-web sends `md5: this.fileMd5Inputs[file.name]?.trim() || null` for **every** file, and
`pages/runs/new.vue` posts `processedFiles` straight through. My round-3 validation rejected any
non-string `md5`. So **every upload where the user typed no checksum would have 400'd** — paired
or not, local or HPC. Downstream was already null-safe (`file.md5?.toLowerCase()`); only the guard
was wrong.

I am flagging this at you rather than burying it because it says something about the audit method
we have both been using: you executed a _paired_ payload and found the rowID break, but the
`md5: null` break sits on the unpaired path too and only surfaced when a fixture was pinned to the
client's real output. **Please check whether there is a third field in the same class** — I have
diffed the web's `confirmSelection` output against `fileEntryShapeError` by hand and believe not,
but that is exactly the kind of hand-check that has failed here repeatedly.

---

## 5. Your other blockers

### B5 — mixed bytes still promoted — FIXED (`f867695`)

Both of your points were right and I verified each before fixing:

- **`cp -p` preserves mtime.** Measured: same inode, same size, same mtime, different content.
  `rsync -t` and `tar -p` too. A size+mtime comparison cannot see an ordinary re-send.
- **The handle-closing premise was avoidable.** `createReadStream({ autoClose: false })` leaves
  `sourceHandle.stat()` usable — measured on Darwin. And the pathname guard was independently
  defeatable exactly as you described: a different-inode result made the check skip itself.

Now: fstat through the descriptor, so the question is always about the inode actually read. Size
or mtime moving is refused outright. **ctime alone** moving is ambiguous — it also moves for a
chmod or an added hard link, measured, and `HPC_TRANSFER_DIRECTORY` is a shared inbox other
people's tooling runs over — so in that narrow case the digests decide, which is your suggested
design.

This also exposed a latent bug in `lib/utils/md5.js`: given an already-streamed handle it hashed
from the current position (EOF) and returned the digest of **zero bytes**, silently. It now reads
from `start: 0`.

**My first test for this passed for the wrong reason** and I caught it in mutation verification:
`fs.utimesSync` takes seconds-as-number and cannot restore a sub-millisecond mtime, so the `cp -p`
simulation left mtimeMs slightly different and tripped the size/mtime check instead of the one
under test. The source's mtime is now pinned to a whole second first so the restore is exact the
way `utimensat`'s is.

### B6, remaining paths — FIXED (`d3fe4b0`)

- **Orphan `File` on an absent HPC file.** The row is saved before the move (deliberately —
  BREAKING_CHANGES §30), so a move that never happened left a document nothing references, and the
  unique index made every later retry die on E11000. Now deleted in exactly the branch where
  nothing moved and nothing was adopted. **Two existing tests asserted that no cleanup happened** —
  that assertion was the bug written down; they now assert the opposite.
- **Un-pairing left `paired:true, sibling:null`.** Finalisation only ever SET a sibling. It now
  computes the desired links and reconciles — added, changed, or cleared — with `paired` written
  alongside `sibling` so the two cannot drift. Scoped to the names the payload speaks for; I
  confirmed `finaliseReadStage` receives the **full** `payload.rawFiles`, not the retry subset, so
  a partial retry cannot clear a pairing whose mate it did not happen to be moving.

### 6.1 upload reservation — FIXED (`5bcc5f6`), and you were right to promote it

I had judged this out of scope last round; that was wrong. You also caught that **my proposed fix
does not work**: `@tus/server` emits `POST_RECEIVE` only after the PATCH body finishes, and
`POST_RECEIVE_V2` stops while a request is paused. You checked the installed library rather than
taking my word for it, which I should have done myself.

Liveness now comes from the request: the mount marks an upload active for as long as its response
is open (`finish` and `close`, latched), and `pruneIdleUploads` skips anything with an open
request. Reference-counted, because a resumed upload can briefly overlap its own previous request.
Tests cover the logic **and** the wiring — a leak there would be worse than the bug, since an
upload marked active forever holds its reservation until the process restarts.

### Preflight — FIXED (`19ad350`)

Your matrix was right on every case. I re-derived the server's actual rule by execution, one probe
per option against 7.0.29:

| existing index, custom name                             | server         |
| ------------------------------------------------------- | -------------- |
| unique / +background / +storageEngine / +hidden         | **REFUSES 85** |
| unique + sparse / +collation / +partialFilterExpression | ACCEPTS        |
| not unique                                              | ACCEPTS        |

The bug was using one predicate for two different questions. "Would mongoose's build be a no-op"
and "does MongoDB consider this the same index" are not the same test, and the second is looser.
There are now two.

- **Collection default collation:** verified that such a collection stamps the collation onto
  every index including `_id_` and the healthy `sample_1_name_1`, and that `Run.init()` resolves
  happily against it. `_id_` is the tell — nothing configures it per-index — so options present
  there are discounted as defaults.
- **Fresh database, no `runs` namespace:** the driver throws `NamespaceNotFound` rather than
  returning an empty list, which the outer catch reported as exit 2. Now exit 0 with a line
  saying why.

Re-verified end to end after the change: all four matrix cases agree with the server, a fresh
database exits 0, a default-collation collection exits 0.

### Legacy payloads — you disproved my escape hatch (`21b77cf`)

I claimed a plain no-body reingest was the way out for a stored payload predating the
canonical-name rule. You showed by execution that it is not. BREAKING_CHANGES §37 now says so.

Rather than a migration — which would be wrong, since a run whose files are already delivered
needs a different correction from one whose files never arrived — there is now
`scripts/inspect-ingest-backlog.js`: read-only, lists every stored payload this release would
refuse and why, and exits 0 in one line when the `ingestjobs` collection does not exist, which per
your note is the likely production state. Verified against seeded data covering a non-canonical
name, a one-way pair, a settled job correctly ignored, and a clean job.

### Your sixth false-assumption instance, and the other two

All three confirmed and fixed. The preflight's test double returned one frozen index list no
matter what `dropIndex`/`createIndex` had done — it is stateful now. The destination-symlink test
credited an "inode guard" this path no longer uses and passed on a size difference; the comment
now says what it actually tests.

---

## 6. What I did NOT fix

- **6.2 — Power's 30-minute delay before some terminal errors surface.** You classified it
  deferred and confirmed correctness is preserved. Unchanged.
- **Nested `entryFingerprint`.** Real, as you say — changing `data.md5` under a delivered entry
  returns 200 and is then discarded. Nested `data` is not used to identify or move bytes, so I
  took your classification of follow-up. **Say if you want it closed before deploy.**
- **19 pre-existing web lint errors** on files this branch does not touch.
- **`planRawFileStage` / `pendingAdditionalFiles` still match raw payload strings.** New payloads
  can no longer be non-canonical, so this cannot arise going forward; a stored one still can,
  which is what the backlog inspector is for.

---

## 7. What I most expect to be wrong

1. **`siblingLinks`' new fallback order.** It prefers mutual `sibling` declarations and falls back
   to `rowID` only when there are none. I believe that is safe because nothing sends `rowID`, but
   it is new branching in the one function that decides pairing, and pairing is where this round's
   worst bug lived.
2. **The un-pair reconciliation's scope.** It writes `sibling: null, paired: false` for any named
   read whose link the payload no longer declares. I have convinced myself the payload is always
   the full list — please check that a retry, a reingest with a partial replacement, and a
   fresh run all reach it with the same shape.
3. **A regression in this round's fixes.** Round 4's internal review found three in five commits.
   I did not run one this round; six of the seven commits here are direct responses to your
   reproductions, but that is not an argument.
4. **A fourth field in the client-payload class** (section 4).
5. **The `ctime`-then-digest branch under load.** It re-reads the whole source. On a 50 GiB file
   with a backup agent touching xattrs, that is a full extra pass — correct, but is it acceptable?

---

## 8. Knowingly accepted / deferred

- **Not verified on Linux.** Still Darwin only. You ran a Debian/Node 24 subset last round; the
  full suite plus the HPC-retention tests on Linux remains the gap I most want closed, and it
  matters more now that `copyPinnedSourceTo` carries `link`/`unlink` promotion and the B5 guard
  rests on `fs.stat` semantics.
- **Mongoose 5→7 not attempted.** One critical advisory open.
- **Shared HPC inbox** stays flat; mitigated by attribution logging, per the owner's decision.
- **Login/LDAP rate-limiting and SMTP TLS verification** not done — trusted internal network.

---

## 9. What to return

1. **Go / no-go.**
2. B5, B6, the preflight and 6.1: closed / not closed, with a re-run reproduction.
3. **Is there a third or fourth field where the API and the real web client disagree?** (section 4)
4. Attack `siblingLinks` and the un-pair reconciliation (7.1, 7.2).
5. Should the nested `entryFingerprint` gap block? (section 6)
6. Any seventh instance of the test-hides-a-false-external-assumption pattern.
7. The smallest set of things that still block a **supervised** deploy.

Be direct. If it is still no-go, say why.
