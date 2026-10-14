module
public import Init
public import PrismPM.Foundation.Browser.V1.Workspace
public import PrismPM.Foundation.Browser.V1.WorkspaceEnvelope
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
namespace PrismPM.Foundation.Browser.V1.WorkspaceJournal

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

@[expose] public def journalCount (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Nat := (match (Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0)) with | Bool.false => PrismPM.Foundation.Browser.V1.Workspace.readU16At ((head).bytes) (36) | Bool.true => 0)

@[expose] public def journalDigestValid (value : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := ((Nat.beq ((LexLeanRuntime.length ((value).bytes) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((value).bytes) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true))

@[expose] public def journalOctetCandidateEqual (left : UInt8) (right : Option (UInt8)) : Bool := (match right with | Option.none => false | Option.some rightValue => (LexLeanRuntime.equal (left) (rightValue) : Bool))

@[expose] public def journalOctetsEqual (left : Option (UInt8)) (right : Option (UInt8)) : Bool := (match left with | Option.none => false | Option.some leftValue => journalOctetCandidateEqual (leftValue) (right))

@[expose] public def journalRowBytesEqual : (view : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) -> (left : Nat) -> (right : Nat) -> (remaining : Nat) -> Bool
  | _view, _left, _right, Nat.zero => true
  | view, left, right, Nat.succ rest => (journalOctetsEqual ((LexLeanRuntime.index ((view).bytes) ((left + rest)) : Option (UInt8))) ((LexLeanRuntime.index ((view).bytes) ((right + rest)) : Option (UInt8))) && (journalRowBytesEqual (view) (left) (right) (rest) && true))

@[expose] public def journalPriorRowBlock : (view : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) -> (position : Nat) -> (offset : Nat) -> (start : Nat) -> (remaining : Nat) -> Bool
  | _view, _position, _offset, _start, Nat.zero => true
  | view, position, offset, start, Nat.succ rest => ((match (Nat.ble (position) ((start + rest))) with | Bool.false => (!journalRowBytesEqual (view) (((LexLeanRuntime.multiply (position) (64) : Nat) + offset)) (((LexLeanRuntime.multiply ((start + rest)) (64) : Nat) + offset)) (32)) | Bool.true => true) && (journalPriorRowBlock (view) (position) (offset) (start) (rest) && true))

@[expose] public def journalPriorRowBlocks : (view : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) -> (position : Nat) -> (offset : Nat) -> (groups : Nat) -> Bool
  | _view, _position, _offset, Nat.zero => true
  | view, position, offset, Nat.succ rest => ((match (Nat.ble (position) ((LexLeanRuntime.multiply (rest) (32) : Nat))) with | Bool.false => journalPriorRowBlock (view) (position) (offset) ((LexLeanRuntime.multiply (rest) (32) : Nat)) (32) | Bool.true => true) && (journalPriorRowBlocks (view) (position) (offset) (rest) && true))

@[expose] public def journalPriorDigestAbsent : (view : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) -> (digest : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) -> (offset : Nat) -> (count : Nat) -> Bool
  | _view, _digest, _offset, Nat.zero => true
  | view, digest, offset, Nat.succ rest => ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (view) (((LexLeanRuntime.multiply (rest) (64) : Nat) + offset)) (32)) ((digest).bytes)) && (journalPriorDigestAbsent (view) (digest) (offset) (rest) && true))

@[expose] public def journalRowValid (view : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (position : Nat) : Bool := (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (view) ((LexLeanRuntime.multiply (position) (64) : Nat)) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (view) ((LexLeanRuntime.multiply (position) (64) : Nat)) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (view) (((LexLeanRuntime.multiply (position) (64) : Nat) + 32)) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (view) (((LexLeanRuntime.multiply (position) (64) : Nat) + 32)) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && (journalPriorRowBlocks (view) (position) (0) (32) && (journalPriorRowBlocks (view) (position) (32) (32) && true))))

@[expose] public def journalRowsBlock : (view : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) -> (count : Nat) -> (start : Nat) -> (remaining : Nat) -> Bool
  | _view, _count, _start, Nat.zero => true
  | view, count, start, Nat.succ rest => ((match (Nat.ble (count) ((start + rest))) with | Bool.false => journalRowValid (view) ((start + rest)) | Bool.true => true) && (journalRowsBlock (view) (count) (start) (rest) && true))

