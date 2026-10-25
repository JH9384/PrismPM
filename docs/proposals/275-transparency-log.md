# Proposal 275: transparency log entries and signed timestamps

| | |
| --- | --- |
| Issue | [#275](https://github.com/UOR-Foundation/PrismPM/issues/275) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental |
| Depends on | #267 (the attestation bundle, which already carries the fields), #274 (ADR-015) |
| Blocks | #272 (`prism attest`, `prism verify`) |
| Precedent | cosign v3.0.5 and v3.1.1 defaults; Sigstore bundle v0.3; Rekor v2 (`hashedrekord` 0.0.2); RFC 3161; RFC 9162; C2SP tlog-checkpoint and signed-note |
| Reference implementation | JavaScript: `verifyTransparency` in `sdk/npm/verify/src/transparency.mjs` (this change). Rust: the follow-up under "What is not done". |

## Summary

A keyless signature is only as good as the evidence of when it was made.
A Fulcio certificate lives ten minutes, so "the signature verifies" means nothing until you know the signature was made inside that window.
Sigstore answers with two independent witnesses: a transparency log entry with an inclusion proof, and a signed RFC 3161 timestamp.
Both travel inside the bundle already (`tlogEntries`, `timestampVerificationData`), and the holo's attestation section stores the bundle unchanged (#267).
This change checks them offline.
`verifyTransparency(bundle, trustedRoot)` in `@prism-code/verify` recomputes the Merkle inclusion proof, the signed checkpoint and every timestamp against a trusted root the caller pins, and returns every problem at once.
Nothing is fetched.

## Motivation

#267 stores the bundle and says nothing about its contents: "verifying signatures or choosing a trust root is verifier policy".
#272 needs a checked answer to two questions before it can say a signature is valid: was this entry really in a log I trust, and when was it signed?
Without them `prism verify` would have to trust the bundle's own claims about itself.

### Goals

- Check a Rekor v2 entry offline: the log is pinned, the entry records this bundle's signature, the inclusion proof recomputes to the checkpoint's root, and the pinned log key signed the checkpoint.
- Check RFC 3161 timestamps offline: a pinned authority signed them, the signed time lies inside that authority's validity, and the imprint covers this bundle's signature.
- Check that the signing certificate chains to a pinned certificate authority and was valid at the signed time.
- Use the signed time, never the verifier's clock, so a bundle keeps verifying after every certificate in it has expired.
- Run in a browser, a worker and Node with no dependencies and no network.
- Report every problem in one run, in the shape of a verdict's `reasons`.

### Non-goals

- Whether the signing identity is acceptable (`--certificate-identity`, `--certificate-oidc-issuer`). That is #272.
- The DSSE signature itself. That is #272; this change checks that the log and the timestamp are about this signature.
- Rekor v1 entries (a signed entry timestamp and no checkpoint). cosign v3 writes Rekor v2, and the issue names Rekor v2.
- Checkpoint witnesses, certificate revocation, name constraints, path length and key usage other than time stamping.
- Signing, submitting to a log, requesting a timestamp. Those need the network and a key, and belong to `prism attest`.
- Choosing which trusted root a project pins. The root is an argument.

## Proposal

### The trusted root

The caller pins a Sigstore `trusted_root.json`.
`schemas/attestation/trusted-root.schema.json` in `@prism-code/spec` describes the part Prism reads:

| Member | Used for |
| --- | --- |
| `tlogs[]` | Each log's checkpoint key (an SPKI), its `logId.keyId` (SHA-256 of that SPKI), its `baseUrl` and the period the key is trusted for. |
| `certificateAuthorities[]` | The chain a signing certificate must reach, and the period it is trusted for. |
| `timestampAuthorities[]` | The chain a timestamp signer must reach, and the period it is trusted for. |

A bundle never supplies its own root.
A root that is not usable is an error (`trustedroot.invalid`), not a reason, because no verdict about the bundle follows from it.
The staging root of the Sigstore conformance suite is the test fixture.
This change pins no production root: how a project obtains and refreshes one (TUF, or a digest in `prismpm.lock`) is a decision for #272.

### What is checked

Every check runs, so one call lists every problem.

| Check | Fails when |
| --- | --- |
| `timestamp` | A timestamp does not parse; is not signed by a certificate that chains to a pinned timestamp authority valid at the signed time; the signer lacks the time-stamping key usage; its signed attributes do not match the TSTInfo; its imprint is not the hash of the bundle's signature; or the signed time is outside the signing certificate's validity. |
| `timestamp.count` | Fewer timestamps verified than `options.timestamps` (default 1). Rekor v2 has no integrated time, so a bundle without a verified timestamp has no clock. |
| `certificate.chain` | The signing certificate does not chain to a self-signed pinned root, or a certificate in the chain was not valid at the signed time. |
| `tlog.kind` | The entry is not `hashedrekord` 0.0.2. |
| `tlog.log` | The entry names a log whose `keyId` the root does not pin. |
| `tlog.body` | The logged body is not this bundle's: digest of the DSSE pre-authentication encoding (or the message digest), signature, or certificate. |
| `tlog.inclusion` | There is no proof, the proof is for another index, or the RFC 9162 path does not recompute the root hash from the canonicalized body. |
| `tlog.checkpoint` | The checkpoint is not a signed note with an origin, size and root hash; its size or root differs from the proof; its origin is not the pinned log; the log key was not valid at the signed time; or no signature on it from the origin's pinned key verifies. |
| `tlog.count` | Fewer entries verified than `options.entries` (default 1). |
| `crypto.unavailable` | WebCrypto is missing and the caller supplied none. |
| `bundle.shape` | The bundle has neither a readable DSSE envelope nor a message signature. |

A reason has the shape of a verdict reason: `check`, `withholds` and `message`.
`withholds` is `P1`, the level that needs a valid provenance signature (#269); whether a policy requires this evidence is the caller's decision, and #272 will say.

### The signed time

The earliest verified timestamp is the time the signature existed.
It decides which pinned keys and chains apply: a log key, a certificate authority and a timestamp authority each count only if their `validFor` period contains it (the end is inclusive).
The verifier's clock is never read.
The conformance case `rekor2-timestamp-with-expired-cert-chain` is a chain that has since expired and still verifies.

### Entries and the clock

Rekor v2 entries omit `integratedTime`: protobuf JSON drops a zero, and the log no longer stamps entries.
`sigstore-bundle.schema.json` required it.
This change makes it optional, because every Rekor v2 bundle that cosign v3 writes would otherwise be rejected as a section line.
A Rekor v1 entry still carries it, and `integratedTime` is never used as the clock here.

### Cryptography

Only WebCrypto (`crypto.subtle`) and a plain-JavaScript SHA-256.
Signature schemes: Ed25519 and ECDSA P-256 or P-384 (checkpoints and certificates), RSA PKCS#1 v1.5 (certificates and timestamps).
A scheme WebCrypto cannot import counts as not verifying, and the reason says the signature did not verify.
The Merkle check needs no WebCrypto.
A minimal DER reader (`src/asn1.mjs`) reads certificates and the CMS timestamp; it refuses BER and any length it cannot hold.

### Bundle shapes read

Prism writes DSSE bundles, and those are what the holo stores.
The verifier also reads a message-signature bundle, the kind cosign writes for blobs, because the Sigstore conformance suite is made of them and the logic is the same: the signature bytes and the logged digest differ in where they are found.
The timestamp imprint is the hash of the first signature.

## Evidence

- 22 bundles from the Sigstore conformance suite (`test/fixtures/sigstore-conformance/`, Apache-2.0, source commit in `SOURCE.md`): 9 must verify, 13 must fail, each for a named check. The suite's expectations are the oracle; none was written for Prism.
- Mutations of a real bundle: a proof hash, the root, the tree size, the body, the index, the checkpoint text, the log, the entry kind, the signature and the certificate each fail the named check.
- Every leaf of every tree up to 40 leaves, against the RFC 9162 definition of the tree hash and audit path, with wrong leaf, wrong root, wrong index, an extra hash and a short path each rejected.
- `browser.js` runs the same bundle in a bare context given only WebCrypto, and gives the same result as the source.
- The fixtures validate against the bundle and trusted-root schemas.

No key, token or certificate was created for this change; the bundles were signed against staging Sigstore by the conformance suite's own workflow identity.

## What is not done

- The Rust and LexLean readers still refuse a nine-row archive (#267, "Wire model change"), so `prism check` and `prism verify` cannot read a bundle out of a holo until that follow-up merges. This change checks a bundle it is handed; `readAttestations` in `prism-code` extracts one.
- `prism verify` does not call `verifyTransparency` yet. #272 wires it, with the DSSE signature and the identity policy.
- `verify()` does not read the attestation section, so a holo's level does not change.
- No production trusted root is pinned (see above).

## Open questions

1. Where does a project pin its root: a digest in `prismpm.lock`, or Sigstore's TUF root refreshed out of band? The verifier takes the root as data and works with either.
2. Should a keyed bundle (no certificate) be allowed to carry no timestamp? Today the call fails it, because the count is 1 by default; a keyed policy may pass `timestamps: 0, entries: 0`.
3. Should two timestamps be the default for the public instance, as sigstore-go allows a threshold? The option exists.
