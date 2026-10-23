/**
 * Markdown building blocks shared by every page generator. Output is LF only.
 */

export function frontmatter(title, description) {
  return `---\ntitle: ${title}\ndescription: ${description}\n---\n`;
}

export function heading(level, text) {
  return `\n${'#'.repeat(level)} ${text}\n\n`;
}

/** Escape a table cell: pipes and newlines are not allowed inside a cell. */
export function cell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

export function code(value) {
  return `\`${String(value).replace(/`/g, '\\`')}\``;
}

/** A GitHub-flavored table. `rows` is an array of arrays; every row has `header.length` cells. */
export function table(header, rows) {
  if (rows.length === 0) throw new Error('table() needs at least one row');
  const widths = header.map((h, i) => Math.max(cell(h).length, ...rows.map((r) => cell(r[i]).length)));
  const line = (cells) => `| ${cells.map((c, i) => cell(c).padEnd(widths[i])).join(' | ')} |`;
  const rule = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return `${[line(header), rule, ...rows.map(line)].join('\n')}\n`;
}

export function fence(language, body) {
  const text = String(body)
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '');
  return `\`\`\`${language}\n${text}\n\`\`\`\n`;
}

export function bullets(items) {
  return `${items.map((item) => `- ${item}`).join('\n')}\n`;
}

export function paragraph(text) {
  return `${text}\n`;
}

/** The single generated line a page carries where a source or an example does not exist yet. */
export function status(text) {
  return `Status: ${text}\n`;
}

export function link(text, href) {
  return `[${text}](${href})`;
}

/** The footer every generated page ends with. */
export function footer(sources) {
  return `\nGenerated from ${sources.join(', ')}.\n`;
}

/** Join page parts and collapse blank runs so the file is tidy and deterministic. */
export function page(parts) {
  return parts
    .map((part) => (part.endsWith('\n') ? `${part}\n` : `${part}\n\n`))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/, '\n');
}
