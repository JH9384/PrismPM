module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.View.Text.V1.Model

public structure TextView where
  title : String
  heading : String
  inputLabel : String
  submitLabel : String
  outputLabel : String
  inputError : String
  responseError : String

public structure AcceptanceVector where
  request : ByteArray
  response : ByteArray

public structure TextApplication where
  profile : String
  name : String
  cargoName : String
  cargoVersion : String
  cargoDescription : String
  cargoRepository : String
  cargoHomepage : String
  libraryRoots : List (String)
  acceptanceVectors : List (AcceptanceVector)
  entryRoot : String
  coreContract : String
  requestMaximum : UInt32
  responseMaximum : UInt32
  guestAllocationMaximum : UInt32
  capabilitiesEmpty : Bool
  fatArchive : Bool
  primaryLayer : UInt8
  viewLayer : UInt8
  view : TextView

@[expose] public def textApplicationProfile : String := "prismpm/text-application/1"

end PrismPM.Foundation.View.Text.V1.Model
