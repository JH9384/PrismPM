import assert from 'node:assert/strict';
export const payloadHostMutations = Object.freeze([
  {id:'capture-before-await',journey:'capture',before:'const bytes = bytesCopy(value.bytes, FRAME), root = value.root;',
    after:'const bytes = value.bytes, root = value.root;'},
  {id:'same-handle-overlap',journey:'capture',before:"if (this.#busy) throw fail('payload-busy');",after:'void this.#busy;'},
  {id:'uncertain-publication',journey:'partial',before:"if (this.#uncertain) throw fail('publication-uncertain');",after:'void this.#uncertain;'},
  {id:'preserve-staging-closure',journey:'preserve',
    before:'const references = new Map((selected?.[2] ?? []).map(reference => [hex(reference), reference]));',
    after:'const references = new Map();'},
  {id:'whole-payload-digest',journey:'digest',
    before:"if (offset !== length || !same(await hash(bytes), digest)) throw fail('payload-invalid');",
    after:"if (offset !== length) throw fail('payload-invalid');"},
  {id:'actual-readback',journey:'corrupt',
    before:"if (!same(await this.#load(descriptor), bytes)) throw fail('payload-invalid');",
    after:'void descriptor;'},
  {id:'descriptor-before-chunks',journey:'partial',
    before:'const objects = [...additions.values()]; let prior = expected;',
    after:'const entries = [...additions.values()]; const objects = [entries.at(-1), ...entries.slice(0, -1)]; let prior = expected;'},
  {id:'constructor-brand',journey:'brand',module:'session-storage.mjs',
    before:'this.#db = db; this.#model = model;',after:'this.#db = db; this.#model = model; storageHandles.add(this);'},
  {id:'virtual-factory-snapshot',journey:'brand',module:'session-storage.mjs',
    before:'await Reflect.apply(storageMethods.snapshot, storage, []);',after:'await storage.snapshot();'},
  {id:'virtual-versionchange-close',journey:'versionchange',module:'session-storage.mjs',
    before:'db.onversionchange = () => this.#shutdown();',after:'db.onversionchange = () => this.close();'},
]);
export function mutatePayloadHost(source, mutation) {
  assert.equal(source.split(mutation.before).length,2,'one exact actual payload guard '+mutation.id);
  return source.replace(mutation.before,mutation.after);
}