@[expose] public def journalRowsBlocks : (view : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) -> (count : Nat) -> (groups : Nat) -> Bool
  | _view, _count, Nat.zero => true
  | view, count, Nat.succ rest => ((match (Nat.ble (count) ((LexLeanRuntime.multiply (rest) (32) : Nat))) with | Bool.false => journalRowsBlock (view) (count) ((LexLeanRuntime.multiply (rest) (32) : Nat)) (32) | Bool.true => true) && (journalRowsBlocks (view) (count) (rest) && true))

@[expose] public def journalRowsValid (view : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (count : Nat) : Bool := ((Nat.ble (count) (1024)) && (journalRowsBlocks (view) (count) (32) && true))

@[expose] public def journalHeadValid (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := (match (Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0)) with | Bool.false => ((Nat.ble (102) ((LexLeanRuntime.length ((head).bytes) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((head).bytes) : Nat)) (65574)) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (0) (4)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 74)), (_root_.UInt8.ofNat (nat_lit 1))]) && (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (4) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (4) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && ((Nat.ble (1) (journalCount (head))) && ((Nat.ble (journalCount (head)) (1024)) && ((Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) ((38 + (LexLeanRuntime.multiply (journalCount (head)) (64) : Nat)))) && (journalRowsValid (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (38) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((head).bytes) : Nat)) (38) : Nat)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (journalCount (head)) && true)))))))) | Bool.true => true)

@[expose] public def journalSeenMatches : (rows : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) -> (seen : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) -> (count : Nat) -> Bool
  | _rows, _seen, Nat.zero => true
  | rows, seen, Nat.succ rest => (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (rows) ((LexLeanRuntime.multiply (rest) (64) : Nat)) (32)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (seen) ((LexLeanRuntime.multiply (rest) (32) : Nat)) (32)) && (journalSeenMatches (rows) (seen) (rest) && true))

@[expose] public def journalStateMatchesDecoded (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceState) : Bool := (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (4) (32)) ((state).workspace) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) ((38 + (LexLeanRuntime.multiply ((LexLeanRuntime.subtract (journalCount (head)) (1) : Nat)) (64) : Nat))) (32)) ((state).head) && ((Nat.beq (((state).sequence + 1)) (journalCount (head))) && ((Nat.beq ((LexLeanRuntime.length ((state).seen) : Nat)) ((LexLeanRuntime.multiply (journalCount (head)) (32) : Nat))) && (journalSeenMatches (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (38) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((head).bytes) : Nat)) (38) : Nat)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := (state).seen } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (journalCount (head)) && true)))))

@[expose] public def journalStateMatches (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := (match (Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0)) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.decodeWorkspaceState ((state).bytes) with | Option.none => false | Option.some decoded => journalStateMatchesDecoded (head) (decoded)) | Bool.true => (Nat.beq ((LexLeanRuntime.length ((state).bytes) : Nat)) (0)))

@[expose] public def journalNextHead (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (event : PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 74)), (_root_.UInt8.ofNat (nat_lit 1))]) : ByteArray)) ((event).workspace) : ByteArray)) (PrismPM.Foundation.Browser.V1.Workspace.encodeU16 ((journalCount (head) + 1))) : ByteArray)) ((match (Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0)) with | Bool.false => PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (38) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((head).bytes) : Nat)) (38) : Nat)) | Bool.true => _root_.ByteArray.mk #[])) : ByteArray)) ((event).eventId) : ByteArray)) ((objectId).bytes) : ByteArray)

@[expose] public def journalPlanBytes (nextHead : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (nextState : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) : ByteArray)) (PrismPM.Foundation.Browser.V1.Workspace.encodeU24 ((LexLeanRuntime.length ((nextHead).bytes) : Nat))) : ByteArray)) (PrismPM.Foundation.Browser.V1.Workspace.encodeU24 ((LexLeanRuntime.length ((nextState).bytes) : Nat))) : ByteArray)) ((nextHead).bytes) : ByteArray)) ((nextState).bytes) : ByteArray)

