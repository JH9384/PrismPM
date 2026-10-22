module
public import Init
public import PrismPM.Foundation.Bytes
public import PrismPM.Foundation.Codec
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
namespace PrismPM.Foundation.Codec.Cbor.V1.Primitive

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

public inductive CborError where
  | BadLimits
  | BadCursor
  | Truncated
  | WrongType
  | UnsupportedHead
  | NonCanonical
  | ValueLimit
  | InvalidUtf8
  | TrailingInput

public structure CborLimits where
  maximumInput : Nat
  maximumOutput : Nat
  maximumBytes : Nat
  maximumText : Nat
  maximumArrayItems : Nat

public inductive CborValue where
  | Unsigned (_ : Nat)
  | ByteString (_ : ByteArray)
  | TextString (_ : String)
  | Boolean (_ : Bool)
  | Null

public structure CborHead where
  argument : Nat
  cursor : PrismPM.Foundation.Codec.BoundedCursor

public structure CborPayload where
  bytes : ByteArray
  cursor : PrismPM.Foundation.Codec.BoundedCursor

public structure CborDecoded where
  value : CborValue
  cursor : PrismPM.Foundation.Codec.BoundedCursor

public structure CborArrayHead where
  count : Nat
  cursor : PrismPM.Foundation.Codec.BoundedCursor

@[expose] public def cborLimitsValid (limits : CborLimits) : Bool := ((Nat.ble ((limits).maximumInput) (4294967295)) && ((Nat.ble ((limits).maximumOutput) (4294967295)) && ((Nat.ble ((limits).maximumBytes) (4294967295)) && ((Nat.ble ((limits).maximumText) (4294967295)) && ((Nat.ble ((limits).maximumArrayItems) (4294967295)) && true)))))

@[expose] public def cborCursorValid (cursor : PrismPM.Foundation.Codec.BoundedCursor) (limits : CborLimits) : Bool := ((Nat.ble ((LexLeanRuntime.length ((cursor).bytes) : Nat)) ((limits).maximumInput)) && ((Nat.ble ((cursor).limit) ((LexLeanRuntime.length ((cursor).bytes) : Nat))) && ((Nat.ble ((cursor).offset) ((cursor).limit)) && true)))

@[expose] public def cborOctetNat (value : UInt8) : Nat := ((((((((0 + (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd (value) ((1 : UInt8)) : UInt8)) ((1 : UInt8)) : Bool) with | Bool.false => 0 | Bool.true => 1)) + (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd (value) ((2 : UInt8)) : UInt8)) ((2 : UInt8)) : Bool) with | Bool.false => 0 | Bool.true => 2)) + (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd (value) ((4 : UInt8)) : UInt8)) ((4 : UInt8)) : Bool) with | Bool.false => 0 | Bool.true => 4)) + (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd (value) ((8 : UInt8)) : UInt8)) ((8 : UInt8)) : Bool) with | Bool.false => 0 | Bool.true => 8)) + (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd (value) ((16 : UInt8)) : UInt8)) ((16 : UInt8)) : Bool) with | Bool.false => 0 | Bool.true => 16)) + (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd (value) ((32 : UInt8)) : UInt8)) ((32 : UInt8)) : Bool) with | Bool.false => 0 | Bool.true => 32)) + (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd (value) ((64 : UInt8)) : UInt8)) ((64 : UInt8)) : Bool) with | Bool.false => 0 | Bool.true => 64)) + (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd (value) ((128 : UInt8)) : UInt8)) ((128 : UInt8)) : Bool) with | Bool.false => 0 | Bool.true => 128))

@[expose] public def cborOctetTable0 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 2)), (_root_.UInt8.ofNat (nat_lit 3)), (_root_.UInt8.ofNat (nat_lit 4)), (_root_.UInt8.ofNat (nat_lit 5)), (_root_.UInt8.ofNat (nat_lit 6)), (_root_.UInt8.ofNat (nat_lit 7)), (_root_.UInt8.ofNat (nat_lit 8)), (_root_.UInt8.ofNat (nat_lit 9)), (_root_.UInt8.ofNat (nat_lit 10)), (_root_.UInt8.ofNat (nat_lit 11)), (_root_.UInt8.ofNat (nat_lit 12)), (_root_.UInt8.ofNat (nat_lit 13)), (_root_.UInt8.ofNat (nat_lit 14)), (_root_.UInt8.ofNat (nat_lit 15))]

