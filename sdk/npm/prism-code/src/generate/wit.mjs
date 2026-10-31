/**
 * A reader for the WIT a holo's world is written in (issue #289). It reads the
 * subset the guest worlds use: one `package`, one `world`, and `export` or
 * `import` of functions over scalar types, with `///` doc comments. Anything
 * else is refused, so a world that grows past the subset fails loudly instead
 * of generating the wrong bindings.
 */
import { fail } from '../errors.mjs';

/** Each scalar WIT type and the core type the canonical ABI lowers it to. */
export const SCALARS = Object.freeze({
  bool: 'i32',
  u8: 'i32',
  s8: 'i32',
  u16: 'i32',
  s16: 'i32',
  u32: 'i32',
  s32: 'i32',
  char: 'i32',
  u64: 'i64',
  s64: 'i64',
  f32: 'f32',
  f64: 'f64',
});

const IDENT = '[a-z][a-z0-9]*(?:-[a-z0-9]+)*';
const PACKAGE = new RegExp(`^package (${IDENT}:${IDENT}(?:@[0-9A-Za-z.+-]+)?);$`);
const WORLD = new RegExp(`^world (${IDENT}) \\{$`);
const FUNCTION = new RegExp(`^(export|import) (${IDENT}): func\\((.*)\\)(?: -> (${IDENT}))?;$`);
const PARAM = new RegExp(`^(${IDENT}): (${IDENT})$`);

function scalar(type, line) {
  if (!Object.hasOwn(SCALARS, type)) fail('generate.wit', `line ${line}: type ${type} is outside the scalar subset generate reads`);
  return { type, core: SCALARS[type] };
}

/**
 * Parse WIT text into `{ package, name, items }`. Each item is
 * `{ direction, wit, name, params, result, docs }`, where `name` is the core
 * name the canonical ABI gives (`holo-run` is `holo_run`).
 */
export function readWorld(text) {
  let pkg = null;
  let world = null;
  let closed = false;
  let docs = [];
  const items = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((raw, index) => {
    const n = index + 1;
    const line = raw.trim();
    if (line.startsWith('///')) {
      docs.push(line.slice(3).trim());
      return;
    }
    if (line === '' || line.startsWith('//')) {
      docs = [];
      return;
    }
    if (closed) fail('generate.wit', `line ${n}: nothing may follow the world`);
    let m;
    if ((m = PACKAGE.exec(line)) && pkg === null && world === null) pkg = m[1];
    else if ((m = WORLD.exec(line)) && pkg !== null && world === null) world = m[1];
    else if ((m = FUNCTION.exec(line)) && world !== null) {
      const params = m[3].trim() === ''
        ? []
        : m[3].split(',').map((p) => {
            const pm = PARAM.exec(p.trim());
            if (!pm) fail('generate.wit', `line ${n}: cannot read parameter ${JSON.stringify(p.trim())}`);
            return { name: pm[1], ...scalar(pm[2], n) };
          });
      items.push({
        direction: m[1],
        wit: m[2],
        name: m[2].replaceAll('-', '_'),
        params,
        result: m[4] === undefined ? null : scalar(m[4], n),
        docs,
      });
    } else if (line === '}' && world !== null) closed = true;
    else fail('generate.wit', `line ${n}: ${JSON.stringify(line)} is outside the WIT subset generate reads`);
    docs = [];
  });
  if (pkg === null || world === null || !closed) fail('generate.wit', 'the WIT text has no complete package and world');
  return { package: pkg, name: world, items };
}
