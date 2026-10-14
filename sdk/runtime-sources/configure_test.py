"""Real source-input boundary fixtures, not signatures or SDK acceptance."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("runtime_sources", Path(__file__).with_name("configure.py"))
CONFIG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONFIG)
FIXTURES = Path(__file__).with_name("fixtures")
LOCK = Path(__file__).resolve().parents[1]/"runtime-os.lock"


def field(raw, name, value):
    result, count = re.subn(b"(?im)^"+re.escape(name)+b":[ \t]+[^\n]+$",
                            name+b": "+value, raw, count=1)
    if count != 1:
        raise AssertionError("actual fixture field missing: "+name.decode())
    return result


class NativeRuntimeSources(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="prismpm-runtime-sources-test-")).resolve()
        self.apt = self.work/"apt"; self.parts = self.apt/"sources.list.d"
        self.parts.mkdir(parents=True)
        self.legacy = self.apt/"sources.list"
        self.legacy.write_bytes((FIXTURES/"base.sources.list").read_bytes())
        self.lock = self.work/"runtime-os.lock"; self.lock.write_bytes(LOCK.read_bytes())
        self.keyring = self.work/"keyring"; self.keyring.write_bytes(b"source-boundary fixture; not a signing oracle\n")
        self.catalogue = self.work/"fixtures"; self.catalogue.mkdir()
        for architecture in ("amd64", "arm64"):
            for suffix in ("ubuntu.sources", "nodesource.list"):
                name = architecture+"."+suffix
                (self.catalogue/name).write_bytes((FIXTURES/name).read_bytes())

    def tearDown(self):
        for directory, _, _ in os.walk(self.work, followlinks=False):
            os.chmod(directory, 0o700, follow_symlinks=False)
        shutil.rmtree(self.work)

    def install_fixture(self, architecture):
        for suffix in ("ubuntu.sources", "nodesource.list"):
            (self.parts/suffix).write_bytes((self.catalogue/(architecture+"."+suffix)).read_bytes())

    def invoke(self, architecture="amd64", phase="prepare", **kwargs):
        return CONFIG.configure(self.apt, self.lock, architecture, CONFIG.SNAPSHOT, phase,
            self.catalogue, owner=os.getuid(), keyring=self.keyring, **kwargs)

    def refuse(self, architecture="amd64", phase="prepare"):
        source = self.parts/"ubuntu.sources"
        original = source.read_bytes() if source.is_file() and not source.is_symlink() else None
        with self.assertRaises((ValueError, OSError)):
            self.invoke(architecture, phase)
        if original is not None:
            self.assertEqual(source.read_bytes(), original)
        self.assertFalse(list(self.parts.glob(".prismpm-ubuntu-sources-*")))

    def test_actual_native_base_fixtures_have_the_closed_original_profile(self):
        catalogue = json.loads((FIXTURES/"provenance.json").read_bytes())
        self.assertEqual(catalogue["image"], "mcr.microsoft.com/playwright:v1.62.1-noble@sha256:"
                         "dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e")
        self.assertEqual(hashlib.sha256(self.legacy.read_bytes()).hexdigest(), CONFIG.LEGACY_SHA256)
        self.assertTrue(all(not line.strip() or line.startswith(b"#") for line in self.legacy.read_bytes().splitlines()))
        for architecture in ("amd64", "arm64"):
            profile = next(row for row in catalogue["architectures"] if row["architecture"] == architecture)
            self.assertEqual(len(profile["layers"]), 7)
            for entry in profile["files"]:
                if entry["fixture"] is not None:
                    actual = (FIXTURES/entry["fixture"]).read_bytes()
                    self.assertEqual(len(actual), entry["bytes"])
                    self.assertEqual(hashlib.sha256(actual).hexdigest(), entry["sha256"])
            raw = (self.catalogue/(architecture+".ubuntu.sources")).read_bytes()
            rows, spans = CONFIG.admit_document(raw, architecture, snapshot=False)
            self.assertEqual(len(rows), 2); self.assertEqual(len(spans), 2)
            self.assertEqual(set(rows[0]["suites"].split()), set(CONFIG.PRIMARY))
            self.assertEqual(rows[1]["suites"], "noble-security")
            self.assertIn(b"node_24.x", (self.catalogue/(architecture+".nodesource.list")).read_bytes())

    def test_both_architectures_replace_only_the_two_uri_values(self):
        for architecture in ("amd64", "arm64"):
            raw = (self.catalogue/(architecture+".ubuntu.sources")).read_bytes()
            _, spans = CONFIG.admit_document(raw, architecture, snapshot=False)
            expected = raw
            for start, end in reversed(spans):
                expected = expected[:start]+CONFIG.SNAPSHOT.encode()+expected[end:]
            actual = CONFIG.rewrite(raw, architecture)
            self.assertEqual(actual, expected)
            self.assertEqual(actual.count(CONFIG.SNAPSHOT.encode()), 2)
            CONFIG.admit_document(actual, architecture, snapshot=True)
            with self.assertRaises(ValueError):
                CONFIG.rewrite(actual, architecture)

    def test_real_filesystem_prepare_remove_and_verify_for_both_native_fixtures(self):
        legacy_bytes = self.legacy.read_bytes()
        legacy_identity = CONFIG.identity(self.legacy.stat())
        for architecture in ("amd64", "arm64"):
            self.install_fixture(architecture)
            original = (self.parts/"ubuntu.sources").read_bytes()
            result = self.invoke(architecture)
            self.assertEqual(result["source_sha256"], hashlib.sha256(CONFIG.rewrite(original, architecture)).hexdigest())
            self.assertEqual((self.parts/"nodesource.list").read_bytes(),
                             (self.catalogue/(architecture+".nodesource.list")).read_bytes())
            (self.parts/"nodesource.list").unlink()
            final = self.invoke(architecture, "verify")
            self.assertEqual(final["source_sha256"], result["source_sha256"])
            self.assertEqual(final["legacy_source_sha256"], CONFIG.LEGACY_SHA256)
            self.assertEqual(self.legacy.read_bytes(), legacy_bytes)
            self.assertEqual(CONFIG.identity(self.legacy.stat()), legacy_identity)
            self.assertEqual(set(path.name for path in self.parts.iterdir()), {"ubuntu.sources"})

    def test_skipped_prepare_and_skipped_nodesource_removal_each_fail_closed(self):
        self.install_fixture("amd64")
        node = self.parts/"nodesource.list"; node.unlink()
        self.refuse(phase="verify")
        self.install_fixture("amd64"); self.invoke()
        self.refuse(phase="verify")

    def test_foreign_native_unknown_duplicate_and_floating_uris_are_refused(self):
        for architecture in ("amd64", "arm64"):
            raw = (self.catalogue/(architecture+".ubuntu.sources")).read_bytes()
            foreign = "arm64" if architecture == "amd64" else "amd64"
            with self.assertRaises(ValueError):
                CONFIG.rewrite(raw, foreign)
            for uri in (b"https://archive.ubuntu.com/ubuntu/", CONFIG.SNAPSHOT.encode(),
                        b"http://azure.ports.ubuntu.com/ubuntu/", b"https://example.invalid/ubuntu/",
                        b"http://azure.archive.ubuntu.com/ubuntu/ http://azure.archive.ubuntu.com/ubuntu/",
                        b"http://azure.archive.ubuntu.com/ubuntu/#foreign"):
                with self.subTest(architecture=architecture, uri=uri), self.assertRaises(ValueError):
                    CONFIG.rewrite(field(raw, b"URIs", uri), architecture)

    def test_unknown_missing_and_duplicate_fields_pockets_components_and_keys_fail(self):
        raw = (self.catalogue/"amd64.ubuntu.sources").read_bytes()
        mutants = [raw+raw, raw.replace(b"\n", b"\nTrusted: yes\n", 1),
            raw.replace(b"\n", b"\nArchitectures: arm64\n", 1),
            field(raw, b"Types", b"deb deb-src"), field(raw, b"Signed-By", b"/tmp/untrusted.gpg"),
            field(raw, b"Suites", b"noble noble-updates noble-updates"),
            field(raw, b"Suites", b"noble noble-updates"),
            field(raw, b"Components", b"main main universe multiverse"),
            field(raw, b"Components", b"main restricted universe"),
            raw.replace(b"\n", b"\nURIs: https://example.invalid/\n", 1),
            re.sub(b"(?im)^Signed-By:[^\n]+\n", b"", raw, count=1)]
        for mutant in mutants:
            with self.subTest(mutant=hashlib.sha256(mutant).hexdigest()), self.assertRaises(ValueError):
                CONFIG.rewrite(mutant, "amd64")

    def test_noncanonical_control_and_oversized_documents_fail(self):
        raw = (self.catalogue/"amd64.ubuntu.sources").read_bytes()
        for mutant in (b"", raw[:-1], raw.replace(b"\n", b"\r\n"), b"\0"+raw,
                       b"\v"+raw, b"\xff"+raw, b" " + raw, raw+b"#"*65536+b"\n"):
            with self.subTest(prefix=mutant[:10]), self.assertRaises((ValueError, UnicodeError)):
                CONFIG.rewrite(mutant, "amd64")

    def test_extra_source_files_directories_and_legacy_lists_fail_without_writes(self):
        self.install_fixture("amd64")
        for path, kind in ((self.parts/"foreign.list", "file"), (self.parts/"hidden", "directory"),
                           (self.apt/"sources.list", "file")):
            original = path.read_bytes() if path.is_file() else None
            if kind == "file": path.write_bytes(b"foreign source\n")
            else: path.mkdir()
            self.refuse()
            if kind == "file": path.unlink()
            else: path.rmdir()
            if original is not None: path.write_bytes(original)
        original = self.legacy.read_bytes()
        for mutant in (b"", b"# unknown notice\n", original+b"deb https://archive.ubuntu.com/ubuntu noble main\n"):
            self.legacy.write_bytes(mutant); self.refuse()
        self.legacy.unlink(); self.refuse(); self.legacy.write_bytes(original)

    def test_missing_sources_foreign_nodesource_and_changed_runtime_lock_fail(self):
        self.install_fixture("amd64")
        node = self.parts/"nodesource.list"; original = node.read_bytes()
        node.unlink(); self.refuse(); node.write_bytes(b"deb https://example.invalid/ nodistro main\n")
        self.refuse(); node.write_bytes(original)
        self.lock.write_bytes(self.lock.read_bytes().replace(b"20260901", b"20260902")); self.refuse()

    def test_symlinks_hardlinks_and_fifo_inputs_are_refused(self):
        self.install_fixture("amd64")
        targets = [self.parts/"ubuntu.sources", self.parts/"nodesource.list", self.legacy, self.lock, self.keyring]
        for index, target in enumerate(targets):
            saved = self.work/("saved-"+str(index)); original = target.read_bytes()
            target.rename(saved); target.symlink_to(saved)
            self.refuse(); target.unlink(); target.write_bytes(original)
            alias = self.work/("alias-"+str(index)); os.link(target, alias)
            self.refuse(); alias.unlink()
            target.unlink(); os.mkfifo(target)
            self.refuse(); target.unlink(); target.write_bytes(original)

    def test_source_directory_alias_and_writable_inputs_are_refused(self):
        self.install_fixture("amd64")
        saved = self.work/"saved-parts"; self.parts.rename(saved); self.parts.symlink_to(saved, target_is_directory=True)
        with self.assertRaises(ValueError): self.invoke()
        self.parts.unlink(); saved.rename(self.parts)
        for target in (self.parts/"ubuntu.sources", self.parts/"nodesource.list", self.legacy, self.lock, self.keyring):
            target.chmod(0o666); self.refuse(); target.chmod(0o644)

    def test_empty_keyring_and_wrong_snapshot_cannot_prepare(self):
        self.install_fixture("amd64"); self.keyring.write_bytes(b"")
        self.refuse()
        with self.assertRaises(ValueError):
            CONFIG.configure(self.apt, self.lock, "amd64", "https://archive.ubuntu.com/ubuntu/", "prepare",
                             self.catalogue, owner=os.getuid(), keyring=self.keyring)

    def test_held_file_detects_post_admission_mutation(self):
        held = CONFIG.HeldFile(self.lock, 65536, os.getuid())
        try:
            self.lock.write_bytes(self.lock.read_bytes()+b"# changed\n")
            with self.assertRaises(ValueError): held.verify()
        finally:
            held.close()

    def test_actual_native_dpkg_closure_and_all_foreign_requests(self):
        native, foreign = CONFIG.native_architecture()
        self.assertIn(native, ("amd64", "arm64")); self.assertEqual(foreign, b"")
        CONFIG.admit_architecture(native, native, foreign)
        for requested, observed, extra in ((native, native, b"i386\n"),
                ("arm64" if native == "amd64" else "amd64", native, b""),
                (native, "i386", b""), ("i386", native, b"")):
            with self.assertRaises(ValueError): CONFIG.admit_architecture(requested, observed, extra)


if __name__ == "__main__":
    unittest.main()
