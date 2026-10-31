# Pure only: the holo does nothing beyond pure dispatch. It imports no effect, requests no
# capability and is granted none. Any assurance level passes, so an intact holo with no
# statements passes. Copy this file and raise minimum when you also need a level.
package prism.policy

import rego.v1

minimum := "P0"

# A pure world promises nothing about a holo whose bytes do not hold together.
damage contains reason.check if {
	some reason in input.verdict.reasons
	reason.check in {"holo.integrity", "holo.documents", "world.contract"}
}

deny contains {"rule": check, "message": sprintf("the holo is damaged: %s", [check])} if {
	some check in damage
}

deny contains {"rule": "policy.pure-only.world", "message": "the holo declares no world, so nothing shows that it is pure"} if {
	input.world == null
}

deny contains {"rule": "policy.pure-only.world", "message": sprintf("this reader has no world for %s, so nothing shows that it is pure", [input.world.contract])} if {
	input.world.known == false
}

deny contains {"rule": "policy.pure-only.effects", "message": sprintf("the world imports the impure effects %v", [input.world.effects])} if {
	input.world.pure == false
}

deny contains {"rule": "policy.pure-only.imports", "message": sprintf("the world imports %s.%s", [entry.module, entry.name])} if {
	some entry in input.world.imports
}

deny contains {"rule": "policy.pure-only.requested", "message": "the holo carries a capability set that requests something"} if {
	input.world.capability_set.empty == false
}

deny contains {"rule": "policy.pure-only.granted", "message": sprintf("the caller grants %s", [member])} if {
	some member, entries in input.capabilities
	startswith(member, "allow-")
	count(entries) > 0
}
