"""Bounded, read-only OCI mismatch diagnostics. Never grants release acceptance."""

import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile

MAX_JSON = 8 * 1024 * 1024
MAX_MEMBERS = 100_000
MAX_BYTES = 32 * 1024 ** 3
MAX_DIFFERENCES = 100


def regular(path):
    if path.is_symlink() or not path.is_file() or path.resolve() != path.absolute():
        raise ValueError("diagnostic input must be a regular, unaliased file")
    return path


def read_json(path):
    regular(path)
    with path.open("rb") as stream:
        raw = stream.read(MAX_JSON + 1)
    if len(raw) > MAX_JSON:
        raise ValueError("diagnostic JSON exceeds bound")
    return json.loads(raw)


def blob(root, descriptor):
    digest = descriptor["digest"]
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("unsupported diagnostic digest")
    return regular(root / "blobs" / "sha256" / digest[7:])


def manifest(root):
    index = read_json(root / "index.json")
    if len(index["manifests"]) != 1:
        raise ValueError("diagnostics require one platform manifest")
    value = read_json(blob(root, index["manifests"][0]))
    if len(value["layers"]) > 128:
        raise ValueError("diagnostic layer count exceeds bound")
    return value


def members(path):
    result = {}
    total = 0
    # Stream members and hash file content without extracting any paths or links.
    with tarfile.open(path, "r|*") as archive:
        for entry in archive:
            total += entry.size
            if len(result) >= MAX_MEMBERS or total > MAX_BYTES or len(entry.name) > 4096:
                raise ValueError("diagnostic layer inventory exceeds bound")
            key = entry.name
            if key in result:
                raise ValueError("duplicate diagnostic layer member")
            row = {"type": entry.type.decode("ascii"), "size": entry.size,
                   "mode": entry.mode, "uid": entry.uid, "gid": entry.gid,
                   "mtime": entry.mtime, "linkname": entry.linkname,
                   "pax_sha256": hashlib.sha256(json.dumps(entry.pax_headers, sort_keys=True).encode()).hexdigest()}
            if entry.isfile():
                digest = hashlib.sha256()
                stream = archive.extractfile(entry)
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
                row["sha256"] = digest.hexdigest()
            result[key] = row
    return result


def differences(left, right):
    names = sorted(name for name in left.keys() | right.keys() if left.get(name) != right.get(name))
    return {"count": len(names), "truncated": len(names) > MAX_DIFFERENCES,
            "members": [{"path": name, "a": left.get(name), "b": right.get(name)}
                        for name in names[:MAX_DIFFERENCES]]}


def diagnose(left, right):
    roots = [Path(left).resolve(), Path(right).resolve()]
    manifests = [manifest(root) for root in roots]
    configs = [read_json(blob(root, value["config"])) for root, value in zip(roots, manifests)]
    report = {"schema": "prismpm/oci-repro-diagnostics/1", "acceptance": False,
              "config_digests": [value["config"]["digest"] for value in manifests],
              "config_changed_fields": sorted(key for key in configs[0].keys() | configs[1].keys()
                                              if configs[0].get(key) != configs[1].get(key)),
              "layer_counts": [len(value["layers"]) for value in manifests], "layers": []}
    print(json.dumps({key: value for key, value in report.items() if key != "layers"}), file=sys.stderr, flush=True)
    for index in range(max(report["layer_counts"])):
        descriptors = [value["layers"][index] if index < len(value["layers"]) else None for value in manifests]
        if descriptors[0] == descriptors[1]:
            continue
        row = {"index": index, "descriptors": descriptors}
        report["layers"].append(row)
        print(json.dumps(row), file=sys.stderr, flush=True)
        try:
            inventories = [members(blob(root, descriptor)) if descriptor else {}
                           for root, descriptor in zip(roots, descriptors)]
            row["differences"] = differences(*inventories)
        except (ValueError, OSError, tarfile.TarError) as error:
            row["diagnostic_error"] = str(error)
        print(json.dumps(row), file=sys.stderr, flush=True)
    return report


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("usage: oci-repro-diagnostics.py ROOT_A ROOT_B")
        result = diagnose(*sys.argv[1:])
    except (ValueError, OSError, KeyError, TypeError) as error:
        result = {"acceptance": False, "diagnostic_error": str(error)}
    print(json.dumps(result, sort_keys=True, indent=2))
