module
public import Init
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
namespace PrismPM.Foundation.Browser.V1.Workspace

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

public structure WorkspaceByteView where
  bytes : ByteArray

public inductive WorkspaceRole where
  | Owner
  | Contributor
  | Reader
  | Absent

public inductive WorkspaceAction where
  | Genesis
  | GrantContributor
  | GrantReader
  | Revoke
  | PostMessage

public inductive WorkspaceError where
  | BadEncoding
  | BadState
  | BadIdentity
  | WrongWorkspace
  | Replay
  | StaleParent
  | StaleSequence
  | NotOwner
  | OwnerImmutable
  | AlreadyMember
  | UnknownMember
  | CannotPost
  | MemberLimit
  | MessageLimit
  | EventLimit
  | MessageBodyLimit
  | InvalidUtf8
  | GenesisRequired
  | AlreadyInitialized

public structure WorkspaceState where
  workspace : ByteArray
  owner : ByteArray
  head : ByteArray
  sequence : Nat
  members : ByteArray
  messages : ByteArray
  messageCount : Nat
  seen : ByteArray

public structure AuthenticatedEvent where
  workspace : ByteArray
  eventId : ByteArray
  parent : ByteArray
  sequence : Nat
  author : ByteArray
  action : WorkspaceAction
  body : ByteArray

public inductive WorkspaceTransition where
  | Accepted (_ : WorkspaceState)
  | Rejected (_ : WorkspaceError)

@[expose] public def workspaceBytesEqual (left : ByteArray) (right : ByteArray) : Bool := (LexLeanRuntime.equal ((LexLeanRuntime.compareBytes (left) (right) : Ordering)) ((LexLeanRuntime.compareBytes (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) : Ordering)) : Bool)

