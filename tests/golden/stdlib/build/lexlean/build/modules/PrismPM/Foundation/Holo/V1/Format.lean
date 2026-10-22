module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Holo.V1.Format

public inductive SectionKind where
  | KernelCalls
  | Metadata
  | Extension
  | AppManifest
  | ContentBlob

public structure Header where
  magic : ByteArray
  version : UInt16
  flags : UInt16
  sectionCount : UInt16

public structure SectionTableEntry where
  kind : UInt8
  offset : UInt64
  length : UInt64

@[expose] public def physicalVersion : UInt16 := (4 : UInt16)

@[expose] public def canonicalFlags : UInt16 := (0 : UInt16)

@[expose] public def magic : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 72)), (_root_.UInt8.ofNat (nat_lit 79)), (_root_.UInt8.ofNat (nat_lit 76)), (_root_.UInt8.ofNat (nat_lit 79))]

end PrismPM.Foundation.Holo.V1.Format
