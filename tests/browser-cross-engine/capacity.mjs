// Private full-domain storage fixture. No quota fallback or model replacement.
import assert from 'node:assert/strict';
import {createCipheriv, createHash} from 'node:crypto';
import {appendFileSync, lstatSync, mkdtempSync, realpathSync, rmSync, statfsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {browserPins, withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {decodeRetentionWire} from '../../sdk/browser/session-retention-wire.mjs';
import {captureStorageSources} from '../browser-session-journal/storage-browser.mjs';
import {encodeRetentionFixture} from '../browser-session-journal/retention-corpus.mjs';

const GiB = 1073741824, FRAME = 67108864;
export const capacityDomain = Object.freeze({objects: 4096, roots: 64, chunk: 1048576,
  additions: 16, initialBatches: 256, finalRevision: 384});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rootName = index => ('root-' + String(index).padStart(2, '0') + '-').padEnd(128, 'x');
const sorted = references => references.toSorted(Buffer.compare);

export function capacityObjectDigest(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < 4112);
  const counter = Buffer.alloc(16); counter.writeUInt32BE(index);
  const cipher = createCipheriv('aes-256-ctr', Buffer.from(Array.from({length: 32}, (_, i) => i)), counter);
  const digest = createHash('sha256'); digest.update(cipher.update(Buffer.alloc(1048576))); digest.update(cipher.final());
  return digest.digest();
}

export function capacitySnapshot(catalogue, additions, phase) {
  assert.equal(catalogue.length, 4096); assert.equal(additions.length, 16);
  assert.ok(['full', 'released', 'replaced'].includes(phase));
  const kept = catalogue.slice(0, 4080), all = sorted(catalogue), retained = sorted(kept), final = sorted([...kept, ...additions]);
  const roots = Array.from({length:64},(_,index)=>[rootName(index),phase==='replaced'&&index===0?additions[0]:catalogue[index],
    phase==='full'?all:index===0?(phase==='replaced'?final:all):retained]);
  return encodeRetentionFixture([1,{full:320,released:383,replaced:384}[phase],phase==='replaced'?final:all,roots]);
}

export function requireCapacityReserve(directory, initial = false) {
  const stat = statfsSync(directory, {bigint: true}), bytes = stat.bavail * stat.bsize;
  assert.ok(bytes >= BigInt(initial ? 20 : 12) * BigInt(GiB),
    'full storage capacity requires ' + (initial ? 20 : 12) + ' GiB free; no reduced-domain fallback');
  return bytes.toString();
}

async function prepare(page, baseURL, wire, sources, unexpected) {
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'GET' && [baseURL, baseURL + 'favicon.ico'].includes(url.href)) return route.continue();
    const name = url.pathname.slice(1);
    if (request.method() !== 'GET' || url.origin !== new URL(baseURL).origin || url.search || !Object.hasOwn(sources, name)) {
      unexpected.push([request.method(), url.href]); return route.abort('blockedbyclient');
    }
    return route.fulfill({status: 200, contentType: 'text/javascript', body: sources[name]});
  });
  await page.goto(baseURL);
  await page.evaluate(bytes => {
    globalThis.capacityWire = Uint8Array.from(bytes);
    const originalCompile = WebAssembly.compile, OriginalInstance = WebAssembly.Instance;
    const modules = new WeakSet(), calls = [];
    WebAssembly.compile = async input => {
      const value = new Uint8Array(input).slice();
      if (value.length !== bytes.length || !value.every((byte, index) => byte === bytes[index])) throw Error('exact capacity artifact');
      const module = await originalCompile(value); modules.add(module); return module;
    };
    WebAssembly.Instance = class {
      constructor(module, imports) {
        if (!modules.has(module)) throw Error('captured capacity module provenance');
        const instance = new OriginalInstance(module, imports), exports = {...instance.exports};
        exports.holo_run = (pointer, length) => {
          const request = new Uint8Array(exports.memory.buffer, pointer, length).slice();
          const result = instance.exports.holo_run(pointer, length), packed = BigInt.asUintN(64, result);
          const response = new Uint8Array(exports.memory.buffer, Number(packed >> 32n), Number(packed & 0xffffffffn)).slice();
          if (exports.memory.buffer.byteLength > 1073741824 || calls.length >= 3) throw Error('bounded capacity observation');
          calls.push({request, response, memory: exports.memory.buffer.byteLength}); return result;
        };
        return {exports};
      }
    };
    globalThis.capacityCalls = calls;
  }, Array.from(wire));
  await page.addScriptTag({type: 'module', content: `
    import {openSessionStorage} from './session-storage.mjs';
    import {encodeRetentionWire as encode, decodeRetentionWire as decode} from './session-retention-wire.mjs';
    const wire = globalThis.capacityWire; delete globalThis.capacityWire;
    const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const wireDigest = await digest(wire);
    const key = await crypto.subtle.importKey('raw', Uint8Array.from({length:32},(_,i)=>i), 'AES-CTR', false, ['encrypt']);
    const chunk = async index => {
      const counter = new Uint8Array(16); new DataView(counter.buffer).setUint32(0,index,false);
      return new Uint8Array(await crypto.subtle.encrypt({name:'AES-CTR',counter,length:64},key,new Uint8Array(1048576)));
    };
    const sort = refs => refs.toSorted((a,b)=>{for(let i=0;i<32;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;});
    const name = index => ('root-'+String(index).padStart(2,'0')+'-').padEnd(128,'x');
    const replace = (index, expected, head, refs) => encode([1,[name(index),expected===null?[0]:[1,expected],head,sort(refs)]]);
    const fail = async operation => {try {await operation();return 'unexpected-success';}catch(error){return error.code??error.message;}};
    const store = await openSessionStorage({namespace:'full-capacity',wire,wireDigest});
    const state = {store,current:await store.snapshot(),catalogue:[],encode,decode,digest,chunk,sort,name,replace,fail};
    globalThis.capacity = state;
  `});
  await page.waitForFunction(() => globalThis.capacity !== undefined);
}

