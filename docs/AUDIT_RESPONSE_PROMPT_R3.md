# Review request — third pass

You audited this codebase last on **Tuesday at 17:49** and returned a detailed **NO-GO**, with
three P0 blockers, several P1s, and a set of test-integrity concerns. This is the follow-up: I
have acted on that NO-GO, and I want you to judge whether the specific things you blocked on
are genuinely closed, and whether anything new broke in the process.

Read all of this before responding. As before, I am **not** asking for a rubber stamp. I have
included the risks I knowingly accepted, one place I chose a simpler fix than you might, and —
importantly — **two additional bugs a later internal review found, one of which I introduced
while fixing your findings**. If you find yourself agreeing with everything, look harder at
sections 4 and 5.

---

## 1. What I need

A **go / no-go** on deploying the three branches below, with your reasoning tied to whether
your Tuesday blockers are actually resolved. Where you still object, say plainly whether it is
"this loses data / breaks a normal workflow" (blocking) versus "this needs a deliberate
attacker" (read section 2 first).

The single most valuable thing you can do: **re-run your own Tuesday reproductions** against the
current code and tell me if they are closed. Your Tuesday audit reproduced several bugs by
execution (a real tus POST/PATCH, a real Mongo index conflict, a Linux `link()` analysis).
Those reproductions are the ground truth I most want re-checked.

---

## 2. Operating context (unchanged from prior rounds — the lens to judge by)

Small single-institution research API on a private network. Consumers are three sibling apps
(komondor-web, komondor-power, komondor-nudge). Users are research scientists submitting
sequencing data — not adversaries. **One PM2 fork-mode process.** Small team; readability and
avoiding needless complexity are real constraints. **Priority is robustness, not defence
against sophisticated attackers.** Weight findings by what fires **by accident** — a directory
typo, a concurrent upload, a browser tab dying mid-upload, a deploy landing mid-ingest, a
transient DB blip — over what needs a crafted payload.

---

## 3. Your Tuesday blockers, and what I did about each

Three repos changed. Current heads:

```
komondor-api    branch security/gates-1-2-3            HEAD 1a327e4
komondor-web    branch fix/tus-authentication          HEAD 8e6b639
komondor-power  branch fix/ingest-completion-contract  HEAD a3c8f93
```

Nothing is pushed or merged. API suite: **51 suites / 1652 tests green**, plus **5 integration
suites against a real MongoDB**. Dependency audit: 19 findings (1 critical, 4 high) — the
critical is still Mongoose, deferred (section 6).

### P0-1 — every completed upload was rejected, and could be deleted
You reproduced (real POST+PATCH) that `@tus/file-store` writes `offset:0` at creation and never
updates it, so my `assertUploadComplete` — which compared the sidecar's `offset` to its `size`
— refused every finished upload, and the abandoned-upload sweep could then **delete** it.
**Fix (commit `7ac121f`):** a single `readUploadState` now reads the declared size from the
sidecar and the **real bytes from `stat(blob)`**; claim, restart-recovery, and sweep all use it.
No production code reads the sidecar `offset` any more.
**And the reason it shipped:** my integration fixture hand-wrote a sidecar in a state the real
library never produces (`offset === size`). The fixture now **drives a real tus server over
HTTP**. Please re-run your POST+PATCH reproduction against the current code.

### P0-2 — the web client sent no auth, so every upload would 401
The API now requires auth on the tus mount; komondor-web's Uppy config sent no `Authorization`.
**Fix (komondor-web `92baf6b`):** `onBeforeRequest` adds the bearer token per request. This is a
coordinated release — **web and api must deploy together**. Please verify the assumption I was
most exposed on: that `@nuxtjs/auth` `getToken("local")` returns the value **with the "Bearer "
prefix** (my internal review checked the installed lib and believes it does; confirm), and that
the API's CORS actually admits the `Authorization` preflight.

### P0-3 — permitted leaf symlinks failed on Linux
You found `fs.link()` was called with the raw symlink path; Linux does not dereference a symlink
as `link(2)`'s oldpath, so the destination linked the wrong inode and was then deleted. This
machine is Darwin, which follows — so it passed here and would fail on your Ubuntu CI.
**Fix (commit `7ed7b72`):** `openPinnedSource` now returns the **resolved target path**, and the
move links that, so there is no symlink at `oldpath` on either platform.
**Note:** an internal re-review executed the `O_NOFOLLOW`→`ELOOP` behaviour on Darwin and found
it returns `ELOOP` (errno 62) **identically to Linux**, so the local tests do exercise the
fallback. But the `link(2)` correctness on Linux is still **reasoned from the man page, not
executed** — I have no Linux host here. This is the item I most want a second opinion on, and
the reason I recommend a real Ubuntu CI run before shipping.

### P1s you raised — all addressed
- **Malformed payloads became poison jobs / reingest replayed the same mistake** (`0b5555c`):
  validation now matches what the worker actually requires (rejects nested `data.name`, a
  local-filesystem entry with no `uploadName`, non-string `md5`, duplicate names, a sibling not
  in the list); reingest accepts a corrected payload.
- **HPC "retention" was a hard link (same inode), so overwriting staging mutated the archive**
  (`7ed7b72`): retention is now an independent copy (`fs.copyFile` with `COPYFILE_FICLONE |
  COPYFILE_EXCL`).
