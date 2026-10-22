# Installed browser prerequisite gate

`bash scripts/browser-api-sdk-check.sh IMAGE@sha256:DIGEST SOURCE_COMMIT`
requires a clean, exact source commit and the immutable native SDK built from
it. Both native release jobs run the gate independently of source V&V.

The gate compares the complete installed host-module directory and measured
source/compiler/fixture closure, then executes all DK-07–16, DK-19, DK-20,
DK-23–29 Node owners offline with read-only sources and private temporary caches.
Every selected file must register passing tests; missing, skipped or invented
completion records reject. Driver manifests and locks are acquisition-pinned.
DK-21/DK-22 execute in the separate mandatory full installed native V&V.

DK-26 retains its full 34-test source/kernel/native/Wasm/maxima/mutation owner
and session fixtures plus compiler licenses in the measured input closure.
It is a pure kernel, not a new browser host module or public dispatcher.

`node --test scripts/browser-api-sdk-check.test.mjs scripts/fetch-oracle-cargo.test.mjs`
checks these boundaries, including module-tree and byte-equality mutations.
Those tests do not establish installed-image acceptance. The private effect,
compiler, presentation, operation-journal and credential-custody prerequisites do not open
`PP2011`, issue grants or accept an application, deployment or account/recovery
journey. The operation journal retains its complete 28-test owner and the
unchanged effect owner; neither is replaced by inventory checks.
The pure DK-27 resource-budget kernel retains its complete 13-test one-hour
owner and source/fixture closure, including generated-package license inputs.
DK-37 retains its complete 24-test contextual-staging owner and fixture closure,
extending only the existing private effects module. It issues no durable receipt
or application authorization and does not replace the unchanged DK-20/DK-24 owners.
Tests compare files, counts and deadlines with the actual registered Rust owners
and reject omitted files, below-minimum runs and changed source/compiler inputs.

## Verification

2026-09-20, non-root devcontainer: inventory/acquisition tests reproduced the
missing entries before correction; all 37 boundary/acquisition/candidate tests
and complete `xtask validate` (163 audit tests) then passed without skips.
The subsequent accepted DK-25 inventory update reproduced its five missing
closure boundaries and passed those same complete gates again.
The accepted DK-24 update reproduced four missing boundaries, retained its
28-test owner and unchanged 18-test effect regression, then passed all 37 scoped
tests (18.34 s) and the complete 163-test audit (45.09 s) in the devcontainer.
The immutable two-architecture installed-image gate remains required; it was
not executed for this packaging-only change.
