# Compiler cache integrity

2026-09-27, pinned development container:

- Five new exporter adversaries failed against the inherited cache: planted
  executable, linked cache, changed source, aliased source, existing destination.
  The planted executables actually ran; existence was incorrectly authoritative.
- The added Cargo adversary proves an unchanged-source build can return success
  while retaining an executable replaced after compilation. A new private target
  rebuilds the actual program and refuses adoption of the poisoned target.
- All thirteen cache tests pass, including the four original retirement checks,
  hard-linked source refusal and aliased private-driver parent refusal.
  `scripts/compiler-driver-cache.test.mjs` builds real pinned exporter and Cargo
  fixtures; negative executables are test data, never acceptance compilers.
- All ten affected browser drivers now create private targets. Exporters compile
  captured, hash-verified source privately with the verified SDK toolchain.
- The first fresh DK-28 integration rejected a missing Cargo cache tag: creating
  an empty target before Cargo suppressed its initialization. The owning Cargo
  adversary reproduced this failure. Targets now must be absent beneath an owned
  private parent; Cargo creates and tags them itself. No cache tag is fabricated.
- All exporters now remain within owning fixture work. Retained fixtures retire
  completed tools after their last invocation; workspace/envelope tests already
  remove their exact owned work. The six added retirement owners preserve source,
  proof, IR and Wasm evidence, and record original tool hashes. Repository
  manifests are read from closed registered paths, never deleted or modified.
  Incomplete and source-only diagnostic builds remain retained, not accepted.
- After all three cache corrections, the complete `cargo xtask validate` run
  passed: 199 infrastructure tests and the normative registry/specification
  checks (181 capability identifiers, 86 diagnostics). This is infrastructure
  validation, not the still-required browser-owner or installed-SDK acceptance.

Complete affected browser owners, combined installed-SDK execution and full
release gates remain required. Cache-integrity tests do not establish application
or deployment acceptance. Original logs: `target/audit-27sep26/`.

## Fresh source-owner tools

DK-15 and DK-20 each construct one private, source-bound compiler pair per
owning test. Opaque in-memory handles bind the closed family, complete registered
compiler inputs, exporter runtime and original/private executables. No existing
target, filesystem receipt or caller executable can create an owner.

Each model and mutant still receives fresh LexLean, kernel, IR, native and Wasm
builds. Tool checks bracket every invocation; completed tools retire only after
the entire owner finishes. Failure retains diagnostics. This is process-local
test infrastructure, not installed-SDK seed admission, cached acceptance, or
isolation from hostile processes with the same user identity. Construction and
model timings must be measured before claiming a speedup.

2026-10-03, pinned development container: the combined DK-15/DK-16/DK-20
components passed all 47 tests in 1805.031 seconds, including the unchanged
cold DK-16 path. The 18 compiler-cache regressions and 30 owner/SDK-registration
infrastructure tests also passed. Independent review compared all 1,584 captured
input hashes with the source tree and checked both retirement records. These
are source-component results, not installed-SDK or full V&V acceptance.

Presentation and Operation Journal use the same closed owner mechanism without
changing their cold defaults. Their complete owners and compiler adversaries
passed 56 tests in 1875.969 seconds; eight Presentation host tests also passed.
The Presentation source/installed minimum is now its complete 24-test count.
Both owners retain all five source mutants; Journal still constructs its
independent custody dependency cold. Model timings remain diagnostic only.

Budget also uses one closed compiler owner while retaining its full frozen-input
closure and cold default. Its complete owner and compiler adversaries passed
25 tests in 535.344 seconds: all 179 vectors, 25 maxima, one-over checks and
seven fresh compiled mutants remain required. This is component verification,
not measured overall speedup or installed-SDK acceptance.

Custody now uses the same closed owner without changing its cold default or
Journal's independently built custody dependency. Its complete owner and
compiler adversaries passed 23 tests in 386.078 seconds: 90 vectors, 10 maxima,
35 browser journeys, 173 replayed calls, eight host defects and three fresh
compiled mutants. Successful mutant source/proof/generated products are retained;
timing stays diagnostic-only. Original evidence archive SHA-256:
`999c5cdd97e2d27c5a8eb9aaa9b9df6738e9952fa2ce45439f6ca43d93462cca`.
