# Private journal retention

Source-owned bounded storage admission; no authentication, journal acceptance
or public runtime grant. The existing store and its limits are unchanged.

A snapshot contains the complete revision, sorted unique extant object IDs and
all roots, including live, staging and pending roots. Each root has a distinct
store-grammar name, its head ID and a sorted unique transitive closure containing
that head. Every reference is exactly 32 bytes and present in the object set.
Bounds remain 4096 objects, 64 roots and 4096 references per root.

One commit conditionally replaces/creates at most one root, adds at most 16
immutable objects and retires extant unreferenced objects. Create requires an
absent name; update requires the exact existing head. Retirement protects every
resulting root, so replacing the selected root can atomically retire its obsolete
closure, never a shared/live/staging reference. Additions and retirements are
disjoint; existing additions are idempotent only when actual bytes are identical.
The transient set union can contain 4112 IDs; the committed set cannot exceed
4096. Revision increments once on every commit and cannot wrap. No root-removal
primitive exists; an authorized wrapper may replace a released staging root with
a safe marker closure.

The journal wrapper derives complete closures from actual canonical journal
objects, not caller claims. The host verifies copied addition bytes, SHA-256,
immutability and the unchanged 1-MiB object limit. A source-admitted snapshot does
not establish currency: one actual readwrite transaction must compare the exact
complete current snapshot, admit or compare the exact generated successor, apply
the whole replacement/addition/retirement and await transaction completion.
Revision-only comparison or readback before a separate CAS does not close GC
races. Abort or lost acknowledgement cannot release an effect.

The private wire is canonical CBOR to EOF. Balanced parsing and indexed-range
validation/writing preserve the complete domain without linear stack growth or
repeated copies of the full reference frontier. The source emits the fixed
canonical CBOR header only after checking each reference's exact 32-byte width;
it does not broaden the existing Effects codec's 64-item domain. Request/reply
limits remain 64 MiB and generated Wasm remains 1 GiB. Whole-owner execution must
cover 64×4096 references, actual 4096-object retirement, 16-addition full-capacity
replacement, shared/pending/staging protection, competing tabs, stale snapshots,
faulted transactions and every real source/host mutant. Descriptor construction
tests do not establish this acceptance.
