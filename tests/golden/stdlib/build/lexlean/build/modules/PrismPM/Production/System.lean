module
public import Init
public import PrismPM.Production.Core
public import PrismPM.Production.Interface
public import PrismPM.Production.Operations
public import PrismPM.Production.Runtime
public import PrismPM.Production.Validation
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.System

public structure ModelTerm where
  id : String
  kind : String
  value : String
  dependsOn : List (String)

public structure Lifecycle where
  backup : String
  drift : String
  migration : String
  recovery : String
  retirement : String
  rollback : String
  rollout : String

public structure ApplicationErrorBinding where
  wireName : String
  modelName : String

public structure TransactionalCommandView where
  title : String
  heading : String
  identityHeading : String
  commandFormHeading : String
  historyHeading : String
  principalLabel : String
  principalDefault : String
  roleLabel : String
  submitterRoleLabel : String
  observerRoleLabel : String
  deniedRoleLabel : String
  authenticateLabel : String
  commandIdLabel : String
  inputALabel : String
  operationLabel : String
  inputBLabel : String
  annotationLabel : String
  submitLabel : String
  refreshLabel : String
  emptyText : String
  loadingText : String
  authenticatedText : String
  accessDeniedText : String
  retryLabel : String
  sequenceHeading : String
  commandColumnHeading : String
  inputSummaryHeading : String
  outcomeHeading : String
  annotationHeading : String
  releasePrefix : String
  historyLoadedText : String
  historyEmptyText : String
  authenticatingText : String
  authenticationFailedText : String
  submittingText : String
  outcomePrefix : String
  commandFailedText : String
  historyFailedText : String

public structure TransactionalCommandServiceProfile where
  contract : String
  applicationErrors : List (ApplicationErrorBinding)
  applicationModelDigest : String
  commandEncoding : String
  responseVersion : String
  optionalAnnotation : String
  coreArtifact : String
  identityAudience : String
  submitterRole : String
  observerRole : String
  eventSource : String
  acceptedEventType : String
  rejectedEventType : String
  databaseName : String
  databaseUser : String
  eventExchange : String
  auditQueue : String
  commandIdPattern : String
  commandPath : String
  tokenPath : String
  commandOperations : List (String)
  annotationMaxScalars : UInt32
  historyDefaultLimit : UInt32
  historyMaxLimit : UInt32
  maxRequestBytes : UInt64
  availabilityThresholdMillionths : UInt64
  outboxLagThresholdMillis : UInt64
  commandIdField : String
  operationField : String
  inputAField : String
  inputBField : String
  annotationField : String
  commandIdColumn : String
  operationColumn : String
  inputAColumn : String
  inputBColumn : String
  annotationColumn : String
  acceptanceErrorOperation : String
  acceptanceErrorInputA : String
  acceptanceErrorInputB : String
  acceptanceExpectedError : String
  acceptanceConflictInputB : String
  acceptanceSuccessOperation : String
  acceptanceSuccessInputA : String
  acceptanceSuccessInputB : String
  acceptanceExpectedResult : String
  view : TransactionalCommandView
  brokerUser : String
  historyTable : String
  outboxTable : String
  auditTable : String
  publicHostnameParameter : String

public structure SystemModel where
  product : PrismPM.Production.Core.Product
  artifacts : List (PrismPM.Production.Core.Artifact)
  components : List (PrismPM.Production.Core.Component)
  interfaces : List (PrismPM.Production.Interface.Interface)
  schemas : List (PrismPM.Production.Interface.Schema)
  calls : List (PrismPM.Production.Interface.Call)
  events : List (PrismPM.Production.Interface.Event)
  flows : List (PrismPM.Production.Interface.Flow)
  topology : List (PrismPM.Production.Runtime.Topology)
  platformRequirements : List (PrismPM.Production.Runtime.PlatformRequirement)
  scalingPolicies : List (PrismPM.Production.Runtime.ScalingPolicy)
  storageClasses : List (PrismPM.Production.Runtime.StorageClass)
  parameters : List (PrismPM.Production.Core.Configuration)
  secretReferences : List (PrismPM.Production.Core.SecretReference)
  identityRequirements : List (PrismPM.Production.Core.IdentityRequirement)
  persistence : List (PrismPM.Production.Runtime.Persistence)
  migrations : List (PrismPM.Production.Runtime.Migration)
  backups : List (PrismPM.Production.Runtime.BackupRecovery)
  observability : PrismPM.Production.Operations.Observability
  slis : List (PrismPM.Production.Operations.Sli)
  slos : List (PrismPM.Production.Operations.Slo)
  alerts : List (PrismPM.Production.Operations.Alert)
  controls : List (PrismPM.Production.Operations.Control)
  capabilities : List (PrismPM.Production.Core.Capability)
  architecture : List (PrismPM.Production.Operations.ArchitectureBinding)
  targets : List (PrismPM.Production.Runtime.TargetBinding)
  rollouts : List (PrismPM.Production.Operations.Rollout)
  rollbacks : List (PrismPM.Production.Operations.Rollback)
  drifts : List (PrismPM.Production.Operations.Drift)
  retirements : List (PrismPM.Production.Operations.Retirement)
  acceptance : List (PrismPM.Production.Operations.Acceptance)
  lifecycle : Lifecycle
  applicationProfile : TransactionalCommandServiceProfile
  standards : List (String)

