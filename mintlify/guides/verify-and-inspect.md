---
title: Verify and inspect
description: Check a holo against a policy, read the verdict, and look inside without running it.
available_in: "0.6"
---

<Note>This page describes Prism 0.6, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>

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
  provenance    ok    built from model sha256:c05d… in SDK image sha256:91ab…
  proof         ok    2 theorems checked
  lockfile      ok    all pins match prismpm.lock
  replay        ok    1 history, 1 call, no divergence
  world         FAIL  imports outbound host api.exchange.example, capability set allows none
Verdict: FAIL  Level: P2  (policy: default, requires P2 and world within capabilities)
```

The level is still P2, because the proof is fine. The verdict is FAIL, because the world asks for more than the capability set gives. Add the host to `[capabilities]` or remove the import. Nothing else changes the verdict.

## Check against your own policy

A policy file replaces the default. It sets the lowest assurance level that passes and what else must be true of the holo. The [Policy reference](/reference/policy) has the format and two worked examples, `pure-only` and `provenance-only`. Pass one to `check`:

```bash
prism check --policy policy
```

```text
calculator@sha256:3f9c…
  digest        ok    matches
  provenance    ok    built from model sha256:7d2e… in SDK image sha256:91ab…
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

The exit code is all a CI step needs, and `prism-code` runs it today with no Docker and no `prism` binary. The sample holo is unsigned, so it is P0. These three runs were captured here, each on the same file. The default policy fails it with exit 1, `pure-only` accepts P0 and exits 0, and `provenance-only` asks for P1 and exits 1:

```bash
prism-code check Calculator.holo # exit 1
prism-code check Calculator.holo --policy pure-only
prism-code check Calculator.holo --policy provenance-only --json # exit 1
```

```text
FAILED  P0 unverified  policy default requires P2 or above
holo    Calculator.holo
digest  blake3:8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba

Reasons:
  provenance.statement (Verification, withholds P1)
    The holo carries no provenance statement; format revision 2026-10-23 has no attestation bundle (issues #267 and #268).
  proof.statement (ProofMismatch, withholds P2)
    The holo carries no proof statement (issue #266).
  replay.statement (Replay, withholds P3)
    The holo carries no replay statement (issue #284).
  policy.level (PP5601, Verification, policy rule)
    The level is P0; the policy requires P2 or above.
PASSED  P0 unverified  policy pure-only requires P0 or above
holo    Calculator.holo
digest  blake3:8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba

Reasons:
  provenance.statement (Verification, withholds P1)
    The holo carries no provenance statement; format revision 2026-10-23 has no attestation bundle (issues #267 and #268).
  proof.statement (ProofMismatch, withholds P2)
    The holo carries no proof statement (issue #266).
  replay.statement (Replay, withholds P3)
    The holo carries no replay statement (issue #284).
{"holo":"blake3:8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba","level":"P0","passed":false,"policy":{"minimum":"P1","name":"provenance-only"},"reasons":[{"check":"provenance.statement","message":"The holo carries no provenance statement; format revision 2026-10-23 has no attestation bundle (issues #267 and #268).","withholds":"P1"},{"check":"proof.statement","message":"The holo carries no proof statement (issue #266).","withholds":"P2"},{"check":"replay.statement","message":"The holo carries no replay statement (issue #284).","withholds":"P3"},{"check":"policy.level","code":"PP5601","message":"The level is P0; the policy requires P1 or above.","withholds":null},{"check":"policy.provenance-only.absent","message":"The holo carries no provenance statement.","withholds":null}],"schema":"prism/verdict/1"}
```

A holo reaches P1 and P2 only through signed statements it carries, and `check` believes a signature only from the signer you name. Pass the public key that signs your releases, or the identity and issuer of your keyless signer:

```bash
npx prism-code check dist/calculator.holo --key release.pub.pem --json > verdict.json
npx prism-code check dist/calculator.holo \
  --certificate-identity-regexp '^https://github.com/acme/calculator/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --trusted-root trusted_root.json --json > verdict.json
```

Without a signer a signed holo is P0, because a signature nobody checked is no evidence. The provenance statement supports P1, the proof statement P2. A proof statement that is about another guest, or a guest changed after signing, fails with `ProofMismatch` (`proof.subject`, `PP5503`) and exits 1.

A GitHub Actions job gates the deploy on the exit code and keeps the verdict when the check fails:

```yaml
- name: Check the holo
  run: npx prism-code check dist/calculator.holo --key release.pub.pem --json > verdict.json
- name: Keep the verdict
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: verdict
    path: verdict.json
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
calculator@sha256:3f9c…  format revision 2026-10-23  24.8 KB
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

Every section has a sha256 and a BLAKE3 digest over the same bytes. `--json` prints both. Pass `--format world` or `--format attestations` to print one part. The Rust CLI inspects a holo file with the same value: `prismpm inspect Calculator.holo --json` prints `prismpm/holo-inspection/1` for the archive, and `prismpm inspect Calculator.holo --format sections[0].digest.sha256` prints one value. Pass `--audit` for the security view, which [Audit a holo](/guides/audit) walks through.

## Next steps

- [Run and gate](/guides/run-and-gate)
- [Audit a holo](/guides/audit)
- [Policy reference](/reference/policy)
