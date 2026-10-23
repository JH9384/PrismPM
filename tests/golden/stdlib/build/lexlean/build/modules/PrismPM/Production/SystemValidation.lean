module
public import Init
public import LexLeanRuntime.Portable
public import PrismPM.Production.Core
public import PrismPM.Production.Interface
public import PrismPM.Production.Operations
public import PrismPM.Production.Runtime
public import PrismPM.Production.System
public import PrismPM.Production.Validation
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.SystemValidation

@[expose] public def optionalStringValues (value : Option (String)) : List (String) := (match value with | Option.none => ([] : List (String)) | Option.some present => (present :: ([] : List (String))))

@[expose] public def stringMember : (value : String) -> (values : List (String)) -> Bool
  | _value, List.nil => false
  | value, List.cons head rest => ((LexLeanRuntime.equal (value) (head) : Bool) || stringMember (value) (rest))

@[expose] public def allStringsMember : (values : List (String)) -> (allowed : List (String)) -> Bool
  | List.nil, _allowed => true
  | List.cons head rest, allowed => (stringMember (head) (allowed) && allStringsMember (rest) (allowed))

@[expose] public def anyStringMember : (values : List (String)) -> (allowed : List (String)) -> Bool
  | List.nil, _allowed => false
  | List.cons head rest, allowed => (stringMember (head) (allowed) || anyStringMember (rest) (allowed))

@[expose] public def uniqueStrings : (values : List (String)) -> Bool
  | List.nil => true
  | List.cons head rest => ((!stringMember (head) (rest)) && uniqueStrings (rest))

@[expose] public def natMember : (value : Nat) -> (values : List (Nat)) -> Bool
  | _value, List.nil => false
  | value, List.cons head rest => ((Nat.beq (value) (head)) || natMember (value) (rest))

@[expose] public def uniqueNats : (values : List (Nat)) -> Bool
  | List.nil => true
  | List.cons head rest => ((!natMember (head) (rest)) && uniqueNats (rest))

@[expose] public def nonEmptyString (value : String) : Bool := (!(LexLeanRuntime.equal (value) ("") : Bool))

@[expose] public def optionalStringMember (value : Option (String)) (allowed : List (String)) : Bool := (match value with | Option.none => true | Option.some present => stringMember (present) (allowed))

@[expose] public def idsAcceptance : (rows : List (PrismPM.Production.Operations.Acceptance)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsAcceptance (rest))

@[expose] public def idsAlerts : (rows : List (PrismPM.Production.Operations.Alert)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsAlerts (rest))

@[expose] public def idsArchitecture : (rows : List (PrismPM.Production.Operations.ArchitectureBinding)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsArchitecture (rest))

@[expose] public def idsArtifacts : (rows : List (PrismPM.Production.Core.Artifact)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsArtifacts (rest))

@[expose] public def idsBackups : (rows : List (PrismPM.Production.Runtime.BackupRecovery)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsBackups (rest))

@[expose] public def idsCalls : (rows : List (PrismPM.Production.Interface.Call)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsCalls (rest))

@[expose] public def idsCapabilities : (rows : List (PrismPM.Production.Core.Capability)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsCapabilities (rest))

@[expose] public def idsComponents : (rows : List (PrismPM.Production.Core.Component)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsComponents (rest))

@[expose] public def idsControls : (rows : List (PrismPM.Production.Operations.Control)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsControls (rest))

@[expose] public def idsDrifts : (rows : List (PrismPM.Production.Operations.Drift)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsDrifts (rest))

@[expose] public def idsEvents : (rows : List (PrismPM.Production.Interface.Event)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsEvents (rest))

@[expose] public def idsFlows : (rows : List (PrismPM.Production.Interface.Flow)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsFlows (rest))

@[expose] public def idsIdentityRequirements : (rows : List (PrismPM.Production.Core.IdentityRequirement)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsIdentityRequirements (rest))

@[expose] public def idsInterfaces : (rows : List (PrismPM.Production.Interface.Interface)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsInterfaces (rest))

@[expose] public def idsMigrations : (rows : List (PrismPM.Production.Runtime.Migration)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsMigrations (rest))

@[expose] public def idsParameters : (rows : List (PrismPM.Production.Core.Configuration)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsParameters (rest))

@[expose] public def idsPlatformRequirements : (rows : List (PrismPM.Production.Runtime.PlatformRequirement)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsPlatformRequirements (rest))

@[expose] public def idsPersistence : (rows : List (PrismPM.Production.Runtime.Persistence)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsPersistence (rest))

@[expose] public def idsRetirements : (rows : List (PrismPM.Production.Operations.Retirement)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsRetirements (rest))

@[expose] public def idsRollbacks : (rows : List (PrismPM.Production.Operations.Rollback)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsRollbacks (rest))

@[expose] public def idsRollouts : (rows : List (PrismPM.Production.Operations.Rollout)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsRollouts (rest))

@[expose] public def idsScalingPolicies : (rows : List (PrismPM.Production.Runtime.ScalingPolicy)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsScalingPolicies (rest))

@[expose] public def idsSchemas : (rows : List (PrismPM.Production.Interface.Schema)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsSchemas (rest))

@[expose] public def idsSlis : (rows : List (PrismPM.Production.Operations.Sli)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsSlis (rest))

@[expose] public def idsSlos : (rows : List (PrismPM.Production.Operations.Slo)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsSlos (rest))

@[expose] public def idsTargets : (rows : List (PrismPM.Production.Runtime.TargetBinding)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsTargets (rest))

@[expose] public def idsTopology : (rows : List (PrismPM.Production.Runtime.Topology)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsTopology (rest))

@[expose] public def idsStorageClasses : (rows : List (PrismPM.Production.Runtime.StorageClass)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsStorageClasses (rest))

@[expose] public def idsSecretReferences : (rows : List (PrismPM.Production.Core.SecretReference)) -> List (String)
  | List.nil => ([] : List (String))
  | List.cons row rest => ((row).id :: idsSecretReferences (rest))

