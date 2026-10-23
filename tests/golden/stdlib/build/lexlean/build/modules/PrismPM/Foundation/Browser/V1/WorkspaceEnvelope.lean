module
public import Init
public import LexLeanRuntime.Portable
public import PrismPM.Foundation.Browser.V1.Workspace
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Foundation.Browser.V1.WorkspaceEnvelope

public structure WorkspaceEnvelope where
  publicKey : ByteArray
  signature : ByteArray
  eventBytes : ByteArray

@[expose] public def workspaceEventEncodingPresent (event : Option (PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent)) : Bool := (match event with | Option.none => false | Option.some _ => true)

@[expose] public def workspaceEnvelopeFieldsValid (candidate : WorkspaceEnvelope) : Bool := ((Nat.beq ((LexLeanRuntime.length ((candidate).publicKey) : Nat)) (65)) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindow ((candidate).publicKey) (0) (1)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))]) && ((Nat.beq ((LexLeanRuntime.length ((candidate).signature) : Nat)) (64)) && (workspaceEventEncodingPresent (PrismPM.Foundation.Browser.V1.Workspace.decodeAuthenticatedEvent ((candidate).eventBytes)) && true))))

@[expose] public def encodeWorkspaceEnvelope (candidate : WorkspaceEnvelope) : Option (ByteArray) := (if workspaceEnvelopeFieldsValid (candidate) then Option.some ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 69)), (_root_.UInt8.ofNat (nat_lit 1))]) : ByteArray)) ((candidate).publicKey) : ByteArray)) ((candidate).signature) : ByteArray)) ((candidate).eventBytes) : ByteArray)) else Option.none)

@[expose] public def workspaceEnvelopeCandidate (value : ByteArray) : WorkspaceEnvelope := ({ publicKey := PrismPM.Foundation.Browser.V1.Workspace.byteWindow (value) (4) (65), signature := PrismPM.Foundation.Browser.V1.Workspace.byteWindow (value) (69) (64), eventBytes := PrismPM.Foundation.Browser.V1.Workspace.byteWindow (value) (133) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (value) : Nat)) (133) : Nat)) } : WorkspaceEnvelope)

@[expose] public def workspaceEnvelopeCheckedCandidate (candidate : WorkspaceEnvelope) : Option (WorkspaceEnvelope) := (if workspaceEnvelopeFieldsValid (candidate) then Option.some (candidate) else Option.none)

@[expose] public def decodeWorkspaceEnvelope (value : ByteArray) : Option (WorkspaceEnvelope) := (if ((Nat.ble (267) ((LexLeanRuntime.length (value) : Nat))) && ((Nat.ble ((LexLeanRuntime.length (value) : Nat)) (4363)) && (PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (PrismPM.Foundation.Browser.V1.Workspace.byteWindow (value) (0) (4)) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 80)), (_root_.UInt8.ofNat (nat_lit 87)), (_root_.UInt8.ofNat (nat_lit 69)), (_root_.UInt8.ofNat (nat_lit 1))]) && true))) then workspaceEnvelopeCheckedCandidate (workspaceEnvelopeCandidate (value)) else Option.none)

@[expose] public def workspaceEnvelopeUnsignedEventFromEvent (event : Option (PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent)) : Option (ByteArray) := (match event with | Option.none => Option.none | Option.some candidate => Option.some (PrismPM.Foundation.Browser.V1.Workspace.encodeUnsignedEvent (candidate)))

@[expose] public def workspaceEnvelopeUnsignedEvent (candidate : WorkspaceEnvelope) : Option (ByteArray) := (if workspaceEnvelopeFieldsValid (candidate) then workspaceEnvelopeUnsignedEventFromEvent (PrismPM.Foundation.Browser.V1.Workspace.decodeAuthenticatedEvent ((candidate).eventBytes)) else Option.none)

@[expose] public def workspaceEnvelopeSigningPreimageFromEvent (event : Option (PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent)) : Option (ByteArray) := (match event with | Option.none => Option.none | Option.some candidate => Option.some (PrismPM.Foundation.Browser.V1.Workspace.workspaceSigningPreimage (candidate)))

