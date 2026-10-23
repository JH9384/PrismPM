module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.Validation

public structure ValidationRelation where
  bound : Nat
  values : List (Nat)

public structure ValidationCertificate where
  closure : ValidationRelation
  uniqueness : ValidationRelation
  referentialIntegrity : ValidationRelation
  compatibility : ValidationRelation
  capabilitySatisfaction : ValidationRelation
  secretFlow : ValidationRelation
  deploymentOrder : ValidationRelation
  migrationOrder : ValidationRelation
  rollbackSafety : ValidationRelation
  evidenceClosure : ValidationRelation
  licenseClosure : ValidationRelation
  releaseCompleteness : ValidationRelation

@[expose] public def relationAllConsecutive : (expected : Nat) -> (values : List (Nat)) -> Bool
  | _expected, List.nil => true
  | expected, List.cons value rest => ((Nat.beq (expected) (value)) && relationAllConsecutive ((expected + 1)) (rest))

@[expose] public def relationAllConsecutiveProp : (expected : Nat) -> (values : List (Nat)) -> Prop
  | expected, List.nil => (expected = expected)
  | expected, List.cons value rest => ((expected = value) /\ relationAllConsecutiveProp ((expected + 1)) (rest))

@[expose] public def relationAllBelow : (bound : Nat) -> (values : List (Nat)) -> Bool
  | _bound, List.nil => true
  | bound, List.cons value rest => ((Nat.blt (value) (bound)) && relationAllBelow (bound) (rest))

@[expose] public def relationAllBelowProp : (bound : Nat) -> (values : List (Nat)) -> Prop
  | bound, List.nil => (bound = bound)
  | bound, List.cons value rest => ((value < bound) /\ relationAllBelowProp (bound) (rest))

@[expose] public def relationAllPositive : (values : List (Nat)) -> Bool
  | List.nil => true
  | List.cons value rest => ((Nat.blt (0) (value)) && relationAllPositive (rest))

public theorem relationAllConsecutive_sound_complete (expected : Nat) (values : List (Nat)) : ((relationAllConsecutive (expected) (values) = true) <-> relationAllConsecutiveProp (expected) (values)) := by
  have llAndBridge : ∀ left right : Bool, ((left && right) = true) ↔ left = true ∧ right = true := by
    intro left right
    cases left <;> cases right <;> decide
  have llBeqRefl : ∀ value : Nat, Nat.beq value value = true := by
    intro value
    induction value with
    | zero => rfl
    | succ value ih => exact ih
  induction values generalizing expected with
  | nil => constructor <;> intro _ <;> rfl
  | cons llValue llRest llIH =>
    constructor
    · intro h
      have hpair := (llAndBridge _ _).mp h
      exact And.intro (Nat.eq_of_beq_eq_true hpair.left) ((llIH (expected + 1)).mp hpair.right)
    · intro h
      have hleft : Nat.beq expected llValue = true := h.left ▸ llBeqRefl expected
      have hright : relationAllConsecutive (expected + 1) llRest = true := (llIH (expected + 1)).mpr h.right
      exact (llAndBridge _ _).mpr (And.intro hleft hright)

public theorem relationAllBelow_sound_complete (bound : Nat) (values : List (Nat)) : ((relationAllBelow (bound) (values) = true) <-> relationAllBelowProp (bound) (values)) := by
  have llAndBridge : ∀ left right : Bool, ((left && right) = true) ↔ left = true ∧ right = true := by
    intro left right
    cases left <;> cases right <;> decide
  induction values generalizing bound with
  | nil => constructor <;> intro _ <;> rfl
  | cons llValue llRest llIH =>
    constructor
    · intro h
      have hpair := (llAndBridge _ _).mp h
      exact And.intro (Nat.le_of_ble_eq_true hpair.left) ((llIH bound).mp hpair.right)
    · intro h
      have hleft : Nat.blt llValue bound = true := Nat.ble_eq_true_of_le h.left
      have hright : relationAllBelow bound llRest = true := (llIH bound).mpr h.right
      exact (llAndBridge _ _).mpr (And.intro hleft hright)

@[expose] public def nonEmptyNatList : (values : List (Nat)) -> Bool
  | List.nil => false
  | List.cons _ _ => true

@[expose] public def validateClosure (bound : Nat) (values : List (Nat)) : Bool := (nonEmptyNatList (values) && ((Nat.blt (0) (bound)) && relationAllBelow (bound) (values)))

@[expose] public def validateUniqueness (values : List (Nat)) : Bool := (nonEmptyNatList (values) && relationAllConsecutive (0) (values))

@[expose] public def validateReferentialIntegrity (bound : Nat) (values : List (Nat)) : Bool := (nonEmptyNatList (values) && ((Nat.blt (0) (bound)) && relationAllBelow (bound) (values)))

@[expose] public def validateCompatibility (bound : Nat) (values : List (Nat)) : Bool := (nonEmptyNatList (values) && ((Nat.blt (0) (bound)) && relationAllBelow (bound) (values)))

@[expose] public def validateCapabilitySatisfaction (bound : Nat) (values : List (Nat)) : Bool := (nonEmptyNatList (values) && ((Nat.blt (0) (bound)) && relationAllBelow (bound) (values)))

@[expose] public def validateSecretFlow (bound : Nat) (values : List (Nat)) : Bool := (nonEmptyNatList (values) && ((Nat.blt (0) (bound)) && relationAllBelow (bound) (values)))

@[expose] public def validateDeploymentOrder (values : List (Nat)) : Bool := (nonEmptyNatList (values) && relationAllConsecutive (0) (values))

@[expose] public def validateMigrationOrder (values : List (Nat)) : Bool := (nonEmptyNatList (values) && relationAllConsecutive (0) (values))

@[expose] public def validateRollbackSafety (bound : Nat) (values : List (Nat)) : Bool := (nonEmptyNatList (values) && ((Nat.blt (0) (bound)) && relationAllBelow (bound) (values)))

@[expose] public def validateEvidenceClosure (bound : Nat) (values : List (Nat)) : Bool := (nonEmptyNatList (values) && ((Nat.blt (0) (bound)) && relationAllBelow (bound) (values)))

@[expose] public def validateLicenseClosure (values : List (Nat)) : Bool := (nonEmptyNatList (values) && relationAllPositive (values))

@[expose, reducible] public def licenseClosureValid (values : List (Nat)) : Prop := (validateLicenseClosure (values) = true)

public theorem licenseClosure_sound_complete (values : List (Nat)) : ((validateLicenseClosure (values) = true) <-> licenseClosureValid (values)) := by
  rfl

@[expose] public def validateReleaseCompleteness (values : List (Nat)) : Bool := (nonEmptyNatList (values) && relationAllConsecutive (0) (values))

end PrismPM.Production.Validation
