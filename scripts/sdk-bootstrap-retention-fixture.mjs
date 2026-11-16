// Synthetic transport-only records. These are not accepted bootstrap proofs.
import {bootstrapNames, canonical, hash} from './sdk-bootstrap-retention.mjs';
import {canonical as bootstrapCanonical} from './bootstrap-evidence.mjs';
export function bootstrapFixture(revision, unicode = false) {
  const files = new Map([
    ['bootstrap-prior-capture.json', Buffer.from(bootstrapCanonical(unicode ? {'\u{10000}': 1, '\ue000': 2} : {fixture: 'prior capture'}))],
    ['bootstrap-current-capture.json', Buffer.from(canonical({fixture: 'current capture'}))],
    ['bootstrap-source-manifest.json', Buffer.from(canonical({files: [{path: 'unit-only-source'}]}))],
  ]);
  files.set('bootstrap-evidence.json', Buffer.from(canonical({schema: 'prismpm/bootstrap-evidence/2', status: 'passed',
    source_manifest: {digest: 'sha256:' + hash(files.get('bootstrap-source-manifest.json')), file_count: 1},
    compatibility_projection: Object.fromEntries(['prior', 'current'].map(kind => [kind,
      {capture_digest: 'sha256:' + hash(files.get(`bootstrap-${kind}-capture.json`))}]))})));
  const retained = new Map([...files].map(([name, bytes]) => [`run-1-${name}`, bytes]));
  const manifest = Buffer.from(canonical({schema: 'prismpm/bootstrap-retention/1', source_revision: revision,
    runs: [1].map(run => ({run, files: bootstrapNames.map(name => {
      const path = `run-${run}-${name}`, bytes = retained.get(path);
      return {path, byte_length: bytes.length, sha256: hash(bytes)};
    })}))}));
  return {files, retained, manifest};
}
