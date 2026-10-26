# Proposal 272: `attest` and `verify-attestation` (keyless)

| | |
| --- | --- |
| Issue | [#272](https://github.com/UOR-Foundation/PrismPM/issues/272) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental. JavaScript half only |
| Depends on | #267 (the attestation bundle), #275 (log entries and timestamps), #276 (`holo.verify()` and its typed errors) |
| Precedent | `cosign attest`, `cosign verify-attestation`; `model_signing sign`, `model_signing verify`; the `sigstore` npm packages |
| Reference implementation | JavaScript: `sdk/npm/prism-code/src/attest.mjs`, `src/attest-cli.mjs` and `bin/prism-code.mjs` (this change). Rust: the follow-up under "What is not done". |

## Summary

`prism-code attest <holo> --predicate <file> --type <uri>` signs an in-toto Statement v1 about a holo and appends it, as a Sigstore bundle v0.3, to the attestation section (#267).
`prism-code verify-attestation <holo>` checks every such bundle against a signer policy and says which part failed.
Signing is keyless by default: an OIDC token (GitHub Actions in CI) is exchanged for a ten-minute Fulcio certificate, and a Rekor entry with its inclusion proof and an RFC 3161 timestamp go into the bundle.
`--key` signs with a local key and uses no network.
Every refusal is a typed error.

## Motivation

#267 stores bundles and #275 checks the evidence about a signature's time.
Neither checks a signature or decides who may have made it.
A bundle that verifies proves only that some key signed; the policy, the identity and the issuer, is what makes it mean something.

### Goals

- A round trip against the public Sigstore instance, in CI, with the workflow's own OIDC token.
- A round trip against a local key, in tests, with no network.
- A keyless policy that cannot be left empty: an identity (exact, or an anchored pattern) and an issuer.
- Typed errors, one class per reason a caller acts on differently.
- The official `sigstore` packages for the signing, the DSSE signature and the certificate chain; no hand-written crypto beyond signing with a key the caller gave.

### Non-goals

- Producing the predicates. Provenance is #268, the proof predicate is #266.
- `holo.verify()` reading the section and raising a level. That is #269 and #276's follow-up; this change returns its own result.
- Choosing the production trusted root. `--trusted-root` pins one; without it the public instance's is fetched over TUF.
- OCI referrer signing at push (`oci-manifest` subjects). That is the push path, not the holo.

## Proposal

### The verbs

| Command | Does |
| --- | --- |
| `attest <holo> --predicate <file> --type <uri> [--subject <s>]... [--key <pem>] [--output <file>] [--signing-config <file>]` | Sign and append. The holo is rewritten in place unless `--output` names another file, atomically. |
| `verify-attestation <holo> (--certificate-identity <id> \| --certificate-identity-regexp <re>) --certificate-oidc-issuer <url>` | Check keyless bundles. |
| `verify-attestation <holo> --key <pem>` | Check keyed bundles. |

`--type <uri>` also filters what `verify-attestation` checks; `--trusted-root`, `--entries`, `--timestamps`, `--json` are described by `--help`.

The issue names the verbs `prism attest` and `prism verify`.
In `prism-code`, `verify` already delegates to `prismpm verify`, which is build verification (`model/commands.toml`, result `prismpm/verify-result/1`), so the JavaScript verb is `verify-attestation`.
Which name the Rust `prism` binary takes is a command-contract decision, listed under "Open questions".

### The statement

`_type` is `https://in-toto.io/Statement/v1`, `predicateType` is `--type`, `predicate` is the file's JSON.
A subject is a content blob of the holo with exactly `sha256` and `blake3` over the same bytes (#267, ADR-015), named by its role.
`--subject` takes `guest`, `view`, `model`, `capabilities` or a `blake3:` label, and `name=<either>` renames it.
The default is `guest`, the subject of the proof and provenance predicates.
A subject may never be the archive or its footer, because the footer covers the bundle.

### Signing

Keyed: node:crypto signs the DSSE pre-authentication encoding (Ed25519 over the message, every other scheme over its SHA-256) and `@sigstore/sign`'s `DSSEBundleBuilder` packages it.
The bundle carries `publicKey.hint`, the SHA-256 of the key's SPKI in hex, and no log entry or timestamp.

Keyless: `bundleBuilderFromSigningConfig` of `@sigstore/sign`, with the public instance's signing configuration (`signing_config.v0.2.json`, fetched over TUF) or `--signing-config`.
The builder takes the newest log of the configuration that the package supports and adds its timestamp authority. Today the public configuration lists only Rekor v1, so the entry is `dsse` 0.0.1; a Rekor v2 log in the configuration is used as soon as it is listed.
The identity token is `SIGSTORE_ID_TOKEN` or GitHub Actions' (`permissions: id-token: write`).
There is no `--identity-token` flag, so a token never appears in a process list.

The bundle is stored as the signer wrote it (#267).

### Verifying, in order

For each bundle of the requested type:

1. Every subject is a content blob of this holo and both digests equal the blob's, recomputed here. `SubjectMismatchError`.
2. `@sigstore/verify`: the DSSE signature, the certificate chain or the key, the Rekor entry and the timestamps against the pinned root. `SignatureInvalidError` or `TransparencyError`.
3. The signer: the certificate's identity equals `--certificate-identity` exactly, or matches the regular expression, and its issuer equals `--certificate-oidc-issuer`. `IdentityMismatchError`.
4. #275's `verifyTransparency`, offline, over the same bundle and root: the entry's body against the envelope, the inclusion proof, the signed checkpoint, and the signed time that the result reports. It reads `hashedrekord` 0.0.2, `dsse` 0.0.2 and `dsse` 0.0.1 entries; this change added the two `dsse` kinds to it. `TransparencyError`, with every reason listed.

The result passes when at least one bundle passes everything, as `cosign verify-attestation` does.
The holo itself must verify first (`holo.integrity`), and a holo with no matching bundle is `AttestationNotFoundError`.

**The identity is compared here, not by `@sigstore/verify`.**
Its policy matches `subjectAlternativeName` with `String.prototype.match`, so a string policy is an unanchored regular expression: `…/release.yml@refs/heads/main` would accept `…/release.yml@refs/heads/main-evil`, and `.` would match any character.
Passing the policy through would turn "exact identity" into "contains this pattern".
The tests pin the exact comparison against a prefix, a suffix, a wildcard and a changed ref.

A keyless policy without an identity or without an issuer is a `policy.invalid` error, not a pass.

### Dependencies

The packages are `optionalDependencies` of `prism-code`, pinned exactly (the verbs are Experimental): `@sigstore/sign` 5.0.0, `@sigstore/verify` 4.1.2, `@sigstore/tuf` 5.0.0, `@sigstore/bundle` 5.0.0 and `@sigstore/protobuf-specs` 0.5.2.
They load on first use.
`prism-code` stays free of required dependencies and its browser entry never imports them.
They need Node 22.22.2 or newer, which npm enforces for optional dependencies by skipping them, and the verbs then fail with `attest.unavailable` and say so.

### Errors

| Class | Code | `check` |
| --- | --- | --- |
| `SigningError` | `signing_failed` | `sign.key`, `sign.identity`, `sign.service`, `sign.config`, `sign.predicate`, `sign.subject` |
| `SignatureInvalidError` | `signature_invalid` | `signature.*` (the `@sigstore/verify` code, lower-cased) |
| `IdentityMismatchError` | `identity_mismatch` | `identity.signer`, `identity.issuer` |
| `TransparencyError` | `transparency_failed` | `transparency.*`; `reasons` carries #275's list |
| `SubjectMismatchError` | `subject_mismatch` | `attestation.subject` |
| `AttestationNotFoundError` | `attestation_not_found` | `attestation.none`, `attestation.type` |
| `TrustRootError` | `trust_root_invalid` | `trustedroot.invalid` |

A bad policy is the existing `VerificationError` with check `policy.invalid`; a holo that does not verify is `holo.integrity`; structural bundle problems stay `PrismCodeError` `attestation.*`.
CLI exit codes: 0 verified, 1 not verified, 2 an operand cannot be read, 3 signing failed or the sigstore packages are missing, 64 usage or a bad policy.

## Evidence

- `test/attest.test.mjs`: keyed round trips with ECDSA P-256 and Ed25519; the input holo is untouched and `stripAttestations` returns it byte for byte; several attestations and the type filter; the wrong key; a statement with a wrong `sha256` and a valid signature; a corrupted holo; every invalid policy; every `sign.*` check, including a Fulcio that answers 400; the exact-identity cases above; wrong issuer; missing log entry or timestamp; a trusted root that pins nothing.
- The keyless checks run offline on the Sigstore conformance bundle `rekor2-dsse-happy-path` that #275 vendors, signed by a GitHub Actions identity against staging Sigstore, with the signed time read from its timestamp.
- `test/attest-cli.test.mjs`: the verbs end to end, the exit codes, `--json`, no scratch file left behind.
- CI job `keyless` in `.github/workflows/npm-prism-code.yml`: the workflow's own OIDC token attests the Calculator against the public instance, then `verify-attestation` names the workflow as the only signer, with the root fetched over TUF, and three refusals (another identity, another issuer, another predicate type) are checked by exit code and error code.

## What is not done

- The Rust half. `prism attest` and the Rust verifier need #267's wire change (the Rust reader refuses the ninth row), a command-contract entry in `model/commands.toml`, and a decision on the verb name below. The JavaScript implementation and its tests are the oracle for it.
- The keyless path of `verify-attestation` is exercised end to end only by the CI job; the offline tests cover each check of it separately, because a local Fulcio is not available.
- `prism-code inspect` still lists no attestations, and `holo.verify()` does not read the section, so a holo's level does not change.
- The public instance's signing configuration still lists only Rekor v1, so keyless bundles carry a `dsse` 0.0.1 entry. #275's verifier accepts it (see its "Entry kinds"); the CI job found this, because the first version of #275 read only Rekor v2.
- No interactive OIDC flow. A developer outside CI passes `SIGSTORE_ID_TOKEN`.
- No encrypted keys. `--key` reads an unencrypted PEM.

## Open questions

1. Should the Rust binary take `prism verify` for attestations and rename the build verification, or `prism verify-attestation`? Today `prismpm verify` means build verification and has a result schema.
2. Where does a project pin its root (#275 question 1): a digest in `prismpm.lock`, or TUF refreshed out of band? `--trusted-root` takes either.
3. Should `verify-attestation` require every bundle of the type to pass instead of one? `cosign` requires one; a release policy may want all.
4. Should the default subject be every blob rather than the guest? The guest is what #266 and #268 describe.