@[expose] public def byteWindow (value : ByteArray) (start : Nat) (count : Nat) : ByteArray := (match (LexLeanRuntime.slice (value) (start) (count) : Option (ByteArray)) with | Option.none => _root_.ByteArray.mk #[] | Option.some part => part)

@[expose] public def byteWindowView (view : WorkspaceByteView) (start : Nat) (count : Nat) : ByteArray := (match (LexLeanRuntime.slice ((view).bytes) (start) (count) : Option (ByteArray)) with | Option.none => _root_.ByteArray.mk #[] | Option.some part => part)

@[expose] public def workspaceOctetMatches (value : ByteArray) (offset : Nat) (expected : UInt8) : Bool := (match (LexLeanRuntime.index (value) (offset) : Option (UInt8)) with | Option.none => false | Option.some octet => (LexLeanRuntime.equal (octet) (expected) : Bool))

@[expose] public def workspaceOctetsEqualAt (value : ByteArray) (offset : Nat) (expected : ByteArray) (position : Nat) : Bool := (match (LexLeanRuntime.index (value) (offset) : Option (UInt8)) with | Option.none => false | Option.some octet => workspaceOctetMatches (expected) (position) (octet))

@[expose] public def workspaceDigestOctetsEqual : (value : ByteArray) -> (start : Nat) -> (expected : ByteArray) -> (remaining : Nat) -> Bool
  | _value, _start, _expected, Nat.zero => true
  | value, start, expected, Nat.succ rest => (workspaceOctetsEqualAt (value) ((start + rest)) (expected) (rest) && (workspaceDigestOctetsEqual (value) (start) (expected) (rest) && true))

@[expose] public def workspaceWindowEqual (value : ByteArray) (start : Nat) (count : Nat) (expected : ByteArray) : Bool := (if (Nat.beq (count) (32)) then ((Nat.ble ((start + 32)) ((LexLeanRuntime.length (value) : Nat))) && ((Nat.beq ((LexLeanRuntime.length (expected) : Nat)) (32)) && (workspaceDigestOctetsEqual (value) (start) (expected) (32) && true))) else (match (LexLeanRuntime.slice (value) (start) (count) : Option (ByteArray)) with | Option.none => false | Option.some part => workspaceBytesEqual (part) (expected)))

@[expose] public def zeroDigest : ByteArray := (let __byte0 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 0); _root_.ByteArray.mk #[__byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0])

@[expose] public def encodeOctet (value : Nat) : ByteArray := (if (Nat.blt (value) (128)) then (if (Nat.blt (value) (64)) then (if (Nat.blt (value) (32)) then (if (Nat.blt (value) (16)) then byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0)), (_root_.UInt8.ofNat (nat_lit 1)), (_root_.UInt8.ofNat (nat_lit 2)), (_root_.UInt8.ofNat (nat_lit 3)), (_root_.UInt8.ofNat (nat_lit 4)), (_root_.UInt8.ofNat (nat_lit 5)), (_root_.UInt8.ofNat (nat_lit 6)), (_root_.UInt8.ofNat (nat_lit 7)), (_root_.UInt8.ofNat (nat_lit 8)), (_root_.UInt8.ofNat (nat_lit 9)), (_root_.UInt8.ofNat (nat_lit 10)), (_root_.UInt8.ofNat (nat_lit 11)), (_root_.UInt8.ofNat (nat_lit 12)), (_root_.UInt8.ofNat (nat_lit 13)), (_root_.UInt8.ofNat (nat_lit 14)), (_root_.UInt8.ofNat (nat_lit 15))]) ((LexLeanRuntime.subtract (value) (0) : Nat)) (1) else byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 16)), (_root_.UInt8.ofNat (nat_lit 17)), (_root_.UInt8.ofNat (nat_lit 18)), (_root_.UInt8.ofNat (nat_lit 19)), (_root_.UInt8.ofNat (nat_lit 20)), (_root_.UInt8.ofNat (nat_lit 21)), (_root_.UInt8.ofNat (nat_lit 22)), (_root_.UInt8.ofNat (nat_lit 23)), (_root_.UInt8.ofNat (nat_lit 24)), (_root_.UInt8.ofNat (nat_lit 25)), (_root_.UInt8.ofNat (nat_lit 26)), (_root_.UInt8.ofNat (nat_lit 27)), (_root_.UInt8.ofNat (nat_lit 28)), (_root_.UInt8.ofNat (nat_lit 29)), (_root_.UInt8.ofNat (nat_lit 30)), (_root_.UInt8.ofNat (nat_lit 31))]) ((LexLeanRuntime.subtract (value) (16) : Nat)) (1)) else (if (Nat.blt (value) (48)) then byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 32)), (_root_.UInt8.ofNat (nat_lit 33)), (_root_.UInt8.ofNat (nat_lit 34)), (_root_.UInt8.ofNat (nat_lit 35)), (_root_.UInt8.ofNat (nat_lit 36)), (_root_.UInt8.ofNat (nat_lit 37)), (_root_.UInt8.ofNat (nat_lit 38)), (_root_.UInt8.ofNat (nat_lit 39)), (_root_.UInt8.ofNat (nat_lit 40)), (_root_.UInt8.ofNat (nat_lit 41)), (_root_.UInt8.ofNat (nat_lit 42)), (_root_.UInt8.ofNat (nat_lit 43)), (_root_.UInt8.ofNat (nat_lit 44)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 46)), (_root_.UInt8.ofNat (nat_lit 47))]) ((LexLeanRuntime.subtract (value) (32) : Nat)) (1) else byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 48)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 50)), (_root_.UInt8.ofNat (nat_lit 51)), (_root_.UInt8.ofNat (nat_lit 52)), (_root_.UInt8.ofNat (nat_lit 53)), (_root_.UInt8.ofNat (nat_lit 54)), (_root_.UInt8.ofNat (nat_lit 55)), (_root_.UInt8.ofNat (nat_lit 56)), (_root_.UInt8.ofNat (nat_lit 57)), (_root_.UInt8.ofNat (nat_lit 58)), (_root_.UInt8.ofNat (nat_lit 59)), (_root_.UInt8.ofNat (nat_lit 60)), (_root_.UInt8.ofNat (nat_lit 61)), (_root_.UInt8.ofNat (nat_lit 62)), (_root_.UInt8.ofNat (nat_lit 63))]) ((LexLeanRuntime.subtract (value) (48) : Nat)) (1))) else (if (Nat.blt (value) (96)) then (if (Nat.blt (value) (80)) then byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 64)), (_root_.UInt8.ofNat (nat_lit 65)), (_root_.UInt8.ofNat (nat_lit 66)), (_root_.UInt8.ofNat (nat_lit 67)), (_root_.UInt8.ofNat (nat_lit 68)), (_root_.UInt8.ofNat (nat_lit 69)), (_root_.UInt8.ofNat (nat_lit 70)), (_root_.UInt8.ofNat (nat_lit 71)), (_root_.UInt8.ofNat (nat_lit 72)), (_root_.UInt8.ofNat (nat_lit 73)), (_root_.UInt8.ofNat (nat_lit 74)), (_root_.UInt8.ofNat (nat_lit 75)), (_root_.UInt8.ofNat (nat_lit 76)), (_root_.UInt8.ofNat (nat_lit 77)), (_root_.UInt8.ofNat (nat_lit 78)), (_root_.UInt8.ofNat (nat_lit 79))]) ((LexLeanRuntime.subtract (value) (64) : Nat)) (1) else byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 81)), (_root_.UInt8.ofNat (nat_lit 82)), (_root_.UInt8.ofNat (nat_lit 83)), (_root_.UInt8.ofNat (nat_lit 84)), (_root_.UInt8.ofNat (nat_lit 85)), (_root_.UInt8.ofNat (nat_lit 86)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 88)), (_root_.UInt8.ofNat (nat_lit 89)), (_root_.UInt8.ofNat (nat_lit 90)), (_root_.UInt8.ofNat (nat_lit 91)), (_root_.UInt8.ofNat (nat_lit 92)), (_root_.UInt8.ofNat (nat_lit 93)), (_root_.UInt8.ofNat (nat_lit 94)), (_root_.UInt8.ofNat (nat_lit 95))]) ((LexLeanRuntime.subtract (value) (80) : Nat)) (1)) else (if (Nat.blt (value) (112)) then byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 96)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 98)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 100)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 102)), (_root_.UInt8.ofNat (nat_lit 103)), (_root_.UInt8.ofNat (nat_lit 104)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 106)), (_root_.UInt8.ofNat (nat_lit 107)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 111))]) ((LexLeanRuntime.subtract (value) (96) : Nat)) (1) else byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 113)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 116)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 118)), (_root_.UInt8.ofNat (nat_lit 119)), (_root_.UInt8.ofNat (nat_lit 120)), (_root_.UInt8.ofNat (nat_lit 121)), (_root_.UInt8.ofNat (nat_lit 122)), (_root_.UInt8.ofNat (nat_lit 123)), (_root_.UInt8.ofNat (nat_lit 124)), (_root_.UInt8.ofNat (nat_lit 125)), (_root_.UInt8.ofNat (nat_lit 126)), (_root_.UInt8.ofNat (nat_lit 127))]) ((LexLeanRuntime.subtract (value) (112) : Nat)) (1)))) else (if (Nat.blt (value) (192)) then (if (Nat.blt (value) (160)) then (if (Nat.blt (value) (144)) then byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 128)), (_root_.UInt8.ofNat (nat_lit 129)), (_root_.UInt8.ofNat (nat_lit 130)), (_root_.UInt8.ofNat (nat_lit 131)), (_root_.UInt8.ofNat (nat_lit 132)), (_root_.UInt8.ofNat (nat_lit 133)), (_root_.UInt8.ofNat (nat_lit 134)), (_root_.UInt8.ofNat (nat_lit 135)), (_root_.UInt8.ofNat (nat_lit 136)), (_root_.UInt8.ofNat (nat_lit 137)), (_root_.UInt8.ofNat (nat_lit 138)), (_root_.UInt8.ofNat (nat_lit 139)), (_root_.UInt8.ofNat (nat_lit 140)), (_root_.UInt8.ofNat (nat_lit 141)), (_root_.UInt8.ofNat (nat_lit 142)), (_root_.UInt8.ofNat (nat_lit 143))]) ((LexLeanRuntime.subtract (value) (128) : Nat)) (1) else byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 144)), (_root_.UInt8.ofNat (nat_lit 145)), (_root_.UInt8.ofNat (nat_lit 146)), (_root_.UInt8.ofNat (nat_lit 147)), (_root_.UInt8.ofNat (nat_lit 148)), (_root_.UInt8.ofNat (nat_lit 149)), (_root_.UInt8.ofNat (nat_lit 150)), (_root_.UInt8.ofNat (nat_lit 151)), (_root_.UInt8.ofNat (nat_lit 152)), (_root_.UInt8.ofNat (nat_lit 153)), (_root_.UInt8.ofNat (nat_lit 154)), (_root_.UInt8.ofNat (nat_lit 155)), (_root_.UInt8.ofNat (nat_lit 156)), (_root_.UInt8.ofNat (nat_lit 157)), (_root_.UInt8.ofNat (nat_lit 158)), (_root_.UInt8.ofNat (nat_lit 159))]) ((LexLeanRuntime.subtract (value) (144) : Nat)) (1)) else (if (Nat.blt (value) (176)) then byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 160)), (_root_.UInt8.ofNat (nat_lit 161)), (_root_.UInt8.ofNat (nat_lit 162)), (_root_.UInt8.ofNat (nat_lit 163)), (_root_.UInt8.ofNat (nat_lit 164)), (_root_.UInt8.ofNat (nat_lit 165)), (_root_.UInt8.ofNat (nat_lit 166)), (_root_.UInt8.ofNat (nat_lit 167)), (_root_.UInt8.ofNat (nat_lit 168)), (_root_.UInt8.ofNat (nat_lit 169)), (_root_.UInt8.ofNat (nat_lit 170)), (_root_.UInt8.ofNat (nat_lit 171)), (_root_.UInt8.ofNat (nat_lit 172)), (_root_.UInt8.ofNat (nat_lit 173)), (_root_.UInt8.ofNat (nat_lit 174)), (_root_.UInt8.ofNat (nat_lit 175))]) ((LexLeanRuntime.subtract (value) (160) : Nat)) (1) else byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 176)), (_root_.UInt8.ofNat (nat_lit 177)), (_root_.UInt8.ofNat (nat_lit 178)), (_root_.UInt8.ofNat (nat_lit 179)), (_root_.UInt8.ofNat (nat_lit 180)), (_root_.UInt8.ofNat (nat_lit 181)), (_root_.UInt8.ofNat (nat_lit 182)), (_root_.UInt8.ofNat (nat_lit 183)), (_root_.UInt8.ofNat (nat_lit 184)), (_root_.UInt8.ofNat (nat_lit 185)), (_root_.UInt8.ofNat (nat_lit 186)), (_root_.UInt8.ofNat (nat_lit 187)), (_root_.UInt8.ofNat (nat_lit 188)), (_root_.UInt8.ofNat (nat_lit 189)), (_root_.UInt8.ofNat (nat_lit 190)), (_root_.UInt8.ofNat (nat_lit 191))]) ((LexLeanRuntime.subtract (value) (176) : Nat)) (1))) else (if (Nat.blt (value) (224)) then (if (Nat.blt (value) (208)) then byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 192)), (_root_.UInt8.ofNat (nat_lit 193)), (_root_.UInt8.ofNat (nat_lit 194)), (_root_.UInt8.ofNat (nat_lit 195)), (_root_.UInt8.ofNat (nat_lit 196)), (_root_.UInt8.ofNat (nat_lit 197)), (_root_.UInt8.ofNat (nat_lit 198)), (_root_.UInt8.ofNat (nat_lit 199)), (_root_.UInt8.ofNat (nat_lit 200)), (_root_.UInt8.ofNat (nat_lit 201)), (_root_.UInt8.ofNat (nat_lit 202)), (_root_.UInt8.ofNat (nat_lit 203)), (_root_.UInt8.ofNat (nat_lit 204)), (_root_.UInt8.ofNat (nat_lit 205)), (_root_.UInt8.ofNat (nat_lit 206)), (_root_.UInt8.ofNat (nat_lit 207))]) ((LexLeanRuntime.subtract (value) (192) : Nat)) (1) else byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 208)), (_root_.UInt8.ofNat (nat_lit 209)), (_root_.UInt8.ofNat (nat_lit 210)), (_root_.UInt8.ofNat (nat_lit 211)), (_root_.UInt8.ofNat (nat_lit 212)), (_root_.UInt8.ofNat (nat_lit 213)), (_root_.UInt8.ofNat (nat_lit 214)), (_root_.UInt8.ofNat (nat_lit 215)), (_root_.UInt8.ofNat (nat_lit 216)), (_root_.UInt8.ofNat (nat_lit 217)), (_root_.UInt8.ofNat (nat_lit 218)), (_root_.UInt8.ofNat (nat_lit 219)), (_root_.UInt8.ofNat (nat_lit 220)), (_root_.UInt8.ofNat (nat_lit 221)), (_root_.UInt8.ofNat (nat_lit 222)), (_root_.UInt8.ofNat (nat_lit 223))]) ((LexLeanRuntime.subtract (value) (208) : Nat)) (1)) else (if (Nat.blt (value) (240)) then byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 224)), (_root_.UInt8.ofNat (nat_lit 225)), (_root_.UInt8.ofNat (nat_lit 226)), (_root_.UInt8.ofNat (nat_lit 227)), (_root_.UInt8.ofNat (nat_lit 228)), (_root_.UInt8.ofNat (nat_lit 229)), (_root_.UInt8.ofNat (nat_lit 230)), (_root_.UInt8.ofNat (nat_lit 231)), (_root_.UInt8.ofNat (nat_lit 232)), (_root_.UInt8.ofNat (nat_lit 233)), (_root_.UInt8.ofNat (nat_lit 234)), (_root_.UInt8.ofNat (nat_lit 235)), (_root_.UInt8.ofNat (nat_lit 236)), (_root_.UInt8.ofNat (nat_lit 237)), (_root_.UInt8.ofNat (nat_lit 238)), (_root_.UInt8.ofNat (nat_lit 239))]) ((LexLeanRuntime.subtract (value) (224) : Nat)) (1) else byteWindow (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 240)), (_root_.UInt8.ofNat (nat_lit 241)), (_root_.UInt8.ofNat (nat_lit 242)), (_root_.UInt8.ofNat (nat_lit 243)), (_root_.UInt8.ofNat (nat_lit 244)), (_root_.UInt8.ofNat (nat_lit 245)), (_root_.UInt8.ofNat (nat_lit 246)), (_root_.UInt8.ofNat (nat_lit 247)), (_root_.UInt8.ofNat (nat_lit 248)), (_root_.UInt8.ofNat (nat_lit 249)), (_root_.UInt8.ofNat (nat_lit 250)), (_root_.UInt8.ofNat (nat_lit 251)), (_root_.UInt8.ofNat (nat_lit 252)), (_root_.UInt8.ofNat (nat_lit 253)), (_root_.UInt8.ofNat (nat_lit 254)), (_root_.UInt8.ofNat (nat_lit 255))]) ((LexLeanRuntime.subtract (value) (240) : Nat)) (1)))))

