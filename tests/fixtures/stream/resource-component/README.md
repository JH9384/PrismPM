# Private typed resource component fixture

This authored source overlay is copied over the existing locked NativeLibrary
fixture by `resource_adapter::probe_tests`. Its Stream model is local to this
fixture. It is not a registered stdlib module, public application profile,
controller operation, or import-free Core-Wasm world.

The neutral source state holds a configuration marker, the last accepted chunk,
and an EOF flag. Source `step` selects demand/output/terminal transitions; the
source encoders own summary, error, and disposition bytes. There is no
compression dispatch or handwritten Lean/behavior IR. The adapter retains the
actual generated Rust `State` in `Option<State>` and never serializes it for a
subsequent call.

The pinned generator borrows `State` and `InputEvent` and clones state/byte
fields into its returned transitions. The probe explicitly checks the actual
generated signature and clone path. Neither typed residency nor observed
allocator reuse establishes zero-copy behavior, efficient large-state updates,
bounded working memory, or compression-product performance.

The probe first uses the normal controller's Lean proof, exporter custody,
independent native archive regeneration, and std/no_std acceptance. It then
consumes that actual archive through the existing isolated registry helper plus
the pinned dependency registry, builds the ordinary std wasm-bindgen adapter,
and runs its generated **web** loader in Node. The native receipt remains
native-only: the subsequent Wasm experiment emits no public artifact acceptance
receipt and does not extend that native receipt's scope.

The concrete Rust facade is conformance-only protocol glue. Its wrapper counter
and trap method are explicit test instrumentation. JavaScript supplies events
and checks source-produced bytes; it does not reimplement the source machine.
The tests check all byte values, empty chunks, ownership cleanup, stale and
cross-instance sessions with colliding actual raw pointers, copied buffers across
memory growth, modeled errors, a real generated checked-add computation error,
and instance poisoning after an actual Wasm trap. Repeated live-wrapper counts
and a page-use plateau are observations of this fixture, not heap sufficiency.

The Node trap case records owner retirement requested and makes no subsequent
guest calls. It does not prove Worker termination or garbage-collector cleanup.
The kernel strongly quarantines known owners and returned raw replies after
poisoning so their wasm-bindgen finalizers cannot be prompted by dropping those
references. This can retain memory indefinitely until the dedicated realm
terminates; failed retirement provides no lifetime heap bound. Unreturned init
temporaries and actual Worker/GC termination remain unknown. The callback
returning is not evidence of physical termination or reclaiming memory.

Run both private component tests using the pinned local toolchain:

```sh
cargo test -p prismpm --lib resource_adapter::probe_tests --locked --offline -- --nocapture
```

Real browser file/Worker/download journeys, publication failures and Unknown
outcomes, public source descriptor projection, production sidecar generation,
two-generation Wasm artifact custody, native consuming adapters, and a separate
persistent import-free ABI remain follow-up gates. Earlier profile evidence does
not qualify any of those additions.
