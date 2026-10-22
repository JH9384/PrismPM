# Private retained payload transport

DK-30 composition prerequisite; not an accepted runtime, authenticated journal,
freshness witness, durable quota reservation or application release.

`session-payloads.mjs` executes the existing generated DK-24
`journalPartitionBytes` and `journalWireBytes` entrypoints. The host hashes their
exact chunks/descriptors; it does not implement an application transition.
`SessionStorage` supplies actual IndexedDB transactions with generated retention
admission. Branded access captures SDK methods, refusing caller implementations
and later shadowed methods on genuine instances.

`stage({bytes, root, expected})` captures inputs before awaiting. `root` is an
explicit reusable staging root, not a new uncollectable root per payload. Each
batch contains at most 16 unique objects, including the descriptor marker, and
atomically protects every previous staging reference plus the added references.
Intermediate heads are opaque chunk objects. The complete descriptor is stored
last and becomes the head only when all its chunks are present in that same
protected closure. No partial descriptor promises absent chunks.
The descriptor retains ordered chunks, including duplicates; retention sets are
sorted and unique. A partial stage is not a completed payload or Prepared record.
No conflict is silently retried, no old closure is discarded, and no host age-
based collection exists. After a commit error the transport refuses further
staging; authenticated reopening must inspect actual retained state.

Success requires complete chunk readback, exact chunk lengths and full-frame
hash/partition validation. Returned descriptor/marker/frontier bytes are copies,
not an authorization or a lease. Later Prepared publication must independently
authenticate its context and atomically own/recheck the complete payload closure.
Concurrent removal after readback cannot be resolved by trusting the returned
frontier. Source-authorized checkpoint/retirement must release obsolete staging
references only after complete replacement ownership is acknowledged.

The unchanged bounds are 64 MiB per frame, 1 MiB per chunk, 64 ordered chunks,
16 additions per transaction, 4096 stored objects and 64 roots. This component
does not reduce them or reserve capacity for all future session outcomes.

Private failures distinguish invalid inputs/artifacts/generated results,
model refusal, missing/corrupt payloads, competing staging heads, closed/busy
transport and uncertain publication. Actual storage failures retain their typed
`SessionStorageError` codes. Neither failure nor possession supplies permissions.

Initial false-storage test failed because the adapter was absent, then passed
after implementation. The corrected fresh payload owner passed 30/30 tests:
19 browser journeys, ten actual host mutants and 224 native-replayed calls.
Receipt: `3d7ba9e628320e1d0e97eaa28581138feae78a4480200a0ff602092e2d8aefca`.
The existing complete retention owner also passed 18/18 in 1048.997 seconds:
86 vectors, six actual maxima, eleven browser journeys, six host defects and
nine newly compiled source mutants. Its 833 inputs, original/private Wasm and
both native executables were independently rehashed; 92 browser calls replayed
in both native modes. Receipt:
`1df1066b187297d6e3a87487494e6f8e5e1e015e4486a939a3131646b605298c`,
retained at `/tmp/prismpm-session-retention-ONvw7L` in `prismpm-dev`.
Full three-engine payload composition, authenticated journal/freshness,
installed SDK and application acceptance remain separate required owners.