@[expose] public def decodeOctetSearch : (value : ByteArray) -> (count : Nat) -> Nat
  | _value, Nat.zero => 0
  | value, Nat.succ rest => (if workspaceBytesEqual (value) (encodeOctet (rest)) then rest else decodeOctetSearch (value) (rest))

@[expose] public def decodeOctet (value : ByteArray) : Nat := decodeOctetSearch (value) (256)

@[expose] public def encodeU16 (value : Nat) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (encodeOctet ((LexLeanRuntime.quotient (value) (256) (0) : Nat))) : ByteArray)) (encodeOctet ((LexLeanRuntime.remainder (value) (256) (0) : Nat))) : ByteArray)

@[expose] public def decodeU16 (value : ByteArray) : Nat := ((LexLeanRuntime.multiply (decodeOctet (byteWindow (value) (0) (1))) (256) : Nat) + decodeOctet (byteWindow (value) (1) (1)))

@[expose] public def readU16At (value : ByteArray) (offset : Nat) : Nat := (match (LexLeanRuntime.slice (value) (offset) (2) : Option (ByteArray)) with | Option.none => 0 | Option.some part => decodeU16 (part))

@[expose] public def encodeU24 (value : Nat) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (encodeOctet ((LexLeanRuntime.quotient (value) (65536) (0) : Nat))) : ByteArray)) (encodeU16 ((LexLeanRuntime.remainder (value) (65536) (0) : Nat))) : ByteArray)