function verifyObservation(build, row, label, index, expected) {
  for(const value of [row.request,row.response])assert.ok(typeof value==='string'&&value.length>0&&value.length%2===0&&!/[^a-f0-9]/.test(value));
  const request = Buffer.from(row.request, 'hex'), response = Buffer.from(row.response, 'hex');
  assert.ok(request.length <= FRAME && response.length <= FRAME && row.memory <= GiB);
  const input = decodeRetentionWire(request), output = decodeRetentionWire(response);
  assert.equal(input[0], 1); assert.equal(input[1], expected.tag, 'complete capacity operation inventory');
  assert.equal(output[0], 1); assert.equal(output[1], expected.refused ? 1 : 0, 'capacity generated verdict');
  if (expected.tag === 1) assert.equal(output[2], true);
  const path = join(build.work, 'capacity-current.tsv'), id = 'Capacity' + index;
  writeFileSync(path, id + '\t' + row.request + '\t' + row.response + '\n');
  for (const standard of [true, false]) assert.equal(build.runNative(standard, ['retention', path]),
    'PASS ' + id + '\nPASS 1 journal retention vectors twice\n', 'exact capacity browser/native replay');
  return {label, index, tag: input[1], refused: Boolean(expected.refused), request: sha(request), response: sha(response),
    requestBytes: request.length, responseBytes: response.length, memory: row.memory};
}

