module
public import Init
public import LexLeanRuntime.Portable
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Integer

@[expose] public def checkedAddInt64 (left : Int64) (right : Int64) : Option (Int64) := (LexLeanRuntime.checkedAddInt64 (left) (right) : Option (Int64))

@[expose] public def checkedSubtractInt64 (left : Int64) (right : Int64) : Option (Int64) := (LexLeanRuntime.checkedSubtractInt64 (left) (right) : Option (Int64))

@[expose] public def checkedMultiplyInt64 (left : Int64) (right : Int64) : Option (Int64) := (LexLeanRuntime.checkedMultiplyInt64 (left) (right) : Option (Int64))

@[expose] public def checkedNegateInt64 (value : Int64) : Option (Int64) := (LexLeanRuntime.checkedNegateInt64 (value) : Option (Int64))

@[expose] public def checkedDivideInt64 (left : Int64) (right : Int64) : Option (Int64) := (LexLeanRuntime.checkedQuotientInt64 (left) (right) : Option (Int64))

end PrismPM.Foundation.Integer
