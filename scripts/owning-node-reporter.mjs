// Acceptance infrastructure, not an application runtime. Node's automatic
// empty-file wrapper is not a registered test and has no per-file summary.
import {tap} from 'node:test/reporters';

const phases = ['archive-extraction','artifact-cleanup','exporter-construction','generated-module-build',
  'kernel-export','lake-update','lexlean-verification','native-code-generation','rust-compilation',
  'toolchain-check','unclassified-execution','wasm-code-generation'];
// Child stderr can arrive in arbitrary chunks. Retain at most 256 characters
// per selected file; discard oversized lines without echoing any source text.
export function phaseCollector() {
  const streams = new Map(), totals = new Map();
  function line(text) {
    const prefix = '# prismpm-compiler-phase ';
    if (!text.startsWith(prefix)) return;
    try {
      const value = JSON.parse(text.slice(prefix.length));
      if (Object.keys(value).sort().join(',') !== 'elapsed_ms,phase,success'
        || !phases.includes(value.phase) || typeof value.success !== 'boolean'
        || !Number.isSafeInteger(value.elapsed_ms) || value.elapsed_ms < 0 || value.elapsed_ms > 600000) return;
      const row = totals.get(value.phase) ?? {phase:value.phase,calls:0,failures:0,elapsed_ms:0};
      if (row.calls >= 1000000) return;
      row.calls++; row.failures += Number(!value.success); row.elapsed_ms += value.elapsed_ms;
      totals.set(value.phase,row);
    } catch { /* Malformed diagnostics never replace the owning test outcome. */ }
  }
  return {
    accept(file,message) {
      if (typeof file !== 'string' || file.length > 4096 || typeof message !== 'string') return;
      if (!streams.has(file)) {
        if (streams.size >= 64) return;
        streams.set(file,{text:'',oversized:false});
      }
      const stream = streams.get(file);
      for (const character of message) {
        if (character === '\n') { if (!stream.oversized) line(stream.text); stream.text=''; stream.oversized=false; }
        else if (!stream.oversized) {
          if (stream.text.length + character.length > 256) {stream.text='';stream.oversized=true;}
          else stream.text += character;
        }
      }
    },
    bufferedCodeUnits() { return [...streams.values()].reduce((total,stream)=>total+stream.text.length,0); },
    summary() { return {scope:'compiler-phase-diagnostic-not-acceptance',
      phases:[...totals.values()].sort((a,b)=>a.phase.localeCompare(b.phase))}; },
  };
}

export default async function* owningTap(source) {
  const files = [], diagnostics = phaseCollector();
  async function* tracked() {
    for await (const event of source) {
      if (event.type === 'test:stderr') diagnostics.accept(event.data.file,event.data.message);
      if (event.type === 'test:summary' && event.data.file !== undefined) {
        if (files.length >= 64) throw Error('owning test file limit');
        const {file, success, counts} = event.data;
        files.push({file, success, tests: counts.tests, passed: counts.passed,
          failed: counts.failed, cancelled: counts.cancelled, skipped: counts.skipped,
          todo: counts.todo, topLevel: counts.topLevel, suites: counts.suites});
      }
      yield event;
    }
  }
  yield* tap(tracked());
  for (const file of files) {
    yield '# prismpm-owning-file ' + JSON.stringify(file) + '\n';
  }
  const summary = diagnostics.summary();
  if (summary.phases.length) yield '# prismpm-compiler-phase-summary ' + JSON.stringify(summary) + '\n';
}
