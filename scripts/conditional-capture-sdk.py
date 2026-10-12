"""Test-only OC-10 runtime boundary; never installed-controller acceptance.

The existing Cargo test ELF, not a second compilation, executes its exact
original case in the already-built SDK. The daemon has no producer-source
mount. All captured evidence is transported before the private tmpfs retires.
"""
import hashlib
from contextlib import ExitStack, contextmanager
import json
import os
from pathlib import Path, PurePosixPath
import re
import resource
import select
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import tomllib
import uuid

TEST = "oci::publication_context::capture_tests::actual_source_free_capture_constructs_complete_conditional_context"
SDK_ROOT = Path("/opt/prismpm/share/conformance-root")
INVENTORY = Path("/opt/prismpm/share/inventory.json")
LABEL = "org.prismpm.conditional-capture-owner"
MIB = 1024 * 1024
MAX_FILE = 256 * MIB
# Cargo's unchanged default-debug libtest ELF exceeds the retained-file bound.
# Its sealed, singly linked transfer has a separate finite allowance; source
# files, capture records and complete retained trees keep their original caps.
MAX_ELF = 512 * MIB
MAX_TREE = 512 * MIB
MAX_JSON = 32 * MIB
DEADLINE_SECONDS = 2400
RETIREMENT_RESERVE_SECONDS = 420


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def run_bounded(arguments, timeout=30, limit=MAX_JSON, **options):
    child = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options)
    channels = {child.stdout.fileno(): bytearray(), child.stderr.fileno(): bytearray()}
    active = set(channels)
    deadline = time.monotonic() + timeout
    try:
        while active:
            left = deadline - time.monotonic()
            require(left > 0, "bounded control process deadline")
            ready = select.select(list(active), [], [], left)[0]
            require(ready, "bounded control process deadline")
            for fd in ready:
                part = os.read(fd, 65536)
                if not part:
                    active.remove(fd)
                else:
                    require(sum(map(len, channels.values())) + len(part) <= limit, "bounded control process output")
                    channels[fd].extend(part)
        status = child.wait(timeout=max(0.01, deadline - time.monotonic()))
        return subprocess.CompletedProcess(arguments, status, bytes(channels[child.stdout.fileno()]),
                                           bytes(channels[child.stderr.fileno()]))
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        child.stdout.close()
        child.stderr.close()


