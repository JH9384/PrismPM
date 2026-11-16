"""Canonicalize build-owned Cargo Git caches without changing source or objects.

Run after the last Cargo acquisition and before hashing or copying the cache.
Refs, HEAD, config, checked-out source, submodules and Cargo's .cargo-ok markers
are retained. Reflogs and index stat data are disposable local cache metadata.
Object packs are rebuilt from the complete object set, never a reachable subset.
"""

import argparse
import errno
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def git(directory, *args, object_directory=None, input=None):
    environment = {"PATH": os.environ["PATH"], "LANG": "C", "LC_ALL": "C",
                   "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1",
                   "GIT_NO_REPLACE_OBJECTS": "1", "GIT_TERMINAL_PROMPT": "0"}
    if object_directory:
        environment["GIT_OBJECT_DIRECTORY"] = str(object_directory)
    return subprocess.run(["git", "--git-dir=" + str(directory), *args],
                          input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          env=environment, check=True).stdout


def object_ids(directory, object_directory=None):
    return sorted(git(directory, "cat-file", "--batch-all-objects", "--batch-check=%(objectname)",
                      object_directory=object_directory).splitlines())


def replace_objects(directory, staged, expected):
    objects = directory / "objects"
    # This backup lives outside the caller's staging cleanup so a failed
    # rollback leaves a complete recovery copy, even after an exception.
    recovery = Path(tempfile.mkdtemp(prefix=".prismpm-recovery-", dir=directory))
    backup = recovery / "original-objects"
    copied = False
    try:
        try:
            objects.rename(backup)
        except OSError as error:
            if error.errno != errno.EXDEV:
                raise
            # OverlayFS refuses renames of lower-layer directories. Copy and
            # verify before removing the original; never hide unrelated errors.
            shutil.copytree(objects, backup, symlinks=True)
            if object_ids(directory, backup) != expected:
                raise ValueError("backup changed the Git object set")
            copied = True
    except BaseException:
        shutil.rmtree(recovery)
        raise
    try:
        if copied:
            shutil.rmtree(objects)
        staged.rename(objects)
    except BaseException:
        try:
            if objects.exists():
                shutil.rmtree(objects)
            if copied:
                shutil.copytree(backup, objects, symlinks=True)
            else:
                backup.rename(objects)
        except BaseException as rollback_error:
            raise RuntimeError("Git object rollback failed; complete backup retained at "
                               + str(backup)) from rollback_error
        shutil.rmtree(recovery)
        raise
    shutil.rmtree(recovery)


def normalize_repository(directory):
    objects = directory / "objects"
    if directory.resolve() != directory or not directory.is_dir() or objects.is_symlink() or not objects.is_dir():
        raise ValueError("expected an owned Git directory and object store")
    alternates = objects / "info" / "alternates"
    if alternates.exists() and alternates.read_bytes().strip():
        raise ValueError("external Git object alternates are not a self-contained Cargo cache")
    checkout = directory.name == ".git"
    if checkout:
        # No source edits or staged substitutions may be hidden by rebuilding
        # the index. Untracked Cargo markers and generated files are untouched.
        git(directory, "--work-tree=" + str(directory.parent), "diff", "--quiet", "HEAD", "--")
        git(directory, "diff", "--cached", "--quiet", "HEAD", "--")
    before = object_ids(directory)
    with tempfile.TemporaryDirectory(prefix=".prismpm-objects-", dir=directory) as temporary:
        temporary = Path(temporary)
        staged = temporary / "objects"
        (staged / "pack").mkdir(parents=True)
        (staged / "info").mkdir()
        if before:
            pack = git(directory, "pack-objects", "--threads=1", "--window=10", "--depth=50",
                       "--compression=9", "--no-reuse-object", "--no-reuse-delta",
                       str(staged / "pack" / "pack"), input=b"\n".join(before) + b"\n").strip().decode()
            git(directory, "verify-pack", str(staged / "pack" / ("pack-" + pack + ".idx")))
            # Preserve support for dumb Git transport if the original cache
            # advertised packs, but never retain stale old pack filenames.
            if (objects / "info" / "packs").exists():
                (staged / "info" / "packs").write_text("P pack-" + pack + ".pack\n\n")
        if object_ids(directory, staged) != before:
            raise ValueError("canonical packing changed the Git object set")
        replace_objects(directory, staged, before)
        # The replacement retires obsolete pack acceleration indexes; every
        # original Git object survives in the verified canonical pack above.
    logs = directory / "logs"
    if logs.exists():
        if logs.is_symlink() or not logs.is_dir():
            raise ValueError("expected owned Git reflog directory")
        shutil.rmtree(logs)
    if checkout:
        # read-tree writes zeroed stat fields while retaining HEAD's complete
        # tracked entries and gitlinks. It does not rewrite working-tree bytes.
        index = directory / "index"
        if index.is_symlink():
            raise ValueError("expected owned Git index")
        if index.exists():
            index.unlink()
        git(directory, "-c", "index.version=2", "read-tree", "HEAD")


def normalize(cargo_home):
    root = Path(cargo_home).absolute()
    if root.resolve() != root or not root.is_dir():
        raise ValueError("expected an unaliased Cargo home")
    cache = root / "git"
    if not cache.exists():
        return 0
    if cache.is_symlink() or not cache.is_dir():
        raise ValueError("expected an owned Cargo Git cache")
    repositories = []
    database = cache / "db"
    if database.exists():
        repositories.extend(sorted(database.iterdir()))
    checkouts = cache / "checkouts"
    if checkouts.exists():
        for current, directories, files in os.walk(checkouts, followlinks=False):
            if ".git" in files:
                raise ValueError("Cargo Git checkout must have a self-contained Git directory")
            if ".git" in directories:
                directories.remove(".git")
                repositories.append(Path(current) / ".git")
    for directory in repositories:
        normalize_repository(directory)
    return len(repositories)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cargo_home")
    args = parser.parse_args()
    print("Canonicalized", normalize(args.cargo_home), "Cargo Git repositories")
