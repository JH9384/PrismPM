module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.Core

public inductive ComponentKind where
  | Browser
  | Api
  | Worker
  | Database
  | Broker
  | IdentityProvider
  | TelemetryCollector
  | Migration
  | Job

public structure Product where
  id : String
  owner : String
  version : String
  lifecycle : String
  sourcePolicy : String
  supportedPlatforms : List (String)

public structure Artifact where
  id : String
  mediaType : String
  digest : String
  licenseExpression : String
  path : String
  role : String
  platformRequirements : List (String)

public structure ResourceRequirements where
  cpuMillis : UInt32
  memoryBytes : UInt64
  replicasMin : UInt32
  replicasMax : UInt32

public structure Component where
  id : String
  kind : String
  version : String
  artifact : String
  capabilities : List (String)
  command : List (String)
  dependsOn : List (String)
  interfaces : List (String)
  health : String
  liveness : List (String)
  parameters : List (String)
  ports : List (String)
  readiness : List (String)
  resources : ResourceRequirements
  secrets : List (String)
  startup : List (String)
  volumes : List (String)
  isolation : String
  placement : List (String)
  platformRequirements : List (String)
  scalingPolicy : Option (String)
  failurePolicy : String
  retryPolicy : String
  degradationPolicy : String
  idempotency : String

public structure Capability where
  id : String
  kind : String
  value : String
  dependsOn : List (String)

public structure Configuration where
  id : String
  valueType : String
  allowed : List (String)
  defaultValue : Option (String)
  required : Bool
  mutable : Bool
  lateBound : Bool
  exposure : String

public structure SecretReference where
  id : String
  providerKey : String
  consumers : List (String)
  rotation : String

public structure IdentityRequirement where
  id : String
  issuerParameter : String
  audiences : List (String)
  subjects : List (String)
  roles : List (String)

end PrismPM.Production.Core
