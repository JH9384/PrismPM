# Bounded Action scratch storage

The Action CLI invocation uses a 2 GiB `/tmp` tmpfs. The pinned SDK initializes
its private Cargo home before executing the requested CLI command; the former
1 GiB bound prevented that initialization for a non-root caller. The separate
JSON projection containers retain their existing 64 MiB bound.

The registered `TM-03` controls run all 19 `action/entrypoint.test.mjs` tests
and all 13 `scripts/ci-capacity.test.mjs` tests. Both closed Docker argument
comparisons require exactly 2 GiB, and the existing planted-defect test restores
1 GiB and requires the owning assertion to reject it. No controls are removed.

Observed on 2026-10-16 with the original immutable SDK
`ghcr.io/afflom/lexlean-matmul-sdk@sha256:39ec2fbe7819fb21e3c255e633a6d37568a250cefdd4aa12c5f612ff9884bd74`:

- UID 1001, `PRISMPM_EPHEMERAL_HOME=1`, `HOME=/tmp/prismpm-home`, and
  `prismpm --version` under a 1 GiB tmpfs exited 1 with a real `cp` error,
  `No space left on device`, before the CLI could execute.
- The same startup with a 2 GiB tmpfs exited 0 and returned `prismpm 0.3.0`.
  This is a startup counterexample and correction, not product acceptance.
- Updated Action expectations against the original 1 GiB script failed:
  11 passed, 8 failed. With the one-line allocation correction, both registered
  Node suites passed: 32 passed, 0 failed, 0 skipped. `bash -n` and
  `git diff --check` also passed.

The source checks used the same immutable SDK's Node and installed YAML parser:

```sh
docker run --rm --network none --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges \
  --volume "$PWD:/work:ro" --workdir /work --entrypoint node \
  ghcr.io/afflom/lexlean-matmul-sdk@sha256:39ec2fbe7819fb21e3c255e633a6d37568a250cefdd4aa12c5f612ff9884bd74 \
  --test --test-timeout=120000 action/entrypoint.test.mjs \
  scripts/ci-capacity.test.mjs
bash -n action/entrypoint.sh
git diff --check
```

This is an independently pinned thin Action change. It does not change the
SDK compiler, installed inventories, generation inputs, scanner controls,
application behavior, or image provenance. The official template renderer takes
its immutable Action reference separately from the immutable SDK image and
policy revision. Construction and product acceptance remain separate checks.
