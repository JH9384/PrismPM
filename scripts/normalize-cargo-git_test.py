"""Real Git/Cargo regression for reproducible, fully offline source caches."""

import errno
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess
import struct
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("normalizer", Path(__file__).with_name("normalize-cargo-git.py"))
normalizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normalizer)


def files(root):
    return {str(path.relative_to(root)): (path.stat().st_mode & 0o777,
            hashlib.sha256(path.read_bytes()).hexdigest())
            for path in sorted(root.rglob("*")) if path.is_file()}


class CargoGitTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(prefix="prism-cargo-git-")
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.environment = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1",
                                GIT_AUTHOR_NAME="Cache fixture", GIT_AUTHOR_EMAIL="fixture@example.invalid",
                                GIT_COMMITTER_NAME="Cache fixture", GIT_COMMITTER_EMAIL="fixture@example.invalid",
                                GIT_AUTHOR_DATE="2020-01-01T00:00:00Z", GIT_COMMITTER_DATE="2020-01-01T00:00:00Z",
                                CARGO_NET_GIT_FETCH_WITH_CLI="true", CARGO_NET_OFFLINE="true")
        self.project = self.root / "project"
        self.project.mkdir()
        (self.project / "src").mkdir()
        (self.project / "src/main.rs").write_text('fn main() { assert_eq!(cache_fixture::answer(), "42"); println!("42"); }\n')

    def command(self, *args, cwd=None, cargo_home=None, input=None):
        environment = dict(self.environment)
        if cargo_home:
            environment["CARGO_HOME"] = str(cargo_home)
        result = subprocess.run(args, cwd=cwd or self.root, env=environment, input=input,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def repository(self, name):
        directory = self.root / name
        directory.mkdir()
        self.command("git", "init", "--quiet", "--initial-branch=master", str(directory))
        return directory

    def commit(self, root):
        self.command("git", "add", ".", cwd=root)
        self.command("git", "commit", "--quiet", "-m", "fixture", cwd=root)
        return self.command("git", "rev-parse", "HEAD", cwd=root)

    def test_cache_bytes_match_and_locked_offline_cargo_keeps_git_and_submodule_sources(self):
        nested = self.repository("nested")
        (nested / "value.txt").write_text("42")
        nested_revision = self.commit(nested)
        upstream = self.repository("upstream")
        (upstream / "src").mkdir()
        (upstream / "Cargo.toml").write_text('[package]\nname="cache-fixture"\nversion="0.1.0"\nedition="2021"\n')
        (upstream / "src/lib.rs").write_text('pub fn answer() -> &\'static str { include_str!("../vendor/nested/value.txt") }\n')
        self.command("git", "-c", "protocol.file.allow=always", "submodule", "add", "--quiet", nested.as_uri(), "vendor/nested", cwd=upstream)
        (upstream / "history.txt").write_text("similar historical source\n" * 4000)
        self.commit(upstream)
        (upstream / "history.txt").write_text("similar historical source\n" * 3999 + "changed\n")
        revision = self.commit(upstream)
        (self.project / "Cargo.toml").write_text('[package]\nname="cache-consumer"\nversion="0.1.0"\nedition="2021"\n'
            + '[dependencies]\ncache-fixture={git="' + upstream.as_uri() + '",rev="' + revision + '"}\n')
        live = self.root / "live-cargo-home"
        # Offline CI defaults must not prevent acquiring our file:// fixtures.
        # Only these two local acquisition calls opt out; the proof below keeps
        # --locked --offline and runs after both source remotes are removed.
        self.command("cargo", "generate-lockfile", "--config", "net.offline=false", cwd=self.project, cargo_home=live)
        self.command("cargo", "fetch", "--locked", "--config", "net.offline=false", cwd=self.project, cargo_home=live)
        live_stores = list((live / "git/db").iterdir()) + list((live / "git/checkouts").rglob(".git"))
        dangling = []
        for store in live_stores:
            dangling.append(self.command("git", "--git-dir=" + str(store), "hash-object", "-w", "--stdin",
                                         input="a dangling object that must survive canonical packing\n"))
        homes = [self.root / "a", self.root / "b"]
        for home in homes:
            shutil.copytree(live, home)
        shutil.rmtree(live)
        repositories = []
        original_sources = []
        for number, home in enumerate(homes):
            stores = list((home / "git/db").iterdir()) + list((home / "git/checkouts").rglob(".git"))
            repositories.append(stores)
            for store in stores:
                self.command("git", "--git-dir=" + str(store), "repack", "-a", "-d", "-f", "--window=" + str(number * 20))
                # Reflog identities/times and existing index stat fields differ
                # without changing any committed source or object identity.
                for log in (store / "logs").rglob("*") if (store / "logs").exists() else []:
                    if log.is_file():
                        log.write_text(re.sub(r" [0-9]+ [+-][0-9]{4}\t", " " + str(1700000000 + number) + " +0000\t", log.read_text()))
            original_sources.append({path: row for path, row in files(home / "git/checkouts").items()
                                     if "/.git/" not in path})
        self.assertNotEqual(files(homes[0] / "git"), files(homes[1] / "git"), "test must start with differing cache encoding")
        original_objects = [[normalizer.object_ids(store) for store in stores] for stores in repositories]
        original_refs = [[normalizer.git(store, "for-each-ref") for store in stores] for stores in repositories]
        for objects in original_objects:
            for ids, dangling_id in zip(objects, dangling):
                self.assertIn(dangling_id.encode(), ids)
        for number, home in enumerate(homes):
            original_rename = Path.rename
            def overlay_rename(path, destination):
                if number == 1 and path.name == "objects" and Path(destination).name == "original-objects":
                    raise OSError(errno.EXDEV, "Invalid cross-device link")
                return original_rename(path, destination)
            with mock.patch.object(Path, "rename", overlay_rename):
                self.assertGreaterEqual(normalizer.normalize(home), 3, "include bare DB, checkout and nested submodule")
            self.assertFalse(list(home.rglob(".prismpm-recovery-*")))
            self.assertEqual([normalizer.object_ids(store) for store in repositories[number]], original_objects[number])
            self.assertEqual([normalizer.git(store, "for-each-ref") for store in repositories[number]], original_refs[number])
            self.assertEqual({path: row for path, row in files(home / "git/checkouts").items()
                              if "/.git/" not in path}, original_sources[number])
            for store in repositories[number]:
                if store.name != ".git":
                    continue
                index = (store / "index").read_bytes()
                self.assertEqual(index[:8], b"DIRC\x00\x00\x00\x02")
                self.assertEqual(hashlib.sha1(index[:-20]).digest(), index[-20:])
                offset = 12
                for _ in range(struct.unpack(">I", index[8:12])[0]):
                    fields = struct.unpack(">10I", index[offset:offset + 40])
                    self.assertEqual(fields[:6] + fields[7:], (0,) * 9)
                    self.assertIn(fields[6], (0o100644, 0o100755, 0o120000, 0o160000))
                    length = index.index(b"\x00", offset + 62) - offset + 1
                    offset += (length + 7) // 8 * 8
        self.assertEqual(files(homes[0] / "git"), files(homes[1] / "git"))
        before = files(homes[0] / "git")
        normalizer.normalize(homes[0])
        self.assertEqual(files(homes[0] / "git"), before, "normalization is idempotent")
        self.assertTrue(any(path.endswith(".cargo-ok") for path in before), "retain Cargo checkout-completion markers")
        # The source remotes are unavailable, not merely avoided by a mock.
        upstream.rename(self.root / "unavailable-upstream")
        nested.rename(self.root / "unavailable-nested")
        for number, home in enumerate(homes):
            self.assertEqual(self.command("cargo", "run", "--locked", "--offline", "--quiet",
                "--target-dir", str(self.root / ("target-" + str(number))), cwd=self.project, cargo_home=home), "42")
            for store in repositories[number]:
                self.command("git", "--git-dir=" + str(store), "fsck", "--full", "--no-reflogs")
            checkout = next((home / "git/checkouts").glob("*/*"))
            self.assertEqual(self.command("git", "rev-parse", "HEAD", cwd=checkout), revision)
            self.assertEqual(self.command("git", "rev-parse", "HEAD", cwd=checkout / "vendor/nested"), nested_revision)

    def test_overlay_install_failure_restores_objects_and_retains_backup_if_rollback_fails(self):
        for rollback_fails in (False, True):
            with self.subTest(rollback_fails=rollback_fails):
                repo = self.repository("rollback-" + str(rollback_fails))
                (repo / "source").write_text("source preserved")
                self.commit(repo)
                directory = repo / ".git"
                before = files(directory / "objects")
                ids = normalizer.object_ids(directory)
                rename = Path.rename
                copytree = shutil.copytree
                def failing_rename(path, destination):
                    if path == directory / "objects":
                        raise OSError(errno.EXDEV, "Invalid cross-device link")
                    if Path(destination) == directory / "objects":
                        raise OSError(errno.EIO, "injected install failure")
                    return rename(path, destination)
                def failing_copytree(source, destination, *args, **kwargs):
                    if rollback_fails and Path(destination) == directory / "objects":
                        raise OSError(errno.EIO, "injected rollback failure")
                    return copytree(source, destination, *args, **kwargs)
                with mock.patch.object(Path, "rename", failing_rename), mock.patch.object(shutil, "copytree", failing_copytree):
                    with self.assertRaises(RuntimeError if rollback_fails else OSError):
                        normalizer.normalize_repository(directory)
                self.assertEqual((repo / "source").read_text(), "source preserved")
                if rollback_fails:
                    recovery, = directory.glob(".prismpm-recovery-*/original-objects")
                    self.assertEqual(files(recovery), before)
                    self.assertEqual(normalizer.object_ids(directory, recovery), ids)
                else:
                    self.assertEqual(files(directory / "objects"), before)
                    self.assertEqual(normalizer.object_ids(directory), ids)
                    self.assertFalse(list(directory.glob(".prismpm-recovery-*")))

    def test_non_overlay_rename_error_does_not_replace_objects(self):
        repo = self.repository("permission-error")
        (repo / "source").write_text("source preserved")
        self.commit(repo)
        before = files(repo)
        with mock.patch.object(Path, "rename", side_effect=OSError(errno.EACCES, "injected permission error")):
            with self.assertRaises(OSError) as raised:
                normalizer.normalize_repository(repo / ".git")
        self.assertEqual(raised.exception.errno, errno.EACCES)
        self.assertEqual(files(repo), before)

    def test_absent_git_cache_is_valid_and_aliases_are_refused(self):
        home = self.root / "home"
        home.mkdir()
        self.assertEqual(normalizer.normalize(home), 0)
        external = self.root / "external"
        external.mkdir()
        (home / "git").symlink_to(external, target_is_directory=True)
        with self.assertRaises(ValueError):
            normalizer.normalize(home)

    def test_dirty_checkout_cannot_be_reset_by_normalization(self):
        home = self.root / "home"
        checkout = home / "git/checkouts/local/revision"
        checkout.mkdir(parents=True)
        self.command("git", "init", "--quiet", str(checkout))
        (checkout / "source").write_text("committed bytes\n")
        self.commit(checkout)
        (checkout / "source").write_text("unstaged bytes\n")
        before = files(checkout)
        with self.assertRaises(subprocess.CalledProcessError):
            normalizer.normalize(home)
        self.assertEqual(files(checkout), before)


if __name__ == "__main__":
    unittest.main()
