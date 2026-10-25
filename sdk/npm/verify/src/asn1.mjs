/**
 * The smallest DER reader that can check an RFC 3161 timestamp and the X.509
 * certificates behind it: definite lengths only, no high tag numbers. Anything
 * else is a DerError, so a malformed or BER-encoded input fails closed.
 * No dependencies and no Node globals; it runs in a browser and a worker.
 */

export class DerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DerError';
  }
}

/** Object identifiers this package recognises. */
export const OID = Object.freeze({
  ECDSA_SHA256: '1.2.840.10045.4.3.2',
  ECDSA_SHA384: '1.2.840.10045.4.3.3',
  ECDSA_SHA512: '1.2.840.10045.4.3.4',
  EC_PUBLIC_KEY: '1.2.840.10045.2.1',
  P256: '1.2.840.10045.3.1.7',
  P384: '1.3.132.0.34',
  ED25519: '1.3.101.112',
  RSA_ENCRYPTION: '1.2.840.113549.1.1.1',
  RSA_SHA256: '1.2.840.113549.1.1.11',
  RSA_SHA384: '1.2.840.113549.1.1.12',
  RSA_SHA512: '1.2.840.113549.1.1.13',
  SHA256: '2.16.840.1.101.3.4.2.1',
  SHA384: '2.16.840.1.101.3.4.2.2',
  SHA512: '2.16.840.1.101.3.4.2.3',
  SIGNED_DATA: '1.2.840.113549.1.7.2',
  TST_INFO: '1.2.840.113549.1.9.16.1.4',
  CONTENT_TYPE: '1.2.840.113549.1.9.3',
  MESSAGE_DIGEST: '1.2.840.113549.1.9.4',
  SUBJECT_KEY_IDENTIFIER: '2.5.29.14',
  EXTENDED_KEY_USAGE: '2.5.29.37',
  TIME_STAMPING: '1.3.6.1.5.5.7.3.8',
});

/**
 * One TLV. `tlv` is the whole encoding (what a signature covers), `body` its content.
 * @typedef {{ tag: number, constructed: boolean, tlv: Uint8Array, body: Uint8Array, end: number }} Node
 */

/**
 * Read the TLV that starts at `offset`.
 * @returns {Node}
 */
export function parse(bytes, offset = 0) {
  if (offset + 2 > bytes.length) throw new DerError('truncated element');
  const tag = bytes[offset];
  if ((tag & 0x1f) === 0x1f) throw new DerError('high tag numbers are not supported');
  let length = bytes[offset + 1];
  let at = offset + 2;
  if (length === 0x80) throw new DerError('indefinite length (BER) is not DER');
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count > 4) throw new DerError('length does not fit');
    if (at + count > bytes.length) throw new DerError('truncated length');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[at++];
  }
  const end = at + length;
  if (end > bytes.length) throw new DerError('element runs past its container');
  return { tag, constructed: (tag & 0x20) !== 0, tlv: bytes.subarray(offset, end), body: bytes.subarray(at, end), end };
}

/**
 * The child elements of a constructed node.
 * @returns {Node[]}
 */
export function children(node) {
  if (!node.constructed) throw new DerError(`tag 0x${node.tag.toString(16)} is not constructed`);
  const out = [];
  for (let at = 0; at < node.body.length; ) {
    const child = parse(node.body, at);
    out.push(child);
    at = child.end;
  }
  return out;
}

/** Require a tag and return the node. */
export function expect(node, tag, what) {
  if (!node || node.tag !== tag) throw new DerError(`${what} is not tag 0x${tag.toString(16)}`);
  return node;
}

