"""Cargo sparse-index cache normalization keeps exactly the held crates."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "normalize_cargo_index", Path(__file__).with_name("normalize-cargo-index.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

REGISTRY = "index.crates.io-1949cf8c6b5b557f"


def line(name, version):
    return ('{"name":"%s","vers":"%s","deps":[],"cksum":"00","features":{},"yanked":false}'
            % (name, version)).encode()


def cache(etag, rows):
    body = b"".join(version.encode() + b"\0" + line(name, version) + b"\0" for name, version in rows)
    return bytes([3]) + (2).to_bytes(4, "little") + etag + b"\0" + body


class NormalizeCargoIndex(unittest.TestCase):
    def home(self, etag, published):
        root = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(root))
        archives = root / "registry" / "cache" / REGISTRY
        archives.mkdir(parents=True)
        for name, version in [("serde-json", "1.0.1"), ("itoa", "1.0.0")]:
            (archives / f"{name}-{version}.crate").write_bytes(b"crate")
        entries = root / "registry" / "index" / REGISTRY / ".cache"
        (entries / "se" / "rd").mkdir(parents=True)
        (entries / "it").mkdir()
        (entries / "un").mkdir()
        (entries / "se" / "rd" / "serde-json").write_bytes(cache(etag, published))
        (entries / "it" / "itoa").write_bytes(cache(etag, [("itoa", "0.9.0"), ("itoa", "1.0.0")]))
        (entries / "un" / "unused").write_bytes(cache(etag, [("unused", "1.0.0")]))
        return root

    def tree(self, root):
        index = root / "registry" / "index"
        return {str(p.relative_to(index)): p.read_bytes() for p in sorted(index.rglob("*")) if p.is_file()}

    def test_upstream_publication_and_validators_do_not_change_the_normalized_cache(self):
        earlier = self.home(b'etag: "a"', [("serde-json", "1.0.0"), ("serde-json", "1.0.1")])
        later = self.home(b'etag: "b"', [("serde-json", "1.0.0"), ("serde-json", "1.0.1"), ("serde-json", "1.0.2")])
        self.assertNotEqual(self.tree(earlier), self.tree(later))
        module.normalize(earlier)
        module.normalize(later)
        self.assertEqual(self.tree(earlier), self.tree(later))
        normalized = self.tree(later)
        self.assertNotIn(f"{REGISTRY}/.cache/un/unused", normalized)
        self.assertFalse((later / "registry" / "index" / REGISTRY / ".cache" / "un").exists())
        etag, entries = module.parse(normalized[f"{REGISTRY}/.cache/se/rd/serde-json"])
        self.assertEqual(etag, module.FIXED_INDEX_VERSION)
        self.assertEqual(entries, [(b"1.0.1", line("serde-json", "1.0.1"))])
        self.assertEqual(module.parse(normalized[f"{REGISTRY}/.cache/it/itoa"])[1], [(b"1.0.0", line("itoa", "1.0.0"))])
        self.assertEqual(module.normalize(later), 0, "normalization is idempotent")

    def test_unknown_cache_formats_are_refused_not_rewritten(self):
        root = self.home(b'etag: "a"', [("serde-json", "1.0.1")])
        path = root / "registry" / "index" / REGISTRY / ".cache" / "se" / "rd" / "serde-json"
        for raw in [bytes([4]) + path.read_bytes()[1:], path.read_bytes()[:1] + (3).to_bytes(4, "little") + path.read_bytes()[5:],
                    path.read_bytes()[:-1]]:
            path.write_bytes(raw)
            with self.assertRaises(ValueError):
                module.normalize(root)
            self.assertEqual(path.read_bytes(), raw)


if __name__ == "__main__":
    unittest.main()
