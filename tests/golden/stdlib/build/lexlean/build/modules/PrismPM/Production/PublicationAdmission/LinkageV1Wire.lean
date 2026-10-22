module
public import Init
public import PrismPM.Foundation.Codec
public import PrismPM.Foundation.Codec.Cbor.V1.Primitive
public import PrismPM.Production.PublicationAdmission.LinkageV1
public import PrismPM.Production.PublicationAdmission.V1
public import PrismPM.Production.PublicationAdmission.V1Wire
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
namespace PrismPM.Production.PublicationAdmission.LinkageV1Wire

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

@[expose] public def publicationLinkageWireAppendReady (allowed : Bool) (left : ByteArray) (right : ByteArray) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (if allowed then Except.ok ((LexLeanRuntime.append (left) (right) : ByteArray)) else Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit))

@[expose] public def publicationLinkageWireAppend (left : ByteArray) (right : ByteArray) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireAppendReady ((Nat.ble (((LexLeanRuntime.length (left) : Nat) + (LexLeanRuntime.length (right) : Nat))) (67108864))) (left) (right)

@[expose] public def publicationLinkageWireJoin (left : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) (right : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireOutput (left) with | PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireOutput.mk «prefix» leftCause => (match leftCause with | Option.some cause => Except.error (cause) | Option.none => (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireOutput (right) with | PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireOutput.mk suffix rightCause => (match rightCause with | Option.some cause => Except.error (cause) | Option.none => publicationLinkageWireAppend («prefix») (suffix)))))

@[expose] public def publicationLinkageWireLimits : PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborLimits := ({ maximumInput := 67108864, maximumOutput := 67108864, maximumBytes := 67108864, maximumText := 2048, maximumArrayItems := 65536 } : PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborLimits)

public structure PublicationLinkageReadPublicationMember where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationMember
  cursor : Nat

@[expose] public def readPublicationLinkagePublicationMember (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationMember) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (2)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((field0).cursor) with | Except.error cause => Except.error (cause) | Except.ok field1 => Except.ok (({ value := ({ module := (field0).value, name := (field1).value } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationMember), cursor := (field1).cursor } : PublicationLinkageReadPublicationMember))))))

@[expose] public def publicationLinkagePayloadHead (size : Nat) (major : Nat) (maximum : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match (Nat.ble (size) (maximum)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => (match (Nat.ble ((size + PrismPM.Foundation.Codec.Cbor.V1.Primitive.cborHeadWidth (size))) ((publicationLinkageWireLimits).maximumOutput)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => (match PrismPM.Foundation.Codec.Cbor.V1.Primitive.cborWriteHead (size) (major) (publicationLinkageWireLimits) with | Except.error cause => Except.error (cause) | Except.ok headBytes => Except.ok (headBytes))))

@[expose] public def publicationLinkagePayloadInto (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) (payload : ByteArray) (major : Nat) (maximum : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (acc) (publicationLinkagePayloadHead ((LexLeanRuntime.length (payload) : Nat)) (major) (maximum))) (Except.ok (payload))

@[expose] public def publicationLinkageWriteText (text : String) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := PrismPM.Foundation.Codec.Cbor.V1.Primitive.cborWritePayload ((LexLeanRuntime.utf8Encode (text) : ByteArray)) (3) (2048) (publicationLinkageWireLimits)

@[expose] public def writePublicationLinkagePublicationMember (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationMember) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (publicationLinkageWriteText ((value).module))) (publicationLinkageWriteText ((value).name))

public structure PublicationLinkageReadPublicationService where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService
  cursor : Nat

public structure PublicationLinkageReadPublicationIds where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIds
  cursor : Nat

public structure PublicationLinkageGroupsPublicationIds where
  chunks : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIdsChunk)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

public structure PublicationLinkageBatchPublicationIds where
  items : List (String)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

@[expose] public def readPublicationLinkagePublicationIdsBatchAcc : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (items : List (String)) -> (fuel : Nat) -> PublicationLinkageBatchPublicationIds
  | _input, cursor, items, Nat.zero => ({ items := items, cursor := cursor, cause := Option.none } : PublicationLinkageBatchPublicationIds)
  | input, cursor, items, Nat.succ rest => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) (cursor) with | Except.error failure => ({ items := items, cursor := cursor, cause := Option.some (failure) } : PublicationLinkageBatchPublicationIds) | Except.ok first => readPublicationLinkagePublicationIdsBatchAcc (input) ((first).cursor) ((LexLeanRuntime.append (items) (((first).value :: ([] : List (String)))) : List (String))) (rest))

@[expose] public def readPublicationLinkagePublicationIdsBatch (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) (fuel : Nat) : PublicationLinkageBatchPublicationIds := readPublicationLinkagePublicationIdsBatchAcc (input) (cursor) (([] : List (String))) (fuel)

@[expose] public def readPublicationLinkagePublicationIdsGroups : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (remaining : Nat) -> (fuel : Nat) -> PublicationLinkageGroupsPublicationIds
  | _input, cursor, remaining, Nat.zero => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIdsChunk)), cursor := cursor, cause := (match (Nat.beq (remaining) (0)) with | Bool.false => Option.some (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => Option.none) } : PublicationLinkageGroupsPublicationIds)
  | input, cursor, remaining, Nat.succ rest => (match (Nat.beq (remaining) (0)) with | Bool.false => (match readPublicationLinkagePublicationIdsBatch (input) (cursor) ((match (Nat.ble (remaining) (256)) with | Bool.false => 256 | Bool.true => remaining)) with | PublicationLinkageBatchPublicationIds.mk items next cause => (match cause with | Option.some failure => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIdsChunk)), cursor := next, cause := Option.some (failure) } : PublicationLinkageGroupsPublicationIds) | Option.none => (match readPublicationLinkagePublicationIdsGroups (input) (next) ((LexLeanRuntime.subtract (remaining) ((match (Nat.ble (remaining) (256)) with | Bool.false => 256 | Bool.true => remaining)) : Nat)) (rest) with | PublicationLinkageGroupsPublicationIds.mk tail «end» failure => ({ chunks := (({ entries := items } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIdsChunk) :: tail), cursor := «end», cause := failure } : PublicationLinkageGroupsPublicationIds)))) | Bool.true => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIdsChunk)), cursor := cursor, cause := Option.none } : PublicationLinkageGroupsPublicationIds))

@[expose] public def readPublicationLinkagePublicationIds (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationIds) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match readPublicationLinkagePublicationIdsGroups (input) ((array).cursor) ((array).count) (256) with | PublicationLinkageGroupsPublicationIds.mk chunks «end» cause => (match cause with | Option.some failure => Except.error (failure) | Option.none => Except.ok (({ value := ({ chunks := chunks } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIds), cursor := «end» } : PublicationLinkageReadPublicationIds)))))

