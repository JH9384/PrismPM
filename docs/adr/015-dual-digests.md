# ADR-015: Dual Digests, BLAKE3 Native Plus sha256

## Status
Accepted, 2026-10-23. Tested for issue #274.

## Context
- A `.holo` names its parts with BLAKE3.
- Each content blob carries a 71-byte label `blake3:<hex>`, the BLAKE3 of the blob content.
- The 32-byte footer is the BLAKE3 of the body, which is every byte before the footer.
- Prism v1.0 pushes attestations to OCI registries as OCI 1.1 referrers.
- cosign, ORAS and Kyverno must discover and verify them.
- An in-toto Statement v1 subject carries a DigestSet, a map from algorithm name to digest.
- A DigestSet may hold several algorithms side by side.
- `blake3` is not a predefined DigestSet key; custom keys are allowed if their encoding is documented.
- OCI image-spec v1.1.1 registers `sha256` and `sha512` for descriptors.
- Image-spec `main` added `blake3` as optional on 2025-02-19; no release contains it yet.
- The question: do both digests survive the real tools, and which digests must OCI objects use?

## Decision
1. BLAKE3 stays the native fingerprint. Blob labels and the footer do not change.
2. Every DigestSet that Prism writes names exactly one byte string.
3. It carries two keys, `sha256` and `blake3`, both computed over that same byte string.
4. Both values are lowercase hex of 64 characters, matching `^[0-9a-f]{64}$`.
5. `blake3` means BLAKE3 in default hash mode with 256-bit output.
6. For a content blob, the `blake3` value equals its label without the `blake3:` prefix.
7. Statement subjects are content blobs, such as the wasm, model and view blobs.
8. A statement meant for cosign or Kyverno also names the OCI manifest, with `sha256` only.
9. Prism does not need a whole-file subject. The footer stays the only archive-level BLAKE3.
10. If a whole-file subject is ever written, its `blake3` covers the full file, never the footer.
11. Every OCI descriptor Prism writes uses `sha256`. Prism writes no `blake3:` descriptors.
12. Prism verifiers require both keys on every blob subject and check both.
13. A mismatch on either key fails verification.
14. This is stricter than the in-toto rule that any one matching key suffices. Consumers may choose that.

## Evidence
Run on 2026-10-23 on Windows 11 with local registries.

| Tool | Version | Role |
|------|---------|------|
| oras | 1.3.4 | push, attach, discover, pull |
| cosign | 3.1.4 | attest, verify, tree |
| Kyverno CLI | 1.19.2 | admission policy check |
| zot | 2.1.22 (minimal) | registry with the referrers API |
| CNCF distribution | 3.1.2 | registry with the referrers tag fallback |

Signing used a throwaway cosign key pair and a signing config with no transparency log.
Keyless signing needs an interactive OIDC login, which this run did not have.
The holo is `artifacts/Calculator.holo` from `UOR-Foundation/calculator-example`, 24801 bytes.
BLAKE3 came from `sdk/npm/prism-code/src/blake3.mjs`, which passed the empty and `abc` known answers.
Paths and repeated output are trimmed below. Exit codes are real.

### Digests

| Bytes | sha256 | blake3 |
|-------|--------|--------|
| whole file | `84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7` | `4efe02106778d44a469cc0fc8f6998167af7c9075a3ac605c150098c0f5243bb` |
| body (footer) | not used | `8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba` |
| wasm blob | `dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03` | `2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380` |
| model blob | `074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6` | `e76544838a98c46341ed8807f72897ec68de5a8a9bf28721738a76761c9df90e` |

The last 32 bytes of the file equal the body BLAKE3.
Both blob `blake3` values equal their labels in the archive.

### Push the holo
```
$ oras push --plain-http $R/prism/calculator:v1 --artifact-type application/vnd.uor.prism.holo.v1 \
    Calculator.holo:application/vnd.uor.prism.holo.v1
"layers":[{"mediaType":"application/vnd.uor.prism.holo.v1",
  "digest":"sha256:84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7","size":24801}]
[exit 0]   (both registries)
```

### cosign builds its own image subject
```
$ cosign attest --key cosign.key --signing-config no-tlog.json --predicate pred.json \
    --type https://uor.foundation/prism/proof/v1 $R/prism/calculator@$M
[exit 0]
$ cosign verify-attestation --key cosign.pub --insecure-ignore-tlog --type https://uor.foundation/prism/proof/v1 $R/prism/calculator@$M
[exit 0]
subject: [{"name":"127.0.0.1:15001/prism/calculator","digest":{"sha256":"1a20cd1b...ca25b9"}}]

$ cosign attest --key cosign.key --signing-config no-tlog.json --statement stmt-dual.json $R/prism/calculator@$M
Error: signing ...: predicate cannot be empty
[exit 1]   (same with --new-bundle-format=false)
```

