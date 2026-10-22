// SDK-owned bounded acquisition. Transport supplies raw digest-selected bytes;
// image inspection records are never manufactured from parsed JSON.
import assert from 'node:assert/strict';
import {parseSdkIndex, validateInventory} from './platform-lock.mjs';
import {decodeMetadataLayer, limits, parseConfig, parseManifest, sha} from './metadata-layer.mjs';

export async function captureMetadataLock(reference, standardsDigest, transport, observeRequest) {
  assert.equal(typeof transport, 'function', 'bounded SDK transport required');
  assert(observeRequest === undefined || typeof observeRequest === 'function');
  assert.match(standardsDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(reference, /^[a-z0-9.-]+(?::[0-9]{1,5})?\/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/);
  const [repository] = reference.split('@');
  const [authority, ...segments] = repository.split('/');
  assert(segments.length > 0 && segments.every(part => part && part !== '.' && part !== '..'), 'noncanonical SDK repository path');
  const port = authority.split(':')[1];
  assert(port === undefined || (Number(port) >= 1 && Number(port) <= 65535), 'invalid SDK registry port');
  const origin = performance.now(), deadline = origin + 180000;
  let received = 0;
  const fetch = async (kind, ref, maximum) => {
    const requested = performance.now(), remaining = Math.floor(deadline - requested);
    assert(remaining > 0, 'SDK metadata capture deadline exceeded');
    // The production transport must enforce this deadline during acquisition,
    // not merely check elapsed time after an unbounded request completes.
    // Private evidence observes the exact acquisition clock; it cannot change
    // the request, its bounds, or its result. Ordinary callers remain unchanged.
    observeRequest?.(origin, requested);
    const bytes = await transport({kind, reference:ref, maximum, timeout_ms:Math.min(45000, remaining)});
    assert(performance.now() <= deadline, 'SDK metadata capture deadline exceeded');
    assert(Buffer.isBuffer(bytes) && bytes.length <= maximum, 'SDK transport exceeded its byte bound');
    received += bytes.length;
    assert(received <= 5 * limits.document + 2 * limits.compressed, 'SDK aggregate acquisition byte bound exceeded');
    return bytes;
  };
  const indexBytes = await fetch('manifest', reference, limits.document);
  // All materialized, captured and retained locks use the same strict parser.
  // Platform metadata is checked again against each actual config.
  const children = parseSdkIndex(indexBytes, reference);
  const platforms = [];
  let identities, standards;
  for (const child of children) {
    const manifest = parseManifest(await fetch('manifest', child.reference, limits.document), child.descriptor);
    const config = parseConfig(await fetch('blob', repository + '@' + manifest.config.digest, manifest.config.size),
      manifest, child.descriptor.platform);
    const layer = manifest.layers.at(-1);
    const files = decodeMetadataLayer(await fetch('blob', repository + '@' + layer.digest, layer.size), manifest, config);
    assert.equal(sha(files.standards), standardsDigest, 'SDK standards digest differs from requested lock');
    if (standards) assert.deepEqual(files.standards, standards, 'SDK platform standards bytes differ');
    standards = files.standards;
    new TextDecoder('utf-8', {fatal:true}).decode(files.inventory);
    const inventory = validateInventory(files.inventory);
    const selected = inventory.artifacts.map(row => [row.id, row.kind, row.version]);
    if (identities) assert.deepEqual(selected, identities, 'SDK platform artifact identities differ');
    identities = selected;
    platforms.push({platform:'linux/' + child.architecture, manifest_digest:child.descriptor.digest,
      inventory_digest:sha(files.inventory), inventory_document:files.inventory.toString('utf8'), inventory:inventory.artifacts});
  }
  return {schema:'prismpm/sdk-lock/2', sdk_image:reference, sdk_index:indexBytes.toString('utf8'), sdk_version:'0.3.0',
    standards_lock:standardsDigest, platforms};
}
