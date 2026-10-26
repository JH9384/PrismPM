# Rekor v1 DSSE bundles

Three bundles copied unchanged from
[sigstore/sigstore-conformance](https://github.com/sigstore/sigstore-conformance)
`test/assets/bundle-verify/` at commit `43321d80f52958efa584c6c975716150db62180b`
(Apache License 2.0), under new folder names:

| Folder | Conformance case |
| --- | --- |
| `rekor1-dsse-happy-path` | `happy-path-intoto-in-dsse-v3` |
| `rekor1-dsse-mismatch-envelope_fail` | `dsse-mismatch-envelope_fail` |
| `rekor1-dsse-mismatch-sig_fail` | `dsse-mismatch-sig_fail` |

Each is a DSSE bundle signed against production Sigstore and logged to Rekor v1
as a `dsse` 0.0.1 entry, the kind the public instance still writes for
attestations. They carry no RFC 3161 timestamp.

`trusted_root.json` is the public instance's root, `trusted_root.json` over TUF
(`@sigstore/tuf`, mirror `https://tuf-repo-cdn.sigstore.dev`), fetched
2026-10-25. It pins `rekor.sigstore.dev`, key id `wNI9atQGlz+VWfO6LRygH4QUfY/8W4RFwiT5i5WRgB0=`.
No key or token was created for this repository.