@[expose] public def decodeU24 (value : ByteArray) : Nat := ((LexLeanRuntime.multiply (decodeOctet (byteWindow (value) (0) (1))) (65536) : Nat) + readU16At (value) (1))

@[expose] public def readU24At (value : ByteArray) (offset : Nat) : Nat := (match (LexLeanRuntime.slice (value) (offset) (3) : Option (ByteArray)) with | Option.none => 0 | Option.some part => decodeU24 (part))

@[expose] public def digestPresent : (digest : ByteArray) -> (table : ByteArray) -> (width : Nat) -> (count : Nat) -> Bool
  | _digest, _table, _width, Nat.zero => false
  | digest, table, width, Nat.succ rest => (workspaceWindowEqual (table) ((LexLeanRuntime.multiply (rest) (width) : Nat)) (32) (digest) || (digestPresent (digest) (table) (width) (rest) || false))

@[expose] public def workspaceRowUnique (table : ByteArray) (width : Nat) (position : Nat) : Bool := (match (LexLeanRuntime.slice (table) ((LexLeanRuntime.multiply (position) (width) : Nat)) (32) : Option (ByteArray)) with | Option.none => false | Option.some digest => (!digestPresent (digest) (table) (width) (position)))

@[expose] public def digestsUnique : (table : ByteArray) -> (width : Nat) -> (count : Nat) -> Bool
  | _table, _width, Nat.zero => true
  | table, width, Nat.succ rest => (workspaceRowUnique (table) (width) (rest) && (digestsUnique (table) (width) (rest) && true))

@[expose] public def memberRoleCode : (principal : ByteArray) -> (members : ByteArray) -> (count : Nat) -> ByteArray
  | _principal, _members, Nat.zero => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]
  | principal, members, Nat.succ rest => (if workspaceBytesEqual (principal) (byteWindow (members) ((LexLeanRuntime.multiply (rest) (33) : Nat)) (32)) then byteWindow (members) (((LexLeanRuntime.multiply (rest) (33) : Nat) + 32)) (1) else memberRoleCode (principal) (members) (rest))

@[expose] public def workspaceRole (state : WorkspaceState) (principal : ByteArray) : WorkspaceRole := (if workspaceBytesEqual ((state).owner) (principal) then WorkspaceRole.Owner else (if workspaceBytesEqual (memberRoleCode (principal) ((state).members) ((LexLeanRuntime.quotient ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat))) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) then WorkspaceRole.Contributor else (if workspaceBytesEqual (memberRoleCode (principal) ((state).members) ((LexLeanRuntime.quotient ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat))) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))]) then WorkspaceRole.Reader else WorkspaceRole.Absent)))

@[expose] public def membersWellFormed : (owner : ByteArray) -> (members : ByteArray) -> (count : Nat) -> Bool
  | _owner, _members, Nat.zero => true
  | owner, members, Nat.succ rest => ((!workspaceBytesEqual (owner) (byteWindow (members) ((LexLeanRuntime.multiply (rest) (33) : Nat)) (32))) && ((workspaceBytesEqual (byteWindow (members) (((LexLeanRuntime.multiply (rest) (33) : Nat) + 32)) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) || (workspaceBytesEqual (byteWindow (members) (((LexLeanRuntime.multiply (rest) (33) : Nat) + 32)) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))]) || false)) && (membersWellFormed (owner) (members) (rest) && true)))

