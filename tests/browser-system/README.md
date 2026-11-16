# Browser-system source fixture

`Release.lex.tex` models A/B releases for the language-1.2 `Calculator.lex.tex`
beside it, selected through this fixture's LexLean configuration (which also
declares the `prism.arch` lexicon the stdlib modules title themselves from).
Both models and manifests bind
`sha256:d8f3554cb0d5704362b3be3d398d4aceba85b77940bd51649e8f676509f10a03`.

The installed SDK reported this digest in a genuine PP2101 refusal when the
installed product check first assembled this fixture with its own Calculator
(the earlier binding named the language-1.1 example's model). The four bindings
were explicitly updated; verification never repairs stale source or removes
negative controls.

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
