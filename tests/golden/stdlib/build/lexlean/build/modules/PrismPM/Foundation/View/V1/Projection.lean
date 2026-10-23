module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.View.V1.Projection

public inductive Target where
  | HologramIntent
  | PagesWasmBindgen

public inductive ForbiddenContent where
  | RawHtml
  | RawCss
  | RawScript
  | Url
  | HostCommand

public structure ProjectionBinding where
  target : Target
  modelId : ByteArray
  viewModelId : ByteArray
  generatedCoreSha256 : ByteArray
  transport : String
  escaped : Bool
  rawContentAllowed : Bool

end PrismPM.Foundation.View.V1.Projection