- **TUS completeness / global free-space race / lost reservations on restart** (`7ac121f`):
  addressed via `readUploadState`, cross-user reservation accounting, and startup reconstruction
  from sidecars.
- **Run index migration would silently fail; the preflight lied** (`92fcd6d` + prior): the
  preflight now compares index **keys and options**, not just the name, and `Run.init()` /
  `IngestJob.init()` make an index-build failure fatal at startup.
- **Power reported false success** (komondor-power `a3c8f93`): it now requires exact
  requested-id coverage, treats a missing/incomplete response and a poll **timeout** as failure,
  keys success on `ingest.done` / failure on `ingest.failed`, and forwards `project_nudgeable`.
- **Release gates that passed without checking** (`92fcd6d`): fixed `MONGO_URI`→`MONGODB_URI` in
  nightly, removed `--passWithNoTests`, made the dependency-audit parser reject a truncated
  stream, and stopped tests hitting a real SMTP host.

---

## 4. Two bugs my own review found AFTER fixing yours — scrutinise these

I ran an internal adversarial pass over my own fixes. It found two more, both "fires by
accident," and I want you to confirm the fixes and check I did not create a third.

### 4a — reingest correction was still a silent no-op (commit `c00a5ee`)
My P1 reingest fix (`0b5555c`) only blocked **dropping** an already-delivered file. A payload
that **kept** a delivered file's name but changed its `uploadName`/`md5` passed the guard,
returned 200, and was then silently discarded (the retry planner matches delivered files by
name and skips them) — the run finished "complete" with the **old** file. My own comment claimed
this case was handled; it was not.
**Fix:** a replacement payload is now refused entirely once **any** file has been delivered (a
plain reingest still retries the rest). I chose this over per-field diffing because hpc-mv
entries legitimately omit `uploadName`, so a field-by-field compare false-positives. **Is
refusing the whole payload too blunt for your taste, or the right robustness/simplicity trade?**

### 4b — I introduced a regression while fixing P1 (commit `1a327e4`)
Changing HPC retention from a hard link to a **copy** (P1 fix above) gave the datastore file a
**different inode** from the retained source. But the ingest recovery path
(`adoptAlreadyMovedFile` in `lib/file-utils.js`) still required them to be the **same inode** —
it was never updated. Result: a transient DB blip between a successful hpc copy and its save
left the destination occupied and **every retry stuck on "destination already exists," forever**,
for the ordinary same-device case that previously self-healed. Reproduced by execution.
**Fix:** the recovery now matches source-to-destination by **size** (inode-agnostic), which also
closes a pre-existing cross-device gap. **Please sanity-check the size-based reconcile** — a
same-size unrelated file at the exact run-specific destination path is the only false-adopt I
can construct, and I judged it not reachable by accident. Tell me if you see another.

**The meta-point, and why I keep re-auditing:** in both 4a and 4b the **test fixtures shared the
same false assumption as the code** (a mock that never exercised the guard; a fixture that
hard-linked instead of copying), so a fully green suite hid both. This is the exact failure mode
you flagged in round 2. I fixed the fixtures too and mutation-verified each new test (reverted
the fix, confirmed the test goes red). But it is why I trust an execution-based audit over my
own green checkmarks — please keep probing external-behaviour assumptions rather than reading
tests.

---

## 5. What to hunt for specifically

1. Re-run your Tuesday reproductions (tus completeness; index conflict; the Linux `link()`
   reasoning) and tell me which are genuinely closed.
2. A **third** instance of the "test agrees with code on a false external assumption" pattern —
   any remaining fixture that asserts against a state the real library / filesystem / OS would
   not produce.
3. The web↔api↔power boundary: does the API's `/runs/batch-status` response actually carry the
   `ingest` / `missing` / `invalid` fields Power now reads, with consistent id casing? Does the
   Power timeout-throws change propagate somewhere sane rather than becoming an unhandled
   rejection?
4. Anything in 4a / 4b I got wrong or half-fixed.

---

## 6. Knowingly accepted / deferred (argue any you disagree with)

- **Mongoose 5→7 not attempted.** One critical advisory remains open. A blind major ORM upgrade
  with no real-Mongo compatibility suite is riskier than the advisory for this deployment; there
  is a written migration plan and an integration harness to gate it.
- **Shared HPC inbox** stays a flat shared directory (a directory typo can move another group's
  file); mitigated by attribution logging, not prevention, per the owner's decision. Note: the
  destructive half is now reduced — retention keeps an independent copy, so a mis-typed claim no
  longer deletes the only copy.
- **Login/LDAP rate-limiting and SMTP TLS verification** not done — accepted for a trusted
  internal network.
- **Not verified on Linux or against a real deploy.** Darwin + local Mongo only.

---

## 7. What to return

1. Go / no-go, tied to whether the Tuesday blockers are closed.
2. For P0-1, P0-2, P0-3: closed / not-closed, ideally with a re-run reproduction.
3. Your read on 4a (too blunt?) and 4b (a false-adopt I missed?).
4. Any third instance of the test-hides-external-assumption pattern.
5. The smallest set of things that still block a supervised deploy, if any.

Be direct. If the honest answer is "still no-go," say why. If it is "these hold up now," say
that too — but only after re-checking, not from the summary.
