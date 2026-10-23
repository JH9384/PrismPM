module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.View.V1.Interaction

public inductive Action where
  | Submit
  | Enter

public inductive FocusBehavior where
  | RetainFocus
  | MoveFocusToResult

public inductive LiveMode where
  | Off
  | Polite
  | Assertive

public inductive ResultKind where
  | Calculation
  | InputError
  | DomainError

public structure ActionBinding where
  action : Action
  intent : String
  requestBinding : String

public structure ResultBinding where
  kind : ResultKind
  message : String
  focus : FocusBehavior
  live : LiveMode

end PrismPM.Foundation.View.V1.Interaction