@[expose] public def cborOctetTable1 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 16)), (_root_.UInt8.ofNat (nat_lit 17)), (_root_.UInt8.ofNat (nat_lit 18)), (_root_.UInt8.ofNat (nat_lit 19)), (_root_.UInt8.ofNat (nat_lit 20)), (_root_.UInt8.ofNat (nat_lit 21)), (_root_.UInt8.ofNat (nat_lit 22)), (_root_.UInt8.ofNat (nat_lit 23)), (_root_.UInt8.ofNat (nat_lit 24)), (_root_.UInt8.ofNat (nat_lit 25)), (_root_.UInt8.ofNat (nat_lit 26)), (_root_.UInt8.ofNat (nat_lit 27)), (_root_.UInt8.ofNat (nat_lit 28)), (_root_.UInt8.ofNat (nat_lit 29)), (_root_.UInt8.ofNat (nat_lit 30)), (_root_.UInt8.ofNat (nat_lit 31))]

@[expose] public def cborOctetTable2 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 32)), (_root_.UInt8.ofNat (nat_lit 33)), (_root_.UInt8.ofNat (nat_lit 34)), (_root_.UInt8.ofNat (nat_lit 35)), (_root_.UInt8.ofNat (nat_lit 36)), (_root_.UInt8.ofNat (nat_lit 37)), (_root_.UInt8.ofNat (nat_lit 38)), (_root_.UInt8.ofNat (nat_lit 39)), (_root_.UInt8.ofNat (nat_lit 40)), (_root_.UInt8.ofNat (nat_lit 41)), (_root_.UInt8.ofNat (nat_lit 42)), (_root_.UInt8.ofNat (nat_lit 43)), (_root_.UInt8.ofNat (nat_lit 44)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 46)), (_root_.UInt8.ofNat (nat_lit 47))]

@[expose] public def cborOctetTable3 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 48)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 50)), (_root_.UInt8.ofNat (nat_lit 51)), (_root_.UInt8.ofNat (nat_lit 52)), (_root_.UInt8.ofNat (nat_lit 53)), (_root_.UInt8.ofNat (nat_lit 54)), (_root_.UInt8.ofNat (nat_lit 55)), (_root_.UInt8.ofNat (nat_lit 56)), (_root_.UInt8.ofNat (nat_lit 57)), (_root_.UInt8.ofNat (nat_lit 58)), (_root_.UInt8.ofNat (nat_lit 59)), (_root_.UInt8.ofNat (nat_lit 60)), (_root_.UInt8.ofNat (nat_lit 61)), (_root_.UInt8.ofNat (nat_lit 62)), (_root_.UInt8.ofNat (nat_lit 63))]

@[expose] public def cborOctetTable4 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 64)), (_root_.UInt8.ofNat (nat_lit 65)), (_root_.UInt8.ofNat (nat_lit 66)), (_root_.UInt8.ofNat (nat_lit 67)), (_root_.UInt8.ofNat (nat_lit 68)), (_root_.UInt8.ofNat (nat_lit 69)), (_root_.UInt8.ofNat (nat_lit 70)), (_root_.UInt8.ofNat (nat_lit 71)), (_root_.UInt8.ofNat (nat_lit 72)), (_root_.UInt8.ofNat (nat_lit 73)), (_root_.UInt8.ofNat (nat_lit 74)), (_root_.UInt8.ofNat (nat_lit 75)), (_root_.UInt8.ofNat (nat_lit 76)), (_root_.UInt8.ofNat (nat_lit 77)), (_root_.UInt8.ofNat (nat_lit 78)), (_root_.UInt8.ofNat (nat_lit 79))]

@[expose] public def cborOctetTable5 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 81)), (_root_.UInt8.ofNat (nat_lit 82)), (_root_.UInt8.ofNat (nat_lit 83)), (_root_.UInt8.ofNat (nat_lit 84)), (_root_.UInt8.ofNat (nat_lit 85)), (_root_.UInt8.ofNat (nat_lit 86)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 88)), (_root_.UInt8.ofNat (nat_lit 89)), (_root_.UInt8.ofNat (nat_lit 90)), (_root_.UInt8.ofNat (nat_lit 91)), (_root_.UInt8.ofNat (nat_lit 92)), (_root_.UInt8.ofNat (nat_lit 93)), (_root_.UInt8.ofNat (nat_lit 94)), (_root_.UInt8.ofNat (nat_lit 95))]

@[expose] public def cborOctetTable6 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 96)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 98)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 100)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 102)), (_root_.UInt8.ofNat (nat_lit 103)), (_root_.UInt8.ofNat (nat_lit 104)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 106)), (_root_.UInt8.ofNat (nat_lit 107)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 111))]

@[expose] public def cborOctetTable7 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 113)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 116)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 118)), (_root_.UInt8.ofNat (nat_lit 119)), (_root_.UInt8.ofNat (nat_lit 120)), (_root_.UInt8.ofNat (nat_lit 121)), (_root_.UInt8.ofNat (nat_lit 122)), (_root_.UInt8.ofNat (nat_lit 123)), (_root_.UInt8.ofNat (nat_lit 124)), (_root_.UInt8.ofNat (nat_lit 125)), (_root_.UInt8.ofNat (nat_lit 126)), (_root_.UInt8.ofNat (nat_lit 127))]

