module
public import Init
public import PrismPM.Foundation.Browser.V1.Workspace
public import PrismPM.Foundation.Browser.V1.WorkspaceEnvelope
public import PrismPM.Foundation.Browser.V1.WorkspaceJournal
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
namespace PrismPM.Foundation.Browser.V1.WorkspaceCommand

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

public inductive WorkspaceCommandError where
  | BadEncoding
  | InvalidCommand
  | InvalidHead
  | WorkspaceMismatch
  | EventLimit
  | WrongPhase
  | CorrelationMismatch
  | StaleHead
  | EffectMismatch
  | InvalidResult
  | UnknownOperation
  | InvalidPending

@[expose] public def encodeWorkspaceCommandError (error : WorkspaceCommandError) : ByteArray := (match error with | WorkspaceCommandError.BadEncoding => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | WorkspaceCommandError.InvalidCommand => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))] | WorkspaceCommandError.InvalidHead => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))] | WorkspaceCommandError.WorkspaceMismatch => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))] | WorkspaceCommandError.EventLimit => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 5))] | WorkspaceCommandError.WrongPhase => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 6))] | WorkspaceCommandError.CorrelationMismatch => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 7))] | WorkspaceCommandError.StaleHead => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 8))] | WorkspaceCommandError.EffectMismatch => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 9))] | WorkspaceCommandError.InvalidResult => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 10))] | WorkspaceCommandError.UnknownOperation => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 11))] | WorkspaceCommandError.InvalidPending => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 12))])

@[expose] public def commandBodyValid (action : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (body : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((action).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((action).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))]) with | Bool.false => ((Nat.ble (1) (PrismPM.Foundation.Browser.V1.Workspace.decodeOctet ((action).bytes))) && ((Nat.ble (PrismPM.Foundation.Browser.V1.Workspace.decodeOctet ((action).bytes)) (3)) && (((Nat.beq ((LexLeanRuntime.length ((body).bytes) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((body).bytes) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && true))) | Bool.true => PrismPM.Foundation.Browser.V1.Workspace.validMessageText ((body).bytes)) | Bool.true => (Nat.beq ((LexLeanRuntime.length ((body).bytes) : Nat)) (0)))

@[expose] public def commandFieldsValid (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (0) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (0) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (97) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (97) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && (((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (129) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (129) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindow (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (32) (65)) (0) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))]) && (commandBodyValid (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((164 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161))) (1) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((167 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161))) (PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((165 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)))) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) && true)))))

@[expose] public def commandShapeValid (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := ((Nat.ble (167) ((LexLeanRuntime.length ((request).bytes) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((request).bytes) : Nat)) (69837)) && ((Nat.ble (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)) (65574)) && ((Nat.ble ((167 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161))) ((LexLeanRuntime.length ((request).bytes) : Nat))) && ((Nat.ble (PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((165 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)))) (4096)) && ((Nat.beq ((LexLeanRuntime.length ((request).bytes) : Nat)) (((167 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)) + PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((165 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)))))) && true))))))

@[expose] public def commandHeadError (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match (!PrismPM.Foundation.Browser.V1.WorkspaceJournal.journalHeadValid (({ bytes := (head).bytes } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView))) with | Bool.false => (match ((!(Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0))) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) (4) (32)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (129) (32))) && true)) with | Bool.false => (match (Nat.ble (1024) (PrismPM.Foundation.Browser.V1.WorkspaceJournal.journalCount (({ bytes := (head).bytes } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)))) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((164 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161))) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) with | Bool.false => (match (Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0)) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))] | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.InvalidCommand)) | Bool.true => (match (Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0)) with | Bool.false => encodeWorkspaceCommandError (WorkspaceCommandError.InvalidCommand) | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))])) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.EventLimit)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.WorkspaceMismatch)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.InvalidHead))

@[expose] public def commandValidate (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match (!commandShapeValid (request)) with | Bool.false => (match (!commandFieldsValid (request)) with | Bool.false => commandHeadError (request) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (164) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.InvalidCommand)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.BadEncoding))

@[expose] public def commandAction (action : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceAction := (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((action).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((action).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((action).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))]) with | Bool.false => (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((action).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))]) with | Bool.false => PrismPM.Foundation.Browser.V1.Workspace.WorkspaceAction.PostMessage | Bool.true => PrismPM.Foundation.Browser.V1.Workspace.WorkspaceAction.Revoke) | Bool.true => PrismPM.Foundation.Browser.V1.Workspace.WorkspaceAction.GrantReader) | Bool.true => PrismPM.Foundation.Browser.V1.Workspace.WorkspaceAction.GrantContributor) | Bool.true => PrismPM.Foundation.Browser.V1.Workspace.WorkspaceAction.Genesis)

