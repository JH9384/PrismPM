module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
namespace PrismPM.Foundation.Native.Application.V1.Lease

namespace LexLeanRuntime

public class ToMathInt (α : Type) where
  toInt : α -> Int

public class Fixed (α : Type) extends ToMathInt α where
  fromInt : Int -> α
  minimum : Int
  maximum : Int
  bitAnd : α -> α -> α
  bitOr : α -> α -> α
  bitXor : α -> α -> α
  bitNot : α -> α
  shiftLeft : α -> UInt32 -> Option α
  shiftRight : α -> UInt32 -> Option α

public instance : ToMathInt Int where toInt := fun value => value

public instance : Fixed Int8 where
  toInt := Int8.toInt
  fromInt := Int8.ofInt
  minimum := -128
  maximum := 127
  bitAnd := Int8.land
  bitOr := Int8.lor
  bitXor := Int8.xor
  bitNot := Int8.complement
  shiftLeft := fun value amount => if amount.toNat < 8 then some (Int8.shiftLeft value (Int8.ofNat amount.toNat)) else none
  shiftRight := fun value amount => if amount.toNat < 8 then some (Int8.shiftRight value (Int8.ofNat amount.toNat)) else none

public instance : Fixed Int16 where
  toInt := Int16.toInt
  fromInt := Int16.ofInt
  minimum := -32768
  maximum := 32767
  bitAnd := Int16.land
  bitOr := Int16.lor
  bitXor := Int16.xor
  bitNot := Int16.complement
  shiftLeft := fun value amount => if amount.toNat < 16 then some (Int16.shiftLeft value (Int16.ofNat amount.toNat)) else none
  shiftRight := fun value amount => if amount.toNat < 16 then some (Int16.shiftRight value (Int16.ofNat amount.toNat)) else none

public instance : Fixed Int32 where
  toInt := Int32.toInt
  fromInt := Int32.ofInt
  minimum := -2147483648
  maximum := 2147483647
  bitAnd := Int32.land
  bitOr := Int32.lor
  bitXor := Int32.xor
  bitNot := Int32.complement
  shiftLeft := fun value amount => if amount.toNat < 32 then some (Int32.shiftLeft value (Int32.ofNat amount.toNat)) else none
  shiftRight := fun value amount => if amount.toNat < 32 then some (Int32.shiftRight value (Int32.ofNat amount.toNat)) else none

public instance : Fixed Int64 where
  toInt := Int64.toInt
  fromInt := Int64.ofInt
  minimum := -9223372036854775808
  maximum := 9223372036854775807
  bitAnd := Int64.land
  bitOr := Int64.lor
  bitXor := Int64.xor
  bitNot := Int64.complement
  shiftLeft := fun value amount => if amount.toNat < 64 then some (Int64.shiftLeft value (Int64.ofNat amount.toNat)) else none
  shiftRight := fun value amount => if amount.toNat < 64 then some (Int64.shiftRight value (Int64.ofNat amount.toNat)) else none

public instance : Fixed UInt8 where
  toInt := fun value => Int.ofNat value.toNat
  fromInt := UInt8.ofInt
  minimum := 0
  maximum := 255
  bitAnd := UInt8.land
  bitOr := UInt8.lor
  bitXor := UInt8.xor
  bitNot := UInt8.complement
  shiftLeft := fun value amount => if amount.toNat < 8 then some (UInt8.shiftLeft value (UInt8.ofNat amount.toNat)) else none
  shiftRight := fun value amount => if amount.toNat < 8 then some (UInt8.shiftRight value (UInt8.ofNat amount.toNat)) else none

public instance : Fixed UInt16 where
  toInt := fun value => Int.ofNat value.toNat
  fromInt := UInt16.ofInt
  minimum := 0
  maximum := 65535
  bitAnd := UInt16.land
  bitOr := UInt16.lor
  bitXor := UInt16.xor
  bitNot := UInt16.complement
  shiftLeft := fun value amount => if amount.toNat < 16 then some (UInt16.shiftLeft value (UInt16.ofNat amount.toNat)) else none
  shiftRight := fun value amount => if amount.toNat < 16 then some (UInt16.shiftRight value (UInt16.ofNat amount.toNat)) else none

public instance : Fixed UInt32 where
  toInt := fun value => Int.ofNat value.toNat
  fromInt := UInt32.ofInt
  minimum := 0
  maximum := 4294967295
  bitAnd := UInt32.land
  bitOr := UInt32.lor
  bitXor := UInt32.xor
  bitNot := UInt32.complement
  shiftLeft := fun value amount => if amount.toNat < 32 then some (UInt32.shiftLeft value amount) else none
  shiftRight := fun value amount => if amount.toNat < 32 then some (UInt32.shiftRight value amount) else none