@[expose] public def cborOctetTable8 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 128)), (_root_.UInt8.ofNat (nat_lit 129)), (_root_.UInt8.ofNat (nat_lit 130)), (_root_.UInt8.ofNat (nat_lit 131)), (_root_.UInt8.ofNat (nat_lit 132)), (_root_.UInt8.ofNat (nat_lit 133)), (_root_.UInt8.ofNat (nat_lit 134)), (_root_.UInt8.ofNat (nat_lit 135)), (_root_.UInt8.ofNat (nat_lit 136)), (_root_.UInt8.ofNat (nat_lit 137)), (_root_.UInt8.ofNat (nat_lit 138)), (_root_.UInt8.ofNat (nat_lit 139)), (_root_.UInt8.ofNat (nat_lit 140)), (_root_.UInt8.ofNat (nat_lit 141)), (_root_.UInt8.ofNat (nat_lit 142)), (_root_.UInt8.ofNat (nat_lit 143))]

@[expose] public def cborOctetTable9 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 144)), (_root_.UInt8.ofNat (nat_lit 145)), (_root_.UInt8.ofNat (nat_lit 146)), (_root_.UInt8.ofNat (nat_lit 147)), (_root_.UInt8.ofNat (nat_lit 148)), (_root_.UInt8.ofNat (nat_lit 149)), (_root_.UInt8.ofNat (nat_lit 150)), (_root_.UInt8.ofNat (nat_lit 151)), (_root_.UInt8.ofNat (nat_lit 152)), (_root_.UInt8.ofNat (nat_lit 153)), (_root_.UInt8.ofNat (nat_lit 154)), (_root_.UInt8.ofNat (nat_lit 155)), (_root_.UInt8.ofNat (nat_lit 156)), (_root_.UInt8.ofNat (nat_lit 157)), (_root_.UInt8.ofNat (nat_lit 158)), (_root_.UInt8.ofNat (nat_lit 159))]

@[expose] public def cborOctetTable10 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 160)), (_root_.UInt8.ofNat (nat_lit 161)), (_root_.UInt8.ofNat (nat_lit 162)), (_root_.UInt8.ofNat (nat_lit 163)), (_root_.UInt8.ofNat (nat_lit 164)), (_root_.UInt8.ofNat (nat_lit 165)), (_root_.UInt8.ofNat (nat_lit 166)), (_root_.UInt8.ofNat (nat_lit 167)), (_root_.UInt8.ofNat (nat_lit 168)), (_root_.UInt8.ofNat (nat_lit 169)), (_root_.UInt8.ofNat (nat_lit 170)), (_root_.UInt8.ofNat (nat_lit 171)), (_root_.UInt8.ofNat (nat_lit 172)), (_root_.UInt8.ofNat (nat_lit 173)), (_root_.UInt8.ofNat (nat_lit 174)), (_root_.UInt8.ofNat (nat_lit 175))]

@[expose] public def cborOctetTable11 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 176)), (_root_.UInt8.ofNat (nat_lit 177)), (_root_.UInt8.ofNat (nat_lit 178)), (_root_.UInt8.ofNat (nat_lit 179)), (_root_.UInt8.ofNat (nat_lit 180)), (_root_.UInt8.ofNat (nat_lit 181)), (_root_.UInt8.ofNat (nat_lit 182)), (_root_.UInt8.ofNat (nat_lit 183)), (_root_.UInt8.ofNat (nat_lit 184)), (_root_.UInt8.ofNat (nat_lit 185)), (_root_.UInt8.ofNat (nat_lit 186)), (_root_.UInt8.ofNat (nat_lit 187)), (_root_.UInt8.ofNat (nat_lit 188)), (_root_.UInt8.ofNat (nat_lit 189)), (_root_.UInt8.ofNat (nat_lit 190)), (_root_.UInt8.ofNat (nat_lit 191))]

@[expose] public def cborOctetTable12 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 192)), (_root_.UInt8.ofNat (nat_lit 193)), (_root_.UInt8.ofNat (nat_lit 194)), (_root_.UInt8.ofNat (nat_lit 195)), (_root_.UInt8.ofNat (nat_lit 196)), (_root_.UInt8.ofNat (nat_lit 197)), (_root_.UInt8.ofNat (nat_lit 198)), (_root_.UInt8.ofNat (nat_lit 199)), (_root_.UInt8.ofNat (nat_lit 200)), (_root_.UInt8.ofNat (nat_lit 201)), (_root_.UInt8.ofNat (nat_lit 202)), (_root_.UInt8.ofNat (nat_lit 203)), (_root_.UInt8.ofNat (nat_lit 204)), (_root_.UInt8.ofNat (nat_lit 205)), (_root_.UInt8.ofNat (nat_lit 206)), (_root_.UInt8.ofNat (nat_lit 207))]

