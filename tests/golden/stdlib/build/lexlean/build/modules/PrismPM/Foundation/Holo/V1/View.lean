module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Holo.V1.View

public structure PortableAsset where
  path : String
  content : ByteArray

public structure PortableBundle where
  version : UInt16
  entry : String
  files : List (PortableAsset)

public inductive ViewError where
  | BadMagic
  | BadVersion
  | InvalidPath
  | DuplicatePath
  | CaseFoldCollision
  | WrongOrder
  | MissingEntry
  | Truncated
  | TrailingBytes
  | ResourceLimit
  | UnsupportedSurface
  | IntentMismatch

@[expose] public def magic : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 72)), (_root_.UInt8.ofNat (nat_lit 79)), (_root_.UInt8.ofNat (nat_lit 76)), (_root_.UInt8.ofNat (nat_lit 79)), (_root_.UInt8.ofNat (nat_lit 86)), (_root_.UInt8.ofNat (nat_lit 73)), (_root_.UInt8.ofNat (nat_lit 69)), (_root_.UInt8.ofNat (nat_lit 87))]

@[expose] public def bundleVersion : UInt16 := (1 : UInt16)

@[expose] public def entry : String := "index.html"

@[expose] public def maximumFiles : UInt32 := (4096 : UInt32)

@[expose] public def maximumPathBytes : UInt32 := (1024 : UInt32)

@[expose] public def maximumFileBytes : UInt64 := (67108864 : UInt64)

@[expose] public def maximumAggregateBytes : UInt64 := (268435456 : UInt64)

end PrismPM.Foundation.Holo.V1.View
