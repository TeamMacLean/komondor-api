# Path review checkpoint — awaiting a fresh SSH connection

Items 1 and 3–7 have been committed and pushed. **Item 2 is not yet complete and
the branch is not cleared for execution.** The old FIX_PATHS_THEN_ARCHIVE wording
must not be acted upon. No file moves or File.path edits are authorized by this review.

The primary read-only comparison stopped delivering output at 07:33:52 UTC on
17 October. Its SSH connection was unresponsive when checked at 11:46 UTC. The
last progress record reports 105 completed records and a file in the final Kamoun
project being read; progress messages alone are not accepted checksum evidence.
The primary command has not returned a complete JSON report or success receipt.
A fresh connection is required to inspect its state before deciding whether to rerun.

Completed and retained evidence:

- All 48 dependent documents exported twice; the second export includes legacy
  string-ID reference checks, with unchanged documents and no detected blockers.
- Three Jones .fastq alternatives for .fastq.txt database names fully hashed.
  They have no recorded original MD5; no historical checksum equality is claimed.
- 26 Jones gzip diagnostics: all decoded streams match the recorded original MD5,
  with valid gzip trailers and unchanged physical files. Compressed-byte hashes
  differ and remain explicitly recorded. These results will be bound to the primary
  candidate hashes before deriving final per-project decisions.
- Tests and their limitations are in evidence/2026-10-17/validation-results.json.
  One of the three final full runs had an HTTP parsing failure in uploads.test.js;
  the isolated 39-test upload suite and subsequent full run passed.

Nothing has been merged, written to production or sent to owners. The completed
auxiliary evidence is preserved so another reviewer can inspect it while the
remaining connection-dependent work is resumed. A final verdict and all eight
per-project resolution records will replace this checkpoint once evidence is complete.