@[expose] public def removeMember : (principal : ByteArray) -> (members : ByteArray) -> (count : Nat) -> ByteArray
  | _principal, _members, Nat.zero => _root_.ByteArray.mk #[]
  | principal, members, Nat.succ rest => (if workspaceBytesEqual (principal) (byteWindow (members) ((LexLeanRuntime.multiply (rest) (33) : Nat)) (32)) then byteWindow (members) (0) ((LexLeanRuntime.multiply (rest) (33) : Nat)) else (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (removeMember (principal) (members) (rest)) : ByteArray)) (byteWindow (members) ((LexLeanRuntime.multiply (rest) (33) : Nat)) (33)) : ByteArray))

@[expose] public def decodeMessageText (value : ByteArray) : Option (String) := (LexLeanRuntime.utf8Decode (value) : Option (String))

@[expose] public def validMessageText (body : ByteArray) : Bool := ((Nat.blt (0) ((LexLeanRuntime.length (body) : Nat))) && ((Nat.ble ((LexLeanRuntime.length (body) : Nat)) (4096)) && ((match (LexLeanRuntime.utf8Decode ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[]) : ByteArray)) (body) : ByteArray)) : Option (String)) with | Option.none => false | Option.some _ => true) && true)))

@[expose] public def eventPosition : (digest : ByteArray) -> (table : ByteArray) -> (count : Nat) -> Nat
  | _digest, _table, Nat.zero => 0
  | digest, table, Nat.succ rest => (if workspaceWindowEqual (table) ((LexLeanRuntime.multiply (rest) (32) : Nat)) (32) (digest) then (rest + 1) else eventPosition (digest) (table) (rest))

@[expose] public def messagePosition (messages : ByteArray) (seen : ByteArray) (offset : Nat) : Nat := (match (LexLeanRuntime.slice (messages) (offset) (32) : Option (ByteArray)) with | Option.none => 0 | Option.some digest => eventPosition (digest) (seen) ((LexLeanRuntime.quotient ((LexLeanRuntime.length (seen) : Nat)) (32) (0) : Nat)))

@[expose] public def messageBodyWellFormed (messages : ByteArray) (offset : Nat) (count : Nat) : Bool := (match (LexLeanRuntime.slice (messages) (offset) (count) : Option (ByteArray)) with | Option.none => false | Option.some body => validMessageText (body))

@[expose] public def messagesWellFormed : (messages : ByteArray) -> (seen : ByteArray) -> (offset : Nat) -> (count : Nat) -> (previous : Nat) -> Bool
  | messages, _seen, offset, Nat.zero, _previous => (Nat.beq (offset) ((LexLeanRuntime.length (messages) : Nat)))
  | messages, seen, offset, Nat.succ rest, previous => ((Nat.ble ((offset + 66)) ((LexLeanRuntime.length (messages) : Nat))) && ((Nat.blt (previous) (messagePosition (messages) (seen) (offset))) && (messageBodyWellFormed (messages) ((offset + 66)) (readU16At (messages) ((offset + 64))) && (messagesWellFormed (messages) (seen) (((offset + 66) + readU16At (messages) ((offset + 64)))) (rest) (messagePosition (messages) (seen) (offset)) && true))))