### Plain referrer with oras
```
$ oras attach --plain-http --artifact-type application/vnd.in-toto+json $R/prism/calculator@$M \
    stmt-dual.json:application/vnd.in-toto+json
[exit 0]
$ oras discover --plain-http --format tree $R/prism/calculator@$M
|-- application/vnd.dev.sigstore.bundle.v0.3+json  sha256:10a55148...
|   dev.sigstore.bundle.predicateType: https://uor.foundation/prism/proof/v1
`-- application/vnd.in-toto+json  sha256:f2377d40...
[exit 0]
$ cosign tree --allow-http-registry $R/prism/calculator@$M
application/vnd.in-toto+json artifacts via OCI referrer: ...@sha256:f2377d40...
https://uor.foundation/prism/proof/v1 artifacts via OCI referrer: ...@sha256:10a55148...
[exit 0]
$ oras pull --plain-http -o pulled $R/prism/calculator@sha256:f2377d40... ; cmp stmt-dual.json pulled/stmt-dual.json
[exit 0]
subject: [{"name":"Calculator.holo","digest":{"sha256":"84371aaa...3486e7","blake3":"4efe0210...5243bb"}}]
```
On distribution, `oras repo tags` also lists `sha256-<manifest digest>`, the referrers tag fallback.

### cosign blob path
```
$ cosign attest-blob --key cosign.key --signing-config no-tlog.json --statement stmt-dual.json --bundle dual.sigstore.json
[exit 0]
$ cosign verify-blob-attestation --key cosign.pub --insecure-ignore-tlog --bundle dual.sigstore.json \
    --type https://uor.foundation/prism/proof/v1 Calculator.holo
Verified OK                                                         [exit 0]
blake3 only:                    no supported digest algorithms found [exit 1]
correct sha256, blake3 = 0x00..: Verified OK                          [exit 0]
key spelled "BLAKE3":           Verified OK                          [exit 0]
file with one byte appended:    provided artifact digests do not match digests in statement [exit 1]
blob statement, wasm blob file:  Verified OK                          [exit 0]
blob statement, model blob file: Verified OK                          [exit 0]
blob statement, whole file:      provided artifact digests do not match digests in statement [exit 1]
```

### Prism-signed bundle as an image referrer
The bundle was signed with `attest-blob --statement`.
It was attached with cosign's own referrer layout.
```
$ oras push ... --annotation org.opencontainers.image.created=1970-01-01T00:00:06Z ...
sha256:dce97d1c...e96527   (identical on zot and distribution)
$ oras attach --plain-http --artifact-type application/vnd.dev.sigstore.bundle.v0.3+json \
    --annotation dev.sigstore.bundle.content=dsse-envelope \
    --annotation dev.sigstore.bundle.predicateType=https://uor.foundation/prism/proof/v1 \
    $R/prism/calculator@$M6 registry.sigstore.json:application/vnd.dev.sigstore.bundle.v0.3+json
[exit 0]
$ cosign verify-attestation --key cosign.pub --insecure-ignore-tlog --type https://uor.foundation/prism/proof/v1 $R/prism/calculator@$M6
[exit 0]   (both registries)
subject: [{"name":"oci-manifest","digest":{"sha256":"dce97d1c...e96527"}},
          {"name":"wasm","digest":{"sha256":"dcf53677...334c03","blake3":"2adca3e7...a4a380"}},
          {"name":"model","digest":{"sha256":"07492189...3292c6","blake3":"e7654483...9df90e"}}]
