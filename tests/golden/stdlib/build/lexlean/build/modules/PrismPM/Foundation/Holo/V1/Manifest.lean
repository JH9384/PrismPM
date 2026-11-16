module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Holo.V1.Manifest

public inductive LayerKind where
  | WasmCodemodule
  | TensorPlan
  | RootfsImage
  | View
  | InferenceModel

@[expose] public def layerKindCode (kind : LayerKind) : Nat := (match kind with | LayerKind.WasmCodemodule => 0 | LayerKind.TensorPlan => 1 | LayerKind.RootfsImage => 2 | LayerKind.View => 3 | LayerKind.InferenceModel => 4)

@[expose] public def layerKindOfCode (code : Nat) : Option (LayerKind) := (if (Nat.beq (code) (0)) then Option.some (LayerKind.WasmCodemodule) else (if (Nat.beq (code) (1)) then Option.some (LayerKind.TensorPlan) else (if (Nat.beq (code) (2)) then Option.some (LayerKind.RootfsImage) else (if (Nat.beq (code) (3)) then Option.some (LayerKind.View) else (if (Nat.beq (code) (4)) then Option.some (LayerKind.InferenceModel) else Option.none)))))

@[expose] public def layerKindRoundTrip (code : Nat) : Bool := (match layerKindOfCode (code) with | Option.none => false | Option.some kind => (Nat.beq (layerKindCode (kind)) (code)))

@[expose] public def layerKindCodesClosed : Bool := (layerKindRoundTrip (0) && (layerKindRoundTrip (1) && (layerKindRoundTrip (2) && (layerKindRoundTrip (3) && (layerKindRoundTrip (4) && ((!layerKindRoundTrip (5)) && true))))))

public theorem layerKindCodesBijective : (layerKindCodesClosed = true) := by
  rfl

public structure Layer where
  kind : LayerKind
  contentKappa : ByteArray
  entry : String
  auxiliary : String

public structure Child where
  applicationKappa : ByteArray
  capabilitiesKappa : ByteArray

public structure AppManifest where
  primary : Option (UInt32)
  requires : ByteArray
  layers : List (Layer)
  children : List (Child)

end PrismPM.Foundation.Holo.V1.Manifest
