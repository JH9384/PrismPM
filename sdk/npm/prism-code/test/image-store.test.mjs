// The local image store (#349) under prism.images (#442). OC-12 owns this file: images kept once by digest, tags as
// names, remove and prune decided by the store model's table, and a referenced image never collected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blake3Hex } from '../src/blake3.mjs';
import { createImageStore, decide, fileImageStore, IMAGE_STORE_RULES, IMAGE_STORE_SCHEMA, localName, memoryImageStore } from '../src/image-store.mjs';
import { createImages } from '../src/images-namespace.mjs';
import { createPrism } from '../src/index.mjs';
import { imagesDirectory, Prism } from '../src/node.mjs';

const read = (path) => new Uint8Array(readFileSync(fileURLToPath(new URL(path, import.meta.url))));
const calculator = read('../fixtures/Calculator.holo');
const signed = read('./fixtures/attestation/Calculator.signed.holo');
const payment = read('../fixtures/PaymentApproval.holo');
const digestOf = (bytes) => `blake3:${blake3Hex(bytes.subarray(0, bytes.length - 32))}`;
const CALCULATOR = digestOf(calculator);
const SIGNED = digestOf(signed);
const fixturePath = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const ADD = '1\tadd\t20\t22';
const P0 = Object.freeze({ policy: { minimum: 'P0' } });

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'prism-image-store-')));
test.after(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const fresh = () => join(dir, `store-${counter++}`);

/** A store whose holders are given by the test: `[{ digest, running }]`. */
function storeWith(held = [], backend = memoryImageStore()) {
  let clock = Date.parse('2026-11-12T00:00:00Z');
  return createImageStore({ backend, references: () => held, now: () => (clock += 1000) });
}

// The decision table

test('the rules are one row for every possible case of remove and prune, and nothing else', () => {
  assert.equal(IMAGE_STORE_RULES.schema, 'prism/image-store-rules/1');
  assert.equal(IMAGE_STORE_RULES.store, IMAGE_STORE_SCHEMA);
  assert.deepEqual(IMAGE_STORE_RULES.facts, { remove: ['byTag', 'otherTags', 'referenced', 'running', 'force'], prune: ['tagged', 'referenced', 'all'] });
  const bools = [false, true];
  let cases = 0;
  for (const byTag of bools) for (const otherTags of bools) for (const referenced of bools) for (const running of bools) for (const force of bools) {
    if (running && !referenced) continue; // a running container is a container that references the image
    cases += 1;
    const { outcome, code } = decide('remove', { byTag, otherTags, referenced, running, force });
    assert.ok(['untag', 'delete', 'refuse'].includes(outcome));
    if (outcome === 'refuse') assert.ok(['image.in-use', 'image.tagged'].includes(code));
    // The rules the model proves, read back from the table.
    if (running && outcome === 'delete') assert.fail('an image a running container references is never deleted');
    if (referenced && !force) assert.notEqual(outcome, 'delete');
  }
  for (const tagged of bools) for (const referenced of bools) for (const all of bools) {
    cases += 1;
    const { outcome } = decide('prune', { tagged, referenced, all });
    assert.equal(outcome, !referenced && (!tagged || all) ? 'delete' : 'keep');
  }
  assert.equal(cases, Object.keys(IMAGE_STORE_RULES.remove).length + Object.keys(IMAGE_STORE_RULES.prune).length, 'no row for a case that cannot happen');
});

test('a local name is [registry/]repository[:tag], latest when no tag is given; anything else is refused', () => {
  assert.equal(localName('calculator'), 'calculator:latest');
  assert.equal(localName('acme/calculator:1.0'), 'acme/calculator:1.0');
  assert.equal(localName('localhost:5000/acme/calculator:1'), 'localhost:5000/acme/calculator:1');
  for (const bad of ['', 'Calculator:1', 'a:b:c', `app@sha256:${'0'.repeat(64)}`, 'dir://./store:1', 'app:-x']) assert.throws(() => localName(bad), (error) => ['image.name', 'reference_invalid'].includes(error.code), bad);
});

// add, list, get, tag

test('an image is kept once by its digest; tags are names that point at it and move when retagged', async () => {
  const store = storeWith();
  const first = await store.add(calculator, { tags: ['calc:1'] });
  assert.deepEqual([first.digest, first.tags, first.size], [CALCULATOR, ['calc:1'], calculator.length]);
  assert.equal(first.fileDigest.blake3, blake3Hex(calculator));
  assert.match(first.fileDigest.sha256, /^[0-9a-f]{64}$/);
  const again = await store.add(calculator, { tags: ['calc'] });
  assert.equal(again.created, first.created, 'the same bytes are not kept twice');
  assert.deepEqual(again.tags, ['calc:1', 'calc:latest']);
  await store.add(signed, { tags: ['calc'] });
  assert.deepEqual((await store.list()).map((image) => [image.digest, image.tags]), [
    [SIGNED, ['calc:latest']],
    [CALCULATOR, ['calc:1']],
  ]);
  assert.deepEqual((await store.list({ name: 'calc' })).length, 2);
  assert.deepEqual((await store.list({ name: 'calc:1' })).map((image) => image.digest), [CALCULATOR]);
  assert.deepEqual((await store.list({ dangling: true })).length, 0);
  assert.deepEqual((await store.tag(CALCULATOR.slice(7, 19), 'ghcr.io/acme/calc:1')).tags, ['calc:1', 'ghcr.io/acme/calc:1']);
  assert.deepEqual((await store.get('ghcr.io/acme/calc:1')).digest, CALCULATOR);
  assert.ok(Buffer.from((await store.get(CALCULATOR)).bytes).equals(Buffer.from(calculator)));
  await assert.rejects(store.get('calc:2'), { code: 'image.missing' });
  await assert.rejects(store.get(`blake3:${'0'.repeat(64)}`), { code: 'image.missing' });
  await assert.rejects(store.tag('calc:2', 'x:1'), { code: 'image.missing' });
  await assert.rejects(store.add(calculator.slice(0, -1)), (error) => typeof error.code === 'string');
});

test('an id prefix that names two images is refused as ambiguous, and fewer than four characters are a name', async () => {
  const backend = memoryImageStore();
  const row = (hex) => ({ id: `blake3:${hex}`, digest: `blake3:${hex}`, fileDigest: { sha256: hex, blake3: hex }, size: 1, created: '2026-11-12T00:00:00.000Z' });
  const a = `abcd1${'0'.repeat(59)}`;
  const b = `abcd2${'0'.repeat(59)}`;
  backend.write({ schema: IMAGE_STORE_SCHEMA, images: { [a]: row(a), [b]: row(b) }, tags: {} });
  const store = storeWith([], backend);
  await assert.rejects(store.get('abcd'), { code: 'image.ambiguous' });
  await assert.rejects(store.get('blake3:abcd'), { code: 'image.ambiguous' });
  await assert.rejects(store.tag('abcd1', 'x:1').then(() => store.get('abcd1')), { code: 'image.corrupt' }, 'a unique prefix resolves; this store keeps no bytes');
  await assert.rejects(store.get('abc'), { code: 'image.missing' }, 'three characters are a name, abc:latest');
});

// remove

test('remove by one of several tags untags; by the last tag or the digest it deletes the bytes and every tag', async () => {
  const store = storeWith();
  await store.add(calculator, { tags: ['a:1', 'b:1'] });
  assert.deepEqual(await store.remove('a:1'), { schema: 'prism/image-remove/1', untagged: ['a:1'], deleted: [], spaceReclaimed: 0 });
  assert.deepEqual(await store.remove('b:1'), { schema: 'prism/image-remove/1', untagged: ['b:1'], deleted: [CALCULATOR], spaceReclaimed: calculator.length });
  assert.deepEqual(await store.list(), []);
  await store.add(calculator, { tags: ['a:1', 'b:1'] });
  await assert.rejects(store.remove(CALCULATOR), (error) => error.code === 'image.tagged' && /a:1, b:1/.test(error.message));
  assert.deepEqual((await store.remove(CALCULATOR, { force: true })).deleted, [CALCULATOR]);
  await assert.rejects(store.remove('a:1'), { code: 'image.missing' });
});

test('remove refuses while a container references the image unless forced, and always while one is running', async () => {
  const held = [{ digest: CALCULATOR, running: false }];
  const store = storeWith(held);
  await store.add(calculator, { tags: ['calc:1', 'calc:2'] });
  // Untagging one of two names never touches the image, whoever holds it.
  assert.deepEqual((await store.remove('calc:2')).untagged, ['calc:2']);
  await assert.rejects(store.remove('calc:1'), (error) => error.code === 'image.in-use' && error.details.containers === 1 && /pass force/.test(error.message));
  held[0].running = true;
  await assert.rejects(store.remove('calc:1', { force: true }), (error) => error.code === 'image.in-use' && error.details.running === true && /running/.test(error.message));
  held[0].running = false;
  assert.deepEqual((await store.remove('calc:1', { force: true })).deleted, [CALCULATOR]);
  assert.throws(() => store.remove('calc:1', { force: 'yes' }), { code: 'PP1001' });
});

// prune

test('prune removes only untagged images that no container references; all removes tagged ones none references', async () => {
  const store = storeWith([{ digest: SIGNED, running: false }]);
  await store.add(calculator);
  await store.add(signed);
  await store.add(payment, { tags: ['pay:1'] });
  const PAYMENT = digestOf(payment);
  assert.deepEqual(await store.prune(), { schema: 'prism/image-prune/1', imagesDeleted: [CALCULATOR], spaceReclaimed: calculator.length });
  assert.deepEqual((await store.list()).map((image) => image.digest).sort(), [SIGNED, PAYMENT].sort(), 'the referenced untagged image survives');
  assert.deepEqual((await store.prune({ all: true })).imagesDeleted, [PAYMENT]);
  assert.deepEqual((await store.list()).map((image) => image.digest), [SIGNED]);
  assert.deepEqual((await store.prune({ all: true })).imagesDeleted, []);
});

// the file store

test('the file store keeps index.json and blobs/blake3/<hex>, private to this user, and reads them back in a new process', async () => {
  const root = fresh();
  await storeWith([], fileImageStore(root)).add(calculator, { tags: ['calc:1'] });
  const reopened = storeWith([], fileImageStore(root));
  assert.deepEqual((await reopened.list()).map((image) => image.tags), [['calc:1']]);
  const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
  assert.deepEqual(Object.keys(index), ['schema', 'images', 'tags']);
  assert.deepEqual(index.tags, { 'calc:1': CALCULATOR.slice(7) });
  assert.deepEqual(readdirSync(join(root, 'blobs', 'blake3')), [CALCULATOR.slice(7)]);
  assert.deepEqual(readdirSync(root).sort(), ['blobs', 'index.json'], 'no scratch file is left behind');
  await reopened.remove('calc:1');
  assert.deepEqual(readdirSync(join(root, 'blobs', 'blake3')), []);
});

test('bytes changed on disk are reported as image.corrupt, not served, and a broken index is refused', async () => {
  const root = fresh();
  const store = storeWith([], fileImageStore(root));
  await store.add(calculator, { tags: ['calc:1'] });
  const blob = join(root, 'blobs', 'blake3', CALCULATOR.slice(7));
  const changed = calculator.slice();
  changed[100] ^= 1;
  chmodSync(blob, 0o600);
  writeFileSync(blob, changed);
  await assert.rejects(store.get('calc:1'), { code: 'image.corrupt' });
  rmSync(blob);
  await assert.rejects(store.get('calc:1'), { code: 'image.corrupt' });
  writeFileSync(join(root, 'index.json'), '{"schema":"prism/image-store/1","images":{},"tags":{"x:1":"00"}}');
  await assert.rejects(store.list(), (error) => error.code === 'image.store' && /does not keep/.test(error.message));
  writeFileSync(join(root, 'index.json'), 'not json');
  await assert.rejects(store.list(), { code: 'image.store' });
});

test('Prism.fromEnv keeps images in $PRISM_IMAGES, else $PRISM_HOME/images', async () => {
  assert.equal(imagesDirectory({ PRISM_IMAGES: '/x/images', PRISM_HOME: '/y' }), '/x/images');
  assert.equal(imagesDirectory({ PRISM_HOME: '/y' }), join('/y', 'images'));
  const home = fresh();
  const prism = Prism.fromEnv({ env: { PRISM_HOME: home } });
  assert.deepEqual(await prism.images.list(), []);
  assert.equal((await prism.system.df()).images.location, join(home, 'images'));
});

// the client: containers hold images

test('on one client a container holds its image: remove refuses, prune keeps it, df counts it active', async () => {
  const prism = createPrism({ warn: () => {} });
  const container = await prism.containers.create(fixturePath, ADD, P0);
  assert.equal((await container.inspect()).image.digest, CALCULATOR);
  const layout = fresh();
  const seed = createImages();
  await seed.push('calc:1', { source: calculator, store: layout });
  await seed.push('other:1', { source: signed, store: layout });
  await prism.images.pull('calc:1', { store: layout });
  await prism.images.pull('other:1', { store: layout });
  await assert.rejects(prism.images.remove('calc:1'), { code: 'image.in-use' });
  const df = await prism.system.df();
  assert.deepEqual([df.images.total, df.images.active, df.images.size, df.images.reclaimable], [2, 1, calculator.length + signed.length, signed.length]);
  assert.deepEqual((await prism.images.remove('other:1')).deleted, [SIGNED]);
  assert.equal((await prism.system.info()).images, 1);
  // Not even `all` collects an image a created container will start from.
  assert.deepEqual((await prism.system.prune({ all: true })).imagesDeleted, []);
  assert.equal((await container.start()).exitCode, 0);
  const done = await prism.system.prune({ all: true });
  assert.deepEqual([done.containersDeleted, done.imagesDeleted], [[container.id], [CALCULATOR]]);
  assert.deepEqual(await prism.images.list(), []);
});

// the CLI: prism-code images ls|tag|rm|prune, Docker's images, tag and rmi, and pull and push through the store

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));