@[expose] public def workspaceStateValid (state : WorkspaceState) : Bool := ((Nat.ble ((LexLeanRuntime.quotient ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat)) ((state).sequence)) && ((Nat.ble ((state).messageCount) ((state).sequence)) && (((Nat.beq ((LexLeanRuntime.length ((state).workspace) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((state).owner) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((state).head) : Nat)) (32)) && ((Nat.blt ((state).sequence) (1024)) && ((Nat.beq ((LexLeanRuntime.length ((state).seen) : Nat)) ((LexLeanRuntime.multiply (((state).sequence + 1)) (32) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((state).members) : Nat)) (2079)) && ((Nat.beq ((LexLeanRuntime.remainder ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat)) (0)) && ((Nat.ble ((state).messageCount) (256)) && ((Nat.ble ((LexLeanRuntime.length ((state).messages) : Nat)) (1065472)) && (workspaceWindowEqual ((state).seen) ((LexLeanRuntime.multiply ((state).sequence) (32) : Nat)) (32) ((state).head) && ((!digestPresent ((let __byte0 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 0); _root_.ByteArray.mk #[__byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0])) ((state).seen) (32) (((state).sequence + 1))) && (digestsUnique ((state).seen) (32) (((state).sequence + 1)) && (digestsUnique ((state).members) (33) ((LexLeanRuntime.quotient ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat)) && (membersWellFormed ((state).owner) ((state).members) ((LexLeanRuntime.quotient ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat)) && (messagesWellFormed ((state).messages) ((state).seen) (0) ((state).messageCount) (1) && true))))))))))))))) && true)))

@[expose] public def grantMember (state : WorkspaceState) (event : AuthenticatedEvent) (role : ByteArray) : WorkspaceTransition := (if (!(Nat.beq ((LexLeanRuntime.length ((event).body) : Nat)) (32))) then WorkspaceTransition.Rejected (WorkspaceError.BadIdentity) else (if (!workspaceBytesEqual ((event).author) ((state).owner)) then WorkspaceTransition.Rejected (WorkspaceError.NotOwner) else (if workspaceBytesEqual ((event).body) ((state).owner) then WorkspaceTransition.Rejected (WorkspaceError.OwnerImmutable) else (if digestPresent ((event).body) ((state).members) (33) ((LexLeanRuntime.quotient ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat)) then WorkspaceTransition.Rejected (WorkspaceError.AlreadyMember) else (if (Nat.ble (2079) ((LexLeanRuntime.length ((state).members) : Nat))) then WorkspaceTransition.Rejected (WorkspaceError.MemberLimit) else WorkspaceTransition.Accepted (({ workspace := (state).workspace, owner := (state).owner, head := (event).eventId, sequence := (event).sequence, members := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) ((state).members) : ByteArray)) ((event).body) : ByteArray)) (role) : ByteArray), messages := (state).messages, messageCount := (state).messageCount, seen := (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) ((state).seen) : ByteArray)) ((event).eventId) : ByteArray) } : WorkspaceState)))))))

@[expose] public def applyWorkspaceAction (state : WorkspaceState) (event : AuthenticatedEvent) : WorkspaceTransition := (match (event).action with | WorkspaceAction.Genesis => WorkspaceTransition.Rejected (WorkspaceError.AlreadyInitialized) | WorkspaceAction.GrantContributor => grantMember (state) (event) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) | WorkspaceAction.GrantReader => grantMember (state) (event) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))]) | WorkspaceAction.Revoke => (if (!(Nat.beq ((LexLeanRuntime.length ((event).body) : Nat)) (32))) then WorkspaceTransition.Rejected (WorkspaceError.BadIdentity) else (if (!workspaceBytesEqual ((event).author) ((state).owner)) then WorkspaceTransition.Rejected (WorkspaceError.NotOwner) else (if workspaceBytesEqual ((event).body) ((state).owner) then WorkspaceTransition.Rejected (WorkspaceError.OwnerImmutable) else (if (!digestPresent ((event).body) ((state).members) (33) ((LexLeanRuntime.quotient ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat))) then WorkspaceTransition.Rejected (WorkspaceError.UnknownMember) else WorkspaceTransition.Accepted (({ workspace := (state).workspace, owner := (state).owner, head := (event).eventId, sequence := (event).sequence, members := removeMember ((event).body) ((state).members) ((LexLeanRuntime.quotient ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat)), messages := (state).messages, messageCount := (state).messageCount, seen := (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) ((state).seen) : ByteArray)) ((event).eventId) : ByteArray) } : WorkspaceState)))))) | WorkspaceAction.PostMessage => (if (!(workspaceBytesEqual ((event).author) ((state).owner) || (workspaceBytesEqual (memberRoleCode ((event).author) ((state).members) ((LexLeanRuntime.quotient ((LexLeanRuntime.length ((state).members) : Nat)) (33) (0) : Nat))) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) || false))) then WorkspaceTransition.Rejected (WorkspaceError.CannotPost) else (if ((Nat.beq ((LexLeanRuntime.length ((event).body) : Nat)) (0)) || ((Nat.blt (4096) ((LexLeanRuntime.length ((event).body) : Nat))) || false)) then WorkspaceTransition.Rejected (WorkspaceError.MessageBodyLimit) else (if (!validMessageText ((event).body)) then WorkspaceTransition.Rejected (WorkspaceError.InvalidUtf8) else (if (Nat.ble (256) ((state).messageCount)) then WorkspaceTransition.Rejected (WorkspaceError.MessageLimit) else WorkspaceTransition.Accepted (({ workspace := (state).workspace, owner := (state).owner, head := (event).eventId, sequence := (event).sequence, members := (state).members, messages := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) ((state).messages) : ByteArray)) ((event).eventId) : ByteArray)) ((event).author) : ByteArray)) (encodeU16 ((LexLeanRuntime.length ((event).body) : Nat))) : ByteArray)) ((event).body) : ByteArray), messageCount := ((state).messageCount + 1), seen := (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) ((state).seen) : ByteArray)) ((event).eventId) : ByteArray) } : WorkspaceState)))))))

@[expose] public def reduceExistingWorkspace (state : WorkspaceState) (event : AuthenticatedEvent) : WorkspaceTransition := (if (!workspaceStateValid (state)) then WorkspaceTransition.Rejected (WorkspaceError.BadState) else (if (!workspaceBytesEqual ((state).workspace) ((event).workspace)) then WorkspaceTransition.Rejected (WorkspaceError.WrongWorkspace) else (if digestPresent ((event).eventId) ((state).seen) (32) (((state).sequence + 1)) then WorkspaceTransition.Rejected (WorkspaceError.Replay) else (if (!workspaceBytesEqual ((state).head) ((event).parent)) then WorkspaceTransition.Rejected (WorkspaceError.StaleParent) else (if (!(Nat.beq ((event).sequence) (((state).sequence + 1)))) then WorkspaceTransition.Rejected (WorkspaceError.StaleSequence) else (if (Nat.ble (1023) ((state).sequence)) then WorkspaceTransition.Rejected (WorkspaceError.EventLimit) else applyWorkspaceAction (state) (event)))))))

@[expose] public def createWorkspace (event : AuthenticatedEvent) : WorkspaceTransition := (match (event).action with | WorkspaceAction.Genesis => (if (!workspaceBytesEqual ((event).parent) ((let __byte0 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 0); _root_.ByteArray.mk #[__byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0]))) then WorkspaceTransition.Rejected (WorkspaceError.StaleParent) else (if (!(Nat.beq ((event).sequence) (0))) then WorkspaceTransition.Rejected (WorkspaceError.StaleSequence) else (if (!(Nat.beq ((LexLeanRuntime.length ((event).body) : Nat)) (0))) then WorkspaceTransition.Rejected (WorkspaceError.BadEncoding) else WorkspaceTransition.Accepted (({ workspace := (event).workspace, owner := (event).author, head := (event).eventId, sequence := 0, members := _root_.ByteArray.mk #[], messages := _root_.ByteArray.mk #[], messageCount := 0, seen := (event).eventId } : WorkspaceState))))) | WorkspaceAction.GrantContributor => WorkspaceTransition.Rejected (WorkspaceError.GenesisRequired) | WorkspaceAction.GrantReader => WorkspaceTransition.Rejected (WorkspaceError.GenesisRequired) | WorkspaceAction.Revoke => WorkspaceTransition.Rejected (WorkspaceError.GenesisRequired) | WorkspaceAction.PostMessage => WorkspaceTransition.Rejected (WorkspaceError.GenesisRequired))

@[expose] public def reduceAuthenticatedEvent (state : Option (WorkspaceState)) (event : AuthenticatedEvent) : WorkspaceTransition := (if (!((Nat.beq ((LexLeanRuntime.length ((event).workspace) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((event).eventId) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((event).parent) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((event).author) : Nat)) (32)) && ((!workspaceBytesEqual ((event).eventId) ((let __byte0 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 0); _root_.ByteArray.mk #[__byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0, __byte0]))) && true)))))) then WorkspaceTransition.Rejected (WorkspaceError.BadIdentity) else (if (Nat.blt (4096) ((LexLeanRuntime.length ((event).body) : Nat))) then WorkspaceTransition.Rejected (WorkspaceError.MessageBodyLimit) else (match state with | Option.none => createWorkspace (event) | Option.some existing => reduceExistingWorkspace (existing) (event))))

@[expose] public def encodeWorkspaceState (state : WorkspaceState) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) : ByteArray)) ((state).workspace) : ByteArray)) ((state).owner) : ByteArray)) ((state).head) : ByteArray)) (encodeU16 ((state).sequence)) : ByteArray)) (encodeU16 ((state).messageCount)) : ByteArray)) (encodeU16 ((LexLeanRuntime.length ((state).members) : Nat))) : ByteArray)) (encodeU24 ((LexLeanRuntime.length ((state).messages) : Nat))) : ByteArray)) (encodeU16 ((LexLeanRuntime.length ((state).seen) : Nat))) : ByteArray)) ((state).members) : ByteArray)) ((state).messages) : ByteArray)) ((state).seen) : ByteArray)