@[expose] public def cborOctetTable13 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 208)), (_root_.UInt8.ofNat (nat_lit 209)), (_root_.UInt8.ofNat (nat_lit 210)), (_root_.UInt8.ofNat (nat_lit 211)), (_root_.UInt8.ofNat (nat_lit 212)), (_root_.UInt8.ofNat (nat_lit 213)), (_root_.UInt8.ofNat (nat_lit 214)), (_root_.UInt8.ofNat (nat_lit 215)), (_root_.UInt8.ofNat (nat_lit 216)), (_root_.UInt8.ofNat (nat_lit 217)), (_root_.UInt8.ofNat (nat_lit 218)), (_root_.UInt8.ofNat (nat_lit 219)), (_root_.UInt8.ofNat (nat_lit 220)), (_root_.UInt8.ofNat (nat_lit 221)), (_root_.UInt8.ofNat (nat_lit 222)), (_root_.UInt8.ofNat (nat_lit 223))]

@[expose] public def cborOctetTable14 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 224)), (_root_.UInt8.ofNat (nat_lit 225)), (_root_.UInt8.ofNat (nat_lit 226)), (_root_.UInt8.ofNat (nat_lit 227)), (_root_.UInt8.ofNat (nat_lit 228)), (_root_.UInt8.ofNat (nat_lit 229)), (_root_.UInt8.ofNat (nat_lit 230)), (_root_.UInt8.ofNat (nat_lit 231)), (_root_.UInt8.ofNat (nat_lit 232)), (_root_.UInt8.ofNat (nat_lit 233)), (_root_.UInt8.ofNat (nat_lit 234)), (_root_.UInt8.ofNat (nat_lit 235)), (_root_.UInt8.ofNat (nat_lit 236)), (_root_.UInt8.ofNat (nat_lit 237)), (_root_.UInt8.ofNat (nat_lit 238)), (_root_.UInt8.ofNat (nat_lit 239))]

@[expose] public def cborOctetTable15 : ByteArray := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 240)), (_root_.UInt8.ofNat (nat_lit 241)), (_root_.UInt8.ofNat (nat_lit 242)), (_root_.UInt8.ofNat (nat_lit 243)), (_root_.UInt8.ofNat (nat_lit 244)), (_root_.UInt8.ofNat (nat_lit 245)), (_root_.UInt8.ofNat (nat_lit 246)), (_root_.UInt8.ofNat (nat_lit 247)), (_root_.UInt8.ofNat (nat_lit 248)), (_root_.UInt8.ofNat (nat_lit 249)), (_root_.UInt8.ofNat (nat_lit 250)), (_root_.UInt8.ofNat (nat_lit 251)), (_root_.UInt8.ofNat (nat_lit 252)), (_root_.UInt8.ofNat (nat_lit 253)), (_root_.UInt8.ofNat (nat_lit 254)), (_root_.UInt8.ofNat (nat_lit 255))]

