# Sigstore conformance bundles

Test data for `test/transparency.test.mjs`, copied unchanged from
[sigstore/sigstore-conformance](https://github.com/sigstore/sigstore-conformance)
`test/assets/bundle-verify/<case>/` at commit `43321d80f52958efa584c6c975716150db62180b`
(2026-10-19). That repository is licensed under the Apache License 2.0.

Each folder holds `bundle.sigstore.json`, the `trusted_root.json` the case is
checked against (the Sigstore staging root, with a modified timestamp authority
where the case needs one) and the case's own `README`. A folder whose name ends
in `_fail` must be rejected; the others must be accepted.

Every case is a Rekor v2 `hashedrekord/0.0.2` entry with an RFC 3161 timestamp.
The `dsse` cases carry a DSSE envelope, as Prism bundles do; the others carry a
message signature. All were signed against staging Sigstore. None is signed
with a key that grants anything, and no key or token was created for this
repository.

A case the conformance suite fails only for the DSSE signature (`rekor2-dsse-invalid-sig_fail`)
is not included: checking that signature is issue #272.
