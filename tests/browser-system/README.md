# Browser-system source fixture

`Release.lex.tex` models A/B releases for the Calculator selected through this
fixture's LexLean configuration. Both models and manifests bind
`sha256:de510ca735a4394615c29194f3d7b3bcafe3b7b46da6e1b126423df4ce619e4b`.

The original source-selection owner reported this digest in a genuine PP2101
refusal (pr184-c07-browser-selected-source-diagnostic-v1-20261014). The four bindings were explicitly
updated; verification never repairs stale source or removes negative controls.

Run in a Docker-enabled devcontainer with the immutable imported-oracle image
available to its daemon (no image pull is performed by the oracle runner):

```sh
export PRISMPM_TEST_SDK_IMAGE=ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:60226bc791d4c0e5613402a6be7e63f4963d3faf7f327befcf56fc0e41d0ce21
cargo test --locked --offline -p prismpm --lib browser_system_ -- --nocapture --test-threads=1
cargo xtask conformance system-oci
```

All three original owners must pass, including named A/B proofs, real SPDX
oracles and source-free export. These source checks do not qualify the installed
SDK, Foundry deployment or release. The image supplies imported oracle tooling
only; it is not accepted as the current SDK. Historical evidence remains in Git
history.
