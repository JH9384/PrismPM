/**
 * The package entry point for the tests. index.mjs is generated and not
 * committed, so a test that runs on a fresh checkout, as `node --test` does
 * under `cargo xtask validate`, builds it first. `build()` writes only what is
 * missing or differs, through a temporary file, so test files that start in
 * parallel do not disturb each other.
 */
import { loadSpec } from '../scripts/build.mjs';

export const spec = await loadSpec();
