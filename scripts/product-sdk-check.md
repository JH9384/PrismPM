# Installed product CLI gate

`bash scripts/product-sdk-check.sh SDK_INDEX@sha256:DIGEST SOURCE_COMMIT NEW_EVIDENCE_DIR`
runs after the real two-platform SDK index and signed child SBOMs exist, before
promotion. Both native installed-SDK jobs require it in addition to full V&V.

The image supplies all model, compiler, verifier and fixture bytes. The existing
platform-lock capture measures both image inventories. Explicit `fetch --locked`
acquires authoritative inputs and actual image advisory scans; a separate offline,
socket-free container constructs releases A/B in two roots through the public
product CLI. Cargo input is the actual generated package and checksum-bound
image-owned registry, not a handwritten package or crates.io qualification.

A fresh offline receiver receives only the OCI graph and checks source-free
replay/export, missing/changed proof rejection and restored export. Inventory,
locks, advisory results, generated SPDX and exact identities remain evidence.
Every A/B proof in both producer roots must retain the original application
regeneration manifest with authenticated native exporter-seed acquisition.
The source-free receiver rechecks that same manifest against its independently
installed inventory and source archive/toolchain; cold fallback is rejected.
This gate grants neither SDK release acceptance nor deployment authorization.
Unit boundary fixtures do not count as installed-image execution.

The public `check` command selects the fixture's default B system; A and B must
both bind that checked application. Acquisition is online. Construction/replay
is network-isolated. Timed-out or oversized commands terminate their private
process group and close inherited readers; the failing container is removed.
