# Raw measurements

Image `ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:cd3b47d7a370c4a26b8285f5e9c3bb15e639973c55505c3809ddbe55352fea58`, 2026-11-05, Windows 11, Docker inside WSL Ubuntu. Project: the chess move referee (3 LexLean modules).

## `docker history` layers (non-empty)

```
188kBtCOPY /sdk-metadata/ / # buildkit
4.1kBtWORKDIR /workspace
4.1kBtRUN |2 TARGETARCH=amd64 SOURCE_DATE_EPOCH=0 /bin/sh -c setpriv --reuid=1000 --regid=1000 --clear-groups       sh -
242MBtRUN |2 TARGETARCH=amd64 SOURCE_DATE_EPOCH=0 /bin/sh -c setpriv --reuid=1000 --regid=1000 --clear-groups       node
2.19GBtRUN |2 TARGETARCH=amd64 SOURCE_DATE_EPOCH=0 /bin/sh -c set -eu;     existing_user=$(getent passwd 1000 | head -n 
16.4kBtCOPY /etc/profile.d/prismpm-sdk.sh /etc/profile.d/prismpm-sdk.sh # buildkit
2.6GBtCOPY /opt/prismpm/ /opt/prismpm/ # buildkit
5.92GBtCOPY /usr/local/ /usr/local/ # buildkit
272MBtRUN |2 TARGETARCH=amd64 SOURCE_DATE_EPOCH=0 /bin/sh -c set -eu;     test "$(wc -l < /tmp/prismpm-runtime-os.lock)"
28.7kBtCOPY --chmod=0444 /prepared/source/sdk/runtime-sources/fixtures/amd64.nodesource.list /prepared/source/sdk/runtim
32.8kBtCOPY --chmod=0444 /prepared/source/sdk/runtime-sources/configure.py /opt/prismpm/runtime-sources/configure.py # b
12.3kBtCOPY /prepared/source/sdk/runtime-os.lock /tmp/prismpm-runtime-os.lock # buildkit
288MBtRUN |1 TARGETARCH=amd64 /bin/sh -c python3 -B /opt/prismpm/browser-engine/install_test.py     && python3 -B /opt/p
201kBtCOPY --chmod=0444 /prepared/source/sdk/browser-engine/ /opt/prismpm/browser-engine/ # buildkit
24.6kBtRUN |1 TARGETARCH=amd64 /bin/sh -c install -d -m 0755 /opt/prismpm /opt/prismpm/browser-engine /opt/prismpm/runti
1.31GBtRUN /bin/sh -c chmod -R a-w /ms-playwright # buildkit
4.1kBtRUN /bin/sh -c /usr/bin/python3 -I -B -c 'import sys; assert sys.version_info[:3] == (3, 12, 3)' # buildkit
307MBtRUN |9 DEBIAN_FRONTEND=noninteractive TZ=America/Los_Angeles DOCKER_IMAGE_NAME_TEMPLATE=mcr.microsoft.com/playwrig
316MBtRUN |9 DEBIAN_FRONTEND=noninteractive TZ=America/Los_Angeles DOCKER_IMAGE_NAME_TEMPLATE=mcr.microsoft.com/playwrig
687MBtRUN |9 DEBIAN_FRONTEND=noninteractive TZ=America/Los_Angeles DOCKER_IMAGE_NAME_TEMPLATE=mcr.microsoft.com/playwrig
800MBtRUN |9 DEBIAN_FRONTEND=noninteractive TZ=America/Los_Angeles DOCKER_IMAGE_NAME_TEMPLATE=mcr.microsoft.com/playwrig
3.08MBtCOPY ./playwright-core.tar.gz /tmp/playwright-core.tar.gz # buildkit
371MBtRUN |9 DEBIAN_FRONTEND=noninteractive TZ=America/Los_Angeles DOCKER_IMAGE_NAME_TEMPLATE=mcr.microsoft.com/playwrig
87.6MBt/bin/sh -c #(nop) ADD file:8c609c85109d07bf47cf268a175b3be8bbe34fc0c41d15d99b090d099f4dc837 in / 
```

## Mapped files per tier (`mapped-files.sh`, /proc sampling of maps and fds)

