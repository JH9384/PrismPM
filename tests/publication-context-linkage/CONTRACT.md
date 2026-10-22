# OC-10 reviewed construction contract

Private source linkage, not authentication, readiness, publication or deployment.
Existing OC-07/08/09 gates and closed public document versions are unchanged.

## Source projection

Add `Production.PublicationAdmission.LinkageV1`, importing the unchanged V1
declaration. The retained, independently replayed full producer semantic snapshot
must contain exactly one closed definition of the exact `PublicationClosure`
type. Selection records its module, logical member, source-module digest,
snapshot/source/semantic/compiler identities and the selected system digest.
The declaration is nested in that value; a second detached declaration, aliases
to another type, unbound source sidecar or caller-created snapshot is not a
linkage input. Imported SDK type declarations must match their captured SDK
source identities. Projection is bounded and accepts only exact closed values.

The new source record contains:

- `system`: the exact source module/member of the selected system model, and
  `target`: one exact target ID in that system. Reprojection must equal the
  actual retained system bytes. The declaration's adapter digest must equal that
  target's adapter digest. URL/publisher/environment remain the declaration's
  explicit values, not facts inferred from a target ID or hostname.
- `declaration`: the existing `V1.PublicationDeclaration`.
- `services`: sorted unique service IDs with nonempty sorted component IDs.
  Component references form an exact disjoint partition of the selected proved
  system's complete component inventory. They declare service grouping, not
  functional correctness or an assertion that the system meets its purpose.
- `controls`: sorted unique references to the selected proved system's complete
  control inventory. Source control definitions, applicability and inheritance
  declarations remain bound as declared data, not discharged obligations.
- `requirements`: one sorted entry for every declaration obligation, preserving
  its ID, assurance kind, authority and scope. Each selects one exact source
  member of a closed `ProofRequirement`, `ExecutionRequirement` or
  `AssessmentRequirement` type. All such producer requirement members must be
  selected exactly once; omission, duplication and unknown members fail.

`ProofRequirement` selects a specific retained kernel-audited theorem, including
its actual proposition and declared axiom policy; a Boolean definition is not a
proof requirement. This binds what theorem is required, not a new scope judgment.
`ExecutionRequirement` selects a captured SDK/standards oracle contract and
states its exact input selector and suite identity; it is not an execution result.
The suite must equal that contract's retained corpus SHA-256. The selector is a
retained build-file path, exact source member, or the complete declared target;
an arbitrary free-text subject or missing corpus does not satisfy the linkage.
The target selector binds the selected system target record together with all
four declaration target fields, never just the URL or an independently supplied
target value.
`AssessmentRequirement` retains the explicit source-owned criterion and subject;
it is not an assessor's approval. Kind/assurance compatibility is closed:
SourceProof uses proof; Oracle/ReproducibleBuild/BrowserJourney/FaultRecovery/
LiveJourney use execution; HumanAssessment/OperationalAssessment use assessment.
No inferred provider, authority, policy, empty substitute inventory or default
criterion is permitted.

## Capture and subject mapping

The strict installed-source constructor is private to the OC-10 test owner; it
does not authorize publication or deployment. It consumes the confined OCI capture after
complete source-free graph/proof/artifact/oracle replay. It retains the actual
root/config, locks, provenance, build files, runtime records and oracle evidence
read during that replay. No second path-based reads or caller digest parameters
construct a captured release. This establishes integrity linkage, not producer
authorization. Actual cryptographic workload/producer verification stays separate.

| OC-09 subject field | Exact captured input |
| --- | --- |
| `producer` | URI of the unique SLSA `gitCommit` dependency |
| `source` | That dependency's exact 40-character lowercase Git SHA-1, decoded to 20 bytes; other widths refused by existing OC-09 revision profile |
| `release` | Verified OCI root manifest digest |
| `model` | SHA-256 of exact retained `model.prism.json` |
| `build` | SHA-256 of exact retained build manifest |
| `services` | Domain-separated generated preimage of the complete source service partition, exact selected system digest and complete referenced component records |
| `controls` | Domain-separated generated preimage of the exact source control references, complete referenced control records, standards-lock digest and all source requirement mappings |
| `dependencies` | Domain-separated generated preimage of every canonical retained SLSA resolved dependency, preserving exact URI/digest pairs; duplicate/confused identities refused |
| `sdk` | Exact immutable SDK image digest from the replayed lock/config, not a source checkout or caller-selected runtime |
| `compiler` | Domain-separated generated preimage of the full SDK lock, LexLean build manifest, LexLean attestation, build manifest and verification manifest identities; complete tool and process records stay bound, with no guessed compiler-only subset |
| `runtime` | Domain-separated generated preimage of the complete verified runtime file inventory and complete browser output inventory, plus the explicit verification-manifest digest containing every observed execution-process record; that exact manifest must also occur in the file inventory |
| `oracles` | Domain-separated generated preimage of all source execution/assessment requirements, complete standards/SDK oracle contracts, and the exact existing release-validation result/attestation closure |
| `tree` | Existing OC-07 tree digest: SHA-256 of canonical sorted `{path,digest,size}` rows for all exact browser-profile files |

