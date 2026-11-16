# Proposal 292: `push` and `pull` with OCI referrers

| | |
| --- | --- |
| Issue | [#292](https://github.com/UOR-Foundation/PrismPM/issues/292) |
| Milestone | M4 v1.0-beta.1 Freeze, ship, docs |
| Status | Proposed, Experimental |
| Depends on | #267 and PR 369 (the attestation section), #274 (ADR-015, dual digests), #272 (signing), #276 (`holo.verify()`), #270 (`check`), ADR-016 (canonical bytes) |
| Unblocks | #314 (`prism export --oci`), #349 (`images`, `tag`, `rmi`), #296 (local MCP tools) |
| Precedent | `docker push`, `docker pull`, `docker save`; `oras push`, `oras attach`, `oras discover`; cosign v3 bundles as OCI 1.1 referrers |
| Reference implementation | JavaScript: `sdk/npm/prism-code/src/oci-*.mjs`, `src/push-pull*.mjs`. Rust: not in this change. |

## Summary

`prism-code push <holo> <reference>` puts a holo in any OCI Distribution 1.1 registry, or in a local directory.
`prism-code pull <reference> [<out.holo>]` brings it back, and writes nothing until it has verified what it fetched.
The holo is one layer of a deterministic OCI manifest, so the same bytes give the same manifest digest on every registry.
Each attestation line of the holo becomes one referrer of that manifest, with the same bytes.
With a signer, `push` also signs one registry-facing statement for each predicate, whose subject names the manifest, because that is what `cosign verify-attestation` needs (ADR-015).
A BLAKE3 fingerprint is a pull address too: `repo@blake3:<hex>` resolves through a `blake3-<hex>` tag and is checked against the bytes.

## Motivation

A holo already carries its own evidence, and `attest`, `verify-attestation` and `check` read it.
Nothing moves it between machines, and no third-party tool can see the evidence without the file.
Docker's model needs a registry: the holo is the image, the fingerprint is the digest, and the registry ships it.
The done criterion is interoperability, so the registry objects follow what cosign and ORAS already do.

### Goals

- Push to a stock registry, including one with only the referrers tag fallback, with no Prism-specific server support.
- `cosign verify-attestation` and `oras discover` work on the pushed reference.
- `pull` refuses, before it writes a byte, anything that fails digest, archive, verdict or signer checks.
- A local directory is a first-class endpoint and a valid OCI image layout.
- A client with no required dependency, over `fetch`.

### Non-goals

- Folding registry referrers back into the holo's attestation section (#267 question 1). A pulled file keeps the bytes it was pushed with.
- The image-store verbs `images`, `tag` and `rmi` (#349), and `export --oci` (#314). This change gives them the store and the manifest.
- The Rust CLI. `prismpm push` and `prismpm pull` keep moving product releases (SPEC section 13).
- Reading cosign's legacy `.sig` and `.att` tags. cosign v3 writes bundles as referrers.

## Proposal

### The OCI manifest of a holo

| Field | Value |
| --- | --- |
| `schemaVersion` | `2` |
| `mediaType` | `application/vnd.oci.image.manifest.v1+json` |
| `artifactType` | `application/vnd.uor.prism.holo.v1` |
| `config` | The OCI empty descriptor: `application/vnd.oci.empty.v1+json`, the 2-byte `{}`, `data: "e30="` |
| `layers[0].mediaType` | `application/vnd.uor.prism.holo.v1` |
| `layers[0].digest`, `size` | `sha256` and length of the whole `.holo` file, attestation section included |
| annotation `org.opencontainers.image.created` | `1970-01-01T00:00:00Z`, fixed |
| annotation `org.opencontainers.image.title` | The application name |
| annotation `foundation.uor.prism.holo.fingerprint` | `blake3:<footer>`, the archive fingerprint |
| annotation `foundation.uor.prism.holo.application` | `application_kappa`, when the holo names one |
| layer annotation `org.opencontainers.image.title` | `<application name>.holo` |
| layer annotation `foundation.uor.prism.digest.blake3` | BLAKE3 of the whole file: the same bytes as the layer's `sha256` |

The bytes are `canonicalJson`: sorted keys, no whitespace.
Every value is a function of the holo's bytes, never of a clock, a path or a reference, so the manifest digest is too.
This is the deterministic template ADR-015 asks for.
A test holds the bytes for the reference holo against a committed fixture.

Two BLAKE3 values appear because they name different bytes (ADR-015 rules 9 and 10).
The footer is BLAKE3 of the body, the fingerprint Prism uses everywhere else.
`foundation.uor.prism.digest.blake3` covers the same bytes as the descriptor's `sha256`, so the pair is a dual digest in the ADR's sense.
Every OCI descriptor stays `sha256`: registries refuse `blake3:` digests (ADR-015 rule 11 and its evidence).

The layer is the file exactly as ADR-016 frames it.
`push` refuses an archive whose footer or section labels do not verify, and a statement whose subject digests do not match a content blob.

### Each attestation as a referrer

Rule 10 of #267: each line of the attestation section becomes one referrer whose layer is that line, without its LF.

| Field | Value |
| --- | --- |
| `artifactType` | `application/vnd.dev.sigstore.bundle.v0.3+json` |
| `config` | The OCI empty descriptor |
| `layers[0].mediaType` | `application/vnd.dev.sigstore.bundle.v0.3+json` |
| `subject` | The holo manifest's descriptor, `sha256` |
| annotation `dev.sigstore.bundle.content` | `dsse-envelope` |
| annotation `dev.sigstore.bundle.predicateType` | The statement's `predicateType` |
| annotation `org.opencontainers.image.created` | `1970-01-01T00:00:00Z`, fixed |

This is cosign's own layout, recorded in ADR-015.
Such a referrer is discoverable and `cosign verify-blob-attestation` accepts it against the extracted blob.
`cosign verify-attestation` does not, because its subjects name content blobs and an in-holo statement cannot name the manifest that covers it.

So a signer is needed for the done criterion.
With `--key` or `--keyless`, `push` signs one more statement per distinct predicate in the holo, after the manifest digest is known:

- `subject[0]` is `{ "name": "oci-manifest", "digest": { "sha256": "<manifest>" } }`.
- The other subjects are the in-holo statement's blob subjects, with both digests.
- `predicateType` and `predicate` repeat the in-holo statement's.

ADR-015 left "repeats or references" open; this proposal repeats, because a verifier reading the referrer then needs nothing else.
The statement is a referrer in the same layout and is never written into the holo.
A holo with no attestations has nothing to re-sign, and `push` says so.
Without a signer `push` warns that `cosign verify-attestation` will not find a statement about the manifest.

`--no-attestations` pushes only the holo's manifest.
The section stays in the file, because removing it would change the digest.

### The referrers API and its fallback

A registry that indexes `subject` answers the manifest `PUT` with an `OCI-Subject` header, and nothing else is needed.
Otherwise the client maintains the referrers tag `sha256-<hex>` of the distribution spec: read the index at that tag, add the descriptors, put it back.
Reading tries `GET /v2/<name>/referrers/<digest>` first and falls back to the same tag on a 404.
This is not an edge case: the CNCF `distribution` registry used in ADR-015 relies on the fallback.

`ReferrersUnsupportedError` is raised when neither path works: the tag cannot be read or written, or the SDK caller set `referrersFallback: false` and the API is absent.

Two writers updating the same fallback tag at once can lose a descriptor.
The spec's read-modify-write has this race, and ORAS and cosign share it.
The referrer manifests survive, and a push re-run restores the index.

### Order of a push

1. Check the holo: footer, labels, every attestation line, every subject against its blob.
2. Upload the config and the holo layer, skipping a blob the registry already has.
3. Put the manifest by digest.
4. Put each referrer and, if needed, the fallback index.
5. Put the manifest at its tag and at `blake3-<footer>`.

A tag therefore never names a holo whose attestations are still on the way.

### The local directory store

The store is an OCI image layout, so `oras` reads it with `--oci-layout`, and other OCI tools can too.

```text
store/
  oci-layout                 {"imageLayoutVersion":"1.0.0"}
  index.json                 every manifest of the store, as descriptors
  blobs/sha256/<hex>         manifests, configs, layers, content-addressed
```

Each tagged manifest is one descriptor in `index.json`, shaped as `docker save` writes it:

| Annotation | Value |
| --- | --- |
| `org.opencontainers.image.ref.name` | The tag: `v1` |
| `io.containerd.image.name` | The full name, when one was given: `calculator:v1` |
| `foundation.uor.prism.holo.fingerprint` | `blake3:<footer>` |

Referrers are listed as untagged descriptors carrying `artifactType`, because a layout has no referrers API and tools build the graph from `index.json`.
Moving a tag leaves the old manifest listed untagged, so its digest reference still resolves, as it does in a registry.
`index.json` is sorted and canonical, and writes are atomic: a blob goes through a temporary file and a rename, and `index.json` is replaced last.
Every read recomputes `sha256`.

#349 can use this directly: `images` is `store.list()`, `tag` is `store.tag()`, and `rmi` needs only a garbage collection pass over `index.json`.

### References

```text
reference   = registry "/" repository [ ":" tag ] [ "@" digest ]
store       = "dir://" path [ ":" tag | "@" digest ]
digest      = "sha256:" 64*hex | "blake3:" 64*hex
```

| Form | Means |
| --- | --- |
| `ghcr.io/acme/calculator:1.0` | A tag; `latest` when none is given. |
| `ghcr.io/acme/calculator@sha256:<hex>` | The manifest digest. A tag next to a digest is ignored on pull, as in Docker. |
| `ghcr.io/acme/calculator@blake3:<hex>` | The archive fingerprint, pull only. |
| `dir://./store:v1`, `dir://./store@sha256:<hex>` | A local store, addressed by tag or digest. The last `:` starts the tag, except a drive letter's. |
| `--store ./store calculator:v1` | A local store, addressed by full name. |

`repository` and `tag` follow the distribution spec's grammar.
A component is a registry when it holds a `.` or a `:`, or is `localhost`, which is Docker's rule.
Unlike Docker, a bare `calculator:v1` is refused for a registry: Prism has no default registry, and pushing somewhere by surprise is worse than typing the host.
`docs/vocabulary.md` already calls `REF` registry-qualified.

**How a BLAKE3 fingerprint maps.**
Registries cannot store or look up `blake3:` digests.
`push` therefore also tags the manifest `blake3-<footer>`, the same shape as the spec's `sha256-<hex>` referrers tag, and `pull repo@blake3:<hex>` reads that tag.
A tag is mutable, so the tag proves nothing: `pull` recomputes the footer of the bytes it fetched and refuses a mismatch.
The address is content-verified, as a digest is.
In a store the fingerprint is looked up in `index.json` and verified the same way.

`dir://` also works as either end of a copy.
`pull ghcr.io/acme/app:1 dir://./store:1` verifies and then stores the holo with all its referrers, and `push dir://./store:1 ghcr.io/acme/app:1` publishes it again with the same manifest digest.
This is the offline path.

### Authentication

In this order:

1. `credentials` passed to the SDK call.
2. Docker's config, `$DOCKER_CONFIG/config.json` or `~/.docker/config.json`: `credHelpers`, then `auths`, then `credsStore`. Helpers are `docker-credential-<name> get`. `docker.io` looks up `https://index.docker.io/v1/`.
3. For `ghcr.io` only: `GHCR_TOKEN`, then `GITHUB_TOKEN`.
4. Anonymous.

A failing credential helper counts as no credential, so a stale `credsStore` does not block a public pull; a 401 then explains what was tried.
There is no flag that takes a token, so one never appears in a process list.

The client follows the registry's challenge: `Bearer` exchanges the credential at the `realm` for a token with the `scope` asked for, and `Basic` sends it directly.
Credentials are never sent over plain `http` except to a loopback address.
The ambient GitHub token goes only to a `ghcr.io` realm.
A blob redirect drops `Authorization` at the origin change, and an upload `Location` on another origin gets none.
Loopback registries use plain `http` by default; any other needs `--plain-http`.

### What `pull` verifies before it writes

Everything is held in memory until every step passes. The write is a temporary file and a rename.

| Step | Check | Refusal |
| --- | --- | --- |
| 1 | The manifest's `sha256` equals the digest asked for, and `Docker-Content-Digest` if sent | `DigestMismatchError` |
| 2 | One holo layer, of the holo media type, within the size bound | `PullVerificationError`, `pull.manifest`, `pull.size` |
| 3 | The layer's size and `sha256` equal its descriptor | `DigestMismatchError` |
| 4 | The archive parses; footer and every section label verify | `DigestMismatchError`, `pull.archive` |
| 5 | The BLAKE3 annotations, and a `@blake3:` address, equal what the bytes give | `DigestMismatchError` |
| 6 | Every attestation line decodes, and every subject matches its blob | `PullVerificationError`, `pull.attestation` |
| 7 | The verdict of `check` passes the policy | `PullVerificationError`, `pull.verdict`, with the whole verdict |
| 8 | With a signer policy, at least one bundle passes it | `PullVerificationError`, `pull.signer`, with the cause |

**The policy.**
`--policy <file>` is the file `check` reads, and the verdict is `check`'s, so `pull` and `check` cannot disagree.
Without it the policy is `pull-default`, minimum P0 unless `PRISM_MINIMUM_LEVEL` says otherwise.
The default is lower than `check`'s P2 on purpose: every holo is P0 today, so a P2 default would refuse every pull.
`run` still gates at P2 when the holo is used.
A pull that passes P0 has still passed every integrity and document check in the verdict.

**The attestation section and the verdict.**
Since #270, `check` judges a holo with an attestation section by the statements in it, each counting only when its signature verifies against the signer the caller names, and step 7 is that verdict.
So with a signer a holo can reach P1 or P2 in a pull, and without one a signed holo is P0.
The verdict's `holo` field is the fingerprint of the file as given, the `fingerprint` the pull reports.
Referrers do not raise the level, because they are about the manifest and not part of the holo. Step 8 judges them.

**The signer policy.**
`--key`, or `--certificate-identity` (or `--certificate-identity-regexp`) with `--certificate-oidc-issuer`, are the flags of `verify-attestation`.
`--type` narrows it to one predicate.
Bundles from the file go through `experimental_verifyAttestations`; referrers go through `experimental_verifyBundle` after their subjects are checked: a subject's `sha256` equals the manifest digest, or every subject is a blob of this holo.
One passing bundle is enough, as in cosign.
Without a signer policy, signatures are not checked and the output says so, because a signature by an unnamed signer proves nothing.

### Output

Docker's shape, with the identities Prism adds:

```text
$ prism-code push Calculator.holo localhost:5000/prism/calculator:v1 --key cosign.key
The push refers to repository [localhost:5000/prism/calculator]
84371aaac82a: Pushed
5f3b2c1d0e9a: Attached https://slsa.dev/provenance/v1
1c9e0d7a2b44: Signed https://slsa.dev/provenance/v1
v1: digest: sha256:1a20cd1b... size: 712
fingerprint: blake3:8408e089...
```

```text
$ prism-code pull localhost:5000/prism/calculator:v1
v1: Pulling from prism/calculator
84371aaac82a: Pull complete
Digest: sha256:1a20cd1b...
Fingerprint: blake3:8408e089...
Verdict: P0, policy pull-default requires P0
Attestations: 1 in the holo, 2 referrers, signatures not checked
Status: Verified and wrote calculator.holo
localhost:5000/prism/calculator@sha256:1a20cd1b...
```

`--json` prints one canonical object, `prism/push-result/1` or `prism/pull-result/1`, and only on success.

### Errors and exit codes

| Class | Code | `check` |
| --- | --- | --- |
| `RegistryAuthError` | `registry_auth_failed` | `registry.auth`, `registry.denied`, `registry.insecure` |
| `ReferrersUnsupportedError` | `referrers_unsupported` | `referrers.api`, `referrers.tag` |
| `DigestMismatchError` | `digest_mismatch` | `digest.manifest`, `digest.blob`, `digest.push`, `digest.annotation`, `digest.fingerprint`, `pull.archive` |
| `PullVerificationError` | `pull_verification_failed` | `pull.manifest`, `pull.size`, `pull.verdict`, `pull.attestation`, `pull.signer` |
| `ManifestNotFoundError` | `manifest_not_found` | `registry.manifest`, `store.reference` |
| `RegistryError` | `registry_failed` | `registry.unreachable`, `registry.status`, `registry.size`, `registry.upload`, `store.layout`, `store.blob`, `store.ambiguous` |
| `ReferenceInvalidError` | `reference_invalid` | `reference.*` |

| Exit | Means |
| --- | --- |
| 0 | Done. |
| 1 | A digest did not match, or the pull failed verification. Nothing was written. |
| 2 | No answer: the registry cannot be reached, credentials were refused, the reference does not exist, the referrers cannot be stored. |
| 3 | The registry-facing statement could not be signed, or the `sigstore` packages are missing. |
| 64 | Usage, or an invalid reference. |

## Evidence

Run on 2026-10-30 on Windows 11 with Node 24.22.2, against a real CNCF `distribution` 3.1.2 with in-memory storage, cosign 3.1.4 and ORAS 1.3.4.
The holo is the Calculator reference archive, attested with a throwaway P-256 key.

```text
$ prism-code push signed.holo 127.0.0.1:15500/prism/app:v1 --key private.pem
The push refers to repository [127.0.0.1:15500/prism/app]
1a7acae69a14: Pushed
2478535854ac: Attached https://uor.foundation/prism/proof/v1
caa3e1769104: Signed https://uor.foundation/prism/proof/v1
v1: digest: sha256:e05aadbbc3fc395a3e3a73119820bb0df1a1107da1a6e9b881d174f2c34666b6 size: 968
fingerprint: blake3:5bd47a98bf403e1bef8053e85af22ac5785e5c407e2af615d5b629996c15fc71
[exit 0]

$ cosign verify-attestation --key public.pem --insecure-ignore-tlog --allow-http-registry --type https://uor.foundation/prism/proof/v1 127.0.0.1:15500/prism/app:v1
[exit 0]
subject: [{"name":"oci-manifest","digest":{"sha256":"e05aadbb...4666b6"}},
          {"name":"guest","digest":{"sha256":"dcf53677...334c03","blake3":"2adca3e7...a4a380"}}]

$ oras repo tags --plain-http 127.0.0.1:15500/prism/calculator
blake3-34373150...0b603c
sha256-7829d7bd...e028c
v1

$ curl http://127.0.0.1:15500/v2/prism/calculator/referrers/sha256:0000...
404, so this registry uses the tag fallback

$ prism-code pull 127.0.0.1:15500/prism/app:v1 bad.holo --key other.pem
pull_verification_failed: no attestation of this holo passes the signer policy: signature_invalid: signature verification failed
[exit 1], and bad.holo does not exist
```

Running this against cosign found a defect in #272: `@sigstore/sign` writes the key's hash as the DSSE `keyid`, and cosign skips a signature whose `keyid` is not its own, so a keyed bundle verified nowhere but in `prism-code`.
`attest --key` and `push --key` now write an empty `keyid`, and the hint in the verification material still names the key.

| Tests | What they hold |
| --- | --- |
| `test/oci-manifest.test.mjs` | The manifest and referrer bytes of the reference holo equal committed fixtures and are canonical. |
| `test/oci-reference.test.mjs` | The grammar, including every refusal. |
| `test/push-pull.test.mjs` | The directory store end to end, with a keyed signature and tampering at each layer. |
| `test/oci-registry.test.mjs` | The client against an in-process registry that can answer with the API or the fallback, challenge with `Bearer` or `Basic`, and lie about digests. |
| `test/oci-live.test.mjs` | A real `distribution`, from a container when Docker is present or from `PRISM_TEST_REGISTRY` when set, skipped otherwise; with `cosign` and `oras` on the PATH it also runs them. The run above passed all six. |
| `.github/workflows/oci-interop.yml` | `registry:2.8.3` and `registry:3.0.0` with cosign and ORAS on pull requests that touch this code, and GHCR with a keyless signature on manual dispatch. |

## What is not done

- The GHCR half of the done criterion has not been run. It runs only when someone dispatches the workflow, because it needs the repository's package permission and asks Sigstore for a certificate. Keyless signing at push is therefore tested only by that job.
- `registry:2.8.3` has not been run either: Docker was unavailable where this was written, so only `distribution` 3.1.2 is evidence so far. The interop workflow runs it.
- Conformance ID `HO-28`, which PR 369 reserves for `prism push`, is not registered: a new ID needs a case in `crates/conformance`, and that is Rust side work. The tests above are its oracle.
- `pull` does not write referrers next to an output file. `pull <ref> dir://<store>` keeps them.
- A resumable or chunked upload: a blob is one `PUT`, which is enough for a holo.

## Alternatives

- A second layer for each bundle in the holo's own manifest. Rejected: `oras discover` and cosign look for referrers, and bundles could not be added without changing the digest.
- An OCI index with the holo and its attestations, as BuildKit does. Rejected: it needs a platform-shaped wrapper around something with no platform, and cosign's bundle layout is referrers.
- A `blake3:` descriptor. Rejected by ADR-015: both tested registries answer 400.
- A separate lookup service or sidecar index for fingerprints. Rejected: the tag needs no server support and the bytes verify it.
- Signing inside the registry path by shelling out to cosign. Rejected: cosign cannot sign a statement with a custom subject on an image (ADR-015).
- Defaulting the registry to Docker Hub. Rejected above.

## Open questions

1. Should the holo media type gain a `+holo` suffix before the freeze? It is ADR-015's value today.
2. Should `pull` default to a stricter policy once holos carry signed statements? It should follow `check`'s default when P1 and above are reachable.
3. Should `push` skip re-signing when a statement by the same signer already exists? Today a re-push with a non-deterministic signature adds one more referrer.
