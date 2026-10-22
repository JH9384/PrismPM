"""Data-only Cargo cache supplement for source review, never SDK acceptance."""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import tomllib

SOURCE = Path("/workspace")
BASE = Path("/opt/prismpm/cargo-home")
FETCH = Path("/tmp/prismpm-golden-fetch/cache")
OUTPUT = Path("/tmp/prismpm-dependency-supplement")
OWNER = Path("/tmp/prismpm-golden-state/cargo")
MANIFESTS = ("Cargo.toml", "vendor/lexlean/Cargo.toml",
             "vendor/lean4-prod/rust/Cargo.toml", "stdlib/generated/package/Cargo.toml")
REGISTRY = "index.crates.io-1949cf8c6b5b557f"
LIMIT = 256 * 1024 * 1024
TOTAL = 128 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def regular(path, limit=LIMIT):
    require(path.parent.resolve() == path.parent, "aliased cache parent")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1,
                "cache input must be a singly linked regular file")
        require(0 <= before.st_size <= limit, "cache file bound exceeded")
        data = bytearray()
        while len(data) <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        fields = ("st_dev", "st_ino", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
        require(len(data) == before.st_size and all(
            getattr(before, key) == getattr(observed, key)
            for observed in (after, path.lstat()) for key in fields),
                "cache input changed while reading")
        return bytes(data)
    finally:
        os.close(fd)


def inputs(source):
    require(source.resolve() == source, "aliased source root")
    rows = {}
    total = 0

    def capture(path):
        nonlocal total
        normalized = Path(os.path.abspath(path))
        require(normalized.is_relative_to(source) and normalized.resolve() == normalized,
                "aliased or escaping Cargo input")
        relative = normalized.relative_to(source).as_posix()
        require(relative in rows or len(rows) < 4096, "source manifest bound exceeded")
        data = regular(normalized, 8 * 1024 * 1024)
        total += len(data)
        require(total <= 32 * 1024 * 1024, "source manifest bound exceeded")
        rows[relative] = digest(data)
        return tomllib.loads(data.decode())

    # Follow the actual workspace/path-dependency graph, not unrelated oracle
    # fixtures or symlinked packaged documentation elsewhere in the checkout.
    pending = [source / relative for relative in MANIFESTS]
    seen = set()
    while pending:
        path = Path(os.path.abspath(pending.pop()))
        if path in seen:
            continue
        seen.add(path)
        document = capture(path)
        for ancestor in (path.parent, *path.parent.parents):
            if not ancestor.is_relative_to(source):
                break
            for name in ("config", "config.toml"):
                if ancestor == source and name == "config.toml":
                    continue
                require(not os.path.lexists(ancestor / ".cargo" / name),
                        "unexpected Cargo configuration refused")
        # Cargo permits inherited workspace dependencies/lints even when the
        # package was reached through a path edge rather than as a member.
        for ancestor in path.parent.parents:
            if not ancestor.is_relative_to(source):
                break
            candidate = ancestor / "Cargo.toml"
            if os.path.lexists(candidate):
                pending.append(candidate)
        explicit_workspace = document.get("package", {}).get("workspace")
        if explicit_workspace is not None:
            require(isinstance(explicit_workspace, str), "invalid explicit workspace")
            pending.append(path.parent / explicit_workspace / "Cargo.toml")
        lock = path.with_name("Cargo.lock")
        if os.path.lexists(lock):
            capture(lock)
        for pattern in document.get("workspace", {}).get("members", []):
            require(isinstance(pattern, str) and not Path(pattern).is_absolute() and
                    ".." not in Path(pattern).parts, "escaping workspace member")
            matches = sorted(path.parent.glob(pattern))
            require(matches, "missing workspace member")
            pending.extend(member / "Cargo.toml" for member in matches)

        def dependencies(value, context=()):
            if not isinstance(value, dict):
                return
            if "path" in value and any(key in {"dependencies", "dev-dependencies", "build-dependencies", "patch", "replace"}
                                       for key in context):
                require(isinstance(value["path"], str), "invalid dependency path")
                pending.append(path.parent / value["path"] / "Cargo.toml")
            for key, child in value.items():
                dependencies(child, context + (key,))
        dependencies(document)
    require(not os.path.lexists(source / "rust-toolchain"), "legacy toolchain selector needs review")
    if os.path.lexists(source / "rust-toolchain.toml"):
        capture(source / "rust-toolchain.toml")
    config_dir = source / ".cargo"
    if os.path.lexists(config_dir):
        require(config_dir.resolve() == config_dir, "aliased Cargo configuration directory")
        for path in config_dir.iterdir():
            require(path.name == "config.toml", "unreviewed Cargo configuration file")
            config = capture(path)
            require(set(config) <= {"alias"} and isinstance(config.get("alias", {}), dict) and
                    all(isinstance(value, str) for value in config.get("alias", {}).values()),
                    "source Cargo configuration needs explicit review")
    require(all(relative in rows and str(Path(relative).with_name("Cargo.lock")) in rows
                for relative in MANIFESTS), "selected workspace inputs missing")
    return rows


def locked(source):
    rows = {}
    root_hash = None
    for relative in MANIFESTS:
        raw = regular((source / relative).with_name("Cargo.lock"), 8 * 1024 * 1024)
        if relative == "Cargo.toml":
            root_hash = digest(raw)
        document = tomllib.loads(raw.decode("utf-8"))
        require(document.get("version") in {3, 4}, "unsupported Cargo lock")
        seen = set()
        for row in document["package"]:
            if "source" not in row:
                continue
            require(row["source"] == "registry+https://github.com/rust-lang/crates.io-index",
                    "only the canonical crates.io registry may be acquired")
            name, version, checksum = row["name"], row["version"], row["checksum"]
            require(re.fullmatch(r"[A-Za-z0-9_-]+", name) and
                    re.fullmatch(r"[A-Za-z0-9.+_-]+", version) and
                    re.fullmatch(r"[0-9a-f]{64}", checksum), "invalid locked crate identity")
            key = f"{name}-{version}.crate"
            require(key not in seen, "duplicate locked crate")
            seen.add(key)
            selected = {"name": name, "version": version, "checksum": checksum}
            require(key not in rows or rows[key] == selected,
                    "independent locked crate identities conflict")
            rows[key] = selected
    require(0 < len(rows) <= 4096, "locked crate count bound exceeded")
    return root_hash, rows


def index_path(name):
    name = name.lower()
    if len(name) <= 2:
        return f"{len(name)}/{name}"
    if len(name) == 3:
        return f"3/{name[0]}/{name}"
    return f"{name[:2]}/{name[2:4]}/{name}"


def validate_index(data, rows):
    require(data[:5] == b"\x03\x02\x00\x00\x00" and data.endswith(b"\0"),
            "unsupported pinned Cargo sparse index encoding")
    parts = data[5:].split(b"\0")
    require(parts[0].startswith(b"etag:") and len(parts) % 2 == 0,
            "invalid sparse index framing")
    versions = {}
    for version, raw in zip(parts[1:-1:2], parts[2:-1:2]):
        entry = json.loads(raw)
        require(entry["vers"].encode() == version and entry["vers"] not in versions,
                "duplicate or inconsistent sparse index version")
        versions[entry["vers"]] = entry
    for row in rows:
        entry = versions.get(row["version"])
        require(entry is not None and entry["name"] == row["name"] and
                entry["cksum"] == row["checksum"], "index differs from committed lock")


def optional(path):
    return regular(path) if os.path.lexists(path) else None


def supplement(source, base, fetched, output):
    lock_hash, crates = locked(source)
    captured = inputs(source)
    files = []
    total = 0
    selected = {}
    for filename, row in crates.items():
        relative = f"registry/cache/{REGISTRY}/{filename}"
        original = optional(base / relative)
        if original is not None:
            require(digest(original) == row["checksum"], "immutable seed conflicts with lock")
        else:
            data = regular(fetched / relative)
            require(digest(data) == row["checksum"], "downloaded crate checksum differs from lock")
            total += len(data)
            require(total <= TOTAL, "supplement byte bound exceeded")
            selected[relative] = data
    by_name = {}
    for row in crates.values():
        by_name.setdefault(row["name"], []).append(row)
    for name, rows in by_name.items():
        relative = f"registry/index/{REGISTRY}/.cache/{index_path(name)}"
        data = regular(fetched / relative, 8 * 1024 * 1024)
        validate_index(data, rows)
        if optional(base / relative) != data:
            total += len(data)
            require(total <= TOTAL, "supplement byte bound exceeded")
            selected[relative] = data
    for relative, data in sorted(selected.items()):
        original = optional(base / relative)
        path = output / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("xb") as stream:
            stream.write(data)
        files.append({"path": relative, "bytes": len(data), "sha256": digest(data),
                      "base_sha256": None if original is None else digest(original)})
    require(inputs(source) == captured, "source inputs changed during acquisition")
    receipt = {"schema": "prismpm/native-source-dependencies/1",
               "scope": "source-development-only", "lock_sha256": lock_hash,
               "inputs": captured, "files": files}
    raw = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode()
    require(len(raw) <= 4 * 1024 * 1024, "receipt bound exceeded")
    with (output / "preparation.json").open("xb") as stream:
        stream.write(raw)
    return receipt


def install(source, output, owner):
    raw = regular(output / "preparation.json", 4 * 1024 * 1024)
    receipt = json.loads(raw)
    require(set(receipt) == {"schema", "scope", "lock_sha256", "inputs", "files"},
            "unexpected receipt field")
    require(receipt["schema"] == "prismpm/native-source-dependencies/1" and
            receipt["scope"] == "source-development-only", "wrong supplement scope")
    lock_hash, crates = locked(source)
    require(receipt["lock_sha256"] == lock_hash and receipt["inputs"] == inputs(source),
            "supplement source identity differs")
    by_index = {}
    allowed = {}
    for filename, row in crates.items():
        allowed[f"registry/cache/{REGISTRY}/{filename}"] = row
        key = f"registry/index/{REGISTRY}/.cache/{index_path(row['name'])}"
        by_index.setdefault(key, []).append(row)
    require(isinstance(receipt["files"], list) and len(receipt["files"]) <= 8192,
            "supplement entry bound exceeded")
    expected = {"preparation.json"}
    total = 0
    pending = []
    for row in receipt["files"]:
        require(set(row) == {"path", "bytes", "sha256", "base_sha256"}, "unexpected entry field")
        relative = row["path"]
        require(relative in allowed or relative in by_index, "unlocked supplement path")
        require(relative not in expected, "duplicate supplement entry")
        expected.add(relative)
        data = regular(output / relative, 8 * 1024 * 1024 if relative in by_index else LIMIT)
        total += len(data)
        require(total <= TOTAL and len(data) == row["bytes"] and digest(data) == row["sha256"],
                "supplement content differs")
        if relative in allowed:
            require(digest(data) == allowed[relative]["checksum"], "archive differs from committed lock")
        else:
            validate_index(data, by_index[relative])
        previous = optional(owner / relative)
        require(row["base_sha256"] == (None if previous is None else digest(previous)),
                "supplement conflicts with image seed")
        pending.append((relative, data))
    observed = set()
    for directory, dirs, names in os.walk(output, followlinks=False):
        require(len(observed) + len(dirs) + len(names) <= 25000, "supplement tree bound exceeded")
        for name in dirs:
            path = Path(directory) / name
            require(not path.is_symlink(), "supplement directory alias")
        for name in names:
            path = Path(directory) / name
            require(stat.S_ISREG(path.lstat().st_mode), "supplement special file")
            observed.add(path.relative_to(output).as_posix())
    require(observed == expected, "supplement has unrecorded files")
    # Validate the entire handoff before changing any private owner input.
    for relative, data in pending:
        path = owner / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as stream:
            stream.write(data)
    return {"preparation_sha256": digest(raw), "preparation": receipt}


if __name__ == "__main__":
    require(len(sys.argv) == 2, "fixed private operation required")
    if sys.argv[1] == "prepare":
        before = inputs(SOURCE)
        locked(SOURCE)
        deadline = time.monotonic() + 600
        for relative in MANIFESTS:
            remaining = deadline - time.monotonic()
            require(remaining > 0, "complete Cargo acquisition deadline exceeded")
            subprocess.run(["cargo", "fetch", "--locked", "--manifest-path", str(SOURCE / relative)],
                           cwd=SOURCE, check=True, timeout=remaining)
            require(inputs(SOURCE) == before, "source changed during Cargo acquisition")
        require(inputs(SOURCE) == before, "source changed during Cargo acquisition")
        supplement(SOURCE, BASE, FETCH, OUTPUT)
    else:
        require(sys.argv[1] == "install", "unknown private operation")
        print(json.dumps(install(SOURCE, OUTPUT, OWNER), sort_keys=True, separators=(",", ":")))
