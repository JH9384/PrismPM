# OSV scanner workspace allocation

The scanner's database cache and temporary image contents belong to one private
directory under the project's ignored `.prism/cache/scanner-workspaces`. Both
image and source scanning pass its `HOME`, `XDG_CACHE_HOME`, and `TMPDIR` through
the existing cleared child environment. The scanner, arguments, immutable
database inputs, coverage requirements, finding policy, and deadlines remain
unchanged. Each invocation removes its workspace on success or failure.

The previous allocation was reproduced with the unchanged SDK built from
`0984474e0208207383c3f9779451d07b2c57b91b`:

- Both real consumer bootstrap jobs failed with `PP7801: OSV scan cache: No
  space left on device (os error 28)` in their modeled 2 GiB `/tmp`:
  [amd64](https://github.com/afflom/lexlean-matmul/actions/runs/38913365631/job/117014502117)
  and [arm64](https://github.com/afflom/lexlean-matmul/actions/runs/38913365631/job/117014558102).
- A valid Docker archive containing three 512 MiB regular files and Debian
  package metadata was scanned with the original inventory-bound OSV scanner
  and all five original database ZIPs. Their total size was 1,087,542,711 bytes.
  With 2 GiB system temporary storage, scanning failed after 11.13 seconds,
  exit 127: `write /tmp/image-blob-1045204844: no space left on device`.
- The same archive, scanner, databases, and arguments passed in 28.97 seconds
  when only the scan home and explicit `TMPDIR` moved to private disk-backed
  project cache. The scanner identified the fixture's Debian package, wrote
  1,610,612,881 bytes of temporary image content, and left all 2 GiB of system
  temporary storage available. All five staged and original database ZIP
  digests remained unchanged.

The archive was 7,034,880 bytes with SHA-256
`06f2df52b94a1d5ce848155d4b715693cb517709a3495ae4d160aa061f173252`.
The original scanner's SHA-256 was
`15314940c10d26af9c6649f150b8a47c1262e8fc7e17b1d1029b0e479e8ed8a0`.
These diagnostic observations establish the allocation failure and remedy;
they do not qualify a new SDK or the consumer's release.

`SC-04` executes the real `image_scan_workspace_` Rust tests. They cover private
directory permissions, explicit child temporary-file allocation from a working
directory outside the repository, stable nested-path normalization, cleanup on
success and child failure, unchanged database source bytes, and rejection of
unusable or symlinked cache paths without a system-temp fallback:

```sh
cargo test --locked --offline -p prismpm --lib image_scan_workspace_ -- --nocapture
cargo test --locked --offline -p repo-conformance --test conformance conformance_sc_04 -- --exact
```

The complete immutable SDK construction and consumer release gates remain
separate acceptance requirements.

Source validation observed five intended failures before the allocation fix,
then five passing focused tests with none ignored. The actual `SC-04` owner
passed with one conformance case and no ignored tests. Canonical model codegen
and workspace/all-target Clippy with `-D warnings` also passed. An independent
review of both scanner call sites found no remaining allocation defect.