def path_name(value, capture=False):
    require(isinstance(value, str) and value and "\\" not in value
            and not any(ord(c) < 32 or ord(c) == 127 for c in value), "invalid capture path")
    parts = value.split("/")
    require(not value.startswith("/") and all(p not in ("", ".", "..") for p in parts),
            "capture path escapes its owner")
    if ".git" in parts:
        require(capture and len(parts) >= 2 and parts[0] in ("producer-source", "failed-producer-source")
                and parts[1] == ".git" and parts.count(".git") == 1, "only the actual fixture Git tree may be retained")
    return value


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def read_regular(path, limit=MAX_FILE, *, immutable_image_links=False):
    before = os.lstat(path)
    links = before.st_nlink == 1 or (immutable_image_links and before.st_nlink >= 1
                                    and not before.st_mode & 0o222)
    require(stat.S_ISREG(before.st_mode) and links and before.st_size <= limit,
            "bounded singly linked regular input required: " + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        require(identity(os.fstat(fd)) == identity(before), "input changed before open")
        chunks, remaining = [], before.st_size
        while remaining:
            part = os.read(fd, min(remaining, MIB))
            require(part, "input shortened")
            chunks.append(part)
            remaining -= len(part)
        require(os.read(fd, 1) == b"" and identity(os.fstat(fd)) == identity(before)
                and identity(os.lstat(path)) == identity(before),
                "input changed during read")
        return b"".join(chunks)
    finally:
        os.close(fd)


def read_executable(path):
    return read_regular(path, MAX_ELF)


def row(root, name, capture=False):
    path_name(name, capture)
    target = root / name
    info = os.lstat(target)
    if stat.S_ISDIR(info.st_mode):
        return {"path": name, "kind": "directory"}
    if stat.S_ISLNK(info.st_mode):
        link = os.readlink(target)
        require(not os.path.isabs(link), "absolute capture alias")
        resolved = (target.parent / link).resolve(strict=True)
        require(resolved.is_relative_to(root.resolve())
                and resolved == Path(os.path.abspath(target.parent / link)), "escaping or chained capture alias")
        return {"path": name, "kind": "link", "target": link}
    body = read_regular(target)
    return {"path": name, "kind": "file", "bytes": len(body), "sha256": sha(body),
            "executable": bool(info.st_mode & 0o100)}


def validate_rows(rows, capture=False):
    require(isinstance(rows, list) and 0 < len(rows) <= 100000, "bounded nonempty capture inventory")
    names, total = set(), 0
    for record in rows:
        require(isinstance(record, dict), "closed capture row")
        name = path_name(record.get("path"), capture)
        require(name not in names, "duplicate capture path")
        names.add(name)
        kind = record.get("kind")
        keys = {"path", "kind"}
        if kind == "file":
            keys |= {"bytes", "sha256", "executable"}
            require(type(record.get("bytes")) is int and 0 <= record["bytes"] <= MAX_FILE
                    and re.fullmatch(r"[0-9a-f]{64}", record.get("sha256", ""))
                    and type(record.get("executable")) is bool, "closed file measurement")
            total += record["bytes"]
        elif kind == "link":
            keys.add("target")
            link = record.get("target")
            require(isinstance(link, str) and link and not link.startswith("/") and "\\" not in link
                    and not any(ord(c) < 32 or ord(c) == 127 for c in link), "closed alias target")
            resolved = os.path.normpath(str(PurePosixPath(name).parent / link))
            path_name(resolved, capture)
            require(resolved != name, "self-referencing capture alias")
        else:
            require(kind == "directory", "nonregular capture member")
        require(set(record) == keys and total <= MAX_TREE, "closed bounded complete capture inventory")
    # Never materialize a file underneath a symlink, or an unmeasured alias.
    kinds = {r["path"]: r["kind"] for r in rows}
    for record in rows:
        for parent in PurePosixPath(record["path"]).parents:
            if str(parent) != "." and str(parent) in kinds:
                require(kinds[str(parent)] == "directory", "capture parent is not a directory")
        if record["kind"] == "link":
            resolved = os.path.normpath(str(PurePosixPath(record["path"]).parent / record["target"]))
            require(kinds.get(resolved) in ("file", "directory"), "unmeasured or chained alias")
    return rows


def tree(root, capture=True):
    rows, total = [], 0
    def visit(name):
        nonlocal total
        require(len(rows) < 100000, "capture inventory path bound")
        info = os.lstat(root / name)
        if stat.S_ISREG(info.st_mode):
            total += info.st_size
            require(total <= MAX_TREE, "capture inventory byte bound")
        record = row(root, name, capture)
        rows.append(record)
        if record["kind"] == "directory":
            # The existing capture oracle excludes this reconstructible Cargo
            # cache, and nothing else. Preserve every source/release/evidence byte.
            if name == "producer-source/target":
                return
            for child in sorted(os.listdir(root / name)):
                visit(name + "/" + child)
    for name in sorted(os.listdir(root)):
        if not capture and name in (".git", "target", ".lexlean", ".prism"):
            continue
        visit(name)
    return validate_rows(rows, capture)


def source_rows(root):
    if not os.path.lexists(root / ".git"):
        require(re.fullmatch(r"/tmp/prismpm-publication-capture-[A-Za-z0-9_-]{6,64}/source", str(root)),
                "source without Git must be the original private capture owner")
        return tree(root, capture=False)
    process = run_bounded(["/usr/bin/git", "-C", str(root), "ls-files", "-z"])
    require(process.returncode == 0, "tracked source inventory failed")
    names = process.stdout
    require(len(names) <= MAX_JSON and names.endswith(b"\0"), "complete tracked source inventory required")
    paths = names[:-1].decode("utf-8", "strict").split("\0")
    require(len(paths) == len(set(paths)), "duplicate tracked source")
    ancestors = {str(parent) for name in paths for parent in PurePosixPath(name).parents if str(parent) != "."}
    total, rows = 0, []
    for name in sorted(set(paths) | ancestors):
        require(len(rows) < 100000, "source inventory path bound")
        info = os.lstat(root / name)
        if stat.S_ISREG(info.st_mode):
            total += info.st_size
            require(total <= MAX_TREE, "source inventory byte bound")
        rows.append(row(root, name))
    return validate_rows(rows)


def fixture_rows(root):
    # These directories are recursively consumed by the unchanged Rust fixture
    # builder. Membership-only source joins would allow extra model inputs.
    records, total = [], 0
    def visit(name):
        nonlocal total
        require(len(records) < 100000, "fixture directory inventory bound")
        info = os.lstat(root / name)
        require(not stat.S_ISLNK(info.st_mode), "fixture input aliases are not consumed by Rust")
        if stat.S_ISREG(info.st_mode):
            total += info.st_size
            require(total <= MAX_TREE, "fixture directory byte bound")
        record = row(root, name)
        records.append(record)
        if record["kind"] == "directory":
            for child in sorted(os.listdir(root / name)):
                visit(name + "/" + child)
    for name in ("examples/Calculator/src", "stdlib/src/Foundation", "stdlib/src/Production"):
        visit(name)
    return validate_rows(records)


def alias_root(value):
    path = PurePosixPath(value)
    workspace = len(path.parts) == 3 and path.parts[1] in ("workspaces", "workspace") \
        and re.fullmatch(r"[A-Za-z0-9_.-]+", path.parts[2]) and path.parts[2] not in (".", "..")
    private = re.fullmatch(r"/tmp/prismpm-publication-capture-[A-Za-z0-9_-]{6,64}/source", value)
    require(str(path) == value and (workspace or private),
            "compiled workspace alias is not confined")
    return Path(value)


def listing(executable):
    result = run_bounded([str(executable), "--list", "--format=terse"], limit=MIB)
    require(result.returncode == 0, "actual test listing failed")
    body = result.stdout
    checked_listing(body)
    return sha(body)


def test_count(executable):
    result = run_bounded([str(executable), "--list", "--format=terse"], limit=MIB)
    require(result.returncode == 0, "actual test inventory failed")
    checked_listing(result.stdout)
    lines = result.stdout.decode().splitlines()
    require(len(lines) == len(set(lines)) and all(line.endswith(": test") for line in lines),
            "closed distinct library test inventory required")
    return len(lines)


def checked_summary(body, count):
    require(type(count) is int and 1 <= count <= 100000, "actual library test count")
    # --nocapture may interleave the case name/ok with its println body. The
    # exact argv, authenticated complete --list and one unignored execution
    # establish selection; don't demand a formatter-dependent combined line.
    summaries = [line for line in body.decode().splitlines() if line.startswith("test result:")]
    require(len(summaries) == 1 and re.fullmatch(
        r"test result: ok\. 1 passed; 0 failed; 0 ignored; 0 measured; " + str(count - 1)
        + r" filtered out; finished in [0-9.]+s", summaries[0]), "exact original capture test did not complete")


def checked_listing(body):
    require(len(body) <= MIB and body.decode().splitlines().count(TEST + ": test") == 1,
            "original exact capture test must be present once")


class Reader:
    def __init__(self, stream, deadline):
        self.fd = stream.fileno()
        self.deadline = deadline
        self.buffer = bytearray()

    def fill(self):
        left = self.deadline - time.monotonic()
        require(left > 0 and select.select([self.fd], [], [], left)[0], "capture owner deadline")
        body = os.read(self.fd, 65536)
        require(body, "capture owner channel closed early")
        self.buffer.extend(body)

    def exact(self, length):
        return self._exact(length, MAX_FILE)

    def executable(self, length):
        return self._exact(length, MAX_ELF)

    def _exact(self, length, limit):
        require(time.monotonic() < self.deadline, "capture owner deadline")
        require(type(length) is int and 0 <= length <= limit, "bounded protocol bytes")
        result = bytearray()
        while len(result) < length:
            if not self.buffer:
                self.fill()
            count = min(length - len(result), len(self.buffer))
            result.extend(self.buffer[:count])
            del self.buffer[:count]
        return bytes(result)

    def line(self):
        require(time.monotonic() < self.deadline, "capture owner deadline")
        while b"\n" not in self.buffer:
            require(len(self.buffer) < MAX_JSON, "capture protocol bound")
            self.fill()
        end = self.buffer.index(b"\n") + 1
        require(end <= MAX_JSON, "capture protocol line bound")
        body = bytes(self.buffer[:end])
        del self.buffer[:end]
        value = json.loads(body)
        require(encoded(value) == body, "canonical capture protocol required")
        return value

    def exhausted(self):
        require(not self.buffer, "unexpected trailing capture protocol")
        left = self.deadline - time.monotonic()
        require(left > 0 and select.select([self.fd], [], [], left)[0], "capture channel retirement deadline")
        require(os.read(self.fd, 1) == b"", "unexpected trailing capture protocol")


def write_bounded(stream, body, deadline):
    fd = stream.fileno()
    os.set_blocking(fd, False)
    try:
        offset = 0
        while offset < len(body):
            left = deadline - time.monotonic()
            require(left > 0 and select.select([], [fd], [], left)[1], "capture input deadline")
            count = os.write(fd, memoryview(body)[offset:offset + 65536])
            require(count > 0, "capture input channel closed")
            offset += count
    finally:
        os.set_blocking(fd, True)


def checked_descriptor(value):
    require(isinstance(value, dict) and set(value) == {"source_root", "source", "executable_bytes",
            "executable_sha256", "listing_sha256", "sdk_image", "inventory_sha256", "fixture_inputs", "test_count",
            "capture_seconds"},
            "closed capture descriptor")
    alias_root(value["source_root"])
    validate_rows(value["source"])
    validate_rows(value["fixture_inputs"])
    require(type(value["test_count"]) is int and 1 <= value["test_count"] <= 100000, "actual test inventory count")
    require(type(value["capture_seconds"]) is int and 0 < value["capture_seconds"] <= DEADLINE_SECONDS,
            "bounded remaining actual capture time")
    require(type(value["executable_bytes"]) is int and 0 < value["executable_bytes"] <= MAX_ELF,
            "bounded nonempty test ELF")
    for key in ("executable_sha256", "listing_sha256"):
        require(isinstance(value[key], str) and re.fullmatch(r"[0-9a-f]{64}", value[key]), "sealed ELF identity")
    require(isinstance(value["sdk_image"], str) and re.fullmatch(r"[a-z0-9][a-z0-9.:/_-]+@sha256:[0-9a-f]{64}",
            value["sdk_image"]), "immutable SDK distribution reference required")
    require(isinstance(value["inventory_sha256"], str)
            and re.fullmatch(r"[0-9a-f]{64}", value["inventory_sha256"]), "independently captured SDK inventory required")
    return value


def checked_result(value):
    require(isinstance(value, dict) and set(value) == {"status", "signal", "timedOut", "overflow", "aborted",
            "orphaned", "close_observed", "retirement"}, "closed actual command result")
    require(type(value["status"]) is int and value["status"] == 0 and value["signal"] is None,
            "actual successful child result")
    require(all(value[key] is False for key in ("timedOut", "overflow", "aborted", "orphaned"))
            and value["close_observed"] is True, "complete actual command outcome required")
    retirement = value["retirement"]
    require(isinstance(retirement, dict) and set(retirement) == {"scope", "leader_exit_observed", "close_observed",
            "descendants_absent", "uncertainty", "supervisor_status", "supervisor_signal", "owner_error",
            "protocol_failure", "python_version"}, "closed actual process retirement")
    require(retirement["scope"] == "private-linux-subreaper-exhaustion"
            and all(retirement[key] is True for key in ("leader_exit_observed", "close_observed", "descendants_absent"))
            and type(retirement["supervisor_status"]) is int and retirement["supervisor_status"] == 0
            and all(retirement[key] is None for key in ("uncertainty", "supervisor_signal", "owner_error", "protocol_failure"))
            and retirement["python_version"] == "3.12.3", "actual SDK process exhaustion required")
    return value


def capture_records(output, result):
    try:
        checked_result(result)
    except RuntimeError:
        # A failed producer is not a complete captured application. Its Cargo
        # scratch can contain ordinary hard links or oversized outputs; scanning
        # those must not prevent transport of the original test failure. The
        # parent still refuses this result and retains the entire owned volume.
        # Only the existing bounded failure marker crosses this diagnostic path.
        marker = output / "capture-failure.json"
        if not os.path.lexists(marker):
            return []
        before = os.lstat(marker)
        contents = read_regular(marker, MIB)
        failure = json.loads(contents)
        require(isinstance(failure, dict) and set(failure) == {
            "phase", "code", "message", "complete_application_accepted"}, "closed failed capture marker")
        require(failure["phase"] in ("build", "verification")
                and isinstance(failure["code"], str) and re.fullmatch(r"PP[0-9]{4}", failure["code"])
                and isinstance(failure["message"], str)
                and failure["complete_application_accepted"] is False, "failed capture marker is not acceptance")
        require(identity(os.lstat(marker)) == identity(before), "failed capture marker changed during admission")
        return [{"path": "capture-failure.json", "kind": "file", "bytes": len(contents),
                 "sha256": sha(contents), "executable": bool(before.st_mode & 0o100)}]
    return tree(output) if any(output.iterdir()) else []


def transport_capture(output, result, bindings, stdout, stderr, stream):
    original = None
    try:
        records = capture_records(output, result)
    except Exception as error:
        # Transport the actual bounded test streams even if secondary evidence
        # admission fails. The original result is unchanged, the inventory is
        # explicitly empty, and the guest fails before retirement acknowledgement.
        records, original = [], error
    response = {"result": result, **bindings, "stdout_bytes": len(stdout), "stderr_bytes": len(stderr),
                "records": records}
    stream.write(encoded(response) + stdout + stderr)
    stream.flush()
    if original is not None:
        raise original
    for record in records:
        if record["kind"] == "file":
            contents = read_regular(output / record["path"], record["bytes"])
            require(len(contents) == record["bytes"] and sha(contents) == record["sha256"],
                    "capture member changed during transport")
            stream.write(contents)
    stream.flush()


def checked_response(value, descriptor):
    require(isinstance(value, dict) and set(value) == {"result", "executable_sha256", "inventory_sha256",
            "source_sha256", "stdout_bytes", "stderr_bytes", "records"}, "closed actual capture response")
    require(value["executable_sha256"] == descriptor["executable_sha256"]
            and value["source_sha256"] == sha(encoded(descriptor["source"]))
            and value["inventory_sha256"] == descriptor["inventory_sha256"], "actual runtime bindings differ")
    require(all(type(value[key]) is int and 0 <= value[key] <= 32 * MIB
                for key in ("stdout_bytes", "stderr_bytes")), "bounded original test streams")
    validate_rows(value["records"], capture=True) if value["records"] else require(
        value["records"] == [], "closed empty capture inventory")
    return value


def checked_receipt(receipt, descriptor, output):
    expected_keys = {"schema", "complete_application_accepted", "runtime_scope", "runtime_inventory_sha256",
        "test_executable_sha256", "source_uri", "source_revision", "build_id", "attestation_id", "root_digest",
        "sdk_image", "sdk_lock_sha256", "fixture_source_archive_sha256", "installed_sdk_source_matches",
        "context_digest", "expected_subject", "publisher_field_substitutions", "refused_attempts", "graph_refusals",
        "elapsed_seconds", "source_free", "metadata_sha256", "linkage_sha256"}
    require(isinstance(receipt, dict) and set(receipt) == expected_keys, "closed original conditional capture receipt")
    require(receipt["schema"] == "prismpm/conditional-publication-capture-evidence/1"
            and receipt["complete_application_accepted"] is False and receipt["source_free"] is True
            and receipt["runtime_scope"] == "conditional source-built test controller in immutable SDK; not installed-controller acceptance"
            and receipt["test_executable_sha256"] == descriptor["executable_sha256"]
            and receipt["sdk_image"] == descriptor["sdk_image"]
            and receipt["runtime_inventory_sha256"] == descriptor["inventory_sha256"], "actual conditional receipt bindings")
    require(receipt["source_uri"] == "urn:prismpm:fixture:publication-context-linkage"
            and isinstance(receipt["source_revision"], str) and re.fullmatch(r"[0-9a-f]{40}", receipt["source_revision"])
            and type(receipt["installed_sdk_source_matches"]) is bool
            and type(receipt["elapsed_seconds"]) is int and 0 <= receipt["elapsed_seconds"] <= DEADLINE_SECONDS,
            "typed conditional source/scope")
    for key in ("build_id", "attestation_id", "fixture_source_archive_sha256"):
        require(isinstance(receipt[key], str) and re.fullmatch(r"[0-9a-f]{64}", receipt[key]), "typed captured identity: " + key)
    require(isinstance(receipt["root_digest"], str) and re.fullmatch(r"sha256:[0-9a-f]{64}", receipt["root_digest"]),
            "typed root descriptor digest")
    expected = receipt["expected_subject"]
    require(isinstance(expected, dict) and set(expected) == {"producer", "source", "release", "model", "build", "sdk", "tree"}
            and expected["producer"] == receipt["source_uri"] and expected["source"] == receipt["source_revision"],
            "closed original expected subject")
    for key in ("release", "model", "build", "sdk", "tree"):
        require(isinstance(expected[key], str) and re.fullmatch(r"[0-9a-f]{64}", expected[key]), "typed original subject")
    require(expected["release"] == receipt["root_digest"][7:]
            and expected["sdk"] == receipt["sdk_image"].split("@sha256:")[1], "original subject release/SDK joins")
    roles = ("build-manifest", "sdk-lock", "standards-lock", "semantic-snapshot", "model", "system", "runtime-manifest",
             "kernel-attestation", "provenance", "validation", "oracle-attestation")
    require(receipt["graph_refusals"] == [{"role": role, "defect": defect, "code": "PP6101"}
            for role in roles for defect in ("changed", "missing")], "complete exact original graph refusals")
    require(receipt["refused_attempts"] == ["instance", "revision", "empty-ref", "oversized-ref"]
            and type(receipt["publisher_field_substitutions"]) is int and receipt["publisher_field_substitutions"] == 3,
            "complete original attempt controls")
    for key, name in (("runtime_inventory_sha256", "installed-sdk-inventory.json"), ("sdk_lock_sha256", "sdk-lock.json"),
                      ("context_digest", "context.preimage"), ("metadata_sha256", "metadata.request")):
        require(receipt[key] == sha(read_regular(output / name)), "retained receipt byte join differs: " + name)
    require(receipt["linkage_sha256"] == [sha(read_regular(output / ("linkage-" + str(i) + ".preimage"))) for i in range(7)],
            "complete seven retained linkage preimages required")
    return receipt


def seal_private_cargo_cache(cargo):
    # copytree preserves the immutable image's executable classification.
    # Cargo dependencies can contain real build tools (including protoc);
    # making every private file 0600 destroys those tools' execution authority.
    # Retain only owner execution already present, never grant it to data.
    for path, directories, files in os.walk(cargo):
        require(stat.S_ISDIR(os.lstat(path).st_mode), "SDK dependency cache directory alias refused")
        for name in directories:
            require(stat.S_ISDIR(os.lstat(Path(path) / name).st_mode),
                    "SDK dependency cache directory alias refused")
        os.chmod(path, 0o700)
        for name in files:
            item = Path(path) / name
            info = os.lstat(item)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                    "SDK dependency cache requires singly linked regular files")
            os.chmod(item, 0o700 if info.st_mode & 0o100 else 0o600)