@[expose] public def cborOctetBytes (value : Nat) : ByteArray := (match (Nat.blt (value) (256)) with | Bool.false => _root_.ByteArray.mk #[] | Bool.true => (match (LexLeanRuntime.slice ((match (Nat.blt (value) (128)) with | Bool.false => (match (Nat.blt (value) (192)) with | Bool.false => (match (Nat.blt (value) (224)) with | Bool.false => (match (Nat.blt (value) (240)) with | Bool.false => cborOctetTable15 | Bool.true => cborOctetTable14) | Bool.true => (match (Nat.blt (value) (208)) with | Bool.false => cborOctetTable13 | Bool.true => cborOctetTable12)) | Bool.true => (match (Nat.blt (value) (160)) with | Bool.false => (match (Nat.blt (value) (176)) with | Bool.false => cborOctetTable11 | Bool.true => cborOctetTable10) | Bool.true => (match (Nat.blt (value) (144)) with | Bool.false => cborOctetTable9 | Bool.true => cborOctetTable8))) | Bool.true => (match (Nat.blt (value) (64)) with | Bool.false => (match (Nat.blt (value) (96)) with | Bool.false => (match (Nat.blt (value) (112)) with | Bool.false => cborOctetTable7 | Bool.true => cborOctetTable6) | Bool.true => (match (Nat.blt (value) (80)) with | Bool.false => cborOctetTable5 | Bool.true => cborOctetTable4)) | Bool.true => (match (Nat.blt (value) (32)) with | Bool.false => (match (Nat.blt (value) (48)) with | Bool.false => cborOctetTable3 | Bool.true => cborOctetTable2) | Bool.true => (match (Nat.blt (value) (16)) with | Bool.false => cborOctetTable1 | Bool.true => cborOctetTable0))))) ((LexLeanRuntime.remainder (value) (16) (0) : Nat)) (1) : Option (ByteArray)) with | Option.none => _root_.ByteArray.mk #[] | Option.some octetBytes => octetBytes))

@[expose] public def cborRead1 (cursor : PrismPM.Foundation.Codec.BoundedCursor) : Except (CborError) (CborHead) := (match (Nat.ble (1) ((LexLeanRuntime.subtract ((cursor).limit) ((cursor).offset) : Nat))) with | Bool.false => Except.error (CborError.Truncated) | Bool.true => (match PrismPM.Foundation.Bytes.byteAt ((cursor).bytes) (((cursor).offset + 0)) with | Option.none => Except.error (CborError.Truncated) | Option.some octet0 => Except.ok (({ argument := (0 + (LexLeanRuntime.multiply (cborOctetNat (octet0)) (1) : Nat)), cursor := ({ bytes := (cursor).bytes, offset := ((cursor).offset + 1), limit := (cursor).limit } : PrismPM.Foundation.Codec.BoundedCursor) } : CborHead))))

@[expose] public def cborRead2 (cursor : PrismPM.Foundation.Codec.BoundedCursor) : Except (CborError) (CborHead) := (match (Nat.ble (2) ((LexLeanRuntime.subtract ((cursor).limit) ((cursor).offset) : Nat))) with | Bool.false => Except.error (CborError.Truncated) | Bool.true => (match PrismPM.Foundation.Bytes.byteAt ((cursor).bytes) (((cursor).offset + 0)) with | Option.none => Except.error (CborError.Truncated) | Option.some octet0 => (match PrismPM.Foundation.Bytes.byteAt ((cursor).bytes) (((cursor).offset + 1)) with | Option.none => Except.error (CborError.Truncated) | Option.some octet1 => Except.ok (({ argument := ((0 + (LexLeanRuntime.multiply (cborOctetNat (octet0)) (256) : Nat)) + (LexLeanRuntime.multiply (cborOctetNat (octet1)) (1) : Nat)), cursor := ({ bytes := (cursor).bytes, offset := ((cursor).offset + 2), limit := (cursor).limit } : PrismPM.Foundation.Codec.BoundedCursor) } : CborHead)))))

@[expose] public def cborRead4 (cursor : PrismPM.Foundation.Codec.BoundedCursor) : Except (CborError) (CborHead) := (match (Nat.ble (4) ((LexLeanRuntime.subtract ((cursor).limit) ((cursor).offset) : Nat))) with | Bool.false => Except.error (CborError.Truncated) | Bool.true => (match PrismPM.Foundation.Bytes.byteAt ((cursor).bytes) (((cursor).offset + 0)) with | Option.none => Except.error (CborError.Truncated) | Option.some octet0 => (match PrismPM.Foundation.Bytes.byteAt ((cursor).bytes) (((cursor).offset + 1)) with | Option.none => Except.error (CborError.Truncated) | Option.some octet1 => (match PrismPM.Foundation.Bytes.byteAt ((cursor).bytes) (((cursor).offset + 2)) with | Option.none => Except.error (CborError.Truncated) | Option.some octet2 => (match PrismPM.Foundation.Bytes.byteAt ((cursor).bytes) (((cursor).offset + 3)) with | Option.none => Except.error (CborError.Truncated) | Option.some octet3 => Except.ok (({ argument := ((((0 + (LexLeanRuntime.multiply (cborOctetNat (octet0)) (16777216) : Nat)) + (LexLeanRuntime.multiply (cborOctetNat (octet1)) (65536) : Nat)) + (LexLeanRuntime.multiply (cborOctetNat (octet2)) (256) : Nat)) + (LexLeanRuntime.multiply (cborOctetNat (octet3)) (1) : Nat)), cursor := ({ bytes := (cursor).bytes, offset := ((cursor).offset + 4), limit := (cursor).limit } : PrismPM.Foundation.Codec.BoundedCursor) } : CborHead)))))))

@[expose] public def cborReadHeadArgument (cursor : PrismPM.Foundation.Codec.BoundedCursor) (additional : Nat) : Except (CborError) (CborHead) := (match (Nat.blt (additional) (24)) with | Bool.false => (match (Nat.beq (additional) (24)) with | Bool.false => (match (Nat.beq (additional) (25)) with | Bool.false => (match (Nat.beq (additional) (26)) with | Bool.false => Except.error (CborError.UnsupportedHead) | Bool.true => (match cborRead4 (cursor) with | Except.error cause => Except.error (cause) | Except.ok read => (match (Nat.ble (65536) ((read).argument)) with | Bool.false => Except.error (CborError.NonCanonical) | Bool.true => Except.ok (read)))) | Bool.true => (match cborRead2 (cursor) with | Except.error cause => Except.error (cause) | Except.ok read => (match (Nat.ble (256) ((read).argument)) with | Bool.false => Except.error (CborError.NonCanonical) | Bool.true => Except.ok (read)))) | Bool.true => (match cborRead1 (cursor) with | Except.error cause => Except.error (cause) | Except.ok read => (match (Nat.ble (24) ((read).argument)) with | Bool.false => Except.error (CborError.NonCanonical) | Bool.true => Except.ok (read)))) | Bool.true => Except.ok (({ argument := additional, cursor := cursor } : CborHead)))

@[expose] public def cborReadHeadInitial (cursor : PrismPM.Foundation.Codec.BoundedCursor) (major : Nat) (initial : Nat) : Except (CborError) (CborHead) := (match (Nat.beq ((LexLeanRuntime.quotient (initial) (32) (0) : Nat)) (major)) with | Bool.false => Except.error (CborError.WrongType) | Bool.true => cborReadHeadArgument (({ bytes := (cursor).bytes, offset := ((cursor).offset + 1), limit := (cursor).limit } : PrismPM.Foundation.Codec.BoundedCursor)) ((LexLeanRuntime.remainder (initial) (32) (0) : Nat)))

@[expose] public def cborReadHead (cursor : PrismPM.Foundation.Codec.BoundedCursor) (limits : CborLimits) (major : Nat) : Except (CborError) (CborHead) := (match cborLimitsValid (limits) with | Bool.false => Except.error (CborError.BadLimits) | Bool.true => (match cborCursorValid (cursor) (limits) with | Bool.false => Except.error (CborError.BadCursor) | Bool.true => (match (Nat.blt ((cursor).offset) ((cursor).limit)) with | Bool.false => Except.error (CborError.Truncated) | Bool.true => (match PrismPM.Foundation.Bytes.byteAt ((cursor).bytes) ((cursor).offset) with | Option.none => Except.error (CborError.Truncated) | Option.some initialByte => cborReadHeadInitial (cursor) (major) (cborOctetNat (initialByte))))))

@[expose] public def cborReadPayload (head : CborHead) (maximum : Nat) : Except (CborError) (CborPayload) := (match (Nat.ble ((head).argument) (maximum)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => (match (Nat.ble ((head).argument) ((LexLeanRuntime.subtract (((head).cursor).limit) (((head).cursor).offset) : Nat))) with | Bool.false => Except.error (CborError.Truncated) | Bool.true => (match PrismPM.Foundation.Bytes.sliceBytes (((head).cursor).bytes) (((head).cursor).offset) ((head).argument) with | Option.none => Except.error (CborError.Truncated) | Option.some payload => Except.ok (({ bytes := payload, cursor := ({ bytes := ((head).cursor).bytes, offset := (((head).cursor).offset + (head).argument), limit := ((head).cursor).limit } : PrismPM.Foundation.Codec.BoundedCursor) } : CborPayload)))))

@[expose] public def cborReadString (cursor : PrismPM.Foundation.Codec.BoundedCursor) (limits : CborLimits) (textMode : Bool) : Except (CborError) (CborDecoded) := (match cborReadHead (cursor) (limits) ((match textMode with | Bool.false => 2 | Bool.true => 3)) with | Except.error cause => Except.error (cause) | Except.ok head => (match cborReadPayload (head) ((match textMode with | Bool.false => (limits).maximumBytes | Bool.true => (limits).maximumText)) with | Except.error cause => Except.error (cause) | Except.ok payload => (match textMode with | Bool.false => Except.ok (({ value := CborValue.ByteString ((payload).bytes), cursor := (payload).cursor } : CborDecoded)) | Bool.true => (match (LexLeanRuntime.utf8Decode ((payload).bytes) : Option (String)) with | Option.none => Except.error (CborError.InvalidUtf8) | Option.some textValue => Except.ok (({ value := CborValue.TextString (textValue), cursor := (payload).cursor } : CborDecoded))))))

@[expose] public def cborReadPrimitiveInitial (cursor : PrismPM.Foundation.Codec.BoundedCursor) (limits : CborLimits) (initial : Nat) : Except (CborError) (CborDecoded) := (match (Nat.beq ((LexLeanRuntime.quotient (initial) (32) (0) : Nat)) (0)) with | Bool.false => (match (Nat.beq ((LexLeanRuntime.quotient (initial) (32) (0) : Nat)) (2)) with | Bool.false => (match (Nat.beq ((LexLeanRuntime.quotient (initial) (32) (0) : Nat)) (3)) with | Bool.false => (match (Nat.beq (initial) (244)) with | Bool.false => (match (Nat.beq (initial) (245)) with | Bool.false => (match (Nat.beq (initial) (246)) with | Bool.false => Except.error (CborError.WrongType) | Bool.true => Except.ok (({ value := CborValue.Null, cursor := ({ bytes := (cursor).bytes, offset := ((cursor).offset + 1), limit := (cursor).limit } : PrismPM.Foundation.Codec.BoundedCursor) } : CborDecoded))) | Bool.true => Except.ok (({ value := CborValue.Boolean (true), cursor := ({ bytes := (cursor).bytes, offset := ((cursor).offset + 1), limit := (cursor).limit } : PrismPM.Foundation.Codec.BoundedCursor) } : CborDecoded))) | Bool.true => Except.ok (({ value := CborValue.Boolean (false), cursor := ({ bytes := (cursor).bytes, offset := ((cursor).offset + 1), limit := (cursor).limit } : PrismPM.Foundation.Codec.BoundedCursor) } : CborDecoded))) | Bool.true => cborReadString (cursor) (limits) (true)) | Bool.true => cborReadString (cursor) (limits) (false)) | Bool.true => (match cborReadHead (cursor) (limits) (0) with | Except.error cause => Except.error (cause) | Except.ok head => Except.ok (({ value := CborValue.Unsigned ((head).argument), cursor := (head).cursor } : CborDecoded))))

@[expose] public def readCborPrimitive (cursor : PrismPM.Foundation.Codec.BoundedCursor) (limits : CborLimits) : Except (CborError) (CborDecoded) := (match cborLimitsValid (limits) with | Bool.false => Except.error (CborError.BadLimits) | Bool.true => (match cborCursorValid (cursor) (limits) with | Bool.false => Except.error (CborError.BadCursor) | Bool.true => (match (Nat.blt ((cursor).offset) ((cursor).limit)) with | Bool.false => Except.error (CborError.Truncated) | Bool.true => (match PrismPM.Foundation.Bytes.byteAt ((cursor).bytes) ((cursor).offset) with | Option.none => Except.error (CborError.Truncated) | Option.some initialByte => cborReadPrimitiveInitial (cursor) (limits) (cborOctetNat (initialByte))))))

@[expose] public def readCborArrayHead (cursor : PrismPM.Foundation.Codec.BoundedCursor) (limits : CborLimits) : Except (CborError) (CborArrayHead) := (match cborReadHead (cursor) (limits) (4) with | Except.error cause => Except.error (cause) | Except.ok head => (match (Nat.ble ((head).argument) ((limits).maximumArrayItems)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => Except.ok (({ count := (head).argument, cursor := (head).cursor } : CborArrayHead))))

@[expose] public def finishCborCursor (cursor : PrismPM.Foundation.Codec.BoundedCursor) (limits : CborLimits) : Except (CborError) (Bool) := (match cborLimitsValid (limits) with | Bool.false => Except.error (CborError.BadLimits) | Bool.true => (match cborCursorValid (cursor) (limits) with | Bool.false => Except.error (CborError.BadCursor) | Bool.true => (match (Nat.beq ((cursor).offset) ((cursor).limit)) with | Bool.false => Except.error (CborError.TrailingInput) | Bool.true => Except.ok (true))))

@[expose] public def cborHeadWidth (value : Nat) : Nat := (match (Nat.blt (value) (24)) with | Bool.false => (match (Nat.ble (value) (255)) with | Bool.false => (match (Nat.ble (value) (65535)) with | Bool.false => 5 | Bool.true => 3) | Bool.true => 2) | Bool.true => 1)

@[expose] public def cborWriteHeadUnchecked (value : Nat) (major : Nat) : ByteArray := (match (Nat.blt (value) (24)) with | Bool.false => (match (Nat.ble (value) (255)) with | Bool.false => (match (Nat.ble (value) (65535)) with | Bool.false => (LexLeanRuntime.append (cborOctetBytes (((LexLeanRuntime.multiply (major) (32) : Nat) + 26))) ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (cborOctetBytes ((LexLeanRuntime.remainder ((LexLeanRuntime.quotient (value) (16777216) (0) : Nat)) (256) (0) : Nat))) : ByteArray)) (cborOctetBytes ((LexLeanRuntime.remainder ((LexLeanRuntime.quotient (value) (65536) (0) : Nat)) (256) (0) : Nat))) : ByteArray)) (cborOctetBytes ((LexLeanRuntime.remainder ((LexLeanRuntime.quotient (value) (256) (0) : Nat)) (256) (0) : Nat))) : ByteArray)) (cborOctetBytes ((LexLeanRuntime.remainder ((LexLeanRuntime.quotient (value) (1) (0) : Nat)) (256) (0) : Nat))) : ByteArray)) : ByteArray) | Bool.true => (LexLeanRuntime.append (cborOctetBytes (((LexLeanRuntime.multiply (major) (32) : Nat) + 25))) ((LexLeanRuntime.append (cborOctetBytes ((LexLeanRuntime.quotient (value) (256) (0) : Nat))) (cborOctetBytes ((LexLeanRuntime.remainder (value) (256) (0) : Nat))) : ByteArray)) : ByteArray)) | Bool.true => (LexLeanRuntime.append (cborOctetBytes (((LexLeanRuntime.multiply (major) (32) : Nat) + 24))) (cborOctetBytes (value)) : ByteArray)) | Bool.true => cborOctetBytes (((LexLeanRuntime.multiply (major) (32) : Nat) + value)))

