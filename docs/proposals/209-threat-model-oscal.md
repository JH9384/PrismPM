# 209: threat models a downstream system can author, check and emit as OSCAL

Issue: [#209](https://github.com/UOR-Foundation/PrismPM/issues/209). Consumer: UOR-Foundation/prism-code#31. Builds toward [#315](https://github.com/UOR-Foundation/PrismPM/issues/315).

## Problem

A downstream model can state assets, threats, risks and controls with `Foundation.Sec`, but those records carry only indexes. They have no STRIDE category, no evidence and no accepted risk. prism-code models the missing facts locally and proves them with `decide`, so the SDK cannot refuse a gap and cannot emit a control set.

## What the last issue comment no longer gets right

The comment of 2026-10-22 names two blockers. Neither is open on `main`.

- **Emitter digest.** `model/emitter-inputs.toml` holds `aec10024...`, not `973aff8e...`, and the 31-input closure has grown since. `5540d783...` was the digest of an older input set, so writing it would fail `audit_emitter_inputs`. This design changes no emitter input, so the registered digest stands.
- **Facet records beside an application.** `project_application_with_facets` and `facet_validate` already carry and accept them (SPEC §2). The app-projection branch landed through #230.

PR #61's oracle source also landed. `sdk/oracles/oscal`, `standards/oracles/oscal-1.1.0`, AU-07 and SPEC §10.1 are on `main` and match the PR byte for byte. The missing part is its authority binding: neither `model/authorities.toml` nor `standards.lock` names OSCAL.

## Decision

Add a checked, not projected, threat model, the path features and journeys took (SPEC §2.2).

`Foundation.Sec` records stay the identity of every asset, threat and control. A new stdlib module, `Production.ThreatModel`, adds the facts they lack. Each row names a `Foundation.Sec` record by its qualified `<module>::<declaration>` identifier, the identifier the model document already gives it.

| Type | States |
| --- | --- |
| `ControlSet` | document title, text, version and last-modified time |
| `ModeledAsset` | name and text of an asset |
| `ModeledThreat` | name, text and STRIDE category of a threat |
| `ModeledControl` | name, text and evidence of a control |
| `Evidence` | the kind (`gate`, `proof`, `review`) and reference that realize a control |
| `ThreatMapping` | the controls that answer a threat |
| `AcceptedRisk` | the rationale for accepting a threat |

Why this shape:

- **No second identity.** Rows that repeated threats beside `Foundation.Sec` could disagree with the model document. Naming its records makes a disagreement a refusal.
- **No digest ripple.** Widening `Foundation.Sec` or the model document would move the emitter digest, the schemas and every bound `application_model_digest`. A checked module moves none of them.
- **No hidden values.** `lastModified` is stated by the model because a build cannot read a clock and stay reproducible. SPEC §11 forbids an emitter inventing a default.

### Check

`prismpm check` and `prismpm build` run the check over every entrypoint of the project, because a threat model usually sits outside the application roots. A model with no `Production.ThreatModel` row is unaffected. Once it declares any row, it is held to the whole rule.

| Code | Refusal |
| --- | --- |
| `PP2019` | a threat has no mapped control and no accepted risk |
| `PP2020` | a control names no evidence |
| `PP2021` | a threat has no STRIDE category row |
| `PP2022` | a row is malformed, names no such record, is out of bounds, or the control set is absent or repeated |

`Production.ThreatModel.validateNormalizedThreatModel` is the formal statement of the first three, with soundness, completeness and finite refusal theorems, as `Foundation.Holo` does for features. The Rust check is tested for agreement with it.

### Emit

`prismpm build` writes `oscal/component-definition.json`, an OSCAL 1.1.0 component definition with one component and one control implementation. Each control becomes an implemented requirement. Its evidence and the threats it answers become properties. Accepted risks are stated in the component's remarks, so they cannot be read as mitigated.

- **`control-id`** is `<module>.<declaration>`, because a qualified identifier is not an OSCAL token.
- **`source`** points to a back-matter resource that names the model, because these are the model's own controls rather than a NIST catalog's.
- **UUIDs** are version 5 shaped, derived by SHA-256 from the identifiers and content, so the same model produces the same bytes.

### Oracle

Bind AU-07's validator through SPEC §10: an `OSCAL-1-1-0` authority, an `oscal-1.1.0-structural` oracle row, the `oscal` profile of `prismpm oracle`, and installation in the SDK image. The result is regenerated into `standards.lock` by `authority resolve`.

The workspace's own `jsonschema` 0.50.1 cannot stand in for it. That version mishandles the fragment `$id` references the OSCAL schemas use (upstream issue 1668), which is why the oracle pins 0.58.2. It wrongly rejects a valid document. So the unit suite pins the emitted bytes to committed subjects, and AU-08 passes those subjects through the locked oracle.

Passing means JSON structural validity only (SPEC §10.1). It does not establish that a control is implemented, that evidence is true, or conformance to OSCAL as a whole. The emitted document says the same in its remarks.

## Costs a reviewer should weigh

- **Controller pin.** A threat model outside the application roots is invisible to `design::render_snapshot`, which sees only the application-root snapshot when a system release exists. The call therefore has to sit in `controller/mod.rs`, whose hash `scripts/native-golden.mjs` pins for independent source review. That pin is left for the reviewer to move.
- **Goldens.** A new stdlib entrypoint moves the shared stdlib goldens and native records, which come from the golden refresh and native source review workflows.
- **A design-view gap this exposes.** When a system release exists, `design::render_snapshot` and the feature check see only the application-root snapshot. A design view or feature declared in another entrypoint is therefore not read in that case. A build of prism-code's model, whose design views sit in `src/Design.lex.tex`, rendered none. This change does not alter that behaviour.

## Not in scope

- Modelling prism-code's quality view (the `Foundation.Qual` half of the issue's first comment).
- Mapping controls onto a published catalog such as NIST SP 800-53.
- OSCAL profile resolution, assessment results or a system security plan.
- An owner field on accepted risks. #315 can add it if security officers need it.