@[expose] public def readPublicationLinkagePublicationService (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationService) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (2)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match readPublicationLinkagePublicationIds (input) ((field0).cursor) with | Except.error cause => Except.error (cause) | Except.ok field1 => Except.ok (({ value := ({ id := (field0).value, components := (field1).value } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService), cursor := (field1).cursor } : PublicationLinkageReadPublicationService))))))

@[expose] public def writePublicationLinkagePublicationIdsRowsAcc : (items : List (String)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationIdsRowsAcc (tail) (publicationLinkageWireJoin (acc) (publicationLinkageWriteText (head))) (rest))

@[expose] public def writePublicationLinkagePublicationIdsRows (items : List (String)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationIdsRowsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationIdsGroupsAcc : (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIdsChunk)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationIdsGroupsAcc (tail) (writePublicationLinkagePublicationIdsRowsAcc ((head).entries) (acc) (256)) (rest))

@[expose] public def writePublicationLinkagePublicationIdsGroups (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIdsChunk)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationIdsGroupsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationIds (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIds) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationIdsCanonical (value) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => writePublicationLinkagePublicationIdsGroupsAcc ((value).chunks) (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationIdsCount (value)) (publicationLinkageWireLimits))) (256))

@[expose] public def writePublicationLinkagePublicationIdsInto (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationIds) (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationIdsCanonical (value) with | Bool.false => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)) | Bool.true => writePublicationLinkagePublicationIdsGroupsAcc ((value).chunks) (publicationLinkageWireJoin (acc) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationIdsCount (value)) (publicationLinkageWireLimits))) (256))

@[expose] public def writePublicationLinkagePublicationService (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationIdsInto ((value).components) (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (publicationLinkageWriteText ((value).id)))

public structure PublicationLinkageReadProofRequirement where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.ProofRequirement
  cursor : Nat

@[expose] public def readPublicationLinkageProofRequirement (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadProofRequirement) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (1)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match readPublicationLinkagePublicationMember (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => Except.ok (({ value := ({ «theorem» := (field0).value } : PrismPM.Production.PublicationAdmission.LinkageV1.ProofRequirement), cursor := (field0).cursor } : PublicationLinkageReadProofRequirement)))))

@[expose] public def writePublicationLinkageProofRequirement (value : PrismPM.Production.PublicationAdmission.LinkageV1.ProofRequirement) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (1) (publicationLinkageWireLimits))) (writePublicationLinkagePublicationMember ((value).«theorem»))

public structure PublicationLinkageReadPublicationInputSelector where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationInputSelector
  cursor : Nat

@[expose] public def readPublicationLinkagePublicationInputSelector (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationInputSelector) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireNat (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok tag => (match ((Nat.beq ((tag).value) (0)) && (Nat.beq ((array).count) (2))) with | Bool.false => (match ((Nat.beq ((tag).value) (1)) && (Nat.beq ((array).count) (2))) with | Bool.false => (match ((Nat.beq ((tag).value) (2)) && (Nat.beq ((array).count) (1))) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationInputSelector.Target, cursor := (tag).cursor } : PublicationLinkageReadPublicationInputSelector))) | Bool.true => (match readPublicationLinkagePublicationMember (input) ((tag).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationInputSelector.SourceMember ((field0).value), cursor := (field0).cursor } : PublicationLinkageReadPublicationInputSelector)))) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((tag).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationInputSelector.BuildFile ((field0).value), cursor := (field0).cursor } : PublicationLinkageReadPublicationInputSelector))))))

@[expose] public def writePublicationLinkagePublicationInputSelector (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationInputSelector) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match value with | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationInputSelector.BuildFile p0 => publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (0))) (publicationLinkageWriteText (p0)) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationInputSelector.SourceMember p0 => publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (1))) (writePublicationLinkagePublicationMember (p0)) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationInputSelector.Target => publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (1) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (2)))

public structure PublicationLinkageReadExecutionRequirement where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.ExecutionRequirement
  cursor : Nat

@[expose] public def readPublicationLinkageExecutionRequirement (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadExecutionRequirement) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (3)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match readPublicationLinkagePublicationInputSelector (input) ((field0).cursor) with | Except.error cause => Except.error (cause) | Except.ok field1 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field1).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field2 => Except.ok (({ value := ({ oracle := (field0).value, input := (field1).value, suite := (field2).value } : PrismPM.Production.PublicationAdmission.LinkageV1.ExecutionRequirement), cursor := (field2).cursor } : PublicationLinkageReadExecutionRequirement)))))))

@[expose] public def writePublicationLinkageExecutionRequirement (value : PrismPM.Production.PublicationAdmission.LinkageV1.ExecutionRequirement) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (3) (publicationLinkageWireLimits))) (publicationLinkageWriteText ((value).oracle))) (writePublicationLinkagePublicationInputSelector ((value).input))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).suite))

public structure PublicationLinkageReadAssessmentRequirement where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.AssessmentRequirement
  cursor : Nat

@[expose] public def readPublicationLinkageAssessmentRequirement (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadAssessmentRequirement) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (2)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((field0).cursor) with | Except.error cause => Except.error (cause) | Except.ok field1 => Except.ok (({ value := ({ criterion := (field0).value, subject := (field1).value } : PrismPM.Production.PublicationAdmission.LinkageV1.AssessmentRequirement), cursor := (field1).cursor } : PublicationLinkageReadAssessmentRequirement))))))

@[expose] public def writePublicationLinkageAssessmentRequirement (value : PrismPM.Production.PublicationAdmission.LinkageV1.AssessmentRequirement) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (publicationLinkageWriteText ((value).criterion))) (publicationLinkageWriteText ((value).subject))

public structure PublicationLinkageReadPublicationRequirementValue where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementValue
  cursor : Nat

@[expose] public def readPublicationLinkagePublicationRequirementValue (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationRequirementValue) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireNat (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok tag => (match ((Nat.beq ((tag).value) (0)) && (Nat.beq ((array).count) (2))) with | Bool.false => (match ((Nat.beq ((tag).value) (1)) && (Nat.beq ((array).count) (4))) with | Bool.false => (match ((Nat.beq ((tag).value) (2)) && (Nat.beq ((array).count) (3))) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((tag).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((field0).cursor) with | Except.error cause => Except.error (cause) | Except.ok field1 => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementValue.Assessment (({ criterion := (field0).value, subject := (field1).value } : PrismPM.Production.PublicationAdmission.LinkageV1.AssessmentRequirement)), cursor := (field1).cursor } : PublicationLinkageReadPublicationRequirementValue))))) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((tag).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match readPublicationLinkagePublicationInputSelector (input) ((field0).cursor) with | Except.error cause => Except.error (cause) | Except.ok field1 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field1).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field2 => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementValue.Execution (({ oracle := (field0).value, input := (field1).value, suite := (field2).value } : PrismPM.Production.PublicationAdmission.LinkageV1.ExecutionRequirement)), cursor := (field2).cursor } : PublicationLinkageReadPublicationRequirementValue)))))) | Bool.true => (match readPublicationLinkagePublicationMember (input) ((tag).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementValue.Proof (({ «theorem» := (field0).value } : PrismPM.Production.PublicationAdmission.LinkageV1.ProofRequirement)), cursor := (field0).cursor } : PublicationLinkageReadPublicationRequirementValue))))))

