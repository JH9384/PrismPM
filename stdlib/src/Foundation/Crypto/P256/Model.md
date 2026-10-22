# P-256 public-key validation

DK-34 implements SEC1 v2.0 §§2.3.4, 2.3.6 and 3.2.2.1 for the single SEC2 v2.0
§2.4.2 secp256r1 domain. It accepts only 65-byte uncompressed `04 || X || Y`,
with 32-byte big-endian coordinates in `[0,p)` satisfying
`y² = x³ − 3x + b (mod p)`. Infinity, other formats and noncanonical coordinates
are rejected, not normalized. P-256 has cofactor one; SEC1 §3.2.2.1 explicitly
derives subgroup membership from these checks in this case.

`Foundation.Crypto.P256.Model.p256PublicKeyValid : Bytes → Bool` is the shared
source admission predicate. DK-33 account genesis and DK-32 signed contexts must
call it before treating an initial/signer key as a valid P-256 point. Host
signature verification remains mandatory. Neither predicate nor provider import
proves possession, account ownership, authorization or currentness.

## Arithmetic boundary

Fields use 17 little-endian base-65536 limbs. Canonical residues have exactly
17 limbs, each in `[0,65535]`, highest limb zero and value below `p`. Arbitrary
malformed limb lists are rejected at exposed typed/test boundaries. Coordinates
are decoded without reduction. Constants are exact SEC2 bytes, not floating-point
or large `Nat` literals.

Addition computes one full 17-limb sum and subtracts `p` once iff needed:
`0 ≤ a,b < p` implies `0 ≤ a+b < 2p`. Each carry step is at most
`65535+65535+1 = 131071`; carry is zero or one. Subtraction checks order and uses
`a+65536−b−borrow`, whose nonnegative intermediate is at most 131071. Results
are checked against the canonical residue invariant. No runtime value relies
on mathematical unbounded `Nat`; these maxima are below the compiler's `u64`
limit. Limb carry/borrow boundary tests and independent large-integer field
oracles accompany the source guards. This argument is distinct from a claimed
machine-checked proof of arbitrary finite-field arithmetic.

Multiplication is exactly 256 double/add steps over the multiplier's bits,
with every accumulator/factor a canonical residue. A depth-eight balanced
traversal preserves left-to-right accumulator state and avoids linear recursive
stack growth. A point check uses three field multiplications and bounded
add/subtract operations. The maximum is 1536 modular additions from those
multiplications, each processing at most 17 limbs; no secret scalar or inversion
operation is implemented. The owning tests enforce execution deadlines and
allocation ceilings and record Wasm linear-memory usage. They do not yet
measure per-operation elapsed time or stack high-water usage; the operation
count alone does not establish resource acceptance.

## Oracles

Pin the reviewed original SEC1/SEC2 documents separately from executable
oracles. Distribute complete original NIST CAVP PKV and ACVP KeyVer source
files with immutable hashes and select every P-256 case. Supplement them
with independent arithmetic and malformed-encoding, boundary, carry and point
cases, actual generated source mutants, and three-engine consumer journeys.
Passing vectors is not NIST/CAVP certification or complete ECDSA conformance.
