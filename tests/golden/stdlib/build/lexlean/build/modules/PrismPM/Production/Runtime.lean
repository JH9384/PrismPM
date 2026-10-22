module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.Runtime

public inductive TargetKind where
  | Compose
  | Kubernetes
  | GithubPages

public structure PlatformRequirement where
  id : String
  os : String
  architectures : List (String)
  runtime : String
  runtimeVersion : String
  capabilities : List (String)

public structure ScalingPolicy where
  id : String
  component : String
  trigger : String
  minimum : UInt32
  maximum : UInt32
  step : UInt32
  cooldownSeconds : UInt64

public structure StorageClass where
  id : String
  accessModes : List (String)
  bindingMode : String
  provisioning : String
  retention : String
  capabilities : List (String)
  platformRequirements : List (String)

public structure Topology where
  id : String
  kind : String
  value : String
  owners : List (String)
  dependsOn : List (String)
  network : Option (String)
  port : Option (UInt16)
  protocol : Option (String)
  publiclyAccessible : Bool
  mountPath : Option (String)
  storageBytes : Option (UInt64)
  storageClass : Option (String)
  capabilities : List (String)
  isolation : String
  placement : Option (String)
  scaleMin : UInt32
  scaleMax : UInt32
  platformRequirements : List (String)

public structure Persistence where
  id : String
  owner : String
  schemaArtifact : String
  retention : String
  compatibilityWindow : String
  rpoSeconds : UInt64
  rtoSeconds : UInt64
  backup : String
  migrationOrder : List (String)

public structure Migration where
  id : String
  kind : String
  value : String
  dependsOn : List (String)

public structure BackupRecovery where
  id : String
  kind : String
  value : String
  dependsOn : List (String)

public structure TargetBinding where
  id : String
  kind : String
  apiVersion : String
  adapterDigest : String
  minimumReleaseStatus : String
  capabilities : List (String)
  credentials : Option (String)
  platformRequirements : List (String)
  storageClass : Option (String)
  storageProfile : Option (String)
  ingressClassName : Option (String)
  ingressControllerArtifact : Option (String)

end PrismPM.Production.Runtime
