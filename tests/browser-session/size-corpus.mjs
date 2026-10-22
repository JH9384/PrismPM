// Real writer parity, including structurally valid but semantically rejected
// views. The size fold may not conflate codec acceptance with UI validation.
import {corpus, boundaries, view, node, maximumCorpus, combinedMaximumCorpus} from '../browser-presentation/corpus.mjs';
import {encodeWire} from '../../sdk/browser/presentation-wire.mjs';
import {decodeEffectWire} from '../../sdk/browser/effects-wire.mjs';
import {encodeEffectWire} from '../../sdk/browser/effects-wire.mjs';
import {corpus as effectsCorpus, manifest} from '../browser-effects/corpus.mjs';

export function sizeCorpus() {
  const rows = [];
  for (const row of [...corpus(), ...boundaries()]) {
    let raw; try { raw = decodeEffectWire(row.request); } catch { continue; }
    if (!Array.isArray(raw) || raw.length !== 7) continue;
    const accepted = Buffer.from(row.request).equals(Buffer.from(row.response));
    if (!accepted && row.response[3] !== 9) continue;
    rows.push({id: 'Size' + row.id, request: row.request, response: Uint8Array.of(245)});
  }
  for (const length of [23, 24, 255, 256, 65535, 65536]) for (const unit of ['x', 'é', '𐀀']) {
    rows.push({id: 'SizeUtf8' + length + '-' + unit.codePointAt(0),
      request: encodeWire(view([node([4, unit.repeat(length)])])), response: Uint8Array.of(245)});
  }
  const seen = new Set();
  const effect = (id, tag, value) => {
    const request = encodeEffectWire([tag, value]), key = Buffer.from(request).toString('hex');
    if (seen.has(key)) return;
    seen.add(key); rows.push({id, request, response: Uint8Array.of(245)});
  };
  effect('SizeEffectManifest', 0, manifest);
  for (const row of effectsCorpus()) {
    if (row.area === 'wire') continue;
    const raw = decodeEffectWire(row.request);
    if (raw[1] === 0) effect('SizeManifest' + row.id, 0, raw[2]);
    if (raw[1] === 1) effect('SizeRequest' + row.id, 1, raw[3]);
    if (raw[1] === 2) {
      effect('EqualityIdentical' + row.id, 4, [raw[3], raw[3]]);
      const other=structuredClone(raw[3]);other[0][3]++;
      effect('EqualityDifferentRequest' + row.id, 4, [raw[3], other]);
      const result=structuredClone(raw[3]);result[1]=[9];
      effect('EqualityDifferentResult' + row.id, 4, [raw[3], result]);
    }
  }
  for (const length of [0, 23, 24, 255, 256, 65535, 65536]) {
    const bytes = new Uint8Array(length).fill(17);
    effect('SizeDigestPayload' + length, 1, [manifest[0], manifest[1], manifest[0], 0, 'digest', [2, bytes]]);
    effect('SizeCommitPayload' + length, 1, [manifest[0], manifest[1], manifest[0], 0, 'store',
      [7, ['head', [1, 'sha256:' + 'a'.repeat(64)], 'sha256:' + 'b'.repeat(64), [bytes]]]]);
  }
  for (const count of [0, 1, 16, 23, 24, 63, 64]) {
    const value = structuredClone(manifest);
    value[3] = Array.from({length: count}, (_, index) => ['g' + index, [1]]);
    effect('SizeManifestGrantCount' + count, 0, value);
  }
  for (const count of [0, 1, 15, 16]) effect('SizeCommitObjectCount' + count, 1,
    [manifest[0], manifest[1], manifest[0], 0, 'store', [7, ['head', [0], 'sha256:' + 'b'.repeat(64),
      Array.from({length: count}, (_, index) => new Uint8Array(index + 23).fill(index))]]]);
  for (let index = 0; index < 13; index++) rows.push({id: 'SizeTypedWriterFailure' + index,
    request: encodeEffectWire([2, index]), response: Uint8Array.of(245)});
  for(const length of [1048576,1048577,2097152,2097153]) rows.push({id:'SizeDirectByteWriterBoundary'+length,
    request:encodeEffectWire([3,new Uint8Array(length).fill(31)]),response:Uint8Array.of(245)});
  return rows;
}

export function* sizeMaxima() {
  for (const row of maximumCorpus()) yield {id: 'Size' + row.id, request: row.request,
    response: row.id === 'FrameOver' ? Uint8Array.of(0x83, 1, 2, 6) : Uint8Array.of(245),
    nativeOnly: row.id === 'FrameOver'};
  for (const row of combinedMaximumCorpus()) yield {id: 'Size' + row.id, request: row.request, response: Uint8Array.of(245)};
  for (const tag of [1,5]) for (const count of [0, 1, 15, 16]) yield {id: (tag===1?'SizeMaximumCommit':'EqualityMaximumCommit') + count,
    request: encodeEffectWire([tag, [manifest[0], manifest[1], manifest[0], 0xffffffff, 'store',
      [7, ['head', [1, 'sha256:' + 'a'.repeat(64)], 'sha256:' + 'b'.repeat(64),
        Array.from({length: count}, (_, index) => new Uint8Array(1048576).fill(index + 1))]]]]),
    response: Uint8Array.of(245)};
}
