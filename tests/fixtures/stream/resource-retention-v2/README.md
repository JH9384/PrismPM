# Private retained-resource ownership fixture /2

This neutral fixture exercises source-owned retention, cleanup and release using
the existing NativeLibrary export. It introduces no public exporter profile or
compression behavior. The original resource-component `/1` fixture is unchanged.

The source owns State, successor transitions, observations, receipt tickets,
achieved write/delete prefixes and the release decision. Completion,
cancellation and modeled failure keep their successor State. A pending receipt
or unknown disposition prevents release. Explicit reconciliation and achieved
cleanup must discharge ownership before source authorization permits destruction.

The two-unit write witness and its finite receipt byte codes are counterexample
data, not input-size limits, a storage provider or a product wire format. Config
marker bytes remain arbitrary binary data. Every observation is encoded by the
actual generated source; the facade does not reconstruct source state or parse
an application protocol by hand.

The ordinary workspace tests own the host counterexamples and the genuine
source-to-native/Wasm probe:

```sh
cargo test --locked --offline -p prismpm --lib resource_adapter:: -- --test-threads=1 --nocapture
```

The probe verifies the real NativeLibrary export, binds the private descriptor
from that same semantic snapshot, checks actual generated fallibility, builds
native and wasm-bindgen consumers from the original crate, and executes receipt,
cleanup, checked-error, stale/foreign-handle and lifetime controls. Native mutants
must compile first and fail at their exact intended invariant; a separate thread
affinity compile refusal is not counted as a killed runtime mutant. All probe
workspaces and process records are retained, including unexpected failures.

This fixture does not qualify a native isolated supervisor, physical bounds,
actual filesystem/browser backing resources, worker termination, persistent
import-free Core ABI, publication service or installed SDK. The complete product
binding requires the types and ownership contracts listed in
[the dependency register](../../../../docs/proposals/519-compression-binding-dependencies.md).
