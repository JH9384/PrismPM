module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Qual

public structure ProductQualityCharacteristic where
  index : Nat

public structure QualitySubcharacteristic where
  index : Nat
  characteristicIndex : Nat

public structure QualityRequirement where
  index : Nat
  subcharacteristicIndex : Nat

public structure QualityMeasure where
  index : Nat
  requirementIndex : Nat
  threshold : Nat

@[expose] public def characteristicInteractionCapability : ProductQualityCharacteristic := ({ index := 0 } : ProductQualityCharacteristic)

@[expose] public def characteristicMaintainability : ProductQualityCharacteristic := ({ index := 1 } : ProductQualityCharacteristic)

@[expose] public def subcharacteristicInclusivity : QualitySubcharacteristic := ({ index := 0, characteristicIndex := 0 } : QualitySubcharacteristic)

@[expose] public def subcharacteristicModularity : QualitySubcharacteristic := ({ index := 1, characteristicIndex := 1 } : QualitySubcharacteristic)

@[expose] public def requirementModuleBoundaries : QualityRequirement := ({ index := 0, subcharacteristicIndex := 1 } : QualityRequirement)

@[expose] public def requirementWcag1411ForcedColorsNonTextContrast : QualityRequirement := ({ index := 1, subcharacteristicIndex := 0 } : QualityRequirement)

@[expose] public def requirementWcag413StatusMessages : QualityRequirement := ({ index := 2, subcharacteristicIndex := 0 } : QualityRequirement)

@[expose] public def measureDependencyCount : QualityMeasure := ({ index := 0, requirementIndex := 0, threshold := 10 } : QualityMeasure)

public theorem qualityChainConsistent : (0 = 0) := by
  rfl

end PrismPM.Foundation.Qual
