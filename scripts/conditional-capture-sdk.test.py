"""Actual filesystem/process/protocol controls; not SDK capture acceptance."""
import copy
from contextlib import ExitStack, redirect_stderr
import importlib.util
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("capture_boundary", Path(__file__).with_name("conditional-capture-sdk.py"))
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


class BoundaryControls(unittest.TestCase):
    def test_private_cache_retains_actual_native_execution_without_executing_data(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            tool = root / "actual-native-tool"
            shutil.copyfile("/usr/bin/true", tool)
            tool.chmod(0o555)
            data = root / "dependency-data"
            data.write_bytes(boundary.read_regular(tool))
            data.chmod(0o444)
            nested = root / "registry"
            nested.mkdir(mode=0o555)
            before = {file.name: boundary.read_regular(file) for file in (tool, data)}
            boundary.seal_private_cargo_cache(root)
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(nested.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(tool.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(data.stat().st_mode), 0o600)
            self.assertEqual({file.name: boundary.read_regular(file) for file in (tool, data)}, before)
            self.assertEqual(boundary.run_bounded([str(tool)]).returncode, 0)
            with self.assertRaises(PermissionError):
                boundary.run_bounded([str(data)])

    def test_private_cache_refuses_file_and_directory_aliases(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            outside = root / "outside"
            outside.mkdir()
            target = outside / "unchanged"
            target.write_bytes(b"outside cache")
            target.chmod(0o444)
            for directory in (False, True):
                with self.subTest(directory=directory):
                    cargo = root / "cache"
                    cargo.mkdir()
                    alias = cargo / "alias"
                    alias.symlink_to(outside if directory else target)
                    with self.assertRaises(RuntimeError):
                        boundary.seal_private_cargo_cache(cargo)
                    self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o444)
                    self.assertEqual(target.read_bytes(), b"outside cache")
                    alias.unlink()
                    cargo.rmdir()

    def test_private_cache_refuses_hardlinked_and_special_files(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            target = root / "file"
            target.write_bytes(b"linked cache data")
            target.chmod(0o444)
            os.link(target, root / "hardlink")
            with self.assertRaises(RuntimeError):
                boundary.seal_private_cargo_cache(root)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o444)
            (root / "hardlink").unlink()
            os.mkfifo(root / "special")
            with self.assertRaises(RuntimeError):
                boundary.seal_private_cargo_cache(root)

    def test_private_cache_clone_binds_actual_native_bytes_modes_and_membership(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            source = root / "image-cache"
            source.mkdir()
            tool_name = ".git/hooks/actual-native-tool"
            tool = source / tool_name
            tool.parent.mkdir(parents=True)
            shutil.copyfile("/usr/bin/true", tool)
            tool.chmod(0o555)
            tool.parent.chmod(0o555)
            tool.parent.parent.chmod(0o555)
            data = source / "data"
            data.write_bytes(b"immutable dependency input")
            data.chmod(0o444)
            source.chmod(0o555)
            try:
                before = boundary.cargo_cache_rows(source, immutable=True)
                destination = root / "private-cache"
                custody = boundary.copy_private_cargo_cache(source, destination)
                self.assertEqual(custody["inventory_sha256"], boundary.sha(boundary.encoded(before)))
                self.assertEqual(custody["entries"], 5)
                self.assertEqual(custody["source_tool_modes"], [{"path": tool_name, "mode": 0o555}])
                self.assertEqual(boundary.run_bounded([str(destination / tool_name)]).returncode, 0)
                boundary.verify_private_cargo_tools(destination, custody)
                (destination / tool_name).chmod(0o600)
                with self.assertRaises(RuntimeError):
                    boundary.verify_private_cargo_tools(destination, custody)
                (destination / tool_name).chmod(0o700)
                (destination / tool_name).write_bytes(b"changed native tool")
                with self.assertRaises(RuntimeError):
                    boundary.verify_private_cargo_tools(destination, custody)
                with self.assertRaises(RuntimeError):
                    boundary.copy_private_cargo_cache(source, destination)
            finally:
                source.chmod(0o700)

    def test_private_cache_clone_refuses_source_aliases_before_destination_creation(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            source = root / "image-cache"
            source.mkdir()
            data = root / "foreign-data"
            data.write_bytes(b"foreign dependency input")
            data.chmod(0o444)
            (source / "alias").symlink_to(data)
            source.chmod(0o555)
            destination = root / "private-cache"
            try:
                with self.assertRaises(RuntimeError):
                    boundary.copy_private_cargo_cache(source, destination)
                self.assertFalse(destination.exists())
                self.assertEqual(data.read_bytes(), b"foreign dependency input")
            finally:
                source.chmod(0o700)

    def test_private_cache_clone_breaks_complete_immutable_git_pack_links(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            source = root / "image-cache"
            source.mkdir()
            pack = source / "db-pack"
            pack.write_bytes(b"actual immutable shared pack bytes")
            pack.chmod(0o444)
            os.link(pack, source / "checkout-pack")
            source.chmod(0o555)
            destination = root / "private-cache"
            try:
                boundary.copy_private_cargo_cache(source, destination)
                self.assertEqual((destination / "db-pack").stat().st_nlink, 1)
                self.assertEqual((destination / "checkout-pack").stat().st_nlink, 1)
                self.assertNotEqual((destination / "db-pack").stat().st_ino,
                                    (destination / "checkout-pack").stat().st_ino)
                self.assertEqual(pack.stat().st_nlink, 2)
                os.link(pack, root / "foreign-link")
                with self.assertRaisesRegex(RuntimeError, "out-of-root hardlink"):
                    boundary.copy_private_cargo_cache(source, root / "second-cache")
                self.assertFalse((root / "second-cache").exists())
            finally:
                source.chmod(0o700)

    def descriptor(self):
        # Parser/control fixture only. Actual ELF and actual file measurements
        # below must not be interpreted as installed SDK qualification.
        contents = boundary.read_executable(Path(EXE))
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

    def test_actual_elf_has_a_separate_bounded_transfer(self):
        contents = boundary.read_executable(Path(EXE))
        self.assertTrue(contents.startswith(b"\x7fELF"))
        self.assertLessEqual(len(contents), boundary.MAX_ELF)
        self.assertEqual(boundary.MAX_FILE, 256 * boundary.MIB)
        self.assertEqual(boundary.MAX_ELF, 512 * boundary.MIB)
        self.assertEqual(boundary.MAX_TREE, 512 * boundary.MIB)
        self.assertEqual(boundary.MAX_JSON, 32 * boundary.MIB)
        if len(contents) > boundary.MAX_FILE:
            with self.assertRaises(RuntimeError):
                boundary.read_regular(Path(EXE))
        else:
            self.assertEqual(boundary.read_regular(Path(EXE)), contents)
        with tempfile.TemporaryDirectory() as owner:
            oversize = Path(owner) / "oversize-executable"
            with oversize.open("xb") as stream:
                stream.truncate(boundary.MAX_ELF + 1)
            with self.assertRaises(RuntimeError):
                boundary.read_executable(oversize)
        read_fd, write_fd = os.pipe()
        def send():
            with os.fdopen(write_fd, "wb", buffering=0) as stream:
                boundary.write_bounded(stream, contents, time.monotonic() + 30)
        sender = threading.Thread(target=send)
        sender.start()
        try:
            with os.fdopen(read_fd, "rb", buffering=0) as stream:
                reader = boundary.Reader(stream, time.monotonic() + 30)
                for length in (True, -1, boundary.MAX_FILE + 1):
                    with self.assertRaises(RuntimeError):
                        reader.exact(length)
                for length in (True, -1, boundary.MAX_ELF + 1):
                    with self.assertRaises(RuntimeError):
                        reader.executable(length)
                transferred = reader.executable(len(contents))
                self.assertEqual(transferred, contents)
                self.assertEqual(boundary.sha(transferred), boundary.sha(contents))
                reader.exhausted()
        finally:
            sender.join(timeout=30)
        self.assertFalse(sender.is_alive())

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
                           ("executable_bytes", boundary.MAX_ELF + 1),
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

    def test_failed_capture_retains_original_marker_without_scanning_cargo_scratch(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            marker = {"phase": "verification", "code": "PP5301", "message": "original producer failure",
                      "complete_application_accepted": False}
            (root / "capture-failure.json").write_bytes(boundary.encoded(marker))
            scratch = root / "failed-producer-source/target"
            scratch.mkdir(parents=True)
            (scratch / "build-script-build").write_bytes(b"real scratch bytes")
            os.link(scratch / "build-script-build", scratch / "build_script_build")
            os.mkfifo(scratch / "nonregular-scratch")
            with self.assertRaisesRegex(RuntimeError, "bounded singly linked regular input required"):
                boundary.tree(root)
            failed = self.result()
            failed["status"] = 7
            rows = boundary.capture_records(root, failed)
            self.assertEqual(rows, [boundary.row(root, "capture-failure.json")])
            self.assertEqual(boundary.validate_rows(rows, capture=True), rows)
            self.assertEqual(boundary.read_regular(root / "capture-failure.json"), boundary.encoded(marker))
            with self.assertRaisesRegex(RuntimeError, "actual successful child result"):
                boundary.checked_result(failed)
            # A forged diagnostic marker cannot bypass successful-tree custody.
            with self.assertRaisesRegex(RuntimeError, "bounded singly linked regular input required"):
                boundary.capture_records(root, self.result())

    def test_failed_capture_marker_is_closed_bounded_and_cannot_claim_acceptance(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            marker = root / "capture-failure.json"
            failure = {"phase": "build", "code": "PP5101", "message": "original failure",
                       "complete_application_accepted": False}
            failed = self.result()
            failed["status"] = 1
            for key, value in (("extra", True), ("phase", "success"), ("code", "not-a-code"),
                               ("message", {}), ("complete_application_accepted", True),
                               ("complete_application_accepted", 0)):
                changed = {**failure, key: value}
                marker.write_bytes(boundary.encoded(changed))
                with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                    boundary.capture_records(root, failed)
            marker.write_bytes(boundary.encoded(failure))
            os.link(marker, root / "alias")
            with self.assertRaises(RuntimeError):
                boundary.capture_records(root, failed)
            (root / "alias").unlink()
            marker.unlink()
            (root / "target").write_bytes(boundary.encoded(failure))
            marker.symlink_to("target")
            with self.assertRaises(RuntimeError):
                boundary.capture_records(root, failed)
            marker.unlink()
            with marker.open("xb") as stream:
                stream.truncate(boundary.MIB + 1)
            with self.assertRaises(RuntimeError):
                boundary.capture_records(root, failed)

    def test_failed_capture_without_marker_never_becomes_success(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            (root / "unqualified").mkdir()
            os.mkfifo(root / "unqualified/scratch")
            failed = self.result()
            failed["status"] = 1
            self.assertEqual(boundary.capture_records(root, failed), [])
            with self.assertRaises(RuntimeError):
                boundary.checked_result(failed)
            with self.assertRaises(RuntimeError):
                boundary.capture_records(root, self.result())

    def test_failed_capture_keeps_real_process_streams_and_strict_result_refusals(self):
        process = boundary.run_bounded(["/usr/bin/python3", "-I", "-B", "-c",
            "import os; os.write(1,b'original stdout\\n'); os.write(2,b'original stderr\\n'); raise SystemExit(7)"])
        self.assertEqual((process.returncode, process.stdout, process.stderr),
                         (7, b"original stdout\n", b"original stderr\n"))
        with tempfile.TemporaryDirectory() as owner:
            output = Path(owner)
            result = self.result()
            mutations = [{**result, "status": process.returncode}, {**result, "status": False},
                         {**result, "status": None}, {**result, "signal": "SIGTERM"},
                         {**result, "retirement": {**result["retirement"], "descendants_absent": False}},
                         {**result, "extra": True}]
            for changed in mutations:
                with self.subTest(result=changed):
                    self.assertEqual(boundary.capture_records(output, changed), [])
                    with self.assertRaises(RuntimeError):
                        boundary.checked_result(changed)
            self.assertEqual((process.returncode, process.stdout, process.stderr),
                             (7, b"original stdout\n", b"original stderr\n"))

    def test_failed_marker_substitution_between_validation_and_measurement_is_refused(self):
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            marker = root / "capture-failure.json"
            value = {"phase": "build", "code": "PP5101", "message": "original failure",
                     "complete_application_accepted": False}
            marker.write_bytes(boundary.encoded(value))
            failed = {**self.result(), "status": 1}
            loads = boundary.json.loads
            def replace_after_parse(contents):
                parsed = loads(contents)
                marker.write_bytes(boundary.encoded({**value, "complete_application_accepted": True}))
                return parsed
            with patch.object(boundary.json, "loads", replace_after_parse):
                with self.assertRaisesRegex(RuntimeError, "failed capture marker changed during admission"):
                    boundary.capture_records(root, failed)

    def test_actual_failed_wire_preserves_streams_on_secondary_marker_refusal(self):
        process = boundary.run_bounded(["/usr/bin/python3", "-I", "-B", "-c",
            "import os; os.write(1,b'original stdout\\n'); os.write(2,b'original stderr\\n'); raise SystemExit(7)"])
        result = {**self.result(), "status": process.returncode}
        with tempfile.TemporaryDirectory() as owner:
            root = Path(owner)
            for body in (b"malformed", boundary.encoded({"complete_application_accepted": True})):
                (root / "capture-failure.json").write_bytes(body)
                reader_fd, writer_fd = os.pipe()
                failures = []
                def send():
                    try:
                        with os.fdopen(writer_fd, "wb", buffering=0) as stream:
                            boundary.transport_capture(root, result, {}, process.stdout, process.stderr, stream)
                    except Exception as error:
                        failures.append(error)
                sender = threading.Thread(target=send)
                sender.start()
                with os.fdopen(reader_fd, "rb", buffering=0) as stream:
                    wire = boundary.Reader(stream, time.monotonic() + 5)
                    response = wire.line()
                    self.assertEqual(response["result"], result)
                    self.assertEqual(response["records"], [])
                    self.assertEqual(wire.exact(response["stdout_bytes"]), process.stdout)
                    self.assertEqual(wire.exact(response["stderr_bytes"]), process.stderr)
                    wire.exhausted()
                sender.join(timeout=5)
                self.assertFalse(sender.is_alive())
                self.assertEqual(len(failures), 1)
                with self.assertRaises(RuntimeError):
                    boundary.checked_result(response["result"])

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
