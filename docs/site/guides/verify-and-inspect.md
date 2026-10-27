---
title: Verify and inspect
description: Check a holo against a policy, read the verdict, and look inside without running it.
available_in: "0.6"
---
This guide shows you how to decide whether a holo may run, and how to look inside one without running it. Both work on a holo you built and on one you pulled.

## Check against the default policy

`check` verifies five things: the digest, the provenance, the proof, the lockfile pins, and the declared world against policy. The default policy requires P2 or above and a world within the granted capabilities.

The quickstart showed a pass. Here is a fail. Suppose a new build of calculator fetches exchange rates, but `prism.toml` still allows no outbound hosts:

```bash
prism check calculator@sha256:8a41…
```

```text
calculator@sha256:8a41…
  digest        ok    matches
  provenance    ok    built from model sha256:c05d… in toolchain image sha256:91ab…
  proof         ok    2 theorems checked
  lockfile      ok    all pins match prismpm.lock
  replay        ok    1 history, 1 call, no divergence
  world         FAIL  imports outbound host api.exchange.example, capability set allows none
Verdict: FAIL  Level: P2  (policy: default, requires P2 and world within capabilities)
```

The level is still P2, because the proof is fine. The verdict is FAIL, because the world asks for more than the capability set gives. Add the host to `[capabilities]` or remove the import. Nothing else changes the verdict.

## Check against your own policy

A policy file replaces the default. It sets the lowest assurance level that passes and how large the capability set may be. Pass it to `check`:

Status: the policy file format is not published yet. The [Policy reference](/docs/reference/policy) gains its keys when the policy schema ships.

```bash
prism check --policy policy
```

```text
calculator@sha256:3f9c…
  digest        ok    matches
  provenance    ok    built from model sha256:7d2e… in toolchain image sha256:91ab…
  proof         ok    2 theorems checked
  lockfile      ok    all pins match prismpm.lock
  replay        ok    1 history, 1 call, no divergence
  world         ok    imports none, exports calculate, within policy
Verdict: PASS  Level: P3  (policy: policy, requires P3)
```

The same flag works on `run`. Keep the policy file in the repository and point CI at it.

## Read the verdict in CI

Every verb takes `--json`. The verdict becomes one `prism/verdict/1` object: the archive fingerprint, the computed level, the policy, whether it passed, and the reason for every check that did not:

```bash
prism check calculator@sha256:3f9c… --json
```

```json
{"holo":"blake3:8408…","level":"P2","passed":true,"policy":{"minimum":"P2","name":"default"},"reasons":[{"check":"replay.statement","message":"The holo carries no replay statement.","withholds":"P3"}],"schema":"prism/verdict/1"}
```

Exit codes are the contract. 0 is pass. 1 is fail, and `reasons` says why. 2 means `check` reached no verdict, for example when the file is not a holo, the policy cannot be read, or the format revision is unknown. Treat 2 as a fail in CI. It is not a pass you have not looked at yet. On exit 2, stdout is empty and the cause is on stderr.

A GitHub Actions job gates the deploy on the exit code and keeps the verdict when the check fails:

```yaml
- name: Check the holo
  run: prism check dist/calculator.holo --policy policy --json > verdict.json
- name: Keep the verdict
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: verdict
    path: verdict.json
```

Today the same verdict comes from `prism-code`, with no Docker and no `prism` binary:

```bash
npx prism-code check dist/calculator.holo --policy policy.json --json
```

## Assurance levels in practice

You see each level in a predictable place.

- P0 appears on a holo built with `--no-provenance`, or on one whose provenance you cannot read. Do not run it.
- P1 appears when provenance is present but the proof is missing or does not match. Something changed after the build.
- P2 is the default floor. The proof matches the holo and every theorem checked.
- P3 is P2 plus every history replayed and the world within policy. Require it for anything that touches a host.

## Inspect without running

`inspect` prints the manifest, the section digests, the format revision, the world and the attestations. It never instantiates the holo:

```bash
prism inspect calculator@sha256:3f9c…
```

```text
calculator@sha256:3f9c…  format revision {{FORMAT_REVISION}}  24.8 KB
Sections
  app-manifest            sha256:0088…   application calculator 0.1.0
  source-manifest         sha256:c0ee…
  application-directory   sha256:9145…
  model-provenance        sha256:6679…   model sha256:7d2e…
  guest                   sha256:cb9f…   WebAssembly, 10.5 KB
  view                    sha256:d817…   portable view
  capability-set          sha256:c857…   requests nothing
  model-document          sha256:8b17…   function calculate
  attestation-bundle      sha256:e9d1…   provenance, proof, replay
World
  imports  none
  exports  calculate(input: Input) -> Output
Attestations
  provenance  signed, keyless, transparency log entry present
  proof       2 theorems, checked at build
  replay      1 history, 1 call
```

Every section has a sha256 and a BLAKE3 digest over the same bytes. `--json` prints both. Pass `--format world` or `--format attestations` to print one part. Pass `--audit` for the security view, which [Audit a holo](/docs/guides/audit) walks through.

## Next steps

- [Run and gate](/docs/guides/run-and-gate)
- [Audit a holo](/docs/guides/audit)
- [Policy reference](/docs/reference/policy)
