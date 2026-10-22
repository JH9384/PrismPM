module
public import Init
public import LexLeanRuntime.Portable
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Bytes

public inductive ByteOrder where
  | LittleEndian
  | BigEndian

public inductive BufferError where
  | OutOfBounds
  | LengthOverflow
  | NonCanonical

public structure BoundedBuffer where
  bytes : ByteArray
  maximum : UInt64

@[expose] public def appendBytes (left : ByteArray) (right : ByteArray) : ByteArray := (LexLeanRuntime.append (left) (right) : ByteArray)

@[expose] public def byteLength (value : ByteArray) : Nat := (LexLeanRuntime.length (value) : Nat)

@[expose] public def byteAt (value : ByteArray) (offset : Nat) : Option (UInt8) := (LexLeanRuntime.index (value) (offset) : Option (UInt8))

@[expose] public def sliceBytes (value : ByteArray) (start : Nat) (count : Nat) : Option (ByteArray) := (LexLeanRuntime.slice (value) (start) (count) : Option (ByteArray))

@[expose] public def compareBytes (left : ByteArray) (right : ByteArray) : Ordering := (LexLeanRuntime.compareBytes (left) (right) : Ordering)

end PrismPM.Foundation.Bytes
