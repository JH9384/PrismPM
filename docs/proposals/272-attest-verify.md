# Proposal 272: `attest` and `verify-attestation` (keyless)

| | |
| --- | --- |
| Issue | [#272](https://github.com/UOR-Foundation/PrismPM/issues/272) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental. JavaScript half on main; Rust half in review |
| Depends on | #267 (the attestation bundle), #275 (log entries and timestamps), #276 (`holo.verify()` and its typed errors) |
| Precedent | `cosign attest`, `cosign verify-attestation`; `model_signing sign`, `model_signing verify`; the `sigstore` npm packages |
| Reference implementation | JavaScript: `sdk/npm/prism-code/src/attest.mjs`, `src/attest-cli.mjs` and `bin/prism-code.mjs`. Rust: `crates/prismpm/src/attest/` and the `attest` and `verify-attestation` arms of `crates/prismpm/src/cli.rs`, with the JavaScript implementation and its tests as the oracle. |

## Summary

`prism-code attest <holo> --predicate <file> --type <uri>` signs an in-toto Statement v1 about a holo and appends it, as a Sigstore bundle v0.3, to the attestation section (#267).
`prism-code verify-attestation <holo>` checks every such bundle against a signer policy and says which part failed.
Signing is keyless by default: an OIDC token (GitHub Actions in CI) is exchanged for a ten-minute Fulcio certificate, and a Rekor entry with its inclusion proof and an RFC 3161 timestamp go into the bundle.
`--key` signs with a local key and uses no network.
Every refusal is a typed error.

The Rust CLI has the same two verbs, `prismpm attest <path.holo>` and `prismpm verify-attestation <path.holo>`, in `crates/prismpm/src/attest/`.
Its `attest` signs with `--key` only, and its `verify-attestation` fetches nothing: the trusted root is `--trusted-root`.
Each refusal is a registered diagnostic, PP3101 to PP3107, carrying the same `check` id as the JavaScript error.

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

**Decision: the Rust binary takes `verify-attestation` too.**
`prismpm verify` keeps meaning build verification, with its result schema and its conformance cases; renaming it would break every caller for a name.
`prismpm verify-signature` was the other candidate and is not the home either: it takes a registry-qualified release reference, a Cosign bundle for the root manifest and a promotion policy, and records verified local evidence (`mutates = "verified-local-evidence"`, `requires_digest = true`).
An attestation check takes a `.holo` file wherever it is, no project and no registry, and records nothing, so it is a new command: `verify-attestation`, `mutates = "never"`, result `prismpm/attestation-verification-result/1`.
`attest` is registered beside it, `mutates = "attested-holo-file"`, result `prismpm/attest-result/1`.
The verdict is printed on exit 0 and exit 1 alike, as `prism-code verify-attestation --json` prints it, so "not verified" is data.
The Rust flags are the JavaScript flags; `--subject`, `--output` and `--key` for `attest`, and `--type`, `--trusted-root`, `--entries`, `--timestamps` and `--json` for `verify-attestation`.

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

#### The Rust verifier

The Rust verifier runs the same four steps in the same order over the same fixtures, with no Sigstore client crate: `p256`, `p384` and `ed25519-dalek` verify the signatures, and the certificate, timestamp and log-entry parsing is a port of `@prism-code/verify`'s (`sdk/npm/verify/src/transparency.mjs` and `asn1.mjs`).
Where `@sigstore/verify` does step 2, the Rust code does this: the DSSE signature under the leaf certificate's key (or `--key`); the leaf placed in time by every verified RFC 3161 timestamp and, for a Rekor v1 entry, by the integrated time the log's signed entry timestamp vouches for; the chain to a pinned certificate authority valid at each of those times; and at least one embedded signed certificate timestamp verified against a pinned certificate-transparency log valid at its time, over the precertificate rebuilt without the SCT extension.
A bundle it cannot place in time is `transparency.timestamp_error`; a certificate it cannot chain or whose SCT does not verify is `signature.certificate_error`; a signature that does not verify is `signature.signature_error`.
Step 4 is the port of `verifyTransparency`, so a Rekor v1 bundle without an RFC 3161 timestamp passes its `tlog.*` checks and still fails `certificate.chain` there, as it does in JavaScript, unless `--timestamps 0` and the caller accepts that the chain was placed in time by the log's promise alone.
Keys it verifies: EC P-256 and P-384 with SHA-2, and Ed25519; an RSA key is recognised and never verifies.

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

In the Rust CLI each is a registered diagnostic with the `check` as its first note: `signing_failed` is PP3101 (exit 3), `signature_invalid` PP3102, `identity_mismatch` PP3103, `transparency_failed` PP3104, `subject_mismatch` PP3105, `attestation_not_found` PP3106 and `trust_root_invalid` PP3107 (exit 1 each), and `policy.invalid` is PP1001 (exit 2).
The result document names the kind as well as the code, so a caller reading both CLIs compares the same word.

A bad policy is the existing `VerificationError` with check `policy.invalid`; a holo that does not verify is `holo.integrity`; structural bundle problems stay `PrismCodeError` `attestation.*`.
CLI exit codes: 0 verified, 1 not verified, 2 an operand cannot be read, 3 signing failed or the sigstore packages are missing, 64 usage or a bad policy.

## Evidence

- `test/attest.test.mjs`: keyed round trips with ECDSA P-256 and Ed25519; the input holo is untouched and `stripAttestations` returns it byte for byte; several attestations and the type filter; the wrong key; a statement with a wrong `sha256` and a valid signature; a corrupted holo; every invalid policy; every `sign.*` check, including a Fulcio that answers 400; the exact-identity cases above; wrong issuer; missing log entry or timestamp; a trusted root that pins nothing.
- The keyless checks run offline on the Sigstore conformance bundle `rekor2-dsse-happy-path` that #275 vendors, signed by a GitHub Actions identity against staging Sigstore, with the signed time read from its timestamp.
- `test/attest-cli.test.mjs`: the verbs end to end, the exit codes, `--json`, no scratch file left behind.
- Rust, `crates/prismpm/src/attest/tests.rs` (HO-28 to HO-30) and `crates/prismpm/tests/attest_cli.rs`: the keyed bundles `experimental_attest` wrote with the committed test-only keys (`crates/prismpm/tests/data/attest/`) verify in Rust; the Rust `attest` round trip with P-256 and Ed25519, byte-for-byte strip, and the bundle shape the JavaScript signer writes; the exact-identity, issuer, transparency and trusted-root refusals on the `rekor2-dsse-happy-path` conformance bundle; the Rekor v1 `dsse` 0.0.1 bundles' `tlog.*` outcomes and the `dsse` 0.0.2 bodies, as `entry-kinds.test.mjs` checks them; every policy and signing refusal with its check; and the verbs end to end with their exit codes.
- CI job `keyless` in `.github/workflows/npm-prism-code.yml`: the workflow's own OIDC token attests the Calculator against the public instance, then `verify-attestation` names the workflow as the only signer, with the root fetched over TUF, and three refusals (another identity, another issuer, another predicate type) are checked by exit code and error code.

## What is not done

- Keyless signing in the Rust `attest`: it needs an OIDC token exchange with Fulcio, a Rekor upload and a timestamp request, which is a Sigstore client the Rust crate graph does not have; `prism-code attest` is the keyless signer until then, and the Rust `attest --key` is required.
- Fetching the trusted root over TUF in the Rust `verify-attestation`: a keyless verify without `--trusted-root` is PP3107, not a fetch.
- RSA keys in the Rust verifier: an RSA-signed bundle is refused as `signature.signature_error` where JavaScript would verify it with WebCrypto.
- The Rust CLI loads the sigstore conformance bundles from `sdk/npm/verify/test/fixtures/`, as the JavaScript tests do; a Rust-owned copy would let the crate build from a packaged source tree without the npm tree.
- The keyless path of `verify-attestation` is exercised end to end only by the CI job; the offline tests cover each check of it separately, because a local Fulcio is not available.
- `prism-code inspect` still lists no attestations, and `holo.verify()` does not read the section, so a holo's level does not change.
- The public instance's signing configuration still lists only Rekor v1, so keyless bundles carry a `dsse` 0.0.1 entry. #275's verifier accepts it (see its "Entry kinds"); the CI job found this, because the first version of #275 read only Rekor v2.
- No interactive OIDC flow. A developer outside CI passes `SIGSTORE_ID_TOKEN`.
- No encrypted keys. `--key` reads an unencrypted PEM.

## Open questions

1. Resolved: the Rust binary takes `verify-attestation`; see "The verbs".
2. Where does a project pin its root (#275 question 1): a digest in `prismpm.lock`, or TUF refreshed out of band? `--trusted-root` takes either.
3. Should `verify-attestation` require every bundle of the type to pass instead of one? `cosign` requires one; a release policy may want all.
4. Should the default subject be every blob rather than the guest? The guest is what #266 and #268 describe.