@[expose] public def writePublicationLinkagePublicationRequirementValue (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementValue) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match value with | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementValue.Proof p0 => publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (0))) (writePublicationLinkagePublicationMember ((p0).«theorem»)) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementValue.Execution p0 => publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (4) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (1))) (publicationLinkageWriteText ((p0).oracle))) (writePublicationLinkagePublicationInputSelector ((p0).input))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((p0).suite)) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementValue.Assessment p0 => publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (3) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (2))) (publicationLinkageWriteText ((p0).criterion))) (publicationLinkageWriteText ((p0).subject)))

public structure PublicationLinkageReadPublicationRequirement where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement
  cursor : Nat

@[expose] public def readPublicationLinkagePublicationRequirement (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationRequirement) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (3)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireNat (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match readPublicationLinkagePublicationMember (input) ((field0).cursor) with | Except.error cause => Except.error (cause) | Except.ok field1 => (match readPublicationLinkagePublicationRequirementValue (input) ((field1).cursor) with | Except.error cause => Except.error (cause) | Except.ok field2 => Except.ok (({ value := ({ obligation := (field0).value, member := (field1).value, requirement := (field2).value } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement), cursor := (field2).cursor } : PublicationLinkageReadPublicationRequirement)))))))

@[expose] public def writePublicationLinkagePublicationRequirement (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (3) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat ((value).obligation))) (writePublicationLinkagePublicationMember ((value).member))) (writePublicationLinkagePublicationRequirementValue ((value).requirement))

public structure PublicationLinkageReadPublicationClosure where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationClosure
  cursor : Nat

public structure PublicationLinkageReadPublicationServices where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServices
  cursor : Nat

public structure PublicationLinkageGroupsPublicationServices where
  chunks : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServicesChunk)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

public structure PublicationLinkageBatchPublicationServices where
  items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

@[expose] public def readPublicationLinkagePublicationServicesBatchAcc : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService)) -> (fuel : Nat) -> PublicationLinkageBatchPublicationServices
  | _input, cursor, items, Nat.zero => ({ items := items, cursor := cursor, cause := Option.none } : PublicationLinkageBatchPublicationServices)
  | input, cursor, items, Nat.succ rest => (match readPublicationLinkagePublicationService (input) (cursor) with | Except.error failure => ({ items := items, cursor := cursor, cause := Option.some (failure) } : PublicationLinkageBatchPublicationServices) | Except.ok first => readPublicationLinkagePublicationServicesBatchAcc (input) ((first).cursor) ((LexLeanRuntime.append (items) (((first).value :: ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService)))) : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService))) (rest))

@[expose] public def readPublicationLinkagePublicationServicesBatch (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) (fuel : Nat) : PublicationLinkageBatchPublicationServices := readPublicationLinkagePublicationServicesBatchAcc (input) (cursor) (([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService))) (fuel)

@[expose] public def readPublicationLinkagePublicationServicesGroups : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (remaining : Nat) -> (fuel : Nat) -> PublicationLinkageGroupsPublicationServices
  | _input, cursor, remaining, Nat.zero => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServicesChunk)), cursor := cursor, cause := (match (Nat.beq (remaining) (0)) with | Bool.false => Option.some (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => Option.none) } : PublicationLinkageGroupsPublicationServices)
  | input, cursor, remaining, Nat.succ rest => (match (Nat.beq (remaining) (0)) with | Bool.false => (match readPublicationLinkagePublicationServicesBatch (input) (cursor) ((match (Nat.ble (remaining) (256)) with | Bool.false => 256 | Bool.true => remaining)) with | PublicationLinkageBatchPublicationServices.mk items next cause => (match cause with | Option.some failure => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServicesChunk)), cursor := next, cause := Option.some (failure) } : PublicationLinkageGroupsPublicationServices) | Option.none => (match readPublicationLinkagePublicationServicesGroups (input) (next) ((LexLeanRuntime.subtract (remaining) ((match (Nat.ble (remaining) (256)) with | Bool.false => 256 | Bool.true => remaining)) : Nat)) (rest) with | PublicationLinkageGroupsPublicationServices.mk tail «end» failure => ({ chunks := (({ entries := items } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServicesChunk) :: tail), cursor := «end», cause := failure } : PublicationLinkageGroupsPublicationServices)))) | Bool.true => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServicesChunk)), cursor := cursor, cause := Option.none } : PublicationLinkageGroupsPublicationServices))

@[expose] public def readPublicationLinkagePublicationServices (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationServices) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match readPublicationLinkagePublicationServicesGroups (input) ((array).cursor) ((array).count) (256) with | PublicationLinkageGroupsPublicationServices.mk chunks «end» cause => (match cause with | Option.some failure => Except.error (failure) | Option.none => Except.ok (({ value := ({ chunks := chunks } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServices), cursor := «end» } : PublicationLinkageReadPublicationServices)))))

public structure PublicationLinkageReadPublicationRequirements where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirements
  cursor : Nat

public structure PublicationLinkageGroupsPublicationRequirements where
  chunks : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementsChunk)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

public structure PublicationLinkageBatchPublicationRequirements where
  items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

@[expose] public def readPublicationLinkagePublicationRequirementsBatchAcc : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement)) -> (fuel : Nat) -> PublicationLinkageBatchPublicationRequirements
  | _input, cursor, items, Nat.zero => ({ items := items, cursor := cursor, cause := Option.none } : PublicationLinkageBatchPublicationRequirements)
  | input, cursor, items, Nat.succ rest => (match readPublicationLinkagePublicationRequirement (input) (cursor) with | Except.error failure => ({ items := items, cursor := cursor, cause := Option.some (failure) } : PublicationLinkageBatchPublicationRequirements) | Except.ok first => readPublicationLinkagePublicationRequirementsBatchAcc (input) ((first).cursor) ((LexLeanRuntime.append (items) (((first).value :: ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement)))) : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement))) (rest))

@[expose] public def readPublicationLinkagePublicationRequirementsBatch (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) (fuel : Nat) : PublicationLinkageBatchPublicationRequirements := readPublicationLinkagePublicationRequirementsBatchAcc (input) (cursor) (([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement))) (fuel)

