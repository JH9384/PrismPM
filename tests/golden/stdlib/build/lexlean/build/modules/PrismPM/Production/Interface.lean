module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.Interface

public inductive InterfaceKind where
  | OpenApi
  | AsyncApi
  | CloudEvents
  | Internal

public inductive Delivery where
  | Synchronous
  | AtLeastOnce
  | ExactlyOnceLocal

public structure Schema where
  id : String
  kind : String
  value : String
  dependsOn : List (String)
  compatibility : String

public structure Interface where
  id : String
  kind : String
  document : String
  authentication : String
  compatibility : String
  protocol : String
  errors : List (String)
  acceptance : List (String)

public structure Call where
  id : String
  kind : String
  value : String
  dependsOn : List (String)
  fromComponent : String
  toComponent : String
  interfaceId : String
  failurePropagation : String
  timeoutMillis : UInt64
  retryPolicy : String
  idempotency : String

public structure Event where
  id : String
  kind : String
  value : String
  dependsOn : List (String)
  producer : String
  channel : String
  schemaId : String
  owner : String
  delivery : String
  ordering : String
  idempotency : String
  failurePropagation : String

public structure Flow where
  id : String
  fromComponent : String
  toComponent : String
  interfaceId : String
  delivery : String
  ordering : String
  idempotency : String
  failurePropagation : String

end PrismPM.Production.Interface
