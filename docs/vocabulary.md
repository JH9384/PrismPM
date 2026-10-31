# Prism vocabulary

Prism uses Docker's model. The names differ; the roles do not. A model is
built into an immutable, digest-pinned holo. A registry stores it and a runtime
runs it. Every Prism document and issue uses the terms on this page.

Today's command is `prismpm`. The v1.0 roadmap renames it `prism`. Read
`prismpm build` and `prism build` as the same command.

## Nouns

| Prism term | What it is in PrismPM | Docker equivalent |
| --- | --- | --- |
| model | The LexLean source: a closed `.lex.tex` graph plus `lexlean.lock`, for example `examples/Calculator/src/Calculator.lex.tex` ([SPEC §1.2](../SPEC.md#12-formal-source-and-dependency-boundary)). | Dockerfile |
| holo | The binary `ApplicationName.holo` archive, Hologram archive version 4. It is addressed by application name or by its BLAKE3 archive fingerprint ([SPEC §3](../SPEC.md#3-canonical-holo-contract)). | image, tag + digest |
| section fingerprint | The `blake3:` label that prefixes each content blob in a holo: capability set, Core-Wasm guest, model document, HOLOVIEW bundle ([SPEC §3](../SPEC.md#3-canonical-holo-contract)). | layer digest |
| archive fingerprint | The 32-byte BLAKE3 footer over every byte before it ([SPEC §3](../SPEC.md#3-canonical-holo-contract)). | image digest |
| SDK image | The digest-pinned Linux OCI index (`linux/amd64`, `linux/arm64`) with LexLean, Lean 4, rustc and wasm-bindgen, built from [`sdk/Dockerfile`](../sdk/Dockerfile) ([SPEC §1](../SPEC.md#1-repository-scope-and-project-configuration)). | base image |
| `prismpm.lock` | The project lock. Its `sdk_image` field names the SDK image by immutable digest ([SPEC §13](../SPEC.md#13-oci-product-release-graph)). | pinned `FROM image@sha256:...` |
| `prism-code` runtime | The JavaScript runtime: `load` opens and verifies a holo, `dispatch` runs one request on the guest. See [`sdk/npm/prism-code`](../sdk/npm/prism-code/README.md). | container runtime |
| instance | A loaded, verified, running holo. `prism-code` runs each request on a fresh guest instance. `prism.containers` and `prism-code run <holo> <input>` record one run as a container: created, running, exited, with an exit code and its output. | container |
| browser export | The six-file browser closure written by `prismpm export-browser` ([README](../README.md#development-and-acceptance)). | exporter output (`--output`) |
| registry | Any OCI Image and Distribution 1.1 registry. `prismpm push` and `prismpm pull` move releases by digest ([SPEC §13](../SPEC.md#13-oci-product-release-graph)). | registry |
| product release | The root OCI artifact, config `prismpm/product-release/1`, that references the holo, packages, locks and evidence by digest ([SPEC §13](../SPEC.md#13-oci-product-release-graph)). | image manifest or index |
| model document | `model.prism.json`, the canonical Prism model document. It is a separate file and a content blob inside the holo ([SPEC §3](../SPEC.md#3-canonical-holo-contract), [§6](../SPEC.md#6-build-artifacts-and-identities)). | image config |
| provenance | The `prismpm/model-provenance/1` extension inside the holo and the build `manifest.json` in the build tree ([SPEC §3](../SPEC.md#3-canonical-holo-contract), [§6](../SPEC.md#6-build-artifacts-and-identities)). | BuildKit provenance attestation |
| build tree | `<build_root>/build/<prism-build-id>/`, keyed by the SHA-256 Prism build ID ([SPEC §6](../SPEC.md#6-build-artifacts-and-identities)). | build cache entry |
| world | Planned. The WIT contract the guest imports and exports. | none; nearest is the image's `ENTRYPOINT` and `EXPOSE` contract |
| capability set | Planned as deny-by-default permissions. Today a holo carries a canonical capability-set blob, empty for text applications ([SPEC §3](../SPEC.md#3-canonical-holo-contract)). | `--cap-add`, seccomp profile |
| provider | An executable, `prism-provider-<type>` on the PATH, that provisions what a capability in `prism.toml` declares and returns `<NAME>_<VAR>` variables ([proposal](proposals/294-provider-services.md)). | Compose provider service |
| attestation | Planned for the holo: an in-toto statement about it. Product releases already carry in-toto and SLSA referrers ([SPEC §13](../SPEC.md#13-oci-product-release-graph)). | BuildKit attestation |
| proof | Planned. The `prism/proof/v1` in-toto predicate: which theorems the Lean kernel checked for the shipped guest ([proposal](proposals/266-proof-predicate.md)). | none |
| history | `prism/history/1`: the dispatches of one application in order, each with its recorded outcome. Acceptance vectors are its first source ([proposal](proposals/284-histories-replay.md)). | none; nearest is `docker logs` |

## Verbs

| Prism verb | PrismPM command today | Docker verb |
| --- | --- | --- |
| build | `prismpm build` writes the build tree and holo. `prismpm build --release NAME` builds a product release ([SPEC §6](../SPEC.md#6-build-artifacts-and-identities)). | `docker build` |
| check | `prismpm check` validates the model in memory and writes nothing ([SPEC §4](../SPEC.md#4-controller-api-cli-and-diagnostics)). | `docker build --check` |
| verify | `prismpm verify` checks the Lean proofs and runs the holo's acceptance vectors in an independent oracle ([SPEC §1.3](../SPEC.md#13-compiler-pipeline)). | none |
| run | `prismpm run REF` runs a release through its modeled Compose target. `prism-code run app.holo` serves one holo ([`prism-code`](../sdk/npm/prism-code/README.md#run-it)). | `docker run` |
| push / pull | `prismpm push REF`, `prismpm pull REF` move a product release ([SPEC §13](../SPEC.md#13-oci-product-release-graph)). `prism-code push <holo> REF` and `prism-code pull REF` move one holo and its attestations ([proposal](proposals/292-push-pull-oci.md)). | `docker push`, `docker pull` |
| inspect | `prismpm inspect REF` for a product release and `prismpm inspect <path.holo>` for one holo. `hologram holo inspect` and `prism-code inspect` also read a holo. | `docker inspect` |
| replay | `prismpm replay HISTORY --holo PATH` and `prism-code replay HISTORY --holo PATH` re-execute a history against a build and fail on divergence ([proposal](proposals/284-histories-replay.md)). | none |
| export | `prismpm export-browser REF --output DIR` ([README](../README.md#development-and-acceptance)). | `docker build --output` |
| lock / update | `prismpm lock` writes or refreshes the pinned inputs in `prismpm.lock` without building. `prismpm update --toolchain REF` pins a new SDK image and prints the old and new digests. `prismpm lock check` verifies the lock, and `prismpm lock update` proposes a new pin and does not apply it. | `npm install` and `npm update`, or editing the `FROM ...@sha256:` pin |
| deploy | `prismpm plan` then `prismpm deploy` through the Compose or Kubernetes adapter ([SPEC §15](../SPEC.md#15-target-planning-and-deployment)). | `docker compose up`, `docker stack deploy` |

`REF` is a registry-qualified immutable reference, `NAME@sha256:DIGEST`. `prism-code push` and `pull` also take `NAME:TAG`, `NAME@blake3:FINGERPRINT` and `dir://PATH`.

## The stack

UOR-Atlas generates LexLean. LexLean establishes meaning; PrismPM establishes
intent. Every LexLean build uses the
[prism-stdlib](../SPEC.md#5-prism-stdlib-contract). The output is one holo.
A user runs it, a developer rebuilds it, and a security officer audits it.

The roadmap is the [Prism SDK v1.0 board](https://github.com/orgs/UOR-Foundation/projects/12).