@[expose] public def journalAcceptedPlan (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (event : PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (nextState : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceState) : ByteArray := journalPlanBytes (({ bytes := journalNextHead (head) (event) (objectId) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.encodeWorkspaceState (nextState) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView))

@[expose] public def journalReduce (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : Option (PrismPM.Foundation.Browser.V1.Workspace.WorkspaceState)) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (event : PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent) : ByteArray := (match PrismPM.Foundation.Browser.V1.Workspace.reduceAuthenticatedEvent (state) (event) with | PrismPM.Foundation.Browser.V1.Workspace.WorkspaceTransition.Rejected error => (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 16))]) : ByteArray)) (PrismPM.Foundation.Browser.V1.Workspace.encodeWorkspaceError (error)) : ByteArray) | PrismPM.Foundation.Browser.V1.Workspace.WorkspaceTransition.Accepted nextState => journalAcceptedPlan (head) (event) (objectId) (nextState))

@[expose] public def journalAppendChecked (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : Option (PrismPM.Foundation.Browser.V1.Workspace.WorkspaceState)) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (event : PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent) : ByteArray := (match (!((Nat.beq ((LexLeanRuntime.length ((event).workspace) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((event).workspace) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true))) with | Bool.false => (match (!((Nat.beq ((LexLeanRuntime.length ((objectId).bytes) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((objectId).bytes) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true))) with | Bool.false => (match (Nat.ble (1024) (journalCount (head))) with | Bool.false => (match (!journalPriorDigestAbsent (({ bytes := (match (Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0)) with | Bool.false => PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (38) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((head).bytes) : Nat)) (38) : Nat)) | Bool.true => _root_.ByteArray.mk #[]) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (objectId) (32) (journalCount (head))) with | Bool.false => journalReduce (head) (state) (objectId) (event) | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 5))]) | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 6))]) | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))]) | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))])

@[expose] public def journalAppendExisting (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceState) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (event : PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent) : ByteArray := (match journalStateMatchesDecoded (head) (state) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))] | Bool.true => journalAppendChecked (head) (Option.some (state)) (objectId) (event))

@[expose] public def journalAppendEvent (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (event : PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent) : ByteArray := (match (!journalHeadValid (head)) with | Bool.false => (match (Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0)) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.decodeWorkspaceState ((state).bytes) with | Option.none => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))] | Option.some existing => journalAppendExisting (head) (existing) (objectId) (event)) | Bool.true => (match (Nat.beq ((LexLeanRuntime.length ((state).bytes) : Nat)) (0)) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))] | Bool.true => journalAppendChecked (head) (Option.none) (objectId) (event))) | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))])

@[expose] public def journalAppendCandidate (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (candidate : PrismPM.Foundation.Browser.V1.WorkspaceEnvelope.WorkspaceEnvelope) : ByteArray := (match PrismPM.Foundation.Browser.V1.Workspace.decodeAuthenticatedEvent ((candidate).eventBytes) with | Option.none => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Option.some event => journalAppendEvent (head) (state) (objectId) (event))

@[expose] public def prepareJournalAppend (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (envelope : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match PrismPM.Foundation.Browser.V1.WorkspaceEnvelope.decodeWorkspaceEnvelope ((envelope).bytes) with | Option.none => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Option.some candidate => journalAppendCandidate (head) (state) (objectId) (candidate))

@[expose] public def journalAppendFields (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (headLength : Nat) (stateLength : Nat) : ByteArray := (match ((Nat.ble (headLength) (65574)) && ((Nat.ble (stateLength) (1100427)) && ((Nat.ble (((305 + headLength) + stateLength)) ((LexLeanRuntime.length ((request).bytes) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((request).bytes) : Nat)) (((4401 + headLength) + stateLength))) && true)))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => prepareJournalAppend (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (6) (headLength) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((6 + headLength)) (stateLength) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (((6 + headLength) + stateLength)) (32) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (((38 + headLength) + stateLength)) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((request).bytes) : Nat)) (((38 + headLength) + stateLength)) : Nat)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)))

@[expose] public def journalAppendBytes (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match (Nat.ble (6) ((LexLeanRuntime.length ((request).bytes) : Nat))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => journalAppendFields (request) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (3)))