def cargo_cache_rows(root, immutable):
    require(root.resolve() == root and stat.S_ISDIR(os.lstat(root).st_mode),
            "unaliasable Cargo cache root required")
    records, total, source_links = [], 0, {}
    def visit(path, name, depth):
        nonlocal total
        require(depth <= 32 and len(records) < 250000, "Cargo cache entry/depth bound")
        info = os.lstat(path)
        require(stat.S_ISDIR(info.st_mode) or (stat.S_ISREG(info.st_mode)
                and (immutable or info.st_nlink == 1)),
                "Cargo cache aliases, hardlinks and special files refused")
        require(not immutable or not info.st_mode & 0o222, "immutable image Cargo cache required")
        if not immutable:
            expected = 0o700 if stat.S_ISDIR(info.st_mode) or info.st_mode & 0o100 else 0o600
            require(stat.S_IMODE(info.st_mode) == expected and info.st_uid == os.getuid(),
                    "owned normalized private Cargo cache mode required")
        if stat.S_ISDIR(info.st_mode):
            records.append({"path": name, "kind": "directory"})
            for child in sorted(os.listdir(path)):
                require(child not in ("", ".", "..") and "\\" not in child
                        and not any(ord(c) < 32 or ord(c) == 127 for c in child),
                        "invalid Cargo cache member name")
                visit(path / child, name + "/" + child if name else child, depth + 1)
        else:
            total += info.st_size
            require(total <= 2 * 1024 ** 3, "Cargo cache aggregate byte bound")
            if immutable:
                key = (info.st_dev, info.st_ino)
                links = source_links.setdefault(key, [info.st_nlink, 0])
                require(links[0] == info.st_nlink, "immutable Cargo hardlink count changed")
                links[1] += 1
            body = read_regular(path, immutable_image_links=immutable)
            records.append({"path": name, "kind": "file", "bytes": len(body),
                            "sha256": sha(body), "executable": bool(info.st_mode & 0o100)})
        require(identity(os.lstat(path)) == identity(info), "Cargo cache changed during inventory")
    visit(root, "", 0)
    # Git legitimately shares immutable packfiles between cache db/checkouts.
    # Admit only complete in-root link groups; copytree breaks those links so
    # every writable private file remains singly owned. Foreign links refuse.
    require(all(expected == observed for expected, observed in source_links.values()),
            "immutable Cargo cache has an out-of-root hardlink")
    require(total > 0 and len(encoded(records)) <= MAX_JSON, "bounded nonempty Cargo cache required")
    return records