@[expose] public def readPublicationLinkagePublicationRequirementsGroups : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (remaining : Nat) -> (fuel : Nat) -> PublicationLinkageGroupsPublicationRequirements
  | _input, cursor, remaining, Nat.zero => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementsChunk)), cursor := cursor, cause := (match (Nat.beq (remaining) (0)) with | Bool.false => Option.some (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => Option.none) } : PublicationLinkageGroupsPublicationRequirements)
  | input, cursor, remaining, Nat.succ rest => (match (Nat.beq (remaining) (0)) with | Bool.false => (match readPublicationLinkagePublicationRequirementsBatch (input) (cursor) ((match (Nat.ble (remaining) (64)) with | Bool.false => 64 | Bool.true => remaining)) with | PublicationLinkageBatchPublicationRequirements.mk items next cause => (match cause with | Option.some failure => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementsChunk)), cursor := next, cause := Option.some (failure) } : PublicationLinkageGroupsPublicationRequirements) | Option.none => (match readPublicationLinkagePublicationRequirementsGroups (input) (next) ((LexLeanRuntime.subtract (remaining) ((match (Nat.ble (remaining) (64)) with | Bool.false => 64 | Bool.true => remaining)) : Nat)) (rest) with | PublicationLinkageGroupsPublicationRequirements.mk tail «end» failure => ({ chunks := (({ entries := items } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementsChunk) :: tail), cursor := «end», cause := failure } : PublicationLinkageGroupsPublicationRequirements)))) | Bool.true => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementsChunk)), cursor := cursor, cause := Option.none } : PublicationLinkageGroupsPublicationRequirements))

@[expose] public def readPublicationLinkagePublicationRequirements (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationRequirements) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (4096) with | Except.error cause => Except.error (cause) | Except.ok array => (match readPublicationLinkagePublicationRequirementsGroups (input) ((array).cursor) ((array).count) (64) with | PublicationLinkageGroupsPublicationRequirements.mk chunks «end» cause => (match cause with | Option.some failure => Except.error (failure) | Option.none => Except.ok (({ value := ({ chunks := chunks } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirements), cursor := «end» } : PublicationLinkageReadPublicationRequirements)))))

@[expose] public def readPublicationLinkagePublicationClosure (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationClosure) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (6)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match readPublicationLinkagePublicationMember (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((field0).cursor) with | Except.error cause => Except.error (cause) | Except.ok field1 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWirePublicationDeclaration (input) ((field1).cursor) with | Except.error cause => Except.error (cause) | Except.ok field2 => (match readPublicationLinkagePublicationServices (input) ((field2).cursor) with | Except.error cause => Except.error (cause) | Except.ok field3 => (match readPublicationLinkagePublicationIds (input) ((field3).cursor) with | Except.error cause => Except.error (cause) | Except.ok field4 => (match readPublicationLinkagePublicationRequirements (input) ((field4).cursor) with | Except.error cause => Except.error (cause) | Except.ok field5 => Except.ok (({ value := ({ system := (field0).value, target := (field1).value, declaration := (field2).value, services := (field3).value, controls := (field4).value, requirements := (field5).value } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationClosure), cursor := (field5).cursor } : PublicationLinkageReadPublicationClosure))))))))))

@[expose] public def writePublicationLinkagePublicationServicesRowsAcc : (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationServicesRowsAcc (tail) (writePublicationLinkagePublicationIdsInto ((head).components) (publicationLinkageWireJoin (publicationLinkageWireJoin (acc) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (publicationLinkageWriteText ((head).id)))) (rest))

@[expose] public def writePublicationLinkagePublicationServicesRows (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationService)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationServicesRowsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationServicesGroupsAcc : (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServicesChunk)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationServicesGroupsAcc (tail) (writePublicationLinkagePublicationServicesRowsAcc ((head).entries) (acc) (256)) (rest))

@[expose] public def writePublicationLinkagePublicationServicesGroups (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServicesChunk)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationServicesGroupsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationServices (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServices) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationServicesCanonical (value) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => writePublicationLinkagePublicationServicesGroupsAcc ((value).chunks) (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationServicesCount (value)) (publicationLinkageWireLimits))) (256))

@[expose] public def writePublicationLinkagePublicationRequirementsRowsAcc : (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationRequirementsRowsAcc (tail) (publicationLinkageWireJoin (acc) (writePublicationLinkagePublicationRequirement (head))) (rest))

@[expose] public def writePublicationLinkagePublicationRequirementsRows (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirement)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationRequirementsRowsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationRequirementsGroupsAcc : (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementsChunk)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationRequirementsGroupsAcc (tail) (writePublicationLinkagePublicationRequirementsRowsAcc ((head).entries) (acc) (64)) (rest))

@[expose] public def writePublicationLinkagePublicationRequirementsGroups (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirementsChunk)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationRequirementsGroupsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationRequirements (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRequirements) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationRequirementsCanonical (value) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => writePublicationLinkagePublicationRequirementsGroupsAcc ((value).chunks) (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationRequirementsCount (value)) (publicationLinkageWireLimits))) (64))

@[expose] public def writePublicationLinkagePublicationServicesInto (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationServices) (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationServicesCanonical (value) with | Bool.false => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)) | Bool.true => writePublicationLinkagePublicationServicesGroupsAcc ((value).chunks) (publicationLinkageWireJoin (acc) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationServicesCount (value)) (publicationLinkageWireLimits))) (256))

@[expose] public def writePublicationLinkagePublicationClosure (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationClosure) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (writePublicationLinkagePublicationIdsInto ((value).controls) (writePublicationLinkagePublicationServicesInto ((value).services) (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (6) (publicationLinkageWireLimits))) (writePublicationLinkagePublicationMember ((value).system))) (publicationLinkageWriteText ((value).target))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWirePublicationDeclaration ((value).declaration))))) (writePublicationLinkagePublicationRequirements ((value).requirements))

public structure PublicationLinkageReadPublicationRecord where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord
  cursor : Nat

@[expose] public def readPublicationLinkagePublicationRecord (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationRecord) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (2)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field0).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field1 => Except.ok (({ value := ({ id := (field0).value, digest := (field1).value } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord), cursor := (field1).cursor } : PublicationLinkageReadPublicationRecord))))))

@[expose] public def writePublicationLinkagePublicationRecord (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (publicationLinkageWriteText ((value).id))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).digest))

public structure PublicationLinkageReadPublicationFile where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile
  cursor : Nat

@[expose] public def readPublicationLinkagePublicationFile (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationFile) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (2)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field0).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field1 => Except.ok (({ value := ({ path := (field0).value, digest := (field1).value } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile), cursor := (field1).cursor } : PublicationLinkageReadPublicationFile))))))

@[expose] public def writePublicationLinkagePublicationFile (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkagePayloadInto (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) ((LexLeanRuntime.utf8Encode ((value).path) : ByteArray)) (3) (2048)) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).digest))

public structure PublicationLinkageReadPublicationSourceLink where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationSourceLink
  cursor : Nat

