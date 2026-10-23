module
public import Init
public import LexLeanRuntime.Portable
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Native.Application.V1.Lease

public structure NativeLeaseBinding where
  application : ByteArray
  manifest : ByteArray
  session : ByteArray
  resource : ByteArray
  operation : Nat
  requestDigest : ByteArray
  deadline : Nat

public structure NativeLease where
  binding : NativeLeaseBinding
  cancelled : Bool
  uncertain : Bool

public structure NativeLane where
  application : ByteArray
  manifest : ByteArray
  session : ByteArray
  resource : ByteArray
  nextOperation : Nat
  observed : Nat
  closed : Bool
  active : Option (NativeLease)

public inductive NativeLeaseError where
  | BadState
  | ClockRegression
  | Closed
  | Busy
  | Exhausted
  | BadRequest
  | Expired
  | NoPending
  | BadBinding
  | CancellationRequired
  | CleanupRequired

@[expose] public def nativeBindingEqual (left : NativeLeaseBinding) (right : NativeLeaseBinding) : Bool := ((LexLeanRuntime.equal ((left).application) ((right).application) : Bool) && ((LexLeanRuntime.equal ((left).manifest) ((right).manifest) : Bool) && ((LexLeanRuntime.equal ((left).session) ((right).session) : Bool) && ((LexLeanRuntime.equal ((left).resource) ((right).resource) : Bool) && ((LexLeanRuntime.equal ((left).operation) ((right).operation) : Bool) && ((LexLeanRuntime.equal ((left).requestDigest) ((right).requestDigest) : Bool) && ((LexLeanRuntime.equal ((left).deadline) ((right).deadline) : Bool) && true)))))))

@[expose] public def nativeLaneValid (state : NativeLane) : Bool := ((LexLeanRuntime.equal ((LexLeanRuntime.length ((state).application) : Nat)) (32) : Bool) && ((LexLeanRuntime.equal ((LexLeanRuntime.length ((state).manifest) : Nat)) (32) : Bool) && ((LexLeanRuntime.equal ((LexLeanRuntime.length ((state).session) : Nat)) (32) : Bool) && ((LexLeanRuntime.equal ((LexLeanRuntime.length ((state).resource) : Nat)) (32) : Bool) && ((Nat.ble ((state).nextOperation) (18446744073709551615)) && ((Nat.ble ((state).observed) (18446744073709551615)) && ((match (state).active with | Option.none => true | Option.some active => ((LexLeanRuntime.equal ((state).application) (((active).binding).application) : Bool) && ((LexLeanRuntime.equal ((state).manifest) (((active).binding).manifest) : Bool) && ((LexLeanRuntime.equal ((state).session) (((active).binding).session) : Bool) && ((LexLeanRuntime.equal ((state).resource) (((active).binding).resource) : Bool) && ((LexLeanRuntime.equal ((LexLeanRuntime.length (((active).binding).requestDigest) : Nat)) (32) : Bool) && ((match (LexLeanRuntime.equal (((active).binding).operation) (18446744073709551615) : Bool) with | Bool.false => (LexLeanRuntime.equal ((state).nextOperation) ((((active).binding).operation + 1)) : Bool) | Bool.true => false) && ((Nat.ble (((active).binding).operation) (18446744073709551615)) && ((!(LexLeanRuntime.equal (((active).binding).deadline) (0) : Bool)) && ((Nat.ble (((active).binding).deadline) (18446744073709551615)) && (((!(state).closed) || ((active).cancelled || false)) && true))))))))))) && true)))))))

@[expose] public def openNativeLane (application : ByteArray) (manifest : ByteArray) (session : ByteArray) (resource : ByteArray) : Except (NativeLeaseError) (NativeLane) := (match ((LexLeanRuntime.equal ((LexLeanRuntime.length (application) : Nat)) (32) : Bool) && ((LexLeanRuntime.equal ((LexLeanRuntime.length (manifest) : Nat)) (32) : Bool) && ((LexLeanRuntime.equal ((LexLeanRuntime.length (session) : Nat)) (32) : Bool) && ((LexLeanRuntime.equal ((LexLeanRuntime.length (resource) : Nat)) (32) : Bool) && true)))) with | Bool.false => Except.error (NativeLeaseError.BadState) | Bool.true => Except.ok (({ application := application, manifest := manifest, session := session, resource := resource, nextOperation := 0, observed := 0, closed := false, active := Option.none } : NativeLane)))

