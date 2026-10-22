# Private account genesis

DK-33 prerequisite; not an account service or application acceptance.

`AccountGenesis` binds an immutable namespace reference (32 bytes), fresh
creation nonce (32 bytes), and initial uncompressed P-256 public key (65 bytes).
The source owns format, coordinate-range and curve-equation validation through
`Foundation.Crypto.P256.Model.p256PublicKeyValid`, plus canonical encoding.
The complete SEC 1 P-256 predicate runs before namespace admission or projection;
browser import alone is not sufficient validation. The namespace is a
stable installation/network namespace, not a current release, origin, account
name, email, organization name, key fingerprint or mutable configuration.
Declaring a namespace does not prove ownership of it.

Canonical genesis is `[1, namespace, nonce, initialKey]`. Identity material is
the ASCII bytes `prismpm/account-genesis/1` followed by one zero byte and that
exact CBOR frame. Actual SHA-256 over the source-produced material yields a
32-byte content reference. The complete namespace participates in the digest;
consumers still check the expected namespace independently. Hash equality does
not authenticate state or prove uniqueness of a human.

Signature bytes and signing context are deliberately absent from this identity.
Re-signing or migrating an authorized account retains its original genesis,
including namespace; changing namespace creates a different declaration.
Credential rotation preserves the original genesis and account reference;
current credential, credential epoch, current release and authorized origin
are independently authenticated state, not mutable genesis fields. Arbitrarily
changing genesis allocates a different declaration, never transfers ownership.

The private host captures exact options before awaiting, executes the bound
generated admission/projection, performs real key import and SHA-256, and returns copied
facts through an opaque handle tied to its exact verifier instance and artifact.
Only a completed factory can produce that handle. A matching module self-hash
does not establish source provenance; composition must select the artifact from
the independently verified SDK/source closure. No caller boolean, hash, callback
or constructor substitutes for source execution or cryptography.

The factory selects only its fixed SDK-relative `account-genesis.wasm` artifact.
The generated binding is reconstructed from the complete unmutated verified
model, kernel export and two equal Wasm builds during each native SDK build.
The SDK inventory covers binding, artifact and platform-specific construction
proofs together; a binding literal alone is not proof of construction. Native
attestation identities are not substituted for the portable source/IR binding.
Legacy `wire`/`wireDigest` options assert the bound artifact only and cannot select
another executable. Same-origin, credential-free GET refuses redirects and
non-200 responses; the 30-second acquisition requires bounded exact bytes,
actual EOF and SHA-256 before native compilation. Failure aborts acquisition and
observes stream cancellation. Caller and returned arrays remain defensive copies.
Malformed bindings refuse before allocation or fetch. Cancellation is observed
for at most five seconds; rejection or non-settlement cannot grant a verifier
or prove platform quiescence. Installed owners exercise the shipped modules and
Wasm, not only their source copies. Construction-file integrity checks require
the independently verified source snapshot and do not replace fresh kernel,
package, compiler, retirement or full-owner verification.

The integrating account service must generate the nonce with approved browser
randomness, prove possession of the initial key using the complete declaration,
and durably create the account only if absent. DK-32 signed contexts may bind
that proof to the current application, origin and request; they do not define
the stable account identifier. Recovery, authenticated credential succession,
currentness, mailbox evidence, deduplication policy and organization authority
remain required integrations. Neither arbitrary names nor any mailbox seed a
platform administrator. This internal frame is not DID, VC, JOSE or COSE.

The owning gate requires fresh source/kernel/native std/no_std/two-Wasm parity,
all canonical truncations and malformed boundaries, exact maximum and one-over
frames, every applicable P-256 record in both complete pinned NIST CAVP/ACVP
supplier files, independently
calculated digests, real source mutants and three-engine
capture/curve/hash/opaque-handle adversaries. `PP2011` remains enforced.
The ACVP supplier file is explicitly sample data. Complete imported-corpus
execution is not exhaustive point enumeration or NIST algorithm certification.
AccountGenesis is a private SDK prerequisite shipped in the source archive,
not a public `prism-stdlib` crate export or an accepted account service.

The closed grammar is `AccountGenesis.cddl`: valid genesis is exactly 137 bytes,
identity material 163, maximum request 174 and maximum response 409. The 512-byte
frame ceiling bounds malformed input too; tests at 512 and 513 bytes do not
pretend a 512-byte valid genesis exists. Unknown tags, wrong field counts,
noncanonical encodings, trailing bytes and incomplete frames reject.
