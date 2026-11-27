# Independent review: six Kamoun direct disposals

Review passed with no blocking findings. **No production retirement or filesystem deletion has happened at this checkpoint, and the deletion draft is not released.** The machine-readable [review receipt](independent-review.json) records all reviewed hashes and limitations.

The exact six Projects contain 1,217 regular files (790,004,575,062 bytes) plus one approved symlink. Thirteen other Projects are protected. The historical mixed-case paths were reconciled against the October plan and applied BSON. Xiao’s 53 newly registered File pairs supplement nine existing files: its physical total is 62.

The inventory and deletion draft enforce exact scope, historical path/type/size matching, descriptor-relative traversal without following links, fresh metadata, protected-root checks and all-project preflight before removal. A successful, hash-bound metadata-retirement receipt and a review no older than six hours are required before manual Slurm submission. Draft seal placeholders remain in place.

The retirement review covered all 2,459 typed before/after records, full graph closure, protected snapshots, exact compare-and-set updates, retained history, normal-query invisibility and explicit inspected resume. Storage/archive fields remain unchanged. The maintenance-window handshake refuses concurrent mutation/reopening and refuses restart from partial or divergent state. The final durability addition was inspected: critical directory entries are fsynced, and private receipt permissions are set before file fsync.

Validation: 22 isolated disposal guards passed and were independently rerun by a second reviewer. This reviewer ran 34 retirement/controller tests before the final durability-only change; the author reports 18 focused retirement tests passing on the final helper. The parent’s final isolated Mongo rehearsal receipt confirms all 2,459 conditional writes, typed BSON preservation, guarded-model invisibility, protected records and zero-write inspected adoption; no production writes were involved. Native production quiescence and inventory are not exercised by that rehearsal.

The current retirement plan differs from the rehearsed plan only in the API head and an added evidence hash. The parent’s receipt records a documentation-only production revision. Those Git objects are unavailable locally, so this reviewer verified the plan-field difference and reviewed that receipt without independently reproducing its Git diff.

Release still requires the live probe, successful production retirement, inspection of its immutable receipts, and a newly sealed deletion package. George must submit the job himself. This reviewer made no production connection, service change, AWS operation or filesystem deletion.
