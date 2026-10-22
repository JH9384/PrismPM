"""Real-file adversarial tests; fixtures are not native acceptance evidence."""

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("dependencies", Path(__file__).with_name("native-golden-dependencies.py"))
deps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deps)


class SupplementTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source, self.base, self.fetched, self.output, self.owner = [self.root / name for name in
            ("source", "base", "fetched", "output", "owner")]
        for directory in (self.source, self.base, self.fetched, self.output, self.owner):
            directory.mkdir()
        self.archive = b"test-only archive bytes"
        self.checksum = deps.digest(self.archive)
        (self.source / "Cargo.toml").write_text('[workspace]\n')
        (self.source / "Cargo.lock").write_text('version = 4\n[[package]]\nname = "sample"\nversion = "1.0.0"\n'
            'source = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "' + self.checksum + '"\n')
        for relative in deps.MANIFESTS[1:]:
            self.put(self.source / relative, b'[workspace]\n')
            self.put((self.source / relative).with_name('Cargo.lock'), (self.source / 'Cargo.lock').read_bytes())
        self.crate = f"registry/cache/{deps.REGISTRY}/sample-1.0.0.crate"
        self.index = f"registry/index/{deps.REGISTRY}/.cache/sa/mp/sample"
        self.put(self.fetched / self.crate, self.archive)
        entry = json.dumps({"name": "sample", "vers": "1.0.0", "cksum": self.checksum}).encode()
        self.index_bytes = b'\x03\x02\0\0\0etag: "fixture"\0' + b'1.0.0\0' + entry + b'\0'
        self.put(self.fetched / self.index, self.index_bytes)

    def put(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def prepare(self):
        return deps.supplement(self.source, self.base, self.fetched, self.output)

    def install(self):
        return deps.install(self.source, self.output, self.owner)

    def test_exact_data_only_handoff(self):
        self.put(self.fetched / "registry/src/untrusted/.cargo-ok", b"do not import")
        self.put(self.fetched / "config.toml", b"do not import")
        self.put(self.fetched / "bin/compiler", b"do not import")
        receipt = self.prepare()
        result = self.install()
        self.assertEqual(len(receipt["files"]), 2)
        self.assertEqual(result["preparation"], receipt)
        self.assertEqual((self.owner / self.crate).read_bytes(), self.archive)
        self.assertFalse((self.owner / "registry/src").exists())
        self.assertFalse((self.owner / "config.toml").exists())

    def test_corrupt_download_rejected(self):
        (self.fetched / self.crate).write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.prepare()

    def test_archive_and_receipt_substitution_cannot_override_lock(self):
        self.prepare()
        path = self.output / self.crate
        path.write_bytes(b"replacement")
        receipt_path = self.output / "preparation.json"
        receipt = json.loads(receipt_path.read_bytes())
        for row in receipt["files"]:
            if row["path"] == self.crate:
                row.update(sha256=deps.digest(path.read_bytes()), bytes=path.stat().st_size)
        receipt_path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, "committed lock"):
            self.install()
        self.assertEqual(list(self.owner.iterdir()), [])

    def test_extra_file_rejected_before_copy(self):
        self.prepare()
        self.put(self.output / "config.toml", b"extra")
        with self.assertRaisesRegex(ValueError, "unrecorded"):
            self.install()
        self.assertEqual(list(self.owner.iterdir()), [])

    def test_lock_drift_rejected(self):
        self.prepare()
        with (self.source / "Cargo.lock").open("a") as stream:
            stream.write("\n")
        with self.assertRaisesRegex(ValueError, "source identity"):
            self.install()

    def test_configuration_override_rejected(self):
        self.put(self.source / ".cargo/config.toml", b'[source.crates-io]\nreplace-with="attacker"\n')
        with self.assertRaisesRegex(ValueError, "configuration"):
            self.prepare()

    def test_alias_only_configuration_captured(self):
        self.put(self.source / ".cargo/config.toml", b'[alias]\nxtask="run -p xtask --"\n')
        self.assertIn(".cargo/config.toml", self.prepare()["inputs"])
        self.install()

    def test_manifest_count_accepts_exact_bound_and_refuses_first_over(self):
        (self.source / "Cargo.toml").write_text('[workspace]\nmembers = ["members/*"]\n')
        for index in range(4088):
            self.put(self.source / f"members/{index}/Cargo.toml",
                     f'[package]\nname = "member-{index}"\nversion = "0.1.0"\n'.encode())
        # Four independently selected manifest/lock pairs + 4088 members.
        self.assertEqual(len(deps.inputs(self.source)), 4096)
        self.put(self.source / "rust-toolchain.toml", b'[toolchain]\nchannel="stable"\n')
        with self.assertRaisesRegex(ValueError, "source manifest bound exceeded"):
            deps.inputs(self.source)

    def test_index_checksum_disagreement_rejected(self):
        (self.fetched / self.index).write_bytes(self.index_bytes.replace(self.checksum.encode(), b"0" * 64))
        with self.assertRaisesRegex(ValueError, "index differs"):
            self.prepare()

    def test_aliases_and_hardlinks_rejected(self):
        path = self.fetched / self.crate
        path.unlink()
        target = self.root / "external"
        target.write_bytes(self.archive)
        path.symlink_to(target)
        with self.assertRaises(OSError):
            self.prepare()
        path.unlink()
        os.link(target, path)
        with self.assertRaisesRegex(ValueError, "singly linked"):
            self.prepare()

    def test_existing_cache_conflict_rejected(self):
        self.prepare()
        self.put(self.owner / self.crate, b"conflicting")
        with self.assertRaisesRegex(ValueError, "conflicts"):
            self.install()
        self.assertEqual((self.owner / self.crate).read_bytes(), b"conflicting")

    def test_immutable_archive_not_copied_again(self):
        self.put(self.base / self.crate, self.archive)
        self.put(self.owner / self.crate, self.archive)
        receipt = self.prepare()
        self.assertEqual([row["path"] for row in receipt["files"]], [self.index])
        self.install()

    def test_unlocked_path_rejected(self):
        self.prepare()
        path = self.output / "preparation.json"
        receipt = json.loads(path.read_bytes())
        receipt["files"][0]["path"] = "../escape"
        path.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, "unlocked"):
            self.install()

    def test_configuration_directory_alias_rejected(self):
        external = self.root / "config"
        self.put(external / "config.toml", b'[source.crates-io]\nreplace-with="attacker"\n')
        (self.source / ".cargo").symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "aliased Cargo configuration"):
            self.prepare()

    def test_path_dependency_directory_alias_rejected(self):
        external = self.root / "dependency"
        self.put(external / "Cargo.toml", b'[package]\nname="dependency"\nversion="1.0.0"\n')
        (self.source / "dependency").symlink_to(external, target_is_directory=True)
        (self.source / "Cargo.toml").write_text('[dependencies]\ndependency={path="dependency"}\n')
        with self.assertRaisesRegex(ValueError, "aliased or escaping Cargo input"):
            self.prepare()

    def test_index_size_rejected_before_owner_write(self):
        self.prepare()
        with (self.output / self.index).open("r+b") as stream:
            stream.truncate(8 * 1024 * 1024 + 1)
        with self.assertRaisesRegex(ValueError, "file bound"):
            self.install()
        self.assertEqual(list(self.owner.iterdir()), [])

    def test_inherited_workspace_and_toolchain_drift_rejected(self):
        (self.source / "Cargo.toml").write_text('[dependencies]\nchild={path="vendor/child"}\n')
        self.put(self.source / "vendor/Cargo.toml", b'[workspace]\nmembers=["child"]\n')
        self.put(self.source / "vendor/child/Cargo.toml", b'[package]\nname="child"\nversion="1.0.0"\n')
        self.put(self.source / "rust-toolchain.toml", b'[toolchain]\nchannel="1.97.1"\n')
        receipt = self.prepare()
        self.assertIn("vendor/Cargo.toml", receipt["inputs"])
        self.assertIn("rust-toolchain.toml", receipt["inputs"])
        self.put(self.source / "vendor/Cargo.toml", b'[workspace]\nmembers=["child"]\nresolver="2"\n')
        with self.assertRaisesRegex(ValueError, "source identity"):
            self.install()

    def test_inherited_workspace_manifest_alias_rejected(self):
        (self.source / "Cargo.toml").write_text('[dependencies]\nchild={path="vendor/child"}\n')
        self.put(self.source / "vendor/child/Cargo.toml", b'[package]\nname="child"\nversion="1.0.0"\n')
        target = self.root / "outside-workspace"
        target.write_text('[workspace]\nmembers=["child"]\n')
        (self.source / "vendor/Cargo.toml").symlink_to(target)
        with self.assertRaisesRegex(ValueError, "aliased or escaping"):
            self.prepare()

    def test_selected_independent_locks_capture_complete_registry_union(self):
        for index, relative in enumerate(deps.MANIFESTS[1:]):
            name = 'independent' + str(index)
            archive = name.encode()
            checksum = deps.digest(archive)
            self.put((self.source / relative).with_name('Cargo.lock'),
                     ('version = 4\n[[package]]\nname = "' + name + '"\nversion = "1.0.0"\n'
                      'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
                      'checksum = "' + checksum + '"\n').encode())
            self.put(self.fetched / f'registry/cache/{deps.REGISTRY}/{name}-1.0.0.crate', archive)
            entry = json.dumps({'name': name, 'vers': '1.0.0', 'cksum': checksum}).encode()
            self.put(self.fetched / f'registry/index/{deps.REGISTRY}/.cache/{deps.index_path(name)}',
                     b'\x03\x02\0\0\0etag: "fixture"\0' + b'1.0.0\0' + entry + b'\0')
        receipt = self.prepare()
        self.assertEqual(len(receipt['files']), 8)
        for relative in deps.MANIFESTS:
            self.assertIn(relative, receipt['inputs'])
            self.assertIn(str(Path(relative).with_name('Cargo.lock')), receipt['inputs'])
        self.install()
        self.assertEqual(len(list((self.owner / f'registry/cache/{deps.REGISTRY}').iterdir())), 4)

    def test_each_independent_lock_drift_refused_before_owner_write(self):
        self.prepare()
        for relative in deps.MANIFESTS[1:]:
            with self.subTest(relative=relative):
                path = (self.source / relative).with_name('Cargo.lock')
                original = path.read_bytes()
                path.write_bytes(original + b'\n')
                with self.assertRaisesRegex(ValueError, 'source identity'):
                    self.install()
                self.assertEqual(list(self.owner.iterdir()), [])
                path.write_bytes(original)

    def test_conflicting_and_duplicate_independent_lock_identities_refused(self):
        for relative in deps.MANIFESTS[1:]:
            path = (self.source / relative).with_name('Cargo.lock')
            original = path.read_bytes()
            with self.subTest(relative=relative, kind='conflicting'):
                path.write_bytes(original.replace(self.checksum.encode(), b'0' * 64))
                with self.assertRaisesRegex(ValueError, 'identities conflict'):
                    deps.locked(self.source)
            with self.subTest(relative=relative, kind='duplicate'):
                path.write_bytes(original + original.split(b'\n', 1)[1])
                with self.assertRaisesRegex(ValueError, 'duplicate locked crate'):
                    deps.locked(self.source)
            path.write_bytes(original)

    def test_nested_cargo_configuration_refused_for_every_selected_ancestor(self):
        for directory in ['vendor', 'vendor/lexlean', 'vendor/lean4-prod',
                          'vendor/lean4-prod/rust', 'stdlib', 'stdlib/generated', 'stdlib/generated/package']:
            for name in ['config', 'config.toml']:
                with self.subTest(directory=directory, name=name):
                    path = self.source / directory / '.cargo' / name
                    self.put(path, b'[alias]\nfetch="fetch"\n')
                    with self.assertRaisesRegex(ValueError, 'configuration refused'):
                        self.prepare()
                    self.assertEqual(list(self.owner.iterdir()), [])
                    path.unlink()


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SupplementTest)
    deps.require(suite.countTestCases() == 22, "complete dependency test inventory required")
    result = unittest.TextTestRunner().run(suite)
    deps.require(result.wasSuccessful() and result.testsRun == 22 and not result.skipped,
                 "complete dependency tests must pass without skips")
    print(json.dumps({"tests": result.testsRun, "status": "passed"}))