@[expose] public def beginNativeLease (state : NativeLane) (requestDigest : ByteArray) (now : Nat) (deadline : Nat) : Except (NativeLeaseError) (NativeLane) := (match nativeLaneValid (state) with | Bool.false => Except.error (NativeLeaseError.BadState) | Bool.true => (match ((Nat.ble ((state).observed) (now)) && ((Nat.ble (now) (18446744073709551615)) && true)) with | Bool.false => Except.error (NativeLeaseError.ClockRegression) | Bool.true => (match (state).closed with | Bool.false => (match (state).active with | Option.some _ => Except.error (NativeLeaseError.Busy) | Option.none => (match (LexLeanRuntime.equal ((state).nextOperation) (18446744073709551615) : Bool) with | Bool.false => (match ((LexLeanRuntime.equal ((LexLeanRuntime.length (requestDigest) : Nat)) (32) : Bool) && ((Nat.ble (deadline) (18446744073709551615)) && true)) with | Bool.false => Except.error (NativeLeaseError.BadRequest) | Bool.true => (match (!(Nat.ble (deadline) (now))) with | Bool.false => Except.error (NativeLeaseError.Expired) | Bool.true => Except.ok (({ application := (state).application, manifest := (state).manifest, session := (state).session, resource := (state).resource, nextOperation := ((state).nextOperation + 1), observed := now, closed := (state).closed, active := Option.some (({ binding := ({ application := (state).application, manifest := (state).manifest, session := (state).session, resource := (state).resource, operation := (state).nextOperation, requestDigest := requestDigest, deadline := deadline } : NativeLeaseBinding), cancelled := false, uncertain := false } : NativeLease)) } : NativeLane)))) | Bool.true => Except.error (NativeLeaseError.Exhausted))) | Bool.true => Except.error (NativeLeaseError.Closed))))

@[expose] public def cancelNativeLease (state : NativeLane) (now : Nat) : Except (NativeLeaseError) (NativeLane) := (match nativeLaneValid (state) with | Bool.false => Except.error (NativeLeaseError.BadState) | Bool.true => (match ((Nat.ble ((state).observed) (now)) && ((Nat.ble (now) (18446744073709551615)) && true)) with | Bool.false => Except.error (NativeLeaseError.ClockRegression) | Bool.true => (match (state).active with | Option.none => Except.error (NativeLeaseError.NoPending) | Option.some active => Except.ok (({ application := (state).application, manifest := (state).manifest, session := (state).session, resource := (state).resource, nextOperation := (state).nextOperation, observed := now, closed := (state).closed, active := Option.some (({ binding := ({ application := ((active).binding).application, manifest := ((active).binding).manifest, session := ((active).binding).session, resource := ((active).binding).resource, operation := ((active).binding).operation, requestDigest := ((active).binding).requestDigest, deadline := ((active).binding).deadline } : NativeLeaseBinding), cancelled := true, uncertain := (active).uncertain } : NativeLease)) } : NativeLane)))))

@[expose] public def closeNativeLane (state : NativeLane) (now : Nat) : Except (NativeLeaseError) (NativeLane) := (match nativeLaneValid (state) with | Bool.false => Except.error (NativeLeaseError.BadState) | Bool.true => (match ((Nat.ble ((state).observed) (now)) && ((Nat.ble (now) (18446744073709551615)) && true)) with | Bool.false => Except.error (NativeLeaseError.ClockRegression) | Bool.true => Except.ok (({ application := (state).application, manifest := (state).manifest, session := (state).session, resource := (state).resource, nextOperation := (state).nextOperation, observed := now, closed := true, active := (match (state).active with | Option.none => Option.none | Option.some active => Option.some (({ binding := ({ application := ((active).binding).application, manifest := ((active).binding).manifest, session := ((active).binding).session, resource := ((active).binding).resource, operation := ((active).binding).operation, requestDigest := ((active).binding).requestDigest, deadline := ((active).binding).deadline } : NativeLeaseBinding), cancelled := true, uncertain := (active).uncertain } : NativeLease))) } : NativeLane))))