@[expose] public def journalReplayBound (target : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (envelope : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (event : PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent) : ByteArray := (match (journalHeadValid (target) && ((!(Nat.beq ((LexLeanRuntime.length ((target).bytes) : Nat)) (0))) && (journalHeadValid (head) && ((Nat.ble ((journalCount (head) + 1)) (journalCount (target))) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (38) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((head).bytes) : Nat)) (38) : Nat))) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (target) (38) ((LexLeanRuntime.multiply (journalCount (head)) (64) : Nat))) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((event).workspace) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (target) (4) (32)) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((event).eventId) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (target) ((38 + (LexLeanRuntime.multiply (journalCount (head)) (64) : Nat))) (32)) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((objectId).bytes) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (target) ((70 + (LexLeanRuntime.multiply (journalCount (head)) (64) : Nat))) (32)) && true)))))))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 7))] | Bool.true => prepareJournalAppend (head) (state) (objectId) (envelope))

@[expose] public def journalReplayCandidate (target : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (envelope : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (candidate : PrismPM.Foundation.Browser.V1.WorkspaceEnvelope.WorkspaceEnvelope) : ByteArray := (match PrismPM.Foundation.Browser.V1.Workspace.decodeAuthenticatedEvent ((candidate).eventBytes) with | Option.none => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Option.some event => journalReplayBound (target) (head) (state) (objectId) (envelope) (event))

@[expose] public def replayJournalEntry (target : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (objectId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (envelope : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match PrismPM.Foundation.Browser.V1.WorkspaceEnvelope.decodeWorkspaceEnvelope ((envelope).bytes) with | Option.none => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Option.some candidate => journalReplayCandidate (target) (head) (state) (objectId) (envelope) (candidate))

@[expose] public def journalReplayFields (target : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (headLength : Nat) (stateLength : Nat) : ByteArray := (match ((Nat.ble (headLength) (65574)) && ((Nat.ble (stateLength) (1100427)) && ((Nat.ble (((305 + headLength) + stateLength)) ((LexLeanRuntime.length ((request).bytes) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((request).bytes) : Nat)) (((4401 + headLength) + stateLength))) && true)))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => replayJournalEntry (target) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (6) (headLength) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((6 + headLength)) (stateLength) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (((6 + headLength) + stateLength)) (32) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (((38 + headLength) + stateLength)) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((request).bytes) : Nat)) (((38 + headLength) + stateLength)) : Nat)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)))

@[expose] public def journalReplayPayload (target : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match (Nat.ble (6) ((LexLeanRuntime.length ((request).bytes) : Nat))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => journalReplayFields (target) (request) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (3)))

@[expose] public def journalReplayBytes (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (targetLength : Nat) : ByteArray := (match ((Nat.ble (targetLength) (65574)) && ((Nat.ble ((3 + targetLength)) ((LexLeanRuntime.length ((request).bytes) : Nat))) && true)) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => journalReplayPayload (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (3) (targetLength) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((3 + targetLength)) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((request).bytes) : Nat)) ((3 + targetLength)) : Nat)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)))

@[expose] public def finishJournalReplay (target : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (state : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match (journalHeadValid (target) && ((!(Nat.beq ((LexLeanRuntime.length ((target).bytes) : Nat)) (0))) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((target).bytes) ((head).bytes) && (journalStateMatches (head) (state) && true)))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 8))] | Bool.true => (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) : ByteArray)) ((state).bytes) : ByteArray))

@[expose] public def journalReplayCompleteFields (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (targetLength : Nat) (headLength : Nat) (stateLength : Nat) : ByteArray := (match ((Nat.ble (targetLength) (65574)) && ((Nat.ble (headLength) (65574)) && ((Nat.ble (stateLength) (1100427)) && ((Nat.beq ((LexLeanRuntime.length ((request).bytes) : Nat)) ((((9 + targetLength) + headLength) + stateLength))) && true)))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => finishJournalReplay (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (9) (targetLength) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((9 + targetLength)) (headLength) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (((9 + targetLength) + headLength)) (stateLength) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)))

@[expose] public def journalCommitBound (session : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (receipt : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := ((Nat.beq ((LexLeanRuntime.length ((session).bytes) : Nat)) (129)) && ((Nat.beq ((LexLeanRuntime.length ((receipt).bytes) : Nat)) (161)) && (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (1) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (1) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (65) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (65) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (97) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (97) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (1) (128)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (receipt) (1) (128)) && true))))))

