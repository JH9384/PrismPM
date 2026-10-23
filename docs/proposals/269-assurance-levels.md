# Proposal 269: assurance levels P0 to P3

| | |
| --- | --- |
| Issue | [#269](https://github.com/UOR-Foundation/PrismPM/issues/269) |
| Milestone | M2 v0.5 Lock, check, proof |
| Status | Proposed, Experimental |
| Document | `prism/verdict/1` |
| Depends on | #266 (proof predicate), #267 (attestation bundle and trust root), #268 (provenance) |
| Used by | #270 (`prism check`), #273 (`@prism-code/verify`), #282 (`prism run`), #283 (world check), #284 (replay), #285 (policy file) |

## Summary

An assurance level says how much of a holo's evidence a checker could confirm.
There are four levels: P0 unverified, P1 provenance, P2 proof checked, P3 proof, replay and world.
Each level includes everything the levels below it require.
The level is computed from the evidence the holo carries, never read from a claim.
A policy then decides whether that level is enough; the default policy asks for P2 or above and a declared world within the granted capabilities.
`prism check`, `holo.verify()` and `@prism-code/verify` all return the same verdict: the level, whether the policy passed, and the reason for every check that did not pass.
The levels, their order, the verdict type and its JSON Schema ship in `@prism-code/spec`.

## Motivation

Three tools judge a holo: `prism check` on a build machine, `holo.verify()` in the runtime and `@prism-code/verify` in a browser.
Without one shared scale each would answer "is this safe to run" in its own words.
A registry, a CI job and a policy engine need one comparable answer they can store and compare.
SLSA solved the same problem for build provenance with a short ordered scale, and policy authors already think in it.
Prism checks more than provenance, so it needs its own scale built the same way.

### Goals

- Four ordered levels with one meaning everywhere: in `prism check`, in `holo.verify()` and in the proof predicate's `verifiedLevels`.
- A level that any checker computes from evidence, so two checkers given the same holo reach the same level.
- A verdict that keeps two answers apart: how far the evidence got, and whether the policy accepts it.
- Exit codes a CI script can rely on without parsing text.

### Non-goals

- The policy file format. #285 owns it; this proposal only fixes what the default policy means.
- The provenance, proof and replay predicates. #268, #266 and #284 own them; this proposal only says which level each one serves.
- The world and capability checks themselves. #278, #279 and #283 own them.
- The text `prism check` prints. #270 owns it.

## Proposal

User stories.

- A CI job runs `prism check --json app.holo` and gates the deploy on exit code 0. When the job fails it stores the verdict and shows its `reasons`.
- A security reviewer reads "Level: P2" and knows the Lean kernel accepted every listed theorem and the provenance verified. They also know nobody replayed recorded runs.
- A developer adds an outbound host without granting it. The check still says P2, so they know the proof is fine. It fails because the world asks for more than the capability set gives.
- A browser page calls `holo.verify()` and shows "proof checked" only when the returned level is P2 or higher.

Risks and mitigations.

- Risk: P2 is read as "the program is proven correct". Mitigation: the level names what was checked, and the wording below repeats the trusted computing base from #266.
- Risk: a signer claims a level its evidence does not support. Mitigation: claims are never inputs; every checker recomputes the level.
- Risk: P-levels are confused with SLSA levels. Mitigation: a different letter, and the precedent section lists where they differ.

## Design details

### The four levels

| Level | Name | Requires | What it tells you | Attestations that must be present and valid |
| --- | --- | --- | --- | --- |
| P0 | unverified | Nothing. The file is a holo that `check` could read. | Nothing about who built it or what it does. | None. |
| P1 | provenance | P0, the archive footer and every section fingerprint recompute, and a provenance statement verifies. | The bytes are intact, and you know which toolchain built them and from which inputs. | Provenance, `https://slsa.dev/provenance/v1` (#268). |
| P2 | proof checked | P1, and a proof statement passes every proof check. | The Lean 4 kernel accepted every listed theorem about this holo's model. The model belongs to this guest. | Provenance and proof, `https://uor.foundation/prism/proof/v1` (#266). |
| P3 | proof, replay and world | P2, a replay statement verifies, and the declared world fits inside the capabilities the holo grants itself. | Recorded runs replay unchanged, and the holo touches nothing it did not declare. | Provenance, proof and replay, `https://uor.foundation/prism/replay/v1` (#284). |

"Valid" means three things.
The DSSE signature verifies against the trust root from #267.
The subject matches the bytes of this holo.
Every check the predicate's own proposal defines passes; for proof these are #266's eight check ids.

P2 does not mean the shipped program is proven.
The wording from #266 applies to every level: "Every Prism application ships machine-checked proofs of its model. The checker is the Lean 4 kernel at a pinned version. The toolchain that turns the model into the shipped program is attested and reproducible, not proven."

In M2 no holo can reach P3, because replay arrives in M3 (#284).
Until a holo declares a world (#278), its world is empty, and an empty world fits inside any capability set.

### Computed from evidence, never asserted

A level is a fact a checker computes, not a field anyone writes.
`check` reads the statements in the holo's attestation bundle and runs every check on them.
The level is the highest one whose checks, and the checks of every level below it, all pass.

A statement's `verifiedLevels` is therefore a claim, and `check` never uses it as an input.
Following SLSA, `verifiedLevels` holds exactly one level, the highest the signer verified, because each level implies the ones below it.
A proof statement can support at most P2, so `prism/proof/v1` fixes `verifiedLevels` to `["P2"]`.
Any other value is a shape failure, `proof.statement` with `PP5502`.
This amends #266's `proof.level` row.
Policies compare the computed level, never the claim, so `proof.level` checks only the claim's shape.

### Order and monotonicity

The order is total: P0 < P1 < P2 < P3.
In `@prism-code/spec` the order is `ASSURANCE.LEVELS`, and `ASSURANCE.RANK` maps each level to its index.

Five rules follow.

1. Levels are cumulative. A level requires every check of every level below it.
2. No skipping. A holo with a valid proof but no provenance is P0, not P2. Its only reason is the missing provenance, which shows the proof itself was fine.
3. Adding valid evidence never lowers the level. Removing evidence never raises it.
4. The policy never changes the level. It only decides `passed`.
5. `check` runs every check, even after a lower level fails, so one run reports every problem.

### The default policy

The default policy reads: "P2 or above, and the declared world within the granted capabilities".
In terms of the verdict, a holo passes the default policy when both of these hold.

- `RANK[level] >= RANK["P2"]`.
- The `world.capabilities` check passed.

The second clause is checked at every level, not only at P3.
A P2 holo whose world asks for more than its capability set grants fails the default policy.
The same failure also withholds P3.
The policy is a verify-time input and never lives in the holo (#270, #285).
Its name in the verdict is `default`.

### A failing policy still reports its level

The verdict keeps the level and the policy result apart.
A holo whose proof is fine but whose world exceeds its capabilities reports `level: "P2"` and `passed: false`.
A tampered guest reports `level: "P1"`: the proof subject no longer matches, so P2 is withheld.
The developer always sees how far the evidence got and what stopped it.

### The verdict

The verdict is one JSON object, schema `prism/verdict/1`, defined in `sdk/npm/spec/schemas/verdict/verdict-v1.schema.json`.

```ts
interface Verdict {
  schema: "prism/verdict/1";
  holo: string;                     // archive fingerprint, "blake3:" and 64 hex
  level: "P0" | "P1" | "P2" | "P3"; // computed from evidence
  policy: { name: string; minimum: "P0" | "P1" | "P2" | "P3" };
  passed: boolean;                  // the policy's answer
  reasons: {
    check: string;                  // stable dotted id, e.g. "proof.subject"
    code?: string;                  // registered diagnostic, e.g. "PP5503"
    withholds: "P1" | "P2" | "P3" | null;
    message: string;                // for people; not part of the contract
  }[];
}
```

| Member | Meaning |
| --- | --- |
| `holo` | The archive fingerprint, the identity of the bytes that were checked. |
| `level` | The highest level no reason withholds. |
| `policy.name` | `default`, or the policy file as given to `--policy`. |
| `policy.minimum` | The lowest level the policy accepts. |
| `passed` | True when the policy accepts the holo. |
| `reasons[]` | Every check that did not pass, in evaluation order. Empty when every check passed. |
| `reasons[].check` | Which check failed. Check ids are stable across releases; messages are not. |
| `reasons[].code` | The registered `PP` diagnostic, when the check has one. |
| `reasons[].withholds` | The lowest level this failure withholds. `null` when it withholds none, as for a policy rule. |

The schema enforces two rules, so no verdict can contradict itself.

- A verdict with `passed: true` has a level at or above `policy.minimum`.
- Below P3, some reason withholds the next level up. No reason withholds the reported level or any level below it.

A verdict with `passed: true` may still list reasons: they explain why the level is not higher.
The names in #270's "Done when", such as `ProofMismatch`, are the human titles of check ids: `ProofMismatch` is `proof.subject` with `PP5503`.

Check ids by level:

| Withholds | Check ids | Owner |
| --- | --- | --- |
| P1 | `holo.integrity`, `provenance.*` | prism-code reader, #268 |
| P2 | `proof.envelope`, `proof.statement`, `proof.subject`, `proof.model`, `proof.verifier`, `proof.verdict`, `proof.tcb`, `proof.level` | #266 |
| P3 | `replay.*`, `world.capabilities` | #284, #283 |
| none | `policy.level`, and every rule a policy file adds as `policy.*` | this proposal, #285 |

An absent statement fails its family's `.statement` check, for example `replay.statement`.
Two new diagnostics are proposed, class `acceptance`, exit code 1.

| Code | Title | Check id |
| --- | --- | --- |
| `PP5601` | Assurance level below the policy minimum | `policy.level` |
| `PP5602` | Declared world exceeds the granted capabilities | `world.capabilities` |

### Exit codes

| Code | Name | Meaning | Verdict printed |
| --- | --- | --- | --- |
| 0 | `PASSED` | A verdict was reached and `passed` is true. | Yes |
| 1 | `FAILED` | A verdict was reached and `passed` is false. | Yes |
| 2 | `NO_VERDICT` | No verdict was reached. | No |

Exit 2 covers a file that is not a holo, an unknown format revision, an unreadable policy file and a resource `check` needed but could not reach.
CI must treat 2 as a failure.
A missing attestation is not exit 2: it is evidence that is absent, so it lowers the level and the verdict is printed.
A holo whose footer or a section fingerprint fails to recompute is P0 with reason `holo.integrity`, exit 1.
`prism check` collapses the per-class exit codes of `ERRORS.md` into these three, because the verdict, not the code, names the cause.
With `--json`, stdout holds exactly one verdict object on exit 0 and 1 and nothing on exit 2; diagnostics go to stderr.
`holo.verify()` and `@prism-code/verify` return the same object and have no exit code.
`prism run` starts only on exit 0 (#282).
In `@prism-code/spec` these codes are `ASSURANCE.EXIT`.

### What ships in `@prism-code/spec`

- `assurance-levels.mjs` exports one frozen constant, `ASSURANCE`. It holds `LEVELS`, `RANK`, `NAMES`, `ADDS` (the evidence each level adds), `PREDICATES`, `DEFAULT_MINIMUM`, `DEFAULT_POLICY`, `EXIT`, `VERDICT` and `VERDICT_SCHEMA`.
- `assurance-levels.d.ts` declares `AssuranceLevel`, `WithheldLevel`, `AssuranceEvidence`, `VerdictReason` and `Verdict`.
- `schemas/verdict/verdict-v1.schema.json`, `$id` `https://schemas.uor.foundation/prism/verdict/1`.
- `index.mjs` re-exports `ASSURANCE`; `index.d.ts` re-exports the types.

### Test plan

In `sdk/npm/spec/test/assurance-levels.test.mjs`, run by `node --test`:

- The order is P0 < P1 < P2 < P3, and each level's rank is its index.
- Each piece of evidence is added by exactly one level, and P0 requires nothing.
- The default minimum is P2, and the exit codes are 0, 1 and 2.
- Four verdict fixtures in `test/fixtures/verdict/` validate. Each level equals the highest level no reason withholds: calculator at P2 passing, P2 failing on the world, P1 with a tampered guest, and P0 under a provenance-only policy.
- An unknown level fails: `P4`, `p2`, `2`, a SLSA `L2` as the minimum, and a reason that withholds P0.
- A self-contradicting verdict fails: a pass below the minimum, P3 with a withholding reason, and P2 or P0 with no reason for the missing level.
- The `Verdict` type and the schema name the same members.

Conformance scenarios, registered in `model/ids.toml` under a new family `AL` once #270 implements the verdict:

| ID | MUST |
| --- | --- |
| `AL-01` | Both reference archives reach P2 under the default policy and exit 0. |
| `AL-02` | A tampered guest blob reports P1, reason `proof.subject` with `PP5503`, and exits 1. |
| `AL-03` | A holo without provenance reports P0 even when its proof statement is valid. |
| `AL-04` | A holo whose world exceeds its capability set reports its level, `passed: false` and `PP5602`. |
| `AL-05` | A statement's `verifiedLevels` never changes the computed level. |
| `AL-06` | `prism check`, `holo.verify()` and `@prism-code/verify` return equal verdicts for every fixture. |

### Graduation criteria

- Experimental (M2). This document, the module and the schema are merged. #270 prints verdicts that validate against `prism/verdict/1`, and AL-01 to AL-03 pass.
- Frozen (M3). Replay (#284) and the world check (#283) make P3 reachable, and AL-04 to AL-06 pass. One release cycle passes with no change to the levels or the verdict.
- Stable (1.0). The four level names and their meanings are final. Any change to the verdict becomes `prism/verdict/2`, and a level name is never reused with a new meaning.

## Precedent

SLSA Build Track, levels L0 to L3, and the SLSA Verification Summary Attestation (VSA).

Copied from SLSA:

- A short ordered scale starting at 0, where 0 means no guarantees.
- Cumulative levels: each level requires all of the level below it.
- One level per track in `verifiedLevels`, the highest one verified, because higher levels imply lower ones.
- A policy that names a minimum level.

Where Prism deliberately differs:

- SLSA grades how hard it is to forge a build's provenance. Prism grades what was checked about the holo: provenance, then proof, then replay and world. Only P1 resembles a SLSA level, and P1 is not SLSA L1 or L2: P1 requires signed provenance, SLSA L1 does not, and P1 says nothing about a hosted build platform.
- In a VSA the verifier asserts the level and the consumer trusts the verifier. In Prism every consumer recomputes the level from evidence, and a statement's claim is never an input.
- A VSA writes `FAILED` into `verifiedLevels` when policy fails. Prism keeps the level and reports `passed: false` beside it, so a failing holo still shows how far it got.
- SLSA has several tracks. Prism has one, so a verdict carries one level.
- The letter is P, not L, so a policy can name a SLSA level and a Prism level side by side without ambiguity.

## Alternatives

- Pass or fail only. Simple, but it hides how far a holo got, and every consumer would re-derive it. Rejected.
- Independent flags (`provenance: true`, `proof: true`, `replay: false`) instead of an order. More expressive, but every policy must spell out the combinations, and two tools can rank them differently. Rejected; `reasons` already gives per-check detail.
- Let a proof stand without provenance (P2 without P1). The proof binds the model to the guest, but only provenance binds the build inputs and the lock. Rejected for a total order, as SLSA does.
- Report the signer's `verifiedLevels`. Cheap, but it turns the level into an assertion and lets a stale or careless signer raise it. Rejected.
- Name the levels L0 to L3. Familiar, but they would collide with SLSA levels in the same policy. Rejected.
- Exit 2 for a missing attestation, as an early draft of the docs had it. A missing statement is a finding about the holo, not a failure to check it. Rejected.

## Prior art

- SLSA v1.1, Build Track levels, `https://slsa.dev/spec/v1.1/levels`.
- SLSA v1.1, Verification Summary Attestation, `https://slsa.dev/spec/v1.1/verification_summary`. Its `verifiedLevels`, `verificationResult` and `policy` fields shape the proof predicate (#266).
- Common Criteria Evaluation Assurance Levels EAL1 to EAL7, a cumulative graded-assurance scale for evaluated products.
- `cosign verify-attestation --policy` and Kyverno image verification, which gate on attestations a policy names.
- `dagger check` and `nix flake check`, the exit-code precedent #270 cites.

## Unresolved questions

1. `PP5601` and `PP5602` need registering in `model/errors.toml`. #283 may prefer to own `PP5602` under its own number.
2. #283 records whether a world is pure. Does that become a verdict member, which needs `prism/verdict/2`, or stay in `prism inspect`?
3. Should `prism check` sign its verdict as a VSA, with `verifiedLevels` set to `[level]`? If it does, that statement is a cache for consumers without the holo, never evidence.
4. `policy.name` is a display string. #285 may need the policy's digest in the verdict, as a VSA records it.
5. The per-class exit codes in `ERRORS.md`, such as 7 for `policy`, versus the three codes of `check`. This proposal says `check` collapses them; #270 should confirm.
6. #266's user story has a policy engine require `verifiedLevels` to contain `P2`. With one level per statement, that policy must accept P2 or P3.