export async function verifyStorageCapacity(build, {engine = 'chromium', directory} = {}) {
  assert.ok(Object.hasOwn(browserPins, engine)); assert.equal(typeof directory, 'string');
  assert.equal(realpathSync(directory), directory); assert.ok(lstatSync(directory).isDirectory());
  const startFree = requireCapacityReserve(directory, true), sources = captureStorageSources(build.inputs);
  const profile = mkdtempSync(join(directory, 'prismpm-capacity-profile-')), unexpected = [], observations = [];
  const progress=join(build.work,'capacity-progress.jsonl');
  writeFileSync(progress,JSON.stringify({scope:'incomplete-capacity-diagnostic',profile,engine,startFree})+'\n',{flag:'wx'});
  const validation = {tag: 1}, transition = {tag: 0}, refusal = {tag: 0, refused: true};
  // Independent Node AES-CTR/SHA-256 fixture data, not browser-returned IDs.
  // Only one 1-MiB object exists at a time; no 4-GiB combined allocation.
  const catalogue = [], additions = [];
  for(let index=0;index<4112;index++) {
    if(index%16===0)requireCapacityReserve(directory);
    (index<4096?catalogue:additions).push(capacityObjectDigest(index));
  }
  assert.equal(new Set([...catalogue,...additions].map(value=>value.toString('hex'))).size,4112);
  let passed = false, sequence = 0, finalSnapshot;
  const witness = createHash('sha256'); build.unchanged();
  try {
    await withBrowser(async ({baseURL, launchPersistentContext}) => {
      let context, page;
      const expectFrontier = async phase => {
        const actual = await page.evaluate(()=>{
          const pieces=[],bytes=capacity.current;
          for(let at=0;at<bytes.length;at+=4096)pieces.push(Array.from(bytes.subarray(at,at+4096),b=>b.toString(16).padStart(2,'0')).join(''));
          return pieces.join('');
        });
        assert.deepEqual(Buffer.from(actual,'hex'),Buffer.from(capacitySnapshot(catalogue,additions,phase)),
          'independent complete frontier: '+phase);
      };
      const drain = async (label, expected) => {
        requireCapacityReserve(directory); assert.deepEqual(unexpected, []);
        assert.equal(await page.evaluate(() => capacityCalls.length), expected.length, 'complete capacity call count: ' + label);
        for (const item of expected) {
          const row = await page.evaluate(() => {
            const value = capacityCalls.shift(), hex = bytes => {
              const pieces=[];
              for(let at=0;at<bytes.length;at+=4096)pieces.push(Array.from(bytes.subarray(at,at+4096),b=>b.toString(16).padStart(2,'0')).join(''));
              return pieces.join('');
            };
            return {request:hex(value.request),response:hex(value.response),memory:value.memory};
          });
          const evidence = verifyObservation(build, row, label, sequence++, item);
          observations.push(evidence); witness.update(JSON.stringify(evidence) + '\n');
          appendFileSync(progress,JSON.stringify(evidence)+'\n');
        }
        assert.equal(await page.evaluate(() => capacityCalls.length), 0); build.unchanged();
      };
      const reopen = async label => {
        if (context) {await page.evaluate(() => capacity.store.close()); await context.close();}
        context = await launchPersistentContext(profile); page = await context.newPage();
        await prepare(page, baseURL, build.wasm.retention, sources, unexpected); await drain(label, [validation, validation]);
      };
      const readAll = async (label, replaced) => {
        for (let start = 0; start < 4096; start += 16) {
          requireCapacityReserve(directory);
          const result = await page.evaluate(async ({start,replaced}) => {
            const {store,chunk,digest} = capacity;
            for (let index=start;index<start+16;index++) {
              const selected=replaced&&index>=4080?index+16:index,expected=await chunk(selected),id=await digest(expected);
              const actual=await store.read(id);
              if (!(actual instanceof Uint8Array)||actual.length!==1048576||!actual.every((byte,i)=>byte===expected[i]))throw Error('full capacity object bytes');
            }
            return 16;
          }, {start,replaced});
          assert.equal(result, 16); await drain(label + '-' + start, []);
        }
      };
      await reopen('initial');
      for (let batch = 0; batch < 256; batch++) {
        requireCapacityReserve(directory);
        const result = await page.evaluate(async batch => {
          const s=capacity,objects=[];
          for(let offset=0;offset<16;offset++){const bytes=await s.chunk(batch*16+offset);objects.push(bytes);s.catalogue.push(await s.digest(bytes));}
          s.current=await s.store.commit({expected:s.current,replacement:s.encode([0]),objects,retire:s.encode([])});
          const after=s.decode(s.current);return [after[1],after[2].length,after[3].length];
        }, batch);
        assert.deepEqual(result, [batch + 1, (batch + 1) * 16, 0]); await drain('add-' + batch, [transition, validation]);
      }
      for (let index = 0; index < 64; index++) {
        const result = await page.evaluate(async index => {
          const s=capacity;s.current=await s.store.commit({expected:s.current,replacement:s.replace(index,null,s.catalogue[index],s.catalogue),objects:[],retire:s.encode([])});
          const after=s.decode(s.current);return [after[1],after[2].length,after[3].length,after[3].every(row=>row[0].length===128&&row[2].length===4096)];
        }, index);
        assert.deepEqual(result, [257 + index, 4096, index + 1, true]); await drain('root-' + index, [transition, validation]);
      }
      assert.deepEqual(await page.evaluate(()=>capacity.catalogue.map(value=>Array.from(value))),catalogue.map(value=>Array.from(value)));
      await expectFrontier('full');
      await reopen('full-restart');
      await expectFrontier('full');
      assert.deepEqual(await page.evaluate(()=>{const s=capacity.decode(capacity.current);return [s[1],s[2].length,s[3].length,s[3].every(row=>row[2].length===4096)];}),[320,4096,64,true]);
      await readAll('read-full', false);
      for (const kind of ['overflow', 'protected']) {
        assert.equal(await page.evaluate(async kind=>{
          const s=capacity;return s.fail(async()=>s.store.commit({expected:s.current,replacement:s.encode([0]),objects:kind==='overflow'?[await s.chunk(4096)]:[],retire:s.encode(kind==='protected'?[await s.digest(await s.chunk(4080))]:[])}));
        },kind),'model-rejected'); await drain(kind,[refusal]);
        assert.equal(await page.evaluate(async()=>{const value=await capacity.store.snapshot();return value.length===capacity.current.length&&value.every((byte,i)=>byte===capacity.current[i]);}),true);
        await drain(kind+'-unchanged',[validation]);await expectFrontier('full');
      }
      await page.evaluate(values=>{capacity.catalogue=values.map(value=>Uint8Array.from(value));},catalogue.map(value=>Array.from(value)));
      for(let index=1;index<64;index++) {
        const result=await page.evaluate(async index=>{
          const s=capacity;s.current=await s.store.commit({expected:s.current,replacement:s.replace(index,s.catalogue[index],s.catalogue[index],s.catalogue.slice(0,4080)),objects:[],retire:s.encode([])});
          return s.decode(s.current)[1];
        },index);assert.equal(result,320+index);await drain('release-old-'+index,[transition,validation]);
      }
      await expectFrontier('released');
      const result=await page.evaluate(async()=>{
        const s=capacity,before=s.decode(s.current),objects=[],ids=[];
        for(let i=4096;i<4112;i++){const bytes=await s.chunk(i);objects.push(bytes);ids.push(await s.digest(bytes));}
        s.current=await s.store.commit({expected:s.current,replacement:s.replace(0,s.catalogue[0],ids[0],[...s.catalogue.slice(0,4080),...ids]),objects,retire:s.encode(s.sort(s.catalogue.slice(4080)))});
        const after=s.decode(s.current);return [after[1],after[2].length,after[3].length,JSON.stringify(before[3].slice(1))===JSON.stringify(after[3].slice(1))];
      });assert.deepEqual(result,[384,4096,64,true]);await drain('atomic-sixteen-replacement',[transition,validation]);
      await expectFrontier('replaced');
      await reopen('replacement-restart');await expectFrontier('replaced');await readAll('read-replaced',true);
      assert.equal(await page.evaluate(async()=>{for(let i=4080;i<4096;i++)if(await capacity.store.read(await capacity.digest(await capacity.chunk(i)))!==null)return false;return true;}),true);
      await drain('retired-objects-absent',[]);
      finalSnapshot=await page.evaluate(async()=>{const bytes=await capacity.store.snapshot(),state=capacity.decode(bytes);return {revision:state[1],objects:state[2].length,roots:state[3].length,length:bytes.length,digest:Array.from(await capacity.digest(bytes),b=>b.toString(16).padStart(2,'0')).join('')};});
      await drain('final-snapshot',[validation]);await page.evaluate(()=>capacity.store.close());await context.close();
    }, {engine});
    assert.equal(observations.length,779,'complete full-capacity generated-call inventory');
    assert.equal(observations.filter(row=>row.tag===1).length,393);
    assert.equal(observations.filter(row=>row.tag===0&&!row.refused).length,384);
    assert.equal(observations.filter(row=>row.refused).length,2);
    assert.deepEqual([finalSnapshot.revision,finalSnapshot.objects,finalSnapshot.roots],[384,4096,64]);
    assert.equal(finalSnapshot.digest,sha(capacitySnapshot(catalogue,additions,'replaced')));
    build.unchanged(); const endFree=requireCapacityReserve(directory); passed=true;
    return {scope:'private-full-storage-capacity-only',engine,version:browserPins[engine].version,domain:capacityDomain,
      startFree,endFree,wasm:sha(build.wasm.retention),finalSnapshot,
      calls:observations.length,observations,transcript:witness.digest('hex'),payloadReadbackBytes:2*4096*1048576,
      publicApplicationAccepted:false};
  } finally {
    // Only this fresh successful fixture profile is disposable; failures remain inspectable.
    if(passed){assert.equal(realpathSync(profile),profile);rmSync(profile,{recursive:true});}
  }
}
