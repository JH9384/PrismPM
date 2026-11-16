# Lean's kernel, as WebAssembly

The files below are not in this package. `kernel-store.mjs` fetches them once
from UOR-Foundation/foundry at commit `7755331b8d1cba879d89a1956c0703b749868abd`
and keeps them under `$PRISM_HOME/kernel/`. Each is named by the SHA-256 of its
bytes, and is used only when its bytes have that address. `manifest.json`, which
is in this package, names what the unpacked files must be and records that this
kernel judged this library whole.

| File | Where it lives in foundry | What it is |
| --- | --- | --- |
| `lean-kernel.wasm.gz` | `studio/shell/kernel/lean/` | Lean 4.32.1's C++ kernel (`src/kernel`, `src/runtime`, `src/util` at `f054605a`), built single-threaded with Emscripten, with libuv 1.48.0 linked for the runtime. |
| `lean-kernel.mjs.gz` | `studio/shell/kernel/lean/` | The loader Emscripten generated for that module. |
| `library.ndjson.gz` | `studio/shell/kernel/lean/` | The lean4export (format 3.1.0) export of `PrismLive.Kernel.ruleJudge_sound` and what it depends on, from foundry's `studio/proof`. |
| `kernel.holo` | `studio/shell/kernel/` | The Forge kernel: a holo built and verified once by the SDK, whose guest carries the rule judge (`app/src/RuleJudge.lex.tex`) and the verdict (`app/src/InTabKernel.lex.tex`). |

How they are built: foundry `v2/in-tab-kernel/` (`build-wasm.sh`, `bind-library.mjs`, `make-dist.mjs`).

The same bytes are kept in `test/fixtures/kernel/` for this package's tests, which fetch nothing.

## Licences

- Lean 4: Apache License 2.0. https://github.com/leanprover/lean4
- lean4export: Apache License 2.0. https://github.com/leanprover/lean4export
- libuv: MIT License. https://github.com/libuv/libuv
- Emscripten runtime support in the loader: MIT License. https://github.com/emscripten-core/emscripten
- The lemma library, the rule judge and the build: UOR-Foundation/foundry, MIT or Apache License 2.0.
