#!/usr/bin/env python3
"""Run the operator script against a fresh loopback-only MongoDB, never production."""
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import uuid

here = Path(__file__).resolve().parent
for tool in ("mongod", "mongosh"):
    if not shutil.which(tool):
        raise SystemExit(f"{tool} must be installed locally")
with tempfile.TemporaryDirectory(prefix="komondor-retention-test-") as folder:
    root = Path(folder)
    (root / "db").mkdir()
    (root / "home").mkdir()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    daemon = subprocess.Popen([
        "mongod", "--dbpath", str(root / "db"), "--bind_ip", "127.0.0.1", "--port", str(port),
        "--logpath", str(root / "mongod.log"), "--quiet",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if daemon.poll() is not None:
                raise RuntimeError((root / "mongod.log").read_text())
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("Temporary MongoDB did not start")
        name = "komondor-retention-test-" + uuid.uuid4().hex[:8]
        # os.homedir() is redirected only inside this disposable test subprocess.
        bootstrap = (
            "require('os').homedir = () => " + repr(str(root / "home")) + "; "
            "load(" + repr(str(here / "keep-dates.test.mongosh.js")) + ")"
        )
        subprocess.run(["mongosh", "--quiet", f"mongodb://127.0.0.1:{port}/{name}",
                        "--eval", bootstrap], check=True, timeout=120)
        # Exercise the exact two-statement operator invocation in a new shell.
        followup = "load(" + repr(str(here / "keep-dates.mongosh.js")) + "); komondorKeepDates('verify')"
        checked = subprocess.run(["mongosh", "--quiet", f"mongodb://127.0.0.1:{port}/{name}",
                                  "--eval", followup], check=True, timeout=30, capture_output=True, text=True)
        assert "verified: 12" in checked.stdout or '"verified": 12' in checked.stdout, checked.stdout
        print("Separate operator-style verification invocation passed.")
        receipts = list((root / "home").glob(".komondor-keep-*/before.ejson"))
        assert receipts, "No before-image backups produced"
        assert all((p.stat().st_mode & 0o777) == 0o600 for p in receipts)
        print("Private before-image backups checked; scratch MongoDB cleaned up.")
    finally:
        daemon.terminate()
        try:
            daemon.wait(timeout=15)
        except subprocess.TimeoutExpired:
            daemon.kill()
            daemon.wait()