@[expose] public def journalCommitResult (session : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (receipt : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (status : Nat) : ByteArray := (match (Nat.beq (status) (0)) with | Bool.false => (match ((Nat.ble (1) (status)) && ((Nat.ble (status) (5)) && ((match (Nat.beq (status) (1)) with | Bool.false => PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (receipt) (129) (32)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (33) (32)) | Bool.true => (!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (receipt) (129) (32)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (33) (32)))) && true))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 9))] | Bool.true => (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (PrismPM.Foundation.Browser.V1.Workspace.encodeOctet ((32 + status))) : ByteArray)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))]) : ByteArray)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (1) (128)) : ByteArray)) | Bool.true => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (receipt) (129) (32)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (65) (32)) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 9))] | Bool.true => (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0)), (_root_.UInt8.ofNat (nat_lit 1))]) : ByteArray)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (1) (128)) : ByteArray)))

@[expose] public def finishJournalCommit (session : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (receipt : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match (!journalCommitBound (session) (receipt)) with | Bool.false => (match (!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (session) (0) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))])) with | Bool.false => journalCommitResult (session) (receipt) (PrismPM.Foundation.Browser.V1.Workspace.decodeOctet (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (receipt) (0) (1))) | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 10))]) | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 9))])

@[expose] public def workspaceJournalOperation (operation : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (payload : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 5))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 6))]) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 11))] | Bool.true => PrismPM.Foundation.Browser.V1.WorkspaceEnvelope.workspaceEnvelopeBytes ((payload).bytes)) | Bool.true => (match ((Nat.beq ((LexLeanRuntime.length ((payload).bytes) : Nat)) (96)) && (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (payload) (32) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (payload) (32) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (payload) (64) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (payload) (64) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && true))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 9))] | Bool.true => (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) : ByteArray)) ((let __byte109 : _root_.UInt8 := _root_.UInt8.ofNat (nat_lit 109); _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 112)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 115)), __byte109, (_root_.UInt8.ofNat (nat_lit 112)), __byte109, (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 106)), (_root_.UInt8.ofNat (nat_lit 111)), (_root_.UInt8.ofNat (nat_lit 117)), (_root_.UInt8.ofNat (nat_lit 114)), (_root_.UInt8.ofNat (nat_lit 110)), (_root_.UInt8.ofNat (nat_lit 97)), (_root_.UInt8.ofNat (nat_lit 108)), (_root_.UInt8.ofNat (nat_lit 45)), (_root_.UInt8.ofNat (nat_lit 99)), (_root_.UInt8.ofNat (nat_lit 111)), __byte109, __byte109, (_root_.UInt8.ofNat (nat_lit 105)), (_root_.UInt8.ofNat (nat_lit 116)), (_root_.UInt8.ofNat (nat_lit 47)), (_root_.UInt8.ofNat (nat_lit 49)), (_root_.UInt8.ofNat (nat_lit 0))])) : ByteArray)) ((payload).bytes) : ByteArray))) | Bool.true => (match (Nat.ble (9) ((LexLeanRuntime.length ((payload).bytes) : Nat))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => journalReplayCompleteFields (payload) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((payload).bytes) (0)) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((payload).bytes) (3)) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((payload).bytes) (6)))) | Bool.true => (match (Nat.ble (3) ((LexLeanRuntime.length ((payload).bytes) : Nat))) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => journalReplayBytes (payload) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((payload).bytes) (0)))) | Bool.true => (match (Nat.beq ((LexLeanRuntime.length ((payload).bytes) : Nat)) (290)) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => finishJournalCommit (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (payload) (0) (129) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (payload) (129) (161) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)))) | Bool.true => journalAppendBytes (payload)) | Bool.true => (match journalHeadValid (payload) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))] | Bool.true => (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) : ByteArray)) ((payload).bytes) : ByteArray)))

@[expose] public def workspaceJournalBytes (request : ByteArray) : ByteArray := (match ((Nat.ble (1) ((LexLeanRuntime.length (request) : Nat))) && ((Nat.ble ((LexLeanRuntime.length (request) : Nat)) (1235980)) && true)) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => workspaceJournalOperation (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindow (request) (0) (1) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindow (request) (1) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (request) : Nat)) (1) : Nat)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)))

end PrismPM.Foundation.Browser.V1.WorkspaceJournal
