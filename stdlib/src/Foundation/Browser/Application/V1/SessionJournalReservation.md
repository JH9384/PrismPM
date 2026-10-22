# Private journal reservation

Unaccepted until generated native/no_std/Wasm and the complete DK-30 owner pass.
This component neither authenticates recovery nor reserves object-store bytes.

Every admitted predecessor/successor satisfies:

`requiredOrdinals <= 4294967295 - sequence`.

Validate the complete metadata state before subtraction or recursion. Derive
remaining Continue steps from the actual pending maximum minus current step.
Preserve all 512 steps and segment sizes 2–1024. Charge a real checkpoint whenever
Continue requires two free slots or an ordinary terminal record requires one;
only retained count resets. Global ordinals never reset, saturate or wrap.

The finite required tail is Unknown→Close→RecoveryTerminal→Close for Pending,
Close→RecoveryTerminal→Close for Unknown, RecoveryTerminal→Close for Closed with
pending, Close for Ready, and zero for Closed without pending. Earlier successful
settlement/refusal paths are also preserved. Reopening requires new admission;
an exhausted finite terminal does not promise unlimited RecoveryReady cycles.

Reserved initialize, append and replay compose the existing metadata transitions.
All kinds 1–10, including optional Checkpoint and recovery, check the invariant.
Unsafe legacy snapshots reject rather than granting recovery permission.
Authentication, source recomputation, retention/frontier transactions, complete
payload capacity and freshness remain independent mandatory DK-30 checks.

The private reservation wire uses unchanged metadata operations 0–5, with
reserved initialize/append/replay/state validation; observation 6 returns the
checked required ordinal count. EOF, uint32 and 64-MiB bounds are unchanged.
These observations are test/integration data, not a public dispatch API.

The private owner requires 6,490 exact vectors, seven complete maxima and 21
compiled source mutants. Package, native executable and original/private/Wasm
buffer substitution checks are mandatory; construction checks alone do not
establish generated-source acceptance.

The first generated owner refused an omitted required structure parameter field
at LexLean schema admission (`LLT4001`, 65.313 s). Explicit empty type/value
parameter lists correct that source declaration without changing its model.
The retained diagnostic is `target/reservation-verification/run-log-IIACw3hi`;
a fresh complete owner remains required.

The next run passed all native vectors but trapped on Wasm vector
`ReservationFullReplay0` after 5,959 passing vectors (145.767 s). A names-only
rebuild preserved every noncustom section (`7ed42a8f4083ecb0ff8914eb595882914b633389207456ef950ea0437eac577b`)
and identified the linear continuation/ordinary fold beneath replay frames.
The source now folds continuations left-to-right through a balanced count tree,
then applies the unchanged ordinary tail. Nat fuel decreases at every recursive
call and exhaustion returns `BadRecord`, not a partial reservation. The private
helper propagates that error; wire operations and numeric/resource bounds stay
unchanged. Three additional mutants sever the right predecessor, omit the right
half or exhaust fuel. The corrected complete generated owner is still required.

The subsequent full owner passed all 6,490 vectors, seven actual maxima and
18 compiled mutants, then rejected the `reservation-split-state` test mapping
because its FullCapacity probe did not distinguish the changed program
(2887.209 s; `target/reservation-verification/run-log-LyCNRhvx/owner.log`).
Executing that same retained mutant against the unchanged complete corpus
exposed `ReservationCost45`: three continuations, two retained slots, initially
empty segment, required cost 11. The mapping now selects that existing vector;
no source behavior, corpus, maximum or mutation was removed. The failed owner
and products remain diagnostic evidence; a fresh complete owner is required.