@[expose] public def decodeWorkspaceStateFieldsView (view : WorkspaceByteView) (memberSize : Nat) (messageSize : Nat) (seenSize : Nat) : Option (WorkspaceState) := (if ((Nat.ble (memberSize) (2079)) && ((Nat.ble (messageSize) (1065472)) && ((Nat.ble (seenSize) (32768)) && ((Nat.beq ((LexLeanRuntime.length ((view).bytes) : Nat)) ((108 + (memberSize + (messageSize + seenSize))))) && true)))) then Option.some (({ workspace := byteWindowView (view) (1) (32), owner := byteWindowView (view) (33) (32), head := byteWindowView (view) (65) (32), sequence := readU16At ((view).bytes) (97), members := byteWindowView (view) (108) (memberSize), messages := byteWindowView (view) ((108 + memberSize)) (messageSize), messageCount := readU16At ((view).bytes) (99), seen := byteWindowView (view) ((108 + (memberSize + messageSize))) (seenSize) } : WorkspaceState)) else Option.none)

@[expose] public def decodeWorkspaceStateFields (value : ByteArray) (memberSize : Nat) (messageSize : Nat) (seenSize : Nat) : Option (WorkspaceState) := decodeWorkspaceStateFieldsView (({ bytes := value } : WorkspaceByteView)) (memberSize) (messageSize) (seenSize)

@[expose] public def decodeWorkspaceStateView (view : WorkspaceByteView) : Option (WorkspaceState) := (if ((Nat.ble (108) ((LexLeanRuntime.length ((view).bytes) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((view).bytes) : Nat)) (1100427)) && (workspaceBytesEqual (byteWindowView (view) (0) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) && true))) then decodeWorkspaceStateFieldsView (view) (readU16At ((view).bytes) (101)) (readU24At ((view).bytes) (103)) (readU16At ((view).bytes) (106)) else Option.none)

@[expose] public def decodeWorkspaceState (value : ByteArray) : Option (WorkspaceState) := decodeWorkspaceStateView (({ bytes := value } : WorkspaceByteView))

@[expose] public def encodeWorkspaceAction (action : WorkspaceAction) : ByteArray := (match action with | WorkspaceAction.Genesis => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))] | WorkspaceAction.GrantContributor => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | WorkspaceAction.GrantReader => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))] | WorkspaceAction.Revoke => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))] | WorkspaceAction.PostMessage => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))])

@[expose] public def encodeAuthenticatedEvent (event : AuthenticatedEvent) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) : ByteArray)) (encodeWorkspaceAction ((event).action)) : ByteArray)) ((event).workspace) : ByteArray)) ((event).eventId) : ByteArray)) ((event).parent) : ByteArray)) ((event).author) : ByteArray)) (encodeU16 ((event).sequence)) : ByteArray)) (encodeU16 ((LexLeanRuntime.length ((event).body) : Nat))) : ByteArray)) ((event).body) : ByteArray)

@[expose] public def decodeAuthenticatedEvent (value : ByteArray) : Option (AuthenticatedEvent) := (if (((Nat.ble (134) ((LexLeanRuntime.length (value) : Nat))) && ((Nat.ble ((LexLeanRuntime.length (value) : Nat)) (4230)) && (workspaceBytesEqual (byteWindow (value) (0) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) && true))) && ((Nat.beq ((LexLeanRuntime.length (value) : Nat)) ((134 + readU16At (value) (132)))) && true)) then (if workspaceBytesEqual (byteWindow (value) (1) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) then Option.some (({ workspace := byteWindow (value) (2) (32), eventId := byteWindow (value) (34) (32), parent := byteWindow (value) (66) (32), sequence := readU16At (value) (130), author := byteWindow (value) (98) (32), action := WorkspaceAction.Genesis, body := byteWindow (value) (134) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (value) : Nat)) (134) : Nat)) } : AuthenticatedEvent)) else (if workspaceBytesEqual (byteWindow (value) (1) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) then Option.some (({ workspace := byteWindow (value) (2) (32), eventId := byteWindow (value) (34) (32), parent := byteWindow (value) (66) (32), sequence := readU16At (value) (130), author := byteWindow (value) (98) (32), action := WorkspaceAction.GrantContributor, body := byteWindow (value) (134) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (value) : Nat)) (134) : Nat)) } : AuthenticatedEvent)) else (if workspaceBytesEqual (byteWindow (value) (1) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))]) then Option.some (({ workspace := byteWindow (value) (2) (32), eventId := byteWindow (value) (34) (32), parent := byteWindow (value) (66) (32), sequence := readU16At (value) (130), author := byteWindow (value) (98) (32), action := WorkspaceAction.GrantReader, body := byteWindow (value) (134) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (value) : Nat)) (134) : Nat)) } : AuthenticatedEvent)) else (if workspaceBytesEqual (byteWindow (value) (1) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))]) then Option.some (({ workspace := byteWindow (value) (2) (32), eventId := byteWindow (value) (34) (32), parent := byteWindow (value) (66) (32), sequence := readU16At (value) (130), author := byteWindow (value) (98) (32), action := WorkspaceAction.Revoke, body := byteWindow (value) (134) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (value) : Nat)) (134) : Nat)) } : AuthenticatedEvent)) else (if workspaceBytesEqual (byteWindow (value) (1) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))]) then Option.some (({ workspace := byteWindow (value) (2) (32), eventId := byteWindow (value) (34) (32), parent := byteWindow (value) (66) (32), sequence := readU16At (value) (130), author := byteWindow (value) (98) (32), action := WorkspaceAction.PostMessage, body := byteWindow (value) (134) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (value) : Nat)) (134) : Nat)) } : AuthenticatedEvent)) else Option.none))))) else Option.none)

