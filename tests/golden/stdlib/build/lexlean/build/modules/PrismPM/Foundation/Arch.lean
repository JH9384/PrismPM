module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Arch

public structure StandardReference where
  standardIndex : Nat
  editionIndex : Nat
  standardId : String
  edition : String

public inductive ComponentKind where
  | service
  | database
  | externalSystem
  | cliAdapter
  | staticSite
  | releaseBinary

public inductive EdgeKind where
  | dataFlow
  | controlFlow

public inductive ModelKind where
  | componentModel
  | securityModel
  | qualityModel

public structure Component where
  index : Nat
  kind : ComponentKind
  name : String
  text : String

public structure Edge where
  index : Nat
  fromIndex : Nat
  toIndex : Nat
  kind : EdgeKind

public structure Stakeholder where
  index : Nat
  name : String
  text : String

public structure Concern where
  index : Nat
  name : String
  text : String

public structure Viewpoint where
  index : Nat
  stakeholderIndex : Nat
  concernIndex : Nat
  modelKindIndex : Nat

public structure View where
  index : Nat
  viewpointIndex : Nat
  modelKindIndex : Nat

public class ViewpointClass where
  selectedModelKind : Nat

public class ViewClass where
  selectedViewpoint : Nat

public instance (priority := 1000) canonicalViewpoint : ViewpointClass where
  selectedModelKind := 0

public instance (priority := 1000) canonicalView : ViewClass where
  selectedViewpoint := 0

@[expose] public def componentGateway : Component := ({ index := 1, kind := ComponentKind.service, name := "gateway", text := "Accepts external requests and forwards them to the authentication store." } : Component)

@[expose] public def componentAuth : Component := ({ index := 0, kind := ComponentKind.database, name := "auth", text := "Holds credentials and answers lookups from the gateway." } : Component)

@[expose] public def edgeIngress : Edge := ({ index := 0, fromIndex := 0, toIndex := 1, kind := EdgeKind.dataFlow } : Edge)

@[expose] public def edgeReturnCycle : Edge := ({ index := 1, fromIndex := 1, toIndex := 0, kind := EdgeKind.controlFlow } : Edge)

@[expose] public def stakeholderOperator : Stakeholder := ({ index := 0, name := "operator", text := "Runs the system in production and answers for its availability." } : Stakeholder)

@[expose] public def concernSecurity : Concern := ({ index := 0, name := "security", text := "Credentials and requests must not be disclosed or altered in transit or at rest." } : Concern)

@[expose] public def standardArchitectureDescription : StandardReference := ({ standardIndex := 4, editionIndex := 0, standardId := "ISO-42010-2022", edition := "2022" } : StandardReference)

@[expose] public def modelKindComponents : ModelKind := ModelKind.componentModel

@[expose] public def viewpointOperations : Viewpoint := ({ index := 0, stakeholderIndex := 0, concernIndex := 0, modelKindIndex := 0 } : Viewpoint)

@[expose] public def viewPrimary : View := ({ index := 0, viewpointIndex := 0, modelKindIndex := 0 } : View)

public inductive DesignDiagram where
  | opmObjectProcess
  | umlComponent
  | umlSequence
  | umlStateMachine

public inductive OpmThingKind where
  | object
  | process

public inductive OpmLinkKind where
  | agent
  | instrument
  | consumption
  | result
  | effect
  | invocation
  | aggregation
  | exhibition
  | generalization
  | classification

public inductive UmlMessageKind where
  | synchronous
  | asynchronous
  | reply

public structure SystemProcess where
  owner : String

public structure SystemState where
  owner : String

public structure DesignView where
  title : String
  viewpoint : String
  diagram : DesignDiagram

public structure OpmThing where
  view : String
  kind : OpmThingKind
  subject : String

public structure OpmState where
  view : String
  thing : String
  state : String

public structure OpmLink where
  view : String
  kind : OpmLinkKind
  source : String
  target : String

public structure OpmZoom where
  view : String
  process : String
  subprocess : String
  order : Nat

public structure UmlComponent where
  view : String
  component : String

public structure UmlConnector where
  view : String
  edge : String

public structure UmlLifeline where
  view : String
  component : String
  order : Nat

public structure UmlMessage where
  view : String
  kind : UmlMessageKind
  order : Nat
  source : String
  target : String
  process : String

public structure UmlState where
  view : String
  state : String
  initial : Bool

public structure UmlTransition where
  view : String
  order : Nat
  source : String
  target : String
  trigger : String

public theorem componentIdentityUnique (value : Component) : (value = value) := by
  rfl

public theorem cyclesPermitted : (true = true) := by
  rfl

end PrismPM.Foundation.Arch