@[expose] public def readPublicationLinkagePublicationSourceLink (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationSourceLink) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (9)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((array).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field0).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field1 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field1).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field2 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field2).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field3 => (match readPublicationLinkagePublicationMember (input) ((field3).cursor) with | Except.error cause => Except.error (cause) | Except.ok field4 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field4).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field5 => (match readPublicationLinkagePublicationMember (input) ((field5).cursor) with | Except.error cause => Except.error (cause) | Except.ok field6 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field6).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field7 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((field7).cursor) with | Except.error cause => Except.error (cause) | Except.ok field8 => Except.ok (({ value := ({ snapshot := (field0).value, source := (field1).value, semantic := (field2).value, compiler := (field3).value, closureMember := (field4).value, moduleSource := (field5).value, systemMember := (field6).value, system := (field7).value, target := (field8).value } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationSourceLink), cursor := (field8).cursor } : PublicationLinkageReadPublicationSourceLink)))))))))))))

@[expose] public def writePublicationLinkagePublicationSourceLink (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationSourceLink) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (9) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).snapshot))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).source))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).semantic))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).compiler))) (writePublicationLinkagePublicationMember ((value).closureMember))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).moduleSource))) (writePublicationLinkagePublicationMember ((value).systemMember))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).system))) (publicationLinkageWriteText ((value).target))

public structure PublicationLinkageReadPublicationCapture where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture
  cursor : Nat

public structure PublicationLinkageReadPublicationRecords where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecords
  cursor : Nat

public structure PublicationLinkageGroupsPublicationRecords where
  chunks : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecordsChunk)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

public structure PublicationLinkageBatchPublicationRecords where
  items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

@[expose] public def readPublicationLinkagePublicationRecordsBatchAcc : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord)) -> (fuel : Nat) -> PublicationLinkageBatchPublicationRecords
  | _input, cursor, items, Nat.zero => ({ items := items, cursor := cursor, cause := Option.none } : PublicationLinkageBatchPublicationRecords)
  | input, cursor, items, Nat.succ rest => (match readPublicationLinkagePublicationRecord (input) (cursor) with | Except.error failure => ({ items := items, cursor := cursor, cause := Option.some (failure) } : PublicationLinkageBatchPublicationRecords) | Except.ok first => readPublicationLinkagePublicationRecordsBatchAcc (input) ((first).cursor) ((LexLeanRuntime.append (items) (((first).value :: ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord)))) : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord))) (rest))

@[expose] public def readPublicationLinkagePublicationRecordsBatch (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) (fuel : Nat) : PublicationLinkageBatchPublicationRecords := readPublicationLinkagePublicationRecordsBatchAcc (input) (cursor) (([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord))) (fuel)

@[expose] public def readPublicationLinkagePublicationRecordsGroups : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (remaining : Nat) -> (fuel : Nat) -> PublicationLinkageGroupsPublicationRecords
  | _input, cursor, remaining, Nat.zero => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecordsChunk)), cursor := cursor, cause := (match (Nat.beq (remaining) (0)) with | Bool.false => Option.some (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => Option.none) } : PublicationLinkageGroupsPublicationRecords)
  | input, cursor, remaining, Nat.succ rest => (match (Nat.beq (remaining) (0)) with | Bool.false => (match readPublicationLinkagePublicationRecordsBatch (input) (cursor) ((match (Nat.ble (remaining) (256)) with | Bool.false => 256 | Bool.true => remaining)) with | PublicationLinkageBatchPublicationRecords.mk items next cause => (match cause with | Option.some failure => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecordsChunk)), cursor := next, cause := Option.some (failure) } : PublicationLinkageGroupsPublicationRecords) | Option.none => (match readPublicationLinkagePublicationRecordsGroups (input) (next) ((LexLeanRuntime.subtract (remaining) ((match (Nat.ble (remaining) (256)) with | Bool.false => 256 | Bool.true => remaining)) : Nat)) (rest) with | PublicationLinkageGroupsPublicationRecords.mk tail «end» failure => ({ chunks := (({ entries := items } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecordsChunk) :: tail), cursor := «end», cause := failure } : PublicationLinkageGroupsPublicationRecords)))) | Bool.true => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecordsChunk)), cursor := cursor, cause := Option.none } : PublicationLinkageGroupsPublicationRecords))

@[expose] public def readPublicationLinkagePublicationRecords (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationRecords) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match readPublicationLinkagePublicationRecordsGroups (input) ((array).cursor) ((array).count) (256) with | PublicationLinkageGroupsPublicationRecords.mk chunks «end» cause => (match cause with | Option.some failure => Except.error (failure) | Option.none => Except.ok (({ value := ({ chunks := chunks } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecords), cursor := «end» } : PublicationLinkageReadPublicationRecords)))))

public structure PublicationLinkageReadPublicationFiles where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFiles
  cursor : Nat

public structure PublicationLinkageGroupsPublicationFiles where
  chunks : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFilesChunk)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

public structure PublicationLinkageBatchPublicationFiles where
  items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile)
  cursor : Nat
  cause : Option (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError)

@[expose] public def readPublicationLinkagePublicationFilesBatchAcc : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile)) -> (fuel : Nat) -> PublicationLinkageBatchPublicationFiles
  | _input, cursor, items, Nat.zero => ({ items := items, cursor := cursor, cause := Option.none } : PublicationLinkageBatchPublicationFiles)
  | input, cursor, items, Nat.succ rest => (match readPublicationLinkagePublicationFile (input) (cursor) with | Except.error failure => ({ items := items, cursor := cursor, cause := Option.some (failure) } : PublicationLinkageBatchPublicationFiles) | Except.ok first => readPublicationLinkagePublicationFilesBatchAcc (input) ((first).cursor) ((LexLeanRuntime.append (items) (((first).value :: ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile)))) : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile))) (rest))

@[expose] public def readPublicationLinkagePublicationFilesBatch (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) (fuel : Nat) : PublicationLinkageBatchPublicationFiles := readPublicationLinkagePublicationFilesBatchAcc (input) (cursor) (([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile))) (fuel)

