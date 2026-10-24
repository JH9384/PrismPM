# Host-effect system source fixture

`Release.lex.tex` models the `mcp-loopback` service in the shape of
UOR-Foundation/lexlean-mcp#17: a gateway (`api`) that publishes one port on
`127.0.0.1`, an engine host and a signer (`worker`), a verifier (`job`) and a
telemetry collector. Image names and digests, effect names and the port are
illustrative; the real values come from lexlean-mcp's own declaration.

The fixture is imported by the Calculator application of `tests/browser-system`
and binds that application's model digest. The Calculator is a stand-in: the
server application of UOR-Foundation/PrismPM#216 is not part of the model
document yet, so the declared effects are not compared with an application
host protocol. `adapterDigest` binds `adapters/compose.json`; a change to that
descriptor changes it.

```sh
cargo test --locked --offline -p prismpm --lib host_effect_system_ -- --nocapture --test-threads=1
cargo xtask conformance system-oci
```

The Compose oracle test needs `PRISMPM_TEST_SDK_IMAGE`, as the other
imported-oracle tests do.