def copy_private_cargo_cache(source, cargo):
    # The source is the selected immutable SDK, not an environment-selected
    # cache. Bind its complete byte/mode closure before and after the clone.
    before = cargo_cache_rows(source, immutable=True)
    require(not os.path.lexists(cargo), "private Cargo cache destination must be new")
    shutil.copytree(source, cargo, symlinks=True)
    seal_private_cargo_cache(cargo)
    require(cargo_cache_rows(cargo, immutable=False) == before,
            "private Cargo cache bytes, membership or execution authority differ")
    require(cargo_cache_rows(source, immutable=True) == before, "immutable Cargo cache changed during copy")
    tools = [row for row in before if row.get("executable") is True]
    for tool in tools:
        # This is the actual SDK mode, not a grant inferred from a filename.
        require(stat.S_IMODE(os.lstat(cargo / tool["path"]).st_mode) == 0o700,
                "private Cargo tool mode differs")
    return {"schema": "prismpm/conditional-cargo-cache-custody/1",
            "scope": "immutable SDK dependency clone; not application acceptance",
            "entries": len(before), "inventory_sha256": sha(encoded(before)),
            "bytes": sum(row.get("bytes", 0) for row in before),
            "executable_tools": tools,
            "source_tool_modes": [{"path": tool["path"],
                                   "mode": stat.S_IMODE(os.lstat(source / tool["path"]).st_mode)}
                                  for tool in tools]}


