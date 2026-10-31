//! Signatures over SubjectPublicKeyInfo keys: ECDSA on P-256 and P-384 with
//! SHA-2, and Ed25519, which is every scheme the Sigstore public instance,
//! its staging instance and a local `--key` use. RSA keys are recognised and
//! never verify, so a bundle signed by one is refused rather than guessed at.
//! Signing with a local key is the only private-key operation.

use super::der::{self, oid};
use sha2::{Digest, Sha256, Sha384, Sha512};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Hash {
    Sha256,
    Sha384,
    Sha512,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Ecdsa,
    Ed25519,
    Rsa,
}

/// The signature scheme an algorithm identifier names. `hash` is `None` where
/// the scheme leaves it to another field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Scheme {
    pub(crate) kind: Kind,
    pub(crate) hash: Option<Hash>,
}

pub(crate) fn scheme(id: &str) -> Option<Scheme> {
    let scheme = |kind, hash| Some(Scheme { kind, hash });
    match id {
        oid::ECDSA_SHA256 => scheme(Kind::Ecdsa, Some(Hash::Sha256)),
        oid::ECDSA_SHA384 => scheme(Kind::Ecdsa, Some(Hash::Sha384)),
        oid::ECDSA_SHA512 => scheme(Kind::Ecdsa, Some(Hash::Sha512)),
        oid::EC_PUBLIC_KEY => scheme(Kind::Ecdsa, None),
        oid::ED25519 => scheme(Kind::Ed25519, None),
        oid::RSA_SHA256 => scheme(Kind::Rsa, Some(Hash::Sha256)),
        oid::RSA_SHA384 => scheme(Kind::Rsa, Some(Hash::Sha384)),
        oid::RSA_SHA512 => scheme(Kind::Rsa, Some(Hash::Sha512)),
        oid::RSA_ENCRYPTION => scheme(Kind::Rsa, None),
        _ => None,
    }
}

/// The hash a digest algorithm identifier names.
pub(crate) fn hash_of(id: &str) -> Option<Hash> {
    match id {
        oid::SHA256 => Some(Hash::Sha256),
        oid::SHA384 => Some(Hash::Sha384),
        oid::SHA512 => Some(Hash::Sha512),
        _ => None,
    }
}

pub(crate) fn digest(hash: Hash, bytes: &[u8]) -> Vec<u8> {
    match hash {
        Hash::Sha256 => Sha256::digest(bytes).to_vec(),
        Hash::Sha384 => Sha384::digest(bytes).to_vec(),
        Hash::Sha512 => Sha512::digest(bytes).to_vec(),
    }
}

