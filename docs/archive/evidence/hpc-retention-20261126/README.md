# Production keep-date read-back supplied by George — 26 November 2026

George supplied the [complete mongosh verification output](user-supplied-verify-output.txt)
after running the prepared batch. It reports **`ok: true`, `verified: 12`,
`expected: 12`**. This is user-supplied production evidence, not a new independent
SSH/database observation by the agent recording it.

- **Gargy-2019_RNAseq**, `5fc012bda3efcb29338b7d58`: Sara,
  `2027-11-26T23:59:59.999Z`.
- **Eleven Kamoun KEEP Projects**: Joe Win, `2031-11-26T23:59:59.999Z`.
- Each row has the exact planned ID, canonical path, date, requester and reason,
  BSON type `date`, one history entry and `ok: true`. The pinned verifier checks
  that the latest audit entry matches the date/requester/reason and has an actor
  and valid timestamp. The raw audit events are not printed in this output.
- Gulnara's destination and four sources are present with null manual keep-date
  overrides. They are excluded from this batch's write scope. The four source
  trees remain manual exclusions until the reassignment and release review.

[verification-summary.json](verification-summary.json) is a parsed, checked
derivative. All twelve rows were matched against the fixed operator script at
`ca3ded4f564ad25e9408ef7bb2d9d266e0ea33cd`, including the requester/reason strings.
The original text is preserved byte-for-byte; SHA-256:

```text
93a5aa30596eb83e4c24176aa00fa7e0c85ef5211afa054441133c6cf7d6ced9
```

The first launcher attempt failed before script loading because the shell
reported a full URI combined with a host/port option. The successful pasted
verification command uses `/usr/bin/env mongosh` to bypass shell aliases/functions.
The exact alias or wrapper configuration was not inspected.

The output supplies no execution timestamp, apply receipt or server backup path.
The apply script's before/after backups and receipt are expected in the
operator's `~/.komondor-keep-20261126-*` directory; they have not been collected
here. `writtenByThisCommand: false` is a property of read-only verify mode, not
an independent before/after comparison of the Gulnara records.

Browser display/editing checks, current production code heads, source/S3 checks
and Gulnara's exact computed eligibility date remain outside this evidence.
No extra production operation, email, deletion or service change was performed
while recording it. Do not rerun apply merely to repeat this successful read-back.