public instance : Fixed UInt64 where
  toInt := fun value => Int.ofNat value.toNat
  fromInt := UInt64.ofInt
  minimum := 0
  maximum := 18446744073709551615
  bitAnd := UInt64.land
  bitOr := UInt64.lor
  bitXor := UInt64.xor
  bitNot := UInt64.complement
  shiftLeft := fun value amount => if amount.toNat < 64 then some (UInt64.shiftLeft value (UInt64.ofNat amount.toNat)) else none
  shiftRight := fun value amount => if amount.toNat < 64 then some (UInt64.shiftRight value (UInt64.ofNat amount.toNat)) else none

@[expose] public def checkedFromInt {α : Type} [Fixed α] (value : Int) : Option α :=
  if value < Fixed.minimum (α := α) then none else if Fixed.maximum (α := α) < value then none else some (Fixed.fromInt value)

@[expose] public def checkedConvert {α β : Type} [ToMathInt α] [Fixed β] (value : α) : Option β :=
  checkedFromInt (ToMathInt.toInt value)

@[expose] public def checkedAdd {α : Type} [Fixed α] (left right : α) : Option α :=
  checkedFromInt (ToMathInt.toInt left + ToMathInt.toInt right)

@[expose] public def checkedSubtract {α : Type} [Fixed α] (left right : α) : Option α :=
  checkedFromInt (ToMathInt.toInt left - ToMathInt.toInt right)

@[expose] public def checkedMultiply {α : Type} [Fixed α] (left right : α) : Option α :=
  checkedFromInt (ToMathInt.toInt left * ToMathInt.toInt right)

@[expose] public def checkedNegate {α : Type} [Fixed α] (value : α) : Option α :=
  checkedFromInt (-ToMathInt.toInt value)

@[expose] public def checkedQuotient {α : Type} [Fixed α] (left right : α) : Option α :=
  if ToMathInt.toInt right = 0 then none else checkedFromInt (Int.tdiv (ToMathInt.toInt left) (ToMathInt.toInt right))

@[expose] public def checkedAddInt64 (left right : Int64) : Option Int64 :=
  let value := left + right
  if (0 < right && value < left) || (right < 0 && left < value) then none else some value

@[expose] public def checkedSubtractInt64 (left right : Int64) : Option Int64 :=
  let value := left - right
  if (0 < right && left < value) || (right < 0 && value < left) then none else some value

@[expose] public def checkedNegateInt64 (value : Int64) : Option Int64 :=
  if value == (-9223372036854775808 : Int64) then none else some (-value)

public def magnitudeInt64 (value : Int64) : UInt64 :=
  let bits := value.toUInt64
  if value < 0 then 0 - bits else bits

public def signedMagnitudeInt64 (negative : Bool) (value : UInt64) : Int64 :=
  (if negative then 0 - value else value).toInt64

public def divideMagnitudeInt64 : Nat -> UInt64 -> UInt64 -> UInt64 -> UInt64 -> UInt64
  | 0, _, _, _, quotient => quotient
  | Nat.succ fuel, source, divisor, remainder, quotient =>
      let high := 9223372036854775808 <= source
      let source := source + source
      let remainder := remainder + remainder + if high then 1 else 0
      let quotient := quotient + quotient
      if divisor <= remainder then
        divideMagnitudeInt64 fuel source divisor (remainder - divisor) (quotient + 1)
      else
        divideMagnitudeInt64 fuel source divisor remainder quotient

@[expose] public def checkedQuotientInt64 (left right : Int64) : Option Int64 :=
  if right == 0 then none
  else if left == (-9223372036854775808 : Int64) && right == (-1 : Int64) then none
  else
    let negative := (left < 0) != (right < 0)
    some (signedMagnitudeInt64 negative
      (divideMagnitudeInt64 64 (magnitudeInt64 left) (magnitudeInt64 right) 0 0))

public def multiplyMagnitudeInt64 : Nat -> UInt64 -> UInt64 -> UInt64 -> Bool -> Option UInt64
  | 0, _, _, accumulator, _ => some accumulator
  | Nat.succ fuel, source, multiplicand, accumulator, negative =>
      let high := 9223372036854775808 <= source
      let limit := if negative then 9223372036854775808 else 9223372036854775807
      let halfLimit := if negative then 4611686018427387904 else 4611686018427387903
      if halfLimit < accumulator then none
      else
        let doubled := accumulator + accumulator
        if high then
          if limit < multiplicand || limit - multiplicand < doubled then none
          else multiplyMagnitudeInt64 fuel (source + source) multiplicand
            (doubled + multiplicand) negative
        else
          multiplyMagnitudeInt64 fuel (source + source) multiplicand doubled negative

@[expose] public def checkedMultiplyInt64 (left right : Int64) : Option Int64 :=
  let negative := (left < 0) != (right < 0)
  match multiplyMagnitudeInt64 64 (magnitudeInt64 right) (magnitudeInt64 left) 0 negative with
  | none => none
  | some value => some (signedMagnitudeInt64 negative value)