@[expose] public def readPublicationLinkagePublicationFilesGroups : (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) -> (cursor : Nat) -> (remaining : Nat) -> (fuel : Nat) -> PublicationLinkageGroupsPublicationFiles
  | _input, cursor, remaining, Nat.zero => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFilesChunk)), cursor := cursor, cause := (match (Nat.beq (remaining) (0)) with | Bool.false => Option.some (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => Option.none) } : PublicationLinkageGroupsPublicationFiles)
  | input, cursor, remaining, Nat.succ rest => (match (Nat.beq (remaining) (0)) with | Bool.false => (match readPublicationLinkagePublicationFilesBatch (input) (cursor) ((match (Nat.ble (remaining) (256)) with | Bool.false => 256 | Bool.true => remaining)) with | PublicationLinkageBatchPublicationFiles.mk items next cause => (match cause with | Option.some failure => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFilesChunk)), cursor := next, cause := Option.some (failure) } : PublicationLinkageGroupsPublicationFiles) | Option.none => (match readPublicationLinkagePublicationFilesGroups (input) (next) ((LexLeanRuntime.subtract (remaining) ((match (Nat.ble (remaining) (256)) with | Bool.false => 256 | Bool.true => remaining)) : Nat)) (rest) with | PublicationLinkageGroupsPublicationFiles.mk tail «end» failure => ({ chunks := (({ entries := items } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFilesChunk) :: tail), cursor := «end», cause := failure } : PublicationLinkageGroupsPublicationFiles)))) | Bool.true => ({ chunks := ([] : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFilesChunk)), cursor := cursor, cause := Option.none } : PublicationLinkageGroupsPublicationFiles))

@[expose] public def readPublicationLinkagePublicationFiles (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationFiles) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match readPublicationLinkagePublicationFilesGroups (input) ((array).cursor) ((array).count) (256) with | PublicationLinkageGroupsPublicationFiles.mk chunks «end» cause => (match cause with | Option.some failure => Except.error (failure) | Option.none => Except.ok (({ value := ({ chunks := chunks } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFiles), cursor := «end» } : PublicationLinkageReadPublicationFiles)))))

@[expose] public def readPublicationLinkagePublicationCapture (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationCapture) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (15)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match readPublicationLinkagePublicationSourceLink (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match readPublicationLinkagePublicationRecords (input) ((field0).cursor) with | Except.error cause => Except.error (cause) | Except.ok field1 => (match readPublicationLinkagePublicationRecords (input) ((field1).cursor) with | Except.error cause => Except.error (cause) | Except.ok field2 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field2).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field3 => (match readPublicationLinkagePublicationRecords (input) ((field3).cursor) with | Except.error cause => Except.error (cause) | Except.ok field4 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field4).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field5 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field5).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field6 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field6).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field7 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field7).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field8 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field8).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field9 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field9).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field10 => (match readPublicationLinkagePublicationFiles (input) ((field10).cursor) with | Except.error cause => Except.error (cause) | Except.ok field11 => (match readPublicationLinkagePublicationFiles (input) ((field11).cursor) with | Except.error cause => Except.error (cause) | Except.ok field12 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field12).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field13 => (match readPublicationLinkagePublicationFiles (input) ((field13).cursor) with | Except.error cause => Except.error (cause) | Except.ok field14 => Except.ok (({ value := ({ sourceLink := (field0).value, components := (field1).value, controls := (field2).value, provenance := (field3).value, dependencies := (field4).value, sdkLock := (field5).value, standardsLock := (field6).value, lexleanBuildManifest := (field7).value, lexleanAttestation := (field8).value, buildManifest := (field9).value, verificationManifest := (field10).value, verificationFiles := (field11).value, browserFiles := (field12).value, releaseValidation := (field13).value, oracleAttestations := (field14).value } : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture), cursor := (field14).cursor } : PublicationLinkageReadPublicationCapture)))))))))))))))))))

@[expose] public def writePublicationLinkagePublicationRecordsRowsAcc : (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationRecordsRowsAcc (tail) (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (acc) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (publicationLinkageWriteText ((head).id))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((head).digest))) (rest))

@[expose] public def writePublicationLinkagePublicationRecordsRows (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecord)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationRecordsRowsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationRecordsGroupsAcc : (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecordsChunk)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationRecordsGroupsAcc (tail) (writePublicationLinkagePublicationRecordsRowsAcc ((head).entries) (acc) (256)) (rest))

@[expose] public def writePublicationLinkagePublicationRecordsGroups (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecordsChunk)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationRecordsGroupsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationRecords (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecords) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationRecordsCanonical (value) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => writePublicationLinkagePublicationRecordsGroupsAcc ((value).chunks) (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationRecordsCount (value)) (publicationLinkageWireLimits))) (256))

@[expose] public def writePublicationLinkagePublicationFilesRowsAcc : (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationFilesRowsAcc (tail) (publicationLinkageWireJoin (publicationLinkagePayloadInto (publicationLinkageWireJoin (acc) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) ((LexLeanRuntime.utf8Encode ((head).path) : ByteArray)) (3) (2048)) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((head).digest))) (rest))

@[expose] public def writePublicationLinkagePublicationFilesRows (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFile)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationFilesRowsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationFilesGroupsAcc : (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFilesChunk)) -> (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) -> (fuel : Nat) -> Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)
  | items, acc, Nat.zero => (match items with | List.nil => acc | List.cons _ _ => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)))
  | items, acc, Nat.succ rest => (match items with | List.nil => acc | List.cons head tail => writePublicationLinkagePublicationFilesGroupsAcc (tail) (writePublicationLinkagePublicationFilesRowsAcc ((head).entries) (acc) (256)) (rest))

@[expose] public def writePublicationLinkagePublicationFilesGroups (items : List (PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFilesChunk)) (fuel : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationFilesGroupsAcc (items) (Except.ok (_root_.ByteArray.mk #[])) (fuel)

@[expose] public def writePublicationLinkagePublicationFilesInto (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFiles) (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationFilesCanonical (value) with | Bool.false => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)) | Bool.true => writePublicationLinkagePublicationFilesGroupsAcc ((value).chunks) (publicationLinkageWireJoin (acc) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationFilesCount (value)) (publicationLinkageWireLimits))) (256))

@[expose] public def writePublicationLinkagePublicationFiles (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationFiles) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationFilesCanonical (value) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit) | Bool.true => writePublicationLinkagePublicationFilesGroupsAcc ((value).chunks) (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationFilesCount (value)) (publicationLinkageWireLimits))) (256))

@[expose] public def writePublicationLinkagePublicationRecordsInto (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationRecords) (acc : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray)) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationRecordsCanonical (value) with | Bool.false => publicationLinkageWireJoin (acc) (Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.ValueLimit)) | Bool.true => writePublicationLinkagePublicationRecordsGroupsAcc ((value).chunks) (publicationLinkageWireJoin (acc) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkagePublicationRecordsCount (value)) (publicationLinkageWireLimits))) (256))

@[expose] public def writePublicationLinkagePublicationCapture (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (writePublicationLinkagePublicationRecordsInto ((value).dependencies) (publicationLinkageWireJoin (writePublicationLinkagePublicationRecordsInto ((value).controls) (writePublicationLinkagePublicationRecordsInto ((value).components) (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (15) (publicationLinkageWireLimits))) (writePublicationLinkagePublicationSourceLink ((value).sourceLink))))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).provenance)))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).sdkLock))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).standardsLock))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).lexleanBuildManifest))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).lexleanAttestation))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).buildManifest))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).verificationManifest))) (writePublicationLinkagePublicationFiles ((value).verificationFiles))) (writePublicationLinkagePublicationFiles ((value).browserFiles))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((value).releaseValidation))) (writePublicationLinkagePublicationFiles ((value).oracleAttestations))

