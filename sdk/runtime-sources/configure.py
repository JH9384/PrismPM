"""Internal native SDK APT-source admission; not SDK or application acceptance."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


SNAPSHOT = "https://snapshot.ubuntu.com/ubuntu/20260901T000000Z/"
LOCK_SHA256 = "22cb82bbc6142c670dfc2b21b225d01edcd036c4e870ef4b668c9e3efa8bb6f1"
LEGACY_SHA256 = "8ce6407d5487bed332b5fcb4aab26dacf3f516d811c26792efb0c67f06f1958b"
KEYRING = "/usr/share/keyrings/ubuntu-archive-keyring.gpg"
FIELDS = ("st_dev", "st_ino", "st_mode", "st_size", "st_uid", "st_gid",
          "st_nlink", "st_mtime_ns", "st_ctime_ns")
PRIMARY = ("noble", "noble-updates", "noble-backports")
COMPONENTS = ("main", "restricted", "universe", "multiverse")
BASE_URIS = {
    "amd64": ("http://azure.archive.ubuntu.com/ubuntu/", "http://security.ubuntu.com/ubuntu/"),
    "arm64": ("http://azure.ports.ubuntu.com/ubuntu-ports/", "http://azure.ports.ubuntu.com/ubuntu-ports/"),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def retire_all(actions):
    primary = sys.exception()
    failures = []
    for action, label in actions:
        try:
            action()
        except BaseException as cleanup:
            failures.append((cleanup, label))
    if primary is not None:
        for cleanup, label in failures:
            primary.add_note(label+": "+str(cleanup))
    elif failures:
        first = failures[0][0]
        for cleanup, label in failures[1:]:
            first.add_note(label+": "+str(cleanup))
        raise first


def identity(value):
    return tuple(getattr(value, field) for field in FIELDS)


class HeldFile:
    def __init__(self, path, maximum, owner):
        self.path = Path(path)
        require(self.path.is_absolute() and self.path.resolve(strict=True) == self.path,
                "unaliased absolute input required")
        self.fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            value = os.fstat(self.fd)
            require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1
                    and value.st_uid == owner and value.st_mode & 0o022 == 0
                    and 0 <= value.st_size <= maximum, "unsafe input kind, alias, owner, mode or size")
            self.before = identity(value)
            chunks = []; remaining = value.st_size
            while remaining:
                block = os.read(self.fd, min(remaining, 65536))
                require(bool(block), "short input")
                chunks.append(block); remaining -= len(block)
            require(not os.read(self.fd, 1), "input grew")
            self.data = b"".join(chunks)
            self.verify()
        except BaseException:
            retire_all([(lambda: os.close(self.fd), "Input descriptor retirement uncertain")])
            raise

    def verify(self):
        require(self.path.resolve(strict=True) == self.path
                and identity(os.fstat(self.fd)) == self.before
                and identity(self.path.lstat()) == self.before, "held input changed")

    def close(self):
        os.close(self.fd)


def parse_document(raw):
    require(0 < len(raw) <= 65536 and b"\r" not in raw and b"\0" not in raw
            and raw.endswith(b"\n"), "bounded LF source document required")
    require(all(value in (9, 10) or 32 <= value < 127 for value in raw),
            "unexpected source control or non-ASCII byte")
    text = raw.decode("ascii")
    rows = []; current = {}; spans = []; offset = 0
    for line in text.splitlines(keepends=True):
        content = line[:-1]
        if not content.strip():
            if current:
                rows.append(current); current = {}
        elif content.startswith("#"):
            pass
        else:
            match = re.fullmatch(r"([A-Za-z][A-Za-z-]*):[ \t]+([^\n]+)", content)
            require(match is not None, "unrecognized deb822 line or continuation")
            name, value = match.groups(); key = name.lower()
            require(key not in current, "duplicate deb822 field")
            require(value == value.strip() and not re.search(r"[\x00-\x1f\x7f]", value),
                    "unsafe deb822 value")
            current[key] = value
            if key == "uris":
                spans.append((offset+match.start(2), offset+match.end(2)))
        offset += len(line)
    if current:
        rows.append(current)
    require(len(rows) == 2 and len(spans) == 2, "exactly two source stanzas required")
    return rows, spans


def admit_document(raw, architecture, *, snapshot):
    require(architecture in BASE_URIS, "unsupported native architecture")
    rows, spans = parse_document(raw)
    for index, row in enumerate(rows):
        require(set(row) == {"types", "uris", "suites", "components", "signed-by"},
                "unknown or missing source field")
        require(row["types"] == "deb" and row["signed-by"] == KEYRING,
                "wrong source type or signing key")
        suites = PRIMARY if index == 0 else ("noble-security",)
        selected = row["suites"].split(" ")
        require(len(selected) == len(suites) and set(selected) == set(suites),
                "wrong or duplicate source pockets")
        components = row["components"].split(" ")
        require(len(components) == 4 and set(components) == set(COMPONENTS),
                "wrong or duplicate source components")
        uri = SNAPSHOT if snapshot else BASE_URIS[architecture][index]
        allowed = (uri,) if snapshot else (uri, uri.rstrip("/"))
        require(row["uris"] in allowed,
                "unrecognized, duplicate, foreign-native or floating source URI")
    return rows, spans


def rewrite(raw, architecture):
    _, spans = admit_document(raw, architecture, snapshot=False)
    result = raw
    for start, end in reversed(spans):
        result = result[:start]+SNAPSHOT.encode()+result[end:]
    admit_document(result, architecture, snapshot=True)
    # The two URI values, and no comments or other fields, are replaced.
    pieces = []; at = 0
    for start, end in spans:
        pieces.extend((raw[at:start], SNAPSHOT.encode())); at = end
    pieces.append(raw[at:])
    require(result == b"".join(pieces), "non-URI source modification")
    return result


def admit_architecture(requested, native, foreign):
    require(requested in BASE_URIS and native == requested and foreign == b"",
            "TARGETARCH must equal the sole native dpkg architecture")


def native_architecture():
    def invoke(option):
        result = subprocess.run(["/usr/bin/dpkg", option], stdin=subprocess.DEVNULL,
            capture_output=True, timeout=10, env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})
        require(result.returncode == 0 and result.stderr == b"" and len(result.stdout) <= 128,
                "native dpkg architecture query failed")
        return result.stdout
    raw = invoke("--print-architecture")
    require(raw in (b"amd64\n", b"arm64\n"), "unrecognized native dpkg architecture")
    return raw.decode().strip(), invoke("--print-foreign-architectures")


def directory(path, owner):
    require(path.is_absolute() and path.resolve(strict=True) == path, "unaliased source directory required")
    value = path.lstat()
    require(stat.S_ISDIR(value.st_mode) and value.st_uid == owner and value.st_mode & 0o022 == 0,
            "unsafe source directory")
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        require(identity(os.fstat(fd)) == identity(value), "source directory changed")
    except BaseException:
        retire_all([(lambda: os.close(fd), "Directory descriptor retirement uncertain")])
        raise
    return fd


def members(fd):
    result = set()
    with os.scandir(fd) as entries:
        for entry in entries:
            require(len(result) < 3, "source entry bound exceeded")
            result.add(entry.name)
    return result


def configure(apt, lock, architecture, snapshot, phase, fixture_root, *, owner,
              keyring=Path(KEYRING)):
    require(snapshot == SNAPSHOT and architecture in BASE_URIS and phase in ("prepare", "verify"),
            "wrong snapshot, native architecture or admission phase")
    apt = Path(apt); parts = apt/"sources.list.d"
    apt_fd = directory(apt, owner); parts_fd = None; held = []; temporary = None; node_sha256 = None
    try:
        parts_fd = directory(parts, owner)
        legacy = HeldFile(apt/"sources.list", 65536, owner); held.append(legacy)
        require(hashlib.sha256(legacy.data).hexdigest() == LEGACY_SHA256
                and all(not line.strip() or line.startswith(b"#") for line in legacy.data.splitlines()),
                "unrecognized or active legacy source list")
        expected = {"ubuntu.sources", "nodesource.list"} if phase == "prepare" else {"ubuntu.sources"}
        require(members(parts_fd) == expected, "unknown, missing or extra source entry")
        for name in sorted(expected):
            held.append(HeldFile(parts/name, 65536, owner))
        source = next(item for item in held if item.path.name == "ubuntu.sources")
        pinned = HeldFile(lock, 65536, owner); held.append(pinned)
        require(hashlib.sha256(pinned.data).hexdigest() == LOCK_SHA256, "runtime source lock changed")
        ring = HeldFile(keyring, 1024*1024, owner); held.append(ring)
        require(bool(ring.data), "empty signing keyring")
        if phase == "prepare":
            actual_node = next(item for item in held if item.path.name == "nodesource.list")
            expected_node = HeldFile(Path(fixture_root)/(architecture+".nodesource.list"), 65536, owner)
            held.append(expected_node)
            require(actual_node.data == expected_node.data and bool(expected_node.data),
                    "unrecognized native-base NodeSource entry")
            node_sha256 = hashlib.sha256(actual_node.data).hexdigest()
            updated = rewrite(source.data, architecture)
            fd, name = tempfile.mkstemp(prefix=".prismpm-ubuntu-sources-", dir=parts)
            temporary = Path(name)
            with os.fdopen(fd, "wb") as output:
                require(output.write(updated) == len(updated), "short source write")
                output.flush()
                os.fchmod(output.fileno(), stat.S_IMODE(source.before[2]))
                os.fsync(output.fileno())
            for item in held:
                item.verify()
            require(members(parts_fd) == expected | {temporary.name}, "source namespace changed")
            os.replace(temporary.name, "ubuntu.sources", src_dir_fd=parts_fd, dst_dir_fd=parts_fd)
            temporary = None; os.fsync(parts_fd)
            after = HeldFile(parts/"ubuntu.sources", 65536, owner)
            try:
                require(after.data == updated, "rewritten source changed")
                admit_document(after.data, architecture, snapshot=True); after.verify()
            finally:
                retire_all([(after.close, "Rewritten source descriptor retirement uncertain")])
            for item in held:
                if item is not source:
                    item.verify()
        else:
            admit_document(source.data, architecture, snapshot=True)
            for item in held:
                item.verify()
        require(members(parts_fd) == expected, "source closure changed")
        require(os.path.samestat(os.fstat(apt_fd), apt.lstat())
                and os.path.samestat(os.fstat(parts_fd), parts.lstat()), "source directory identity changed")
        for path in (apt, parts):
            check = directory(path, owner)
            os.close(check)
        return {"architecture": architecture, "phase": phase, "snapshot": SNAPSHOT,
                "before_source_sha256": hashlib.sha256(source.data).hexdigest(),
                "source_sha256": hashlib.sha256(updated if phase == "prepare" else source.data).hexdigest(),
                "keyring_sha256": hashlib.sha256(ring.data).hexdigest(),
                "legacy_source_sha256": LEGACY_SHA256,
                "runtime_lock_sha256": LOCK_SHA256, "base_nodesource_sha256": node_sha256}
    finally:
        actions = []
        if temporary is not None:
            actions.append((temporary.unlink, "Source stage retirement uncertain"))
        for item in reversed(held):
            actions.append((item.close, "Input descriptor retirement uncertain"))
        if parts_fd is not None:
            actions.append((lambda: os.close(parts_fd), "Source-parts descriptor retirement uncertain"))
        actions.append((lambda: os.close(apt_fd), "APT directory descriptor retirement uncertain"))
        retire_all(actions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "verify"))
    parser.add_argument("--architecture", choices=tuple(BASE_URIS), required=True)
    parser.add_argument("--snapshot", required=True)
    args = parser.parse_args()
    require(os.getuid() == 0, "serialized root SDK image construction required")
    require(not any(name in os.environ for name in ("APT_CONFIG", "DPKG_ADMINDIR", "DPKG_ROOT")),
            "ambient package-state redirection refused")
    native, foreign = native_architecture()
    admit_architecture(args.architecture, native, foreign)
    print(json.dumps(configure(Path("/etc/apt"), Path("/tmp/prismpm-runtime-os.lock"),
        args.architecture, args.snapshot, args.phase, Path(__file__).resolve().with_name("fixtures"), owner=0),
        sort_keys=True))


if __name__ == "__main__":
    main()
