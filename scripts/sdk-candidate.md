# Development-only SDK candidate publication

The manually dispatched `sdk-candidate.yml` workflow publishes only from `main`
through the main-only `sdk-candidate` environment. Native, unprivileged build jobs
test each exact OCI image and record its raw inventory and successful locked
standards resolution. Each build job first removes the hosted runner's .NET,
Android, GHC and CodeQL toolchains, which no step uses, so that the image and the
tar the SBOM scan saves of it fit on the amd64 runner's disk. The credentialed
publisher never executes candidate code.
Its ORAS 1.3.0 and Cosign 3.1.3 binaries are downloaded independently and checked
against fixed upstream SHA-256 values.

The multi-platform SDK index retains GitHub build provenance. Each platform's
**complete, unchanged SPDX 2.3 document** is a separate signed OCI 1.1 SBOM
artifact, not an inline SPDX attestation:

1. `sbom-record` binds the original SPDX bytes, counts, image-child digest,
   source revision, inventory, standards lock and smoke evidence before upload.
2. The OCI manifest has the exact platform image as its `subject`, an empty OCI
   config, and one `application/spdx+json` layer binding the full raw SHA-256 and
   byte length. Its annotations bind the source, workflow, platform and evidence.
3. Cosign signs that manifest digest with GitHub OIDC and normal transparency-log
   verification. The publisher immediately verifies the exact certificate issuer,
   workflow identity, repository, source SHA, `main` ref and dispatch trigger.
4. The publisher downloads the manifest and complete SPDX layer again and checks
   their raw digests, lengths, exact manifest contents and original document
   counts. Missing signatures, documents or mismatched bindings fail publication.

No fields, packages, files, relationships or license text are removed or split.
The failed run [35059468070](https://github.com/UOR-Foundation/prismpm/actions/runs/35059468070)
produced a 26,732,935-byte AMD64 SPDX document; compaction saved only one byte.
GitHub's inline predicate transport has a 16 MiB limit. Signing the small OCI
manifest preserves the complete document without submitting a large inline
predicate to either GitHub's attestation API or the transparency service.

The `sdk-candidate-reference` artifact retains the image/index reference, both
original evidence directories, raw SPDX, signed manifests, signature bundles,
verification output and `sbom-artifact.json` descriptors. To independently verify
one downloaded platform directory against an independently known source SHA and
platform-child digest, use the checked-out workflow source and pinned tools:

```sh
node scripts/sdk-candidate.mjs sbom-verify "$EVIDENCE_DIRECTORY" \
  "$ARCHITECTURE" "$SOURCE_SHA" "$CHILD_MANIFEST_DIGEST" \
  standards/trust/sigstore-trusted-root-cosign-3.1.3.json
```

This performs live cryptographic registry verification and refetches all SPDX
bytes; it does not trust a saved success flag. Private GHCR packages require
authorized read access, or an owner must explicitly make the candidate package
public. The workflow does not change package visibility.

`node --test scripts/sdk-candidate.test.mjs` is included in the ordinary SDK gate.
It includes a real ORAS **layout-only** >16 MiB roundtrip, malformed/missing/
truncated/wrong-subject evidence negatives, exact signing-policy tests and real
offline Sigstore identity/issuer/digest negatives using an authoritative signed
upstream fixture. Actual GitHub OIDC issuance and GHCR signature discovery are
the hosted publication gate, not a claim made by these local component tests.

Every candidate record and signed manifest states development-only and no
production acceptance. Candidate publication does not grant production release,
full VV, public Cargo qualification, downstream acceptance or deployment.
