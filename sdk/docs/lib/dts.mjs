/**
 * Pull named declarations out of a `.d.ts` file by brace matching. The spec
 * package and prism-code are declaration files without a build step, so the
 * text is the source. Doc comments are dropped: they are prose, and the pages
 * carry declarations only.
 */

/**
 * An interface or class ends at the brace that closes it. Everything else
 * (a function, a type alias, a const) ends at the first semicolon outside
 * every brace and parenthesis.
 */
function endOfBlock(text, start, bodyIsBlock) {
  let braces = 0;
  let parens = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') braces++;
    else if (c === '}') {
      braces--;
      if (bodyIsBlock && braces === 0) return i + 1;
    } else if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === ';' && braces === 0 && parens === 0) return i + 1;
  }
  return text.length;
}

function withoutComments(text) {
  return text
    .replace(/^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*\r?\n?/gm, '')
    .replace(/[ \t]*\/\*\*[^\n]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*\r?\n?/gm, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** `export (declare)? (interface|type|class|function|const) NAME ...` up to its closing brace or semicolon. */
export function declaration(text, name) {
  const re = new RegExp(`^export (?:declare )?(interface|type|class|function|const|abstract class) ${name}\\b[^\\n]*`, 'm');
  const match = re.exec(text);
  if (!match) throw new Error(`no declaration named ${name}`);
  const start = match.index;
  const end = endOfBlock(text, start, /class|interface/.test(match[1]));
  return withoutComments(text.slice(start, end));
}

/** One member of an interface, by name, with every line of its signature. */
export function member(text, interfaceName, memberName) {
  const block = declaration(text, interfaceName);
  const re = new RegExp(`^[ \\t]*(?:readonly )?${memberName}\\b[^\\n]*`, 'm');
  const match = re.exec(block);
  if (!match) throw new Error(`${interfaceName} has no member ${memberName}`);
  let end = match.index + match[0].length;
  let depth = (match[0].match(/\(/g) ?? []).length - (match[0].match(/\)/g) ?? []).length;
  while (depth > 0 && end < block.length) {
    const newline = block.indexOf('\n', end + 1);
    const lineEnd = newline === -1 ? block.length : newline;
    const line = block.slice(end, lineEnd);
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
    end = lineEnd;
  }
  return block.slice(match.index, end).trim();
}

/** Every top-level export: `{ name, kind, line }`, where `line` is the first line of the declaration. */
export function exportsOf(text) {
  const out = [];
  const re = /^export (?:declare )?(interface|type|class|function|const|abstract class) ([A-Za-z_$][\w$]*)([^\n]*)/gm;
  let m;
  while ((m = re.exec(text))) {
    const kind = m[1] === 'abstract class' ? 'class' : m[1];
    let line = `${m[2]}${m[3]}`;
    if (kind === 'function' || kind === 'const') {
      line = declaration(text, m[2])
        .replace(/^export (?:declare )?(?:function|const) /, '')
        .replace(/\s+/g, ' ');
    }
    line = line.replace(/\s*[{=;]\s*$/, '').trim();
    out.push({ name: m[2], kind, line });
  }
  const reexport = /^export \{([^}]*)\} from '([^']+)';/gm;
  while ((m = reexport.exec(text))) {
    for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      out.push({ name, kind: 'export', line: `from ${m[2]}` });
    }
  }
  return out;
}
