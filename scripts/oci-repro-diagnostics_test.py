"""Small real OCI/tar fixtures for the failure-only diagnostic reader."""

import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("diagnostics", Path(__file__).with_name("oci-repro-diagnostics.py"))
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)


def layout(root, content=b"2026-11-02 12:00:00 install package\n", *, link=None, broken=False):
    blobs = root / "blobs" / "sha256"
    blobs.mkdir(parents=True)

    def write_blob(raw):
        digest = hashlib.sha256(raw).hexdigest()
        (blobs / digest).write_bytes(raw)
        return {"digest": "sha256:" + digest, "size": len(raw)}

    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as archive:
        row = tarfile.TarInfo("var/log/dpkg.log")
        row.size = len(content)
        archive.addfile(row, io.BytesIO(content))
        if link:
            row = tarfile.TarInfo("escape")
            row.type = tarfile.SYMTYPE
            row.linkname = link
            archive.addfile(row)
    layer = write_blob(b"invalid tar" if broken else data.getvalue())
    config = write_blob(json.dumps({"rootfs": {"diff_ids": [layer["digest"]]}, "created": "1970-01-01T00:00:00Z"}).encode())
    manifest = write_blob(json.dumps({"config": config, "layers": [layer]}).encode())
    (root / "index.json").write_text(json.dumps({"manifests": [manifest]}))
    return layer


class DiagnosticsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.a, self.b = self.root / "a", self.root / "b"

    def compare(self):
        with contextlib.redirect_stderr(io.StringIO()):
            return diagnostics.diagnose(self.a, self.b)

    def test_clock_content_difference_survives_equal_tar_mtimes(self):
        layout(self.a)
        layout(self.b, b"2026-11-02 13:00:00 install package\n")
        result = self.compare()
        self.assertFalse(result["acceptance"])
        self.assertEqual(result["config_changed_fields"], ["rootfs"])
        changed = result["layers"][0]["differences"]["members"]
        self.assertEqual([row["path"] for row in changed], ["var/log/dpkg.log"])
        self.assertEqual(changed[0]["a"]["mtime"], changed[0]["b"]["mtime"])
        self.assertNotEqual(changed[0]["a"]["sha256"], changed[0]["b"]["sha256"])

    def test_identical_layers_do_not_get_scanned(self):
        layout(self.a)
        layout(self.b)
        with patch.object(diagnostics, "members", side_effect=AssertionError("unnecessary scan")):
            self.assertEqual(self.compare()["layers"], [])

    def test_symlinks_are_reported_never_followed_or_extracted(self):
        target = self.root / "outside"
        layout(self.a, link=str(target))
        layout(self.b)
        changed = self.compare()["layers"][0]["differences"]["members"]
        self.assertEqual(changed[0]["path"], "escape")
        self.assertEqual(changed[0]["a"]["linkname"], str(target))
        self.assertFalse(target.exists())

    def test_invalid_layer_retains_digests_and_error(self):
        layout(self.a, broken=True)
        layout(self.b)
        layer = self.compare()["layers"][0]
        self.assertIn("diagnostic_error", layer)
        self.assertEqual(len(layer["descriptors"]), 2)

    def test_member_and_content_bounds_refuse_partial_inventory(self):
        layout(self.a)
        layout(self.b, b"changed")
        for key in ("MAX_MEMBERS", "MAX_BYTES"):
            with self.subTest(key=key), patch.object(diagnostics, key, 0):
                self.assertIn("exceeds bound", self.compare()["layers"][0]["diagnostic_error"])

    def test_difference_report_is_bounded_and_marks_omissions(self):
        result = diagnostics.differences({str(i): i for i in range(101)}, {})
        self.assertEqual(result["count"], 101)
        self.assertEqual(len(result["members"]), 100)
        self.assertTrue(result["truncated"])

    def test_digest_path_cannot_escape_layout(self):
        with self.assertRaisesRegex(ValueError, "unsupported diagnostic digest"):
            diagnostics.blob(self.root, {"digest": "sha256:../../outside"})


if __name__ == "__main__":
    unittest.main()