Identity preimages use separately versioned domains and generated deterministic
CBOR. File entries contain captured path and SHA-256; the host hashes actual
retained bytes, not caller descriptors. Existing OCI length checks remain in
force and OC-07's tree rows retain their lengths. Every array is exact and ordered
by UTF-8 bytes, never locale collation. Text limits count UTF-8 bytes, not code
points or UTF-16 units. V1Wire emits declaration/context preimages with unchanged wire behavior; there is no
second host serializer for those identities. Aggregate identities bind declared
scope and recorded artifacts only; none prove service behavior, control coverage,
complete external oracle execution, human assessment or future availability.

Publisher revision/ref and attempt identity are a separately captured input,
not producer source facts. OC-10 binds their values but cannot authenticate them;
the future authenticated host must establish workload, protected-ref and attempt
authority before invoking OC-09. A linkage receipt is never a readiness fact.

## Refusal and verification

Collect all independently diagnosable absent closure fields before refusing a
context; malformed/foreign/changed input fails immediately. Existing producers
without the explicit source closure remain ineligible. Do not create a partial
context, zero digest, synthesized service/control list, or successful fallback.

The private limits are 65,536 total services/components/controls/file rows per
inventory, 4,096 requirements, and 128 UTF-8 bytes per semantic inventory ID
(service, component, control, target and oracle). Captured dependency URIs,
source members, file paths and assessment criteria/subjects retain the separate
2,048-byte UTF-8 domain. Every complete generated metadata frame/preimage is
bounded to 64 MiB.
Component limits are aggregate across services. Source lists are bounded chunked
inventories, preserving existing V1's flat wire and obligation limit. A valid
older release outside this new private metadata profile remains valid under its
old gates; it is refused for OC-10, never partially represented.

Generated linkage errors have ordered precedence: `0` invalid typed metadata or
bounds; `1` source/reference mismatch; `2` non-exact inventory partition; `3`
requirement mapping mismatch. Every earlier class is checked before a later
class. Invalid CBOR is a distinct framing result and never a linkage result.

The positive owner uses actual kernel-verified fixture source and its actual
release/SDK/artifact/oracle records. Negatives mutate source member/type/closure,
every subject input, partitions, requirements, locks, tools, retained artifacts,
source-free graph, generated preimages and publisher-attempt bindings. Native
std/no_std/Wasm generated preimages must agree, including exact maxima and
one-over cases. Original OC-07/08/09 tests remain required. Real producer
authentication, readiness facts, durable state/CAS, protected publication,
provider deployment identity, live integrity/journeys and final acceptance are
separate unfinished integration gates, not acceptance granted by this contract.

The complete registered owner requires exactly 65 tests plus two capture guards,
with no skipped, omitted or extra tests: four setup checks, one native semantic
witness group, 33 resource cases, one altered expected result, 20 real compiled
source mutants, five actual-capture checks and the owning test itself. The
3,500-second owner remains within its 3,600-second outer deadline. Capture is
unconditional; a component-only result cannot substitute for its completion.
Native std/no_std observers also execute all 260 collector, 131,592 scalar-bit,
710 public-partition and 3,192 payload/error-order witnesses. Exact captured
source and executable custody includes these observer modules.
The private test IR additionally exports the existing `CollectRows`,
`CollectIdChunks` and `CollectServiceRows` wrappers for these witnesses; this
does not add SDK exports or change any deployed component entrypoint.

The public partition's premises are enforced in source: exact global reference
count, membership of every collected index in the captured inventory, and
duplicate rejection over every bounded bucket. Together they imply complete
coverage. Private bucket behavior on unvalidated missing-index inputs is not
claimed equivalent to the earlier stronger coverage experiment. Writer fusion
retains the original payload bounds and first-error ordering. Its omission,
major and size mutations must fail actual generated byte comparisons.

## Integration boundary

The component positive uses freshly generated fixture source, proof, compiler,
objects and a measured fixture inventory through a private test constructor.
That conditional inventory proves linkage, never installed-SDK image provenance.
Do not relabel an older image with the new source archive. The strict installed-source
factory requires the actual new SDK inventory and corpus bytes; absent inputs refuse.
The actual capture owner exercises that constructor, checks its precise source
refusal for a mismatched SDK, and compares all context and preimage fields with
the measured-fixture constructor when the installed source matches.

Normal `stdlib/generated/package` generation must export the unchanged OC-09
wire, new OC-10 wire and canonical six-field context-preimage helper through the
closed source export register. OC-09 opcode 4 delegates to that helper unchanged.
Construction supplies the six body fields, hashes the generated preimage, then
assembles the complete context; no fabricated self-digest or partial context is
an intermediate input. A bounded private byte projection may call the same helper
for Wasm parity. The host may
encode the private input frame, but only these generated exports emit identity
preimages. No caller callback or host identity serializer may replace them.
A fresh normal SDK image, its complete installed gates and public-host integration
remain mandatory before production use; private fixture results cannot enable a
CLI or publication path.