public structure PublicationLinkageReadPublicationLinkageError where
  value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError
  cursor : Nat

@[expose] public def readPublicationLinkagePublicationLinkageError (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadPublicationLinkageError) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (65536) with | Except.error cause => Except.error (cause) | Except.ok array => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireNat (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok tag => (match ((Nat.beq ((tag).value) (0)) && (Nat.beq ((array).count) (1))) with | Bool.false => (match ((Nat.beq ((tag).value) (1)) && (Nat.beq ((array).count) (1))) with | Bool.false => (match ((Nat.beq ((tag).value) (2)) && (Nat.beq ((array).count) (1))) with | Bool.false => (match ((Nat.beq ((tag).value) (3)) && (Nat.beq ((array).count) (1))) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.RequirementMismatch, cursor := (tag).cursor } : PublicationLinkageReadPublicationLinkageError))) | Bool.true => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.InventoryMismatch, cursor := (tag).cursor } : PublicationLinkageReadPublicationLinkageError))) | Bool.true => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.SourceMismatch, cursor := (tag).cursor } : PublicationLinkageReadPublicationLinkageError))) | Bool.true => Except.ok (({ value := PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.InvalidMetadata, cursor := (tag).cursor } : PublicationLinkageReadPublicationLinkageError)))))

@[expose] public def writePublicationLinkagePublicationLinkageError (value : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match value with | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.InvalidMetadata => publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (1) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (0)) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.SourceMismatch => publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (1) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (1)) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.InventoryMismatch => publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (1) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (2)) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.RequirementMismatch => publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (1) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (3)))

@[expose] public def publicationLinkageservicesPreimage (closure : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationClosure) (capture : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationRecordsInto ((capture).components) (writePublicationLinkagePublicationServicesInto ((closure).services) (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (Except.ok ((let __byte105 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 105); let __byte115 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 115); _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 114)), __byte105, __byte115, (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 98)), (_root_.UInt8.ofNat (nat_lit 108)), __byte105, (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 116)), __byte105, (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 45)), __byte115, (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 118)), __byte105, (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 101)), __byte115, (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 111)), __byte115, (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 0))])))) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (3) (publicationLinkageWireLimits))) (writePublicationLinkagePublicationSourceLink ((capture).sourceLink))))

@[expose] public def publicationLinkagecontrolsPreimage (closure : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationClosure) (capture : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (writePublicationLinkagePublicationRecordsInto ((capture).controls) (writePublicationLinkagePublicationIdsInto ((closure).controls) (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (Except.ok ((let __byte111 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 111); _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 98)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 116)), (_root_.UInt8.ofNat (nat_lit 105)), __byte111, (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 99)), __byte111, (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 116)), (_root_.UInt8.ofNat (nat_lit 114)), __byte111, (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 108)), __byte111, (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 0))])))) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (5) (publicationLinkageWireLimits))) (writePublicationLinkagePublicationSourceLink ((capture).sourceLink))))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).standardsLock))) (writePublicationLinkagePublicationRequirements ((closure).requirements))

@[expose] public def publicationLinkagedependenciesPreimage (capture : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationRecordsInto ((capture).dependencies) (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (Except.ok ((let __byte101 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 101); let __byte105 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 105); let __byte112 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 112); _root_.ByteArray.mk #[__byte112, (_root_.UInt8.ofNat (nat_lit 114)), __byte105, (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 109)), __byte112, (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 47)), __byte112, (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 98)), (_root_.UInt8.ofNat (nat_lit 108)), __byte105, (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 116)), __byte105, (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 100)), __byte101, __byte112, __byte101, (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 100)), __byte101, (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 99)), __byte105, __byte101, (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 114)), __byte101, (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 0))])))) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (2) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).provenance)))

@[expose] public def publicationLinkagecompilerPreimage (capture : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (Except.ok ((let __byte105 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 105); let __byte112 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 112); _root_.ByteArray.mk #[__byte112, (_root_.UInt8.ofNat (nat_lit 114)), __byte105, (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 109)), __byte112, (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 47)), __byte112, (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 98)), (_root_.UInt8.ofNat (nat_lit 108)), __byte105, (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 116)), __byte105, (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 109)), __byte112, __byte105, (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 0))])))) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (5) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).sdkLock))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).lexleanBuildManifest))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).lexleanAttestation))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).buildManifest))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).verificationManifest))

@[expose] public def publicationLinkageruntimePreimage (capture : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationFilesInto ((capture).browserFiles) (writePublicationLinkagePublicationFilesInto ((capture).verificationFiles) (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (Except.ok ((let __byte105 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 105); _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 114)), __byte105, (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 98)), (_root_.UInt8.ofNat (nat_lit 108)), __byte105, (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 116)), __byte105, (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 116)), __byte105, (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 0))])))) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (3) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).verificationManifest))))

@[expose] public def publicationLinkageoraclesPreimage (closure : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationClosure) (capture : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := writePublicationLinkagePublicationFilesInto ((capture).oracleAttestations) (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (Except.ok (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 98)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 116)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 0))]))) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (6) (publicationLinkageWireLimits))) (writePublicationLinkagePublicationSourceLink ((capture).sourceLink))) (writePublicationLinkagePublicationRequirements ((closure).requirements))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).standardsLock))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).sdkLock))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireBytes ((capture).releaseValidation)))

