# Agent Guidelines for PrismPM

- SPEC.md is normative; README prose is explanatory.
- No handwritten PrismPM `.lean` source or `lakefile.lean` may be committed. All PrismPM Lean code is generated from `.lex.tex` by LexLean. The only upstream-source exception is the exact 18-file compiler-authority closure in SPEC §9 and `LEXLEAN_AUTHORITY_SOURCES`: the LexLean extraction adapter and 17 preservation sources, admitted only from selected revision `0865df4e540ca643b090a29e9df6d319d6906da6` through the registered package, complete dependency/tree checksums, matching clean package VCS provenance, and exact archive-member/tree byte equality. This does not admit other vendored Lean or any PrismPM model, proof, or replacement application behavior.
- Do not introduce placeholder URLs, wildcards in internal dependencies, unpinned toolchains, or unstaged modifications.
- Every public capability and diagnostic is registered in `model/*.toml` and covered by conformance fixtures.

