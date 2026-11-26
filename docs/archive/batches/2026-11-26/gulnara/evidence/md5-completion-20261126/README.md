# Gulnara MD5 completion — 26 November 2026

The follow-up is complete. All 24 FASTQs matched the preserved historical MD5
entries and their sealed SHA-256 values. The seven auxiliary `MD5.txt` files
catalogued as Reads were independently compared with their retained source
copies: both size/SHA-256 and source-to-copy MD5 matched, with distinct inodes.
Their expected MD5 values are explicitly source-derived, not provider-supplied
checksums for the sidecar itself.

All 31 Read checksum records and 12 terminal Run results were conditionally
updated and independently reread. Every Run passes the deployed application's
verification summary. No other document fields, payloads, paths, reconciliation
history, storage state, services or archive files changed. No background jobs,
owner notifications or ENA submission were triggered.

`COMPLETED.json` is the outcome. Native hash receipts, the write journal,
application read-back and validation receipts are retained here. `input.json`
seals the private snapshot/plan inputs; it is not a claim that raw database
before-images are published here. The full 63-file server snapshot, typed BSON
before/after images and execution plan remain in the restricted locations
listed in `COMPLETED.json`. All received hashes were verified.

Do not rerun this completed import or the earlier reassignment operation.
Gulnara's technical reassignment and MD5 work are done for now. George sent the
review email; her reply/sign-off is pending. Keep the four source HPC trees,
new destination copies, staging links and review CSV until the separately
recorded cleanup decisions. No source exclusion has been released.
