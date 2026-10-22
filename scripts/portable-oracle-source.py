"""Compare the complete pinned source archive without importing its Unix owner."""
import hashlib
import io
import os
import stat
import sys
import tarfile

ARCHIVE_SHA256 = "caf5c34ef2b21d58c1aa12acf81cb13ace1adaffb3c69a641f54f490ed61cf66"


def identity(value):
    # Reading may update atime; inode, metadata and mutation timestamps must not change.
    return (value.st_dev, value.st_ino, value.st_mode, value.st_size, value.st_uid, value.st_gid,
            value.st_nlink, value.st_mtime_ns, value.st_ctime_ns)


def read_file(path, directory=None):
    before = os.stat(path, dir_fd=directory, follow_symlinks=False)
    assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "source file alias or special file"
    assert before.st_size <= 16 * 1024 * 1024, "source file bound exceeded"
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(descriptor, "rb") as file:
        assert identity(os.fstat(file.fileno())) == identity(before), "source changed before read"
        data = file.read(16 * 1024 * 1024 + 1)
        assert len(data) == before.st_size, "source file size changed"
        assert identity(os.fstat(file.fileno())) == identity(before), "source changed during read"
    assert identity(os.stat(path, dir_fd=directory, follow_symlinks=False)) == identity(before), "source replaced during read"
    return data, before


def verify(archive, root):
    raw, archive_identity = read_file(archive)
    assert hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA256, "source archive identity differs"
    expected = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as source:
        for member in source:
            assert len(expected) < 32768, "source member bound exceeded"
            name = member.name.removeprefix("./").rstrip("/")
            if member.name in (".", "./"):
                assert member.isdir(), "source root must be directory"
                continue
            assert name and all(part not in ("", ".", "..") for part in name.split("/")), "source path invalid"
            assert not name.startswith("/") and name not in expected, "source path duplicated or absolute"
            assert member.isdir() or member.isfile(), "source aliases and special files refused"
            assert member.mode & 0o7000 == 0, "source special permissions refused"
            digest = None
            if member.isfile():
                assert member.size <= 16 * 1024 * 1024, "source file bound exceeded"
                digest = hashlib.sha256(source.extractfile(member).read()).hexdigest()
            expected[name] = (member.isdir(), member.mode & 0o777, member.size if member.isfile() else 0, digest)
    assert len(expected) == 454, "pinned source inventory differs"
    children = {}
    for name in expected:
        parent, _, leaf = name.rpartition("/")
        children.setdefault(parent + "/" if parent else "", set()).add(leaf)
    actual = {}

    def visit(path, parent=None, prefix="", captured=None):
        before_directory = os.stat(path, dir_fd=parent, follow_symlinks=False)
        if captured is not None:
            assert identity(before_directory) == identity(captured), "source directory changed before traversal"
        assert stat.S_ISDIR(before_directory.st_mode), "source directory alias"
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            assert identity(os.fstat(descriptor)) == identity(before_directory), "source directory changed"
            assert before_directory.st_uid == os.getuid() and before_directory.st_gid == os.getgid(), "source directory owner differs"
            if not prefix:
                assert stat.S_IMODE(before_directory.st_mode) == 0o700, "source root mode differs"
            with os.scandir(descriptor) as entries:
                names = set()
                for entry in entries:
                    assert entry.name in children.get(prefix, ()), "unexpected source entry"
                    assert entry.name not in names, "duplicate source entry"
                    assert len(names) < len(children[prefix]), "source directory inventory bound exceeded"
                    names.add(entry.name)
            for entry in sorted(names):
                name = prefix + entry
                assert name in expected, "unexpected source entry"
                before = os.stat(entry, dir_fd=descriptor, follow_symlinks=False)
                assert stat.S_ISDIR(before.st_mode) or stat.S_ISREG(before.st_mode), "source alias or special file"
                assert before.st_uid == os.getuid() and before.st_gid == os.getgid(), "source owner differs"
                assert before.st_mode & 0o7000 == 0, "source special permissions"
                directory_entry = stat.S_ISDIR(before.st_mode)
                digest = None
                if not directory_entry:
                    data, observed = read_file(entry, descriptor)
                    assert identity(observed) == identity(before), "source replaced before read"
                    digest = hashlib.sha256(data).hexdigest()
                actual[name] = (directory_entry, stat.S_IMODE(before.st_mode), before.st_size if not directory_entry else 0, digest)
                assert actual[name] == expected[name], "source type, mode, size or bytes differ"
                if directory_entry:
                    visit(entry, descriptor, name + "/", before)
            assert identity(os.fstat(descriptor)) == identity(before_directory), "source directory changed during traversal"
            assert identity(os.stat(path, dir_fd=parent, follow_symlinks=False)) == identity(before_directory), "source directory replaced"
        finally:
            os.close(descriptor)

    visit(root)
    assert actual == expected, "source inventory incomplete"
    final, final_identity = read_file(archive)
    assert identity(final_identity) == identity(archive_identity) and final == raw, "source archive changed"
    print("pinned source: 454 entries, exact types, modes, sizes and bytes")


if __name__ == "__main__":
    assert len(sys.argv) == 3, "archive and extracted root required"
    verify(sys.argv[1], sys.argv[2])
