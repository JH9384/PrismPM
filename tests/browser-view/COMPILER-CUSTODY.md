# Private compiler executable custody

`compiler-artifact.mjs` captures original and distinct execution-file identities.
It checks owned private directories, complete bytes, inode and link identity before
and after every actual invocation. Frozen branded handles cannot be cloned.
This is not compiler-source provenance or a sandbox against a hostile same-UID
process that can transiently replace and restore files between observations.

27 September: ten custody tests passed in the devcontainer, including three executed guard
mutants. The preflight mutant actually writes a sentinel; the genuine guard
refuses before that write. Postflight checks run on successful and failed
commands. Alias, inode, write-permission and forged-handle tests also pass.

Owner-scoped reuse additionally requires fresh pinned compiler construction,
complete static/runtime-source binding and unchanged generated-component owners.
No previous target, disk receipt or caller-selected executable establishes that
provenance. The custody helper alone does not authorize reuse or application
acceptance.

`compiler-owner.mjs` constructs one fresh pinned exporter/driver closure for a
serial retention owner. Its complete repository/staged inputs, exporter runtime,
original executables and separate private executables are checked before and
after each use. Every baseline and mutant still independently generates and
checks source, kernel evidence, IR, native and two Wasm packages. Retirement
preserves private executables and source/evidence; no prior disk receipt or
compiler target can be adopted. The enclosing pinned SDK toolchain remains a
trust boundary, not a newly byte-authenticated compiler input.

The initial full attempt correctly failed on the exporter entrypoint spelling.
The private exporter now preserves `prod-export` beneath its owned execution
directory; the existing environment guard is unchanged. The actual invocation
regression and two constructor tests pass. The corrected full retention owner
passes 18/18 in 1044.393 seconds: 86 vectors, six actual maxima, 11 browser
journeys, six host mutants, nine freshly compiled source mutants and 13 compiler
substitution/identity checks. All 839 captured inputs and retained compiler
identities were independently rehashed. Receipt:
`9e8cdac5f2cb2884376f6f768d0acf1f28c7a4d847a4aab34b911e2ceaf77b32`,
`/tmp/prismpm-session-retention-qgF7BI/retention-source-owner-evidence.json`.

This is private component evidence, not journal, SDK or application acceptance.
The preceding owner took 1048.997 seconds; these runs establish no meaningful
end-to-end speed improvement.

The complete static closure is now parsed and branded once per fresh capture;
every subsequent use still verifies all captured paths, regular singly linked
files and bytes. Five actual transitive-input defects run only in an independently
captured private copy, never in repository or installed SDK sources. The
read-only, network-disabled SDK construction probe passes 3/3.

The updated full owner passes 18/18 in 1009.311 seconds, retaining all vectors,
actual maxima, journeys and compiled defects above. Independent rechecking
verified 840 captured inputs, all ten programs' packages, native/Wasm outputs,
kernel evidence and both retained private compiler identities: 1,092 hashes.
Receipt: `5d560cf058a75a5cfe469822d23210573ca91c95d4ac128b07e4f7fbfc63d5f1`,
`/tmp/prismpm-session-retention-36xUKX/retention-source-owner-evidence.json`.
This small timing difference is not evidence of an end-to-end CI speedup.
