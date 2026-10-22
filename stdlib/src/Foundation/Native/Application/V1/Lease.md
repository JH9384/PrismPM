# Internal native operation lease

This reducer owns one admitted resource lane, not an application profile or an
OS authority. Native applications compose lanes under their modeled concurrency
and shutdown policy. Browser effect grants are not native resource grants.

Trusted bootstrap supplies the application, manifest, private session and
resource references. Each reference is exactly 32 bytes. A private host retains
the corresponding admitted OS authority. References alone confer no authority.
The model never contains a descriptor, path to an authority root, secret,
callback, executable command or Hologram-specific storage policy.

An operation binds all four references, a non-reused unsigned 64-bit sequence,
the exact request digest and a monotonic deadline. Request encoding, digest
verification and private completion custody belong to the qualified binding;
caller-supplied completion records are not evidence. A lane admits one active
operation. Sequence values 0 through 18,446,744,073,709,551,614 can be allocated;
the next value is the exhaustion sentinel and never wraps.

The private host samples elapsed monotonic nanoseconds from the lane's fresh
session epoch, bounded to unsigned 64 bits. Neither time nor completion-role
authority is supplied by an application caller. The reducer rejects times before
its last accepted sample; the host must also preserve monotonicity across failed
transitions. Admission and successful completion
require time strictly before the deadline. Cancellation, deadline expiry and
shutdown prevent result delivery but do not prove that a worker stopped or a
durable operation rolled back. Pending authority remains leased until the
private binding proves worker termination and handle cleanup. Unknown cleanup
retains the lease and blocks further work. Late, duplicate and cross-lane
completions cannot retire or replace the current lease.

`completeNativeLease` and `retireCancelledNativeLease` are conditional host-only
transitions: the private binding calls either only after it has captured actual
worker termination and handle cleanup for that exact operation. An admission
binding is not cleanup evidence. These pure functions cannot authenticate an OS
fact. Exporting these pure declarations as mathematical functions grants no
authority. A host-effect API must not accept caller-produced lane state,
bindings, timestamps, cancellation flags or cleanup evidence. Its private
binding owns those inputs, its admitted capability and worker, and retains only
the generated reducer's returned state. An outer generated `ComputeError` is
distinct from a modeled `NativeLeaseError` and must fail closed without retiring
outstanding authority. Cleanup uncertainty
uses `retainUnknownNativeCleanup`, never an invented terminal receipt. Repeating
the same read after retirement allocates a new sequence; durable-effect request
idempotency requires its own modeled journal and is not supplied by this lane.

`ReadAndDigest` additionally requires descriptor-relative confinement, a regular
opened file, bounded streaming, explicit algorithm and imported digest oracles.
Listeners, durable writes, transport and inference have their own effect and
recovery contracts. This internal lifecycle does not implement or qualify those
effects. Native execution acceptance requires real effects on every supported
host, generated native/Wasm transition agreement, immutable SDK provenance and
fresh Hologram integration; a model-only test cannot satisfy issue #62.
