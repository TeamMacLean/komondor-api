# Six Kamoun Projects: reviewed direct disposal

Exactly six retired Projects, 1,217 regular files (790,004,575,062 bytes) and one
approved symlink. These are the original Kamoun spreadsheet's **delete** rows:
**there is no S3 copy or restore path for this disposal**. This job removes only
the six paths in HPC_PATHS.txt. Metadata and its retirement history are retained.
Joe's eleven retained Projects, Gargy and the Xanthoria destination are protected;
all other roots, the Xanthoria staging area and all S3 data are outside the scope.

Source inventory: 2026-11-27T14:58:38.850548+00:00.
Metadata retirement: 2026-11-27T15:06:00.331Z.
This package refuses removal after **2026-11-27T20:58:38.850548+00:00** (six hours from the
source inventory). Keep these sources and protection decisions unchanged while
queued/running. An expired or failed job needs inspection and a fresh package;
never edit the expiry or rerun blindly. All six preflights run before any removal.

## HPC software node: copy and verify

```bash
umask 077
mkdir -p "$HOME/komondor-kamoun-six-20261127"
cd "$HOME/komondor-kamoun-six-20261127"
scp deeks@v1333.nbi.ac.uk:/storage/komondor-kamoun-six-delete-20261127-01.tar.gz deeks@v1333.nbi.ac.uk:/storage/komondor-kamoun-six-delete-20261127-01.tar.gz.sha256 .
sha256sum -c komondor-kamoun-six-delete-20261127-01.tar.gz.sha256
tar -xzf komondor-kamoun-six-delete-20261127-01.tar.gz
cd komondor-kamoun-six-delete-20261127-01
sha256sum -c SHA256SUMS
```

The supplied archive contains only explicit regular files; no Mac resource forks,
symlinks or Python bytecode. If packaging manually, use COPYFILE_DISABLE=1 and
the explicit file list. Do not replace the supplied archive or its seals.

## HPC submission node: validate and submit

```bash
cd "$HOME/komondor-kamoun-six-20261127/komondor-kamoun-six-delete-20261127-01" &&
sha256sum -c SHA256SUMS &&
sbatch --test-only delete.sbatch &&
sbatch delete.sbatch
```

Resources: one node, one task, one CPU, 1 GB, two-hour limit. No partition is
overridden; use the site's existing submission defaults. Save the returned job ID.
The package and private per-job JSONL log must stay outside the reads tree.

After completion, retain `komondor-kamoun-6-JOBID.log` and
`deletion-JOBID.jsonl`, and obtain the Slurm resource/exit report. Have the raw
logs audited and all six paths independently checked absent before declaring
completion. This is direct disposal, so **do not use archive confirm-absent** or
change storage/archive state. The job itself makes no database or AWS calls.
