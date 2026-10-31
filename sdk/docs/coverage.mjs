#!/usr/bin/env node
/**
 * Does every public item have a reference entry and an example? A public item
 * is a verb in sdk/docs/cli.json or a value the prism-code type declarations
 * export.
 *
 *   node sdk/docs/coverage.mjs           print the table; exit 1 when an item has no reference entry
 *   node sdk/docs/coverage.mjs --owed    print only the items with no executed example
 *
 * An example is `executed` when a script under sdk/docs/examples runs it, so its
 * output on the page is captured. It is `shown` when only a code block on a page
 * uses it, so nothing has run it. It is `none` otherwise. A missing example does
 * not fail this script yet: most wait on verbs that have not shipped.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCli, render } from './lib/generate.mjs';
import { EXAMPLES_DIR } from './lib/examples.mjs';
import { prismCode } from './lib/runtime.mjs';

/** The value exports of a declaration file: functions, classes and constants. */
export function exportedValues(types) {
  return [...types.matchAll(/^export (?:declare )?(?:function|class|const) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
}

/** The text of every code block in a Markdown page, joined. */
function codeBlocks(text) {
  return [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```$/gm)].map((m) => m[1]).join('\n');
}

const word = (name) => new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}($|[^\\w$])`, 'm');

/**
 * @param {Map<string, string>} files the rendered site
 * @returns {{ kind: string, name: string, reference: boolean, example: 'executed' | 'shown' | 'none' }[]}
 */
export function coverage(files, cli, types, scripts) {
  const pages = [...files].filter(([path]) => path.endsWith('.md') && !path.startsWith('mintlify/') && path !== 'llms-full.md');
  // On a generated page a code block is a declaration or an executed example, so only hand-written pages can show one.
  const shown = pages.filter(([path]) => !/^(api|reference)\//.test(path)).map(([, text]) => codeBlocks(text)).join('\n');
  const cliPage = files.get('reference/cli.md');
  const apiPages = pages.filter(([path]) => path.startsWith('api/') || path === 'reference/errors.md').map(([, text]) => text).join('\n');
  const verb = (kind, command, name) => {
    const called = new RegExp(`^\\s*(?:npx\\s+)?${command}(?:@\\S+)?\\s+${name}(\\s|$)`, 'm');
    return {
      kind,
      name: `${command} ${name}`,
      reference: cliPage.includes(`${command} ${name}`),
      example: called.test(scripts) ? 'executed' : called.test(shown) ? 'shown' : 'none',
    };
  };
  return [
    ...cli.prismCode.verbs.map((v) => verb('shipped verb', 'prism-code', v.name)),
    ...cli.verbs.map((v) => verb('planned verb', 'prism', v.name)),
    ...exportedValues(types).map((name) => ({
      kind: 'runtime export',
      name,
      reference: word(name).test(apiPages),
      example: word(name).test(scripts) ? 'executed' : word(name).test(shown) ? 'shown' : 'none',
    })),
  ];
}

export function readScripts(dir = EXAMPLES_DIR) {
  return readdirSync(dir).map((file) => readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n')).join('\n');
}

async function main(argv) {
  const owedOnly = argv.includes('--owed');
  const runtime = prismCode();
  const items = coverage(await render({ runtime }), readCli(), runtime.types, readScripts());
  const rows = owedOnly ? items.filter((i) => i.example !== 'executed') : items;
  for (const item of rows) console.log(`${item.kind}\t${item.name}\treference: ${item.reference ? 'yes' : 'no'}\texample: ${item.example}`);
  const count = (test) => items.filter(test).length;
  console.error(`${items.length} public items: ${count((i) => i.reference)} with a reference entry, ${count((i) => i.example === 'executed')} with an executed example, ${count((i) => i.example === 'shown')} with a code block only, ${count((i) => i.example === 'none')} with neither`);
  return items.every((i) => i.reference) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.stack ?? String(error));
      process.exit(2);
    },
  );
}
