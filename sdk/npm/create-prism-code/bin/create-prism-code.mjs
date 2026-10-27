#!/usr/bin/env node
/**
 * npm create prism-code [<dir>] [-- --sdk-image <ref>]
 *
 * The scaffolder for issue #281. It is `prism-code init` and nothing else:
 * one implementation, so `npm create prism-code` and `npx prism-code init`
 * write the same project. In this repository it resolves prism-code from
 * the sibling package; installed from npm, from its dependency.
 */
let runInit;
try {
  ({ runInit } = await import('prism-code/init'));
} catch {
  ({ runInit } = await import('../../prism-code/src/init-cli.mjs'));
}
process.exitCode = await runInit(process.argv.slice(2));