@[noinline] public def subtract {α : Type} [Sub α] (left right : α) : α := left - right
@[noinline] public def multiply {α : Type} [Mul α] (left right : α) : α := left * right
@[noinline] public def negate {α : Type} [Neg α] (value : α) : α := -value

public class Quotient (α : Type) where
  quotient : α -> α -> α
  remainder : α -> α -> α
  isZero : α -> Bool

public instance : Quotient Nat where
  quotient := Nat.div
  remainder := Nat.mod
  isZero := fun value => value == 0

public instance : Quotient Int where
  quotient := Int.tdiv
  remainder := Int.tmod
  isZero := fun value => value == 0

@[noinline] public def quotient {α : Type} [Quotient α] (left right zeroCase : α) : α :=
  if Quotient.isZero right then zeroCase else Quotient.quotient left right

@[noinline] public def remainder {α : Type} [Quotient α] (left right zeroCase : α) : α :=
  if Quotient.isZero right then zeroCase else Quotient.remainder left right

@[expose] public def bitAnd {α : Type} [Fixed α] (left right : α) : α := Fixed.bitAnd left right
@[expose] public def bitOr {α : Type} [Fixed α] (left right : α) : α := Fixed.bitOr left right
@[expose] public def bitXor {α : Type} [Fixed α] (left right : α) : α := Fixed.bitXor left right
@[expose] public def bitNot {α : Type} [Fixed α] (value : α) : α := Fixed.bitNot value
@[expose] public def shiftLeft {α : Type} [Fixed α] (value : α) (amount : UInt32) : Option α := Fixed.shiftLeft value amount
@[expose] public def shiftRight {α : Type} [Fixed α] (value : α) (amount : UInt32) : Option α := Fixed.shiftRight value amount

public class Appendable (α : Type) where append : α -> α -> α
public instance {α : Type} : Appendable (List α) where append := List.append
public instance : Appendable ByteArray where append := ByteArray.append
@[expose] public def append {α : Type} [Appendable α] (left right : α) : α := Appendable.append left right

public class Lengthable (α : Type) where length : α -> Nat
public instance {α : Type} : Lengthable (List α) where length := List.length
public instance : Lengthable ByteArray where length := ByteArray.size
public instance : Lengthable String where length := String.length
@[expose] public def length {α : Type} [Lengthable α] (value : α) : Nat := Lengthable.length value

@[expose] public def listIndex {α : Type} : List α -> Nat -> Option α
  | [], _ => none
  | head :: _, 0 => some head
  | _ :: tail, index + 1 => listIndex tail index

public class Indexable (α β : Type) where index : α -> Nat -> Option β
public instance {α : Type} : Indexable (List α) α where index := listIndex
public instance : Indexable ByteArray UInt8 where index := fun value offset => value.data[offset]?
@[noinline] public def index {α β : Type} [Indexable α β] (value : α) (offset : Nat) : Option β := Indexable.index value offset

public class Sliceable (α : Type) where slice : α -> Nat -> Nat -> Option α
public instance {α : Type} : Sliceable (List α) where
  slice := fun value start count => if start + count <= value.length then some ((value.drop start).take count) else none
public instance : Sliceable ByteArray where
  slice := fun value start count => if start + count <= value.size then some (value.extract start (start + count)) else none
@[noinline] public def slice {α : Type} [Sliceable α] (value : α) (start count : Nat) : Option α := Sliceable.slice value start count

@[noinline] public def utf8Encode (value : String) : ByteArray := value.toUTF8
@[noinline] public def utf8Decode (value : ByteArray) : Option String := String.fromUTF8? value
@[noinline] public def compareBytes (left right : ByteArray) : Ordering := compare left.toList right.toList
@[expose] public def equal {α : Type} [BEq α] (left right : α) : Bool := left == right

@[noinline] public def splitExact (value delimiter : String) (maximum : UInt32) : Option (List String) :=
  let fields := value.splitOn delimiter
  if delimiter.isEmpty || maximum.toNat < fields.length then none else some fields

@[noinline] public def join (values : List String) (delimiter : String) : String := delimiter.intercalate values

public class Decimal (α : Type) where
  parse : String -> Option α
  format : α -> String

public instance : Decimal Int where
  parse := fun value => match value.toInt? with | some parsed => if toString parsed = value then some parsed else none | none => none
  format := toString

public instance {α : Type} [Fixed α] [ToString α] : Decimal α where
  parse := fun value => match value.toInt? with | some parsed => if toString parsed = value then checkedFromInt parsed else none | none => none
  format := toString

@[noinline] public def parseDecimal {α : Type} [Decimal α] (value : String) : Option α := Decimal.parse value
@[noinline] public def formatDecimal {α : Type} [Decimal α] (value : α) : String := Decimal.format value

end LexLeanRuntime

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