@[expose] public def completeNativeLease (state : NativeLane) (completion : NativeLeaseBinding) (now : Nat) : Except (NativeLeaseError) (NativeLane) := (match nativeLaneValid (state) with | Bool.false => Except.error (NativeLeaseError.BadState) | Bool.true => (match ((Nat.ble ((state).observed) (now)) && ((Nat.ble (now) (18446744073709551615)) && true)) with | Bool.false => Except.error (NativeLeaseError.ClockRegression) | Bool.true => (match (state).active with | Option.none => Except.error (NativeLeaseError.NoPending) | Option.some active => (match nativeBindingEqual ((active).binding) (completion) with | Bool.false => Except.error (NativeLeaseError.BadBinding) | Bool.true => (match ((state).closed || ((active).cancelled || false)) with | Bool.false => (match (active).uncertain with | Bool.false => (match (Nat.ble (((active).binding).deadline) (now)) with | Bool.false => Except.ok (({ application := (state).application, manifest := (state).manifest, session := (state).session, resource := (state).resource, nextOperation := (state).nextOperation, observed := now, closed := (state).closed, active := Option.none } : NativeLane)) | Bool.true => Except.error (NativeLeaseError.Expired)) | Bool.true => Except.error (NativeLeaseError.CleanupRequired)) | Bool.true => Except.error (NativeLeaseError.CancellationRequired))))))

@[expose] public def retainUnknownNativeCleanup (state : NativeLane) (completion : NativeLeaseBinding) (now : Nat) : Except (NativeLeaseError) (NativeLane) := (match nativeLaneValid (state) with | Bool.false => Except.error (NativeLeaseError.BadState) | Bool.true => (match ((Nat.ble ((state).observed) (now)) && ((Nat.ble (now) (18446744073709551615)) && true)) with | Bool.false => Except.error (NativeLeaseError.ClockRegression) | Bool.true => (match (state).active with | Option.none => Except.error (NativeLeaseError.NoPending) | Option.some active => (match nativeBindingEqual ((active).binding) (completion) with | Bool.false => Except.error (NativeLeaseError.BadBinding) | Bool.true => Except.ok (({ application := (state).application, manifest := (state).manifest, session := (state).session, resource := (state).resource, nextOperation := (state).nextOperation, observed := now, closed := (state).closed, active := Option.some (({ binding := ({ application := ((active).binding).application, manifest := ((active).binding).manifest, session := ((active).binding).session, resource := ((active).binding).resource, operation := ((active).binding).operation, requestDigest := ((active).binding).requestDigest, deadline := ((active).binding).deadline } : NativeLeaseBinding), cancelled := (active).cancelled, uncertain := true } : NativeLease)) } : NativeLane))))))

@[expose] public def retireCancelledNativeLease (state : NativeLane) (completion : NativeLeaseBinding) (now : Nat) : Except (NativeLeaseError) (NativeLane) := (match nativeLaneValid (state) with | Bool.false => Except.error (NativeLeaseError.BadState) | Bool.true => (match ((Nat.ble ((state).observed) (now)) && ((Nat.ble (now) (18446744073709551615)) && true)) with | Bool.false => Except.error (NativeLeaseError.ClockRegression) | Bool.true => (match (state).active with | Option.none => Except.error (NativeLeaseError.NoPending) | Option.some active => (match nativeBindingEqual ((active).binding) (completion) with | Bool.false => Except.error (NativeLeaseError.BadBinding) | Bool.true => (match ((state).closed || ((active).cancelled || ((active).uncertain || ((Nat.ble (((active).binding).deadline) (now)) || false)))) with | Bool.false => Except.error (NativeLeaseError.CleanupRequired) | Bool.true => Except.ok (({ application := (state).application, manifest := (state).manifest, session := (state).session, resource := (state).resource, nextOperation := (state).nextOperation, observed := now, closed := (state).closed, active := Option.none } : NativeLane)))))))

end PrismPM.Foundation.Native.Application.V1.Lease
