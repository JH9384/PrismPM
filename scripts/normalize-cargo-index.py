"""Canonicalize Cargo's sparse-index cache to the crates it actually holds.

Run after the last Cargo acquisition and before copying CARGO_HOME into an
image. A sparse index cache file records every version crates.io listed at
fetch time and the HTTP validator (ETag) of that response. Both change
whenever upstream publishes, so an image that kept them would differ from an
identical rebuild hours later. Offline Cargo needs only the entries for the
`.crate` archives present in `registry/cache`. Exactly those entries are kept,
in their original order and bytes, under one fixed index version.
"""

import argparse
import os
from pathlib import Path

CACHE_VERSION = 3
INDEX_FORMAT_VERSION = 2
FIXED_INDEX_VERSION = b"prismpm-normalized"
MAX_CACHE_BYTES = 64 * 1024 * 1024


def parse(raw):
    if len(raw) < 6 or raw[0] != CACHE_VERSION:
        raise ValueError("unsupported Cargo index cache version")
    if int.from_bytes(raw[1:5], "little") != INDEX_FORMAT_VERSION:
        raise ValueError("unsupported Cargo index format version")
    fields = raw[5:].split(b"\0")
    if len(fields) < 2 or fields[-1] != b"" or len(fields) % 2 != 0:
        raise ValueError("malformed Cargo index cache")
    index_version, rest = fields[0], fields[1:-1]
    return index_version, [(rest[i], rest[i + 1]) for i in range(0, len(rest), 2)]


def render(entries):
    body = b"".join(version + b"\0" + line + b"\0" for version, line in entries)
    return (bytes([CACHE_VERSION]) + INDEX_FORMAT_VERSION.to_bytes(4, "little")
            + FIXED_INDEX_VERSION + b"\0" + body)


def entry_name(line):
    # The index line is JSON whose first member is "name"; read only that key.
    prefix = b'{"name":"'
    if not line.startswith(prefix):
        raise ValueError("Cargo index line without a leading name")
    end = line.index(b'"', len(prefix))
    return line[len(prefix):end].decode("utf-8")


def normalize(cargo_home):
    registry = Path(cargo_home) / "registry"
    index_root = registry / "index"
    changed = 0
    if not index_root.is_dir():
        return changed
    for index in sorted(index_root.iterdir()):
        cache = index / ".cache"
        if index.is_symlink() or not cache.is_dir():
            continue
        archives = registry / "cache" / index.name
        for path in sorted(cache.rglob("*")):
            if path.is_symlink():
                raise ValueError("symlink in Cargo index cache: " + str(path))
            if not path.is_file():
                continue
            raw = path.read_bytes()
            if len(raw) > MAX_CACHE_BYTES:
                raise ValueError("Cargo index cache exceeds bound: " + str(path))
            _, entries = parse(raw)
            kept = [(version, line) for version, line in entries
                    if (archives / (entry_name(line) + "-" + version.decode("utf-8") + ".crate")).is_file()]
            if not kept:
                path.unlink()
                changed += 1
                continue
            normalized = render(kept)
            if normalized != raw:
                mode = path.stat().st_mode
                temporary = path.with_name(path.name + ".prismpm-normalize")
                temporary.write_bytes(normalized)
                os.chmod(temporary, mode & 0o7777)
                os.replace(temporary, path)
                changed += 1
        for directory in sorted((p for p in cache.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True):
            if not any(directory.iterdir()):
                directory.rmdir()
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cargo_home")
    arguments = parser.parse_args()
    print(f"normalized {normalize(arguments.cargo_home)} Cargo index cache files")


if __name__ == "__main__":
    main()
