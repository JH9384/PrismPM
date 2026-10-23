module
public import Init
public import LexLeanRuntime.Portable
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Codec

public structure BoundedCursor where
  bytes : ByteArray
  offset : Nat
  limit : Nat

@[expose] public def formatInt64 (value : Int64) : String := (LexLeanRuntime.formatDecimal (value) : String)

@[expose] public def parseInt64 (value : String) : Option (Int64) := (LexLeanRuntime.parseDecimal (value) : Option (Int64))

end PrismPM.Foundation.Codec