@[expose] public def publicationLinkageResponse (closure : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationClosure) (capture : PrismPM.Production.PublicationAdmission.LinkageV1.PublicationCapture) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkageValidate (closure) (capture) with | Option.none => (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireOutput (PrismPM.Production.PublicationAdmission.V1Wire.publicationDeclarationPreimage ((closure).declaration)) with | PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireOutput.mk declaration declarationCause => (match declarationCause with | Option.some cause => Except.error (cause) | Option.none => (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireOutput (publicationLinkageservicesPreimage (closure) (capture)) with | PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireOutput.mk services servicesCause => (match servicesCause with | Option.some cause => Except.error (cause) | Option.none => (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireOutput (publicationLinkagecontrolsPreimage (closure) (capture)) with | PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireOutput.mk controls controlsCause => (match controlsCause with | Option.some cause => Except.error (cause) | Option.none => (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireOutput (publicationLinkagedependenciesPreimage (capture)) with | PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireOutput.mk dependencies dependenciesCause => (match dependenciesCause with | Option.some cause => Except.error (cause) | Option.none => (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireOutput (publicationLinkagecompilerPreimage (capture)) with | PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireOutput.mk compiler compilerCause => (match compilerCause with | Option.some cause => Except.error (cause) | Option.none => (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireOutput (publicationLinkageruntimePreimage (capture)) with | PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireOutput.mk runtime runtimeCause => (match runtimeCause with | Option.some cause => Except.error (cause) | Option.none => (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireOutput (publicationLinkageoraclesPreimage (closure) (capture)) with | PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireOutput.mk oracles oraclesCause => (match oraclesCause with | Option.some cause => Except.error (cause) | Option.none => publicationLinkagePayloadInto (publicationLinkagePayloadInto (publicationLinkagePayloadInto (publicationLinkagePayloadInto (publicationLinkagePayloadInto (publicationLinkagePayloadInto (publicationLinkagePayloadInto (publicationLinkageWireJoin (publicationLinkageWireJoin (publicationLinkageWireJoin (Except.ok (_root_.ByteArray.mk #[])) (PrismPM.Foundation.Codec.Cbor.V1.Primitive.writeCborArrayHead (9) (publicationLinkageWireLimits))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (1))) (PrismPM.Production.PublicationAdmission.V1Wire.writePublicationWireNat (0))) (declaration) (2) (67108864)) (services) (2) (67108864)) (controls) (2) (67108864)) (dependencies) (2) (67108864)) (compiler) (2) (67108864)) (runtime) (2) (67108864)) (oracles) (2) (67108864))))))))))))))) | Option.some cause => (match cause with | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.InvalidMetadata => Except.ok (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 131)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 0))]) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.SourceMismatch => Except.ok (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 131)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 1))]) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.InventoryMismatch => Except.ok (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 131)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 2))]) | PrismPM.Production.PublicationAdmission.LinkageV1.PublicationLinkageError.RequirementMismatch => Except.ok (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 131)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 3))])))

@[expose] public def publicationLinkageFinish (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (Bool) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireWindow (input) (cursor) with | Except.error cause => Except.error (cause) | Except.ok window => PrismPM.Foundation.Codec.Cbor.V1.Primitive.finishCborCursor (({ bytes := window, offset := 0, limit := (LexLeanRuntime.length (window) : Nat) } : PrismPM.Foundation.Codec.BoundedCursor)) (publicationLinkageWireLimits))

@[expose] public def dispatchPublicationLinkage (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (0) (4) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (4)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireNat (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok version => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireNat (input) ((version).cursor) with | Except.error cause => Except.error (cause) | Except.ok operation => (match ((Nat.beq ((version).value) (1)) && (Nat.beq ((operation).value) (0))) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match readPublicationLinkagePublicationClosure (input) ((operation).cursor) with | Except.error cause => Except.error (cause) | Except.ok closureRead => (match readPublicationLinkagePublicationCapture (input) ((closureRead).cursor) with | Except.error cause => Except.error (cause) | Except.ok captureRead => (match publicationLinkageFinish (input) ((captureRead).cursor) with | Except.error cause => Except.error (cause) | Except.ok _ => publicationLinkageResponse ((closureRead).value) ((captureRead).value)))))))))

@[expose] public def publicationLinkageWireBytes (input : ByteArray) : ByteArray := (match (Nat.ble ((LexLeanRuntime.length (input) : Nat)) (67108864)) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 131)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 2)), (_root_.UInt8.ofNat (nat_lit 6))] | Bool.true => (match dispatchPublicationLinkage (({ bytes := input } : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput)) with | Except.error cause => PrismPM.Production.PublicationAdmission.V1Wire.publicationWireErrorBytes (cause) | Except.ok response => response))

public structure PublicationContextFields where
  declaration : PrismPM.Production.PublicationAdmission.V1.PublicationDeclaration
  declarationIdentity : ByteArray
  subject : PrismPM.Production.PublicationAdmission.V1.PublicationSubject
  «instance» : ByteArray
  publisherRevision : ByteArray
  publisherRef : String

public structure PublicationLinkageReadContextFields where
  value : PublicationContextFields
  cursor : Nat

@[expose] public def readPublicationContextFields (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) (cursor : Nat) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (PublicationLinkageReadContextFields) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (cursor) (6) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (6)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWirePublicationDeclaration (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok field0 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field0).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field1 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWirePublicationSubject (input) ((field1).cursor) with | Except.error cause => Except.error (cause) | Except.ok field2 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field2).cursor) (32) with | Except.error cause => Except.error (cause) | Except.ok field3 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireBytes (input) ((field3).cursor) (20) with | Except.error cause => Except.error (cause) | Except.ok field4 => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireText (input) ((field4).cursor) with | Except.error cause => Except.error (cause) | Except.ok field5 => Except.ok (({ value := ({ declaration := (field0).value, declarationIdentity := (field1).value, subject := (field2).value, «instance» := (field3).value, publisherRevision := (field4).value, publisherRef := (field5).value } : PublicationContextFields), cursor := (field5).cursor } : PublicationLinkageReadContextFields))))))))))

@[expose] public def dispatchPublicationContextFields (input : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput) : Except (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError) (ByteArray) := (match PrismPM.Production.PublicationAdmission.V1Wire.publicationWireReadArray (input) (0) (3) with | Except.error cause => Except.error (cause) | Except.ok array => (match (Nat.beq ((array).count) (3)) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireNat (input) ((array).cursor) with | Except.error cause => Except.error (cause) | Except.ok version => (match PrismPM.Production.PublicationAdmission.V1Wire.readPublicationWireNat (input) ((version).cursor) with | Except.error cause => Except.error (cause) | Except.ok operation => (match ((Nat.beq ((version).value) (1)) && (Nat.beq ((operation).value) (0))) with | Bool.false => Except.error (PrismPM.Foundation.Codec.Cbor.V1.Primitive.CborError.WrongType) | Bool.true => (match readPublicationContextFields (input) ((operation).cursor) with | Except.error cause => Except.error (cause) | Except.ok fields => (match publicationLinkageFinish (input) ((fields).cursor) with | Except.error cause => Except.error (cause) | Except.ok _ => PrismPM.Production.PublicationAdmission.V1Wire.publicationWirePreimageResult (PrismPM.Production.PublicationAdmission.V1Wire.publicationContextFieldsPreimage (((fields).value).declaration) (((fields).value).declarationIdentity) (((fields).value).subject) (((fields).value).«instance») (((fields).value).publisherRevision) (((fields).value).publisherRef)))))))))

@[expose] public def publicationContextFieldsWireBytes (input : ByteArray) : ByteArray := (match (Nat.ble ((LexLeanRuntime.length (input) : Nat)) (67108864)) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 131)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 2)), (_root_.UInt8.ofNat (nat_lit 6))] | Bool.true => (match dispatchPublicationContextFields (({ bytes := input } : PrismPM.Production.PublicationAdmission.V1Wire.PublicationWireInput)) with | Except.error cause => PrismPM.Production.PublicationAdmission.V1Wire.publicationWireErrorBytes (cause) | Except.ok response => response))

end PrismPM.Production.PublicationAdmission.LinkageV1Wire
