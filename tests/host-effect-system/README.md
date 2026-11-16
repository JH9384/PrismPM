# Host-effect system source fixture

`Release.lex.tex` models the `mcp-loopback` service in the shape of
UOR-Foundation/lexlean-mcp#17: a gateway (`api`) on the host network that
listens on `127.0.0.1`, the host's loopback, an engine host and a signer
(`worker`), a verifier (`job`) and a telemetry collector on an internal
network. Image names and digests and the port are illustrative; the real
values come from lexlean-mcp's own declaration.

The release imports the Echo Server application (`examples/EchoServer`) and
binds that application's model digest. Its effects, `tool.calls` and
`echo.stamp`, are the effects the Echo Server's host protocol declares: `check`
refuses a release whose listed effects differ from them, or whose selected
application is not a server application. `adapterDigest` binds
`adapters/compose.json`; a change to that descriptor changes it.

```sh
cargo test --locked --offline -p prismpm --lib host_effect_system_ -- --nocapture --test-threads=1
cargo xtask conformance system-oci
```

The Compose oracle test needs `PRISMPM_TEST_SDK_IMAGE`, as the other
imported-oracle tests do.