@[expose] public def commandEvent (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (head : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (eventId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent := ({ workspace := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (129) (32), eventId := (eventId).bytes, parent := (match (Nat.beq ((LexLeanRuntime.length ((head).bytes) : Nat)) (0)) with | Bool.false => PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (head) ((38 + (LexLeanRuntime.multiply ((LexLeanRuntime.subtract (PrismPM.Foundation.Browser.V1.WorkspaceJournal.journalCount (({ bytes := (head).bytes } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView))) (1) : Nat)) (64) : Nat))) (32) | Bool.true => PrismPM.Foundation.Browser.V1.Workspace.zeroDigest), sequence := PrismPM.Foundation.Browser.V1.WorkspaceJournal.journalCount (({ bytes := (head).bytes } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)), author := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (97) (32), action := commandAction (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((164 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161))) (1) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)), body := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((167 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161))) (PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((165 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)))) } : PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent)

@[expose] public def commandPending (phase : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (eventId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 67)), (_root_.UInt8.ofNat (nat_lit 1))]) : ByteArray)) ((phase).bytes) : ByteArray)) ((eventId).bytes) : ByteArray)) ((request).bytes) : ByteArray)

@[expose] public def commandSuccess (pending : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (effect : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) : ByteArray)) (PrismPM.Foundation.Browser.V1.Workspace.encodeU24 ((LexLeanRuntime.length ((pending).bytes) : Nat))) : ByteArray)) ((pending).bytes) : ByteArray)) (PrismPM.Foundation.Browser.V1.Workspace.encodeU16 ((LexLeanRuntime.length ((effect).bytes) : Nat))) : ByteArray)) ((effect).bytes) : ByteArray)

@[expose] public def commandPrepareChecked (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := commandSuccess (({ bytes := commandPending (({ bytes := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))] } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.zeroDigest } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (request) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.workspaceSigningPreimage (commandEvent (request) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (164) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.zeroDigest } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView))) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView))

@[expose] public def commandPrepareValidated (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (validation : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((validation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) with | Bool.false => (validation).bytes | Bool.true => commandPrepareChecked (request))

@[expose] public def prepareWorkspaceCommand (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := commandPrepareValidated (request) (({ bytes := commandValidate (request) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView))

@[expose] public def commandPendingShape (pending : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := ((Nat.ble (204) ((LexLeanRuntime.length ((pending).bytes) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((pending).bytes) : Nat)) (69874)) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (0) (4)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 67)), (_root_.UInt8.ofNat (nat_lit 1))]) && ((Nat.ble (PrismPM.Foundation.Browser.V1.Workspace.decodeOctet (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (4) (1))) (2)) && ((match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (4) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) with | Bool.false => ((Nat.beq ((LexLeanRuntime.length (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (5) (32)) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (5) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)) | Bool.true => PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (5) (32)) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true)))))

@[expose] public def commandPendingValid (pending : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := (commandPendingShape (pending) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (commandValidate (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (37) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((pending).bytes) : Nat)) (37) : Nat)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView))) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) && true))

@[expose] public def commandCompletionShape (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : Bool := ((Nat.ble (107) ((LexLeanRuntime.length ((request).bytes) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((request).bytes) : Nat)) (139872)) && ((Nat.ble (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) (69874)) && ((Nat.ble ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))) ((LexLeanRuntime.length ((request).bytes) : Nat))) && ((Nat.ble (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)))) (65574)) && ((Nat.ble ((99 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)))))) ((LexLeanRuntime.length ((request).bytes) : Nat))) && ((Nat.ble (PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((97 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))))) (4253)) && ((Nat.ble ((2 + ((99 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))) + PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((97 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))))))) ((LexLeanRuntime.length ((request).bytes) : Nat))) && ((Nat.ble (PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) (((99 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))) + PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((97 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))))))) (64)) && ((Nat.beq ((LexLeanRuntime.length ((request).bytes) : Nat)) (((2 + ((99 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))) + PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((97 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)))))))) + PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) (((99 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))) + PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((97 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))))))))) && true))))))))))

