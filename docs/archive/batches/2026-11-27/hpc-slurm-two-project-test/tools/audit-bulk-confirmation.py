#!/usr/bin/env python3
"""Independently audit copied native confirmation evidence; never contact production."""

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import tarfile
from datetime import datetime, timezone


BASE = Path(__file__).resolve().parents[1]
PLAN_SHA256 = "bb298f391cf1df504b1e5983fdba1a948c5d248f4ea343758a5ceef4e5ecfee7"
IDS_SHA256 = "29fc93c14c6bb969cc9a2b5f8e3b953f8acbac5257af781fa712cf5ebf303cac"
HELD = {
    "5fc012bda3efcb29338b7d58": "two_blades/gargy_2019_rnaseq",
    "61204424e788b405b6ce6bde": "ntalbot/lichen_coculture_i_2_days",
    "611ff26de788b405b6ce6a4c": "ntalbot/lichen_coculture_i_9_days",
    "5fd1ed55d8dd4a63058cc1c9": "ntalbot/lichen_coculture_i_21_days",
    "5fdb2d62d7661b6ec22a0571": "ntalbot/lichen_coculture_i_42_days",
}
PRIOR = {
    "5fc012bda3efcb29338b7d4b": "jjones/plant_capture_enhancer",
    "5fc012bda3efcb29338b7d13": "jjones/miseq_renseq_of_brassica_accessions_",
    "5fc012bda3efcb29338b7d4e": "jjones/resistance_to_albugo_laibachii_in_sf_2",
}
ALLOWED_STORAGE = {"state", "hpcVerifiedAbsentAt", "archivedAt"}
ALLOWED_MIGRATION = {"phase", "confirmedAbsentBy", "updatedAt"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None, "Timestamp has no timezone")
    return parsed


def without_confirmation_fields(project):
    result = copy.deepcopy(project)
    result.pop("updatedAt", None)
    for key in ALLOWED_STORAGE:
        result["storage"].pop(key, None)
    for key in ALLOWED_MIGRATION:
        result["archiveMigration"].pop(key, None)
    return result


def identity(project, reviewed, completed):
    pid = reviewed["projectId"]
    storage = project["storage"]
    migration = project["archiveMigration"]
    require(project["_id"] == pid, f"Project identity mismatch: {pid}")
    require(project["path"] == "/" + reviewed["relativeRoot"], f"Project path mismatch: {pid}")
    require(storage["state"] == ("aws" if completed else "aws_pending_hpc_deletion"), f"State mismatch: {pid}")
    require(migration["phase"] == ("completed" if completed else "verified"), f"Phase mismatch: {pid}")
    require(migration["id"] == reviewed["migrationId"], f"Migration identity mismatch: {pid}")
    require(migration["sourceRoot"] == "/mnt/reads/" + reviewed["relativeRoot"], f"Source root mismatch: {pid}")
    require(migration["sourceRelativeRoot"] == reviewed["relativeRoot"], f"Relative root mismatch: {pid}")
    require(storage["s3Uri"] == reviewed["s3Uri"], f"S3 URI mismatch: {pid}")
    require(storage["s3VerifiedAt"] == reviewed["s3VerifiedAt"], f"S3 verification date mismatch: {pid}")
    require(migration["manifests"]["fileCount"] == reviewed["fileCount"], f"File count mismatch: {pid}")
    require(migration["manifests"]["totalBytes"] == reviewed["bytes"], f"Byte count mismatch: {pid}")
    for key in ("sourceSha256", "verificationSha256"):
        require(migration["manifests"][key] == reviewed[key], f"Control digest mismatch: {pid}/{key}")


def locations(record, reviewed):
    require(record["hpc"]["status"] == "absent", "HPC location is not absent")
    require(record["hpc"]["uri"] == reviewed["hpcPath"], "HPC location URI differs")
    require(record["aws"]["status"] == "verified", "AWS location is not verified")
    require(record["aws"]["uri"] == reviewed["s3Uri"], "AWS location URI differs")
    require(record["aws"]["verifiedAt"] == reviewed["s3VerifiedAt"], "AWS location verification time differs")


