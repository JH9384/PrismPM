#!/usr/bin/python3
"""Bounded Linux metadata walk for ci-disk-components.mjs; never prints paths.

No file contents, symlink targets, names or exception text are emitted. The
numeric protocol is [state, allocated_bytes, entries, symlinks, mounts, errors].
States: complete=0, partial=1, timed_out=2, unavailable=3, entry_limit=4,
depth_limit=5. Allocated bytes are a non-atomic lower bound when incomplete.
"""
import json
import os
import stat
import sys
import time


def capacity(root):
    """The potentially blocking fstatvfs is confined to a timed child process."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
    fd = None
    try:
        if not root.startswith('/') or len(os.fsencode(root)) > 4096:
            return [3, 0, 0, 0]
        parts = [part for part in root.split('/') if part]
        if len(parts) > 128 or any(part in ('.', '..') for part in parts):
            return [3, 0, 0, 0]
        fd = os.open('/', flags)
        for part in parts:
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        value = os.fstatvfs(fd)
        return [0, value.f_blocks * value.f_frsize, value.f_bavail * value.f_frsize, value.f_ffree]
    except OSError:
        return [3, 0, 0, 0]
    finally:
        if fd is not None:
            os.close(fd)


def walk(root, exclude_target, entry_limit, depth_limit, duration_ms):
    deadline = time.monotonic() + duration_ms / 1000
    result = [0, 0, 0, 0, 0, 0]
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
    opened = []
    seen = set()

    def count(value):
        identity = (value.st_dev, value.st_ino)
        if identity not in seen:
            seen.add(identity)
            result[1] += value.st_blocks * 512

    try:
        # Reject symlinks in every root ancestor, not only its final component.
        if not root.startswith('/') or len(os.fsencode(root)) > 4096:
            return [3, 0, 0, 0, 0, 0]
        parts = [part for part in root.split('/') if part]
        if len(parts) > 128 or any(part in ('.', '..') for part in parts):
            return [3, 0, 0, 0, 0, 0]
        fd = os.open('/', flags)
        opened.append(fd)
        for part in parts:
            if time.monotonic() >= deadline:
                return [2, 0, 0, 0, 0, 0]
            child = os.open(part, flags, dir_fd=fd)
            opened.append(child)
            os.close(fd)
            opened.remove(fd)
            fd = child
        root_stat = os.fstat(fd)
        device = root_stat.st_dev
        count(root_stat)
        result[2] = 1
        stack = [(fd, os.scandir(fd), 0)]
        try:
            while stack:
                if time.monotonic() >= deadline:
                    result[0] = 2
                    break
                parent, iterator, depth = stack[-1]
                try:
                    entry = next(iterator)
                except StopIteration:
                    iterator.close()
                    stack.pop()
                    os.close(parent)
                    opened.remove(parent)
                    continue
                except OSError:
                    result[0] = 1
                    result[5] += 1
                    iterator.close()
                    stack.pop()
                    os.close(parent)
                    opened.remove(parent)
                    continue
                if result[2] >= entry_limit:
                    result[0] = 4
                    break
                result[2] += 1
                if exclude_target and depth == 0 and entry.name == 'target':
                    continue
                try:
                    value = os.stat(entry.name, dir_fd=parent, follow_symlinks=False)
                    if value.st_dev != device:
                        result[0] = 1
                        result[4] += 1
                        continue
                    if stat.S_ISLNK(value.st_mode):
                        result[3] += 1
                        count(value)  # The link inode, never its target.
                    elif stat.S_ISDIR(value.st_mode):
                        if depth >= depth_limit:
                            result[0] = 5
                            break
                        child = os.open(entry.name, flags, dir_fd=parent)
                        opened.append(child)
                        actual = os.fstat(child)
                        if (actual.st_dev, actual.st_ino) != (value.st_dev, value.st_ino):
                            os.close(child)
                            opened.remove(child)
                            result[0] = 1
                            result[5] += 1
                            continue
                        identity = (actual.st_dev, actual.st_ino)
                        if identity in seen:
                            os.close(child)
                            opened.remove(child)
                            continue
                        try:
                            child_iterator = os.scandir(child)
                        except OSError:
                            os.close(child)
                            opened.remove(child)
                            raise
                        count(actual)
                        stack.append((child, child_iterator, depth + 1))
                    else:
                        # Only stat metadata: FIFOs/devices cannot block on open.
                        count(value)
                except OSError:
                    result[0] = 1
                    result[5] += 1
        finally:
            for _, iterator, _ in stack:
                iterator.close()
    except OSError:
        result[0] = 1 if result[2] else 3
        result[5] += 1
    finally:
        for fd in opened:
            try:
                os.close(fd)
            except OSError:
                pass
    return result


def main():
    try:
        capacity_mode = len(sys.argv) == 3 and sys.argv[1] == '--capacity'
        if capacity_mode:
            result = capacity(sys.argv[2])
        else:
            root, exclude, entries, depth, duration = sys.argv[1:]
            entries, depth, duration = int(entries), int(depth), int(duration)
            if exclude not in ('0', '1') or not 1 <= entries <= 20000 or not 1 <= depth <= 32 or not 1 <= duration <= 1000:
                raise ValueError()
            result = walk(root, exclude == '1', entries, depth, duration)
        if any(type(value) is not int or value < 0 or value > 9007199254740991 for value in result):
            result = [3, 0, 0, 0] if capacity_mode else [3, 0, 0, 0, 0, 0]
    except Exception:
        result = [3, 0, 0, 0] if len(sys.argv) > 1 and sys.argv[1] == '--capacity' else [3, 0, 0, 0, 0, 0]
    print(json.dumps(result, separators=(',', ':')))


if __name__ == '__main__':
    main()
