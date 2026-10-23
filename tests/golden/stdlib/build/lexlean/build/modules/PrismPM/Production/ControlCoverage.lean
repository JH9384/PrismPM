module
public import Init
public import LexLeanRuntime.Portable
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.ControlCoverage

public inductive ControlRequirementMode where
  | LocalRequired
  | InheritedRequired

public structure ControlObligation where
  id : Nat
  control : Nat
  mode : ControlRequirementMode
  scope : String
  version : String
  subject : List (UInt8)
  evidenceKind : String
  evidence : List (UInt8)
  allowedProviders : List (Nat)
  residualControls : List (Nat)

public inductive ControlOrigin where
  | Local
  | Inherited (_ : Nat) (_ : List (UInt8)) (_ : List (UInt8))

public structure ControlContribution where
  obligation : Nat
  control : Nat
  policy : List (UInt8)
  scope : String
  version : String
  subject : List (UInt8)
  evidenceKind : String
  evidence : List (UInt8)
  origin : ControlOrigin

public structure ControlPolicy where
  digest : List (UInt8)
  obligations : List (ControlObligation)

public structure ControlSubmission where
  contributions : List (ControlContribution)

@[expose] public def coverageNatMember : (value : Nat) -> (rows : List (Nat)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((Nat.beq (value) (row)) || coverageNatMember (value) (rest))

@[expose] public def coverageUniqueNats : (rows : List (Nat)) -> Bool
  | List.nil => true
  | List.cons row rest => ((!coverageNatMember (row) (rest)) && (coverageUniqueNats (rest) && true))

@[expose] public def coverageAllNatsMember : (rows : List (Nat)) -> (allowed : List (Nat)) -> Bool
  | List.nil, _allowed => true
  | List.cons row rest, allowed => (coverageNatMember (row) (allowed) && (coverageAllNatsMember (rest) (allowed) && true))

@[expose] public def coverageObligationExists : (value : Nat) -> (rows : List (ControlObligation)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((Nat.beq (value) ((row).id)) || coverageObligationExists (value) (rest))

@[expose] public def coverageControlExists : (value : Nat) -> (rows : List (ControlObligation)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((Nat.beq (value) ((row).control)) || coverageControlExists (value) (rest))

@[expose] public def coverageEarlier : (provider : Nat) -> (consumer : Nat) -> (rows : List (ControlObligation)) -> Bool
  | _provider, _consumer, List.nil => false
  | provider, consumer, List.cons row rest => ((!(Nat.beq (consumer) ((row).id))) && (((Nat.beq (provider) ((row).id)) || coverageEarlier (provider) (consumer) (rest)) && true))

@[expose] public def coverageProvidersDeclared : (rows : List (Nat)) -> (all : List (ControlObligation)) -> Bool
  | List.nil, _all => true
  | List.cons row rest, all => (coverageObligationExists (row) (all) && (coverageProvidersDeclared (rest) (all) && true))

@[expose] public def coverageResidualControlsDeclared : (rows : List (Nat)) -> (all : List (ControlObligation)) -> Bool
  | List.nil, _all => true
  | List.cons row rest, all => (coverageControlExists (row) (all) && (coverageResidualControlsDeclared (rest) (all) && true))

@[expose] public def coverageDigestEqual : (left : List (UInt8)) -> (right : List (UInt8)) -> Bool
  | List.nil, right => (match right with | List.nil => true | List.cons _ _ => false)
  | List.cons leftOctet leftRest, right => (match right with | List.nil => false | List.cons rightOctet rightRest => ((LexLeanRuntime.equal (leftOctet) (rightOctet) : Bool) && coverageDigestEqual (leftRest) (rightRest)))

@[expose] public def coverageDigest (value : List (UInt8)) : Bool := (Nat.beq ((LexLeanRuntime.length (value) : Nat)) (32))

@[expose] public def coverageNonEmptyString (value : String) : Bool := (!(LexLeanRuntime.equal (value) ("") : Bool))

@[expose] public def coverageObligationWellFormed (item : ControlObligation) (all : List (ControlObligation)) : Bool := ((Nat.blt (0) ((item).id)) && ((Nat.blt (0) ((item).control)) && (coverageNonEmptyString ((item).scope) && (coverageNonEmptyString ((item).version) && (coverageNonEmptyString ((item).evidenceKind) && (coverageDigest ((item).subject) && (coverageDigest ((item).evidence) && (coverageUniqueNats ((item).allowedProviders) && (coverageUniqueNats ((item).residualControls) && (coverageProvidersDeclared ((item).allowedProviders) (all) && (coverageResidualControlsDeclared ((item).residualControls) (all) && true)))))))))))

@[expose] public def coverageSameBinding (left : ControlObligation) (right : ControlObligation) : Bool := ((Nat.beq ((left).control) ((right).control)) && ((LexLeanRuntime.equal ((left).scope) ((right).scope) : Bool) && ((LexLeanRuntime.equal ((left).version) ((right).version) : Bool) && (coverageDigestEqual ((left).subject) ((right).subject) && true))))

@[expose] public def coverageBindingAbsent : (item : ControlObligation) -> (rows : List (ControlObligation)) -> Bool
  | _item, List.nil => true
  | item, List.cons row rest => ((!coverageSameBinding (item) (row)) && (coverageBindingAbsent (item) (rest) && true))

@[expose] public def coverageUniqueObligations : (rows : List (ControlObligation)) -> Bool
  | List.nil => true
  | List.cons row rest => ((!coverageObligationExists ((row).id) (rest)) && (coverageBindingAbsent (row) (rest) && (coverageUniqueObligations (rest) && true)))

@[expose] public def coverageContributionExists : (value : Nat) -> (rows : List (ControlContribution)) -> Bool
  | _value, List.nil => false
  | value, List.cons row rest => ((Nat.beq (value) ((row).obligation)) || coverageContributionExists (value) (rest))

@[expose] public def coverageSubmissionClosed : (rows : List (ControlContribution)) -> (all : List (ControlObligation)) -> Bool
  | List.nil, _all => true
  | List.cons row rest, all => (coverageObligationExists ((row).obligation) (all) && ((!coverageContributionExists ((row).obligation) (rest)) && (coverageSubmissionClosed (rest) (all) && true)))

@[expose] public def coverageResidualPresent : (control : Nat) -> (consumer : ControlObligation) -> (rows : List (ControlObligation)) -> (all : List (ControlObligation)) -> Bool
  | _control, _consumer, List.nil, _all => false
  | control, consumer, List.cons row rest, all => (((Nat.beq (control) ((row).control)) && ((LexLeanRuntime.equal ((consumer).scope) ((row).scope) : Bool) && ((LexLeanRuntime.equal ((consumer).version) ((row).version) : Bool) && (coverageDigestEqual ((consumer).subject) ((row).subject) && (coverageEarlier ((row).id) ((consumer).id) (all) && true))))) || coverageResidualPresent (control) (consumer) (rest) (all))

@[expose] public def coverageResidualsPresent : (rows : List (Nat)) -> (consumer : ControlObligation) -> (all : List (ControlObligation)) -> Bool
  | List.nil, _consumer, _all => true
  | List.cons row rest, consumer, all => (coverageResidualPresent (row) (consumer) (all) (all) && (coverageResidualsPresent (rest) (consumer) (all) && true))

@[expose] public def coverageProviderPresent : (provider : Nat) -> (providerSubject : List (UInt8)) -> (providerEvidence : List (UInt8)) -> (consumer : ControlObligation) -> (rows : List (ControlObligation)) -> (all : List (ControlObligation)) -> Bool
  | _provider, _providerSubject, _providerEvidence, _consumer, List.nil, _all => false
  | provider, providerSubject, providerEvidence, consumer, List.cons row rest, all => (((Nat.beq (provider) ((row).id)) && ((Nat.beq ((consumer).control) ((row).control)) && ((LexLeanRuntime.equal ((consumer).scope) ((row).scope) : Bool) && ((LexLeanRuntime.equal ((consumer).version) ((row).version) : Bool) && ((LexLeanRuntime.equal ((consumer).evidenceKind) ((row).evidenceKind) : Bool) && (coverageDigestEqual (providerSubject) ((row).subject) && (coverageDigestEqual (providerEvidence) ((row).evidence) && (coverageEarlier (provider) ((consumer).id) (all) && (coverageAllNatsMember ((row).residualControls) ((consumer).residualControls) && (coverageResidualsPresent ((row).residualControls) (consumer) (all) && true)))))))))) || coverageProviderPresent (provider) (providerSubject) (providerEvidence) (consumer) (rest) (all))

@[expose] public def coverageLocalRequired (mode : ControlRequirementMode) : Bool := (match mode with | ControlRequirementMode.LocalRequired => true | ControlRequirementMode.InheritedRequired => false)

@[expose] public def coverageOriginValid (origin : ControlOrigin) (consumer : ControlObligation) (all : List (ControlObligation)) : Bool := (match origin with | ControlOrigin.Local => coverageLocalRequired ((consumer).mode) | ControlOrigin.Inherited provider providerSubject providerEvidence => ((!coverageLocalRequired ((consumer).mode)) && (coverageNatMember (provider) ((consumer).allowedProviders) && (coverageProviderPresent (provider) (providerSubject) (providerEvidence) (consumer) (all) (all) && true))))

@[expose] public def coverageContributionMatches (item : ControlObligation) (contribution : ControlContribution) (policy : List (UInt8)) (all : List (ControlObligation)) : Bool := ((Nat.beq ((item).id) ((contribution).obligation)) && ((Nat.beq ((item).control) ((contribution).control)) && (coverageDigestEqual (policy) ((contribution).policy) && ((LexLeanRuntime.equal ((item).scope) ((contribution).scope) : Bool) && ((LexLeanRuntime.equal ((item).version) ((contribution).version) : Bool) && (coverageDigestEqual ((item).subject) ((contribution).subject) && ((LexLeanRuntime.equal ((item).evidenceKind) ((contribution).evidenceKind) : Bool) && (coverageDigestEqual ((item).evidence) ((contribution).evidence) && (coverageOriginValid ((contribution).origin) (item) (all) && true)))))))))

@[expose] public def coverageContributionPresent : (item : ControlObligation) -> (rows : List (ControlContribution)) -> (policy : List (UInt8)) -> (all : List (ControlObligation)) -> Bool
  | _item, List.nil, _policy, _all => false
  | item, List.cons row rest, policy, all => (coverageContributionMatches (item) (row) (policy) (all) || coverageContributionPresent (item) (rest) (policy) (all))

@[expose] public def coverageAllObligations : (rows : List (ControlObligation)) -> (contributions : List (ControlContribution)) -> (policy : List (UInt8)) -> (all : List (ControlObligation)) -> Bool
  | List.nil, _contributions, _policy, _all => true
  | List.cons row rest, contributions, policy, all => (coverageObligationWellFormed (row) (all) && (coverageContributionPresent (row) (contributions) (policy) (all) && (coverageAllObligations (rest) (contributions) (policy) (all) && true)))

@[expose] public def coverageNonEmpty (rows : List (ControlObligation)) : Bool := (match rows with | List.nil => false | List.cons _ _ => true)

@[expose] public def validateControlCoverage (policy : ControlPolicy) (submission : ControlSubmission) : Bool := (coverageDigest ((policy).digest) && (coverageNonEmpty ((policy).obligations) && (coverageUniqueObligations ((policy).obligations) && (coverageSubmissionClosed ((submission).contributions) ((policy).obligations) && (coverageAllObligations ((policy).obligations) ((submission).contributions) ((policy).digest) ((policy).obligations) && true)))))

end PrismPM.Production.ControlCoverage