def verify_private_cargo_tools(cargo, custody):
    for tool in custody["executable_tools"]:
        name = tool["path"]
        require(isinstance(name, str) and not name.startswith("/")
                and all(part not in ("", ".", "..") for part in name.split("/")),
                "confined original Cargo tool path required")
        path = cargo / name
        info = os.lstat(path)
        body = read_regular(path)
        # Cargo's legitimate Git checkout can contain executable .git hooks.
        # Its private cache is not the separately restricted capture-output
        # namespace; do not route its measured paths through capture row().
        measured = {"path": name, "kind": "file", "bytes": len(body),
                    "sha256": sha(body), "executable": bool(info.st_mode & 0o100)}
        require(stat.S_IMODE(info.st_mode) == 0o700
                and measured == tool and identity(os.lstat(path)) == identity(info),
                "private Cargo execution authority changed")


def run_vendored_protoc(cargo, custody):
    architectures = {"x86_64": "x86_64", "aarch64": "aarch_64"}
    require(os.uname().machine in architectures, "native Linux protoc architecture required")
    package = "protoc-bin-vendored-linux-" + architectures[os.uname().machine]
    lock = tomllib.loads(read_regular(SDK_ROOT / "tests/hologram-oracle/Cargo.lock").decode("utf-8"))
    versions = [entry["version"] for entry in lock["package"] if entry["name"] == package]
    require(len(versions) == 1, "one pinned native vendored protoc package required")
    suffix = "/" + package + "-" + versions[0] + "/bin/protoc"
    tools = [tool for tool in custody["executable_tools"]
             if tool["path"].startswith("registry/src/") and tool["path"].endswith(suffix)]
    require(len(tools) == 1, "one actual pinned private vendored protoc executable required")
    verify_private_cargo_tools(cargo, custody)
    result = run_bounded([str(cargo / tools[0]["path"]), "--version"], timeout=30, limit=4096)
    require(result.returncode == 0 and result.stderr == b""
            and re.fullmatch(rb"libprotoc [0-9]+(?:\.[0-9]+)+\n", result.stdout),
            "actual private vendored protoc execution failed")
    verify_private_cargo_tools(cargo, custody)
    return {"tool": tools[0], "argv": [str(cargo / tools[0]["path"]), "--version"],
            "status": result.returncode, "stdout": result.stdout.decode("ascii"),
            "scope": "pinned dependency execution preflight; not application acceptance"}