def observations(record, count):
    require(record["absentTargets"] == count, "Observed absence count differs")
    require(record["fiveHeldRootsPresent"] is True, "Held roots were not all present")
    require(record["threePreviouslyCompletedRootsAbsent"] is True, "Previously completed roots not absent")
    mount = record["mount"]
    require(mount["target"] == "/mnt/reads", "Wrong observed mount target")
    require(mount["source"] == "nfs.tsl-hpc-data:/ifs/apricot/TSL/PrimaryData/DATABASES/reads", "Wrong observed NFS source")
    require(mount["fstype"].startswith("nfs"), "Wrong observed filesystem type")


def audit(archive_path):
    plan_bytes = (BASE / "remaining-167-released/deletion-plan.json").read_bytes()
    require(sha(plan_bytes) == PLAN_SHA256, "Local sealed deletion plan differs")
    plan = json.loads(plan_bytes)
    targets = {p["projectId"]: p for p in plan["projects"]}
    require(len(targets) == len(plan["projects"]) == 167, "Plan does not contain 167 unique projects")
    require(sha(("\n".join(sorted(targets)) + "\n").encode()) == IDS_SHA256, "Pinned project set differs")
    require(not (set(targets) & (set(HELD) | set(PRIOR))), "Protected project entered target set")
    require({p["projectId"]: p["relativeRoot"] for p in plan["held"]} == HELD, "Held project set differs")
    archive_digest = hashlib.file_digest(archive_path.open("rb"), "sha256").hexdigest()
    with tarfile.open(archive_path, "r:gz") as archive:
        members = {}
        for member in archive.getmembers():
            require(member.name not in members, f"Duplicate archive member: {member.name}")
            members[member.name] = member
        completion_names = [name for name in members if name.endswith("/completed.json")]
        require(len(completion_names) == 1, "Expected exactly one completion receipt")
        prefix = completion_names[0].removesuffix("completed.json")
        evidence_members = {name[len(prefix):] for name in members if name.startswith(prefix) and members[name].isfile()}
        require(not any("failure" in name for name in evidence_members), "Failure receipt present")

        def raw(name):
            member = members.get(prefix + name)
            require(member is not None and member.isfile(), f"Missing/nonregular evidence: {name}")
            return archive.extractfile(member).read()

        def load(name):
            return json.loads(raw(name))

        require(raw("deletion-plan.json") == plan_bytes, "Server deletion plan differs")
        completed = load("completed.json")
        require(completed["success"] is True, "Completion receipt is not successful")
        require(all(completed[key] == 167 for key in ("projects", "confirmed", "verified")), "Completion count differs")
        require(completed["failures"] == [], "Recorded failures are not empty")
        require(completed["operator"] == "deeks", "Unexpected native operator")
        require(completed["apiHead"] == plan["apiHead"] and completed["planSha256"] == PLAN_SHA256, "Completion identity differs")
        require(Path(completed["serverEvidence"]).name == Path(prefix.rstrip("/")).name, "Server evidence directory differs")
        require(completed["heldProjectsRemaining"] == 5 and completed["previouslyCompletedProjectsUnchanged"] == 3
                and completed["protectedProjectsUnchanged"] == 8, "Protected project counts differ")
        observations(completed["observations"], 167)
        initial = load("initial-observations.json")
        require(initial["apiHead"] == plan["apiHead"] and initial["operator"] == "deeks", "Initial execution identity differs")
        observations(initial["observations"], 167)
        started = timestamp(initial["at"])
        finished = timestamp(completed["at"])
        require(finished >= started, "Completion precedes start")
        for name in ("all-before-snapshots-passed.json", "all-dry-runs-passed.json"):
            marker = load(name)
            require(marker["projects"] == 167, f"Phase count differs: {name}")
            observations(marker["observations"], 167)
            require(started <= timestamp(marker["at"]) <= finished, "Phase time outside execution")
        dry_passed_at = timestamp(load("all-dry-runs-passed.json")["at"])
        aggregate_commands = load("commands.json")
        require(len(aggregate_commands) == 334, "Aggregate native command count differs")
        command_index = {}
        for command in aggregate_commands:
            key = (command["projectId"], "--execute" in command["args"])
            require(key not in command_index, "Duplicate aggregate native command")
            command_index[key] = command
        final = completed["final"]
        require(len(final) == 167 and {p["projectId"] for p in final} == set(targets), "Final project set differs")
        final_index = {p["projectId"]: p for p in final}
        separate_final = load("final-audit.json")
        require(separate_final["projects"] == final, "Final audit disagrees with completion receipt")
        observations(separate_final["observations"], 167)
        associated_counts = {}
        confirmation_times = []
        for pid, reviewed in targets.items():
            before = load(pid + "-before.json")
            after = load(pid + "-after.json")
            receipt = load(pid + "-completed.json")
            require(before["reviewed"] == reviewed, f"Reviewed project differs: {pid}")
            identity(before["project"], reviewed, False)
            identity(after["project"], reviewed, True)
            require(before["database"] == after["database"], f"Associated records changed: {pid}")
            require(without_confirmation_fields(before["project"]) == without_confirmation_fields(after["project"]),
                    f"Unexpected Project fields changed: {pid}")
            migration = after["project"]["archiveMigration"]
            storage = after["project"]["storage"]
            require(migration["confirmedAbsentBy"] == "deeks", f"Confirmation operator differs: {pid}")
            require(storage["hpcVerifiedAbsentAt"] == storage["archivedAt"] == migration["updatedAt"], f"Native dates differ: {pid}")
            confirmed_at = timestamp(storage["hpcVerifiedAbsentAt"])
            require(dry_passed_at <= confirmed_at <= finished, f"Confirmation outside permitted phase: {pid}")
            confirmation_times.append(confirmed_at)
            counts = {key: len(value) for key, value in after["database"].items()}
            for key, value in counts.items():
                associated_counts[key] = associated_counts.get(key, 0) + value
            require(receipt["projectId"] == pid and receipt["migrationId"] == reviewed["migrationId"], "Per-project completion identity differs")
            require(receipt["storage"] == storage and receipt["phase"] == "completed", "Per-project completion state differs")
            require(receipt["counts"] == counts, "Per-project completion counts differ")
            require(all(receipt[key] is True for key in ("associatedRecordsUnchanged", "s3VerifiedAtUnchanged", "onlyNativeConfirmationFieldsChanged")),
                    "Per-project completion assertion missing")
            locations(receipt["locations"], reviewed)
            item = final_index[pid]
            require(item["state"] == "aws" and item["phase"] == "completed", "Final project not completed")
            require(item["s3VerifiedAt"] == reviewed["s3VerifiedAt"], "Final S3 date changed")
            require(item["counts"] == counts and item["associatedRecordsUnchanged"] is True, "Final associated records disagree")
            locations(item["locations"], reviewed)
            for execute in (False, True):
                name = pid + ("-confirmation.json" if execute else "-dry-run.json")
                command = load(name)
                require(command == command_index[(pid, execute)], "Individual/aggregate command receipts disagree")
                expected = ["confirm-absent", "--project-id", pid, "--confirmed-by", "deeks"] + (["--execute"] if execute else [])
                require(command["args"] == expected and command["projectId"] == pid, "Native command scope differs")
                require(command["exitCode"] == 0 and command["stderr"] == "", "Native command failed")
                result = json.loads(command["stdout"])
                require(result["command"] == "confirm-absent" and result["migrationId"] == reviewed["migrationId"], "Native result identity differs")
                if execute:
                    require(result["state"] == "aws" and result["phase"] == "completed", "Native execute result differs")
                    require(dry_passed_at <= timestamp(command["at"]) <= finished, "Native execute receipt precedes all dry runs")
                else:
                    require(result["would"] == "finalize project as aws", "Native dry-run result differs")
                    require(started <= timestamp(command["at"]) <= dry_passed_at, "Dry-run receipt outside dry-run phase")
            for filename, kind, digest in (("source-manifest.v1.json", "source", reviewed["sourceSha256"]),
                                          ("verification-report.v1.json", "verification", reviewed["verificationSha256"])):
                control = raw(pid + "-" + filename)
                require(sha(control) == digest, "Control content digest differs")
                record = json.loads(control)
                require(record["kind"] == kind and record["projectId"] == pid and record["migrationId"] == reviewed["migrationId"],
                        "Control identity differs")
                if kind == "source":
                    require(record["sourceRoot"] == "/mnt/reads/" + reviewed["relativeRoot"]
                            and record["sourceRelativeRoot"] == reviewed["relativeRoot"]
                            and record["dataPrefix"] == reviewed["s3Uri"], "Source control paths differ")
                    require(not [e for e in record["entries"] if e["type"] != "dir" and e["disposition"] != "copy"], "Unarchived nondirectory entry")
                else:
                    require(record["verified"] is True, "Control verification did not pass")
        require(set(command_index) == {(pid, execute) for pid in targets for execute in (False, True)}, "Native command set differs")
        protected_before = load("protected-before.json")["projects"]
        protected_after = load("protected-after.json")["projects"]
        require(protected_before == protected_after, "Held/prior Project or associated records changed")
        require(len(protected_after) == 8 and {p["project"]["_id"] for p in protected_after} == set(HELD) | set(PRIOR), "Protected project set differs")
        for entry in protected_after:
            project = entry["project"]
            pid = project["_id"]
            held = pid in HELD
            require(project["path"] == "/" + (HELD if held else PRIOR)[pid], "Protected path differs")
            require(project["storage"]["state"] == ("aws_pending_hpc_deletion" if held else "aws"), "Protected state differs")
            require(project["archiveMigration"]["phase"] == ("verified" if held else "completed"), "Protected phase differs")
            if pid == "5fc012bda3efcb29338b7d58":
                require(timestamp(project["preserveOnHpcUntil"]) > finished, "Gargy keep date not active")
        for suffix, expected in (("-before.json", 167), ("-after.json", 167), ("-dry-run.json", 167),
                                 ("-confirmation.json", 167), ("-completed.json", 167),
                                 ("-source-manifest.v1.json", 167), ("-verification-report.v1.json", 167)):
            actual = [n for n in evidence_members if n.endswith(suffix) and n[:24] in targets]
            require(len(actual) == expected, f"Evidence count differs: {suffix}")
        return {
            "auditedAt": datetime.now(timezone.utc).isoformat(), "success": True,
            "archivePath": str(archive_path.resolve()), "archiveSha256": archive_digest,
            "evidencePrefix": prefix, "serverEvidence": completed["serverEvidence"],
            "planSha256": PLAN_SHA256, "projectIdsSha256": IDS_SHA256, "apiHead": plan["apiHead"],
            "projects": 167, "nativeDryRuns": 167, "nativeExecutions": 167, "sealedControlsChecked": 334,
            "associatedRecordsUnchanged": True, "associatedRecordCounts": associated_counts,
            "onlyNativeConfirmationFieldsChanged": True, "s3DatesPathsAndControlDigestsUnchanged": True,
            "protectedProjectsUnchanged": 8, "heldProjects": 5, "previouslyCompletedProjects": 3,
            "totalCompletedOriginalBatch": 170, "originalBatchSize": 175,
            "fileCount": sum(p["fileCount"] for p in targets.values()),
            "logicalBytesInDeletedTrees": sum(p["bytes"] for p in targets.values()),
            "firstConfirmedAt": min(confirmation_times).isoformat(), "lastConfirmedAt": max(confirmation_times).isoformat(),
            "nativeCompletedAt": completed["at"],
            "rawSlurmLogsAuditedByThisScript": False,
            "scope": "Independent audit of copied native confirmation evidence; no live access or production changes",
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=BASE / "evidence/bulk-native-confirmation-server-20261127.tar.gz")
    parser.add_argument("--output", type=Path, default=BASE / "evidence/bulk-native-confirmation-audit.json")
    args = parser.parse_args()
    result = audit(args.archive)
    # A successful audit is saved once; preserve any pre-existing receipt.
    with args.output.open("x", encoding="utf8") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