pub(crate) fn sha256(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

/// A SubjectPublicKeyInfo reduced to its key type, curve and raw key bits.
#[derive(Debug, Clone)]
pub(crate) struct PublicKey {
    pub(crate) kind: String,
    pub(crate) curve: Option<String>,
    pub(crate) bits: Vec<u8>,
}

pub(crate) fn key_of(spki: &[u8]) -> der::DerResult<PublicKey> {
    let outer = der::expect(Some(&der::parse(spki, 0)?), 0x30, "SubjectPublicKeyInfo")?;
    if outer.end != spki.len() {
        return Err("SubjectPublicKeyInfo has trailing bytes".to_owned());
    }
    let fields = der::children(&outer)?;
    if fields.len() != 2 {
        return Err("SubjectPublicKeyInfo is not an algorithm and a key".to_owned());
    }
    let (kind, params) = der::algorithm(&fields[0])?;
    let curve = match params {
        Some(node) if node.tag == 0x06 => Some(der::oid(&node)?),
        _ => None,
    };
    Ok(PublicKey {
        kind,
        curve,
        bits: der::bit_string(&fields[1])?.to_vec(),
    })
}

/// Whether a key can verify under this module at all: an EC key on P-256 or P-384, or Ed25519.
pub(crate) fn supported(key: &PublicKey) -> bool {
    match key.kind.as_str() {
        oid::EC_PUBLIC_KEY => matches!(key.curve.as_deref(), Some(oid::P256 | oid::P384)),
        oid::ED25519 => key.bits.len() == 32,
        _ => false,
    }
}

/// True when `signature` over `data` verifies under the SPKI key. A scheme or
/// key this module cannot handle counts as not verifying. ECDSA signatures are
/// DER `SEQUENCE { r, s }`; Ed25519 signatures are 64 raw bytes.
pub(crate) fn verify(
    spki: &[u8],
    scheme: Scheme,
    fallback: Option<Hash>,
    data: &[u8],
    signature: &[u8],
) -> bool {
    let Ok(key) = key_of(spki) else {
        return false;
    };
    match scheme.kind {
        Kind::Ed25519 => {
            if key.kind != oid::ED25519 {
                return false;
            }
            let Ok(bytes) = <[u8; 32]>::try_from(key.bits.as_slice()) else {
                return false;
            };
            let Ok(verifying) = ed25519_dalek::VerifyingKey::from_bytes(&bytes) else {
                return false;
            };
            let Ok(signature) = ed25519_dalek::Signature::from_slice(signature) else {
                return false;
            };
            use ed25519_dalek::Verifier;
            verifying.verify(data, &signature).is_ok()
        }
        Kind::Ecdsa => {
            if key.kind != oid::EC_PUBLIC_KEY {
                return false;
            }
            let hash = scheme.hash.or(fallback);
            match key.curve.as_deref() {
                Some(oid::P256) => {
                    use p256::ecdsa::signature::hazmat::PrehashVerifier;
                    let Ok(verifying) = p256::ecdsa::VerifyingKey::from_sec1_bytes(&key.bits)
                    else {
                        return false;
                    };
                    let Ok(signature) = p256::ecdsa::Signature::from_der(signature) else {
                        return false;
                    };
                    let prehash = digest(hash.unwrap_or(Hash::Sha256), data);
                    verifying.verify_prehash(&prehash, &signature).is_ok()
                }
                Some(oid::P384) => {
                    use p384::ecdsa::signature::hazmat::PrehashVerifier;
                    let Ok(verifying) = p384::ecdsa::VerifyingKey::from_sec1_bytes(&key.bits)
                    else {
                        return false;
                    };
                    let Ok(signature) = p384::ecdsa::Signature::from_der(signature) else {
                        return false;
                    };
                    let prehash = digest(hash.unwrap_or(Hash::Sha384), data);
                    verifying.verify_prehash(&prehash, &signature).is_ok()
                }
                _ => false,
            }
        }
        Kind::Rsa => false,
    }
}

/// The scheme a bare key verifies DSSE signatures with: Ed25519 over the
/// message, ECDSA over its SHA-256 (what `cosign`, `sigstore-js` and
/// `node:crypto` with `sha256` produce).
pub(crate) fn dsse_scheme(key: &PublicKey) -> Option<Scheme> {
    match key.kind.as_str() {
        oid::ED25519 => Some(Scheme {
            kind: Kind::Ed25519,
            hash: None,
        }),
        oid::EC_PUBLIC_KEY => Some(Scheme {
            kind: Kind::Ecdsa,
            hash: Some(Hash::Sha256),
        }),
        _ => None,
    }
}

/// A local private key that signs DSSE envelopes.
pub(crate) enum SigningKey {
    P256(p256::ecdsa::SigningKey),
    Ed25519(ed25519_dalek::SigningKey),
}

impl SigningKey {
    /// Read an unencrypted PKCS#8 (`PRIVATE KEY`) or SEC1 (`EC PRIVATE KEY`) PEM.
    pub(crate) fn from_pem(text: &str) -> Result<Self, String> {
        // The same `pkcs8` trait serves both curves.
        use ed25519_dalek::pkcs8::DecodePrivateKey as _;
        if text.contains("-----BEGIN EC PRIVATE KEY-----") {
            return p256::SecretKey::from_sec1_pem(text)
                .map(|secret| Self::P256(p256::ecdsa::SigningKey::from(&secret)))
                .map_err(|error| format!("{error}"));
        }
        if !text.contains("-----BEGIN PRIVATE KEY-----") {
            return Err("not an unencrypted PKCS#8 or SEC1 PEM private key".to_owned());
        }
        if let Ok(secret) = p256::SecretKey::from_pkcs8_pem(text) {
            return Ok(Self::P256(p256::ecdsa::SigningKey::from(&secret)));
        }
        ed25519_dalek::SigningKey::from_pkcs8_pem(text)
            .map(Self::Ed25519)
            .map_err(|error| format!("{error}; P-256 and Ed25519 keys are supported"))
    }

    /// The DSSE signature over the pre-authentication encoding: DER for ECDSA, 64 bytes for Ed25519.
    pub(crate) fn sign(&self, pae: &[u8]) -> Vec<u8> {
        match self {
            Self::P256(key) => {
                use p256::ecdsa::signature::Signer;
                let signature: p256::ecdsa::Signature = key.sign(pae);
                signature.to_der().as_bytes().to_vec()
            }
            Self::Ed25519(key) => {
                use ed25519_dalek::Signer;
                key.sign(pae).to_bytes().to_vec()
            }
        }
    }

    /// The SubjectPublicKeyInfo DER of the public key.
    pub(crate) fn spki(&self) -> Vec<u8> {
        match self {
            Self::P256(key) => {
                use p256::pkcs8::EncodePublicKey;
                key.verifying_key()
                    .to_public_key_der()
                    .expect("a P-256 public key encodes")
                    .as_bytes()
                    .to_vec()
            }
            Self::Ed25519(key) => {
                use ed25519_dalek::pkcs8::EncodePublicKey;
                key.verifying_key()
                    .to_public_key_der()
                    .expect("an Ed25519 public key encodes")
                    .as_bytes()
                    .to_vec()
            }
        }
    }
}

/// The key id a keyed bundle carries as `publicKey.hint`: SHA-256 of the SPKI DER, in hex.
pub(crate) fn key_id(spki: &[u8]) -> String {
    der::hex(&sha256(spki))
}

#[cfg(test)]
mod tests {
    use super::*;

    const P256_PEM: &str = include_str!("../../tests/data/attest/p256.private.pem");
    const ED25519_PEM: &str = include_str!("../../tests/data/attest/ed25519.private.pem");

    #[test]
    fn a_local_key_signs_what_its_own_public_key_verifies() {
        for (pem, kind) in [(P256_PEM, oid::EC_PUBLIC_KEY), (ED25519_PEM, oid::ED25519)] {
            let key = SigningKey::from_pem(pem).unwrap();
            let spki = key.spki();
            let public = key_of(&spki).unwrap();
            assert_eq!(public.kind, kind);
            assert!(supported(&public));
            let signature = key.sign(b"DSSEv1 1 a 1 b");
            let scheme = dsse_scheme(&public).unwrap();
            assert!(verify(&spki, scheme, None, b"DSSEv1 1 a 1 b", &signature));
            assert!(!verify(&spki, scheme, None, b"DSSEv1 1 a 1 c", &signature));
            assert_eq!(key_id(&spki).len(), 64);
        }
        assert!(SigningKey::from_pem(
            "-----BEGIN PUBLIC KEY-----\nAA==\n-----END PUBLIC KEY-----\n"
        )
        .is_err());
        assert!(SigningKey::from_pem("not a key").is_err());
    }
}