@[expose] public def cborWriteHead (value : Nat) (major : Nat) (limits : CborLimits) : Except (CborError) (ByteArray) := (match cborLimitsValid (limits) with | Bool.false => Except.error (CborError.BadLimits) | Bool.true => (match (Nat.ble (value) (4294967295)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => (match (Nat.ble (cborHeadWidth (value)) ((limits).maximumOutput)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => Except.ok (cborWriteHeadUnchecked (value) (major)))))

@[expose] public def cborWritePayload (bytes : ByteArray) (major : Nat) (maximum : Nat) (limits : CborLimits) : Except (CborError) (ByteArray) := (match (Nat.ble ((LexLeanRuntime.length (bytes) : Nat)) (maximum)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => (match (Nat.ble (((LexLeanRuntime.length (bytes) : Nat) + cborHeadWidth ((LexLeanRuntime.length (bytes) : Nat)))) ((limits).maximumOutput)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => (match cborWriteHead ((LexLeanRuntime.length (bytes) : Nat)) (major) (limits) with | Except.error cause => Except.error (cause) | Except.ok headBytes => Except.ok (PrismPM.Foundation.Bytes.appendBytes (headBytes) (bytes)))))

@[expose] public def cborTextLength (value : String) : Nat := (LexLeanRuntime.length (value) : Nat)

@[expose] public def cborWritePrimitiveChecked (value : CborValue) (limits : CborLimits) : Except (CborError) (ByteArray) := (match value with | CborValue.Unsigned integer => cborWriteHead (integer) (0) (limits) | CborValue.ByteString payload => cborWritePayload (payload) (2) ((limits).maximumBytes) (limits) | CborValue.TextString textValue => (match (Nat.ble (cborTextLength (textValue)) ((limits).maximumText)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => cborWritePayload ((LexLeanRuntime.utf8Encode (textValue) : ByteArray)) (3) ((limits).maximumText) (limits)) | CborValue.Boolean boolean => (match (Nat.ble (1) ((limits).maximumOutput)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => Except.ok ((match boolean with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 244))] | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 245))]))) | CborValue.Null => (match (Nat.ble (1) ((limits).maximumOutput)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => Except.ok (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 246))])))

