"""Real acquisition-boundary fixtures; never browser/application acceptance."""

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location("browser_input", Path(__file__).with_name("install.py"))
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)
ROOT = "chrome-headless-shell-linux64"
HEADER = bytes.fromhex("7f454c4602010100000000000000000002003e00")


def fixture(directory, entries=None):
    entries = entries or [
        (ROOT + "/ABOUT", b"Acquisition-boundary fixture only.\n", stat.S_IFREG | 0o644),
        (ROOT + "/LICENSE.headless_shell", b"Not a browser acceptance artifact.\n", stat.S_IFREG | 0o644),
        (ROOT + "/chrome-headless-shell", HEADER, stat.S_IFREG | 0o755),
    ]
    path = directory / "input.zip"
    rows = []
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content, mode in entries:
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = mode << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content)
            rows.append({"path": name, "bytes": len(content),
                         "sha256": hashlib.sha256(content).hexdigest(), "mode": mode})
    rows.sort(key=lambda row: row["path"])
    tree = hashlib.sha256()
    contents = {name: content for name, content, _ in entries}
    for row in rows:
        name = row["path"].encode()
        tree.update(struct.pack(">Q", len(name)) + name + struct.pack(">Q", row["bytes"]))
        tree.update(contents[row["path"]])
    raw = path.read_bytes()
    return path, {"archive_bytes": len(raw), "archive_sha256": hashlib.sha256(raw).hexdigest(),
                  "archive_member_count": len(rows), "expanded_bytes": sum(row["bytes"] for row in rows),
                  "archive_root": ROOT, "elf_machine": 62, "tree_sha256": tree.hexdigest(), "files": rows}


