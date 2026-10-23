module
public import Init
public import LexLeanRuntime.Portable
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Utf8

@[expose] public def encode (value : String) : ByteArray := (LexLeanRuntime.utf8Encode (value) : ByteArray)

@[expose] public def decode (value : ByteArray) : Option (String) := (LexLeanRuntime.utf8Decode (value) : Option (String))

end PrismPM.Foundation.Utf8