def guest():
    require(sys.version_info[:3] == (3, 12, 3), "pinned SDK interpreter required")
    reader = Reader(sys.stdin.buffer, time.monotonic() + DEADLINE_SECONDS)
    descriptor = checked_descriptor(reader.line())
    reader.deadline = min(reader.deadline, time.monotonic() + descriptor["capture_seconds"])
    require(os.environ.get("PRISMPM_TEST_SDK_IMAGE") == descriptor["sdk_image"], "SDK image differs")
    inventory = read_regular(INVENTORY, 8 * MIB)
    require(sha(inventory) == descriptor["inventory_sha256"], "fixed SDK inventory differs from independent image capture")
    require(INVENTORY.resolve() == INVENTORY and Path("/etc/profile.d/prismpm-sdk.sh").is_file(),
            "fixed immutable SDK metadata required")
    require([row(SDK_ROOT, r["path"]) for r in descriptor["source"]] == descriptor["source"],
            "immutable SDK complete tracked source differs from current compiled source")
    require(fixture_rows(SDK_ROOT) == descriptor["fixture_inputs"], "immutable SDK recursively consumed fixture inputs differ")
    root = alias_root(descriptor["source_root"])
    require(not os.path.lexists(root), "workspace alias is already occupied")
    if root.parts[1] == "tmp":
        root.parent.mkdir(mode=0o700)
    os.symlink(SDK_ROOT, root)
    work = Path("/workspace/conditional-capture")
    workspace = os.lstat(work.parent)
    require(stat.S_ISDIR(workspace.st_mode) and workspace.st_uid == os.getuid()
            and bool(workspace.st_mode & 0o200), "owned writable image-initialized capture volume required")
    require(os.statvfs(work.parent).f_bavail * os.statvfs(work.parent).f_frsize >= 10 * 1024 ** 3,
            "capture volume lacks conservative build headroom")
    work.mkdir(mode=0o700)
    executable = work / "current-test-elf"
    body = reader.executable(descriptor["executable_bytes"])
    require(sha(body) == descriptor["executable_sha256"] and body.startswith(b"\x7fELF"), "transferred ELF differs")
    with executable.open("xb") as target:
        target.write(body)
    executable.chmod(0o500)
    require(listing(executable) == descriptor["listing_sha256"], "transferred test inventory differs")
    require(test_count(executable) == descriptor["test_count"], "transferred complete test count differs")
    output = work / "capture"
    output.mkdir(mode=0o700)
    temporary = work / "tmp"
    temporary.mkdir(mode=0o700)
    cargo = work / "cargo"
    cache_custody = copy_private_cargo_cache(Path("/opt/prismpm/cargo-home"), cargo)
    cache_custody["protoc"] = run_vendored_protoc(cargo, cache_custody)
    elan = work / "elan"
    elan.mkdir(mode=0o700)
    os.symlink("/usr/local/elan/toolchains", elan / "toolchains")
    environment = {**os.environ, "CARGO_HOME": str(cargo), "ELAN_HOME": str(elan),
                   "TMPDIR": str(temporary), "PRISMPM_OC10_CAPTURE_OUTPUT": str(output),
                   "PRISMPM_OC10_SDK_CHILD": "sealed-current-test-elf"}
    # PATH is exactly the image's pinned PATH. No planted wrapper or test ELF.
    seconds = max(1, int(reader.deadline - time.monotonic() - 30))
    command = run_bounded(["/usr/local/bin/node", str(SDK_ROOT / "scripts/conditional-capture-command.mjs"),
                           str(executable), str(work), str(seconds)], cwd=root, env=environment,
                          timeout=seconds + 10, limit=MIB)
    require(command.returncode == 0, "capture command supervisor failed")
    result = json.loads(read_regular(work / "command-result.json", MIB))
    stdout = read_regular(work / "stdout", 32 * MIB)
    stderr = read_regular(work / "stderr", 32 * MIB)
    # Preserve the original failure path; failed producers remain unaccepted
    # and their entire private volume is retained. Successful producers must
    # additionally preserve every original tool's bytes and normalized mode.
    try:
        checked_result(result)
    except RuntimeError:
        pass
    else:
        verify_private_cargo_tools(cargo, cache_custody)
        with (output / "cargo-cache-custody.json").open("xb") as record:
            record.write(encoded(cache_custody))
    require(read_executable(executable) == body and read_regular(INVENTORY, 8 * MIB) == inventory,
            "capture executable or SDK inventory changed")
    require([row(SDK_ROOT, r["path"]) for r in descriptor["source"]] == descriptor["source"],
            "immutable SDK inputs changed during capture")
    require(fixture_rows(SDK_ROOT) == descriptor["fixture_inputs"], "immutable SDK fixture closure changed during capture")
    transport_capture(output, result, {"executable_sha256": sha(body), "inventory_sha256": sha(inventory),
                      "source_sha256": sha(encoded(descriptor["source"]))}, stdout, stderr, sys.stdout.buffer)
    require(reader.line() == {"retire": True}, "retirement acknowledgement required")


def docker(*arguments, check=True):
    environment = {key: value for key, value in os.environ.items() if not key.startswith("DOCKER_")}
    result = run_bounded(["docker", "--host", "unix:///var/run/docker.sock", *arguments], env=environment)
    require(len(result.stdout) + len(result.stderr) <= MAX_JSON, "Docker control output bound")
    if check:
        require(result.returncode == 0, "Docker control failed: " + result.stderr.decode(errors="replace"))
    return result


def inspected(cid):
    values = json.loads(docker("container", "inspect", cid).stdout)
    require(isinstance(values, list) and len(values) == 1, "exact container inspection required")
    return values[0]


def image_file(cid, path, limit):
    # Inspect the stopped image filesystem BEFORE its helper is trusted.
    archive = docker("container", "cp", cid + ":" + str(path), "-").stdout
    require(len(archive) <= limit + MIB, "bounded image file archive")
    import io
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as held:
        members = held.getmembers()
        require(len(members) == 1 and members[0].isfile() and members[0].size <= limit
                and members[0].name == path.name, "exact regular image file required")
        return held.extractfile(members[0]).read(limit + 1)


def bound_diagnostic_file():
    resource.setrlimit(resource.RLIMIT_FSIZE, (MIB, MIB))


@contextmanager
def infrastructure_diagnostics():
    # Bound at the actual Docker writer, not after disk allocation. Forward the
    # original stream even on failure; existing owners retain capture.stderr.
    with tempfile.TemporaryFile() as stream:
        try:
            yield stream
        finally:
            stream.seek(0)
            body = stream.read(MIB + 1)
            require(len(body) <= MIB, "Docker attachment diagnostic bound")
            sys.stderr.buffer.write(body)
            sys.stderr.buffer.flush()