@[expose] public def commandEnvelope (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (eventId : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (signature : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match PrismPM.Foundation.Browser.V1.WorkspaceEnvelope.encodeWorkspaceEnvelope (({ publicKey := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (32) (65), signature := (signature).bytes, eventBytes := PrismPM.Foundation.Browser.V1.Workspace.encodeAuthenticatedEvent (commandEvent (request) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (164) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (eventId)) } : PrismPM.Foundation.Browser.V1.WorkspaceEnvelope.WorkspaceEnvelope)) with | Option.none => encodeWorkspaceCommandError (WorkspaceCommandError.InvalidResult) | Option.some envelope => envelope)

@[expose] public def commandCompleteEffect (operation : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (pending : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (actualInput : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (actualResult : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) with | Bool.false => (match (!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((actualInput).bytes) (PrismPM.Foundation.Browser.V1.Workspace.encodeUnsignedEvent (commandEvent (request) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (164) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (5) (32) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView))))) with | Bool.false => (match (!(Nat.beq ((LexLeanRuntime.length ((actualResult).bytes) : Nat)) (64))) with | Bool.false => commandSuccess (({ bytes := commandPending (({ bytes := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))] } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (5) (32) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (request) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := commandEnvelope (request) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (5) (32) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (actualResult) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.InvalidResult)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.EffectMismatch)) | Bool.true => (match (!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((actualInput).bytes) (PrismPM.Foundation.Browser.V1.Workspace.workspaceSigningPreimage (commandEvent (request) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (164) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.zeroDigest } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView))))) with | Bool.false => (match (!((Nat.beq ((LexLeanRuntime.length ((actualResult).bytes) : Nat)) (32)) && ((!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((actualResult).bytes) (PrismPM.Foundation.Browser.V1.Workspace.zeroDigest)) && true))) with | Bool.false => commandSuccess (({ bytes := commandPending (({ bytes := _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (actualResult) (request) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.encodeUnsignedEvent (commandEvent (request) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (164) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (161)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (actualResult)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.InvalidResult)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.EffectMismatch)))

@[expose] public def commandCompleteBound (operation : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (pending : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match (!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (4) (1)) ((match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) with | Bool.false => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Bool.true => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]))) with | Bool.false => (match (!PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))) (PrismPM.Foundation.Browser.V1.Workspace.byteWindow (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (37) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((pending).bytes) : Nat)) (37) : Nat))) (164) (PrismPM.Foundation.Browser.V1.Workspace.readU24At (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (37) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((pending).bytes) : Nat)) (37) : Nat))) (161)))) with | Bool.false => (match (!(PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))) (32)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindow (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (37) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((pending).bytes) : Nat)) (37) : Nat))) (0) (32)) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((32 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)))))) (65)) (PrismPM.Foundation.Browser.V1.Workspace.byteWindow (PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (37) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((pending).bytes) : Nat)) (37) : Nat))) (32) (65)) && true))) with | Bool.false => commandCompleteEffect (operation) (pending) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (pending) (37) ((LexLeanRuntime.subtract ((LexLeanRuntime.length ((pending).bytes) : Nat)) (37) : Nat)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((99 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)))))) (PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((97 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))))) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) ((2 + ((99 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))) + PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((97 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))))))) (PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) (((99 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))) + PrismPM.Foundation.Browser.V1.Workspace.readU16At ((request).bytes) ((97 + ((6 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) ((3 + PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0))))))))) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.CorrelationMismatch)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.StaleHead)) | Bool.true => encodeWorkspaceCommandError (WorkspaceCommandError.WrongPhase))

@[expose] public def commandCompletePending (operation : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (pending : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match commandPendingValid (pending) with | Bool.false => encodeWorkspaceCommandError (WorkspaceCommandError.InvalidPending) | Bool.true => commandCompleteBound (operation) (pending) (request))

@[expose] public def completeWorkspaceCommand (operation : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match commandCompletionShape (request) with | Bool.false => encodeWorkspaceCommandError (WorkspaceCommandError.BadEncoding) | Bool.true => commandCompletePending (operation) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindowView (request) (3) (PrismPM.Foundation.Browser.V1.Workspace.readU24At ((request).bytes) (0)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (request))

@[expose] public def workspaceCommandOperation (operation : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) (request : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView) : ByteArray := (match PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual ((operation).bytes) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) with | Bool.false => (match ((Nat.ble (1) (PrismPM.Foundation.Browser.V1.Workspace.decodeOctet ((operation).bytes))) && ((Nat.ble (PrismPM.Foundation.Browser.V1.Workspace.decodeOctet ((operation).bytes)) (2)) && true)) with | Bool.false => encodeWorkspaceCommandError (WorkspaceCommandError.UnknownOperation) | Bool.true => completeWorkspaceCommand (operation) (request)) | Bool.true => prepareWorkspaceCommand (request))

@[expose] public def workspaceCommandBytes (request : ByteArray) : ByteArray := (match ((Nat.ble (1) ((LexLeanRuntime.length (request) : Nat))) && ((Nat.ble ((LexLeanRuntime.length (request) : Nat)) (139873)) && true)) with | Bool.false => encodeWorkspaceCommandError (WorkspaceCommandError.BadEncoding) | Bool.true => workspaceCommandOperation (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindow (request) (0) (1) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)) (({ bytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindow (request) (1) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (request) : Nat)) (1) : Nat)) } : PrismPM.Foundation.Browser.V1.Workspace.WorkspaceByteView)))

end PrismPM.Foundation.Browser.V1.WorkspaceCommand