export function oid(node) {
  expect(node, 0x06, 'object identifier');
  const body = node.body;
  if (body.length === 0) throw new DerError('empty object identifier');
  const parts = [Math.floor(body[0] / 40), body[0] % 40];
  let value = 0;
  for (let i = 1; i < body.length; i++) {
    value = value * 128 + (body[i] & 0x7f);
    if (!(body[i] & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

/** The content octets of an INTEGER as lowercase hex, leading zeros kept, so two serials compare by string. */
export function integerHex(node) {
  expect(node, 0x02, 'integer');
  return Array.from(node.body, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The bits of a BIT STRING that has no unused bits. */
export function bitString(node) {
  expect(node, 0x03, 'bit string');
  if (node.body.length < 1 || node.body[0] !== 0) throw new DerError('bit string with unused bits');
  return node.body.subarray(1);
}

/** UTCTime or GeneralizedTime as milliseconds since the epoch. */
export function time(node) {
  const text = String.fromCharCode(...node.body);
  if (node.tag === 0x17) {
    const match = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(text);
    if (!match) throw new DerError('malformed UTCTime');
    const year = Number(match[1]) >= 50 ? 1900 + Number(match[1]) : 2000 + Number(match[1]);
    return Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  }
  if (node.tag === 0x18) {
    const match = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(?:\.(\d{1,9}))?Z$/.exec(text);
    if (!match) throw new DerError('malformed GeneralizedTime');
    const millis = match[7] ? Math.floor(Number(`0.${match[7]}`) * 1000) : 0;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])) + millis;
  }
  throw new DerError('not a time');
}

/** An AlgorithmIdentifier: its object identifier and its parameters, when present. */
export function algorithm(node) {
  const [id, params] = children(expect(node, 0x30, 'algorithm identifier'));
  return { oid: oid(id), params: params ?? null };
}

/** The signature scheme an algorithm identifier names. `hash` is null where the scheme leaves it to another field. */
export function scheme(id) {
  switch (id) {
    case OID.ECDSA_SHA256: return { kind: 'ecdsa', hash: 'SHA-256' };
    case OID.ECDSA_SHA384: return { kind: 'ecdsa', hash: 'SHA-384' };
    case OID.ECDSA_SHA512: return { kind: 'ecdsa', hash: 'SHA-512' };
    case OID.EC_PUBLIC_KEY: return { kind: 'ecdsa', hash: null };
    case OID.ED25519: return { kind: 'ed25519', hash: null };
    case OID.RSA_SHA256: return { kind: 'rsa', hash: 'SHA-256' };
    case OID.RSA_SHA384: return { kind: 'rsa', hash: 'SHA-384' };
    case OID.RSA_SHA512: return { kind: 'rsa', hash: 'SHA-512' };
    case OID.RSA_ENCRYPTION: return { kind: 'rsa', hash: null };
    default: return null;
  }
}

/** The WebCrypto name of a hash algorithm identifier. */
export function hashName(id) {
  return { [OID.SHA256]: 'SHA-256', [OID.SHA384]: 'SHA-384', [OID.SHA512]: 'SHA-512' }[id] ?? null;
}

export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * An X.509 certificate reduced to what chain and timestamp checks read.
 * Names are kept as their DER encoding, so equality is a byte comparison.
 */
export function parseCertificate(der) {
  const outer = expect(parse(der), 0x30, 'certificate');
  const [tbs, signatureAlgorithm, signatureValue] = children(outer);
  const fields = children(expect(tbs, 0x30, 'tbsCertificate'));
  let at = 0;
  if (fields[at].tag === 0xa0) at++;
  const serial = integerHex(fields[at++]);
  at++; // the signature algorithm, repeated inside tbsCertificate
  const issuer = fields[at++];
  const [notBefore, notAfter] = children(fields[at++]);
  const subject = fields[at++];
  const spki = fields[at++];
  const extensions = new Map();
  for (const field of fields.slice(at)) {
    if (field.tag !== 0xa3) continue;
    for (const extension of children(children(field)[0])) {
      const [id, ...rest] = children(extension);
      extensions.set(oid(id), { critical: rest.length === 2 && rest[0].body[0] === 0xff, value: rest[rest.length - 1].body });
    }
  }
  return {
    der: outer.tlv,
    tbs: tbs.tlv,
    serial,
    issuer: issuer.tlv,
    subject: subject.tlv,
    notBefore: time(notBefore),
    notAfter: time(notAfter),
    spki: spki.tlv,
    signatureAlgorithm: algorithm(signatureAlgorithm),
    signature: bitString(signatureValue),
    extensions,
  };
}

/** The SubjectPublicKeyInfo's key type and, for an elliptic-curve key, its curve. */
export function keyOf(spki) {
  const [id, bits] = children(expect(parse(spki), 0x30, 'SubjectPublicKeyInfo'));
  const { oid: type, params } = algorithm(id);
  return { type, curve: params && params.tag === 0x06 ? oid(params) : null, bits: bitString(bits) };
}

/** The ECDSA signature `SEQUENCE { r, s }` as the fixed-width `r || s` that WebCrypto verifies. */
export function ecdsaToRaw(der, size) {
  const [r, s] = children(expect(parse(der), 0x30, 'ECDSA signature'));
  const out = new Uint8Array(size * 2);
  [r, s].forEach((integer, index) => {
    expect(integer, 0x02, 'ECDSA integer');
    let body = integer.body;
    while (body.length > size && body[0] === 0) body = body.subarray(1);
    if (body.length > size) throw new DerError('ECDSA integer is too wide for the curve');
    out.set(body, index * size + (size - body.length));
  });
  return out;
}
