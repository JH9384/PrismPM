# Original key-validation data

The Base64 files preserve complete original source bytes, including line endings.
`oracles.mjs` independently pins their full hashes and selects every P-256 case:
12 NIST CAVP PKV cases and three NIST ACVP FIPS 186-5 KeyVer samples. Other curves
remain in the originals but are not claimed as implemented. Oversized integer
coordinates are never truncated to fit a valid key.

SEC1/SEC2 document URLs and retrieved document hashes are normative-source pins,
not executable validation oracles. The fixed-domain implementation, independent
arithmetic and complete applicable vector checks remain separate obligations.
These public test vectors do not confer NIST/CAVP certification or establish
complete ECDSA implementation.