```
t1 exit 0 in 84 s
== t1 working set by top directory (MB, files)
  2209.1   9114 TOTAL
  2198.8   9089 /usr/local
     9.9     22 /usr/lib
     0.4      3 /usr/bin
t0 exit 0 in 3 s
== t0 working set by top directory (MB, files)
   745.4     28 TOTAL
   582.1      4 /usr/local
   153.4      5 /usr/bin
     9.8     19 /usr/lib
t2 exit 0 in 632 s
== t2 working set by top directory (MB, files)
  5390.9   9876 TOTAL
  4907.7   9765 /usr/local
   235.8     10 /ms-playwright/chromium_headless_shell-cft-157.0.8099.0
   179.9     19 /usr/bin
    35.7      7 /usr/share
    31.4     73 /usr/lib
     0.3      1 /usr/libexec
     0.0      1 /etc/ld.so.cache
```

## Resident pages of `lexlean verify` per process (`resident-pages.sh`, smaps)

```
t1 exit 0 in 37 s, 277883 samples
== T1 resident by top-3 dir (MB, files)
   1348.4   9097 TOTAL
   1299.5   9088 /usr/local/elan
     46.2      1 /usr/local/bin
      2.5      7 /usr/lib/x86_64-linux-gnu
      0.1      1 /usr/bin/dash
== T1 elan resident by extension (MB resident / MB on disk of touched files)
   703.6 /  1266.4 private
   304.9 /   331.7 olean
   144.9 /   342.6 ir
   114.8 /   170.5 so
    31.2 /    29.7 server
     0.0 /     0.1 1/bin/leanchecker
     0.0 /     0.0 1/bin/lean
     0.0 /     0.0 1/bin/lake
== biggest resident files (MB resident / MB size)
   108.4 /   158.4 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/libleanshared.so
    46.2 /    57.8 /usr/local/bin/lexlean
    11.6 /    12.9 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/Init/Data/BitVec/Lemmas.olean.private
     7.1 /     8.7 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/Std/Data/DTreeMap/Internal/Lemmas.olean.private
     7.0 /     7.4 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/Std/Data/Internal/List/Associative.olean.private
     6.4 /    12.1 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/libLake_shared.so
     6.0 /     7.1 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/Init/Data/Array/Lemmas.olean.private
     5.5 /     6.4 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/Init/Data/BitVec/Bitblast.olean.private
     5.4 /     6.0 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/Std/Data/DTreeMap/Internal/Model.olean
     4.6 /     5.8 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/Std/Data/DHashMap/Internal/RawLemmas.olean.private
     4.1 /     5.0 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/Init/Data/Int/DivMod/Lemmas.olean.private
     4.1 /     4.5 /usr/local/elan/toolchains/leanprover--lean4---v4.32.1/lib/lean/Init/Data/List/Lemmas.olean.private
== which lean modules are touched: top-level namespaces (files)
   4772 lib/lean/Lean
   2404 lib/lean/Init
   1904 lib/lean/Std
      3 lib/lean/libleanshared
      1 lib/lean/libLake
      1 lib/lean/libInit
== how many distinct .olean modules touched vs total
2270
2433
== processes seen
32
DONE
```

## Which processes map the Lean compiler library (`attribute-mappings.sh`)

```
== pid maxLeanFiles maxInitStdFiles cmdline
18290 Lean=4768 InitStd=4300 .../bin/leanchecker LexLeanRuntime.Portable
24921 Lean=4768 InitStd=4300 .../bin/leanchecker PrismChess.Chess
31314 Lean=4768 InitStd=4300 .../bin/leanchecker PrismChess.Foundation.Bytes
6633  Lean=3757 InitStd=3129 lean -R .../lean-src -o .../oleans/LexLeanRuntime/Portable.olean ...
37909 Lean=2400              .../bin/leanchecker PrismChess.Foundation.View.Text.V1.Model
11838 Lean=2385              lean -R .../lean-src -o .../oleans/PrismChess/Foundation/Bytes.olean ...
13317 Lean=2385              lean -R .../lean-src -o .../oleans/PrismChess/Foundation/View/Text/V1/Model.olean ...
14996 Lean=2385              lean -R .../lean-src -o .../oleans/PrismChess/Chess.olean ...
42331 Lean=2385              lean .../audit/LexLeanAudit.....LexLeanRuntime.Portable.lean
43938 Lean=2385              lean .../audit/LexLeanAudit.....PrismChess.Chess.lean
45467 Lean=2385              lean .../audit/LexLeanAudit.....PrismChess.Foundation.Bytes.lean
46899 Lean=2385              lean .../audit/LexLeanAudit.....PrismChess.Foundation.View.Text.V1.Model.lean
5281  Lean=2385              lean .../probe/LexLeanProbe.....lean
```

