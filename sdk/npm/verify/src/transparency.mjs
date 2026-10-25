/**
 * Transparency log entries and signed timestamps (issue #275), checked offline.
 *
 * A Sigstore bundle carries two kinds of third-party evidence besides the
 * signature: a Rekor v2 entry with a Merkle inclusion proof and a signed
 * checkpoint, and RFC 3161 timestamps. This module recomputes both from the
 * bundle and a pinned trusted root. It never fetches: the trusted root is an
 * argument, and WebCrypto (`crypto.subtle`) is the only platform service used.
 *
 * What is checked:
 *   timestamp.*     each RFC 3161 timestamp is signed by a pinned timestamp authority, was
 *                   issued inside that authority's validity, and covers the bundle's signature
 *   certificate.chain  the signing certificate chains to a pinned certificate authority and was
 *                   valid at the signed time
 *   tlog.*          each Rekor v2 entry names a pinned log, records this bundle's signature,
 *                   has an inclusion proof that recomputes to the checkpoint's root, and the
 *                   checkpoint is signed by the pinned log key
 *
 * What is not: whether the signing identity is acceptable (issue #272), the
 * DSSE signature itself, certificate extensions beyond the timestamp-signing
 * key usage, revocation, and checkpoint witnesses. Rekor v1 entries (a
 * signed entry timestamp, no checkpoint) are reported as `tlog.kind`.
 */
import * as der from './asn1.mjs';
import { sha256Hex } from './sha256.mjs';

/** Thrown for a trusted root that is not a usable pinned root. */
export class TrustedRootError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrustedRootError';
  }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = (() => {
  const table = {};
  for (let i = 0; i < 64; i++) table[BASE64[i]] = i;
  table['-'] = 62;
  table._ = 63;
  return table;
})();