class InstallerBoundary(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="prismpm-browser-input-test-"))
        self.destination = self.work / "installed"
        self.archive, self.authority = fixture(self.work)

    def tearDown(self):
        for directory, _, _ in os.walk(self.work, followlinks=False):
            os.chmod(directory, 0o700, follow_symlinks=False)
        shutil.rmtree(self.work)

    def refuse(self, authority=None, archive=None, message=None):
        with self.assertRaises(Exception) as error:
            INSTALL.install_archive(archive or self.archive, authority or self.authority, self.destination)
        if message:
            self.assertIn(message, str(error.exception))
        self.assertFalse(self.destination.exists())
        self.assertFalse(list(self.work.glob(".chromium-input-*")))

    def test_closed_source_authority_has_both_actual_native_inputs(self):
        lock = INSTALL.load_authority()
        self.assertEqual(set(lock["platforms"]), {"amd64", "arm64"})
        self.assertEqual(lock["version"], "157.0.8099.0")
        self.assertEqual(lock["channel"], "Canary")
        for platform, authority in lock["platforms"].items():
            self.assertEqual(len(INSTALL.declared_members(authority)), 287)
            self.assertEqual(authority["elf_machine"], {"amd64": 62, "arm64": 183}[platform])
            self.assertTrue(authority["url"].endswith("?generation=" + authority["generation"]))
            for name in lock["redistribution"]["notices"]:
                self.assertIn(authority["archive_root"] + "/" + name,
                              [row["path"] for row in authority["files"]])

    def test_complete_private_stage_is_published_readonly(self):
        INSTALL.install_archive(self.archive, self.authority, self.destination)
        INSTALL.verify_tree(self.destination, self.authority)
        self.assertFalse(list(self.work.glob(".chromium-input-*")))
        for directory, _, files in os.walk(self.destination):
            self.assertEqual(stat.S_IMODE(Path(directory).stat().st_mode), 0o555)
            for name in files:
                self.assertEqual(Path(directory, name).stat().st_nlink, 1)

    def test_wrong_compressed_digest_never_creates_stage(self):
        changed = copy.deepcopy(self.authority)
        changed["archive_sha256"] = "0" * 64
        self.refuse(changed, message="archive authority")

    def test_wrong_compressed_size_never_creates_stage(self):
        changed = copy.deepcopy(self.authority)
        changed["archive_bytes"] += 1
        self.refuse(changed, message="archive authority")

    def test_unadmitted_member_cannot_be_extracted_after_refusal(self):
        changed = copy.deepcopy(self.authority)
        changed["files"][0]["sha256"] = "0" * 64
        with patch.object(INSTALL.tempfile, "mkdtemp", side_effect=AssertionError("stage created before admission")):
            self.refuse(changed, message="ZIP member content")

    def test_incomplete_member_list_never_creates_stage(self):
        changed = copy.deepcopy(self.authority)
        changed["files"].pop()
        self.refuse(changed, message="wrong member count")

    def test_expansion_excess_is_refused_before_stage(self):
        changed = copy.deepcopy(self.authority)
        changed["files"][0]["bytes"] = INSTALL.MAX_FILE + 1
        self.refuse(changed, message="invalid regular member")

    def test_changed_tree_commitment_is_refused_before_stage(self):
        changed = copy.deepcopy(self.authority)
        changed["tree_sha256"] = "0" * 64
        self.refuse(changed, message="installed-tree authority")

    def test_native_elf_mismatch_cannot_publish(self):
        changed = copy.deepcopy(self.authority)
        changed["elf_machine"] = 183
        self.refuse(changed, message="wrong native ELF")

    def test_existing_destination_is_not_overwritten(self):
        self.destination.mkdir()
        guard = self.destination / "guard"
        guard.write_bytes(b"preserve existing destination")
        with self.assertRaisesRegex(ValueError, "destination already exists"):
            INSTALL.install_archive(self.archive, self.authority, self.destination)
        self.assertEqual(guard.read_bytes(), b"preserve existing destination")
        self.assertFalse(list(self.work.glob(".chromium-input-*")))

    def test_late_existing_destination_refuses_real_no_clobber_move(self):
        original = subprocess.run
        def race(arguments, **kwargs):
            self.destination.mkdir()
            (self.destination / "guard").write_bytes(b"late independent destination")
            return original(arguments, **kwargs)
        with patch.object(INSTALL.subprocess, "run", side_effect=race):
            try:
                INSTALL.install_archive(self.archive, self.authority, self.destination)
            except ValueError as error:
                # Older coreutils leaves the stage in place and exits zero.
                self.assertRegex(str(error), "publication refused")
            except subprocess.CalledProcessError as error:
                # Current coreutils reports the same real no-clobber refusal
                # with exit one. Do not accept another command or failure.
                self.assertEqual(error.returncode, 1)
                self.assertEqual(error.cmd[:4],
                                 ["/usr/bin/mv", "--no-clobber", "--no-target-directory", "--"])
                self.assertEqual(len(error.cmd), 6)
                self.assertEqual(error.cmd[5], str(self.destination))
                self.assertEqual(Path(error.cmd[4]).parent, self.destination.parent)
                self.assertTrue(Path(error.cmd[4]).name.startswith(".chromium-input-"))
            else:
                self.fail("late foreign destination must refuse publication")
        self.assertEqual((self.destination / "guard").read_bytes(), b"late independent destination")
        self.assertFalse(list(self.work.glob(".chromium-input-*")))

    def test_actual_symlink_archive_is_refused(self):
        alias = self.work / "alias.zip"
        alias.symlink_to(self.archive)
        self.refuse(archive=alias, message="unaliased")

    def test_actual_parent_alias_is_refused(self):
        source = self.work / "parent"
        source.mkdir()
        archive, authority = fixture(source)
        alias = self.work / "parent-alias"
        alias.symlink_to(source, target_is_directory=True)
        self.refuse(authority, alias / archive.name, "unaliased")

    def test_actual_hardlinked_archive_is_refused(self):
        os.link(self.archive, self.work / "second.zip")
        self.refuse(message="singly linked")

    def test_duplicate_zip_names_are_not_admitted(self):
        archive, authority = fixture(self.work, [(ROOT + "/ABOUT", b"one", stat.S_IFREG | 0o644),
                                                 (ROOT + "/ABOUT", b"two", stat.S_IFREG | 0o644)])
        self.refuse(authority, archive, "unique member")

    def test_traversing_zip_path_is_not_admitted(self):
        archive, authority = fixture(self.work, [(ROOT + "/../escape", b"data", stat.S_IFREG | 0o644)])
        self.refuse(authority, archive, "unsafe ZIP member path")
        self.assertFalse((self.work / "escape").exists())

    def test_symlink_zip_member_is_not_admitted(self):
        archive, authority = fixture(self.work, [(ROOT + "/ABOUT", b"/tmp", stat.S_IFLNK | 0o777)])
        self.refuse(authority, archive, "invalid regular member")

    def test_malformed_zip_header_never_creates_stage(self):
        raw = b"not a ZIP archive"
        self.archive.write_bytes(raw)
        changed = copy.deepcopy(self.authority)
        changed.update(archive_bytes=len(raw), archive_sha256=hashlib.sha256(raw).hexdigest())
        self.refuse(changed, message="not a zip file")

    def test_unknown_empty_directory_is_refused(self):
        INSTALL.install_archive(self.archive, self.authority, self.destination)
        self.destination.chmod(0o755)
        (self.destination / "unexpected").mkdir()
        with self.assertRaisesRegex(ValueError, "directory inventory"):
            INSTALL.verify_tree(self.destination, self.authority)

    def test_changed_installed_bytes_are_refused(self):
        INSTALL.install_archive(self.archive, self.authority, self.destination)
        file = self.destination / ROOT / "ABOUT"
        file.chmod(0o644)
        file.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "installed member differs"):
            INSTALL.verify_tree(self.destination, self.authority)

    def test_kernel_write_refusal_cannot_publish_partial_state(self):
        script = """
import importlib.util, json, resource, signal, sys
spec=importlib.util.spec_from_file_location('browser_input',sys.argv[1])
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
resource.setrlimit(resource.RLIMIT_FSIZE,(8,8))
signal.signal(signal.SIGXFSZ,signal.SIG_IGN)
module.install_archive(sys.argv[2],json.loads(sys.argv[3]),sys.argv[4])
"""
        result = subprocess.run(["/usr/bin/python3", "-c", script, str(Path(INSTALL.__file__)),
                                 str(self.archive), json.dumps(self.authority), str(self.destination)],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("File too large", result.stderr)
        self.assertFalse(self.destination.exists())
        self.assertFalse(list(self.work.glob(".chromium-input-*")))

    def change_raw(self, raw):
        self.archive.write_bytes(raw)
        authority = copy.deepcopy(self.authority)
        authority.update(archive_bytes=len(raw), archive_sha256=hashlib.sha256(raw).hexdigest())
        return authority

    def refuse_before_zip_parser(self, raw, message):
        authority = self.change_raw(raw)
        with patch.object(INSTALL.zipfile, "ZipFile", side_effect=AssertionError("eager parser started")):
            self.refuse(authority, message=message)

    def test_trailing_bytes_are_refused_before_eager_parser(self):
        self.refuse_before_zip_parser(self.archive.read_bytes() + b"trailing", "ZIP end record")

    def test_zip64_count_is_refused_before_eager_parser(self):
        raw = bytearray(self.archive.read_bytes())
        struct.pack_into("<HH", raw, len(raw) - 14, 65535, 65535)
        self.refuse_before_zip_parser(raw, "ZIP end record")

    def test_central_extent_is_refused_before_eager_parser(self):
        raw = bytearray(self.archive.read_bytes())
        struct.pack_into("<I", raw, len(raw) - 10, 0xffffffff)
        self.refuse_before_zip_parser(raw, "ZIP central directory bound")

    def test_oversized_central_name_is_refused_before_eager_parser(self):
        raw = bytearray(self.archive.read_bytes())
        offset = struct.unpack_from("<I", raw, len(raw) - 6)[0]
        struct.pack_into("<H", raw, offset + 28, 65535)
        self.refuse_before_zip_parser(raw, "ZIP central record bound")

    def test_oversized_local_extra_is_refused_before_eager_parser(self):
        raw = bytearray(self.archive.read_bytes())
        struct.pack_into("<H", raw, 28, 65535)
        self.refuse_before_zip_parser(raw, "ZIP local record differs")

    def test_overlapping_local_offsets_are_refused_before_eager_parser(self):
        raw = bytearray(self.archive.read_bytes())
        offset = struct.unpack_from("<I", raw, len(raw) - 6)[0]
        first = struct.unpack_from("<4s6H3I5H2I", raw, offset)
        second = offset + 46 + sum(first[10:13])
        struct.pack_into("<I", raw, second + 42, 0)
        self.refuse_before_zip_parser(raw, "ZIP local record differs")

    def test_unsealed_directory_mode_is_refused(self):
        INSTALL.install_archive(self.archive, self.authority, self.destination)
        (self.destination / ROOT).chmod(0o755)
        with self.assertRaisesRegex(ValueError, "directory mode differs"):
            INSTALL.verify_tree(self.destination, self.authority)

    def test_unknown_entry_is_refused_by_bounded_scandir(self):
        INSTALL.install_archive(self.archive, self.authority, self.destination)
        self.destination.chmod(0o755)
        (self.destination / "unexpected").mkdir()
        with patch.object(INSTALL.os, "walk", side_effect=AssertionError("unbounded walk")), \
             patch.object(INSTALL.os, "listdir", side_effect=AssertionError("unbounded listdir")):
            with self.assertRaisesRegex(ValueError, "directory inventory differs"):
                INSTALL.verify_tree(self.destination, self.authority)

    def test_actual_growth_during_second_read_is_bounded(self):
        INSTALL.install_archive(self.archive, self.authority, self.destination)
        file = self.destination / ROOT / "ABOUT"
        original = INSTALL.HeldFile.digest
        def grow_after_digest(held):
            result = original(held)
            if held.path == file:
                file.chmod(0o644)
                with file.open("ab") as stream:
                    stream.write(b"actual extra byte")
                file.chmod(0o444)
            return result
        with patch.object(INSTALL.HeldFile, "digest", grow_after_digest):
            with self.assertRaisesRegex(ValueError, "installed member grew"):
                INSTALL.verify_tree(self.destination, self.authority)

    def test_actual_descriptor_close_failure_preserves_primary_and_retires_stage(self):
        changed = copy.deepcopy(self.authority)
        changed["elf_machine"] = 183
        original = INSTALL.HeldFile.close
        def double_close(held):
            original(held)
            if held.path == self.archive:
                original(held)  # Actual kernel EBADF, not a replacement product verdict.
        with patch.object(INSTALL.HeldFile, "close", double_close):
            with self.assertRaisesRegex(ValueError, "wrong native ELF") as error:
                INSTALL.install_archive(self.archive, changed, self.destination)
        self.assertTrue(any("Bad file descriptor" in note for note in error.exception.__notes__))
        self.assertFalse(list(self.work.glob(".chromium-input-*")))
        self.assertFalse(self.destination.exists())

    def test_actual_stage_substitution_refuses_publication_and_foreign_cleanup(self):
        original = INSTALL.verify_tree
        guard = self.work / "original-stage"
        replaced = []
        def replace(root, authority, sealed=True):
            result = original(root, authority, sealed)
            if not sealed:
                root.rename(guard)
                root.mkdir()
                (root / "guard").write_bytes(b"foreign stage must not be removed")
                replaced.append(root)
            return result
        with patch.object(INSTALL, "verify_tree", replace):
            with self.assertRaisesRegex(ValueError, "stage custody changed") as error:
                INSTALL.install_archive(self.archive, self.authority, self.destination)
        self.assertEqual((replaced[0] / "guard").read_bytes(), b"foreign stage must not be removed")
        self.assertTrue(any("stage custody changed" in note for note in error.exception.__notes__))
        self.assertFalse(self.destination.exists())

    def test_actual_parent_substitution_refuses_before_stage_creation(self):
        source = self.work / "parent"
        source.mkdir()
        destination = source / "installed"
        saved = self.work / "saved-parent"
        original = INSTALL.scan
        def replace(archive, authority, stage=None):
            original(archive, authority, stage)
            if stage is None:
                source.rename(saved)
                source.mkdir()
                (source / "guard").write_bytes(b"foreign parent")
        with patch.object(INSTALL, "scan", replace):
            with self.assertRaisesRegex(ValueError, "parent custody changed"):
                INSTALL.install_archive(self.archive, self.authority, destination)
        self.assertEqual((source / "guard").read_bytes(), b"foreign parent")
        self.assertFalse(destination.exists())
        self.assertFalse(list(source.glob(".chromium-input-*")))
        self.assertFalse(list(saved.glob(".chromium-input-*")))


if __name__ == "__main__":
    unittest.main()
