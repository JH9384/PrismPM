module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Holo.V1.Format

public inductive SectionKind where
  | KernelCalls
  | Schedule
  | Weights
  | ShapeRegistry
  | DTypeRegistry
  | Certificates
  | Trace
  | Metadata
  | Inputs
  | Outputs
  | Constants
  | ExecPlan
  | WarmStart
  | Extension
  | AppManifest
  | ContentBlob

@[expose] public def sectionKindCode (kind : SectionKind) : Nat := (match kind with | SectionKind.KernelCalls => 1 | SectionKind.Schedule => 2 | SectionKind.Weights => 3 | SectionKind.ShapeRegistry => 4 | SectionKind.DTypeRegistry => 5 | SectionKind.Certificates => 6 | SectionKind.Trace => 7 | SectionKind.Metadata => 8 | SectionKind.Inputs => 9 | SectionKind.Outputs => 10 | SectionKind.Constants => 11 | SectionKind.ExecPlan => 12 | SectionKind.WarmStart => 13 | SectionKind.Extension => 14 | SectionKind.AppManifest => 15 | SectionKind.ContentBlob => 16)

@[expose] public def sectionKindOfCode (code : Nat) : Option (SectionKind) := (if (Nat.beq (code) (1)) then Option.some (SectionKind.KernelCalls) else (if (Nat.beq (code) (2)) then Option.some (SectionKind.Schedule) else (if (Nat.beq (code) (3)) then Option.some (SectionKind.Weights) else (if (Nat.beq (code) (4)) then Option.some (SectionKind.ShapeRegistry) else (if (Nat.beq (code) (5)) then Option.some (SectionKind.DTypeRegistry) else (if (Nat.beq (code) (6)) then Option.some (SectionKind.Certificates) else (if (Nat.beq (code) (7)) then Option.some (SectionKind.Trace) else (if (Nat.beq (code) (8)) then Option.some (SectionKind.Metadata) else (if (Nat.beq (code) (9)) then Option.some (SectionKind.Inputs) else (if (Nat.beq (code) (10)) then Option.some (SectionKind.Outputs) else (if (Nat.beq (code) (11)) then Option.some (SectionKind.Constants) else (if (Nat.beq (code) (12)) then Option.some (SectionKind.ExecPlan) else (if (Nat.beq (code) (13)) then Option.some (SectionKind.WarmStart) else (if (Nat.beq (code) (14)) then Option.some (SectionKind.Extension) else (if (Nat.beq (code) (15)) then Option.some (SectionKind.AppManifest) else (if (Nat.beq (code) (16)) then Option.some (SectionKind.ContentBlob) else Option.none))))))))))))))))

@[expose] public def sectionKindRoundTrip (code : Nat) : Bool := (match sectionKindOfCode (code) with | Option.none => false | Option.some kind => (Nat.beq (sectionKindCode (kind)) (code)))

@[expose] public def sectionKindCodesClosed : Bool := (sectionKindRoundTrip (1) && (sectionKindRoundTrip (2) && (sectionKindRoundTrip (3) && (sectionKindRoundTrip (4) && (sectionKindRoundTrip (5) && (sectionKindRoundTrip (6) && (sectionKindRoundTrip (7) && (sectionKindRoundTrip (8) && (sectionKindRoundTrip (9) && (sectionKindRoundTrip (10) && (sectionKindRoundTrip (11) && (sectionKindRoundTrip (12) && (sectionKindRoundTrip (13) && (sectionKindRoundTrip (14) && (sectionKindRoundTrip (15) && (sectionKindRoundTrip (16) && ((!sectionKindRoundTrip (0)) && ((!sectionKindRoundTrip (17)) && true))))))))))))))))))

public theorem sectionKindCodesBijective : (sectionKindCodesClosed = true) := by
  rfl

@[expose] public def sectionKindRepeatable (kind : SectionKind) : Bool := (match kind with | SectionKind.Extension => true | SectionKind.ContentBlob => true | SectionKind.KernelCalls => false | SectionKind.Schedule => false | SectionKind.Weights => false | SectionKind.ShapeRegistry => false | SectionKind.DTypeRegistry => false | SectionKind.Certificates => false | SectionKind.Trace => false | SectionKind.Metadata => false | SectionKind.Inputs => false | SectionKind.Outputs => false | SectionKind.Constants => false | SectionKind.ExecPlan => false | SectionKind.WarmStart => false | SectionKind.AppManifest => false)

@[expose] public def sectionKindRank (kind : SectionKind) : Nat := (match kind with | SectionKind.AppManifest => 1 | SectionKind.KernelCalls => 2 | SectionKind.Schedule => 3 | SectionKind.Weights => 4 | SectionKind.ShapeRegistry => 5 | SectionKind.DTypeRegistry => 6 | SectionKind.Certificates => 7 | SectionKind.Trace => 8 | SectionKind.Metadata => 9 | SectionKind.Inputs => 10 | SectionKind.Outputs => 11 | SectionKind.Constants => 12 | SectionKind.ExecPlan => 13 | SectionKind.WarmStart => 14 | SectionKind.Extension => 15 | SectionKind.ContentBlob => 16)

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
