# The rule-judge lemma: export evidence

`src/` holds the lemma a rule app's guarantee proof applies, `PrismLive.Kernel.ruleJudge_sound`, with
the six `PrismLive.Tables` lemmas of stateful apps and everything they depend on, as two native core
modules (`lexlean/core-module/2`). There is no Lean file: LexLean generates the Lean from this source,
as it does for its own runtime and preservation libraries (AGENTS.md). Lean proves it in
`rule-judge-model.yml`; `test/rule-judge-model.test.mjs` holds the proof writer (`kernel-terms.mjs`) to
it. The names are foundry's, unchanged, so the terms the writer makes are the terms foundry's tab makes.

## Where it came from

foundry `07b3770`, `studio/proof/PrismLive/{Kernel,Regions}.lean`, the source of the library the
in-tab kernel holds (`studio/shell/kernel/lean/manifest.json`). It was exported once, under Lean
4.32.1, with LexLean's own laws oracle (LexLean `b58f1952`, `tests/runtime-library/laws-oracle/`). The
oracle is not committed here, since it is written partly in Lean. Its adaptations, all of them:

- the modules `PrismLive.Kernel` and `PrismLive.Regions`, and only the declarations named below;
- a `_recApp` annotation dropped, and a hygienic universe name made one component (see Differences);
- the data form written with no definition marked compiled;
- each module printed by `lexlean::sdk::to_notation`, since language 1.2 refuses the data form.

The closure of the roots was computed by walking the constants each declaration's type and value
names, its constructors, its type and its recursors, within the two modules, from the roots
`verification.json` lists.

## What it holds

298 of the 875 declarations the two files make: the dependency closure of the prover's roots (275)
and the smart-unfolding row of each definition in it (23). The decoder opens a definition's
realization context when its `_sunfold` row is added (LexLean SPEC.md §17.10), so without those rows
Lean cannot remake its equation lemmas. No well-founded definition is in it. `verification.json`
records each root and its exact axioms; `ruleJudge_sound` pins `Quot.sound` and `propext`, the set
a kernel verdict accepts (`KERNEL_AXIOMS`).

## Differences from the elaborated Lean, none read by a kernel judgment

1. A `_recApp` annotation, a Syntax value the elaborator leaves on recursive calls, is dropped; the
   format admits no Syntax. It sat on two equation lemmas outside the exported set.
2. A hygienic universe name (`u._@._hyg.#2`) becomes `u_hyg_2` in four private `_arg_pusher` theorems,
   also outside the set. Universe parameters are bound per declaration.
3. No definition carries compiled code. Lean's code generator cannot compile a structurally recursive
   kernel value (it goes through `brecOn`); the kernel never reads compiled code, and the in-tab kernel
   refuses compiled evaluation.

## Equivalence

Measured on Windows, Lean 4.32.1, `lexlean` from `vendor/lexlean` at this branch, unchanged.

- `lexlean check`, `lexlean build`; the generated Lean compiles under Lean 4.32.1.
- The regenerated environment against the original, declaration by declaration: 293 of 298 equal in
  every byte, 5 equal up to binder names (two sparse `casesOn`, their two `else_eq`, one
  `match_1.eq_3`), the difference LexLean's own `Laws` export found. The imports differ only by the
  decoder's `Lean` and `Lean.Meta.Constructions.SparseCasesOn`.
- `lexlean verify`: verified 2 modules, 39 s, no Docker.

## Planted defects

The first two were run in a copy with `lexlean lock && lexlean verify`, where `lexlean check` passed; the rest with `node --test test/rule-judge-model.test.mjs`. Each was restored.

| Defect | Refused with |
| --- | --- |
| `ruleJudge_sound`'s policy weakened to `[propext]` | `LLV7005 … violates its exact axiom policy: observed [Quot.sound, propext]` |
| The shared `Nat.ble` node made `Nat.blt` | `LLV7002 Lean rejected PrismLive.Regions` |
| The test, before this directory existed | `rule-judge-model.test.mjs` fails: no `verification.json` |
| The writer names `wordsCheckX` | `rule-judge-model.test.mjs` test 2 |
| `KERNEL_AXIOMS` widened by `Classical.choice` | test 3 |
| One byte of `src/Kernel.lex.tex` changed after verification | test 4 |
| A `.lean` file added beside the source | test 1 |

`rule-judge-model.yml` plants the first on every run.

## Not shown

- That the in-tab library (`library.ndjson`, lean4export's format) exported from this source equals
  foundry's byte for byte. Building lean4export was not done here.
- The lock's compiler identity is the SDK image's, which `rule-judge-model.yml` checks by locking and
  diffing; a `lexlean` built on Windows computes another.
