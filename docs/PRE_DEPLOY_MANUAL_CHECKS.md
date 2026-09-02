# Manual checks before deploying `security/gates-1-2-3`

Everything in this file is something **I could not verify** — because it needs a Linux host, the
production database, a real HPC mount, a real browser, or your judgement. Work through it in
order. Each step says what "pass" looks like and what to do when it doesn't.

**Read step 0 before anything else.** It is the one that can take the API down.

```
komondor-api    security/gates-1-2-3            3b230a9
komondor-web    fix/tus-authentication          d8e1c4c
komondor-power  fix/ingest-completion-contract  3e6a70d
```

Nothing is pushed. Automated state at the time of writing: API 1698 unit + 15 integration
(real MongoDB 7.0.29), Power 253, Web 499 — all green, Darwin only.

---

## 0. STOP — this release can refuse to boot

A previous round made an index-build failure **fatal at startup** (`Run.init()` /
`IngestJob.init()` are awaited by `server.js`). That was deliberate: mongoose otherwise only
*logs* the failure and the app serves traffic with the uniqueness constraint quietly absent.

The consequence is that **if production's `runs` collection has a conflicting index, this deploy
will not start.** I verified against real MongoDB 7.0.29 that `Run.init()` rejects with error 85
even when the existing index is a perfectly good unique index that merely has a different name.

Run the preflight against production **before** you deploy, from the prod box:

```bash
cd /storage/www/komondor-api && node scripts/check-run-duplicates.js
```

Read-only. Nothing is written, nothing is locked, safe while the API is serving.

| Exit | Meaning | Do |
|---|---|---|
| **0** | Safe to deploy | Continue to step 1 |
| **1** | Duplicate `{sample, name}` documents exist | **Stop.** Resolve them by hand (keep the run with files attached, rename or delete the others), then re-run |
| **3** | A conflicting index is present | **Stop.** See below |
| **2** | Could not connect or query | **Stop.** Fix that first — do not deploy blind |

On exit 3, the output names each conflicting index and why. To repair:

```bash
cd /storage/www/komondor-api && node scripts/check-run-duplicates.js --fix
```

**`--fix` is not safe to run while runs are being created.** It drops and rebuilds, and between
those two steps nothing enforces uniqueness. Do it in the deploy window with the API stopped. If
it prints anything about the collection **STILL** reporting a conflict after rebuilding, stop and
read that message — it means the collection carries index option defaults and re-running `--fix`
will not help.

---

## 1. Run the suites on Linux — the biggest gap I cannot close

I am on Darwin. Two things in this release depend on behaviour that genuinely differs:

- `copyPinnedSourceTo` now promotes with `link()` + `unlink()` on a path that previously used
  `copyFile()`. The round-3 symlink bug existed *precisely because* Linux's `link(2)` does not
  dereference a symlink given as `oldpath` and Darwin's does.
- The new mid-copy mutation guard rests entirely on `fs.stat` timestamp semantics (`mtimeMs`,
  `size`). Timestamp granularity is filesystem-dependent.

On an Ubuntu/Debian box with the same Node major as production:

```bash
git checkout security/gates-1-2-3 && yarn install --frozen-lockfile && yarn jest
```

**Pass:** 51 suites / 1698 tests. **Fail:** send me the output — do not work around it.

Then the integration suites, which need a real mongod:

```bash
MONGODB_URI=mongodb://localhost:27017/komondor-integration-test yarn test:integration
```

**Pass:** 5 suites / 15 tests. The suite now *refuses* to run without an explicit `MONGODB_URI`
(it used to silently target a different database than the app) — that error is correct behaviour,
not a failure.

---

## 2. Verify the HPC retention path against a real mount

The unit tests use a temp directory on one filesystem. Production's HPC inbox and datastore may
be separate mounts, which is the whole reason the cross-device copy path exists.

With a scratch run on the real mounts, confirm:

- [ ] An `hpc-mv` claim leaves the source **in place** and the datastore copy is a **different
      inode** (`stat -c %i <src> <dst>` — the two numbers must differ).
- [ ] A permitted **symlink** in the inbox is claimed successfully, and the datastore ends up
      with the real bytes, not a link (`stat -c %F <dst>` → `regular file`).
- [ ] Interrupting a large claim mid-copy (kill the API) leaves **no file at the destination
      name** and no leftover `.part-*` file, and a retry then succeeds.

That third one is the crash-safety property, and it is the one worth actually doing rather than
trusting.

---

## 3. Deploy web and API together — they will not work apart

The API now requires authentication on the tus mount; the web client only started sending it on
`fix/tus-authentication`. **Old web + new API = every upload 401s.**

Order:

1. API into the deploy window (writes quiesced), preflight already green from step 0.
2. Web immediately after.
3. Power any time — its changes are independent.