test('the CLI keeps a pulled image, lists, tags, removes and prunes it, and pushes a stored image by its name', async () => {
  const images = fresh();
  const cwd = fresh();
  const layout = fresh();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(cwd, { recursive: true });
  await createImages().push('calc:1', { source: calculator, store: layout });
  const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PRISM_IMAGES: images, PRISM_HOME: join(cwd, 'home') } });
  writeFileSync(join(cwd, 'p0.json'), JSON.stringify({ name: 'p0', minimum: 'P0' }));
  const pulled = cli('pull', 'calc:1', 'out.holo', '--store', layout, '--policy', 'p0.json');
  assert.equal(pulled.status, 0, pulled.stderr);
  const listed = cli('images');
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^REPOSITORY +TAG +IMAGE ID +CREATED +SIZE\ncalc +1 +8408e0895572 +/);
  assert.equal(cli('tag', 'calc:1', 'ghcr.io/acme/calc:2').status, 0);
  const json = JSON.parse(cli('images', 'ls', '--json').stdout);
  assert.deepEqual(json.map((image) => [image.digest, image.tags]), [[CALCULATOR, ['calc:1', 'ghcr.io/acme/calc:2']]]);
  // The stored image goes out by its name alone.
  const target = fresh();
  const pushed = cli('push', 'calc:1', '--store', target);
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.match(pushed.stdout, new RegExp(`fingerprint: ${CALCULATOR}`));
  assert.deepEqual([cli('rmi', 'ghcr.io/acme/calc:2').stdout], ['Untagged: ghcr.io/acme/calc:2\n']);
  const missing = cli('rmi', 'nope:1');
  assert.equal(missing.status === 0, false);
  assert.match(missing.stderr, /^image\.missing: no such image: nope:1/);
  assert.equal(cli('images', 'rm', 'calc:1').stdout, `Untagged: calc:1\nDeleted: ${CALCULATOR}\n`);
  assert.equal(cli('images', 'prune', '--all').stdout, 'Total reclaimed space: 0B\n');
  assert.equal(cli('images', '--bogus').status, 64);
  assert.equal(cli('images', 'tag', 'only-one').status, 64);
  // A module verb after `images` is still the group verb, and `images --help` the group's help.
  assert.match(cli('images', '--help').stdout, /prism-code images ls /);
  assert.equal(cli('images', 'inspect', fixturePath, '--json').status, 0);
});