public structure SystemManifest where
  closure : PrismPM.Production.Validation.ValidationRelation
  uniqueness : PrismPM.Production.Validation.ValidationRelation
  referentialIntegrity : PrismPM.Production.Validation.ValidationRelation
  compatibility : PrismPM.Production.Validation.ValidationRelation
  capabilitySatisfaction : PrismPM.Production.Validation.ValidationRelation
  secretFlow : PrismPM.Production.Validation.ValidationRelation
  deploymentOrder : PrismPM.Production.Validation.ValidationRelation
  migrationOrder : PrismPM.Production.Validation.ValidationRelation
  rollbackSafety : PrismPM.Production.Validation.ValidationRelation
  evidenceClosure : PrismPM.Production.Validation.ValidationRelation
  licenseClosure : PrismPM.Production.Validation.ValidationRelation
  releaseCompleteness : PrismPM.Production.Validation.ValidationRelation

@[expose] public def validateManifestClosure (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateClosure (((manifest).closure).bound) (((manifest).closure).values)

@[expose] public def validateManifestUniqueness (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateUniqueness (((manifest).uniqueness).values)

@[expose] public def validateManifestReferentialIntegrity (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateReferentialIntegrity (((manifest).referentialIntegrity).bound) (((manifest).referentialIntegrity).values)

@[expose] public def validateManifestCompatibility (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateCompatibility (((manifest).compatibility).bound) (((manifest).compatibility).values)

@[expose] public def validateManifestCapabilitySatisfaction (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateCapabilitySatisfaction (((manifest).capabilitySatisfaction).bound) (((manifest).capabilitySatisfaction).values)

@[expose] public def validateManifestSecretFlow (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateSecretFlow (((manifest).secretFlow).bound) (((manifest).secretFlow).values)

@[expose] public def validateManifestDeploymentOrder (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateDeploymentOrder (((manifest).deploymentOrder).values)

@[expose] public def validateManifestMigrationOrder (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateMigrationOrder (((manifest).migrationOrder).values)

@[expose] public def validateManifestRollbackSafety (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateRollbackSafety (((manifest).rollbackSafety).bound) (((manifest).rollbackSafety).values)

@[expose] public def validateManifestEvidenceClosure (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateEvidenceClosure (((manifest).evidenceClosure).bound) (((manifest).evidenceClosure).values)

@[expose] public def validateManifestLicenseClosure (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateLicenseClosure (((manifest).licenseClosure).values)

@[expose] public def validateManifestReleaseCompleteness (manifest : SystemManifest) : Bool := PrismPM.Production.Validation.validateReleaseCompleteness (((manifest).releaseCompleteness).values)

@[expose] public def validateManifest (manifest : SystemManifest) : Bool := (PrismPM.Production.Validation.validateClosure (((manifest).closure).bound) (((manifest).closure).values) && (PrismPM.Production.Validation.validateUniqueness (((manifest).uniqueness).values) && (PrismPM.Production.Validation.validateReferentialIntegrity (((manifest).referentialIntegrity).bound) (((manifest).referentialIntegrity).values) && (PrismPM.Production.Validation.validateCompatibility (((manifest).compatibility).bound) (((manifest).compatibility).values) && (PrismPM.Production.Validation.validateCapabilitySatisfaction (((manifest).capabilitySatisfaction).bound) (((manifest).capabilitySatisfaction).values) && (PrismPM.Production.Validation.validateSecretFlow (((manifest).secretFlow).bound) (((manifest).secretFlow).values) && (PrismPM.Production.Validation.validateDeploymentOrder (((manifest).deploymentOrder).values) && (PrismPM.Production.Validation.validateMigrationOrder (((manifest).migrationOrder).values) && (PrismPM.Production.Validation.validateRollbackSafety (((manifest).rollbackSafety).bound) (((manifest).rollbackSafety).values) && (PrismPM.Production.Validation.validateEvidenceClosure (((manifest).evidenceClosure).bound) (((manifest).evidenceClosure).values) && (PrismPM.Production.Validation.validateLicenseClosure (((manifest).licenseClosure).values) && PrismPM.Production.Validation.validateReleaseCompleteness (((manifest).releaseCompleteness).values))))))))))))

@[expose, reducible] public def manifestValid (manifest : SystemManifest) : Prop := (validateManifest (manifest) = true)

public theorem manifestValidation_sound_complete (manifest : SystemManifest) : ((validateManifest (manifest) = true) <-> manifestValid (manifest)) := by
  rfl

end PrismPM.Production.System
