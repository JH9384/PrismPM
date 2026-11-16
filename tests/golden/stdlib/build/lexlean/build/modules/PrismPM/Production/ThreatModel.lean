module
public import Init
public import PrismPM.Foundation.Sec
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.ThreatModel

public inductive Stride where
  | spoofing
  | tampering
  | repudiation
  | informationDisclosure
  | denialOfService
  | elevationOfPrivilege

public inductive EvidenceKind where
  | gate
  | proof
  | review

public structure Evidence where
  kind : EvidenceKind
  reference : String

public structure ControlSet where
  title : String
  text : String
  version : String
  lastModified : String

public structure ModeledAsset where
  asset : String
  name : String
  text : String

public structure ModeledThreat where
  threat : String
  name : String
  text : String
  category : Stride

public structure ModeledControl where
  control : String
  name : String
  text : String
  evidence : List (Evidence)

public structure ThreatMapping where
  threat : String
  controls : List (String)

public structure AcceptedRisk where
  threat : String
  rationale : String

public structure NormalizedThreatModel where
  threatCount : Nat
  categoryCounts : List (Nat)
  mitigationCounts : List (Nat)
  acceptanceCounts : List (Nat)
  evidenceCounts : List (Nat)

@[expose] public def threatListLength : (values : List (Nat)) -> Nat
  | List.nil => 0
  | List.cons _ rest => (threatListLength (rest) + 1)

@[expose] public def threatAllPositive : (values : List (Nat)) -> Bool
  | List.nil => true
  | List.cons value rest => ((Nat.blt (0) (value)) && threatAllPositive (rest))

@[expose] public def validateThreatsAnswered : (mitigations : List (Nat)) -> (acceptances : List (Nat)) -> Bool
  | List.nil, _acceptances => true
  | List.cons mitigation rest, acceptances => (match acceptances with | List.nil => ((Nat.blt (0) (mitigation)) && validateThreatsAnswered (rest) (acceptances)) | List.cons acceptance others => (((Nat.blt (0) (mitigation)) || (Nat.blt (0) (acceptance))) && validateThreatsAnswered (rest) (others)))

@[expose] public def validateThreatCategories (categoryCounts : List (Nat)) : Bool := threatAllPositive (categoryCounts)

@[expose] public def validateControlEvidence (evidenceCounts : List (Nat)) : Bool := threatAllPositive (evidenceCounts)

@[expose] public def validateNormalizedThreatModel (model : NormalizedThreatModel) : Bool := ((Nat.beq (threatListLength ((model).categoryCounts)) ((model).threatCount)) && ((Nat.beq (threatListLength ((model).mitigationCounts)) ((model).threatCount)) && ((Nat.beq (threatListLength ((model).acceptanceCounts)) ((model).threatCount)) && (validateThreatCategories ((model).categoryCounts) && (validateThreatsAnswered ((model).mitigationCounts) ((model).acceptanceCounts) && validateControlEvidence ((model).evidenceCounts))))))

@[expose, reducible] public def normalizedThreatModelValid (model : NormalizedThreatModel) : Prop := (validateNormalizedThreatModel (model) = true)

public theorem normalizedThreatModel_sound_complete (model : NormalizedThreatModel) : ((validateNormalizedThreatModel (model) = true) <-> normalizedThreatModelValid (model)) := by
  rfl

@[expose] public def threatModelVector (categoryCounts : List (Nat)) (mitigationCounts : List (Nat)) (acceptanceCounts : List (Nat)) (evidenceCounts : List (Nat)) : NormalizedThreatModel := ({ threatCount := 2, categoryCounts := categoryCounts, mitigationCounts := mitigationCounts, acceptanceCounts := acceptanceCounts, evidenceCounts := evidenceCounts } : NormalizedThreatModel)

public theorem threatModelVectorAccepted : (validateNormalizedThreatModel (threatModelVector ((1 :: (1 :: ([] : List (Nat))))) ((2 :: (0 :: ([] : List (Nat))))) ((0 :: (1 :: ([] : List (Nat))))) ((1 :: (2 :: ([] : List (Nat)))))) = true) := by
  decide

public theorem unmappedThreatRefused : (validateNormalizedThreatModel (threatModelVector ((1 :: (1 :: ([] : List (Nat))))) ((2 :: (0 :: ([] : List (Nat))))) ((0 :: (0 :: ([] : List (Nat))))) ((1 :: (2 :: ([] : List (Nat)))))) = false) := by
  decide

public theorem controlWithoutEvidenceRefused : (validateNormalizedThreatModel (threatModelVector ((1 :: (1 :: ([] : List (Nat))))) ((2 :: (0 :: ([] : List (Nat))))) ((0 :: (1 :: ([] : List (Nat))))) ((1 :: (0 :: ([] : List (Nat)))))) = false) := by
  decide

public theorem threatWithoutCategoryRefused : (validateNormalizedThreatModel (threatModelVector ((1 :: (0 :: ([] : List (Nat))))) ((2 :: (0 :: ([] : List (Nat))))) ((0 :: (1 :: ([] : List (Nat))))) ((1 :: (2 :: ([] : List (Nat)))))) = false) := by
  decide

end PrismPM.Production.ThreatModel
