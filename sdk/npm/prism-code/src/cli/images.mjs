/**
 * `prism-code images <verb>` (#442, #349): the image verbs, under the module's name.
 * `ls`, `tag`, `rm` and `prune` read and change the local image store of
 * `Prism.fromEnv()` ($PRISM_IMAGES, else $PRISM_HOME/images); the top-level
 * `images`, `tag` and `rmi` are Docker's words for the first three.
 */
const USAGE = 64;

/** The client of this machine, loaded on first use so `--help` loads no store. */
const client = async () => (await import('../node.mjs')).Prism.fromEnv();

/** `-x`, `--name` and positionals; anything not in `flags` is refused. */
function read(args, flags, verb) {
  const positional = [];
  const set = new Set();
  for (const arg of args) {
    if (arg === '--') continue;
    const name = Object.keys(flags).find((key) => flags[key].includes(arg));
    if (name) set.add(name);
    else if (arg.startsWith('-')) return { error: `images ${verb} has no option ${arg}` };
    else positional.push(arg);
  }
  return { positional, set };
}

const refuse = (message) => {
  process.stderr.write(`${message}\n`);
  return USAGE;
};

const ago = (iso) => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  for (const [size, unit] of [[86400, 'day'], [3600, 'hour'], [60, 'minute']]) if (seconds >= size) return `${Math.floor(seconds / size)} ${unit}${seconds >= 2 * size ? 's' : ''} ago`;
  return 'just now';
};

const bytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${(n / 1024).toFixed(1)}kB` : `${n}B`);

/** `docker image ls`: one row per tag, and one `<none>` row for an untagged image. */
async function ls(args) {
  const { positional, set, error } = read(args, { json: ['--json'], dangling: ['--dangling'] }, 'ls');
  if (error) return refuse(error);
  if (positional.length > 1) return refuse('images ls takes at most one repository');
  const images = await (await client()).images.list({ ...(set.has('dangling') ? { dangling: true } : {}), ...(positional[0] ? { name: positional[0] } : {}) });
  if (set.has('json')) {
    process.stdout.write(`${JSON.stringify(images, null, 2)}\n`);
    return 0;
  }
  const rows = [['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE']];
  for (const image of images) {
    const id = image.digest.slice('blake3:'.length, 'blake3:'.length + 12);
    const names = image.tags.length === 0 ? ['<none>:<none>'] : image.tags;
    for (const name of names) {
      const colon = name.lastIndexOf(':');
      rows.push([name.slice(0, colon), name.slice(colon + 1), id, ago(image.created), bytes(image.size)]);
    }
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  for (const row of rows) process.stdout.write(`${row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] + 3))).join('')}\n`);
  return 0;
}

/** `docker tag SOURCE TARGET`. */
async function tag(args) {
  const { positional, error } = read(args, {}, 'tag');
  if (error) return refuse(error);
  if (positional.length !== 2) return refuse('images tag takes a source image and a target name');
  await (await client()).images.tag(positional[0], positional[1]);
  return 0;
}

/** `docker rmi`: each name in turn, Docker's `Untagged:` and `Deleted:` lines. */
async function rm(args) {
  const { positional, set, error } = read(args, { force: ['-f', '--force'] }, 'rm');
  if (error) return refuse(error);
  if (positional.length === 0) return refuse('images rm takes one or more images');
  const { images } = await client();
  for (const name of positional) {
    const removed = await images.remove(name, { force: set.has('force') });
    for (const untagged of removed.untagged) process.stdout.write(`Untagged: ${untagged}\n`);
    for (const deleted of removed.deleted) process.stdout.write(`Deleted: ${deleted}\n`);
  }
  return 0;
}

/** `docker image prune [-a]`. */
async function prune(args) {
  const { positional, set, error } = read(args, { all: ['-a', '--all'], json: ['--json'] }, 'prune');
  if (error) return refuse(error);
  if (positional.length > 0) return refuse('images prune takes no operand');
  const pruned = await (await client()).images.prune({ all: set.has('all') });
  if (set.has('json')) process.stdout.write(`${JSON.stringify(pruned)}\n`);
  else {
    for (const digest of pruned.imagesDeleted) process.stdout.write(`Deleted: ${digest}\n`);
    process.stdout.write(`Total reclaimed space: ${bytes(pruned.spaceReclaimed)}\n`);
  }
  return 0;
}

export const verbs = Object.freeze({
  build: Object.freeze({ flat: 'build', usage: '...', summary: 'the same as prism-code build' }),
  inspect: Object.freeze({ flat: 'inspect', usage: '<app.holo> [--json]', summary: 'the same as prism-code inspect' }),
  ls: Object.freeze({ run: ls, usage: '[<repository>] [--dangling] [--json]', summary: 'the images in the local store; prism-code images says the same' }),
  prune: Object.freeze({ run: prune, usage: '[-a|--all] [--json]', summary: 'untagged images no container references; --all every one none references' }),
  pull: Object.freeze({ flat: 'pull', usage: '<reference> [<out.holo>]', summary: 'the same as prism-code pull' }),
  push: Object.freeze({ flat: 'push', usage: '[<app.holo>] <reference>', summary: 'the same as prism-code push' }),
  rm: Object.freeze({ run: rm, usage: '[-f|--force] <image>...', summary: 'untag or remove stored images; refused while a container references one; prism-code rmi' }),
  tag: Object.freeze({ run: tag, usage: '<source> <target>', summary: 'one more name for a stored image; prism-code tag says the same' }),
  verify: Object.freeze({ flat: 'check', usage: '<app.holo> [--policy <file>] [--json]', summary: 'the same as prism-code check' }),
});

/** Docker's top-level words: `images` is `images ls`, `tag` is `images tag`, `rmi` is `images rm`. */
export const aliases = Object.freeze({ images: 'ls', tag: 'tag', rmi: 'rm' });
