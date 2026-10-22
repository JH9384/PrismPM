// Materialize explicit expectations against the generated public Rust API.
// This serializer never evaluates or reimplements the lifecycle reducer.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {corpusModule} from './corpus.mjs';

const signatures = Object.freeze({
  beginNativeLease: 'fn(&NativeLane, Vec<u8>, u64, u64) -> Result<Result<NativeLane, NativeLeaseError>, ComputeError>',
  cancelNativeLease: 'fn(&NativeLane, u64) -> Result<Result<NativeLane, NativeLeaseError>, ComputeError>',
  closeNativeLane: 'fn(&NativeLane, u64) -> Result<Result<NativeLane, NativeLeaseError>, ComputeError>',
  completeNativeLease: 'fn(&NativeLane, &NativeLeaseBinding, u64) -> Result<Result<NativeLane, NativeLeaseError>, ComputeError>',
  nativeBindingEqual: 'fn(&NativeLeaseBinding, &NativeLeaseBinding) -> bool',
  nativeLaneValid: 'fn(&NativeLane) -> Result<bool, ComputeError>',
  openNativeLane: 'fn(Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) -> Result<NativeLane, NativeLeaseError>',
  retainUnknownNativeCleanup: 'fn(&NativeLane, &NativeLeaseBinding, u64) -> Result<Result<NativeLane, NativeLeaseError>, ComputeError>',
  retireCancelledNativeLease: 'fn(&NativeLane, &NativeLeaseBinding, u64) -> Result<Result<NativeLane, NativeLeaseError>, ComputeError>',
});
const bytes = hex => `vec![${[...Buffer.from(hex, 'hex')].map(value => `${value}u8`).join(',')}]`;
const nat = value => `${value}u64`;
const refs = value => ['application', 'manifest', 'session', 'resource'].map(key => `${key}: ${bytes(value[key])}`);
const binding = value => `NativeLeaseBinding { ${[...refs(value), `operation: ${nat(value.operation)}`,
  `requestDigest: ${bytes(value.requestDigest)}`, `deadline: ${nat(value.deadline)}`].join(', ')} }`;
const lane = value => `NativeLane { ${[...refs(value), `nextOperation: ${nat(value.nextOperation)}`,
  `observed: ${nat(value.observed)}`, `closed: ${value.closed}`, `active: ${value.active === null ? 'None'
    : `Some(NativeLease { binding: ${binding(value.active.binding)}, cancelled: ${value.active.cancelled}, uncertain: ${value.active.uncertain} })`}`].join(', ')} }`;

export function rustCorpus(index) {
  corpusModule(index); // Validate every closed case before encoding any Rust.
  assert.equal(index.cases.length, 93, 'complete accepted native lease inventory');
  const tests = index.cases.map(row => {
    const values = row.args;
    let args;
    switch (row.method) {
      case 'openNativeLane': args = values.map(bytes); break;
      case 'beginNativeLease': args = [`&${lane(values[0])}`, bytes(values[1]), nat(values[2]), nat(values[3])]; break;
      case 'cancelNativeLease': case 'closeNativeLane': args = [`&${lane(values[0])}`, nat(values[1])]; break;
      case 'completeNativeLease': case 'retainUnknownNativeCleanup': case 'retireCancelledNativeLease':
        args = [`&${lane(values[0])}`, `&${binding(values[1])}`, nat(values[2])]; break;
      default: assert.fail('unregistered lifecycle method');
    }
    const expected = Object.hasOwn(row.expected, 'state') ? `Ok(${lane(row.expected.state)})`
      : `Err(NativeLeaseError::${row.expected.error})`;
    const call = `${row.method}(${args.join(', ')})` + (row.method === 'openNativeLane' ? ''
      : '.expect("unexpected outer generated arithmetic failure")');
    return `#[test]\nfn case_${row.name}() {\n    assert_eq!(${call}, ${expected});\n}\n`;
  });
  return '#![allow(non_snake_case)]\nuse native_subject::*;\n\n'
    + '#[test]\nfn all_nine_generated_signatures() {\n'
    + Object.entries(signatures).map(([name, signature]) => `    let _: ${signature} = ${name};\n`).join('')
    + '}\n\n' + tests.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'rust-corpus.mjs CAPTURED_CORPUS_JSON');
  process.stdout.write(rustCorpus(JSON.parse(readFileSync(process.argv[2], 'utf8'))));
}