@[expose] public def reduceDecodedState (state : Option (WorkspaceState)) (event : AuthenticatedEvent) : WorkspaceTransition := (match state with | Option.none => WorkspaceTransition.Rejected (WorkspaceError.BadEncoding) | Option.some existing => reduceAuthenticatedEvent (Option.some (existing)) (event))

@[expose] public def reduceWorkspaceBytesEvent (stateBytes : ByteArray) (event : AuthenticatedEvent) : WorkspaceTransition := (if (Nat.beq ((LexLeanRuntime.length (stateBytes) : Nat)) (0)) then reduceAuthenticatedEvent (Option.none) (event) else reduceDecodedState (decodeWorkspaceState (stateBytes)) (event))

@[expose] public def reduceWorkspaceBytesParts (stateBytes : ByteArray) (eventBytes : ByteArray) : WorkspaceTransition := (match decodeAuthenticatedEvent (eventBytes) with | Option.none => WorkspaceTransition.Rejected (WorkspaceError.BadEncoding) | Option.some event => reduceWorkspaceBytesEvent (stateBytes) (event))

@[expose] public def encodeWorkspaceError (error : WorkspaceError) : ByteArray := (match error with | WorkspaceError.BadEncoding => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | WorkspaceError.BadState => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))] | WorkspaceError.BadIdentity => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))] | WorkspaceError.WrongWorkspace => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))] | WorkspaceError.Replay => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 5))] | WorkspaceError.StaleParent => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 6))] | WorkspaceError.StaleSequence => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 7))] | WorkspaceError.NotOwner => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 8))] | WorkspaceError.OwnerImmutable => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 9))] | WorkspaceError.AlreadyMember => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 10))] | WorkspaceError.UnknownMember => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 11))] | WorkspaceError.CannotPost => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 12))] | WorkspaceError.MemberLimit => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 13))] | WorkspaceError.MessageLimit => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 14))] | WorkspaceError.EventLimit => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 15))] | WorkspaceError.MessageBodyLimit => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 16))] | WorkspaceError.InvalidUtf8 => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 17))] | WorkspaceError.GenesisRequired => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 18))] | WorkspaceError.AlreadyInitialized => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 19))])

@[expose] public def encodeWorkspaceTransition (transition : WorkspaceTransition) : ByteArray := (match transition with | WorkspaceTransition.Accepted state => (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) : ByteArray)) (encodeWorkspaceState (state)) : ByteArray) | WorkspaceTransition.Rejected error => encodeWorkspaceError (error))

@[expose] public def reduceWorkspaceBytesView (view : WorkspaceByteView) : ByteArray := (if ((Nat.ble (7) ((LexLeanRuntime.length ((view).bytes) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((view).bytes) : Nat)) (1104664)) && (workspaceBytesEqual (byteWindowView (view) (0) (4)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 82)), (_root_.UInt8.ofNat (nat_lit 1))]) && ((Nat.ble (readU24At ((view).bytes) (4)) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((view).bytes) : Nat)) (7) : Nat))) && true)))) then encodeWorkspaceTransition (reduceWorkspaceBytesParts (byteWindowView (view) (7) (readU24At ((view).bytes) (4))) (byteWindowView (view) ((7 + readU24At ((view).bytes) (4))) ((LexLeanRuntime.subtract ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((view).bytes) : Nat)) (7) : Nat)) (readU24At ((view).bytes) (4)) : Nat)))) else encodeWorkspaceError (WorkspaceError.BadEncoding))

@[expose] public def reduceWorkspaceBytes (request : ByteArray) : ByteArray := reduceWorkspaceBytesView (({ bytes := request } : WorkspaceByteView))

@[expose] public def encodeWorkspaceRequest (stateBytes : ByteArray) (eventBytes : ByteArray) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 82)), (_root_.UInt8.ofNat (nat_lit 1))]) : ByteArray)) (encodeU24 ((LexLeanRuntime.length (stateBytes) : Nat))) : ByteArray)) (stateBytes) : ByteArray)) (eventBytes) : ByteArray)

@[expose] public def encodeUnsignedEvent (event : AuthenticatedEvent) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) : ByteArray)) (encodeWorkspaceAction ((event).action)) : ByteArray)) ((event).workspace) : ByteArray)) ((event).parent) : ByteArray)) ((event).author) : ByteArray)) (encodeU16 ((event).sequence)) : ByteArray)) (encodeU16 ((LexLeanRuntime.length ((event).body) : Nat))) : ByteArray)) ((event).body) : ByteArray)

@[expose] public def workspaceSigningPreimage (event : AuthenticatedEvent) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) ((let __byte114 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 114); _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 112)), __byte114, (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 98)), __byte114, (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 119)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 101)), __byte114, (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 103)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 116)), (_root_.UInt8.ofNat (nat_lit 117)), __byte114, (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 0))])) : ByteArray)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0)), (_root_.UInt8.ofNat (nat_lit 25))]) : ByteArray)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 109)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 119)), (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 107)), (_root_.UInt8.ofNat (nat_lit 115)), (_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 118)), (_root_.UInt8.ofNat (nat_lit 101)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 116)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 49))]) : ByteArray)) (encodeUnsignedEvent (event)) : ByteArray)

end PrismPM.Foundation.Browser.V1.Workspace
