/**
 * The CLI reference, from the machine-readable description in `cli.json`.
 * Until `prism --help --json` exists that file is a hand-written stand-in;
 * the page says so in its status line and footer.
 */
import { code, fence, heading, paragraph, status, table } from '../markdown.mjs';

export function cli({ cli: description, page }) {
  const parts = [];
  parts.push(paragraph(`Source: ${code('sdk/docs/cli.json')} ${description.revision}, the stand-in for ${code(description.standIn)}.`));
  parts.push(paragraph(`${code(description.alias)} is an alias of ${code(description.binary)} and is kept through ${description.aliasKeptThrough}.`));

  const shipped = description.prismCode;
  parts.push(heading(2, 'The command that ships today'));
  parts.push(paragraph(`Install ${code(shipped.package)} with ${code(shipped.install)}, or run it with ${code(`npx ${shipped.binary} <verb>`)}. ${shipped.needs}`));
  parts.push(table(['Verb', 'Usage', 'What it does'], shipped.verbs.map((v) => [code(v.name), code(v.usage), v.summary])));
  parts.push(table(['Code', 'Name', 'Meaning'], shipped.exitCodes.map((e) => [e.code, e.name, e.meaning])));

  parts.push(heading(3, 'Plugins (experimental)'));
  parts.push(paragraph(shipped.plugins.discovery));
  parts.push(paragraph(shipped.plugins.contract));
  parts.push(paragraph(shipped.plugins.hooks));
  parts.push(table(['Plugin', 'Binary', 'Usage', 'What it does'], shipped.plugins.firstParty.map((p) => [code(p.name), code(p.binary), code(p.usage), p.summary])));

  parts.push(heading(2, 'Global flags'));
  parts.push(table(['Flag', 'Default', 'Meaning'], description.globalFlags.map((f) => [code(f.flag), f.default, f.meaning])));

  parts.push(heading(2, 'Exit codes'));
  parts.push(table(['Code', 'Name', 'Meaning'], description.exitCodes.map((e) => [e.code, e.name, e.meaning])));

  parts.push(heading(2, 'Verbs'));
  parts.push(status(page.status));
  for (const verb of description.verbs) {
    parts.push(heading(3, verb.name));
    parts.push(paragraph(verb.summary));
    parts.push(fence('bash', verb.usage));
    if (verb.flags.length > 0) {
      parts.push(table(['Flag', 'Default', 'Meaning'], verb.flags.map((f) => [code(f.flag), f.default, f.meaning])));
    }
    parts.push(fence('bash', verb.example));
  }

  return { parts, sources: [`sdk/docs/cli.json ${description.revision} (stand-in for ${description.standIn})`] };
}
