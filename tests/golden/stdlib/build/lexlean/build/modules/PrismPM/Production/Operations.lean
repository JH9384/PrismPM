module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.Operations

public inductive AcceptanceKind where
  | Positive
  | Negative
  | Fault
  | Load
  | Upgrade
  | Downgrade
  | Recovery
  | Rollback

public structure Observability where
  logs : List (String)
  metrics : List (String)
  traces : List (String)
  alerts : List (String)
  slos : List (String)
  redactedFields : List (String)

public structure Sli where
  id : String
  kind : String
  value : String
  dependsOn : List (String)
  signal : String
  unit : String
  windowSeconds : UInt64

public structure Slo where
  id : String
  kind : String
  value : String
  dependsOn : List (String)
  comparison : String
  threshold : UInt64
  unit : String
  percentileMillionths : Option (UInt64)
  windowSeconds : UInt64

public structure ArchitectureBinding where
  id : String
  kind : String
  value : String
  dependsOn : List (String)
  owner : String
  viewpoint : String
  verifies : List (String)
  measurement : Option (String)

public structure Alert where
  id : String
  kind : String
  value : String
  dependsOn : List (String)

public structure Control where
  id : String
  kind : String
  value : String
  dependsOn : List (String)
  owner : String
  verification : List (String)

public structure Rollout where
  id : String
  kind : String
  value : String
  dependsOn : List (String)

public structure Rollback where
  id : String
  kind : String
  value : String
  dependsOn : List (String)

public structure Drift where
  id : String
  kind : String
  value : String
  dependsOn : List (String)

public structure Retirement where
  id : String
  kind : String
  value : String
  dependsOn : List (String)

public structure Acceptance where
  id : String
  kind : String
  target : String
  component : String
  command : List (String)
  evidence : String
  bounded : Bool

end PrismPM.Production.Operations