No generated module imports `Lean`; the generated modules import `LexLeanRuntime.Portable` and each other. The counts are files under `lib/lean/Lean/` (four per module: `.olean`, `.olean.private`, `.olean.server`, `.ir`) present in the process's address space at the sample with the most of them.

## Sizes of the mapped set per tier (`stat` of the mapped files)

```
T1 mapped: 2209 MB, 9114 files; of the toolchain, by extension (MB):
  1266.4 olean.private   342.6 ir   331.7 olean   170.5 so   29.7 olean.server
T2 mapped: 5391 MB, 9877 files
  2855.2  9668 /usr/local/elan
  1138.9    20 /usr/local/bin
   630.1    68 /usr/local/rustup
   235.8    10 /ms-playwright/chromium_headless_shell-cft-157.0.8099.0/...
   166.1     6 /usr/local/cargo
   123.7     1 /usr/bin/node
   117.5     2 /usr/local/libexec
T0 mapped: 745 MB, 28 files: prismpm 88, otelcol-contrib 342, node 125 (twice: /usr/bin and /usr/local/bin), cargo-local-registry 27, lto-dump 29
```

## Page-cache residency after a cold start, all three tiers (upper bound)

Measured with `mincore` over every file after `echo 3 > drop_caches`, one tier per drop. Other containers on the same kernel share the page cache with this image's layers, so these are upper bounds; the per-process numbers above are exact.

```
t1  2855 MB resident    (1153 elan, 1145 /usr/local/bin, 174 cargo, 124 node, 118 libexec)
t0  2817 MB resident    (same shape: the shared cache, not the tier)
t2  5078 MB resident    (2001 elan, 1145 /usr/local/bin, 838 /opt/prismpm/cargo-home in 14441 files,
                         331 rustup, 174 cargo, 148 chromium, 124 node, 118 libexec, 36 share, 22 fonts)
t2 wall time 764 s under the measurement load (284 s is the clean figure from fast-verified-builds)
```

## Toolchain and image composition (`du -sm`)

```
/usr/local/elan                      2840   lib/lean/Lean 1250, Init 393, Std 340, libLean.a 297,
                                            libleanshared.so 152, Lake 105, libLLVM.so 77, libclang-cpp.so 65,
                                            src 34, libStd.a 29, libInit.a 25, bin 10
/opt/prismpm                         2708   cargo-home 1132, share 734, openid-m2 353, openid-java 294,
                                            oracles 76, asyncapi-official 51, openid-target 43, bootstrap 13
/ms-playwright                       1524
/usr/local/rustup                    1351
/usr/local/bin                       1093   otelcol-contrib 342, cosign 141, node 125, prismpm-conformance 93,
                                            prismpm 88, kubectl 60, lexlean 58, osv-scanner 57, docker 44,
                                            slsa-verifier 33, oci-distribution-conformance 15, ...
/usr/local/cargo                      167
/usr/local/libexec                    113   docker-buildx 68, docker-compose
/home/vscode/.cargo                  ~1130  a second copy of /opt/prismpm/cargo-home (Dockerfile `cp -a`)
```

## Compressed sizes (`gzip -1`)

```
verify-only toolchain (lib/lean without *.a, libLLVM*, libclang*, src, include):  2267 MB on disk, 755 MB compressed
public .olean + shared libraries only (no .private/.ir/.server):                                201 MB compressed
lexlean + prismpm binaries:                                                                       38 MB compressed
```

## Reference points

- `lexlean-mcp/verifier` (the hosted verifier image): Ubuntu 24.04 + the full toolchain copy (2.96 GB layer) + 58 MB of binaries = 3.94 GB; verifies a draft in 45 s or less.
- `sdk/Dockerfile` stage `cli-archive` already produces `prismpm-<version>-<rust target>.tar.gz`, a native Linux archive of the `prismpm` binary.
