"""Actual filesystem/process/protocol controls; not SDK capture acceptance."""
import copy
from contextlib import ExitStack, redirect_stderr
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location("capture_boundary", Path(__file__).with_name("conditional-capture-sdk.py"))
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


class BoundaryControls(unittest.TestCase):
    def descriptor(self):
        # Parser/control fixture only. Actual ELF and actual file measurements
        # below must not be interpreted as installed SDK qualification.
        contents = boundary.read_regular(Path(EXE))
        return {"source_root": "/workspaces/PrismPM", "source": [{"path": "model", "kind": "directory"}],
                "fixture_inputs": [{"path": "model", "kind": "directory"}],
                "executable_bytes": len(contents), "executable_sha256": boundary.sha(contents),
                "listing_sha256": boundary.listing(Path(EXE)), "test_count": boundary.test_count(Path(EXE)),
                "capture_seconds": 1800,
                "sdk_image": "registry.example.test/prismpm@sha256:" + "1" * 64,
                "inventory_sha256": boundary.sha(b"control-only inventory")}

    def result(self):
        return {"status": 0, "signal": None, "timedOut": False, "overflow": False,
                "aborted": False, "orphaned": False, "close_observed": True,
                "retirement": {"scope": "private-linux-subreaper-exhaustion", "leader_exit_observed": True,
                    "close_observed": True, "descendants_absent": True, "uncertainty": None,
                    "supervisor_status": 0, "supervisor_signal": None, "owner_error": None,
                    "protocol_failure": None, "python_version": "3.12.3"}}

    def test_workspace_aliases_are_closed(self):
        for name in ("/workspaces/PrismPM", "/workspace/PrismPM", "/tmp/prismpm-publication-capture-AbCd12/source"):
            self.assertEqual(boundary.alias_root(name), Path(name))
        for name in ("/", "/tmp", "/home/vscode", "/workspaces/../bin", "/workspace/.",
                     "/workspaces/a/b", "/tmp/arbitrary/source", "/tmp/prismpm-publication-capture-AbCd12/other"):
            with self.assertRaises(RuntimeError):
                boundary.alias_root(name)

    def test_real_tracked_directory_aliases_and_complete_file_bytes(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            subprocess.run(["/usr/bin/git", "init", "--quiet", str(root)], check=True)
            (root / "model").mkdir()
            (root / "model/source").write_bytes(b"current source")
            (root / "crates").mkdir()
            (root / "crates/model").symlink_to("../model")
            subprocess.run(["/usr/bin/git", "-C", str(root), "add", "model", "crates"], check=True)
            before = boundary.source_rows(root)
            self.assertEqual({r["path"] for r in before}, {"model", "model/source", "crates", "crates/model"})
            (root / "model/source").write_bytes(b"substituted source")
            self.assertNotEqual(boundary.source_rows(root), before)
            (root / "model/source").unlink()
            with self.assertRaises(FileNotFoundError):
                boundary.source_rows(root)

    def test_fixture_git_is_retained_but_arbitrary_git_is_not_source(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            (root / "producer-source/.git/objects").mkdir(parents=True)
            (root / "producer-source/.git/objects/actual").write_bytes(b"measured fixture commit")
            records = boundary.tree(root)
            self.assertIn("producer-source/.git/objects/actual", {r["path"] for r in records})
            with self.assertRaises(RuntimeError):
                boundary.validate_rows(records)
            for path in (".git/config", "release/.git/config", "producer-source/x/.git/config"):
                with self.assertRaises(RuntimeError):
                    boundary.path_name(path, capture=True)

    def test_regular_inputs_reject_aliases_hardlinks_and_oversize(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            file = root / "file"
            file.write_bytes(b"exact current bytes")
            self.assertEqual(boundary.read_regular(file), b"exact current bytes")
            (root / "alias").symlink_to("file")
            with self.assertRaises(RuntimeError):
                boundary.read_regular(root / "alias")
            os.link(file, root / "hardlink")
            with self.assertRaises(RuntimeError):
                boundary.read_regular(file)
            (root / "hardlink").unlink()
            with self.assertRaises(RuntimeError):
                boundary.read_regular(file, 1)

    def test_closed_inventory_refuses_escapes_chains_duplicates_and_open_fields(self):
        valid = [{"path": "dir", "kind": "directory"},
                 {"path": "dir/file", "kind": "file", "bytes": 1, "sha256": "1" * 64, "executable": False},
                 {"path": "alias", "kind": "link", "target": "dir"}]
        self.assertEqual(boundary.validate_rows(valid), valid)
        mutations = [valid + [valid[0]], valid + [{"path": "unknown", "kind": "fifo"}],
                     valid + [{"path": "dir/../escape", "kind": "directory"}],
                     valid + [{"path": "alias/child", "kind": "directory"}],
                     valid + [{"path": "second", "kind": "link", "target": "alias"}]]
        for field, value in (("bytes", True), ("bytes", -1), ("bytes", boundary.MAX_FILE + 1),
                             ("sha256", "0"), ("executable", 1), ("extra", "unbound")):
            changed = copy.deepcopy(valid)
            changed[1][field] = value
            mutations.append(changed)
        for rows in mutations:
            with self.assertRaises(RuntimeError):
                boundary.validate_rows(rows)

    def test_capture_transport_is_exact_and_fragmented(self):
        reader, writer = os.pipe()
        payload = boundary.encoded({"first": True}) + b"actual" + boundary.encoded({"last": True})
        def send():
            try:
                for byte in payload:
                    os.write(writer, bytes([byte]))
            finally:
                os.close(writer)
        sender = threading.Thread(target=send)
        sender.start()
        with os.fdopen(reader, "rb", buffering=0) as stream:
            owner = boundary.Reader(stream, time.monotonic() + 5)
            self.assertEqual(owner.line(), {"first": True})
            self.assertEqual(owner.exact(6), b"actual")
            self.assertEqual(owner.line(), {"last": True})
            with self.assertRaises(RuntimeError):
                owner.exact(1)
        sender.join(timeout=5)
        self.assertFalse(sender.is_alive())

    def test_closed_descriptor_and_runtime_bindings_refuse_substitutions(self):
        descriptor = self.descriptor()
        boundary.checked_descriptor(descriptor)
        for key, value in (("extra", True), ("source_root", "/tmp/arbitrary"), ("source", []),
                           ("fixture_inputs", []), ("executable_bytes", True), ("executable_bytes", 0),
                           ("executable_sha256", "not-a-hash"), ("listing_sha256", None),
                           ("test_count", True), ("test_count", 0), ("inventory_sha256", "not-a-hash"),
                           ("capture_seconds", True), ("capture_seconds", 0), ("capture_seconds", 2401),
                           ("sdk_image", "registry.example.test/prismpm:mutable")):
            changed = copy.deepcopy(descriptor)
            changed[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                boundary.checked_descriptor(changed)
        response = {"result": self.result(), "executable_sha256": descriptor["executable_sha256"],
                    "inventory_sha256": descriptor["inventory_sha256"],
                    "source_sha256": boundary.sha(boundary.encoded(descriptor["source"])),
                    "stdout_bytes": 0, "stderr_bytes": 0, "records": []}
        boundary.checked_response(response, descriptor)
        for key, value in (("extra", True), ("executable_sha256", "2" * 64),
                           ("inventory_sha256", "2" * 64), ("source_sha256", "2" * 64),
                           ("stdout_bytes", True), ("stderr_bytes", 32 * boundary.MIB + 1),
                           ("records", {}), ("records", [{"path": "escape/../file", "kind": "directory"}])):
            changed = copy.deepcopy(response)
            changed[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                boundary.checked_response(changed, descriptor)

    def test_closed_actual_result_refuses_false_success_and_incomplete_retirement(self):
        result = self.result()
        boundary.checked_result(result)
        for key in result:
            if key == "retirement":
                continue
            changed = copy.deepcopy(result)
            changed[key] = False if key == "status" else ("SIGTERM" if key == "signal" else not result[key])
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                boundary.checked_result(changed)
        for key, original in result["retirement"].items():
            changed = copy.deepcopy(result)
            changed["retirement"][key] = False if key == "supervisor_status" else (
                False if original is True else "unqualified")
            with self.subTest(retirement=key), self.assertRaises(RuntimeError):
                boundary.checked_result(changed)
        for target in (result, result["retirement"]):
            target["extra"] = True
            with self.assertRaises(RuntimeError):
                boundary.checked_result(result)
            del target["extra"]

    def test_recursive_fixture_membership_detects_extra_sdk_inputs(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            for name in ("examples/Calculator/src", "stdlib/src/Foundation", "stdlib/src/Production"):
                (root / name).mkdir(parents=True)
                (root / name / "model.lex.tex").write_bytes(b"actual fixture input")
            subprocess.run(["/usr/bin/git", "init", "--quiet", str(root)], check=True)
            subprocess.run(["/usr/bin/git", "-C", str(root), "add", "examples", "stdlib"], check=True)
            before = boundary.fixture_rows(root)
            tracked_before = boundary.source_rows(root)
            added = root / "stdlib/src/Production/extra.lex.tex"
            added.write_bytes(b"untracked extra SDK input")
            self.assertEqual(boundary.source_rows(root), tracked_before)
            self.assertNotEqual(boundary.fixture_rows(root), before)
            added.unlink()
            self.assertEqual(boundary.fixture_rows(root), before)
            added.symlink_to("model.lex.tex")
            with self.assertRaises(RuntimeError):
                boundary.fixture_rows(root)

    def test_receipt_join_controls_use_retained_bytes_and_complete_original_inventory(self):
        descriptor = self.descriptor()
        with tempfile.TemporaryDirectory() as owner:
            output = Path(owner)
            bodies = {"installed-sdk-inventory.json": b"control-only inventory", "sdk-lock.json": b"control-only SDK lock",
                      "context.preimage": b"control-only context", "metadata.request": b"control-only request"}
            for i in range(7):
                bodies["linkage-" + str(i) + ".preimage"] = ("control-only linkage " + str(i)).encode()
            for name, body in bodies.items():
                (output / name).write_bytes(body)
            receipt = {"schema": "prismpm/conditional-publication-capture-evidence/1",
                "complete_application_accepted": False, "source_free": True,
                "runtime_scope": "conditional source-built test controller in immutable SDK; not installed-controller acceptance",
                "test_executable_sha256": descriptor["executable_sha256"], "sdk_image": descriptor["sdk_image"],
                "runtime_inventory_sha256": descriptor["inventory_sha256"],
                "source_uri": "urn:prismpm:fixture:publication-context-linkage", "source_revision": "3" * 40,
                "installed_sdk_source_matches": False, "elapsed_seconds": 1, "build_id": "4" * 64,
                "attestation_id": "5" * 64, "fixture_source_archive_sha256": "6" * 64,
                "root_digest": "sha256:" + "7" * 64,
                "expected_subject": {"producer": "urn:prismpm:fixture:publication-context-linkage", "source": "3" * 40,
                    "release": "7" * 64, "model": "8" * 64, "build": "9" * 64, "sdk": "1" * 64, "tree": "a" * 64},
                "graph_refusals": [{"role": role, "defect": defect, "code": "PP6101"}
                    for role in ("build-manifest", "sdk-lock", "standards-lock", "semantic-snapshot", "model", "system",
                                 "runtime-manifest", "kernel-attestation", "provenance", "validation", "oracle-attestation")
                    for defect in ("changed", "missing")],
                "refused_attempts": ["instance", "revision", "empty-ref", "oversized-ref"],
                "publisher_field_substitutions": 3,
                "sdk_lock_sha256": boundary.sha(bodies["sdk-lock.json"]),
                "context_digest": boundary.sha(bodies["context.preimage"]),
                "metadata_sha256": boundary.sha(bodies["metadata.request"]),
                "linkage_sha256": [boundary.sha(bodies["linkage-" + str(i) + ".preimage"]) for i in range(7)]}
            boundary.checked_receipt(receipt, descriptor, output)
            for key, value in (("extra", True), ("complete_application_accepted", True), ("source_free", False),
                ("test_executable_sha256", "b" * 64), ("sdk_image", "mutable:latest"),
                ("runtime_inventory_sha256", "b" * 64), ("source_revision", "wrong"),
                ("installed_sdk_source_matches", 0), ("elapsed_seconds", True), ("build_id", "wrong"),
                ("attestation_id", "wrong"), ("fixture_source_archive_sha256", "wrong"),
                ("root_digest", "sha256:" + "b" * 64), ("expected_subject", {}),
                ("graph_refusals", receipt["graph_refusals"][:-1]),
                ("refused_attempts", receipt["refused_attempts"][:-1]), ("publisher_field_substitutions", True),
                ("sdk_lock_sha256", "b" * 64), ("context_digest", "b" * 64), ("metadata_sha256", "b" * 64),
                ("linkage_sha256", receipt["linkage_sha256"][:-1])):
                changed = copy.deepcopy(receipt)
                changed[key] = value
                with self.subTest(key=key), self.assertRaises(RuntimeError):
                    boundary.checked_receipt(changed, descriptor, output)
            for name, body in bodies.items():
                (output / name).write_bytes(body + b"substitution")
                with self.subTest(name=name), self.assertRaises(RuntimeError):
                    boundary.checked_receipt(receipt, descriptor, output)
                (output / name).write_bytes(body)

    def test_actual_nocapture_printing_keeps_complete_libtest_summary(self):
        # The printer is a real current-ELF case, not a fabricated transcript.
        probe = "oci::publication_context::capture_tests::conditional_sdk_boundary_libtest_printing_probe"
        result = boundary.run_bounded([EXE, "--exact", probe, "--nocapture"])
        self.assertEqual(result.returncode, 0)
        self.assertIn(b"actual nocapture printing control", result.stdout)
        count = boundary.test_count(Path(EXE))
        boundary.checked_summary(result.stdout, count)
        for changed in (result.stdout.replace(b"1 passed", b"0 passed"),
                        result.stdout.replace(b"0 ignored", b"1 ignored"), result.stdout + result.stdout):
            with self.assertRaises(RuntimeError):
                boundary.checked_summary(changed, count)

    def test_real_diagnostic_writer_is_bounded_and_retained_on_failure(self):
        with tempfile.TemporaryFile() as retained:
            class BinaryDiagnostics:
                buffer = retained
            with redirect_stderr(BinaryDiagnostics()):
                with self.assertRaisesRegex(RuntimeError, "original failure"):
                    with boundary.infrastructure_diagnostics() as stream:
                        result = subprocess.run(["/usr/bin/python3", "-I", "-B", "-c",
                            "import os; os.write(2,b'x'*(1024*1024)); os.write(2,b'overflow')"], stderr=stream,
                            stdout=subprocess.PIPE, timeout=5, preexec_fn=boundary.bound_diagnostic_file)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertEqual(os.fstat(stream.fileno()).st_size, boundary.MIB)
                        raise RuntimeError("original failure")
            retained.seek(0)
            self.assertEqual(retained.read(), b"x" * boundary.MIB)

    def test_late_retirement_diagnostics_are_forwarded_after_writer_termination(self):
        with tempfile.TemporaryFile() as retained:
            class BinaryDiagnostics:
                buffer = retained
            with redirect_stderr(BinaryDiagnostics()):
                diagnostics = ExitStack()
                stream = diagnostics.enter_context(boundary.infrastructure_diagnostics())
                child = subprocess.Popen(["/usr/bin/python3", "-I", "-B", "-c",
                    "import os; os.write(2,b'before failure\\n'); os.write(1,b'ready'); "
                    "os.read(0,1); os.write(2,b'after failure during retirement\\n')"],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stream,
                    preexec_fn=boundary.bound_diagnostic_file)
                try:
                    self.assertEqual(child.stdout.read(5), b"ready")
                    with self.assertRaisesRegex(RuntimeError, "early protocol failure"):
                        raise RuntimeError("early protocol failure")
                finally:
                    child.stdin.write(b"r")
                    child.stdin.close()
                    self.assertEqual(child.wait(timeout=5), 0)
                    child.stdout.close()
                    diagnostics.close()
            retained.seek(0)
            self.assertEqual(retained.read(), b"before failure\nafter failure during retirement\n")

    def test_closed_channel_deadline_and_noncanonical_protocol_fail(self):
        for body in (b'{"open":true} ', b'{ "first":true }\n'):
            reader, writer = os.pipe()
            with os.fdopen(reader, "rb", buffering=0) as stream:
                os.write(writer, body)
                os.close(writer)
                with self.assertRaises(RuntimeError):
                    boundary.Reader(stream, time.monotonic() + 5).line()
        reader, writer = os.pipe()
        try:
            with os.fdopen(reader, "rb", buffering=0) as stream:
                with self.assertRaises(RuntimeError):
                    boundary.Reader(stream, time.monotonic() - 1).exact(1)
        finally:
            os.close(writer)

    def test_channel_exhaustion_requires_actual_eof_without_trailing_bytes(self):
        for body in (b"", b"trailing"):
            reader, writer = os.pipe()
            with os.fdopen(reader, "rb", buffering=0) as stream:
                if body:
                    os.write(writer, body)
                os.close(writer)
                owner = boundary.Reader(stream, time.monotonic() + 5)
                if body:
                    with self.assertRaises(RuntimeError):
                        owner.exhausted()
                else:
                    owner.exhausted()
        reader, writer = os.pipe()
        try:
            with os.fdopen(reader, "rb", buffering=0) as stream:
                with self.assertRaises(RuntimeError):
                    boundary.Reader(stream, time.monotonic() + 0.01).exhausted()
        finally:
            os.close(writer)

    def test_real_control_process_limits_output_and_deadline(self):
        result = boundary.run_bounded(["/usr/bin/python3", "-I", "-B", "-c", "print('actual output')"], limit=32)
        self.assertEqual((result.returncode, result.stdout), (0, b"actual output\n"))
        with self.assertRaises(RuntimeError):
            boundary.run_bounded(["/usr/bin/python3", "-I", "-B", "-c", "import os; os.write(1,b'x'*1048576)"], limit=32)
        with self.assertRaises(RuntimeError):
            boundary.run_bounded(["/usr/bin/python3", "-I", "-B", "-c", "import select; select.select([],[],[],5)"], timeout=0.1)

    def test_actual_libtest_listing_and_removed_or_renamed_case(self):
        result = boundary.run_bounded([EXE, "--list", "--format=terse"], limit=boundary.MIB)
        self.assertEqual(result.returncode, 0)
        boundary.checked_listing(result.stdout)
        target = (boundary.TEST + ": test\n").encode()
        for changed in (result.stdout.replace(target, b""), result.stdout.replace(target, b"renamed: test\n"),
                        result.stdout + target):
            with self.assertRaises(RuntimeError):
                boundary.checked_listing(changed)
        removed = boundary.run_bounded([EXE, "nonexistent-original-capture", "--list", "--format=terse"])
        with self.assertRaises(RuntimeError):
            boundary.checked_listing(removed.stdout)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise RuntimeError("actual current library test ELF required")
    EXE = sys.argv.pop()
    unittest.main(verbosity=2)