@[expose] public def workspaceEnvelopeSigningPreimage (candidate : WorkspaceEnvelope) : Option (ByteArray) := (if workspaceEnvelopeFieldsValid (candidate) then workspaceEnvelopeSigningPreimageFromEvent (PrismPM.Foundation.Browser.V1.Workspace.decodeAuthenticatedEvent ((candidate).eventBytes)) else Option.none)

@[expose] public def workspaceEnvelopeAuthorFromEvent (event : Option (PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent)) : Option (ByteArray) := (match event with | Option.none => Option.none | Option.some candidate => Option.some ((candidate).author))

@[expose] public def workspaceEnvelopeAuthor (candidate : WorkspaceEnvelope) : Option (ByteArray) := (if workspaceEnvelopeFieldsValid (candidate) then workspaceEnvelopeAuthorFromEvent (PrismPM.Foundation.Browser.V1.Workspace.decodeAuthenticatedEvent ((candidate).eventBytes)) else Option.none)

@[expose] public def workspaceEnvelopeEventIdFromEvent (event : Option (PrismPM.Foundation.Browser.V1.Workspace.AuthenticatedEvent)) : Option (ByteArray) := (match event with | Option.none => Option.none | Option.some candidate => Option.some ((candidate).eventId))

@[expose] public def workspaceEnvelopeEventId (candidate : WorkspaceEnvelope) : Option (ByteArray) := (if workspaceEnvelopeFieldsValid (candidate) then workspaceEnvelopeEventIdFromEvent (PrismPM.Foundation.Browser.V1.Workspace.decodeAuthenticatedEvent ((candidate).eventBytes)) else Option.none)

@[expose] public def workspaceEnvelopeResponse (value : Option (ByteArray)) : ByteArray := (match value with | Option.none => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Option.some part => (LexLeanRuntime.append ((LexLeanRuntime.append (_root_.ByteArray.mk #[]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) : ByteArray)) (part) : ByteArray))

@[expose] public def workspaceEnvelopeOperation (operation : ByteArray) (candidate : WorkspaceEnvelope) : ByteArray := (if PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (operation) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) then workspaceEnvelopeResponse (encodeWorkspaceEnvelope (candidate)) else (if PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (operation) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) then workspaceEnvelopeResponse (workspaceEnvelopeUnsignedEvent (candidate)) else (if PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (operation) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))]) then workspaceEnvelopeResponse (workspaceEnvelopeSigningPreimage (candidate)) else (if PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (operation) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 3))]) then workspaceEnvelopeResponse (Option.some ((candidate).publicKey)) else (if PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (operation) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 4))]) then workspaceEnvelopeResponse (Option.some ((candidate).signature)) else (if PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (operation) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 5))]) then workspaceEnvelopeResponse (Option.some ((candidate).eventBytes)) else (if PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (operation) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 6))]) then workspaceEnvelopeResponse (workspaceEnvelopeAuthor (candidate)) else (if PrismPM.Foundation.Browser.V1.Workspace.workspaceBytesEqual (operation) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 7))]) then workspaceEnvelopeResponse (workspaceEnvelopeEventId (candidate)) else _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 2))]))))))))

@[expose] public def workspaceEnvelopeDecodedOperation (operation : ByteArray) (candidate : Option (WorkspaceEnvelope)) : ByteArray := (match candidate with | Option.none => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))] | Option.some value => workspaceEnvelopeOperation (operation) (value))

@[expose] public def workspaceEnvelopeBytes (request : ByteArray) : ByteArray := (if ((Nat.ble (1) ((LexLeanRuntime.length (request) : Nat))) && ((Nat.ble ((LexLeanRuntime.length (request) : Nat)) (4364)) && true)) then workspaceEnvelopeDecodedOperation (PrismPM.Foundation.Browser.V1.Workspace.byteWindow (request) (0) (1)) (decodeWorkspaceEnvelope (PrismPM.Foundation.Browser.V1.Workspace.byteWindow (request) (1) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (request) : Nat)) (1) : Nat)))) else _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))])

end PrismPM.Foundation.Browser.V1.WorkspaceEnvelope