@[expose] public def writeCborPrimitive (value : CborValue) (limits : CborLimits) : Except (CborError) (ByteArray) := (match cborLimitsValid (limits) with | Bool.false => Except.error (CborError.BadLimits) | Bool.true => cborWritePrimitiveChecked (value) (limits))

@[expose] public def writeCborArrayHead (count : Nat) (limits : CborLimits) : Except (CborError) (ByteArray) := (match cborLimitsValid (limits) with | Bool.false => Except.error (CborError.BadLimits) | Bool.true => (match (Nat.ble (count) ((limits).maximumArrayItems)) with | Bool.false => Except.error (CborError.ValueLimit) | Bool.true => cborWriteHead (count) (4) (limits)))

@[expose] public def cborInvocationLimits : CborLimits := ({ maximumInput := 4202618, maximumOutput := 4202617, maximumBytes := 4202612, maximumText := 4202612, maximumArrayItems := 4294967295 } : CborLimits)

@[expose] public def cborCanonicalResult (decoded : CborDecoded) : ByteArray := (match finishCborCursor ((decoded).cursor) (cborInvocationLimits) with | Except.error _ => _root_.ByteArray.mk #[] | Except.ok _ => (match writeCborPrimitive ((decoded).value) (cborInvocationLimits) with | Except.error _ => _root_.ByteArray.mk #[] | Except.ok encoded => encoded))

@[expose] public def canonicalCborPrimitiveBytes (input : ByteArray) : ByteArray := (match readCborPrimitive (({ bytes := input, offset := 0, limit := (LexLeanRuntime.length (input) : Nat) } : PrismPM.Foundation.Codec.BoundedCursor)) (cborInvocationLimits) with | Except.error _ => _root_.ByteArray.mk #[] | Except.ok decoded => cborCanonicalResult (decoded))

end PrismPM.Foundation.Codec.Cbor.V1.Primitive
