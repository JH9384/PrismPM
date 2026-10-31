# Provenance only: the holo carries a provenance statement whose signature checks, and no proof is
# required. P1 includes the integrity of the archive, so a damaged holo cannot reach it.
package prism.policy

import rego.v1

minimum := "P1"

deny contains {"rule": "policy.provenance-only.absent", "message": "the holo carries no provenance statement"} if {
	input.predicates.provenance == null
}

deny contains {"rule": "policy.provenance-only.unverified", "message": "the provenance statement signature does not check against the trust root"} if {
	input.predicates.provenance.verified == false
}
