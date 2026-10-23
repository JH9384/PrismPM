/**
 * `llms.txt` from the page list, and `llms-full.md` as the generated pages
 * in page-list order.
 */

/** The site path of a page: `api/index` is served at `api`. */
export function sitePath(path) {
  return path.replace(/\/index$/, '');
}

export function llmsTxt(pages, rendered) {
  const lines = [`# ${pages.name}`, '', `> ${pages.summary}`, ''];
  for (const group of pages.groups) {
    lines.push(`## ${group.title}`, '');
    for (const page of group.pages) {
      lines.push(`- [${page.title}](${pages.site}/${sitePath(page.path)}): ${page.description}`);
    }
    lines.push('');
  }
  lines.push('## Optional', '');
  lines.push(`- [Every page in one file](${pages.site}/llms-full.md): the pages above, concatenated in this order.`);
  lines.push('- Markdown export: append `.md` to any page URL above to get that page as Markdown.');
  lines.push('');
  if (rendered.size !== pages.groups.flatMap((g) => g.pages).length) throw new Error('page list and rendered pages differ');
  return `${lines.join('\n')}\n`.replace(/\n{3,}/g, '\n\n');
}

export function llmsFull(pages, rendered) {
  const out = [`# ${pages.name}: every reference and API page`, '', `> ${pages.summary}`, ''];
  for (const group of pages.groups) {
    for (const page of group.pages) {
      const body = rendered.get(page.path);
      if (!body) throw new Error(`no rendered page for ${page.path}`);
      out.push(`<!-- ${page.path} -->`, '', body.replace(/\n+$/, ''), '');
    }
  }
  return `${out.join('\n')}\n`;
}
