#!/usr/bin/env python3
"""Run one supplemental real-artifact probe in an owned, bounded devcontainer."""
import argparse
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]


def immutable_image(value):
    if re.fullmatch(r"sha256:[a-f0-9]{64}", value) is None:
        raise argparse.ArgumentTypeError("an explicit already-built immutable image ID is required")
    return value


def docker(*args, timeout=30):
    return subprocess.run(["docker", *args], check=True, capture_output=True,
                          text=True, timeout=timeout).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=immutable_image, required=True,
                        help="exact corrected devcontainer image ID; diagnostics are not image qualification")
    parser.add_argument("--artifact-directory", type=Path, required=True)
    parser.add_argument("--oracle", type=Path, required=True)
    parser.add_argument("--evidence-directory", type=Path, required=True)
    parser.add_argument("--trigger", choices=["click", "keyboard"], default="click")
    parser.add_argument("--case", required=True, choices=["positive", "delayed-completion", "stuck-busy", "missing-control",
                        "body-unavailable", "method-rewrite", "wrong-method", "wrong-payload", "duplicate",
                        "navigation", "trigger-failure", "wrong-response", "fill-failure",
                        "private-method", "pretend-body-failure", "body-plus-cleanup", "cleanup-failure", "setup-failure",
                        "delayed-duplicate", "delayed-wrong-response", "delayed-stuck-busy"])
    args = parser.parse_args()
    image = args.image
    profile = json.loads(docker("image", "inspect", image))[0]
    assert profile["Id"] == image and profile["Os"] == "linux"
    assert profile["Architecture"] in ("amd64", "arm64")
    native_directory = {"amd64": "linux64", "arm64": "linux-arm64"}[profile["Architecture"]]
    browser = ("/ms-playwright/chromium_headless_shell-cft-157.0.8099.0/"
               f"chrome-headless-shell-{native_directory}/chrome-headless-shell")
    artifact = args.artifact_directory.resolve(strict=True)
    oracle = args.oracle.resolve(strict=True)
    evidence = args.evidence_directory.absolute()
    evidence.mkdir()  # No reuse or overwrite of prior evidence.
    token = uuid.uuid4().hex
    name = "prismpm-oracle-probe-" + token
    label = "org.prismpm.oracle-probe=" + token
    cid = None
    execution_error = None
    def interrupted(signum, _frame):
        raise InterruptedError(f"probe interrupted by signal {signum}")
    previous_term = signal.signal(signal.SIGTERM, interrupted)
    try:
        cid = docker("create", "--name", name, "--label", label, "--init", "--pull=never",
                     "--user", f"{os.getuid()}:{os.getgid()}",
                     "--log-driver", "none", "--cap-drop", "ALL",
                     "--security-opt", "no-new-privileges",
                     "--network", "none", "--read-only", "--memory", "2g", "--memory-swap", "2g",
                     "--cpus", "2", "--pids-limit", "256",
                     "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=512m",
                     "--mount", f"type=bind,src={ROOT},dst=/source,readonly",
                     "--mount", f"type=bind,src={artifact},dst=/artifact,readonly",
                     "--mount", f"type=bind,src={oracle},dst=/oracle,readonly",
                     "--mount", f"type=bind,src={evidence},dst=/evidence",
                     "--entrypoint", "node", image,
                     "/source/scripts/portable-oracle-submission-probe.mjs", "/oracle",
                     "/artifact", browser,
                     args.case, "/evidence/probe", args.trigger).strip()
        inspected = json.loads(docker("inspect", cid))[0]
        assert inspected["Image"] == image
        assert inspected["Config"]["Labels"].get("org.prismpm.oracle-probe") == token
        with (evidence / "container.stdout").open("xb") as stdout, (evidence / "container.stderr").open("xb") as stderr:
            subprocess.run(["docker", "start", "--attach", cid], stdout=stdout, stderr=stderr,
                           timeout=150, check=True)
        state = json.loads(docker("inspect", cid))[0]["State"]
        assert not state["Running"] and not state["OOMKilled"] and state["ExitCode"] == 0, state
    except BaseException as error:
        execution_error = repr(error)
        raise
    finally:
        # Resolve by unique ownership label even if create's response was lost.
        cleanup_errors = []
        cleaned = False
        try:
            owned = docker("ps", "-aq", "--no-trunc", "--filter", "label=" + label).split()
            if cid is not None and owned != [cid]:
                cleanup_errors.append("owned container inventory changed")
            for target in owned:
                try:
                    inspected = json.loads(docker("inspect", target))[0]
                    assert inspected["Config"]["Labels"].get("org.prismpm.oracle-probe") == token
                    assert inspected["Name"] == "/" + name
                    docker("rm", "--force", "--volumes", target)
                except BaseException as error:
                    cleanup_errors.append(repr(error))
            remaining = docker("ps", "-aq", "--filter", "label=" + label).strip()
            if remaining:
                cleanup_errors.append("owned containers remain: " + remaining)
            # An unacknowledged create may still be in flight in the daemon.
            # An empty snapshot cannot establish cleanup in that case.
            if cid is None:
                cleanup_errors.append("create unacknowledged; cleanup state unknown")
            cleaned = not cleanup_errors
        except BaseException as error:
            cleanup_errors.append(repr(error))
        (evidence / "container.json").write_text(json.dumps({
            "schema": "prismpm/oracle-probe-container/1", "image": image,
            "container": cid, "name": name, "label": label, "cleanup_verified": cleaned,
            "cleanup_errors": cleanup_errors, "execution_error": execution_error,
            "product_acceptance": "not-established"}) + "\n")
        signal.signal(signal.SIGTERM, previous_term)
        if not cleaned and execution_error is None:
            raise RuntimeError("probe cleanup failed: " + repr(cleanup_errors))


if __name__ == "__main__":
    main()