/** Standard or URL-safe base64, padded or not. Throws on any other character. */
export function fromBase64(text) {
  if (typeof text !== 'string') throw new Error('base64 text expected');
  const clean = text.replace(/\s+/g, '').replace(/={0,2}$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const ch of clean) {
    const digit = BASE64_VALUE[ch];
    if (digit === undefined) throw new Error('not base64');
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

function utf8(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(bytes);
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

async function digest(subtle, name, bytes) {
  if (name === 'SHA-256') return fromHex(sha256Hex(bytes));
  if (!subtle) throw new Unavailable();
  return new Uint8Array(await subtle.digest(name, bytes));
}

class Unavailable extends Error {}

/** True when the signature verifies. A scheme WebCrypto cannot import counts as not verifying. */
async function verifySignature(subtle, spki, sch, fallbackHash, data, signature) {
  if (!subtle) throw new Unavailable();
  try {
    const key = der.keyOf(spki);
    if (sch.kind === 'ed25519') {
      const imported = await subtle.importKey('spki', spki, { name: 'Ed25519' }, false, ['verify']);
      return await subtle.verify({ name: 'Ed25519' }, imported, signature, data);
    }
    const hash = sch.hash ?? fallbackHash;
    if (sch.kind === 'ecdsa') {
      const named = { [der.OID.P256]: ['P-256', 32], [der.OID.P384]: ['P-384', 48] }[key.curve];
      if (!named) return false;
      const imported = await subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: named[0] }, false, ['verify']);
      return await subtle.verify({ name: 'ECDSA', hash: hash ?? (named[1] === 32 ? 'SHA-256' : 'SHA-384') }, imported, der.ecdsaToRaw(signature, named[1]), data);
    }
    if (sch.kind === 'rsa' && hash) {
      const imported = await subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
      return await subtle.verify('RSASSA-PKCS1-v1_5', imported, signature, data);
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- trusted root

const inRange = (ms, validFor) => validFor.start <= ms && (validFor.end === null || ms <= validFor.end);

function readValidFor(value, where) {
  const start = Date.parse(value?.start);
  if (Number.isNaN(start)) throw new TrustedRootError(`${where} has no validFor.start`);
  let end = null;
  if (value.end !== undefined) {
    end = Date.parse(value.end);
    if (Number.isNaN(end)) throw new TrustedRootError(`${where} has a validFor.end that is not a time`);
  }
  return { start, end };
}

function readChain(value, where) {
  const list = value?.certChain?.certificates;
  if (!Array.isArray(list) || list.length === 0) throw new TrustedRootError(`${where} has no certificates`);
  try {
    return list.map((c) => der.parseCertificate(fromBase64(c.rawBytes)));
  } catch (error) {
    throw new TrustedRootError(`${where} has a certificate that does not parse: ${error.message}`);
  }
}

/**
 * Check and normalise a pinned trusted root, the `trusted_root.json` of Sigstore
 * (schema `schemas/attestation/trusted-root.schema.json` in @prism-code/spec).
 */
export function readTrustedRoot(root) {
  if (root === null || typeof root !== 'object') throw new TrustedRootError('the trusted root must be an object');
  if (typeof root.mediaType !== 'string' || !root.mediaType.startsWith('application/vnd.dev.sigstore.trustedroot+json')) {
    throw new TrustedRootError('mediaType is not application/vnd.dev.sigstore.trustedroot+json');
  }
  const list = (name) => {
    if (root[name] !== undefined && !Array.isArray(root[name])) throw new TrustedRootError(`${name} must be an array`);
    return root[name] ?? [];
  };
  const tlogs = list('tlogs').map((log, i) => {
    const where = `tlogs[${i}]`;
    try {
      return {
        keyId: toHex(fromBase64(log.logId.keyId)),
        spki: fromBase64(log.publicKey.rawBytes),
        baseUrl: typeof log.baseUrl === 'string' ? log.baseUrl : null,
        validFor: readValidFor(log.publicKey.validFor, where),
      };
    } catch (error) {
      if (error instanceof TrustedRootError) throw error;
      throw new TrustedRootError(`${where} is malformed: ${error.message}`);
    }
  });
  const authority = (name) =>
    list(name).map((a, i) => ({ certs: readChain(a, `${name}[${i}]`), validFor: readValidFor(a.validFor, `${name}[${i}]`) }));
  return { tlogs, certificateAuthorities: authority('certificateAuthorities'), timestampAuthorities: authority('timestampAuthorities') };
}

// ----------------------------------------------------------------- certificates

async function certificateSignatureHolds(subtle, cert, issuer) {
  const sch = der.scheme(cert.signatureAlgorithm.oid);
  return sch !== null && (await verifySignature(subtle, issuer.spki, sch, null, cert.tbs, cert.signature));
}

/** Null when `cert` chains to a self-signed root in `pool` and every certificate was valid at `at`; else the reason. */
async function chainProblem(subtle, cert, pool, at, depth = 0) {
  if (at < cert.notBefore || at > cert.notAfter) return 'a certificate in the chain was not valid at the signed time';
  if (depth > 6) return 'the chain is longer than six certificates';
  if (der.equalBytes(cert.issuer, cert.subject)) {
    if (!pool.some((c) => der.equalBytes(c.der, cert.der))) return 'the chain ends in a root that is not pinned';
    return (await certificateSignatureHolds(subtle, cert, cert)) ? null : 'a root certificate is not validly self-signed';
  }
  let reason = 'no pinned certificate issued it';
  for (const issuer of pool) {
    if (!der.equalBytes(issuer.subject, cert.issuer)) continue;
    if (!(await certificateSignatureHolds(subtle, cert, issuer))) {
      reason = 'a certificate signature does not verify under the pinned issuer';
      continue;
    }
    const above = await chainProblem(subtle, issuer, pool, at, depth + 1);
    if (above === null) return null;
    reason = above;
  }
  return reason;
}

// ------------------------------------------------------------------ timestamps

const find = (nodes, tag) => nodes.find((n) => n.tag === tag);

/**
 * Check one RFC 3161 timestamp over `signature`. Returns the signed time in
 * milliseconds, or a reason in `problem`.
 */
async function checkTimestamp(subtle, encoded, signature, trusted) {
  let info;
  let signer;
  try {
    let token = der.expect(der.parse(fromBase64(encoded)), 0x30, 'timestamp');
    // Sigstore stores the whole RFC 3161 TimeStampResp: a status, then the token. A bare token is accepted too.
    const [first, second] = der.children(token);
    if (first.tag === 0x30 && second) {
      const status = der.children(first)[0];
      if (status?.tag !== 0x02 || status.body.length !== 1 || status.body[0] > 1) return { problem: 'the timestamp response was not granted' };
      token = der.expect(second, 0x30, 'TimeStampToken');
    }
    const contentInfo = der.children(token);
    if (der.oid(contentInfo[0]) !== der.OID.SIGNED_DATA) return { problem: 'the timestamp is not CMS SignedData' };
    const signedData = der.children(der.expect(der.children(der.expect(contentInfo[1], 0xa0, 'content'))[0], 0x30, 'SignedData'));
    const encapsulated = der.children(signedData[2]);
    if (der.oid(encapsulated[0]) !== der.OID.TST_INFO) return { problem: 'the timestamp does not carry a TSTInfo' };
    const content = der.expect(der.children(der.expect(encapsulated[1], 0xa0, 'eContent'))[0], 0x04, 'eContent').body;
    const embedded = find(signedData, 0xa0) ? der.children(find(signedData, 0xa0)).map((c) => der.parseCertificate(c.tlv)) : [];
    const signerInfos = der.children(der.expect(signedData[signedData.length - 1], 0x31, 'signerInfos'));
    if (signerInfos.length !== 1) return { problem: 'the timestamp must have exactly one signer' };

    const fields = der.children(signerInfos[0]);
    const sid = fields[1];
    const digestAlgorithm = der.hashName(der.algorithm(fields[2]).oid);
    const attributes = find(fields, 0xa0);
    if (!digestAlgorithm || !attributes) return { problem: 'the signer has no signed attributes or an unknown digest' };
    const after = fields.indexOf(attributes);
    const signatureAlgorithm = der.scheme(der.algorithm(fields[after + 1]).oid);
    const signatureBytes = der.expect(fields[after + 2], 0x04, 'signature').body;
    if (!signatureAlgorithm) return { problem: 'the signature algorithm is not supported' };

    const attribute = (id) => {
      const found = der.children(attributes).find((a) => der.oid(der.children(a)[0]) === id);
      return found ? der.children(der.children(found)[1])[0] : null;
    };
    const claimed = attribute(der.OID.MESSAGE_DIGEST);
    if (!claimed || !der.equalBytes(claimed.body, await digest(subtle, digestAlgorithm, content))) {
      return { problem: 'the signed message digest does not match the TSTInfo' };
    }
    const contentType = attribute(der.OID.CONTENT_TYPE);
    if (!contentType || der.oid(contentType) !== der.OID.TST_INFO) return { problem: 'the signed content type is not TSTInfo' };

    const tst = der.children(der.expect(der.parse(content), 0x30, 'TSTInfo'));
    const imprint = der.children(tst[2]);
    info = { genTime: der.time(tst[4]), hash: der.hashName(der.algorithm(imprint[0]).oid), hashed: imprint[1].body };

    const matches = (cert) => {
      if (sid.tag === 0x30) {
        const [issuer, serial] = der.children(sid);
        return der.equalBytes(cert.issuer, issuer.tlv) && cert.serial === der.integerHex(serial);
      }
      const ski = cert.extensions.get(der.OID.SUBJECT_KEY_IDENTIFIER);
      return sid.tag === 0x80 && ski !== undefined && der.equalBytes(der.parse(ski.value).body, sid.body);
    };
    const pool = trusted.flatMap((t) => t.certs);
    signer = [...embedded, ...pool].find(matches);
    if (!signer) return { problem: 'the signing certificate is neither embedded nor pinned' };

    const eku = signer.extensions.get(der.OID.EXTENDED_KEY_USAGE);
    const purposes = eku ? der.children(der.parse(eku.value)).map(der.oid) : [];
    if (!purposes.includes(der.OID.TIME_STAMPING)) return { problem: 'the signing certificate is not for time stamping' };

    const covered = attributes.tlv.slice();
    covered[0] = 0x31;
    if (!(await verifySignature(subtle, signer.spki, signatureAlgorithm, digestAlgorithm, covered, signatureBytes))) {
      return { problem: 'the timestamp signature does not verify' };
    }
  } catch (error) {
    if (error instanceof Unavailable) throw error;
    return { problem: `the timestamp does not parse: ${error.message}` };
  }

  const authorities = trusted.filter((t) => inRange(info.genTime, t.validFor));
  if (authorities.length === 0) return { problem: 'no pinned timestamp authority was valid at the signed time' };
  let reason = 'no pinned timestamp authority vouches for the signer';
  let vouched = false;
  for (const authority of authorities) {
    const problem = await chainProblem(subtle, signer, authority.certs, info.genTime);
    if (problem === null) {
      vouched = true;
      break;
    }
    reason = problem;
  }
  if (!vouched) return { problem: reason };

  if (!info.hash) return { problem: 'the timestamp imprint uses an unknown hash' };
  if (!der.equalBytes(info.hashed, await digest(subtle, info.hash, signature))) {
    return { problem: 'the timestamp does not cover this bundle\'s signature' };
  }
  return { time: info.genTime };
}

// ------------------------------------------------------------------ Merkle tree

const node = (left, right) => fromHex(sha256Hex(concat(Uint8Array.of(1), left, right)));

/** RFC 9162 section 2.1.3.2: does `path` take the entry at `index` to `root` in a tree of `size` leaves? */
export function inclusionHolds(entry, index, size, path, root) {
  let fn = BigInt(index);
  let sn = BigInt(size) - 1n;
  if (fn > sn) return false;
  let hash = fromHex(sha256Hex(concat(Uint8Array.of(0), entry)));
  for (const sibling of path) {
    if (sn === 0n) return false;
    if ((fn & 1n) === 1n || fn === sn) {
      hash = node(sibling, hash);
      while ((fn & 1n) === 0n && fn !== 0n) {
        fn >>= 1n;
        sn >>= 1n;
      }
    } else {
      hash = node(hash, sibling);
    }
    fn >>= 1n;
    sn >>= 1n;
  }
  return sn === 0n && der.equalBytes(hash, root);
}

/** A signed note in the c2sp.org/tlog-checkpoint form. Null when it is not one. */
function readCheckpoint(text) {
  const split = text.indexOf('\n\n');
  if (split < 0) return null;
  const lines = text.slice(0, split + 1).split('\n');
  lines.pop();
  if (lines.length < 3 || lines[0] === '' || !/^(0|[1-9][0-9]*)$/.test(lines[1])) return null;
  let root;
  try {
    root = fromBase64(lines[2]);
  } catch {
    return null;
  }
  if (root.length !== 32) return null;
  const signatures = [];
  for (const line of text.slice(split + 2).split('\n')) {
    if (line === '') continue;
    const match = /^— (\S+) (\S+)$/.exec(line);
    if (!match) return null;
    try {
      const raw = fromBase64(match[2]);
      if (raw.length > 4) signatures.push({ name: match[1], signature: raw.subarray(4) });
    } catch {
      return null;
    }
  }
  return { origin: lines[0], size: lines[1], root, signed: utf8(text.slice(0, split + 1)), signatures };
}

// ---------------------------------------------------------------------- bundle

/** The DSSE pre-authentication encoding the signature covers. */
function pae(payloadType, payload) {
  return concat(utf8(`DSSEv1 ${utf8(payloadType).length} ${payloadType} ${payload.length} `), payload);
}

/**
 * The signature and what the log must have recorded about it, from a DSSE
 * bundle (what Prism writes) or a message-signature bundle (what cosign
 * writes for blobs).
 */
function signedFacts(bundle) {
  if (bundle.dsseEnvelope) {
    const { payload, payloadType, signatures } = bundle.dsseEnvelope;
    const sigs = signatures.map((s) => fromBase64(s.sig));
    return { signatures: sigs, digest: fromHex(sha256Hex(pae(payloadType, fromBase64(payload)))) };
  }
  const message = bundle.messageSignature;
  return { signatures: [fromBase64(message.signature)], digest: fromBase64(message.messageDigest.digest) };
}

/** Null when the logged body records exactly this bundle's signature, digest and certificate. */
function bodyProblem(entry, facts, certificate) {
  let body;
  try {
    body = JSON.parse(String.fromCharCode(...fromBase64(entry.canonicalizedBody)));
  } catch {
    return 'the logged body is not JSON';
  }
  const record = body?.spec?.hashedRekordV002;
  if (body.kind !== entry.kindVersion.kind || body.apiVersion !== entry.kindVersion.version || !record) return 'the logged body is not the entry kind it declares';
  if (record.data?.algorithm !== 'SHA2_256' || !der.equalBytes(fromBase64(record.data.digest), facts.digest)) {
    return 'the logged digest is not the digest of what this bundle signed';
  }
  const logged = fromBase64(record.signature?.content ?? '');
  if (!facts.signatures.some((s) => der.equalBytes(s, logged))) return 'the logged signature is not this bundle\'s signature';
  const verifier = record.signature?.verifier?.x509Certificate?.rawBytes;
  if (certificate && (verifier === undefined || !der.equalBytes(fromBase64(verifier), certificate))) {
    return 'the logged certificate is not this bundle\'s certificate';
  }
  return null;
}

const COUNT = /^(0|[1-9][0-9]{0,18})$/;

/**
 * @typedef {{ crypto?: { subtle: SubtleCrypto }, entries?: number, timestamps?: number }} TransparencyOptions
 */

/**
 * Check the transparency log entries and timestamps of one Sigstore bundle
 * against a pinned trusted root. Every check runs; the result lists every
 * problem at once. `reasons` has the shape of a verdict's `reasons`. Each
 * names P1 as the level it withholds, because a keyless certificate lives
 * minutes and is only checkable at a signed time; whether a policy requires
 * this evidence is for the caller (docs/proposals/275-transparency-log.md).
 *
 * @param {object} bundle a Sigstore bundle v0.3
 * @param {object} trustedRoot a Sigstore `trusted_root.json`, pinned by the caller
 * @param {TransparencyOptions} [options] `entries` and `timestamps` are the least number that must verify, default 1 each
 */
export async function verifyTransparency(bundle, trustedRoot, options = {}) {
  const root = readTrustedRoot(trustedRoot);
  const subtle = (options.crypto ?? globalThis.crypto)?.subtle ?? null;
  const wanted = { entries: options.entries ?? 1, timestamps: options.timestamps ?? 1 };
  const checks = [];
  const record = (check, passed, message, code) => checks.push({ check, passed, message, ...(code ? { code } : {}) });

  try {
    const material = bundle.verificationMaterial ?? {};
    let facts;
    try {
      facts = signedFacts(bundle);
    } catch {
      record('bundle.shape', false, 'The bundle has neither a readable DSSE envelope nor a message signature.');
      return finish(checks, null);
    }
    let certificate = null;
    let leaf = null;
    if (material.certificate) {
      try {
        certificate = fromBase64(material.certificate.rawBytes);
        leaf = der.parseCertificate(certificate);
      } catch (error) {
        record('certificate.chain', false, `The signing certificate does not parse: ${error.message}.`);
      }
    }

    // Timestamps first: a Rekor v2 entry has no integrated time, so the signed time is the only clock.
    const times = [];
    const stamps = material.timestampVerificationData?.rfc3161Timestamps ?? [];
    for (const [index, stamp] of stamps.entries()) {
      const outcome = await checkTimestamp(subtle, stamp.signedTimestamp, facts.signatures[0], root.timestampAuthorities);
      let problem = outcome.problem ?? null;
      if (problem === null && leaf && (outcome.time < leaf.notBefore || outcome.time > leaf.notAfter)) {
        problem = 'the signed time is outside the signing certificate\'s validity';
      }
      if (problem === null) times.push(outcome.time);
      record(`timestamp.${index}`, problem === null, problem === null ? `Signed at ${new Date(outcome.time).toISOString()}.` : `Timestamp ${index}: ${problem}.`);
    }
    if (times.length < wanted.timestamps) {
      record('timestamp.count', false, `${times.length} of the required ${wanted.timestamps} timestamps verified.`);
    }
    const signedAt = times.length > 0 ? Math.min(...times) : null;

    if (leaf) {
      if (signedAt === null) {
        record('certificate.chain', false, 'The signing certificate cannot be placed in time without a verified timestamp.');
      } else {
        const authorities = root.certificateAuthorities.filter((a) => inRange(signedAt, a.validFor));
        let problem = 'no pinned certificate authority was valid at the signed time';
        for (const authority of authorities) {
          problem = await chainProblem(subtle, leaf, authority.certs, signedAt);
          if (problem === null) break;
        }
        record('certificate.chain', problem === null, problem === null ? 'The signing certificate chains to a pinned authority.' : `The signing certificate: ${problem}.`);
      }
    }

    // Log entries.
    const entries = material.tlogEntries ?? [];
    let verified = 0;
    for (const [index, entry] of entries.entries()) {
      const problems = await entryProblems(subtle, entry, facts, certificate, root, signedAt);
      for (const [check, message] of problems) record(check, false, `Entry ${index}: ${message}.`);
      if (problems.length === 0) {
        verified++;
        record(`tlog.${index}`, true, `Entry ${entry.logIndex} is included in the log.`);
      }
    }
    if (verified < wanted.entries) record('tlog.count', false, `${verified} of the required ${wanted.entries} log entries verified.`);

    return finish(checks, signedAt);
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    record('crypto.unavailable', false, 'WebCrypto is not available here; pass `options.crypto` or run where `crypto.subtle` exists.');
    return finish(checks, null);
  }
}

function finish(checks, signedAt) {
  const reasons = checks
    .filter((c) => !c.passed)
    .map((c) => ({ check: c.check.replace(/\.\d+$/, ''), withholds: 'P1', message: c.message, ...(c.code ? { code: c.code } : {}) }));
  return { passed: reasons.length === 0, time: signedAt === null ? null : new Date(signedAt).toISOString(), checks, reasons };
}

/** The problems of one log entry as [check, message] pairs; empty when it verifies. */
async function entryProblems(subtle, entry, facts, certificate, root, signedAt) {
  const out = [];
  if (entry?.kindVersion?.kind !== 'hashedrekord' || entry.kindVersion.version !== '0.0.2') {
    return [['tlog.kind', `the entry kind ${entry?.kindVersion?.kind}/${entry?.kindVersion?.version} is not hashedrekord/0.0.2, the Rekor v2 entry`]];
  }
  const keyId = (() => {
    try {
      return toHex(fromBase64(entry.logId.keyId));
    } catch {
      return null;
    }
  })();
  const log = root.tlogs.find((l) => l.keyId === keyId);
  if (!log) return [['tlog.log', 'the entry names a log that the trusted root does not pin']];

  const proof = entry.inclusionProof;
  if (!proof) return [['tlog.inclusion', 'the entry has no inclusion proof; a Rekor v2 entry is verified by its proof, never by a promise']];
  if (![entry.logIndex, proof.logIndex, proof.treeSize].every((v) => COUNT.test(v)) || proof.logIndex !== entry.logIndex) {
    out.push(['tlog.inclusion', 'the proof is for a different log index than the entry']);
  }

  const problem = bodyProblem(entry, facts, certificate);
  if (problem) out.push(['tlog.body', problem]);

  let included = false;
  try {
    const path = proof.hashes.map(fromBase64);
    included =
      path.length <= 64 &&
      path.every((h) => h.length === 32) &&
      BigInt(proof.treeSize) > BigInt(proof.logIndex) &&
      inclusionHolds(fromBase64(entry.canonicalizedBody), proof.logIndex, proof.treeSize, path, fromBase64(proof.rootHash));
  } catch {
    included = false;
  }
  if (!included) out.push(['tlog.inclusion', 'the inclusion proof does not recompute to the root hash']);

  const note = typeof proof.checkpoint?.envelope === 'string' ? readCheckpoint(proof.checkpoint.envelope) : null;
  if (!note) {
    out.push(['tlog.checkpoint', 'the checkpoint is missing or is not a signed note with an origin, a size and a root hash']);
    return out;
  }
  if (note.size !== proof.treeSize || !der.equalBytes(note.root, safeBase64(proof.rootHash))) {
    out.push(['tlog.checkpoint', 'the checkpoint size or root hash differs from the inclusion proof']);
  }
  if (log.baseUrl && !log.baseUrl.replace(/^https?:\/\//, '').startsWith(note.origin)) {
    out.push(['tlog.checkpoint', `the checkpoint origin ${note.origin} is not the pinned log ${log.baseUrl}`]);
  }
  if (signedAt !== null && !inRange(signedAt, log.validFor)) {
    out.push(['tlog.checkpoint', 'the pinned log key was not valid at the signed time']);
  }
  const key = der.keyOf(log.spki);
  const sch = key.type === der.OID.ED25519 ? { kind: 'ed25519', hash: null } : { kind: 'ecdsa', hash: key.curve === der.OID.P384 ? 'SHA-384' : 'SHA-256' };
  let signed = false;
  for (const candidate of note.signatures.filter((s) => s.name === note.origin)) {
    if (await verifySignature(subtle, log.spki, sch, null, note.signed, candidate.signature)) {
      signed = true;
      break;
    }
  }
  if (!signed) out.push(['tlog.checkpoint', 'no signature on the checkpoint from the log\'s pinned key verifies']);
  return out;
}

function safeBase64(text) {
  try {
    return fromBase64(text);
  } catch {
    return new Uint8Array(0);
  }
}
