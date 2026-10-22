# Cross-engine test infrastructure

Private test tooling, not application or installed-SDK acceptance. The default
remains Chromium; additional engines require explicit closed options.

Pinned browser devcontainer image:
`ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:60226bc791d4c0e5613402a6be7e63f4963d3faf7f327befcf56fc0e41d0ce21`.
Run as UID 1000 with a read-only workspace/root filesystem, no external network,
and writable temporary profile/oracle directories. Current SDK oracle files
were copied from `prismpm-dev`, not installed on the host. Both complete 8852-file
inventories match: `83d55369f5efb93d2378bf9d4e8900077b42dd667f9b723b6fefce0128444262`
(sorted `[path,kind,SHA256-or-link-target]` JSON). Node: 22.23.2; Playwright and
its selected core: 1.62.1. Exact browser versions are enforced by the helper.

```sh
node --test tests/browser-cross-engine/server.test.mjs sdk/browser/store.test.mjs sdk/browser/boundary.test.mjs scripts/browser-api-sdk-check.test.mjs
node --test tests/browser-cross-engine/store.test.mjs
```

27 September 2026: 43/43 helper/boundary/SDK-binding tests passed, followed by
15/15 matrix tests executing all four unchanged Store journeys in Chromium,
Firefox and WebKit. The default standalone Store owner still registers four
tests. Retention/journal matrix acceptance remains a separate owner.

The 27 September storage follow-up passed 55/55 checks in 55.553 s: all 11
storage journeys, 92 actual generated calls replayed by both native modes, and
six executed host defects in each of the three pinned engines. Receipt:
`09570c0cbbab513baf9a84409e26c980b78b82f6ca551a9816fa95d8208430e1`.
This historical receipt predates immutable HTTP module capture; it does not
accept that corrected closure, the complete journal, or an application.
Its genuine Wasm/native inputs are bound to source-owner receipt
`5f8a637551ca59ed81df15c67c60425eca3554b34e52d9ff232a015c8928ed64`.
The first attempt refused execution on the sidecar's noexec `/tmp`; the passed
run used exact hash-checked, singly linked native captures in its private
disk-backed evidence directory. Original artifacts were not modified.

After immutable SDK-module delivery and exact mutation-baseline binding, the
complete matrix passed again: 55/55, 47.411 s, no skips. Receipt:
`a4cf6264e790bda63f06e2dedb0b29f6b6a8dab854d5ef0e9d5ecaf0348e94d3`.
`verifyRetentionEngines` requires the current captured host inputs plus genuine
source-bound Wasm/native artifacts; it runs every storage journey and host
mutant on every engine. Each engine's complete 92-call transcript must agree
with both native modes. This is component follow-up evidence, not a fresh full
source-owner run, complete journal authentication, or deployed acceptance.

The Chromium full-capacity follow-up passed in 1924.005 s (32m04s), without
skips or quota fallback. Receipt:
`b38753f70c87682f494ac04d25cbeb61e2f7af1aeee11f3bcd71719bf9520ccc`.
It stored 4096 distinct 1-MiB objects, populated 64 roots with 4096 references
and 128-character names, restarted the browser twice, read back 8 GiB exactly,
and atomically replaced/retired 16 objects while preserving the other roots.
Independent Node AES-CTR/SHA-256 data and canonical fixture encoding bind every
complete expected frontier. All 779 observed model calls replayed in both
native modes. Four construction checks also passed.

Peak Wasm memory: 845742080 bytes; largest request: 9201853 bytes. The guarded
run started with 22791479296 free bytes and ended with 16904728576 before
cleanup; a 12-GiB reserve was checked throughout. Its successful private
4.1-GiB profile was removed; original artifacts, compact per-call hashes,
native replay file and receipt remain. Firefox/WebKit full-capacity runs,
fresh complete source-owner closure, journal authority/freshness, eviction
resilience and application acceptance are not established by this receipt.

`verifyStorageCapacity` requires genuine source-bound artifacts and the entire
current static helper/SDK/fixture input closure. Run one engine/profile at a
time in the pinned browser devcontainer, with a disk-backed private evidence
directory and at least 20 GiB initially free. It refuses quota/reserve failures
and preserves failed profiles; it never substitutes a reduced-size case.

All three engines report strict IndexedDB transactions. This is not eviction-
proof persistence: the separate ephemeral-context probe returned `persist=false`
in Chromium, awaited permission in Firefox, and lacked the persistence API in
WebKit. Bookworm's copied Noble browsers lack GTK dependencies; use this pinned
Noble environment rather than skipping Firefox/WebKit or installing host tools.
