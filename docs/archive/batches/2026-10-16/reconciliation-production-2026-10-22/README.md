# Production database reconciliation — 22 October 2026

**Status: applied to production and independently verified. API, Web, Power and
Nudge are online.** This follows the 22 completed
[Project registrations](../registration-production-2026-10-22/README.md).
George explicitly authorised completing the remaining database reconciliation.

The [runbook](../../../../ARCHIVE_DATABASE_RECONCILIATION.md) describes retained
before-images, history, recovery, file classification and retirement. Earlier
read-only preview restrictions are superseded by this authority only for database
reconciliation and its required application deployment. KEEP decisions, legacy
owners, manual deletion and archive-verification gates remain unchanged.

The final sealed plan was applied in full:

- **13,052 new File + AdditionalFile pairs**, including the regular files in the
  six pending-disposal projects; no new scientific Reads or Samples.
- **434 existing-record corrections:** 402 Files (three physical filename fixes
  and retained current observations), eight Projects, 12 Samples and 12 Runs.
  Six roots and 21 child directory paths are corrected; two empty Projects,
  their two Samples and one Run are retired with history.
- **6,763 dated current observations** attached to matching Files; all historical
  upload checksums and gaps remain. Eight observations under the held numeric
  directory remain in the source evidence rather than acquiring a guessed File.
- **186 per-entry database ledger rows**; the 11 KEEP entries are unchanged.
- **26,724 total atomic operations**, individually verified on the server and
  independently against the returned BSON documents on the Mac.

The [197-entry outcome table](OUTCOMES.md) records every original candidate and the
five supplementary Saunders entries. There are 181 reconciled entries (175 archive
candidates and six pending manual disposal), two retired empty Projects, two empty
unregistered directories recorded, one association hold, and 11 unchanged KEEP entries.

Plan SHA-256: `6ba8c00fddf137fe36f2288fd7c1d151ee589edc852903fc66e2e9e0a8b3e303`.
API release: `27b98035dccf1b33e2f449be972e2003b4114b24`.
Web release: `e9e183cc6968da46a4b0eada76471b750745a771`.
Neither branch has been merged or pushed.

Validation: **2,126 unit/contract tests** with coverage thresholds met,
**87 integration tests** against an isolated database, **563 web tests**,
and **eight service-controller fault scenarios**. The five migration integration
cases also passed separately after the final migration refinements. A prior unit
run had the existing HTTP `socket hang up` flake; the final full run with handle
detection passed. Integration processes exited after their delayed handle cleanup;
the targeted migration suite passed with handle detection.

All **30,105 original documents** from 16 collections were restored independently.
The exact **26,724 proposed operations** were replayed against that restored copy:
13,052 populated AdditionalFile/File pairs, two retired Projects hidden from normal
queries, no changed original indexes, and unchanged Reads, Users, Groups, IngestJobs
and Nudge records. This database replay does not substitute for live filesystem
checks: prepare and apply separately compare complete physical metadata.

The production web build completed with existing package versions. Its first build
attempt could not write a shared PWA cache; a separate writable build cache resolved
that without changing production dependencies. Old build files are retained.

## Production execution and acceptance

George started the controller as `tsldata` and confirmed external writers were
frozen. Services paused at **21:05:19 UTC** and were restored at **21:08:58 UTC**
on 22 October: approximately **3 minutes 39 seconds**. The applied release heads
above are on their own production branches, with clean tracked checkouts.

The server verified every result, every unaffected original document, all original
indexes and all observed filesystem metadata. The Mac then decoded and compared
all **26,724 returned BSON documents**, retaining an independent 50,860,170-byte
after-image export before service recovery. After restart, the full database
comparison passed again. There are **361 retained Projects (359 active), 22,204
Files, 13,820 AdditionalFiles and 8,387 unchanged Reads**.

The 112 live HTTP/API checks verified all 27 corrected parent paths, all five retired
documents hidden from ordinary requests but available with history to an admin,
144 processed-read file locations and eight newly catalogued AdditionalFile
locations. Unauthenticated/non-admin audit requests returned 401/403. Tokens stayed
in memory and expired after five minutes; no login record was written. Both public
websites returned HTTP 200, and all four homepage JavaScript bundles matched the
reviewed web build byte for byte. This is HTTP/API acceptance, not a claim that a
human manually explored every screen or that scientific file classification is complete.

During web checkout, four test files could not be replaced because their parent
directories belonged to `tsldata`. The old test tree was retained at
`/storage/www/komondor-web/.reconciliation-tests-before-20261022/`, and the complete
reviewed test tree was checked out afresh. The retained backup has an exact local
Git exclude entry. No ownership was changed; the final tracked checkout was clean
before restart. The previous `.nuxt` build is retained privately at
`/storage/komondor-reconciliation-20261022/web-build-before/`.

See [CLI completion counts](completed.json), [server execution verification](applied-verified.json),
[independent after-image verification](independent-after-verification.json),
[service recovery](restored.json), [live API checks](live-acceptance.json) and
[public site/build checks](public-site-checks.json).

Preparation evidence remains: [prepared counts and holds](prepare.json), [execution preconditions](execution-ready.json),
[scratch replay](shadow-replay.json), [backup restore](baseline-restored.json),
[service controller](window.cjs), [its fault tests](test-window.cjs) and
[deployment/verification procedure](deploy.cjs).

`ntalbot-031` / `project_2178` remains an explicit association hold; its 31 files and
two existing Run links are recorded without creating a duplicate Project. A legacy
symbolic link under `skamoun-015` is retained and recorded without being followed.
No project owners are contacted and no files are moved, deleted or uploaded.

Database reconciliation is complete for this sealed plan. The remaining work is
to resolve that one multi-root association and perform normal archive planning and
verification for eligible entries. A fresh live archive plan is still required
before each lock. Manual disposal remains separate. Historical checksum gaps and
provisional file classifications remain visible; no further bulk sweep was run.

Private source evidence and database backups:
`/Users/deeks/.codex/artifacts/archive-reconciliation-production-20261022/`.
Full production documents are retained there rather than committed into Git.
Server source evidence is in `/storage/komondor-reconciliation-20261022/`, with the
sealed plan/execution journal in `/storage/komondor-reconciliation-final-20261022/`
and full before-images in `/storage/komondor-reconciliation-baseline-20261022/`.
