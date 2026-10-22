# Private PKCE S256 primitive

ST-17 implements RFC 7636 §§4.1–4.2 and Appendix B, not a complete OAuth or
mailbox service. The model admits every 43–128-byte ASCII unreserved verifier,
including period and tilde. It encodes exactly 32 entropy or SHA-256 bytes as
43 unpadded base64url bytes. The browser generates fresh 32-byte randomness and
hashes the exact source-admitted verifier with SHA-256. No plain fallback exists.

The private wire is one operation octet followed by its entire payload:
0 encodes entropy, 1 validates a verifier, 2 encodes a digest. Requests are at
most 129 bytes. Success is octet 0 followed by the complete result; failure is
octet 1 then 1 (length), 2 (character), or 3 (operation). These are internal
bytes, not an OAuth network encoding. Digest and entropy constructors are data,
not proof that a provider performed an effect.

The adapter captures bytes before awaiting, refuses shared/detached buffers,
checks generated artifacts and allocation bounds, and closes pending results
when revoked. Callers must protect returned verifier bytes and bind each pair
to its exact authorization transaction; this primitive does not store secrets.
JavaScript cannot promise erasure of all engine/provider copies.

Independent native and three-engine browser checks use the pinned official
example, every possible octet at every verifier position, all legal lengths,
every input bit of the 32-byte encoding and actual compiled defects.
Artifact self-hashes do not authenticate SDK provenance. Account authorization,
issuer/client registration, redirects, state/nonce binding, token exchange,
signed claim admission, durable single-use, mailbox control and production
deployment remain separate integration requirements.

Sources: [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html),
[OAuth Security BCP §2.1.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1).
