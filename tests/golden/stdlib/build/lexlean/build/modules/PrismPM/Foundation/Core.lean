module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Core

public inductive UnitValue where
  | UnitValue

@[expose] public def portableTrue : Bool := true

end PrismPM.Foundation.Core