@[expose] public def allModelIds (model : PrismPM.Production.System.SystemModel) : List (String) := (LexLeanRuntime.append (idsAcceptance ((model).acceptance)) ((LexLeanRuntime.append (idsAlerts ((model).alerts)) ((LexLeanRuntime.append (idsArchitecture ((model).architecture)) ((LexLeanRuntime.append (idsArtifacts ((model).artifacts)) ((LexLeanRuntime.append (idsBackups ((model).backups)) ((LexLeanRuntime.append (idsCalls ((model).calls)) ((LexLeanRuntime.append (idsCapabilities ((model).capabilities)) ((LexLeanRuntime.append (idsComponents ((model).components)) ((LexLeanRuntime.append (idsControls ((model).controls)) ((LexLeanRuntime.append (idsDrifts ((model).drifts)) ((LexLeanRuntime.append (idsEvents ((model).events)) ((LexLeanRuntime.append (idsFlows ((model).flows)) ((LexLeanRuntime.append (idsIdentityRequirements ((model).identityRequirements)) ((LexLeanRuntime.append (idsInterfaces ((model).interfaces)) ((LexLeanRuntime.append (idsMigrations ((model).migrations)) ((LexLeanRuntime.append (idsParameters ((model).parameters)) ((LexLeanRuntime.append (idsPlatformRequirements ((model).platformRequirements)) ((LexLeanRuntime.append (idsPersistence ((model).persistence)) ((LexLeanRuntime.append (idsRetirements ((model).retirements)) ((LexLeanRuntime.append (idsRollbacks ((model).rollbacks)) ((LexLeanRuntime.append (idsRollouts ((model).rollouts)) ((LexLeanRuntime.append (idsScalingPolicies ((model).scalingPolicies)) ((LexLeanRuntime.append (idsSchemas ((model).schemas)) ((LexLeanRuntime.append (idsSecretReferences ((model).secretReferences)) ((LexLeanRuntime.append (idsSlis ((model).slis)) ((LexLeanRuntime.append (idsSlos ((model).slos)) ((LexLeanRuntime.append (idsTargets ((model).targets)) ((LexLeanRuntime.append (idsTopology ((model).topology)) ((LexLeanRuntime.append (idsStorageClasses ((model).storageClasses)) (([] : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))) : List (String))

@[expose] public def memberIdAcceptance : (value : String) -> (rows : List (PrismPM.Production.Operations.Acceptance)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdAcceptance (value) (rest))

@[expose] public def allIdsMemberAcceptance : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Acceptance)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdAcceptance (head) (rows) && allIdsMemberAcceptance (rest) (rows))

@[expose] public def optionalIdMemberAcceptance (value : Option (String)) (rows : List (PrismPM.Production.Operations.Acceptance)) : Bool := (match value with | Option.none => true | Option.some present => memberIdAcceptance (present) (rows))

@[expose] public def countIdAcceptance : (value : String) -> (rows : List (PrismPM.Production.Operations.Acceptance)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdAcceptance (value) (rest))

@[expose] public def memberIdAlerts : (value : String) -> (rows : List (PrismPM.Production.Operations.Alert)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdAlerts (value) (rest))

@[expose] public def allIdsMemberAlerts : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Alert)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdAlerts (head) (rows) && allIdsMemberAlerts (rest) (rows))

@[expose] public def optionalIdMemberAlerts (value : Option (String)) (rows : List (PrismPM.Production.Operations.Alert)) : Bool := (match value with | Option.none => true | Option.some present => memberIdAlerts (present) (rows))

@[expose] public def countIdAlerts : (value : String) -> (rows : List (PrismPM.Production.Operations.Alert)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdAlerts (value) (rest))

@[expose] public def memberIdArchitecture : (value : String) -> (rows : List (PrismPM.Production.Operations.ArchitectureBinding)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdArchitecture (value) (rest))

@[expose] public def allIdsMemberArchitecture : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.ArchitectureBinding)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdArchitecture (head) (rows) && allIdsMemberArchitecture (rest) (rows))

@[expose] public def optionalIdMemberArchitecture (value : Option (String)) (rows : List (PrismPM.Production.Operations.ArchitectureBinding)) : Bool := (match value with | Option.none => true | Option.some present => memberIdArchitecture (present) (rows))

@[expose] public def countIdArchitecture : (value : String) -> (rows : List (PrismPM.Production.Operations.ArchitectureBinding)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdArchitecture (value) (rest))

@[expose] public def memberIdArtifacts : (value : String) -> (rows : List (PrismPM.Production.Core.Artifact)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdArtifacts (value) (rest))

@[expose] public def allIdsMemberArtifacts : (values : List (String)) -> (rows : List (PrismPM.Production.Core.Artifact)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdArtifacts (head) (rows) && allIdsMemberArtifacts (rest) (rows))

@[expose] public def optionalIdMemberArtifacts (value : Option (String)) (rows : List (PrismPM.Production.Core.Artifact)) : Bool := (match value with | Option.none => true | Option.some present => memberIdArtifacts (present) (rows))

@[expose] public def countIdArtifacts : (value : String) -> (rows : List (PrismPM.Production.Core.Artifact)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdArtifacts (value) (rest))

@[expose] public def memberIdBackups : (value : String) -> (rows : List (PrismPM.Production.Runtime.BackupRecovery)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdBackups (value) (rest))

@[expose] public def allIdsMemberBackups : (values : List (String)) -> (rows : List (PrismPM.Production.Runtime.BackupRecovery)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdBackups (head) (rows) && allIdsMemberBackups (rest) (rows))

@[expose] public def optionalIdMemberBackups (value : Option (String)) (rows : List (PrismPM.Production.Runtime.BackupRecovery)) : Bool := (match value with | Option.none => true | Option.some present => memberIdBackups (present) (rows))

@[expose] public def countIdBackups : (value : String) -> (rows : List (PrismPM.Production.Runtime.BackupRecovery)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdBackups (value) (rest))

@[expose] public def memberIdCalls : (value : String) -> (rows : List (PrismPM.Production.Interface.Call)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdCalls (value) (rest))

@[expose] public def allIdsMemberCalls : (values : List (String)) -> (rows : List (PrismPM.Production.Interface.Call)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdCalls (head) (rows) && allIdsMemberCalls (rest) (rows))

@[expose] public def optionalIdMemberCalls (value : Option (String)) (rows : List (PrismPM.Production.Interface.Call)) : Bool := (match value with | Option.none => true | Option.some present => memberIdCalls (present) (rows))

@[expose] public def countIdCalls : (value : String) -> (rows : List (PrismPM.Production.Interface.Call)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdCalls (value) (rest))

@[expose] public def memberIdCapabilities : (value : String) -> (rows : List (PrismPM.Production.Core.Capability)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdCapabilities (value) (rest))

@[expose] public def allIdsMemberCapabilities : (values : List (String)) -> (rows : List (PrismPM.Production.Core.Capability)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdCapabilities (head) (rows) && allIdsMemberCapabilities (rest) (rows))

@[expose] public def optionalIdMemberCapabilities (value : Option (String)) (rows : List (PrismPM.Production.Core.Capability)) : Bool := (match value with | Option.none => true | Option.some present => memberIdCapabilities (present) (rows))

@[expose] public def countIdCapabilities : (value : String) -> (rows : List (PrismPM.Production.Core.Capability)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdCapabilities (value) (rest))

@[expose] public def memberIdComponents : (value : String) -> (rows : List (PrismPM.Production.Core.Component)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdComponents (value) (rest))

@[expose] public def allIdsMemberComponents : (values : List (String)) -> (rows : List (PrismPM.Production.Core.Component)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdComponents (head) (rows) && allIdsMemberComponents (rest) (rows))

@[expose] public def optionalIdMemberComponents (value : Option (String)) (rows : List (PrismPM.Production.Core.Component)) : Bool := (match value with | Option.none => true | Option.some present => memberIdComponents (present) (rows))

@[expose] public def countIdComponents : (value : String) -> (rows : List (PrismPM.Production.Core.Component)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdComponents (value) (rest))

@[expose] public def memberIdControls : (value : String) -> (rows : List (PrismPM.Production.Operations.Control)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdControls (value) (rest))

@[expose] public def allIdsMemberControls : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Control)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdControls (head) (rows) && allIdsMemberControls (rest) (rows))

@[expose] public def optionalIdMemberControls (value : Option (String)) (rows : List (PrismPM.Production.Operations.Control)) : Bool := (match value with | Option.none => true | Option.some present => memberIdControls (present) (rows))

@[expose] public def countIdControls : (value : String) -> (rows : List (PrismPM.Production.Operations.Control)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdControls (value) (rest))

@[expose] public def memberIdDrifts : (value : String) -> (rows : List (PrismPM.Production.Operations.Drift)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdDrifts (value) (rest))

@[expose] public def allIdsMemberDrifts : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Drift)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdDrifts (head) (rows) && allIdsMemberDrifts (rest) (rows))

@[expose] public def optionalIdMemberDrifts (value : Option (String)) (rows : List (PrismPM.Production.Operations.Drift)) : Bool := (match value with | Option.none => true | Option.some present => memberIdDrifts (present) (rows))

@[expose] public def countIdDrifts : (value : String) -> (rows : List (PrismPM.Production.Operations.Drift)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdDrifts (value) (rest))

@[expose] public def memberIdEvents : (value : String) -> (rows : List (PrismPM.Production.Interface.Event)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdEvents (value) (rest))

@[expose] public def allIdsMemberEvents : (values : List (String)) -> (rows : List (PrismPM.Production.Interface.Event)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdEvents (head) (rows) && allIdsMemberEvents (rest) (rows))

@[expose] public def optionalIdMemberEvents (value : Option (String)) (rows : List (PrismPM.Production.Interface.Event)) : Bool := (match value with | Option.none => true | Option.some present => memberIdEvents (present) (rows))

@[expose] public def countIdEvents : (value : String) -> (rows : List (PrismPM.Production.Interface.Event)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdEvents (value) (rest))

@[expose] public def memberIdFlows : (value : String) -> (rows : List (PrismPM.Production.Interface.Flow)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdFlows (value) (rest))

@[expose] public def allIdsMemberFlows : (values : List (String)) -> (rows : List (PrismPM.Production.Interface.Flow)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdFlows (head) (rows) && allIdsMemberFlows (rest) (rows))

@[expose] public def optionalIdMemberFlows (value : Option (String)) (rows : List (PrismPM.Production.Interface.Flow)) : Bool := (match value with | Option.none => true | Option.some present => memberIdFlows (present) (rows))

@[expose] public def countIdFlows : (value : String) -> (rows : List (PrismPM.Production.Interface.Flow)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdFlows (value) (rest))

@[expose] public def memberIdIdentityRequirements : (value : String) -> (rows : List (PrismPM.Production.Core.IdentityRequirement)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdIdentityRequirements (value) (rest))

@[expose] public def allIdsMemberIdentityRequirements : (values : List (String)) -> (rows : List (PrismPM.Production.Core.IdentityRequirement)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdIdentityRequirements (head) (rows) && allIdsMemberIdentityRequirements (rest) (rows))

@[expose] public def optionalIdMemberIdentityRequirements (value : Option (String)) (rows : List (PrismPM.Production.Core.IdentityRequirement)) : Bool := (match value with | Option.none => true | Option.some present => memberIdIdentityRequirements (present) (rows))

@[expose] public def countIdIdentityRequirements : (value : String) -> (rows : List (PrismPM.Production.Core.IdentityRequirement)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdIdentityRequirements (value) (rest))

@[expose] public def memberIdInterfaces : (value : String) -> (rows : List (PrismPM.Production.Interface.Interface)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdInterfaces (value) (rest))

@[expose] public def allIdsMemberInterfaces : (values : List (String)) -> (rows : List (PrismPM.Production.Interface.Interface)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdInterfaces (head) (rows) && allIdsMemberInterfaces (rest) (rows))

@[expose] public def optionalIdMemberInterfaces (value : Option (String)) (rows : List (PrismPM.Production.Interface.Interface)) : Bool := (match value with | Option.none => true | Option.some present => memberIdInterfaces (present) (rows))

@[expose] public def countIdInterfaces : (value : String) -> (rows : List (PrismPM.Production.Interface.Interface)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdInterfaces (value) (rest))

@[expose] public def memberIdMigrations : (value : String) -> (rows : List (PrismPM.Production.Runtime.Migration)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdMigrations (value) (rest))

@[expose] public def allIdsMemberMigrations : (values : List (String)) -> (rows : List (PrismPM.Production.Runtime.Migration)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdMigrations (head) (rows) && allIdsMemberMigrations (rest) (rows))

@[expose] public def anyIdsMemberMigrations : (values : List (String)) -> (rows : List (PrismPM.Production.Runtime.Migration)) -> Bool
  | List.nil, _rows => false
  | List.cons head rest, rows => (memberIdMigrations (head) (rows) || anyIdsMemberMigrations (rest) (rows))

@[expose] public def optionalIdMemberMigrations (value : Option (String)) (rows : List (PrismPM.Production.Runtime.Migration)) : Bool := (match value with | Option.none => true | Option.some present => memberIdMigrations (present) (rows))

@[expose] public def countIdMigrations : (value : String) -> (rows : List (PrismPM.Production.Runtime.Migration)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdMigrations (value) (rest))

@[expose] public def memberIdParameters : (value : String) -> (rows : List (PrismPM.Production.Core.Configuration)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdParameters (value) (rest))

@[expose] public def allIdsMemberParameters : (values : List (String)) -> (rows : List (PrismPM.Production.Core.Configuration)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdParameters (head) (rows) && allIdsMemberParameters (rest) (rows))

@[expose] public def optionalIdMemberParameters (value : Option (String)) (rows : List (PrismPM.Production.Core.Configuration)) : Bool := (match value with | Option.none => true | Option.some present => memberIdParameters (present) (rows))

@[expose] public def countIdParameters : (value : String) -> (rows : List (PrismPM.Production.Core.Configuration)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdParameters (value) (rest))

@[expose] public def memberIdPersistence : (value : String) -> (rows : List (PrismPM.Production.Runtime.Persistence)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdPersistence (value) (rest))

@[expose] public def allIdsMemberPersistence : (values : List (String)) -> (rows : List (PrismPM.Production.Runtime.Persistence)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdPersistence (head) (rows) && allIdsMemberPersistence (rest) (rows))

@[expose] public def optionalIdMemberPersistence (value : Option (String)) (rows : List (PrismPM.Production.Runtime.Persistence)) : Bool := (match value with | Option.none => true | Option.some present => memberIdPersistence (present) (rows))

@[expose] public def countIdPersistence : (value : String) -> (rows : List (PrismPM.Production.Runtime.Persistence)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdPersistence (value) (rest))

@[expose] public def memberIdPlatformRequirements : (value : String) -> (rows : List (PrismPM.Production.Runtime.PlatformRequirement)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdPlatformRequirements (value) (rest))

@[expose] public def allIdsMemberPlatformRequirements : (values : List (String)) -> (rows : List (PrismPM.Production.Runtime.PlatformRequirement)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdPlatformRequirements (head) (rows) && allIdsMemberPlatformRequirements (rest) (rows))

@[expose] public def optionalIdMemberPlatformRequirements (value : Option (String)) (rows : List (PrismPM.Production.Runtime.PlatformRequirement)) : Bool := (match value with | Option.none => true | Option.some present => memberIdPlatformRequirements (present) (rows))

@[expose] public def countIdPlatformRequirements : (value : String) -> (rows : List (PrismPM.Production.Runtime.PlatformRequirement)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdPlatformRequirements (value) (rest))

@[expose] public def memberIdRetirements : (value : String) -> (rows : List (PrismPM.Production.Operations.Retirement)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdRetirements (value) (rest))

@[expose] public def allIdsMemberRetirements : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Retirement)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdRetirements (head) (rows) && allIdsMemberRetirements (rest) (rows))

@[expose] public def optionalIdMemberRetirements (value : Option (String)) (rows : List (PrismPM.Production.Operations.Retirement)) : Bool := (match value with | Option.none => true | Option.some present => memberIdRetirements (present) (rows))

@[expose] public def countIdRetirements : (value : String) -> (rows : List (PrismPM.Production.Operations.Retirement)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdRetirements (value) (rest))

@[expose] public def memberIdRollbacks : (value : String) -> (rows : List (PrismPM.Production.Operations.Rollback)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdRollbacks (value) (rest))

@[expose] public def allIdsMemberRollbacks : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Rollback)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdRollbacks (head) (rows) && allIdsMemberRollbacks (rest) (rows))

@[expose] public def optionalIdMemberRollbacks (value : Option (String)) (rows : List (PrismPM.Production.Operations.Rollback)) : Bool := (match value with | Option.none => true | Option.some present => memberIdRollbacks (present) (rows))

@[expose] public def countIdRollbacks : (value : String) -> (rows : List (PrismPM.Production.Operations.Rollback)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdRollbacks (value) (rest))

@[expose] public def memberIdRollouts : (value : String) -> (rows : List (PrismPM.Production.Operations.Rollout)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdRollouts (value) (rest))

@[expose] public def allIdsMemberRollouts : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Rollout)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdRollouts (head) (rows) && allIdsMemberRollouts (rest) (rows))

@[expose] public def anyIdsMemberRollouts : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Rollout)) -> Bool
  | List.nil, _rows => false
  | List.cons head rest, rows => (memberIdRollouts (head) (rows) || anyIdsMemberRollouts (rest) (rows))

@[expose] public def optionalIdMemberRollouts (value : Option (String)) (rows : List (PrismPM.Production.Operations.Rollout)) : Bool := (match value with | Option.none => true | Option.some present => memberIdRollouts (present) (rows))

@[expose] public def countIdRollouts : (value : String) -> (rows : List (PrismPM.Production.Operations.Rollout)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdRollouts (value) (rest))

@[expose] public def memberIdScalingPolicies : (value : String) -> (rows : List (PrismPM.Production.Runtime.ScalingPolicy)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdScalingPolicies (value) (rest))

@[expose] public def allIdsMemberScalingPolicies : (values : List (String)) -> (rows : List (PrismPM.Production.Runtime.ScalingPolicy)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdScalingPolicies (head) (rows) && allIdsMemberScalingPolicies (rest) (rows))

@[expose] public def optionalIdMemberScalingPolicies (value : Option (String)) (rows : List (PrismPM.Production.Runtime.ScalingPolicy)) : Bool := (match value with | Option.none => true | Option.some present => memberIdScalingPolicies (present) (rows))

@[expose] public def countIdScalingPolicies : (value : String) -> (rows : List (PrismPM.Production.Runtime.ScalingPolicy)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdScalingPolicies (value) (rest))

@[expose] public def memberIdSchemas : (value : String) -> (rows : List (PrismPM.Production.Interface.Schema)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdSchemas (value) (rest))

@[expose] public def allIdsMemberSchemas : (values : List (String)) -> (rows : List (PrismPM.Production.Interface.Schema)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdSchemas (head) (rows) && allIdsMemberSchemas (rest) (rows))

@[expose] public def optionalIdMemberSchemas (value : Option (String)) (rows : List (PrismPM.Production.Interface.Schema)) : Bool := (match value with | Option.none => true | Option.some present => memberIdSchemas (present) (rows))

@[expose] public def countIdSchemas : (value : String) -> (rows : List (PrismPM.Production.Interface.Schema)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdSchemas (value) (rest))

@[expose] public def memberIdSecretReferences : (value : String) -> (rows : List (PrismPM.Production.Core.SecretReference)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdSecretReferences (value) (rest))

@[expose] public def allIdsMemberSecretReferences : (values : List (String)) -> (rows : List (PrismPM.Production.Core.SecretReference)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdSecretReferences (head) (rows) && allIdsMemberSecretReferences (rest) (rows))

@[expose] public def optionalIdMemberSecretReferences (value : Option (String)) (rows : List (PrismPM.Production.Core.SecretReference)) : Bool := (match value with | Option.none => true | Option.some present => memberIdSecretReferences (present) (rows))

@[expose] public def countIdSecretReferences : (value : String) -> (rows : List (PrismPM.Production.Core.SecretReference)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdSecretReferences (value) (rest))

@[expose] public def memberIdSlis : (value : String) -> (rows : List (PrismPM.Production.Operations.Sli)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdSlis (value) (rest))

@[expose] public def allIdsMemberSlis : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Sli)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdSlis (head) (rows) && allIdsMemberSlis (rest) (rows))

@[expose] public def optionalIdMemberSlis (value : Option (String)) (rows : List (PrismPM.Production.Operations.Sli)) : Bool := (match value with | Option.none => true | Option.some present => memberIdSlis (present) (rows))

@[expose] public def countIdSlis : (value : String) -> (rows : List (PrismPM.Production.Operations.Sli)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdSlis (value) (rest))

@[expose] public def memberIdSlos : (value : String) -> (rows : List (PrismPM.Production.Operations.Slo)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdSlos (value) (rest))

@[expose] public def allIdsMemberSlos : (values : List (String)) -> (rows : List (PrismPM.Production.Operations.Slo)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdSlos (head) (rows) && allIdsMemberSlos (rest) (rows))

@[expose] public def optionalIdMemberSlos (value : Option (String)) (rows : List (PrismPM.Production.Operations.Slo)) : Bool := (match value with | Option.none => true | Option.some present => memberIdSlos (present) (rows))

@[expose] public def countIdSlos : (value : String) -> (rows : List (PrismPM.Production.Operations.Slo)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdSlos (value) (rest))

@[expose] public def memberIdStorageClasses : (value : String) -> (rows : List (PrismPM.Production.Runtime.StorageClass)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdStorageClasses (value) (rest))

@[expose] public def allIdsMemberStorageClasses : (values : List (String)) -> (rows : List (PrismPM.Production.Runtime.StorageClass)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdStorageClasses (head) (rows) && allIdsMemberStorageClasses (rest) (rows))

@[expose] public def optionalIdMemberStorageClasses (value : Option (String)) (rows : List (PrismPM.Production.Runtime.StorageClass)) : Bool := (match value with | Option.none => true | Option.some present => memberIdStorageClasses (present) (rows))

@[expose] public def countIdStorageClasses : (value : String) -> (rows : List (PrismPM.Production.Runtime.StorageClass)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdStorageClasses (value) (rest))

@[expose] public def memberIdTargets : (value : String) -> (rows : List (PrismPM.Production.Runtime.TargetBinding)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdTargets (value) (rest))

@[expose] public def allIdsMemberTargets : (values : List (String)) -> (rows : List (PrismPM.Production.Runtime.TargetBinding)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdTargets (head) (rows) && allIdsMemberTargets (rest) (rows))

@[expose] public def optionalIdMemberTargets (value : Option (String)) (rows : List (PrismPM.Production.Runtime.TargetBinding)) : Bool := (match value with | Option.none => true | Option.some present => memberIdTargets (present) (rows))

@[expose] public def countIdTargets : (value : String) -> (rows : List (PrismPM.Production.Runtime.TargetBinding)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdTargets (value) (rest))

@[expose] public def memberIdTopology : (value : String) -> (rows : List (PrismPM.Production.Runtime.Topology)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((LexLeanRuntime.equal (value) ((row).id) : Bool) || memberIdTopology (value) (rest))

@[expose] public def allIdsMemberTopology : (values : List (String)) -> (rows : List (PrismPM.Production.Runtime.Topology)) -> Bool
  | List.nil, _rows => true
  | List.cons head rest, rows => (memberIdTopology (head) (rows) && allIdsMemberTopology (rest) (rows))

@[expose] public def optionalIdMemberTopology (value : Option (String)) (rows : List (PrismPM.Production.Runtime.Topology)) : Bool := (match value with | Option.none => true | Option.some present => memberIdTopology (present) (rows))

@[expose] public def countIdTopology : (value : String) -> (rows : List (PrismPM.Production.Runtime.Topology)) -> Nat
  | _value, List.nil => 0
  | value, List.cons row rest => ((match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + countIdTopology (value) (rest))

@[expose] public def modelHasIdGroup0 (value : String) (model : PrismPM.Production.System.SystemModel) : Bool := (memberIdAcceptance (value) ((model).acceptance) || (memberIdAlerts (value) ((model).alerts) || (memberIdArchitecture (value) ((model).architecture) || (memberIdArtifacts (value) ((model).artifacts) || memberIdBackups (value) ((model).backups)))))

@[expose] public def modelIdCountGroup0 (value : String) (model : PrismPM.Production.System.SystemModel) : Nat := (countIdAcceptance (value) ((model).acceptance) + (countIdAlerts (value) ((model).alerts) + (countIdArchitecture (value) ((model).architecture) + (countIdArtifacts (value) ((model).artifacts) + countIdBackups (value) ((model).backups)))))

@[expose] public def modelEntityCountGroup0 (model : PrismPM.Production.System.SystemModel) : Nat := ((LexLeanRuntime.length ((model).acceptance) : Nat) + ((LexLeanRuntime.length ((model).alerts) : Nat) + ((LexLeanRuntime.length ((model).architecture) : Nat) + ((LexLeanRuntime.length ((model).artifacts) : Nat) + (LexLeanRuntime.length ((model).backups) : Nat)))))

@[expose] public def modelHasIdGroup1 (value : String) (model : PrismPM.Production.System.SystemModel) : Bool := (memberIdCalls (value) ((model).calls) || (memberIdCapabilities (value) ((model).capabilities) || (memberIdComponents (value) ((model).components) || (memberIdControls (value) ((model).controls) || memberIdDrifts (value) ((model).drifts)))))

@[expose] public def modelIdCountGroup1 (value : String) (model : PrismPM.Production.System.SystemModel) : Nat := (countIdCalls (value) ((model).calls) + (countIdCapabilities (value) ((model).capabilities) + (countIdComponents (value) ((model).components) + (countIdControls (value) ((model).controls) + countIdDrifts (value) ((model).drifts)))))

@[expose] public def modelEntityCountGroup1 (model : PrismPM.Production.System.SystemModel) : Nat := ((LexLeanRuntime.length ((model).calls) : Nat) + ((LexLeanRuntime.length ((model).capabilities) : Nat) + ((LexLeanRuntime.length ((model).components) : Nat) + ((LexLeanRuntime.length ((model).controls) : Nat) + (LexLeanRuntime.length ((model).drifts) : Nat)))))

@[expose] public def modelHasIdGroup2 (value : String) (model : PrismPM.Production.System.SystemModel) : Bool := (memberIdEvents (value) ((model).events) || (memberIdFlows (value) ((model).flows) || (memberIdIdentityRequirements (value) ((model).identityRequirements) || (memberIdInterfaces (value) ((model).interfaces) || memberIdMigrations (value) ((model).migrations)))))

@[expose] public def modelIdCountGroup2 (value : String) (model : PrismPM.Production.System.SystemModel) : Nat := (countIdEvents (value) ((model).events) + (countIdFlows (value) ((model).flows) + (countIdIdentityRequirements (value) ((model).identityRequirements) + (countIdInterfaces (value) ((model).interfaces) + countIdMigrations (value) ((model).migrations)))))

@[expose] public def modelEntityCountGroup2 (model : PrismPM.Production.System.SystemModel) : Nat := ((LexLeanRuntime.length ((model).events) : Nat) + ((LexLeanRuntime.length ((model).flows) : Nat) + ((LexLeanRuntime.length ((model).identityRequirements) : Nat) + ((LexLeanRuntime.length ((model).interfaces) : Nat) + (LexLeanRuntime.length ((model).migrations) : Nat)))))

@[expose] public def modelHasIdGroup3 (value : String) (model : PrismPM.Production.System.SystemModel) : Bool := (memberIdParameters (value) ((model).parameters) || (memberIdPersistence (value) ((model).persistence) || (memberIdPlatformRequirements (value) ((model).platformRequirements) || (memberIdRetirements (value) ((model).retirements) || memberIdRollbacks (value) ((model).rollbacks)))))

@[expose] public def modelIdCountGroup3 (value : String) (model : PrismPM.Production.System.SystemModel) : Nat := (countIdParameters (value) ((model).parameters) + (countIdPersistence (value) ((model).persistence) + (countIdPlatformRequirements (value) ((model).platformRequirements) + (countIdRetirements (value) ((model).retirements) + countIdRollbacks (value) ((model).rollbacks)))))

@[expose] public def modelEntityCountGroup3 (model : PrismPM.Production.System.SystemModel) : Nat := ((LexLeanRuntime.length ((model).parameters) : Nat) + ((LexLeanRuntime.length ((model).persistence) : Nat) + ((LexLeanRuntime.length ((model).platformRequirements) : Nat) + ((LexLeanRuntime.length ((model).retirements) : Nat) + (LexLeanRuntime.length ((model).rollbacks) : Nat)))))

@[expose] public def modelHasIdGroup4 (value : String) (model : PrismPM.Production.System.SystemModel) : Bool := (memberIdRollouts (value) ((model).rollouts) || (memberIdScalingPolicies (value) ((model).scalingPolicies) || (memberIdSchemas (value) ((model).schemas) || (memberIdSecretReferences (value) ((model).secretReferences) || memberIdSlis (value) ((model).slis)))))

@[expose] public def modelIdCountGroup4 (value : String) (model : PrismPM.Production.System.SystemModel) : Nat := (countIdRollouts (value) ((model).rollouts) + (countIdScalingPolicies (value) ((model).scalingPolicies) + (countIdSchemas (value) ((model).schemas) + (countIdSecretReferences (value) ((model).secretReferences) + countIdSlis (value) ((model).slis)))))

@[expose] public def modelEntityCountGroup4 (model : PrismPM.Production.System.SystemModel) : Nat := ((LexLeanRuntime.length ((model).rollouts) : Nat) + ((LexLeanRuntime.length ((model).scalingPolicies) : Nat) + ((LexLeanRuntime.length ((model).schemas) : Nat) + ((LexLeanRuntime.length ((model).secretReferences) : Nat) + (LexLeanRuntime.length ((model).slis) : Nat)))))

@[expose] public def modelHasIdGroup5 (value : String) (model : PrismPM.Production.System.SystemModel) : Bool := (memberIdSlos (value) ((model).slos) || (memberIdStorageClasses (value) ((model).storageClasses) || (memberIdTargets (value) ((model).targets) || memberIdTopology (value) ((model).topology))))

@[expose] public def modelIdCountGroup5 (value : String) (model : PrismPM.Production.System.SystemModel) : Nat := (countIdSlos (value) ((model).slos) + (countIdStorageClasses (value) ((model).storageClasses) + (countIdTargets (value) ((model).targets) + countIdTopology (value) ((model).topology))))

@[expose] public def modelEntityCountGroup5 (model : PrismPM.Production.System.SystemModel) : Nat := ((LexLeanRuntime.length ((model).slos) : Nat) + ((LexLeanRuntime.length ((model).storageClasses) : Nat) + ((LexLeanRuntime.length ((model).targets) : Nat) + (LexLeanRuntime.length ((model).topology) : Nat))))

@[expose] public def modelHasId (value : String) (model : PrismPM.Production.System.SystemModel) : Bool := ((LexLeanRuntime.equal (value) (((model).product).id) : Bool) || (modelHasIdGroup0 (value) (model) || (modelHasIdGroup1 (value) (model) || (modelHasIdGroup2 (value) (model) || (modelHasIdGroup3 (value) (model) || (modelHasIdGroup4 (value) (model) || modelHasIdGroup5 (value) (model)))))))

@[expose] public def modelIdCount (value : String) (model : PrismPM.Production.System.SystemModel) : Nat := ((match (LexLeanRuntime.equal (value) (((model).product).id) : Bool) with | Bool.false => 0 | Bool.true => 1) + (modelIdCountGroup0 (value) (model) + (modelIdCountGroup1 (value) (model) + (modelIdCountGroup2 (value) (model) + (modelIdCountGroup3 (value) (model) + (modelIdCountGroup4 (value) (model) + modelIdCountGroup5 (value) (model)))))))

@[expose] public def modelEntityCount (model : PrismPM.Production.System.SystemModel) : Nat := (1 + (modelEntityCountGroup0 (model) + (modelEntityCountGroup1 (model) + (modelEntityCountGroup2 (model) + (modelEntityCountGroup3 (model) + (modelEntityCountGroup4 (model) + modelEntityCountGroup5 (model)))))))

@[expose] public def idsGloballyUniqueAcceptance : (rows : List (PrismPM.Production.Operations.Acceptance)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueAcceptance (rest) (model))

@[expose] public def idsGloballyUniqueAlerts : (rows : List (PrismPM.Production.Operations.Alert)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueAlerts (rest) (model))

@[expose] public def idsGloballyUniqueArchitecture : (rows : List (PrismPM.Production.Operations.ArchitectureBinding)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueArchitecture (rest) (model))

@[expose] public def idsGloballyUniqueArtifacts : (rows : List (PrismPM.Production.Core.Artifact)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueArtifacts (rest) (model))

@[expose] public def idsGloballyUniqueBackups : (rows : List (PrismPM.Production.Runtime.BackupRecovery)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueBackups (rest) (model))

@[expose] public def idsGloballyUniqueCalls : (rows : List (PrismPM.Production.Interface.Call)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueCalls (rest) (model))

@[expose] public def idsGloballyUniqueCapabilities : (rows : List (PrismPM.Production.Core.Capability)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueCapabilities (rest) (model))

@[expose] public def idsGloballyUniqueComponents : (rows : List (PrismPM.Production.Core.Component)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueComponents (rest) (model))

@[expose] public def idsGloballyUniqueControls : (rows : List (PrismPM.Production.Operations.Control)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueControls (rest) (model))

@[expose] public def idsGloballyUniqueDrifts : (rows : List (PrismPM.Production.Operations.Drift)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueDrifts (rest) (model))

@[expose] public def idsGloballyUniqueEvents : (rows : List (PrismPM.Production.Interface.Event)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueEvents (rest) (model))

@[expose] public def idsGloballyUniqueFlows : (rows : List (PrismPM.Production.Interface.Flow)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueFlows (rest) (model))

@[expose] public def idsGloballyUniqueIdentityRequirements : (rows : List (PrismPM.Production.Core.IdentityRequirement)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueIdentityRequirements (rest) (model))

@[expose] public def idsGloballyUniqueInterfaces : (rows : List (PrismPM.Production.Interface.Interface)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueInterfaces (rest) (model))

@[expose] public def idsGloballyUniqueMigrations : (rows : List (PrismPM.Production.Runtime.Migration)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueMigrations (rest) (model))

@[expose] public def idsGloballyUniqueParameters : (rows : List (PrismPM.Production.Core.Configuration)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueParameters (rest) (model))

@[expose] public def idsGloballyUniquePersistence : (rows : List (PrismPM.Production.Runtime.Persistence)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniquePersistence (rest) (model))

@[expose] public def idsGloballyUniquePlatformRequirements : (rows : List (PrismPM.Production.Runtime.PlatformRequirement)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniquePlatformRequirements (rest) (model))

@[expose] public def idsGloballyUniqueRetirements : (rows : List (PrismPM.Production.Operations.Retirement)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueRetirements (rest) (model))

@[expose] public def idsGloballyUniqueRollbacks : (rows : List (PrismPM.Production.Operations.Rollback)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueRollbacks (rest) (model))

@[expose] public def idsGloballyUniqueRollouts : (rows : List (PrismPM.Production.Operations.Rollout)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueRollouts (rest) (model))

@[expose] public def idsGloballyUniqueScalingPolicies : (rows : List (PrismPM.Production.Runtime.ScalingPolicy)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueScalingPolicies (rest) (model))

@[expose] public def idsGloballyUniqueSchemas : (rows : List (PrismPM.Production.Interface.Schema)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueSchemas (rest) (model))

@[expose] public def idsGloballyUniqueSecretReferences : (rows : List (PrismPM.Production.Core.SecretReference)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueSecretReferences (rest) (model))

@[expose] public def idsGloballyUniqueSlis : (rows : List (PrismPM.Production.Operations.Sli)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueSlis (rest) (model))

@[expose] public def idsGloballyUniqueSlos : (rows : List (PrismPM.Production.Operations.Slo)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueSlos (rest) (model))

@[expose] public def idsGloballyUniqueStorageClasses : (rows : List (PrismPM.Production.Runtime.StorageClass)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueStorageClasses (rest) (model))

@[expose] public def idsGloballyUniqueTargets : (rows : List (PrismPM.Production.Runtime.TargetBinding)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueTargets (rest) (model))

@[expose] public def idsGloballyUniqueTopology : (rows : List (PrismPM.Production.Runtime.Topology)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => ((Nat.beq (modelIdCount ((row).id) (model)) (1)) && idsGloballyUniqueTopology (rest) (model))

@[expose] public def modelIdsGloballyUniqueGroup0 (model : PrismPM.Production.System.SystemModel) : Bool := (idsGloballyUniqueAcceptance ((model).acceptance) (model) && (idsGloballyUniqueAlerts ((model).alerts) (model) && (idsGloballyUniqueArchitecture ((model).architecture) (model) && (idsGloballyUniqueArtifacts ((model).artifacts) (model) && idsGloballyUniqueBackups ((model).backups) (model)))))

@[expose] public def modelIdsGloballyUniqueGroup1 (model : PrismPM.Production.System.SystemModel) : Bool := (idsGloballyUniqueCalls ((model).calls) (model) && (idsGloballyUniqueCapabilities ((model).capabilities) (model) && (idsGloballyUniqueComponents ((model).components) (model) && (idsGloballyUniqueControls ((model).controls) (model) && idsGloballyUniqueDrifts ((model).drifts) (model)))))

@[expose] public def modelIdsGloballyUniqueGroup2 (model : PrismPM.Production.System.SystemModel) : Bool := (idsGloballyUniqueEvents ((model).events) (model) && (idsGloballyUniqueFlows ((model).flows) (model) && (idsGloballyUniqueIdentityRequirements ((model).identityRequirements) (model) && (idsGloballyUniqueInterfaces ((model).interfaces) (model) && idsGloballyUniqueMigrations ((model).migrations) (model)))))

@[expose] public def modelIdsGloballyUniqueGroup3 (model : PrismPM.Production.System.SystemModel) : Bool := (idsGloballyUniqueParameters ((model).parameters) (model) && (idsGloballyUniquePersistence ((model).persistence) (model) && (idsGloballyUniquePlatformRequirements ((model).platformRequirements) (model) && (idsGloballyUniqueRetirements ((model).retirements) (model) && idsGloballyUniqueRollbacks ((model).rollbacks) (model)))))

@[expose] public def modelIdsGloballyUniqueGroup4 (model : PrismPM.Production.System.SystemModel) : Bool := (idsGloballyUniqueRollouts ((model).rollouts) (model) && (idsGloballyUniqueScalingPolicies ((model).scalingPolicies) (model) && (idsGloballyUniqueSchemas ((model).schemas) (model) && (idsGloballyUniqueSecretReferences ((model).secretReferences) (model) && idsGloballyUniqueSlis ((model).slis) (model)))))

@[expose] public def modelIdsGloballyUniqueGroup5 (model : PrismPM.Production.System.SystemModel) : Bool := (idsGloballyUniqueSlos ((model).slos) (model) && (idsGloballyUniqueStorageClasses ((model).storageClasses) (model) && (idsGloballyUniqueTargets ((model).targets) (model) && idsGloballyUniqueTopology ((model).topology) (model))))

@[expose] public def modelIdsGloballyUnique (model : PrismPM.Production.System.SystemModel) : Bool := ((Nat.beq (modelIdCount (((model).product).id) (model)) (1)) && (modelIdsGloballyUniqueGroup0 (model) && (modelIdsGloballyUniqueGroup1 (model) && (modelIdsGloballyUniqueGroup2 (model) && (modelIdsGloballyUniqueGroup3 (model) && (modelIdsGloballyUniqueGroup4 (model) && modelIdsGloballyUniqueGroup5 (model)))))))

@[expose] public def allStringsModelMember : (values : List (String)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons head rest, model => (modelHasId (head) (model) && allStringsModelMember (rest) (model))

@[expose] public def optionalStringModelMember (value : Option (String)) (model : PrismPM.Production.System.SystemModel) : Bool := (match value with | Option.none => true | Option.some present => modelHasId (present) (model))

@[expose] public def natIndex : (value : Nat) -> (values : List (Nat)) -> (position : Nat) -> Option (Nat)
  | _value, List.nil, _position => Option.none
  | value, List.cons head rest, position => (match (Nat.beq (value) (head)) with | Bool.false => natIndex (value) (rest) ((position + 1)) | Bool.true => Option.some (position))

@[expose] public def directComponentIndex : (value : String) -> (rows : List (PrismPM.Production.Core.Component)) -> (position : Nat) -> Option (Nat)
  | _value, List.nil, _position => Option.none
  | value, List.cons row rest, position => (match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => directComponentIndex (value) (rest) ((position + 1)) | Bool.true => Option.some (position))

@[expose] public def directComponentIndexPrecedes (dependency : String) (current : String) (rows : List (PrismPM.Production.Core.Component)) (order : List (Nat)) : Bool := (match directComponentIndex (dependency) (rows) (0) with | Option.none => false | Option.some dependencyIndex => (match directComponentIndex (current) (rows) (0) with | Option.none => false | Option.some currentIndex => (match natIndex (dependencyIndex) (order) (0) with | Option.none => false | Option.some dependencyPosition => (match natIndex (currentIndex) (order) (0) with | Option.none => false | Option.some currentPosition => (Nat.blt (dependencyPosition) (currentPosition))))))

@[expose] public def directComponentDependenciesPrecede : (dependencies : List (String)) -> (current : String) -> (rows : List (PrismPM.Production.Core.Component)) -> (order : List (Nat)) -> Bool
  | List.nil, _current, _rows, _order => true
  | List.cons dependency rest, current, rows, order => (directComponentIndexPrecedes (dependency) (current) (rows) (order) && directComponentDependenciesPrecede (rest) (current) (rows) (order))

@[expose] public def directComponentOrderValid : (rows : List (PrismPM.Production.Core.Component)) -> (allRows : List (PrismPM.Production.Core.Component)) -> (order : List (Nat)) -> Bool
  | List.nil, _allRows, _order => true
  | List.cons row rest, allRows, order => (directComponentDependenciesPrecede ((row).dependsOn) ((row).id) (allRows) (order) && directComponentOrderValid (rest) (allRows) (order))

@[expose] public def directMigrationIndex : (value : String) -> (rows : List (PrismPM.Production.Runtime.Migration)) -> (position : Nat) -> Option (Nat)
  | _value, List.nil, _position => Option.none
  | value, List.cons row rest, position => (match (LexLeanRuntime.equal (value) ((row).id) : Bool) with | Bool.false => directMigrationIndex (value) (rest) ((position + 1)) | Bool.true => Option.some (position))

@[expose] public def directMigrationIndexPrecedes (dependency : String) (current : String) (rows : List (PrismPM.Production.Runtime.Migration)) (order : List (Nat)) : Bool := (match directMigrationIndex (dependency) (rows) (0) with | Option.none => false | Option.some dependencyIndex => (match directMigrationIndex (current) (rows) (0) with | Option.none => false | Option.some currentIndex => (match natIndex (dependencyIndex) (order) (0) with | Option.none => false | Option.some dependencyPosition => (match natIndex (currentIndex) (order) (0) with | Option.none => false | Option.some currentPosition => (Nat.blt (dependencyPosition) (currentPosition))))))

@[expose] public def directMigrationDependenciesPrecede : (dependencies : List (String)) -> (current : String) -> (rows : List (PrismPM.Production.Runtime.Migration)) -> (order : List (Nat)) -> Bool
  | List.nil, _current, _rows, _order => true
  | List.cons dependency rest, current, rows, order => ((match memberIdMigrations (dependency) (rows) with | Bool.false => true | Bool.true => directMigrationIndexPrecedes (dependency) (current) (rows) (order)) && directMigrationDependenciesPrecede (rest) (current) (rows) (order))

@[expose] public def directMigrationOrderValid : (rows : List (PrismPM.Production.Runtime.Migration)) -> (allRows : List (PrismPM.Production.Runtime.Migration)) -> (order : List (Nat)) -> Bool
  | List.nil, _allRows, _order => true
  | List.cons row rest, allRows, order => (directMigrationDependenciesPrecede ((row).dependsOn) ((row).id) (allRows) (order) && directMigrationOrderValid (rest) (allRows) (order))

@[expose] public def refsClosedAcceptance : (rows : List (PrismPM.Production.Operations.Acceptance)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (modelHasId ((row).target) (model) && (modelHasId ((row).component) (model) && refsClosedAcceptance (rest) (model)))

@[expose] public def refsClosedAlerts : (rows : List (PrismPM.Production.Operations.Alert)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedAlerts (rest) (model))

@[expose] public def refsClosedArchitecture : (rows : List (PrismPM.Production.Operations.ArchitectureBinding)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && (allStringsModelMember ((row).verifies) (model) && refsClosedArchitecture (rest) (model)))

@[expose] public def refsClosedArtifacts : (rows : List (PrismPM.Production.Core.Artifact)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).platformRequirements) (model) && refsClosedArtifacts (rest) (model))

@[expose] public def refsClosedBackups : (rows : List (PrismPM.Production.Runtime.BackupRecovery)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedBackups (rest) (model))

@[expose] public def refsClosedCalls : (rows : List (PrismPM.Production.Interface.Call)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (modelHasId ((row).fromComponent) (model) && (modelHasId ((row).toComponent) (model) && (modelHasId ((row).interfaceId) (model) && (allStringsModelMember ((row).dependsOn) (model) && refsClosedCalls (rest) (model)))))

@[expose] public def refsClosedCapabilities : (rows : List (PrismPM.Production.Core.Capability)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedCapabilities (rest) (model))

@[expose] public def refsClosedComponents : (rows : List (PrismPM.Production.Core.Component)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (modelHasId ((row).artifact) (model) && (allStringsModelMember ((row).capabilities) (model) && (allStringsModelMember ((row).dependsOn) (model) && (allStringsModelMember ((row).interfaces) (model) && (allStringsModelMember ((row).parameters) (model) && (allStringsModelMember ((row).ports) (model) && (allStringsModelMember ((row).secrets) (model) && (allStringsModelMember ((row).volumes) (model) && (allStringsModelMember ((row).placement) (model) && (allStringsModelMember ((row).platformRequirements) (model) && (optionalStringModelMember ((row).scalingPolicy) (model) && refsClosedComponents (rest) (model))))))))))))

@[expose] public def refsClosedControls : (rows : List (PrismPM.Production.Operations.Control)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && (allStringsModelMember ((row).verification) (model) && refsClosedControls (rest) (model)))

@[expose] public def refsClosedDrifts : (rows : List (PrismPM.Production.Operations.Drift)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedDrifts (rest) (model))

@[expose] public def refsClosedEvents : (rows : List (PrismPM.Production.Interface.Event)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (modelHasId ((row).producer) (model) && (modelHasId ((row).owner) (model) && (modelHasId ((row).channel) (model) && (modelHasId ((row).schemaId) (model) && (allStringsModelMember ((row).dependsOn) (model) && refsClosedEvents (rest) (model))))))

@[expose] public def refsClosedFlows : (rows : List (PrismPM.Production.Interface.Flow)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (modelHasId ((row).fromComponent) (model) && (modelHasId ((row).toComponent) (model) && (modelHasId ((row).interfaceId) (model) && refsClosedFlows (rest) (model))))

@[expose] public def refsClosedIdentityRequirements : (rows : List (PrismPM.Production.Core.IdentityRequirement)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (modelHasId ((row).issuerParameter) (model) && refsClosedIdentityRequirements (rest) (model))

@[expose] public def refsClosedInterfaces : (rows : List (PrismPM.Production.Interface.Interface)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (modelHasId ((row).document) (model) && (allStringsModelMember ((row).acceptance) (model) && refsClosedInterfaces (rest) (model)))

@[expose] public def refsClosedMigrations : (rows : List (PrismPM.Production.Runtime.Migration)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedMigrations (rest) (model))

@[expose] public def refsClosedParameters : (rows : List (PrismPM.Production.Core.Configuration)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons _ rest, model => refsClosedParameters (rest) (model)

@[expose] public def refsClosedPlatformRequirements : (rows : List (PrismPM.Production.Runtime.PlatformRequirement)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).capabilities) (model) && refsClosedPlatformRequirements (rest) (model))

@[expose] public def refsClosedPersistence : (rows : List (PrismPM.Production.Runtime.Persistence)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (modelHasId ((row).owner) (model) && (modelHasId ((row).schemaArtifact) (model) && (modelHasId ((row).backup) (model) && (allStringsModelMember ((row).migrationOrder) (model) && refsClosedPersistence (rest) (model)))))

@[expose] public def refsClosedRetirements : (rows : List (PrismPM.Production.Operations.Retirement)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedRetirements (rest) (model))

@[expose] public def refsClosedRollbacks : (rows : List (PrismPM.Production.Operations.Rollback)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedRollbacks (rest) (model))

@[expose] public def refsClosedRollouts : (rows : List (PrismPM.Production.Operations.Rollout)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedRollouts (rest) (model))

@[expose] public def refsClosedScalingPolicies : (rows : List (PrismPM.Production.Runtime.ScalingPolicy)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (modelHasId ((row).component) (model) && refsClosedScalingPolicies (rest) (model))

@[expose] public def refsClosedSchemas : (rows : List (PrismPM.Production.Interface.Schema)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedSchemas (rest) (model))

@[expose] public def refsClosedSlis : (rows : List (PrismPM.Production.Operations.Sli)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedSlis (rest) (model))

@[expose] public def refsClosedSlos : (rows : List (PrismPM.Production.Operations.Slo)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).dependsOn) (model) && refsClosedSlos (rest) (model))

@[expose] public def refsClosedTargets : (rows : List (PrismPM.Production.Runtime.TargetBinding)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).capabilities) (model) && (allStringsModelMember ((row).platformRequirements) (model) && (optionalStringModelMember ((row).credentials) (model) && (optionalStringModelMember ((row).storageClass) (model) && (optionalStringModelMember ((row).ingressControllerArtifact) (model) && refsClosedTargets (rest) (model))))))

@[expose] public def refsClosedTopology : (rows : List (PrismPM.Production.Runtime.Topology)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).owners) (model) && (allStringsModelMember ((row).dependsOn) (model) && (allStringsModelMember ((row).capabilities) (model) && (allStringsModelMember ((row).platformRequirements) (model) && (optionalStringModelMember ((row).network) (model) && (optionalStringModelMember ((row).storageClass) (model) && (optionalStringModelMember ((row).placement) (model) && refsClosedTopology (rest) (model))))))))

@[expose] public def refsClosedStorageClasses : (rows : List (PrismPM.Production.Runtime.StorageClass)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).capabilities) (model) && (allStringsModelMember ((row).platformRequirements) (model) && refsClosedStorageClasses (rest) (model)))

@[expose] public def refsClosedSecretReferences : (rows : List (PrismPM.Production.Core.SecretReference)) -> (model : PrismPM.Production.System.SystemModel) -> Bool
  | List.nil, _model => true
  | List.cons row rest, model => (allStringsModelMember ((row).consumers) (model) && refsClosedSecretReferences (rest) (model))

@[expose] public def productRefsClosed (product : PrismPM.Production.Core.Product) (model : PrismPM.Production.System.SystemModel) : Bool := allStringsModelMember ((product).supportedPlatforms) (model)

@[expose] public def validateModelClosure (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := (refsClosedSecretReferences ((model).secretReferences) (model) && (modelIdsGloballyUnique (model) && (productRefsClosed ((model).product) (model) && (refsClosedAcceptance ((model).acceptance) (model) && (refsClosedAlerts ((model).alerts) (model) && (refsClosedArchitecture ((model).architecture) (model) && (refsClosedArtifacts ((model).artifacts) (model) && (refsClosedBackups ((model).backups) (model) && (refsClosedCalls ((model).calls) (model) && (refsClosedCapabilities ((model).capabilities) (model) && (refsClosedComponents ((model).components) (model) && (refsClosedControls ((model).controls) (model) && (refsClosedDrifts ((model).drifts) (model) && (refsClosedEvents ((model).events) (model) && (refsClosedFlows ((model).flows) (model) && (refsClosedIdentityRequirements ((model).identityRequirements) (model) && (refsClosedInterfaces ((model).interfaces) (model) && (refsClosedMigrations ((model).migrations) (model) && (refsClosedParameters ((model).parameters) (model) && (refsClosedPlatformRequirements ((model).platformRequirements) (model) && (refsClosedPersistence ((model).persistence) (model) && (refsClosedRetirements ((model).retirements) (model) && (refsClosedRollbacks ((model).rollbacks) (model) && (refsClosedRollouts ((model).rollouts) (model) && (refsClosedScalingPolicies ((model).scalingPolicies) (model) && (refsClosedSchemas ((model).schemas) (model) && (refsClosedSlis ((model).slis) (model) && (refsClosedSlos ((model).slos) (model) && (refsClosedTargets ((model).targets) (model) && (refsClosedTopology ((model).topology) (model) && (refsClosedStorageClasses ((model).storageClasses) (model) && ((Nat.beq (((manifest).closure).bound) (modelEntityCount (model))) && PrismPM.Production.Validation.validateClosure (((manifest).closure).bound) (((manifest).closure).values)))))))))))))))))))))))))))))))))

@[expose] public def validateModelUniqueness (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := (modelIdsGloballyUnique (model) && ((Nat.beq ((LexLeanRuntime.length (((manifest).uniqueness).values) : Nat)) (modelEntityCount (model))) && PrismPM.Production.Validation.validateUniqueness (((manifest).uniqueness).values)))

@[expose] public def artifactsReferential : (rows : List (PrismPM.Production.Core.Artifact)) -> (platformIds : List (PrismPM.Production.Runtime.PlatformRequirement)) -> Bool
  | List.nil, _platformIds => true
  | List.cons row rest, platformIds => (allIdsMemberPlatformRequirements ((row).platformRequirements) (platformIds) && artifactsReferential (rest) (platformIds))

@[expose] public def componentsReferential : (rows : List (PrismPM.Production.Core.Component)) -> (artifactIds : List (PrismPM.Production.Core.Artifact)) -> (capabilityIds : List (PrismPM.Production.Core.Capability)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> (interfaceIds : List (PrismPM.Production.Interface.Interface)) -> (parameterIds : List (PrismPM.Production.Core.Configuration)) -> (topologyIds : List (PrismPM.Production.Runtime.Topology)) -> (secretIds : List (PrismPM.Production.Core.SecretReference)) -> (platformIds : List (PrismPM.Production.Runtime.PlatformRequirement)) -> (scalingIds : List (PrismPM.Production.Runtime.ScalingPolicy)) -> Bool
  | List.nil, _artifactIds, _capabilityIds, _componentIds, _interfaceIds, _parameterIds, _topologyIds, _secretIds, _platformIds, _scalingIds => true
  | List.cons row rest, artifactIds, capabilityIds, componentIds, interfaceIds, parameterIds, topologyIds, secretIds, platformIds, scalingIds => (memberIdArtifacts ((row).artifact) (artifactIds) && (allIdsMemberCapabilities ((row).capabilities) (capabilityIds) && (allIdsMemberComponents ((row).dependsOn) (componentIds) && (allIdsMemberInterfaces ((row).interfaces) (interfaceIds) && (allIdsMemberParameters ((row).parameters) (parameterIds) && (allIdsMemberTopology ((row).ports) (topologyIds) && (allIdsMemberTopology ((row).volumes) (topologyIds) && (allIdsMemberTopology ((row).placement) (topologyIds) && (allIdsMemberSecretReferences ((row).secrets) (secretIds) && (allIdsMemberPlatformRequirements ((row).platformRequirements) (platformIds) && (optionalIdMemberScalingPolicies ((row).scalingPolicy) (scalingIds) && componentsReferential (rest) (artifactIds) (capabilityIds) (componentIds) (interfaceIds) (parameterIds) (topologyIds) (secretIds) (platformIds) (scalingIds))))))))))))

@[expose] public def interfacesReferential : (rows : List (PrismPM.Production.Interface.Interface)) -> (schemaIds : List (PrismPM.Production.Interface.Schema)) -> (acceptanceIds : List (PrismPM.Production.Operations.Acceptance)) -> Bool
  | List.nil, _schemaIds, _acceptanceIds => true
  | List.cons row rest, schemaIds, acceptanceIds => (memberIdSchemas ((row).document) (schemaIds) && (allIdsMemberAcceptance ((row).acceptance) (acceptanceIds) && interfacesReferential (rest) (schemaIds) (acceptanceIds)))

@[expose] public def callsReferential : (rows : List (PrismPM.Production.Interface.Call)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> (interfaceIds : List (PrismPM.Production.Interface.Interface)) -> Bool
  | List.nil, _componentIds, _interfaceIds => true
  | List.cons row rest, componentIds, interfaceIds => (memberIdComponents ((row).fromComponent) (componentIds) && (memberIdComponents ((row).toComponent) (componentIds) && (memberIdInterfaces ((row).interfaceId) (interfaceIds) && callsReferential (rest) (componentIds) (interfaceIds))))

@[expose] public def eventsReferential : (rows : List (PrismPM.Production.Interface.Event)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> (interfaceIds : List (PrismPM.Production.Interface.Interface)) -> (schemaIds : List (PrismPM.Production.Interface.Schema)) -> Bool
  | List.nil, _componentIds, _interfaceIds, _schemaIds => true
  | List.cons row rest, componentIds, interfaceIds, schemaIds => (memberIdComponents ((row).producer) (componentIds) && (memberIdComponents ((row).owner) (componentIds) && (memberIdInterfaces ((row).channel) (interfaceIds) && (memberIdSchemas ((row).schemaId) (schemaIds) && eventsReferential (rest) (componentIds) (interfaceIds) (schemaIds)))))

@[expose] public def flowsReferential : (rows : List (PrismPM.Production.Interface.Flow)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> (interfaceIds : List (PrismPM.Production.Interface.Interface)) -> Bool
  | List.nil, _componentIds, _interfaceIds => true
  | List.cons row rest, componentIds, interfaceIds => (memberIdComponents ((row).fromComponent) (componentIds) && (memberIdComponents ((row).toComponent) (componentIds) && (memberIdInterfaces ((row).interfaceId) (interfaceIds) && flowsReferential (rest) (componentIds) (interfaceIds))))

@[expose] public def identityReferential : (rows : List (PrismPM.Production.Core.IdentityRequirement)) -> (parameterIds : List (PrismPM.Production.Core.Configuration)) -> Bool
  | List.nil, _parameterIds => true
  | List.cons row rest, parameterIds => (memberIdParameters ((row).issuerParameter) (parameterIds) && identityReferential (rest) (parameterIds))

@[expose] public def persistenceReferential : (rows : List (PrismPM.Production.Runtime.Persistence)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> (artifactIds : List (PrismPM.Production.Core.Artifact)) -> (backupIds : List (PrismPM.Production.Runtime.BackupRecovery)) -> (migrationIds : List (PrismPM.Production.Runtime.Migration)) -> Bool
  | List.nil, _componentIds, _artifactIds, _backupIds, _migrationIds => true
  | List.cons row rest, componentIds, artifactIds, backupIds, migrationIds => (memberIdComponents ((row).owner) (componentIds) && (memberIdArtifacts ((row).schemaArtifact) (artifactIds) && (memberIdBackups ((row).backup) (backupIds) && (allIdsMemberMigrations ((row).migrationOrder) (migrationIds) && persistenceReferential (rest) (componentIds) (artifactIds) (backupIds) (migrationIds)))))

@[expose] public def scalingReferential : (rows : List (PrismPM.Production.Runtime.ScalingPolicy)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> Bool
  | List.nil, _componentIds => true
  | List.cons row rest, componentIds => (memberIdComponents ((row).component) (componentIds) && scalingReferential (rest) (componentIds))

@[expose] public def topologyReferential : (rows : List (PrismPM.Production.Runtime.Topology)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> (capabilityIds : List (PrismPM.Production.Core.Capability)) -> (platformIds : List (PrismPM.Production.Runtime.PlatformRequirement)) -> (storageIds : List (PrismPM.Production.Runtime.StorageClass)) -> (topologyIds : List (PrismPM.Production.Runtime.Topology)) -> Bool
  | List.nil, _componentIds, _capabilityIds, _platformIds, _storageIds, _topologyIds => true
  | List.cons row rest, componentIds, capabilityIds, platformIds, storageIds, topologyIds => (allIdsMemberComponents ((row).owners) (componentIds) && (allIdsMemberCapabilities ((row).capabilities) (capabilityIds) && (allIdsMemberPlatformRequirements ((row).platformRequirements) (platformIds) && (optionalIdMemberStorageClasses ((row).storageClass) (storageIds) && (optionalIdMemberTopology ((row).network) (topologyIds) && (optionalIdMemberTopology ((row).placement) (topologyIds) && topologyReferential (rest) (componentIds) (capabilityIds) (platformIds) (storageIds) (topologyIds)))))))

@[expose] public def storageReferential : (rows : List (PrismPM.Production.Runtime.StorageClass)) -> (capabilityIds : List (PrismPM.Production.Core.Capability)) -> (platformIds : List (PrismPM.Production.Runtime.PlatformRequirement)) -> Bool
  | List.nil, _capabilityIds, _platformIds => true
  | List.cons row rest, capabilityIds, platformIds => (allIdsMemberCapabilities ((row).capabilities) (capabilityIds) && (allIdsMemberPlatformRequirements ((row).platformRequirements) (platformIds) && storageReferential (rest) (capabilityIds) (platformIds)))

@[expose] public def targetsReferential : (rows : List (PrismPM.Production.Runtime.TargetBinding)) -> (capabilityIds : List (PrismPM.Production.Core.Capability)) -> (platformIds : List (PrismPM.Production.Runtime.PlatformRequirement)) -> (storageIds : List (PrismPM.Production.Runtime.StorageClass)) -> (secretIds : List (PrismPM.Production.Core.SecretReference)) -> (artifactIds : List (PrismPM.Production.Core.Artifact)) -> Bool
  | List.nil, _capabilityIds, _platformIds, _storageIds, _secretIds, _artifactIds => true
  | List.cons row rest, capabilityIds, platformIds, storageIds, secretIds, artifactIds => (allIdsMemberCapabilities ((row).capabilities) (capabilityIds) && (allIdsMemberPlatformRequirements ((row).platformRequirements) (platformIds) && (optionalIdMemberStorageClasses ((row).storageClass) (storageIds) && (optionalIdMemberSecretReferences ((row).credentials) (secretIds) && (optionalIdMemberArtifacts ((row).ingressControllerArtifact) (artifactIds) && targetsReferential (rest) (capabilityIds) (platformIds) (storageIds) (secretIds) (artifactIds))))))

@[expose] public def acceptanceReferential : (rows : List (PrismPM.Production.Operations.Acceptance)) -> (targetIds : List (PrismPM.Production.Runtime.TargetBinding)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> Bool
  | List.nil, _targetIds, _componentIds => true
  | List.cons row rest, targetIds, componentIds => (memberIdTargets ((row).target) (targetIds) && (memberIdComponents ((row).component) (componentIds) && acceptanceReferential (rest) (targetIds) (componentIds)))

@[expose] public def validateModelReferentialIntegrity (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := (allIdsMemberPlatformRequirements (((model).product).supportedPlatforms) ((model).platformRequirements) && (artifactsReferential ((model).artifacts) ((model).platformRequirements) && (componentsReferential ((model).components) ((model).artifacts) ((model).capabilities) ((model).components) ((model).interfaces) ((model).parameters) ((model).topology) ((model).secretReferences) ((model).platformRequirements) ((model).scalingPolicies) && (interfacesReferential ((model).interfaces) ((model).schemas) ((model).acceptance) && (callsReferential ((model).calls) ((model).components) ((model).interfaces) && (eventsReferential ((model).events) ((model).components) ((model).interfaces) ((model).schemas) && (flowsReferential ((model).flows) ((model).components) ((model).interfaces) && (identityReferential ((model).identityRequirements) ((model).parameters) && (persistenceReferential ((model).persistence) ((model).components) ((model).artifacts) ((model).backups) ((model).migrations) && (scalingReferential ((model).scalingPolicies) ((model).components) && (topologyReferential ((model).topology) ((model).components) ((model).capabilities) ((model).platformRequirements) ((model).storageClasses) ((model).topology) && (storageReferential ((model).storageClasses) ((model).capabilities) ((model).platformRequirements) && (targetsReferential ((model).targets) ((model).capabilities) ((model).platformRequirements) ((model).storageClasses) ((model).secretReferences) ((model).artifacts) && (acceptanceReferential ((model).acceptance) ((model).targets) ((model).components) && ((Nat.beq (((manifest).referentialIntegrity).bound) (modelEntityCount (model))) && PrismPM.Production.Validation.validateReferentialIntegrity (((manifest).referentialIntegrity).bound) (((manifest).referentialIntegrity).values))))))))))))))))

@[expose] public def compatibilityValue (value : String) : Bool := ((LexLeanRuntime.equal (value) ("exact") : Bool) || ((LexLeanRuntime.equal (value) ("backward") : Bool) || ((LexLeanRuntime.equal (value) ("forward") : Bool) || (LexLeanRuntime.equal (value) ("full") : Bool))))

@[expose] public def schemasCompatible : (rows : List (PrismPM.Production.Interface.Schema)) -> Bool
  | List.nil => true
  | List.cons row rest => (compatibilityValue ((row).compatibility) && schemasCompatible (rest))

@[expose] public def interfacesCompatible : (rows : List (PrismPM.Production.Interface.Interface)) -> Bool
  | List.nil => true
  | List.cons row rest => (compatibilityValue ((row).compatibility) && interfacesCompatible (rest))

@[expose] public def persistenceCompatible : (rows : List (PrismPM.Production.Runtime.Persistence)) -> Bool
  | List.nil => true
  | List.cons row rest => (nonEmptyString ((row).compatibilityWindow) && persistenceCompatible (rest))

@[expose] public def validateModelCompatibility (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := (schemasCompatible ((model).schemas) && (interfacesCompatible ((model).interfaces) && (persistenceCompatible ((model).persistence) && ((Nat.beq (((manifest).compatibility).bound) (4)) && ((Nat.beq ((LexLeanRuntime.length (((manifest).compatibility).values) : Nat)) ((LexLeanRuntime.length ((model).interfaces) : Nat))) && PrismPM.Production.Validation.validateCompatibility (((manifest).compatibility).bound) (((manifest).compatibility).values))))))

@[expose] public def componentCapabilitiesSatisfied : (rows : List (PrismPM.Production.Core.Component)) -> (capabilityIds : List (PrismPM.Production.Core.Capability)) -> Bool
  | List.nil, _capabilityIds => true
  | List.cons row rest, capabilityIds => (allIdsMemberCapabilities ((row).capabilities) (capabilityIds) && componentCapabilitiesSatisfied (rest) (capabilityIds))

@[expose] public def platformCapabilitiesSatisfied : (rows : List (PrismPM.Production.Runtime.PlatformRequirement)) -> (capabilityIds : List (PrismPM.Production.Core.Capability)) -> Bool
  | List.nil, _capabilityIds => true
  | List.cons row rest, capabilityIds => (allIdsMemberCapabilities ((row).capabilities) (capabilityIds) && platformCapabilitiesSatisfied (rest) (capabilityIds))

@[expose] public def storageCapabilitiesSatisfied : (rows : List (PrismPM.Production.Runtime.StorageClass)) -> (capabilityIds : List (PrismPM.Production.Core.Capability)) -> Bool
  | List.nil, _capabilityIds => true
  | List.cons row rest, capabilityIds => (allIdsMemberCapabilities ((row).capabilities) (capabilityIds) && storageCapabilitiesSatisfied (rest) (capabilityIds))

@[expose] public def targetCapabilitiesSatisfied : (rows : List (PrismPM.Production.Runtime.TargetBinding)) -> (capabilityIds : List (PrismPM.Production.Core.Capability)) -> Bool
  | List.nil, _capabilityIds => true
  | List.cons row rest, capabilityIds => (allIdsMemberCapabilities ((row).capabilities) (capabilityIds) && targetCapabilitiesSatisfied (rest) (capabilityIds))

@[expose] public def topologyCapabilitiesSatisfied : (rows : List (PrismPM.Production.Runtime.Topology)) -> (capabilityIds : List (PrismPM.Production.Core.Capability)) -> Bool
  | List.nil, _capabilityIds => true
  | List.cons row rest, capabilityIds => (allIdsMemberCapabilities ((row).capabilities) (capabilityIds) && topologyCapabilitiesSatisfied (rest) (capabilityIds))

@[expose] public def validateModelCapabilitySatisfaction (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := (componentCapabilitiesSatisfied ((model).components) ((model).capabilities) && (platformCapabilitiesSatisfied ((model).platformRequirements) ((model).capabilities) && (storageCapabilitiesSatisfied ((model).storageClasses) ((model).capabilities) && (targetCapabilitiesSatisfied ((model).targets) ((model).capabilities) && (topologyCapabilitiesSatisfied ((model).topology) ((model).capabilities) && ((Nat.beq (((manifest).capabilitySatisfaction).bound) ((LexLeanRuntime.length ((model).capabilities) : Nat))) && PrismPM.Production.Validation.validateCapabilitySatisfaction (((manifest).capabilitySatisfaction).bound) (((manifest).capabilitySatisfaction).values)))))))

@[expose] public def componentSecretsSatisfied : (rows : List (PrismPM.Production.Core.Component)) -> (secretIds : List (PrismPM.Production.Core.SecretReference)) -> Bool
  | List.nil, _secretIds => true
  | List.cons row rest, secretIds => (allIdsMemberSecretReferences ((row).secrets) (secretIds) && componentSecretsSatisfied (rest) (secretIds))

@[expose] public def secretConsumersSatisfied : (rows : List (PrismPM.Production.Core.SecretReference)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> Bool
  | List.nil, _componentIds => true
  | List.cons row rest, componentIds => (allIdsMemberComponents ((row).consumers) (componentIds) && (nonEmptyString ((row).providerKey) && (nonEmptyString ((row).rotation) && secretConsumersSatisfied (rest) (componentIds))))

@[expose] public def validateModelSecretFlow (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := (componentSecretsSatisfied ((model).components) ((model).secretReferences) && (secretConsumersSatisfied ((model).secretReferences) ((model).components) && ((Nat.beq (((manifest).secretFlow).bound) ((LexLeanRuntime.length ((model).components) : Nat))) && PrismPM.Production.Validation.validateSecretFlow (((manifest).secretFlow).bound) (((manifest).secretFlow).values))))

@[expose] public def stringIndex : (value : String) -> (values : List (String)) -> (position : Nat) -> Option (Nat)
  | _value, List.nil, _position => Option.none
  | value, List.cons head rest, position => (match (LexLeanRuntime.equal (value) (head) : Bool) with | Bool.false => stringIndex (value) (rest) ((position + 1)) | Bool.true => Option.some (position))

@[expose] public def indexPrecedes (dependency : String) (current : String) (ids : List (String)) (order : List (Nat)) : Bool := (match stringIndex (dependency) (ids) (0) with | Option.none => false | Option.some dependencyIndex => (match stringIndex (current) (ids) (0) with | Option.none => false | Option.some currentIndex => (match natIndex (dependencyIndex) (order) (0) with | Option.none => false | Option.some dependencyPosition => (match natIndex (currentIndex) (order) (0) with | Option.none => false | Option.some currentPosition => (Nat.blt (dependencyPosition) (currentPosition))))))

@[expose] public def componentDependenciesPrecede : (dependencies : List (String)) -> (current : String) -> (ids : List (String)) -> (order : List (Nat)) -> Bool
  | List.nil, _current, _ids, _order => true
  | List.cons dependency rest, current, ids, order => (indexPrecedes (dependency) (current) (ids) (order) && componentDependenciesPrecede (rest) (current) (ids) (order))

@[expose] public def componentOrderValid : (rows : List (PrismPM.Production.Core.Component)) -> (ids : List (String)) -> (order : List (Nat)) -> Bool
  | List.nil, _ids, _order => true
  | List.cons row rest, ids, order => (componentDependenciesPrecede ((row).dependsOn) ((row).id) (ids) (order) && componentOrderValid (rest) (ids) (order))

@[expose] public def validateModelDeploymentOrder (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := ((Nat.beq (((manifest).deploymentOrder).bound) ((LexLeanRuntime.length ((model).components) : Nat))) && ((Nat.beq ((LexLeanRuntime.length (((manifest).deploymentOrder).values) : Nat)) ((LexLeanRuntime.length ((model).components) : Nat))) && (uniqueNats (((manifest).deploymentOrder).values) && (PrismPM.Production.Validation.relationAllBelow ((LexLeanRuntime.length ((model).components) : Nat)) (((manifest).deploymentOrder).values) && directComponentOrderValid ((model).components) ((model).components) (((manifest).deploymentOrder).values)))))

@[expose] public def migrationDependenciesPrecede : (dependencies : List (String)) -> (current : String) -> (ids : List (String)) -> (order : List (Nat)) -> Bool
  | List.nil, _current, _ids, _order => true
  | List.cons dependency rest, current, ids, order => ((match stringMember (dependency) (ids) with | Bool.false => true | Bool.true => indexPrecedes (dependency) (current) (ids) (order)) && migrationDependenciesPrecede (rest) (current) (ids) (order))

@[expose] public def migrationOrderValid : (rows : List (PrismPM.Production.Runtime.Migration)) -> (ids : List (String)) -> (order : List (Nat)) -> Bool
  | List.nil, _ids, _order => true
  | List.cons row rest, ids, order => (migrationDependenciesPrecede ((row).dependsOn) ((row).id) (ids) (order) && migrationOrderValid (rest) (ids) (order))

@[expose] public def validateModelMigrationOrder (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := ((Nat.beq (((manifest).migrationOrder).bound) ((LexLeanRuntime.length ((model).migrations) : Nat))) && ((Nat.beq ((LexLeanRuntime.length (((manifest).migrationOrder).values) : Nat)) ((LexLeanRuntime.length ((model).migrations) : Nat))) && (uniqueNats (((manifest).migrationOrder).values) && (PrismPM.Production.Validation.relationAllBelow ((LexLeanRuntime.length ((model).migrations) : Nat)) (((manifest).migrationOrder).values) && directMigrationOrderValid ((model).migrations) ((model).migrations) (((manifest).migrationOrder).values)))))

@[expose] public def rollbackRowsSafe : (rows : List (PrismPM.Production.Operations.Rollback)) -> (migrationIds : List (PrismPM.Production.Runtime.Migration)) -> (rolloutIds : List (PrismPM.Production.Operations.Rollout)) -> Bool
  | List.nil, _migrationIds, _rolloutIds => true
  | List.cons row rest, migrationIds, rolloutIds => (nonEmptyString ((row).kind) && (nonEmptyString ((row).value) && (anyIdsMemberMigrations ((row).dependsOn) (migrationIds) && (anyIdsMemberRollouts ((row).dependsOn) (rolloutIds) && rollbackRowsSafe (rest) (migrationIds) (rolloutIds)))))

@[expose] public def validateModelRollbackSafety (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := (rollbackRowsSafe ((model).rollbacks) ((model).migrations) ((model).rollouts) && ((Nat.beq (((manifest).rollbackSafety).bound) (modelEntityCount (model))) && PrismPM.Production.Validation.validateRollbackSafety (((manifest).rollbackSafety).bound) (((manifest).rollbackSafety).values)))

@[expose] public def acceptanceEvidenceClosed : (rows : List (PrismPM.Production.Operations.Acceptance)) -> (targetIds : List (PrismPM.Production.Runtime.TargetBinding)) -> (componentIds : List (PrismPM.Production.Core.Component)) -> Bool
  | List.nil, _targetIds, _componentIds => true
  | List.cons row rest, targetIds, componentIds => ((row).bounded && (memberIdTargets ((row).target) (targetIds) && (memberIdComponents ((row).component) (componentIds) && (nonEmptyString ((row).evidence) && ((Nat.blt (0) ((LexLeanRuntime.length ((row).command) : Nat))) && acceptanceEvidenceClosed (rest) (targetIds) (componentIds))))))

@[expose] public def validateModelEvidenceClosure (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := (acceptanceEvidenceClosed ((model).acceptance) ((model).targets) ((model).components) && ((Nat.beq (((manifest).evidenceClosure).bound) (modelEntityCount (model))) && PrismPM.Production.Validation.validateEvidenceClosure (((manifest).evidenceClosure).bound) (((manifest).evidenceClosure).values)))

@[expose] public def artifactLicensesClosed : (rows : List (PrismPM.Production.Core.Artifact)) -> Bool
  | List.nil => true
  | List.cons row rest => (nonEmptyString ((row).licenseExpression) && artifactLicensesClosed (rest))

@[expose] public def validateModelLicenseClosure (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := ((Nat.blt (0) ((LexLeanRuntime.length ((model).artifacts) : Nat))) && (artifactLicensesClosed ((model).artifacts) && ((Nat.beq (((manifest).licenseClosure).bound) (257)) && ((Nat.beq ((LexLeanRuntime.length (((manifest).licenseClosure).values) : Nat)) ((LexLeanRuntime.length ((model).artifacts) : Nat))) && PrismPM.Production.Validation.validateLicenseClosure (((manifest).licenseClosure).values)))))

@[expose] public def componentsHaveArtifacts : (rows : List (PrismPM.Production.Core.Component)) -> (artifactIds : List (PrismPM.Production.Core.Artifact)) -> Bool
  | List.nil, _artifactIds => true
  | List.cons row rest, artifactIds => (memberIdArtifacts ((row).artifact) (artifactIds) && componentsHaveArtifacts (rest) (artifactIds))

@[expose] public def validateModelReleaseCompleteness (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := ((Nat.blt (0) ((LexLeanRuntime.length ((model).artifacts) : Nat))) && ((Nat.blt (0) ((LexLeanRuntime.length ((model).components) : Nat))) && ((Nat.blt (0) ((LexLeanRuntime.length (((model).product).supportedPlatforms) : Nat))) && (allIdsMemberPlatformRequirements (((model).product).supportedPlatforms) ((model).platformRequirements) && (componentsHaveArtifacts ((model).components) ((model).artifacts) && ((Nat.beq (((manifest).releaseCompleteness).bound) ((LexLeanRuntime.length ((model).artifacts) : Nat))) && ((Nat.beq ((LexLeanRuntime.length (((manifest).releaseCompleteness).values) : Nat)) ((LexLeanRuntime.length ((model).artifacts) : Nat))) && PrismPM.Production.Validation.validateReleaseCompleteness (((manifest).releaseCompleteness).values))))))))

@[expose] public def validateManifest (model : PrismPM.Production.System.SystemModel) (manifest : PrismPM.Production.System.SystemManifest) : Bool := (validateModelClosure (model) (manifest) && (validateModelUniqueness (model) (manifest) && (validateModelReferentialIntegrity (model) (manifest) && (validateModelCompatibility (model) (manifest) && (validateModelCapabilitySatisfaction (model) (manifest) && (validateModelSecretFlow (model) (manifest) && (validateModelDeploymentOrder (model) (manifest) && (validateModelMigrationOrder (model) (manifest) && (validateModelRollbackSafety (model) (manifest) && (validateModelEvidenceClosure (model) (manifest) && (validateModelLicenseClosure (model) (manifest) && validateModelReleaseCompleteness (model) (manifest))))))))))))

end PrismPM.Production.SystemValidation