Check the API actually came up:

```bash
pm2 logs komondor-api --lines 50
```

`[LOGIN]` and `[Background Job]` lines go to **stdout**; the log you usually paste is **stderr
only**. If the process is restart-looping, the index build is the first thing to suspect — go
back to step 0.

---

## 4. Smoke test through the real browser

Not curl. The CORS and preflight behaviour changed, and only a browser exercises it properly.

- [ ] **Upload a small file** through the real web app. It should complete.
- [ ] With devtools open, confirm the `OPTIONS /uploads` preflight returns the tus capability
      headers (`Tus-Max-Size`, `Tus-Version`, `Tus-Extension`). These were missing before this
      release.
- [ ] **Let a token expire, or clear it, and retry an upload.** The response must be a **401 with
      `Access-Control-Allow-Origin` set** — you should see a readable
      `{"error":"Authentication required"}`, *not* an opaque CORS failure in the console. I broke
      this once during this round and caught it only in review; it is worth confirming with your
      own eyes.
- [ ] Confirm a non-upload route (e.g. loading the runs list) still works — the CORS change is
      scoped to `/uploads`, and I want that scoping confirmed against the real origin.

---

## 5. Smoke test the reingest correction — the headline fix

This is the workflow the whole B6 fix exists for, and it has never run against production data.

- [ ] Create a **paired** run where one file has a deliberately bad upload id, so the ingest
      fails with one mate delivered and one not.
- [ ] `POST /runs/:id/reingest` with a replacement payload containing **only the broken file**.
      It must return **200**, not 400. Before this release it returned
      `400 rowID "..." has 1 paired entry`.
- [ ] Confirm the run completes and **both** Reads end up with a non-null `sibling`.
- [ ] Try changing an **already-delivered** file's `uploadName` in a replacement payload. It must
      return **409** naming that file — the guard against a silent no-op.

---

## 6. Watch for these in the first week

Grep the logs (**stdout**, not just the stderr you usually paste):

- `the source was modified while it was being copied` — the new mid-copy guard firing. A few is
  expected if people re-scp over staging names. A **flood** means the guard is too strict for
  your workflow; tell me and I will revisit it (I already removed a `ctime` comparison for
  exactly this reason).
- `is not a bare filename` — the new canonical-name rule (BREAKING_CHANGES.md §37) rejecting a
  client that used to work. If komondor-nudge or a script sends path-qualified names, this is
  where you will find out.
- `Expected 2 paired reads for rowID` — should now be impossible via the API, since validation
  refuses it at the door. If it appears, a payload is reaching the worker without going through
  `POST /runs/new`.

---

## 7. Rollback

Nothing is pushed, so rollback is `git checkout` of the previous deployed commit plus a `pm2
reload` — **but roll back web and API together**, for the same reason you deployed them together.

The one thing that does **not** roll back cleanly: if you ran `--fix` in step 0, the index was
renamed to `sample_1_name_1`. That is what the old code expects too, so it is fine — but do not
re-create the old custom-named index to "undo" it.

---

## 8. Known open items — your call, not mine

These are real and unfixed. I flagged all three to the auditor in
`docs/AUDIT_RESPONSE_PROMPT_R5.md`; none of them is a silent-corruption risk.

1. **A single upload PATCH lasting longer than `UPLOAD_IDLE_MINUTES` (default 60) loses its quota
   reservation.** Activity is recorded once when the request arrives, and the idle prune runs on
   every new admission. With `UPLOAD_MAX_BYTES` at 50 GiB, a slow single PATCH exceeding an hour
   is ordinary here, not an edge case. It self-heals on the next request, but in between the
   free-space floor is computed without that upload. **This may be the most likely-to-fire item
   left in the codebase.** The fix is small (touch from the tus `POST_RECEIVE` hook, which
   already fires) — say the word and I will do it before you deploy.
2. **Power waits the full 30-minute poll window before reporting some terminal errors.** The entry
   is still correctly marked as errored; it is a latency and message-quality problem.
3. **19 pre-existing lint errors in komondor-web**, on files this branch does not touch.

---

## If you cannot iterate with ChatGPT any further

Then the minimum I would want done before this touches production is, in order:

1. **Step 0** — non-negotiable, this release can fail to boot without it.
2. **Step 1** — the Linux run. If you do only one thing from this list beyond step 0, do this;
   it is the gap that has already produced one real bug in this codebase.
3. **Step 4's expired-token check** — the specific thing I broke and self-caught this round.
4. **Step 5** — the reingest correction, since it is the headline change and has never run
   against real data.

Steps 2, 3 and 6 are confirmations of things I have reasonable evidence for. Steps 1, 4 and 5
cover things where my evidence is Darwin-only, my own test suite, or nothing.
