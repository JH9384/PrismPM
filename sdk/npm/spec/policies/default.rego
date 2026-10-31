# The default policy: P2 or above, and the declared world within the granted capabilities.
# prism check judges a holo by this file when no --policy is given.
package prism.policy

import rego.v1

minimum := "P2"

deny contains {"rule": "world.capabilities", "message": message} if {
	input.world.within == false
	message := concat("; ", input.world.problems)
}