```
Same check with subjects only on the holo file, no manifest subject:
```
Error: no matching attestations: ... provided artifact digest does not match any digest in statement
[exit 1]   (both registries)
```

### Kyverno
`kyverno.io/v1` ClusterPolicy with `verifyImages.attestations`:
```
bundle referrer only:             no matching attestations          [fail]
legacy cosign .att tag layout:    pass: 2, fail: 0                  [pass]
```
`policies.kyverno.io/v1` ImageValidatingPolicy with `verifyAttestationSignatures`:
```
manifest + blob subjects, zot:           pass: 1, fail: 0
manifest + blob subjects, distribution:  pass: 1, fail: 0
no attestation:                          fail: 1
holo-file subject only, no manifest:     fail: 1
```

### blake3 OCI descriptors
```
$ curl -X POST .../v2/prism/b3/blobs/uploads/            then
$ curl -X PUT --data-binary @Calculator.holo '<location>&digest=blake3:4efe0210...5243bb'
zot:          400 DIGEST_INVALID
distribution: 400 DIGEST_INVALID "digest parsing failed"
sha256 control upload: zot 201 Created, distribution 202 Accepted
```

## What each tool accepts

| Tool | `blake3` key in a subject | What it matches |
|------|---------------------------|-----------------|
| oras attach, discover, pull | Kept byte for byte | Nothing. The statement is an opaque blob. |
| cosign attest (image) | Cannot be written | cosign builds the subject: manifest sha256 only. `--statement` fails. |
| cosign attest-blob `--statement` | Kept | Signs any statement as given. |
| cosign verify-blob-attestation | Kept, never checked | sha256 of the given file. A blake3-only subject is rejected. |
| cosign verify-attestation (image) | Kept, never checked | Some subject's sha256 must equal the manifest digest. |
| cosign tree | Not read | Lists referrers on both registries. |
| Kyverno ClusterPolicy (deprecated) | Not reached | Reads only the legacy `.att` tag, not bundle referrers. |
| Kyverno ImageValidatingPolicy | Kept, never checked | Some subject's sha256 must equal the manifest digest. |
| zot, distribution | Not read | Store any statement. Both reject `blake3:` blob digests. |

## Consequences for #267, the attestation bundle
- A statement stored inside the `.holo` cannot name the whole file or its OCI manifest.
- Both digests would cover the statement itself, a circular dependency.
- So in-archive statements name content blobs, with `sha256` and `blake3` equal to the label.
- This matches #266, whose subject is the wasm blob.
- Offline, such a bundle verifies with `cosign verify-blob-attestation` against the extracted blob.
- Pushed unchanged as a referrer, it is discoverable but fails cosign and Kyverno image verification.
- So `prism push` signs a second, registry-facing statement after it builds the manifest.
- Its subjects are the OCI manifest with `sha256`, then the same blobs with both keys.
- Its predicate repeats or references the in-archive one; #267 decides which.
- The push manifest must be deterministic: fixed artifact type, media types and `org.opencontainers.image.created`.
- Then one registry-facing statement verifies on every registry. The test produced one digest on both.
- Prism needs its own DSSE signer that writes Sigstore bundle v0.3. cosign cannot sign custom image subjects today.
- The referrer manifest copies cosign's layout: artifact type `application/vnd.dev.sigstore.bundle.v0.3+json`.
- It also carries the annotations `dev.sigstore.bundle.content` and `dev.sigstore.bundle.predicateType`.

## Consequences for #263, the spec package
`@prism/spec` encodes this shape:

```ts
/** Lowercase hex, 64 characters: ^[0-9a-f]{64}$ */
export type Hex256 = string;

/** Both digests cover the same bytes. For a content blob, blake3 equals its label. */
export interface PrismDigestSet {
  sha256: Hex256;
  blake3: Hex256;
}

/** A content blob of the archive. */
export interface BlobSubject {
  name: string;
  digest: PrismDigestSet;
}

/** The OCI manifest. Registries cannot hold blake3, so sha256 only. */
export interface OciManifestSubject {
  name: 'oci-manifest';
  digest: { sha256: Hex256 };
}
```

- The JSON Schema forbids extra keys in `PrismDigestSet`.
- The spec package also fixes the holo media type. This test used the placeholder `application/vnd.uor.prism.holo.v1`.
- It also fixes the deterministic push-manifest template described above.

## Open risks
- Only local zot and distribution were tested. GHCR, Docker Hub and ECR were not.
- Only key-based signing was tested. Keyless Fulcio and Rekor signing was not.
- No third-party tool checks `blake3`. A wrong value beside a correct sha256 verified in cosign.
- So only Prism's own verifier protects the `blake3` value.
- cosign 3.1.4 `attest --statement` fails on images with "predicate cannot be empty". An upstream issue is worth filing.
- Kyverno ClusterPolicy is deprecated and ignores bundle referrers. Clusters on it cannot verify Prism attestations.
- `blake3` in OCI descriptors exists only on image-spec `main`. Revisit when a release ships and registries accept it.
- in-toto does not predefine `blake3`. This record documents the encoding, as the DigestSet spec requires.
- An upstream in-toto/attestation PR adding `blake3` would remove the ambiguity.
- cosign accepted a key spelled `BLAKE3`. Prism verifiers must reject any spelling but lowercase `blake3`.

## References
- Issue #274; consumers #263, #266, #267.
- in-toto attestation `spec/v1/digest_set.md` and `spec/v1/statement.md`.
- OCI image-spec `descriptor.md`, registered algorithms; commit `4fecf47e` adds `blake3`.
- `sdk/npm/prism-code/src/archive.mjs`: footer and blob label checks.
