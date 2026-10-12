"""Internal browser-input acquisition; never an application/oracle verdict."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import zipfile


LOCK_SHA256 = "331555b57a45b264327ec4f034c189f64e20956b630a2d6b9053e767bbb53e90"
MAX_ARCHIVE = 192 * 1024 * 1024
MAX_FILE = 256 * 1024 * 1024
MAX_TREE = 512 * 1024 * 1024
MAX_MEMBERS = 512
FIELDS = ("st_dev", "st_ino", "st_mode", "st_nlink", "st_uid", "st_gid",
          "st_size", "st_mtime_ns", "st_ctime_ns")


def retire(action, label):
    """Attempt every retirement without replacing the first actual failure."""
    primary = sys.exception()
    try:
        action()
    except BaseException as cleanup:
        if primary is None:
            raise
        primary.add_note(label + ": " + str(cleanup))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(metadata):
    return tuple(getattr(metadata, field) for field in FIELDS)


class HeldFile:
    def __init__(self, path, maximum):
        self.path = Path(path)
        require(self.path.is_absolute() and self.path.resolve(strict=True) == self.path,
                "unaliased absolute input required")
        self.fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            value = os.fstat(self.fd)
            require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1
                    and 0 <= value.st_size <= maximum, "bounded singly linked file required")
            self.before = identity(value)
            self.verify()
        except BaseException:
            retire(lambda: os.close(self.fd), "Input descriptor retirement uncertain")
            raise

    def verify(self):
        require(self.path.resolve(strict=True) == self.path, "input alias changed")
        require(identity(os.fstat(self.fd)) == self.before
                and identity(self.path.lstat()) == self.before, "held input changed")

    def digest(self):
        result = hashlib.sha256()
        os.lseek(self.fd, 0, os.SEEK_SET)
        count = 0
        while block := os.read(self.fd, 65536):
            count += len(block)
            require(count <= self.before[6], "held input grew")
            result.update(block)
        require(count == self.before[6], "held input shortened")
        self.verify()
        return result.hexdigest()

    def close(self):
        os.close(self.fd)

    def snapshot(self):
        # The ZIP parser receives immutable, bounded bytes, not a pathname or
        # descriptor another writer could grow between admission and parsing.
        os.lseek(self.fd, 0, os.SEEK_SET)
        chunks = []
        count = 0
        while block := os.read(self.fd, min(65536, self.before[6] - count + 1)):
            count += len(block)
            require(count <= self.before[6], "held input grew")
            chunks.append(block)
        require(count == self.before[6], "held input shortened")
        self.verify()
        return b"".join(chunks)


def load_authority():
    held = HeldFile(Path(__file__).resolve().with_name("authority.json"), 512 * 1024)
    try:
        require(held.digest() == LOCK_SHA256, "browser authority changed")
        os.lseek(held.fd, 0, os.SEEK_SET)
        raw = os.read(held.fd, held.before[6] + 1)
        require(len(raw) == held.before[6], "authority read shortened")
        held.verify()
        lock = json.loads(raw)
        require(lock["schema"] == "prismpm/chromium-headless-input/1"
                and lock["version"] == "157.0.8099.0"
                and lock["channel"] == "Canary", "wrong browser input profile")
        return lock
    finally:
        retire(held.close, "Authority descriptor retirement uncertain")


def member_path(name, root):
    parts = name.split("/")
    require(name and len(name.encode("utf-8")) <= 1024 and len(parts) <= 16
            and parts[0] == root and len(parts) >= 2
            and all(part and part not in (".", "..") for part in parts)
            and "\\" not in name and "\0" not in name
            and all(ord(character) >= 32 for character in name), "unsafe ZIP member path")
    return parts


def declared_members(authority):
    rows = authority["files"]
    require(0 < len(rows) <= MAX_MEMBERS
            and len(rows) == authority["archive_member_count"], "wrong member count")
    names = [row["path"] for row in rows]
    require(names == sorted(set(names)), "closed sorted unique member inventory required")
    for row in rows:
        require(set(row) == {"path", "bytes", "sha256", "mode"}, "unknown member field")
        member_path(row["path"], authority["archive_root"])
        require(type(row["bytes"]) is int and 0 <= row["bytes"] <= MAX_FILE
                and stat.S_ISREG(row["mode"]), "invalid regular member commitment")
        require(len(row["sha256"]) == 64
                and all(c in "0123456789abcdef" for c in row["sha256"]), "bad member hash")
    total = sum(row["bytes"] for row in rows)
    require(total == authority["expanded_bytes"] and total <= MAX_TREE, "expanded input bound")
    return rows


def admit_zip(raw, authority):
    """Bound the closed classic-ZIP index before ZipFile eagerly parses it."""
    rows = declared_members(authority)
    require(len(raw) >= 22, "not a zip file")
    end = struct.unpack_from("<4s4H2IH", raw, len(raw) - 22)
    require(end[0] == b"PK\x05\x06" and end[1:3] == (0, 0)
            and end[3] == end[4] == len(rows) and end[7] == 0,
            "ZIP end record differs; multipart, ZIP64, comments and trailing bytes refused")
    size, offset = end[5:7]
    require(size <= MAX_MEMBERS * (46 + 1024 + 4096 + 1024)
            and offset + size == len(raw) - 22, "ZIP central directory bound")
    expected = {row["path"]: row for row in rows}
    found = set()
    spans = []
    cursor = offset
    for _ in rows:
        require(cursor + 46 <= offset + size, "short ZIP central header")
        header = struct.unpack_from("<4s6H3I5H2I", raw, cursor)
        name_size, extra_size, comment_size = header[10:13]
        require(header[0] == b"PK\x01\x02" and 0 < name_size <= 1024
                and extra_size <= 4096 and comment_size <= 1024
                and cursor + 46 + name_size + extra_size + comment_size <= offset + size,
                "ZIP central record bound")
        name = raw[cursor + 46:cursor + 46 + name_size].decode("utf-8")
        member_path(name, authority["archive_root"])
        require(name in expected and name not in found, "ZIP central members differ")
        row = expected[name]
        require(header[1] >> 8 == 3 and header[3] & ~0x804 == 0
                and header[4] in (0, 8) and header[9] == row["bytes"]
                and header[13] == 0 and header[15] >> 16 == row["mode"],
                "ZIP central metadata differs")
        local_offset = header[16]
        require(local_offset + 30 <= offset, "ZIP local header bound")
        local = struct.unpack_from("<4s5H3I2H", raw, local_offset)
        local_name_size, local_extra_size = local[9:11]
        data_offset = local_offset + 30 + local_name_size + local_extra_size
        require(local[0] == b"PK\x03\x04" and local_name_size == name_size
                and local_extra_size <= 4096 and data_offset <= offset
                and local[1:4] == header[2:5] and local[6:9] == header[7:10]
                and raw[local_offset + 30:local_offset + 30 + local_name_size]
                == raw[cursor + 46:cursor + 46 + name_size]
                and data_offset + header[8] <= offset, "ZIP local record differs")
        spans.append((local_offset, data_offset + header[8]))
        found.add(name)
        cursor += 46 + name_size + extra_size + comment_size
    require(cursor == offset + size and found == set(expected), "ZIP central extent differs")
    cursor = 0
    for start, finish in sorted(spans):
        require(start == cursor and finish >= start, "ZIP member extents overlap or have gaps")
        cursor = finish
    require(cursor == offset, "ZIP local extent differs")


def scan(archive, authority, stage=None):
    rows = declared_members(authority)
    infos = archive.infolist()
    require(len(infos) == len(rows), "ZIP member inventory changed")
    by_name = {}
    for info in infos:
        member_path(info.filename, authority["archive_root"])
        require(info.filename == info.orig_filename and info.filename not in by_name
                and not info.is_dir() and not info.flag_bits & 1
                and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                and info.create_system == 3
                and stat.S_ISREG(info.external_attr >> 16), "unsafe ZIP member metadata")
        by_name[info.filename] = info
    require(sorted(by_name) == [row["path"] for row in rows], "ZIP members differ")
    tree = hashlib.sha256()
    total = 0
    for row in rows:
        info = by_name[row["path"]]
        require(info.file_size == row["bytes"] and info.external_attr >> 16 == row["mode"],
                "ZIP member commitment changed")
        label = row["path"].encode("utf-8")
        tree.update(struct.pack(">Q", len(label)))
        tree.update(label)
        tree.update(struct.pack(">Q", row["bytes"]))
        digest = hashlib.sha256()
        fd = None
        if stage is not None:
            destination = stage.joinpath(*member_path(row["path"], authority["archive_root"]))
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o600)
        try:
            count = 0
            with archive.open(info) as stream:
                while block := stream.read(65536):
                    count += len(block)
                    total += len(block)
                    require(count <= row["bytes"] and total <= MAX_TREE, "ZIP expansion excess")
                    digest.update(block)
                    tree.update(block)
                    if fd is not None:
                        view = memoryview(block)
                        while view:
                            written = os.write(fd, view)
                            require(written > 0, "short member write")
                            view = view[written:]
            require(count == row["bytes"] and digest.hexdigest() == row["sha256"],
                    "ZIP member content changed")
        finally:
            if fd is not None:
                retire(lambda: os.close(fd), "Member descriptor retirement uncertain")
        if stage is not None:
            destination.chmod(0o555 if row["mode"] & 0o111 else 0o444)
    require(total == authority["expanded_bytes"]
            and tree.hexdigest() == authority["tree_sha256"], "installed-tree authority differs")


def bounded_names(path, expected):
    names = set()
    with os.scandir(path) as entries:
        for entry in entries:
            require(entry.name in expected and entry.name not in names,
                    "installed directory inventory differs")
            names.add(entry.name)
    require(names == expected, "installed directory inventory differs")
    return names


def verify_tree(root, authority, sealed=True):
    rows = declared_members(authority)
    expected_directories = {"."}
    children = {}
    for row in rows:
        path = Path(row["path"])
        children.setdefault(path.parent.as_posix(), set()).add(path.name)
        parent = Path(row["path"]).parent
        while parent.as_posix() != ".":
            expected_directories.add(parent.as_posix())
            children.setdefault(parent.parent.as_posix(), set()).add(parent.name)
            parent = parent.parent
    directory_captures = []
    directories = []
    for name in sorted(expected_directories):
        current = root / name
        metadata = current.lstat()
        require(current.resolve(strict=True) == current and stat.S_ISDIR(metadata.st_mode),
                "installed directory alias")
        directories.append(current)
        directory_captures.append((current, identity(metadata),
                                   bounded_names(current, children.get(name, set()))))
    if sealed:
        require(all(stat.S_IMODE(before[2]) == 0o555 for _, before, _ in directory_captures),
                "installed directory mode differs")
    tree = hashlib.sha256()
    file_captures = []
    for row in authority["files"]:
        held = HeldFile(root / row["path"], MAX_FILE)
        try:
            require(held.before[6] == row["bytes"] and held.digest() == row["sha256"],
                    "installed member differs")
            require(stat.S_IMODE(held.before[2]) == (0o555 if row["mode"] & 0o111 else 0o444),
                    "installed member mode differs")
            os.lseek(held.fd, 0, os.SEEK_SET)
            label = row["path"].encode("utf-8")
            tree.update(struct.pack(">Q", len(label)) + label + struct.pack(">Q", row["bytes"]))
            count = 0
            while block := os.read(held.fd, min(65536, row["bytes"] - count + 1)):
                count += len(block)
                require(count <= row["bytes"], "installed member grew")
                tree.update(block)
            require(count == row["bytes"], "installed member shortened")
            held.verify()
            file_captures.append((held.path, held.before))
        finally:
            retire(held.close, "Installed member descriptor retirement uncertain")
    require(tree.hexdigest() == authority["tree_sha256"], "installed tree changed")
    executable = root / authority["archive_root"] / "chrome-headless-shell"
    held = HeldFile(executable, MAX_FILE)
    try:
        header = os.read(held.fd, 20)
        held.verify()
    finally:
        retire(held.close, "Executable descriptor retirement uncertain")
    require(header[:6] == b"\x7fELF\x02\x01"
            and int.from_bytes(header[16:18], "little") in (2, 3)
            and int.from_bytes(header[18:20], "little") == authority["elf_machine"],
            "wrong native ELF architecture")
    for path, before in file_captures:
        require(path.resolve(strict=True) == path and identity(path.lstat()) == before,
                "installed file changed during complete readback")
    for path, before, names in directory_captures:
        require(path.resolve(strict=True) == path and identity(path.lstat()) == before
                and bounded_names(path, names) == names,
                "installed directory changed during complete readback")
    return directories


def install_archive(path, authority, destination):
    # Image construction owns a serialized, trusted parent namespace. This is
    # no-clobber publication with substitution detection, not an adversarial
    # kernel compare-and-publish claim against another same-UID build writer.
    destination = Path(destination)
    require(destination.is_absolute() and destination.parent.resolve(strict=True) == destination.parent
            and not destination.is_symlink() and not destination.exists(), "destination already exists or aliases")
    held = HeldFile(path, MAX_ARCHIVE)
    try:
        parent_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except BaseException:
        retire(held.close, "Archive descriptor retirement uncertain")
        raise
    parent_identity = (os.fstat(parent_fd).st_dev, os.fstat(parent_fd).st_ino)
    def verify_namespace(owned_stage=True):
        value = destination.parent.lstat()
        require(destination.parent.resolve(strict=True) == destination.parent
                and stat.S_ISDIR(value.st_mode)
                and (value.st_dev, value.st_ino) == parent_identity,
                "publication parent custody changed")
        if owned_stage and stage is not None:
            value = stage.lstat()
            require(stage.resolve(strict=True) == stage and stat.S_ISDIR(value.st_mode)
                    and (value.st_dev, value.st_ino) == stage_identity,
                    "publication stage custody changed")
    stage = None
    stage_identity = None
    try:
        require(held.before[6] == authority["archive_bytes"], "archive authority differs")
        snapshot = held.snapshot()
        require(hashlib.sha256(snapshot).hexdigest() == authority["archive_sha256"],
                "archive authority differs")
        admit_zip(snapshot, authority)
        with io.BytesIO(snapshot) as raw, zipfile.ZipFile(raw) as archive:
            # Admission reads every complete member and verifies CRC/content.
            # No destination or extraction stage exists until this pass succeeds.
            scan(archive, authority)
            held.verify()
            verify_namespace()
            stage = Path(tempfile.mkdtemp(prefix=".chromium-input-", dir=destination.parent))
            created = stage.lstat()
            stage_identity = (created.st_dev, created.st_ino)
            scan(archive, authority, stage)
            held.verify()
        verify_namespace()
        directories = verify_tree(stage, authority, sealed=False)
        for directory in sorted(directories, key=lambda p: len(p.parts), reverse=True):
            verify_namespace()
            directory.chmod(0o555)
        verify_tree(stage, authority)
        verify_namespace()
        before = stage.lstat()
        subprocess.run(["/usr/bin/mv", "--no-clobber", "--no-target-directory", "--",
                        str(stage), str(destination)], check=True, timeout=10)
        require(not stage.exists(), "publication refused by existing destination")
        after = destination.lstat()
        require(stat.S_ISDIR(after.st_mode) and (after.st_dev, after.st_ino)
                == (before.st_dev, before.st_ino), "publication directory substituted")
        verify_namespace(owned_stage=False)
        verify_tree(destination, authority)
        held.verify()
    finally:
        primary = sys.exception()
        failures = []
        for action in (held.close, lambda: os.close(parent_fd)):
            try:
                action()
            except BaseException as cleanup:
                failures.append(cleanup)
        if stage is not None and os.path.lexists(stage):
            # This is the exact fresh installer-owned private stage, never the
            # publication destination or a caller-selected directory.
            try:
                verify_namespace()
                value = stage.lstat()
                require(stat.S_ISDIR(value.st_mode) and (value.st_dev, value.st_ino)
                        == stage_identity and stage.resolve(strict=True) == stage,
                        "installer stage custody lost; cleanup refused")
                # Only exact manifest directories are touched; no unbounded walk.
                expected = {stage}
                for row in declared_members(authority):
                    directory = (stage / row["path"]).parent
                    while directory != stage:
                        expected.add(directory)
                        directory = directory.parent
                for directory in sorted(expected, key=lambda p: len(p.parts)):
                    if os.path.lexists(directory):
                        require(stat.S_ISDIR(directory.lstat().st_mode)
                                and directory.resolve(strict=True) == directory,
                                "installer cleanup directory custody lost")
                        os.chmod(directory, 0o700, follow_symlinks=False)
                require(shutil.rmtree.avoids_symlink_attacks, "safe stage retirement unavailable")
                shutil.rmtree(stage)
            except BaseException as cleanup:
                failures.append(cleanup)
        if failures:
            if primary is None:
                primary = failures.pop(0)
                for cleanup in failures:
                    primary.add_note("Installer retirement uncertain: " + str(cleanup))
                raise primary
            for cleanup in failures:
                primary.add_note("Installer retirement uncertain: " + str(cleanup))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--architecture", choices=("amd64", "arm64"))
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    native = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
    require(native is not None and args.architecture in (None, native), "wrong native platform")
    lock = load_authority()
    authority = lock["platforms"][native]
    work = tempfile.mkdtemp(prefix="prismpm-chromium-acquisition-")
    try:
        archive = args.archive or Path(work) / "browser.zip"
        if args.archive is None:
            subprocess.run(["curl", "--disable", "--proto", "=https", "--proto-redir", "=https",
                            "--tlsv1.2", "--fail", "--location", "--silent", "--show-error",
                            "--connect-timeout", "15", "--max-time", "180", "--max-redirs", "3",
                            "--max-filesize",
                            str(authority["archive_bytes"]), authority["url"], "--output", str(archive)],
                           check=True, timeout=185)
        install_archive(archive, authority, lock["destination"])
    finally:
        retire(lambda: shutil.rmtree(work), "Acquisition directory retirement uncertain")
    print(json.dumps({"schema": "prismpm/chromium-input-acquisition/1", "platform": native,
                      "version": lock["version"], "channel": lock["channel"],
                      "archive_sha256": authority["archive_sha256"],
                      "tree_sha256": authority["tree_sha256"], "oracle_acceptance": False}))


if __name__ == "__main__":
    main()
