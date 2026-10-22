import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {decodeCaptureCbor, decodeCaptureJson, projectCapturedSource} from './capture-oracle.mjs';
import {encode} from './corpus.mjs';
import {frozenInputs, repository} from './compile.mjs';
import {requireCaptureCompletion} from './capture-owner.mjs';
import {localModuleInputs} from '../browser-view/local-module-inputs.mjs';

test('independent capture decoder and owning source closure are complete and canonical', t => {
  const entry = 'tests/publication-context-linkage/owner.test.mjs', inputs = frozenInputs();
  assert.ok(inputs[entry] && inputs['tests/publication-context-linkage/checks.mjs']);
  const closure = localModuleInputs(repository, [entry], path => readFileSync(join(repository, path)));
  const original = closure.get(entry), staticImport = "import {verifyCompletePublicationLinkage} from './checks.mjs';";
  assert.equal(original.toString('utf8').split(staticImport).length, 2);
  const work = mkdtempSync(join(tmpdir(), 'prismpm-oc10-entry-closure-'));
  for (const kind of ['baseline', 'dynamic']) {
    const root = join(work, kind);
    for (const [path, bytes] of closure) {
      const target = join(root, path); mkdirSync(dirname(target), {recursive:true});
      const value = kind === 'dynamic' && path === entry
        ? Buffer.from(bytes.toString('utf8').replace(staticImport,
          "const {verifyCompletePublicationLinkage} = await im" + "port('./checks.mjs');")) : bytes;
      writeFileSync(target, value, {flag:'wx', mode:0o400});
    }
    const capture = () => localModuleInputs(root, [entry], path => readFileSync(join(root, path)));
    if (kind === 'baseline') assert.deepEqual(capture(), closure);
    else assert.throws(capture, /dynamic imports require a separately registered owning closure/);
  }
  assert.deepEqual(readFileSync(join(repository, entry)), original);
  t.diagnostic('Retained actual owning-entry closure counterexample: ' + work);
  for (const [format, bytes] of [['prismpm', '{"a":1}'], ['lexlean-snapshot', '{"a":1}\n']]) {
    assert.deepEqual(decodeCaptureJson(Buffer.from(bytes), format), {a:1});
    for (const changed of [bytes + '\n', ' ' + bytes, bytes.replace('1', ' 1'),
      bytes.replace('{"a":1}', '{"a":0,"a":1}')])
      assert.throws(() => decodeCaptureJson(Buffer.from(changed), format), /exact canonical captured JSON framing/);
  }
  assert.throws(() => decodeCaptureJson(Buffer.from('{"a":1}'), 'lexlean-snapshot'), /exact canonical captured JSON framing/);
  assert.throws(() => decodeCaptureJson(Buffer.from('{"a":1}\n'), 'prismpm'), /exact canonical captured JSON framing/);
  assert.throws(() => decodeCaptureJson(Buffer.from('{}'), 'unknown'), /closed captured JSON format/);
  for (const value of [undefined, null, {}, {path:'/tmp/saved-receipt', sha256:'a'.repeat(64)}])
    assert.throws(() => requireCaptureCompletion(value), /actual fresh capture and generated replay completion required/);
  for (const value of [0, 23, 24, 255, 256, 65535, 65536, 0xffffffff, '', 'é\ufeff',
    Buffer.alloc(0), Buffer.alloc(24, 0xa5), [1, 0, [Buffer.alloc(32, 4), 'source']]])
    assert.deepEqual(decodeCaptureCbor(encode(value)), value);
  for (const bytes of [[0x18, 23], [0x19, 0, 255], [0x1a, 0, 0, 255, 255], [0x9f, 0xff],
    [0x61, 0xff], [0x82, 1], [0x01, 0x01], [0xa0], [0xc0], [0x1b, 0,0,0,0,0,0,0,1]])
    assert.throws(() => decodeCaptureCbor(Buffer.from(bytes)));
  let nested = 0; for (let depth = 0; depth < 66; depth++) nested = [nested];
  assert.throws(() => decodeCaptureCbor(encode(nested)), /bounded complete captured CBOR/);
});

function fixtureSyntax() {
  const names = ['Publication', 'Production.PublicationAdmission.LinkageV1', 'Production.PublicationAdmission.V1'];
  return {modules:names.map(name => {
    const path = (name === 'Publication' ? 'tests/publication-context-linkage' : 'stdlib') + '/src/' + name.replaceAll('.', '/') + '.lex.tex';
    const semantic = JSON.parse(/\\semanticdata\{(.*)\}/.exec(readFileSync(join(repository, path), 'utf8'))[1]);
    return {name, source:{path}, declarations:semantic.declarations.map(row => ({logical_id:row.name, linked_ir:row}))};
  })};
}

test('independent syntax projection closes actual authored fixture records and aliases', () => {
  const snapshot = fixtureSyntax(), original = projectCapturedSource(snapshot);
  assert.deepEqual(original.member, ['Publication', 'publicationClosure']);
  assert.equal(original.closure.target, 'pages');
  assert.deepEqual(original.closure.system, {module:'Release', name:'systemModelB'});
  assert.equal(original.closure.requirements.length, 3);
  for (const defect of ['missing', 'duplicate', 'extra-field', 'missing-field', 'reordered-fields', 'type-arguments', 'alias-cycle', 'unknown-alias']) {
    const changed = structuredClone(snapshot), rows = changed.modules[0].declarations;
    const row = rows.find(value => value.logical_id === 'publicationClosure').linked_ir;
    if (defect === 'missing') rows.splice(rows.findIndex(value => value.logical_id === 'publicationClosure'), 1);
    else if (defect === 'duplicate') rows.push({linked_ir:structuredClone(row), logical_id:'duplicate'});
    else if (defect === 'extra-field') row.body.fields.push({field:'unexpected', value:{kind:'nat', value:'0'}});
    else if (defect === 'missing-field') row.body.fields.pop();
    else if (defect === 'reordered-fields') row.body.fields.reverse();
    else if (defect === 'type-arguments') row.result.arguments.push({kind:'nat'});
    else row.body = {kind:'call', function:{name:defect === 'alias-cycle' ? 'publicationClosure' : 'missing'}, arguments:[]};
    assert.throws(() => projectCapturedSource(changed), undefined, defect);
  }
});
