# Host-effect service system

`Production.HostEffectSystem.SystemModel` contains one service whose
application acts through host effects. Its application profile names the
server application contract `prismpm/server-application/1` and the effect
protocol `prismpm/host-effects/1`, binds the digest of the selected
application model, and lists the effects that application declares.

The model has `api`, `worker`, `job` and `telemetry-collector` components with
declared images, parameters, secret references, volumes and networks. A
component depends only on components declared before it. An `api` component
runs on the host network, declares no network and runs exactly one replica,
since a second would bind the same loopback port; every other component
declares at least one network. A listener belongs to an `api` component, uses TCP,
takes a distinct port and binds `127.0.0.1`, which on the host network is the
host's loopback.

`validateManifest` checks the profile constants, the identities, every
reference, the dependency order, the listeners, the single Compose target and
the exact manifest bindings. `manifestValidation_sound_complete` has an empty
axiom set. The decided theorems after it admit the mcp-loopback example and
refuse each planted defect, among them a wildcard, hostname or other loopback
binding, an `api` component on a network, a worker on none and an `api`
component with a second replica; a worker with several replicas is admitted.

Source proof does not prove that the declared effects equal the host protocol
of the selected application, authenticate ownership, or authorize deployment.