def parent(source, executable):
    # One original outer 2400-second budget, including construction/transport.
    # Reserve the worst-case bounded daemon reconciliation before its TERM/KILL.
    complete_deadline = time.monotonic() + DEADLINE_SECONDS
    source = alias_root(source)
    require(source.resolve() == source, "compiled source is aliased")
    body = read_executable(executable)
    require(body.startswith(b"\x7fELF"), "actual Cargo test ELF required")
    descriptor = {"source_root": str(source), "source": source_rows(source),
        "executable_bytes": len(body), "executable_sha256": sha(body), "listing_sha256": listing(executable),
        "sdk_image": os.environ.get("PRISMPM_TEST_SDK_IMAGE"), "fixture_inputs": fixture_rows(source),
        "test_count": test_count(executable)}
    authority = ("scripts/conditional-capture-sdk.py", "scripts/conditional-capture-command.mjs",
                 "scripts/sdk-command-owner.mjs")
    require(all(any(r["path"] == name and r["kind"] == "file" for r in descriptor["source"])
                for name in authority), "every capture execution-authority module must be tracked")
    require(isinstance(descriptor["sdk_image"], str) and re.fullmatch(
        r"[a-z0-9][a-z0-9.:/_-]+@sha256:[0-9a-f]{64}", descriptor["sdk_image"]), "immutable SDK distribution reference required")
    images = json.loads(docker("image", "inspect", descriptor["sdk_image"]).stdout)
    architecture = {"x86_64": "amd64", "aarch64": "arm64"}.get(os.uname().machine)
    require(len(images) == 1 and images[0]["Os"] == "linux" and architecture is not None
            and images[0]["Architecture"] == architecture and re.fullmatch(r"sha256:[0-9a-f]{64}", images[0]["Id"]),
            "actual local immutable SDK image required")
    image = images[0]["Id"]
    output = Path(os.environ["PRISMPM_OC10_CAPTURE_OUTPUT"]) if "PRISMPM_OC10_CAPTURE_OUTPUT" in os.environ \
        else Path(tempfile.mkdtemp(prefix="prismpm-conditional-capture-"))
    held_output = os.lstat(output)
    require(output.is_absolute() and output.resolve() == output and stat.S_ISDIR(held_output.st_mode)
            and held_output.st_uid == os.getuid() and (held_output.st_mode & 0o077) == 0
            and not any(output.iterdir()), "fresh unaliased capture output required")
    token = uuid.uuid4().hex
    name = "prismpm-conditional-capture-" + token
    volume = name + "-workspace"
    print("Conditional capture infrastructure owner " + json.dumps({"name": name, "token": token,
          "image": image, "volume": volume}, sort_keys=True), file=sys.stderr, flush=True)
    cid, attached = None, None
    attempted, volume_attempted, completed = False, False, False
    diagnostics = ExitStack()
    def interrupted(_signal, _frame):
        raise RuntimeError("conditional capture interrupted")
    for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, interrupted)
    try:
        socket = os.stat("/var/run/docker.sock")
        require(stat.S_ISSOCK(socket.st_mode), "actual Docker transport required")
        volume_attempted = True
        require(docker("volume", "create", "--label", LABEL + "=" + token, volume).stdout.decode().strip() == volume,
                "fresh owned capture volume required")
        attempted = True
        created = docker("create", "--name", name, "--label", LABEL + "=" + token, "--rm", "--interactive",
            "--read-only", "--network", "none", "--user", "1000:1000", "--group-add", str(socket.st_gid),
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--memory", "8g", "--memory-swap", "8g",
            "--cpus", "2", "--pids-limit", "256", "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=8g,mode=1777",
            "--tmpfs", "/workspaces:rw,noexec,nosuid,nodev,size=16m,mode=1777",
            "--mount", "type=volume,source=" + volume + ",target=/workspace",
            "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
            "--env", "PRISMPM_TEST_SDK_IMAGE=" + descriptor["sdk_image"], "--entrypoint", "/usr/bin/python3",
            image, "-I", "-B", str(SDK_ROOT / "scripts/conditional-capture-sdk.py"), "guest")
        cid = created.stdout.decode().strip()
        require(re.fullmatch(r"[0-9a-f]{64}", cid), "complete created container identity")
        actor = inspected(cid)
        require(actor["Id"] == cid and actor["Image"] == image and actor["Name"] == "/" + name
                and actor["Config"]["Labels"].get(LABEL) == token and actor["HostConfig"]["AutoRemove"] is True,
                "actual owned immutable SDK container required")
        require(actor["HostConfig"]["ReadonlyRootfs"] is True and actor["HostConfig"]["NetworkMode"] == "none"
                and actor["Config"]["User"] == "1000:1000"
                and actor["HostConfig"]["Memory"] == 8 * 1024 ** 3
                and actor["HostConfig"]["MemorySwap"] == 8 * 1024 ** 3
                and actor["HostConfig"]["NanoCpus"] == 2 * 10 ** 9 and actor["HostConfig"]["PidsLimit"] == 256
                and actor["HostConfig"]["CapDrop"] == ["ALL"]
                and actor["HostConfig"]["SecurityOpt"] == ["no-new-privileges:true"], "actual capture resource policy differs")
        require(sorted((m["Type"], m["Source"] if m["Type"] == "bind" else m["Name"], m["Destination"])
                       for m in actor["Mounts"]) == sorted([
                    ("bind", "/var/run/docker.sock", "/var/run/docker.sock"), ("volume", volume, "/workspace")]),
                "unexpected producer-source or other capture mount")
        require(image_file(cid, SDK_ROOT / "scripts/conditional-capture-sdk.py", MIB)
                == read_regular(source / "scripts/conditional-capture-sdk.py", MIB), "image helper differs from reviewed source")
        require(image_file(cid, SDK_ROOT / "scripts/conditional-capture-command.mjs", MIB)
                == read_regular(source / "scripts/conditional-capture-command.mjs", MIB),
                "image exact-test launcher differs from reviewed source")
        inventory = image_file(cid, INVENTORY, 8 * MIB)
        document = json.loads(inventory)
        require(isinstance(document, dict) and set(document) == {"schema", "commands", "artifacts"}
                and document["schema"] == "prismpm/sdk-inventory/1", "fixed installed SDK inventory required")
        descriptor["inventory_sha256"] = sha(inventory)
        descriptor["capture_seconds"] = int(complete_deadline - time.monotonic() - RETIREMENT_RESERVE_SECONDS)
        checked_descriptor(descriptor)
        # The socket grants daemon control for the existing OCI/SPDX oracles;
        # this is infrastructure, not an isolated production application claim.
        # Keep the writer's diagnostic FD alive through the outer retirement
        # finally. An early protocol failure must not truncate late diagnostics.
        errors = diagnostics.enter_context(infrastructure_diagnostics())
        deadline = complete_deadline - RETIREMENT_RESERVE_SECONDS
        attached = subprocess.Popen(["docker", "--host", "unix:///var/run/docker.sock", "start", "--attach", "--interactive", cid],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors,
            env={key: value for key, value in os.environ.items() if not key.startswith("DOCKER_")},
            preexec_fn=bound_diagnostic_file)
        write_bounded(attached.stdin, encoded(descriptor), deadline)
        write_bounded(attached.stdin, body, deadline)
        reader = Reader(attached.stdout, deadline)
        response = checked_response(reader.line(), descriptor)
        stdout, stderr = reader.exact(response["stdout_bytes"]), reader.exact(response["stderr_bytes"])
        require(len(stdout) + len(stderr) <= 64 * MIB, "bounded original test output")
        sys.stdout.buffer.write(stdout)
        sys.stderr.buffer.write(stderr)
        rows = validate_rows(response["records"], capture=True) if response["records"] else []
        for record in rows:
            target = output / record["path"]
            if record["kind"] == "directory":
                target.mkdir(mode=0o700)
            elif record["kind"] == "file":
                contents = reader.exact(record["bytes"])
                require(sha(contents) == record["sha256"], "transported capture member differs")
                with target.open("xb") as destination:
                    destination.write(contents)
                # Original adversarial oracles mutate and restore retained
                # evidence in this private owner; it is not immutable source.
                target.chmod(0o700 if record["executable"] else 0o600)
        for record in rows:
            if record["kind"] == "link":
                os.symlink(record["target"], output / record["path"])
        require(tree(output) == rows, "complete actual capture readback differs")
        require(source_rows(source) == descriptor["source"] and read_executable(executable) == body
                and fixture_rows(source) == descriptor["fixture_inputs"],
                "outer compiled source, recursive fixture inputs or executable changed")
        write_bounded(attached.stdin, encoded({"retire": True}), deadline)
        attached.stdin.close()
        require(attached.wait(timeout=30) == 0, "capture guest completion unproven")
        reader.exhausted()
        checked_result(response["result"])
        checked_summary(stdout, descriptor["test_count"])
        receipt = json.loads(read_regular(output / "capture-evidence.json", MAX_JSON))
        checked_receipt(receipt, descriptor, output)
        current_output = os.lstat(output)
        require((current_output.st_dev, current_output.st_ino) == (held_output.st_dev, held_output.st_ino),
                "capture output owner changed")
        completed = True
    finally:
        for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, signal.SIG_IGN)
        cleanup_errors = []
        if attached and attached.poll() is None:
            if attached.stdin and not attached.stdin.closed:
                try:
                    attached.stdin.close()
                except OSError as error:
                    cleanup_errors.append("attachment channel: " + str(error))
        # Pending-create reconciliation is by the unique label AND immutable
        # image; a name alone never authorizes deletion.
        try:
            names = docker("container", "ls", "--all", "--no-trunc", "--filter", "name=^/" + name + "$", "--format", "{{.ID}}").stdout.decode().splitlines()
            require(len(names) <= 1, "ambiguous capture actor")
            if names:
                recovered = inspected(names[0])
                require(attempted and recovered["Config"]["Labels"].get(LABEL) == token
                        and recovered["Image"] == image and recovered["Name"] == "/" + name
                        and (cid is None or recovered["Id"] == cid), "capture actor ownership changed; refusing removal")
                cid = recovered["Id"]
                docker("container", "rm", "--force", cid)
        except Exception as error:
            cleanup_errors.append("container reconciliation: " + str(error))
        if attached:
            try:
                attached.wait(timeout=30)
            except Exception as error:
                cleanup_errors.append("attachment retirement: " + str(error))
                try:
                    attached.kill()
                    attached.wait(timeout=5)
                except Exception as failure:
                    cleanup_errors.append("attachment force retirement: " + str(failure))
        try:
            require(docker("container", "ls", "--all", "--no-trunc", "--filter", "name=^/" + name + "$", "--format", "{{.ID}}").stdout == b"",
                    "capture container name retirement unproven")
            if cid:
                require(docker("container", "ls", "--all", "--no-trunc", "--filter", "id=" + cid, "--format", "{{.ID}}").stdout == b"",
                        "capture container identity retirement unproven")
        except Exception as error:
            cleanup_errors.append("container absence: " + str(error))
        if attempted and cid is None:
            cleanup_errors.append("pending Docker creation retirement is uncertain; retained owner " + name)
        if volume_attempted:
            if not completed or cleanup_errors:
                print("Capture failed; full private workspace retained in owned volume " + volume
                      + "; nested-oracle retirement is unqualified", file=sys.stderr)
            try:
                values = json.loads(docker("volume", "inspect", volume).stdout)
                require(len(values) == 1 and values[0]["Name"] == volume and values[0]["Labels"].get(LABEL) == token,
                        "capture volume ownership changed; refusing removal")
                if completed and not cleanup_errors:
                    docker("volume", "rm", volume)
                    require(docker("volume", "ls", "--filter", "name=^" + volume + "$", "--format", "{{.Name}}").stdout == b"",
                            "capture volume retirement unproven")
            except Exception as error:
                cleanup_errors.append("volume retirement: " + str(error))
                print("Capture volume retention/retirement uncertain: " + volume, file=sys.stderr)
        try:
            diagnostics.close()
        except Exception as error:
            cleanup_errors.append("final infrastructure diagnostics: " + str(error))
        if cleanup_errors:
            original = sys.exc_info()[1]
            raise RuntimeError("capture cleanup unqualified: " + "; ".join(cleanup_errors)
                               + ("; original failure: " + str(original) if original else ""))
    print("PASS complete actual conditional publication capture: " + str(output))
    print("PASS exact conditional SDK capture and measured container retirement; not installed-controller acceptance")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["guest"]:
            guest()
        elif len(sys.argv) == 4 and sys.argv[1] == "parent":
            parent(sys.argv[2], Path(sys.argv[3]))
        else:
            raise RuntimeError("closed conditional capture owner arguments required")
    except Exception as error:
        print("conditional SDK capture failed: " + str(error), file=sys.stderr)
        sys.exit(1)
