module
public import Init
public import LexLeanRuntime.Portable
public import PrismPM.Production.PublicationAdmission.V1
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.PublicationAdmission.LinkageV1

public structure PublicationMember where
  module : String
  name : String

public structure PublicationIdsChunk where
  entries : List (String)

public structure PublicationIds where
  chunks : List (PublicationIdsChunk)

public structure PublicationService where
  id : String
  components : PublicationIds

public structure PublicationServicesChunk where
  entries : List (PublicationService)

public structure PublicationServices where
  chunks : List (PublicationServicesChunk)

public structure ProofRequirement where
  «theorem» : PublicationMember

public inductive PublicationInputSelector where
  | BuildFile (_ : String)
  | SourceMember (_ : PublicationMember)
  | Target

public structure ExecutionRequirement where
  oracle : String
  input : PublicationInputSelector
  suite : ByteArray

public structure AssessmentRequirement where
  criterion : String
  subject : String

public inductive PublicationRequirementValue where
  | Proof (_ : ProofRequirement)
  | Execution (_ : ExecutionRequirement)
  | Assessment (_ : AssessmentRequirement)

public structure PublicationRequirement where
  obligation : Nat
  member : PublicationMember
  requirement : PublicationRequirementValue

public structure PublicationRequirementsChunk where
  entries : List (PublicationRequirement)

public structure PublicationRequirements where
  chunks : List (PublicationRequirementsChunk)

public structure PublicationClosure where
  system : PublicationMember
  target : String
  declaration : PrismPM.Production.PublicationAdmission.V1.PublicationDeclaration
  services : PublicationServices
  controls : PublicationIds
  requirements : PublicationRequirements

public structure PublicationRecord where
  id : String
  digest : ByteArray

public structure PublicationRecordsChunk where
  entries : List (PublicationRecord)

public structure PublicationRecords where
  chunks : List (PublicationRecordsChunk)

public structure PublicationFile where
  path : String
  digest : ByteArray

public structure PublicationFilesChunk where
  entries : List (PublicationFile)

public structure PublicationFiles where
  chunks : List (PublicationFilesChunk)

public structure PublicationSourceLink where
  snapshot : ByteArray
  source : ByteArray
  semantic : ByteArray
  compiler : ByteArray
  closureMember : PublicationMember
  moduleSource : ByteArray
  systemMember : PublicationMember
  system : ByteArray
  target : String

public structure PublicationCapture where
  sourceLink : PublicationSourceLink
  components : PublicationRecords
  controls : PublicationRecords
  provenance : ByteArray
  dependencies : PublicationRecords
  sdkLock : ByteArray
  standardsLock : ByteArray
  lexleanBuildManifest : ByteArray
  lexleanAttestation : ByteArray
  buildManifest : ByteArray
  verificationManifest : ByteArray
  verificationFiles : PublicationFiles
  browserFiles : PublicationFiles
  releaseValidation : ByteArray
  oracleAttestations : PublicationFiles

public inductive PublicationLinkageError where
  | InvalidMetadata
  | SourceMismatch
  | InventoryMismatch
  | RequirementMismatch

public structure PublicationPreimages where
  declaration : ByteArray
  services : ByteArray
  controls : ByteArray
  dependencies : ByteArray
  compiler : ByteArray
  runtime : ByteArray
  oracles : ByteArray

@[expose] public def publicationLinkageTextLengthValid (length : Nat) (maximum : Nat) : Bool := ((Nat.blt (0) (length)) && (Nat.ble (length) (maximum)))

@[expose] public def publicationLinkageTextValid (value : String) (maximum : Nat) : Bool := publicationLinkageTextLengthValid ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode (value) : ByteArray)) : Nat)) (maximum)

@[expose] public def publicationLinkageDigestValid (value : ByteArray) : Bool := (LexLeanRuntime.equal ((LexLeanRuntime.length (value) : Nat)) (32) : Bool)

@[expose] public def publicationLinkageMemberValid (value : PublicationMember) : Bool := (publicationLinkageTextValid ((value).module) (2048) && (publicationLinkageTextValid ((value).name) (2048) && true))

@[expose] public def publicationLinkageMemberEqual (left : PublicationMember) (right : PublicationMember) : Bool := ((LexLeanRuntime.equal ((left).module) ((right).module) : Bool) && ((LexLeanRuntime.equal ((left).name) ((right).name) : Bool) && true))

@[expose] public def publicationLinkagePublicationIdsShape : (chunks : List (PublicationIdsChunk)) -> (fuel : Nat) -> Bool
  | chunks, Nat.zero => (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool)
  | chunks, Nat.succ rest => (match chunks with | List.nil => true | List.cons head tail => ((Nat.blt (0) ((LexLeanRuntime.length ((head).entries) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((head).entries) : Nat)) (256)) && ((match (LexLeanRuntime.equal ((LexLeanRuntime.length (tail) : Nat)) (0) : Bool) with | Bool.false => (LexLeanRuntime.equal ((LexLeanRuntime.length ((head).entries) : Nat)) (256) : Bool) | Bool.true => true) && (publicationLinkagePublicationIdsShape (tail) (rest) && true)))))

@[expose] public def publicationLinkagePublicationIdsCanonical (items : PublicationIds) : Bool := publicationLinkagePublicationIdsShape ((items).chunks) (256)

@[expose] public def publicationLinkagePublicationIdsCountChunks : (chunks : List (PublicationIdsChunk)) -> (fuel : Nat) -> Nat
  | _chunks, Nat.zero => 0
  | chunks, Nat.succ rest => (match chunks with | List.nil => 0 | List.cons head tail => ((LexLeanRuntime.length ((head).entries) : Nat) + publicationLinkagePublicationIdsCountChunks (tail) (rest)))

@[expose] public def publicationLinkagePublicationIdsCount (items : PublicationIds) : Nat := publicationLinkagePublicationIdsCountChunks ((items).chunks) (256)

@[expose] public def publicationLinkagePublicationIdsAtChunks : (chunks : List (PublicationIdsChunk)) -> (offset : Nat) -> (fuel : Nat) -> Option (String)
  | _chunks, _offset, Nat.zero => Option.none
  | chunks, offset, Nat.succ rest => (match chunks with | List.nil => Option.none | List.cons head tail => (if (Nat.blt (offset) (256)) then (LexLeanRuntime.index ((head).entries) (offset) : Option (String)) else publicationLinkagePublicationIdsAtChunks (tail) ((LexLeanRuntime.subtract (offset) (256) : Nat)) (rest)))

@[expose] public def publicationLinkagePublicationIdsAt (items : PublicationIds) (offset : Nat) : Option (String) := publicationLinkagePublicationIdsAtChunks ((items).chunks) (offset) (256)

@[expose] public def publicationLinkagePublicationServicesShape : (chunks : List (PublicationServicesChunk)) -> (fuel : Nat) -> Bool
  | chunks, Nat.zero => (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool)
  | chunks, Nat.succ rest => (match chunks with | List.nil => true | List.cons head tail => ((Nat.blt (0) ((LexLeanRuntime.length ((head).entries) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((head).entries) : Nat)) (256)) && ((match (LexLeanRuntime.equal ((LexLeanRuntime.length (tail) : Nat)) (0) : Bool) with | Bool.false => (LexLeanRuntime.equal ((LexLeanRuntime.length ((head).entries) : Nat)) (256) : Bool) | Bool.true => true) && (publicationLinkagePublicationServicesShape (tail) (rest) && true)))))

@[expose] public def publicationLinkagePublicationServicesCanonical (items : PublicationServices) : Bool := publicationLinkagePublicationServicesShape ((items).chunks) (256)

@[expose] public def publicationLinkagePublicationServicesCountChunks : (chunks : List (PublicationServicesChunk)) -> (fuel : Nat) -> Nat
  | _chunks, Nat.zero => 0
  | chunks, Nat.succ rest => (match chunks with | List.nil => 0 | List.cons head tail => ((LexLeanRuntime.length ((head).entries) : Nat) + publicationLinkagePublicationServicesCountChunks (tail) (rest)))

@[expose] public def publicationLinkagePublicationServicesCount (items : PublicationServices) : Nat := publicationLinkagePublicationServicesCountChunks ((items).chunks) (256)

@[expose] public def publicationLinkagePublicationServicesAtChunks : (chunks : List (PublicationServicesChunk)) -> (offset : Nat) -> (fuel : Nat) -> Option (PublicationService)
  | _chunks, _offset, Nat.zero => Option.none
  | chunks, offset, Nat.succ rest => (match chunks with | List.nil => Option.none | List.cons head tail => (if (Nat.blt (offset) (256)) then (LexLeanRuntime.index ((head).entries) (offset) : Option (PublicationService)) else publicationLinkagePublicationServicesAtChunks (tail) ((LexLeanRuntime.subtract (offset) (256) : Nat)) (rest)))

@[expose] public def publicationLinkagePublicationServicesAt (items : PublicationServices) (offset : Nat) : Option (PublicationService) := publicationLinkagePublicationServicesAtChunks ((items).chunks) (offset) (256)

@[expose] public def publicationLinkagePublicationRequirementsShape : (chunks : List (PublicationRequirementsChunk)) -> (fuel : Nat) -> Bool
  | chunks, Nat.zero => (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool)
  | chunks, Nat.succ rest => (match chunks with | List.nil => true | List.cons head tail => ((Nat.blt (0) ((LexLeanRuntime.length ((head).entries) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((head).entries) : Nat)) (64)) && ((match (LexLeanRuntime.equal ((LexLeanRuntime.length (tail) : Nat)) (0) : Bool) with | Bool.false => (LexLeanRuntime.equal ((LexLeanRuntime.length ((head).entries) : Nat)) (64) : Bool) | Bool.true => true) && (publicationLinkagePublicationRequirementsShape (tail) (rest) && true)))))

@[expose] public def publicationLinkagePublicationRequirementsCanonical (items : PublicationRequirements) : Bool := publicationLinkagePublicationRequirementsShape ((items).chunks) (64)

@[expose] public def publicationLinkagePublicationRequirementsCountChunks : (chunks : List (PublicationRequirementsChunk)) -> (fuel : Nat) -> Nat
  | _chunks, Nat.zero => 0
  | chunks, Nat.succ rest => (match chunks with | List.nil => 0 | List.cons head tail => ((LexLeanRuntime.length ((head).entries) : Nat) + publicationLinkagePublicationRequirementsCountChunks (tail) (rest)))

@[expose] public def publicationLinkagePublicationRequirementsCount (items : PublicationRequirements) : Nat := publicationLinkagePublicationRequirementsCountChunks ((items).chunks) (64)

@[expose] public def publicationLinkagePublicationRequirementsAtChunks : (chunks : List (PublicationRequirementsChunk)) -> (offset : Nat) -> (fuel : Nat) -> Option (PublicationRequirement)
  | _chunks, _offset, Nat.zero => Option.none
  | chunks, offset, Nat.succ rest => (match chunks with | List.nil => Option.none | List.cons head tail => (if (Nat.blt (offset) (64)) then (LexLeanRuntime.index ((head).entries) (offset) : Option (PublicationRequirement)) else publicationLinkagePublicationRequirementsAtChunks (tail) ((LexLeanRuntime.subtract (offset) (64) : Nat)) (rest)))

@[expose] public def publicationLinkagePublicationRequirementsAt (items : PublicationRequirements) (offset : Nat) : Option (PublicationRequirement) := publicationLinkagePublicationRequirementsAtChunks ((items).chunks) (offset) (64)

@[expose] public def publicationLinkagePublicationRecordsShape : (chunks : List (PublicationRecordsChunk)) -> (fuel : Nat) -> Bool
  | chunks, Nat.zero => (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool)
  | chunks, Nat.succ rest => (match chunks with | List.nil => true | List.cons head tail => ((Nat.blt (0) ((LexLeanRuntime.length ((head).entries) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((head).entries) : Nat)) (256)) && ((match (LexLeanRuntime.equal ((LexLeanRuntime.length (tail) : Nat)) (0) : Bool) with | Bool.false => (LexLeanRuntime.equal ((LexLeanRuntime.length ((head).entries) : Nat)) (256) : Bool) | Bool.true => true) && (publicationLinkagePublicationRecordsShape (tail) (rest) && true)))))

@[expose] public def publicationLinkagePublicationRecordsCanonical (items : PublicationRecords) : Bool := publicationLinkagePublicationRecordsShape ((items).chunks) (256)

@[expose] public def publicationLinkagePublicationRecordsCountChunks : (chunks : List (PublicationRecordsChunk)) -> (fuel : Nat) -> Nat
  | _chunks, Nat.zero => 0
  | chunks, Nat.succ rest => (match chunks with | List.nil => 0 | List.cons head tail => ((LexLeanRuntime.length ((head).entries) : Nat) + publicationLinkagePublicationRecordsCountChunks (tail) (rest)))

@[expose] public def publicationLinkagePublicationRecordsCount (items : PublicationRecords) : Nat := publicationLinkagePublicationRecordsCountChunks ((items).chunks) (256)

@[expose] public def publicationLinkagePublicationRecordsAtChunks : (chunks : List (PublicationRecordsChunk)) -> (offset : Nat) -> (fuel : Nat) -> Option (PublicationRecord)
  | _chunks, _offset, Nat.zero => Option.none
  | chunks, offset, Nat.succ rest => (match chunks with | List.nil => Option.none | List.cons head tail => (if (Nat.blt (offset) (256)) then (LexLeanRuntime.index ((head).entries) (offset) : Option (PublicationRecord)) else publicationLinkagePublicationRecordsAtChunks (tail) ((LexLeanRuntime.subtract (offset) (256) : Nat)) (rest)))

@[expose] public def publicationLinkagePublicationRecordsAt (items : PublicationRecords) (offset : Nat) : Option (PublicationRecord) := publicationLinkagePublicationRecordsAtChunks ((items).chunks) (offset) (256)

@[expose] public def publicationLinkagePublicationFilesShape : (chunks : List (PublicationFilesChunk)) -> (fuel : Nat) -> Bool
  | chunks, Nat.zero => (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool)
  | chunks, Nat.succ rest => (match chunks with | List.nil => true | List.cons head tail => ((Nat.blt (0) ((LexLeanRuntime.length ((head).entries) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((head).entries) : Nat)) (256)) && ((match (LexLeanRuntime.equal ((LexLeanRuntime.length (tail) : Nat)) (0) : Bool) with | Bool.false => (LexLeanRuntime.equal ((LexLeanRuntime.length ((head).entries) : Nat)) (256) : Bool) | Bool.true => true) && (publicationLinkagePublicationFilesShape (tail) (rest) && true)))))

@[expose] public def publicationLinkagePublicationFilesCanonical (items : PublicationFiles) : Bool := publicationLinkagePublicationFilesShape ((items).chunks) (256)

@[expose] public def publicationLinkagePublicationFilesCountChunks : (chunks : List (PublicationFilesChunk)) -> (fuel : Nat) -> Nat
  | _chunks, Nat.zero => 0
  | chunks, Nat.succ rest => (match chunks with | List.nil => 0 | List.cons head tail => ((LexLeanRuntime.length ((head).entries) : Nat) + publicationLinkagePublicationFilesCountChunks (tail) (rest)))

@[expose] public def publicationLinkagePublicationFilesCount (items : PublicationFiles) : Nat := publicationLinkagePublicationFilesCountChunks ((items).chunks) (256)

@[expose] public def publicationLinkagePublicationFilesAtChunks : (chunks : List (PublicationFilesChunk)) -> (offset : Nat) -> (fuel : Nat) -> Option (PublicationFile)
  | _chunks, _offset, Nat.zero => Option.none
  | chunks, offset, Nat.succ rest => (match chunks with | List.nil => Option.none | List.cons head tail => (if (Nat.blt (offset) (256)) then (LexLeanRuntime.index ((head).entries) (offset) : Option (PublicationFile)) else publicationLinkagePublicationFilesAtChunks (tail) ((LexLeanRuntime.subtract (offset) (256) : Nat)) (rest)))

@[expose] public def publicationLinkagePublicationFilesAt (items : PublicationFiles) (offset : Nat) : Option (PublicationFile) := publicationLinkagePublicationFilesAtChunks ((items).chunks) (offset) (256)

@[expose] public def publicationLinkageTextLess (left : String) (right : String) : Bool := (LexLeanRuntime.equal ((LexLeanRuntime.compareBytes ((LexLeanRuntime.utf8Encode (left) : ByteArray)) ((LexLeanRuntime.utf8Encode (right) : ByteArray)) : Ordering)) ((LexLeanRuntime.compareBytes (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) : Ordering)) : Bool)

public structure PublicationScan where
  valid : Bool
  previous : String
  count : Nat

@[expose] public def publicationLinkagePublicationIdsScanRows : (items : List (String)) -> (state : PublicationScan) -> (fuel : Nat) -> PublicationScan
  | items, state, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (items) : Nat)) (0) : Bool) with | Bool.false => ({ valid := false, previous := "", count := 0 } : PublicationScan) | Bool.true => state)
  | items, state, Nat.succ rest => (match items with | List.nil => state | List.cons head tail => publicationLinkagePublicationIdsScanRows (tail) (({ valid := ((state).valid && (publicationLinkageTextValid (head) (128) && (publicationLinkageTextLess ((state).previous) (head) && (true && ((Nat.ble (((state).count + 1)) (65536)) && true))))), previous := head, count := ((state).count + 1) } : PublicationScan)) (rest))

@[expose] public def publicationLinkagePublicationIdsScanChunks : (chunks : List (PublicationIdsChunk)) -> (state : PublicationScan) -> (fuel : Nat) -> PublicationScan
  | chunks, state, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool) with | Bool.false => ({ valid := false, previous := "", count := 0 } : PublicationScan) | Bool.true => state)
  | chunks, state, Nat.succ rest => (match chunks with | List.nil => state | List.cons head tail => publicationLinkagePublicationIdsScanChunks (tail) (publicationLinkagePublicationIdsScanRows ((head).entries) (state) (256)) (rest))

@[expose] public def publicationLinkagePublicationIdsScan (items : PublicationIds) : PublicationScan := publicationLinkagePublicationIdsScanChunks ((items).chunks) (({ valid := true, previous := "", count := 0 } : PublicationScan)) (256)

@[expose] public def publicationLinkagePublicationIdsValid (items : PublicationIds) : Bool := (publicationLinkagePublicationIdsCanonical (items) && ((publicationLinkagePublicationIdsScan (items)).valid && true))

@[expose] public def publicationLinkagePublicationRecordsScanRows : (items : List (PublicationRecord)) -> (state : PublicationScan) -> (fuel : Nat) -> PublicationScan
  | items, state, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (items) : Nat)) (0) : Bool) with | Bool.false => ({ valid := false, previous := "", count := 0 } : PublicationScan) | Bool.true => state)
  | items, state, Nat.succ rest => (match items with | List.nil => state | List.cons head tail => publicationLinkagePublicationRecordsScanRows (tail) (({ valid := ((state).valid && (publicationLinkageTextValid ((head).id) (2048) && (publicationLinkageTextLess ((state).previous) ((head).id) && (publicationLinkageDigestValid ((head).digest) && ((Nat.ble (((state).count + 1)) (65536)) && true))))), previous := (head).id, count := ((state).count + 1) } : PublicationScan)) (rest))

@[expose] public def publicationLinkagePublicationRecordsScanChunks : (chunks : List (PublicationRecordsChunk)) -> (state : PublicationScan) -> (fuel : Nat) -> PublicationScan
  | chunks, state, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool) with | Bool.false => ({ valid := false, previous := "", count := 0 } : PublicationScan) | Bool.true => state)
  | chunks, state, Nat.succ rest => (match chunks with | List.nil => state | List.cons head tail => publicationLinkagePublicationRecordsScanChunks (tail) (publicationLinkagePublicationRecordsScanRows ((head).entries) (state) (256)) (rest))

@[expose] public def publicationLinkagePublicationRecordsScan (items : PublicationRecords) : PublicationScan := publicationLinkagePublicationRecordsScanChunks ((items).chunks) (({ valid := true, previous := "", count := 0 } : PublicationScan)) (256)

@[expose] public def publicationLinkagePublicationRecordsValid (items : PublicationRecords) : Bool := (publicationLinkagePublicationRecordsCanonical (items) && ((publicationLinkagePublicationRecordsScan (items)).valid && true))

@[expose] public def publicationLinkagePublicationFilesScanRows : (items : List (PublicationFile)) -> (state : PublicationScan) -> (fuel : Nat) -> PublicationScan
  | items, state, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (items) : Nat)) (0) : Bool) with | Bool.false => ({ valid := false, previous := "", count := 0 } : PublicationScan) | Bool.true => state)
  | items, state, Nat.succ rest => (match items with | List.nil => state | List.cons head tail => publicationLinkagePublicationFilesScanRows (tail) (({ valid := ((state).valid && (publicationLinkageTextValid ((head).path) (2048) && (publicationLinkageTextLess ((state).previous) ((head).path) && (publicationLinkageDigestValid ((head).digest) && ((Nat.ble (((state).count + 1)) (65536)) && true))))), previous := (head).path, count := ((state).count + 1) } : PublicationScan)) (rest))

@[expose] public def publicationLinkagePublicationFilesScanChunks : (chunks : List (PublicationFilesChunk)) -> (state : PublicationScan) -> (fuel : Nat) -> PublicationScan
  | chunks, state, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool) with | Bool.false => ({ valid := false, previous := "", count := 0 } : PublicationScan) | Bool.true => state)
  | chunks, state, Nat.succ rest => (match chunks with | List.nil => state | List.cons head tail => publicationLinkagePublicationFilesScanChunks (tail) (publicationLinkagePublicationFilesScanRows ((head).entries) (state) (256)) (rest))

@[expose] public def publicationLinkagePublicationFilesScan (items : PublicationFiles) : PublicationScan := publicationLinkagePublicationFilesScanChunks ((items).chunks) (({ valid := true, previous := "", count := 0 } : PublicationScan)) (256)

@[expose] public def publicationLinkagePublicationFilesValid (items : PublicationFiles) : Bool := (publicationLinkagePublicationFilesCanonical (items) && ((publicationLinkagePublicationFilesScan (items)).valid && true))

@[expose] public def publicationLinkagePublicationServicesScanRows : (items : List (PublicationService)) -> (state : PublicationScan) -> (fuel : Nat) -> PublicationScan
  | items, state, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (items) : Nat)) (0) : Bool) with | Bool.false => ({ valid := false, previous := "", count := 0 } : PublicationScan) | Bool.true => state)
  | items, state, Nat.succ rest => (match items with | List.nil => state | List.cons head tail => publicationLinkagePublicationServicesScanRows (tail) (({ valid := ((state).valid && (publicationLinkageTextValid ((head).id) (128) && (publicationLinkageTextLess ((state).previous) ((head).id) && ((publicationLinkagePublicationIdsValid ((head).components) && ((Nat.blt (0) (publicationLinkagePublicationIdsCount ((head).components))) && true)) && ((Nat.ble (((state).count + publicationLinkagePublicationIdsCount ((head).components))) (65536)) && true))))), previous := (head).id, count := ((state).count + publicationLinkagePublicationIdsCount ((head).components)) } : PublicationScan)) (rest))

@[expose] public def publicationLinkagePublicationServicesScanChunks : (chunks : List (PublicationServicesChunk)) -> (state : PublicationScan) -> (fuel : Nat) -> PublicationScan
  | chunks, state, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool) with | Bool.false => ({ valid := false, previous := "", count := 0 } : PublicationScan) | Bool.true => state)
  | chunks, state, Nat.succ rest => (match chunks with | List.nil => state | List.cons head tail => publicationLinkagePublicationServicesScanChunks (tail) (publicationLinkagePublicationServicesScanRows ((head).entries) (state) (256)) (rest))

@[expose] public def publicationLinkagePublicationServicesScan (items : PublicationServices) : PublicationScan := publicationLinkagePublicationServicesScanChunks ((items).chunks) (({ valid := true, previous := "", count := 0 } : PublicationScan)) (256)

@[expose] public def publicationLinkagePublicationServicesValid (items : PublicationServices) : Bool := (publicationLinkagePublicationServicesCanonical (items) && ((publicationLinkagePublicationServicesScan (items)).valid && true))

@[expose] public def publicationLinkageSelectorValid (selector : PublicationInputSelector) : Bool := (match selector with | PublicationInputSelector.BuildFile path => publicationLinkageTextValid (path) (2048) | PublicationInputSelector.SourceMember member => publicationLinkageMemberValid (member) | PublicationInputSelector.Target => true)

@[expose] public def publicationLinkageRequirementValid (requirement : PublicationRequirement) : Bool := ((Nat.blt (0) ((requirement).obligation)) && ((Nat.ble ((requirement).obligation) (4294967295)) && (publicationLinkageMemberValid ((requirement).member) && ((match (requirement).requirement with | PublicationRequirementValue.Proof proof => publicationLinkageMemberValid ((proof).«theorem») | PublicationRequirementValue.Execution execution => (publicationLinkageTextValid ((execution).oracle) (128) && (publicationLinkageSelectorValid ((execution).input) && (publicationLinkageDigestValid ((execution).suite) && true))) | PublicationRequirementValue.Assessment assessment => (publicationLinkageTextValid ((assessment).criterion) (2048) && (publicationLinkageTextValid ((assessment).subject) (2048) && true))) && true))))

@[expose] public def publicationLinkageRequirementsScan : (items : PublicationRequirements) -> (previous : Nat) -> (fuel : Nat) -> Bool
  | _items, _previous, Nat.zero => true
  | items, previous, Nat.succ rest => (match publicationLinkagePublicationRequirementsAt (items) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) with | Option.none => true | Option.some item => (publicationLinkageRequirementValid (item) && ((Nat.blt (previous) ((item).obligation)) && (publicationLinkageRequirementsScan (items) ((item).obligation) (rest) && true))))

@[expose] public def publicationLinkageRequirementsValid (items : PublicationRequirements) : Bool := (publicationLinkagePublicationRequirementsCanonical (items) && ((Nat.ble (2) (publicationLinkagePublicationRequirementsCount (items))) && (publicationLinkageRequirementsScan (items) (0) (4096) && true)))

@[expose] public def publicationLinkageSourceValid (link : PublicationSourceLink) : Bool := (publicationLinkageDigestValid ((link).snapshot) && (publicationLinkageDigestValid ((link).source) && (publicationLinkageDigestValid ((link).semantic) && (publicationLinkageDigestValid ((link).compiler) && (publicationLinkageDigestValid ((link).moduleSource) && (publicationLinkageDigestValid ((link).system) && (publicationLinkageMemberValid ((link).closureMember) && (publicationLinkageMemberValid ((link).systemMember) && (publicationLinkageTextValid ((link).target) (128) && true)))))))))

@[expose] public def publicationLinkageSmallRecordRows : (items : List (PublicationRecord)) -> (fuel : Nat) -> Bool
  | items, Nat.zero => (LexLeanRuntime.equal ((LexLeanRuntime.length (items) : Nat)) (0) : Bool)
  | items, Nat.succ rest => (match items with | List.nil => true | List.cons head tail => (publicationLinkageTextValid ((head).id) (128) && (publicationLinkageSmallRecordRows (tail) (rest) && true)))

@[expose] public def publicationLinkageSmallRecordChunks : (chunks : List (PublicationRecordsChunk)) -> (fuel : Nat) -> Bool
  | chunks, Nat.zero => (LexLeanRuntime.equal ((LexLeanRuntime.length (chunks) : Nat)) (0) : Bool)
  | chunks, Nat.succ rest => (match chunks with | List.nil => true | List.cons head tail => (publicationLinkageSmallRecordRows ((head).entries) (256) && (publicationLinkageSmallRecordChunks (tail) (rest) && true)))

@[expose] public def publicationLinkageMetadataValid (closure : PublicationClosure) (capture : PublicationCapture) : Bool := (publicationLinkageMemberValid ((closure).system) && (publicationLinkageTextValid ((closure).target) (128) && (PrismPM.Production.PublicationAdmission.V1.publicationDeclarationValid ((closure).declaration) && (publicationLinkagePublicationServicesValid ((closure).services) && ((Nat.blt (0) (publicationLinkagePublicationServicesCount ((closure).services))) && (publicationLinkagePublicationIdsValid ((closure).controls) && (publicationLinkageRequirementsValid ((closure).requirements) && (publicationLinkageSourceValid ((capture).sourceLink) && (publicationLinkagePublicationRecordsValid ((capture).components) && (publicationLinkagePublicationRecordsValid ((capture).controls) && (publicationLinkagePublicationRecordsValid ((capture).dependencies) && (publicationLinkageSmallRecordChunks (((capture).components).chunks) (256) && (publicationLinkageSmallRecordChunks (((capture).controls).chunks) (256) && (publicationLinkagePublicationFilesValid ((capture).verificationFiles) && (publicationLinkagePublicationFilesValid ((capture).browserFiles) && (publicationLinkagePublicationFilesValid ((capture).oracleAttestations) && (publicationLinkageDigestValid ((capture).provenance) && (publicationLinkageDigestValid ((capture).sdkLock) && (publicationLinkageDigestValid ((capture).standardsLock) && (publicationLinkageDigestValid ((capture).lexleanBuildManifest) && (publicationLinkageDigestValid ((capture).lexleanAttestation) && (publicationLinkageDigestValid ((capture).buildManifest) && (publicationLinkageDigestValid ((capture).verificationManifest) && (publicationLinkageDigestValid ((capture).releaseValidation) && true))))))))))))))))))))))))

@[expose] public def publicationLinkageRecordCompareRows : (rows : List (PublicationRecord)) -> (recordId : String) -> (index : Nat) -> (fuel : Nat) -> Option (Nat)
  | _rows, _recordId, _index, Nat.zero => Option.none
  | rows, recordId, index, Nat.succ rest => (match rows with | List.nil => Option.none | List.cons head tail => (match (Nat.beq (index) (0)) with | Bool.false => publicationLinkageRecordCompareRows (tail) (recordId) ((LexLeanRuntime.subtract (index) (1) : Nat)) (rest) | Bool.true => Option.some ((match publicationLinkageTextLess (recordId) ((head).id) with | Bool.false => (match publicationLinkageTextLess ((head).id) (recordId) with | Bool.false => 1 | Bool.true => 2) | Bool.true => 0))))

@[expose] public def publicationLinkageRecordCompareChunks : (chunks : List (PublicationRecordsChunk)) -> (recordId : String) -> (index : Nat) -> (fuel : Nat) -> Option (Nat)
  | _chunks, _recordId, _index, Nat.zero => Option.none
  | chunks, recordId, index, Nat.succ rest => (match chunks with | List.nil => Option.none | List.cons head tail => (match (Nat.blt (index) (256)) with | Bool.false => publicationLinkageRecordCompareChunks (tail) (recordId) ((LexLeanRuntime.subtract (index) (256) : Nat)) (rest) | Bool.true => publicationLinkageRecordCompareRows ((head).entries) (recordId) (index) (256)))

@[expose] public def publicationLinkageRecordCompareAt (records : PublicationRecords) (recordId : String) (index : Nat) : Option (Nat) := publicationLinkageRecordCompareChunks ((records).chunks) (recordId) (index) (256)

@[expose] public def publicationLinkageRecordIndex : (records : PublicationRecords) -> (recordId : String) -> (lower : Nat) -> (upper : Nat) -> (fuel : Nat) -> Option (Nat)
  | _records, _recordId, _lower, _upper, Nat.zero => Option.none
  | records, recordId, lower, upper, Nat.succ rest => (match (Nat.blt (lower) (upper)) with | Bool.false => Option.none | Bool.true => (match publicationLinkageRecordCompareAt (records) (recordId) ((LexLeanRuntime.quotient ((lower + upper)) (2) (0) : Nat)) with | Option.none => Option.none | Option.some order => (match (Nat.beq (order) (0)) with | Bool.false => (match (Nat.beq (order) (1)) with | Bool.false => publicationLinkageRecordIndex (records) (recordId) (((LexLeanRuntime.quotient ((lower + upper)) (2) (0) : Nat) + 1)) (upper) (rest) | Bool.true => Option.some ((LexLeanRuntime.quotient ((lower + upper)) (2) (0) : Nat))) | Bool.true => publicationLinkageRecordIndex (records) (recordId) (lower) ((LexLeanRuntime.quotient ((lower + upper)) (2) (0) : Nat)) (rest))))

@[expose] public def publicationLinkageZeroMarks : (fuel : Nat) -> ByteArray
  | Nat.zero => _root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]
  | Nat.succ rest => (LexLeanRuntime.append (publicationLinkageZeroMarks (rest)) (publicationLinkageZeroMarks (rest)) : ByteArray)

@[expose] public def publicationLinkageMark (marks : ByteArray) (offset : Nat) : Option (ByteArray) := (match (LexLeanRuntime.slice (marks) (offset) (1) : Option (ByteArray)) with | Option.none => Option.none | Option.some item => (match (LexLeanRuntime.equal (item) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 0))]) : Bool) with | Bool.false => Option.none | Bool.true => (match (LexLeanRuntime.slice (marks) (0) (offset) : Option (ByteArray)) with | Option.none => Option.none | Option.some before => (match (LexLeanRuntime.slice (marks) ((offset + 1)) ((LexLeanRuntime.subtract ((LexLeanRuntime.length (marks) : Nat)) ((offset + 1)) : Nat)) : Option (ByteArray)) with | Option.none => Option.none | Option.some after => Option.some ((LexLeanRuntime.append ((LexLeanRuntime.append (before) (_root_.ByteArray.mk #[(_root_.UInt8.ofNat (nat_lit 1))]) : ByteArray)) (after) : ByteArray))))))

public structure PublicationIndexBatch where
  indices : List (Nat)
  valid : Bool

@[expose] public def publicationLinkageCollectRowsAcc : (items : List (String)) -> (records : PublicationRecords) -> (offset : Nat) -> (indices : List (Nat)) -> (fuel : Nat) -> PublicationIndexBatch
  | items, _records, offset, indices, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (items) : Nat)) (offset) : Bool) with | Bool.false => ({ indices := ([] : List (Nat)), valid := false } : PublicationIndexBatch) | Bool.true => ({ indices := indices, valid := true } : PublicationIndexBatch))
  | items, records, offset, indices, Nat.succ rest => (match (LexLeanRuntime.index (items) (offset) : Option (String)) with | Option.none => ({ indices := indices, valid := true } : PublicationIndexBatch) | Option.some head => (match publicationLinkageRecordIndex (records) (head) (0) (publicationLinkagePublicationRecordsCount (records)) (17) with | Option.none => ({ indices := ([] : List (Nat)), valid := false } : PublicationIndexBatch) | Option.some index => publicationLinkageCollectRowsAcc (items) (records) ((offset + 1)) ((LexLeanRuntime.append (indices) ((index :: ([] : List (Nat)))) : List (Nat))) (rest)))

@[expose] public def publicationLinkageCollectIdChunksAcc : (items : List (PublicationIdsChunk)) -> (records : PublicationRecords) -> (offset : Nat) -> (indices : List (Nat)) -> (fuel : Nat) -> PublicationIndexBatch
  | items, _records, offset, indices, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (items) : Nat)) (offset) : Bool) with | Bool.false => ({ indices := ([] : List (Nat)), valid := false } : PublicationIndexBatch) | Bool.true => ({ indices := indices, valid := true } : PublicationIndexBatch))
  | items, records, offset, indices, Nat.succ rest => (match (LexLeanRuntime.index (items) (offset) : Option (PublicationIdsChunk)) with | Option.none => ({ indices := indices, valid := true } : PublicationIndexBatch) | Option.some head => (match publicationLinkageCollectRowsAcc ((head).entries) (records) (0) (([] : List (Nat))) (256) with | PublicationIndexBatch.mk following valid => (match valid with | Bool.false => ({ indices := ([] : List (Nat)), valid := false } : PublicationIndexBatch) | Bool.true => publicationLinkageCollectIdChunksAcc (items) (records) ((offset + 1)) ((LexLeanRuntime.append (indices) (following) : List (Nat))) (rest))))

@[expose] public def publicationLinkageCollectServiceRowsAcc : (items : List (PublicationService)) -> (records : PublicationRecords) -> (offset : Nat) -> (indices : List (Nat)) -> (fuel : Nat) -> PublicationIndexBatch
  | items, _records, offset, indices, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (items) : Nat)) (offset) : Bool) with | Bool.false => ({ indices := ([] : List (Nat)), valid := false } : PublicationIndexBatch) | Bool.true => ({ indices := indices, valid := true } : PublicationIndexBatch))
  | items, records, offset, indices, Nat.succ rest => (match (LexLeanRuntime.index (items) (offset) : Option (PublicationService)) with | Option.none => ({ indices := indices, valid := true } : PublicationIndexBatch) | Option.some head => (match publicationLinkageCollectIdChunksAcc (((head).components).chunks) (records) (0) (([] : List (Nat))) (256) with | PublicationIndexBatch.mk following valid => (match valid with | Bool.false => ({ indices := ([] : List (Nat)), valid := false } : PublicationIndexBatch) | Bool.true => publicationLinkageCollectServiceRowsAcc (items) (records) ((offset + 1)) ((LexLeanRuntime.append (indices) (following) : List (Nat))) (rest))))

@[expose] public def publicationLinkageCollectServiceChunksAcc : (items : List (PublicationServicesChunk)) -> (records : PublicationRecords) -> (offset : Nat) -> (indices : List (Nat)) -> (fuel : Nat) -> PublicationIndexBatch
  | items, _records, offset, indices, Nat.zero => (match (LexLeanRuntime.equal ((LexLeanRuntime.length (items) : Nat)) (offset) : Bool) with | Bool.false => ({ indices := ([] : List (Nat)), valid := false } : PublicationIndexBatch) | Bool.true => ({ indices := indices, valid := true } : PublicationIndexBatch))
  | items, records, offset, indices, Nat.succ rest => (match (LexLeanRuntime.index (items) (offset) : Option (PublicationServicesChunk)) with | Option.none => ({ indices := indices, valid := true } : PublicationIndexBatch) | Option.some head => (match publicationLinkageCollectServiceRowsAcc ((head).entries) (records) (0) (([] : List (Nat))) (256) with | PublicationIndexBatch.mk following valid => (match valid with | Bool.false => ({ indices := ([] : List (Nat)), valid := false } : PublicationIndexBatch) | Bool.true => publicationLinkageCollectServiceChunksAcc (items) (records) ((offset + 1)) ((LexLeanRuntime.append (indices) (following) : List (Nat))) (rest))))

@[expose] public def publicationLinkageCollectRows (items : List (String)) (records : PublicationRecords) (fuel : Nat) : Option (List (Nat)) := (match publicationLinkageCollectRowsAcc (items) (records) (0) (([] : List (Nat))) (fuel) with | PublicationIndexBatch.mk indices valid => (match valid with | Bool.false => Option.none | Bool.true => Option.some (indices)))

@[expose] public def publicationLinkageCollectIdChunks (items : List (PublicationIdsChunk)) (records : PublicationRecords) (fuel : Nat) : Option (List (Nat)) := (match publicationLinkageCollectIdChunksAcc (items) (records) (0) (([] : List (Nat))) (fuel) with | PublicationIndexBatch.mk indices valid => (match valid with | Bool.false => Option.none | Bool.true => Option.some (indices)))

@[expose] public def publicationLinkageCollectServiceRows (items : List (PublicationService)) (records : PublicationRecords) (fuel : Nat) : Option (List (Nat)) := (match publicationLinkageCollectServiceRowsAcc (items) (records) (0) (([] : List (Nat))) (fuel) with | PublicationIndexBatch.mk indices valid => (match valid with | Bool.false => Option.none | Bool.true => Option.some (indices)))

@[expose] public def publicationLinkageCollectServiceChunks (items : List (PublicationServicesChunk)) (records : PublicationRecords) (fuel : Nat) : Option (List (Nat)) := (match publicationLinkageCollectServiceChunksAcc (items) (records) (0) (([] : List (Nat))) (fuel) with | PublicationIndexBatch.mk indices valid => (match valid with | Bool.false => Option.none | Bool.true => Option.some (indices)))

@[expose] public def publicationLinkageBucketRows : (indices : List (Nat)) -> (offset : Nat) -> (lower : Nat) -> (marks : ByteArray) -> (fuel : Nat) -> Option (ByteArray)
  | _indices, _offset, _lower, marks, Nat.zero => Option.some (marks)
  | indices, offset, lower, marks, Nat.succ rest => (match (LexLeanRuntime.index (indices) (offset) : Option (Nat)) with | Option.none => Option.some (marks) | Option.some index => (if ((Nat.ble (lower) (index)) && (Nat.blt (index) ((lower + 256)))) then (match publicationLinkageMark (marks) ((LexLeanRuntime.subtract (index) (lower) : Nat)) with | Option.none => Option.none | Option.some next => publicationLinkageBucketRows (indices) ((offset + 1)) (lower) (next) (rest)) else publicationLinkageBucketRows (indices) ((offset + 1)) (lower) (marks) (rest)))

@[expose] public def publicationLinkageBucketChunks : (indices : List (Nat)) -> (offset : Nat) -> (lower : Nat) -> (marks : ByteArray) -> (fuel : Nat) -> Option (ByteArray)
  | indices, offset, _lower, marks, Nat.zero => (if (Nat.ble ((LexLeanRuntime.length (indices) : Nat)) (offset)) then Option.some (marks) else Option.none)
  | indices, offset, lower, marks, Nat.succ rest => (if (Nat.ble ((LexLeanRuntime.length (indices) : Nat)) (offset)) then Option.some (marks) else (match publicationLinkageBucketRows (indices) (offset) (lower) (marks) (256) with | Option.none => Option.none | Option.some next => publicationLinkageBucketChunks (indices) ((offset + 256)) (lower) (next) (rest)))

@[expose] public def publicationLinkageBuckets : (indices : List (Nat)) -> (lower : Nat) -> (upper : Nat) -> (fuel : Nat) -> Bool
  | _indices, lower, upper, Nat.zero => (Nat.ble (upper) (lower))
  | indices, lower, upper, Nat.succ rest => (if (Nat.ble (upper) (lower)) then true else (match publicationLinkageBucketChunks (indices) (0) (lower) (publicationLinkageZeroMarks (8)) (256) with | Option.none => false | Option.some marks => ((LexLeanRuntime.equal ((LexLeanRuntime.length (marks) : Nat)) (256) : Bool) && publicationLinkageBuckets (indices) ((lower + 256)) (upper) (rest))))

public structure PublicationBitMarks where
  word0 : UInt64
  word1 : UInt64
  word2 : UInt64
  word3 : UInt64

@[expose] public def publicationLinkageBitMaskLoop : (remaining : Nat) -> (mask : UInt64) -> (fuel : Nat) -> Option (UInt64)
  | remaining, mask, Nat.zero => (match (LexLeanRuntime.equal (remaining) (0) : Bool) with | Bool.false => Option.none | Bool.true => Option.some (mask))
  | remaining, mask, Nat.succ rest => (match remaining with | Nat.zero => Option.some (mask) | Nat.succ next => (match (LexLeanRuntime.shiftLeft (mask) ((1 : UInt32)) : Option (UInt64)) with | Option.none => Option.none | Option.some shifted => publicationLinkageBitMaskLoop (next) (shifted) (rest)))

@[expose] public def publicationLinkageBitMark (marks : PublicationBitMarks) (offset : Nat) : Option (PublicationBitMarks) := (match (Nat.blt (offset) (256)) with | Bool.false => Option.none | Bool.true => (match publicationLinkageBitMaskLoop ((LexLeanRuntime.remainder (offset) (64) (0) : Nat)) ((1 : UInt64)) (63) with | Option.none => Option.none | Option.some mask => (match (Nat.blt (offset) (64)) with | Bool.false => (match (Nat.blt (offset) (128)) with | Bool.false => (match (Nat.blt (offset) (192)) with | Bool.false => (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd ((marks).word3) (mask) : UInt64)) ((0 : UInt64)) : Bool) with | Bool.false => Option.none | Bool.true => Option.some (({ word0 := (marks).word0, word1 := (marks).word1, word2 := (marks).word2, word3 := (LexLeanRuntime.bitOr ((marks).word3) (mask) : UInt64) } : PublicationBitMarks))) | Bool.true => (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd ((marks).word2) (mask) : UInt64)) ((0 : UInt64)) : Bool) with | Bool.false => Option.none | Bool.true => Option.some (({ word0 := (marks).word0, word1 := (marks).word1, word2 := (LexLeanRuntime.bitOr ((marks).word2) (mask) : UInt64), word3 := (marks).word3 } : PublicationBitMarks)))) | Bool.true => (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd ((marks).word1) (mask) : UInt64)) ((0 : UInt64)) : Bool) with | Bool.false => Option.none | Bool.true => Option.some (({ word0 := (marks).word0, word1 := (LexLeanRuntime.bitOr ((marks).word1) (mask) : UInt64), word2 := (marks).word2, word3 := (marks).word3 } : PublicationBitMarks)))) | Bool.true => (match (LexLeanRuntime.equal ((LexLeanRuntime.bitAnd ((marks).word0) (mask) : UInt64)) ((0 : UInt64)) : Bool) with | Bool.false => Option.none | Bool.true => Option.some (({ word0 := (LexLeanRuntime.bitOr ((marks).word0) (mask) : UInt64), word1 := (marks).word1, word2 := (marks).word2, word3 := (marks).word3 } : PublicationBitMarks))))))

@[expose] public def publicationLinkageBitWordCovered (word : UInt64) (width : Nat) : Bool := (match (Nat.ble (64) (width)) with | Bool.false => (match publicationLinkageBitMaskLoop (width) ((1 : UInt64)) (63) with | Option.none => false | Option.some mask => (match (LexLeanRuntime.checkedSubtract (mask) ((1 : UInt64)) : Option (UInt64)) with | Option.none => false | Option.some expected => (LexLeanRuntime.equal (word) (expected) : Bool))) | Bool.true => (LexLeanRuntime.equal (word) ((18446744073709551615 : UInt64)) : Bool))

@[expose] public def publicationLinkageBitMarksCovered (marks : PublicationBitMarks) (width : Nat) : Bool := (publicationLinkageBitWordCovered ((marks).word0) ((LexLeanRuntime.subtract (width) (0) : Nat)) && (publicationLinkageBitWordCovered ((marks).word1) ((LexLeanRuntime.subtract (width) (64) : Nat)) && (publicationLinkageBitWordCovered ((marks).word2) ((LexLeanRuntime.subtract (width) (128) : Nat)) && (publicationLinkageBitWordCovered ((marks).word3) ((LexLeanRuntime.subtract (width) (192) : Nat)) && true))))

@[expose] public def publicationLinkageBitRows : (indices : List (Nat)) -> (offset : Nat) -> (lower : Nat) -> (marks : PublicationBitMarks) -> (fuel : Nat) -> Option (PublicationBitMarks)
  | _indices, _offset, _lower, marks, Nat.zero => Option.some (marks)
  | indices, offset, lower, marks, Nat.succ rest => (match (LexLeanRuntime.index (indices) (offset) : Option (Nat)) with | Option.none => Option.some (marks) | Option.some index => (if ((Nat.ble (lower) (index)) && (Nat.blt (index) ((lower + 256)))) then (match publicationLinkageBitMark (marks) ((LexLeanRuntime.subtract (index) (lower) : Nat)) with | Option.none => Option.none | Option.some next => publicationLinkageBitRows (indices) ((offset + 1)) (lower) (next) (rest)) else publicationLinkageBitRows (indices) ((offset + 1)) (lower) (marks) (rest)))

@[expose] public def publicationLinkageBitChunks : (indices : List (Nat)) -> (offset : Nat) -> (lower : Nat) -> (marks : PublicationBitMarks) -> (fuel : Nat) -> Option (PublicationBitMarks)
  | indices, offset, _lower, marks, Nat.zero => (if (Nat.ble ((LexLeanRuntime.length (indices) : Nat)) (offset)) then Option.some (marks) else Option.none)
  | indices, offset, lower, marks, Nat.succ rest => (if (Nat.ble ((LexLeanRuntime.length (indices) : Nat)) (offset)) then Option.some (marks) else (match publicationLinkageBitRows (indices) (offset) (lower) (marks) (256) with | Option.none => Option.none | Option.some next => publicationLinkageBitChunks (indices) ((offset + 256)) (lower) (next) (rest)))

@[expose] public def publicationLinkageBitBuckets : (indices : List (Nat)) -> (lower : Nat) -> (upper : Nat) -> (fuel : Nat) -> Bool
  | _indices, lower, upper, Nat.zero => (Nat.ble (upper) (lower))
  | indices, lower, upper, Nat.succ rest => (if (Nat.ble (upper) (lower)) then true else (match publicationLinkageBitChunks (indices) (0) (lower) (({ word0 := (0 : UInt64), word1 := (0 : UInt64), word2 := (0 : UInt64), word3 := (0 : UInt64) } : PublicationBitMarks)) (256) with | Option.none => false | Option.some _ => publicationLinkageBitBuckets (indices) ((lower + 256)) (upper) (rest)))

@[expose] public def publicationLinkageServicesPartition (services : PublicationServices) (records : PublicationRecords) : Bool := ((LexLeanRuntime.equal ((publicationLinkagePublicationServicesScan (services)).count) (publicationLinkagePublicationRecordsCount (records)) : Bool) && (match publicationLinkageCollectServiceChunks ((services).chunks) (records) (256) with | Option.none => false | Option.some indices => publicationLinkageBitBuckets (indices) (0) (publicationLinkagePublicationRecordsCount (records)) (256)))

@[expose] public def publicationLinkageControlsScan : (ids : PublicationIds) -> (records : PublicationRecords) -> (fuel : Nat) -> Bool
  | _ids, _records, Nat.zero => true
  | ids, records, Nat.succ rest => (match publicationLinkagePublicationIdsAt (ids) ((LexLeanRuntime.subtract (65535) (rest) : Nat)) with | Option.none => true | Option.some control => (match publicationLinkagePublicationRecordsAt (records) ((LexLeanRuntime.subtract (65535) (rest) : Nat)) with | Option.none => false | Option.some row => ((LexLeanRuntime.equal (control) ((row).id) : Bool) && (publicationLinkageControlsScan (ids) (records) (rest) && true))))

@[expose] public def publicationLinkageControlsPartition (ids : PublicationIds) (records : PublicationRecords) : Bool := ((LexLeanRuntime.equal (publicationLinkagePublicationIdsCount (ids)) (publicationLinkagePublicationRecordsCount (records)) : Bool) && (publicationLinkageControlsScan (ids) (records) (65536) && true))

@[expose] public def publicationLinkageManifestScan : (files : PublicationFiles) -> (manifest : ByteArray) -> (fuel : Nat) -> Bool
  | _files, _manifest, Nat.zero => false
  | files, manifest, Nat.succ rest => (match publicationLinkagePublicationFilesAt (files) ((LexLeanRuntime.subtract (65535) (rest) : Nat)) with | Option.none => false | Option.some item => (match (LexLeanRuntime.equal ((item).path) ("manifest.json") : Bool) with | Bool.false => publicationLinkageManifestScan (files) (manifest) (rest) | Bool.true => (LexLeanRuntime.equal ((item).digest) (manifest) : Bool)))

@[expose] public def publicationLinkageRequirementPrefixRows : (items : List (PublicationRequirement)) -> (member : PublicationMember) -> (remaining : Nat) -> (fuel : Nat) -> Bool
  | _items, _member, remaining, Nat.zero => (LexLeanRuntime.equal (remaining) (0) : Bool)
  | items, member, remaining, Nat.succ rest => (if (LexLeanRuntime.equal (remaining) (0) : Bool) then true else (match items with | List.nil => false | List.cons head tail => ((!publicationLinkageMemberEqual (member) ((head).member)) && publicationLinkageRequirementPrefixRows (tail) (member) ((LexLeanRuntime.subtract (remaining) (1) : Nat)) (rest))))

@[expose] public def publicationLinkageRequirementPrefixChunks : (items : List (PublicationRequirementsChunk)) -> (member : PublicationMember) -> (remaining : Nat) -> (fuel : Nat) -> Bool
  | _items, _member, remaining, Nat.zero => (LexLeanRuntime.equal (remaining) (0) : Bool)
  | items, member, remaining, Nat.succ rest => (if (LexLeanRuntime.equal (remaining) (0) : Bool) then true else (match items with | List.nil => false | List.cons head tail => (if (Nat.ble (remaining) (64)) then publicationLinkageRequirementPrefixRows ((head).entries) (member) (remaining) (64) else (publicationLinkageRequirementPrefixRows ((head).entries) (member) (64) (64) && publicationLinkageRequirementPrefixChunks (tail) (member) ((LexLeanRuntime.subtract (remaining) (64) : Nat)) (rest)))))

@[expose] public def publicationLinkageRequirementMemberAbsent (requirements : PublicationRequirements) (member : PublicationMember) (fuel : Nat) : Bool := publicationLinkageRequirementPrefixChunks ((requirements).chunks) (member) (fuel) (64)

@[expose] public def publicationLinkageRequirementKind (value : PublicationRequirementValue) (assurance : PrismPM.Production.PublicationAdmission.V1.PublicationAssurance) : Bool := (match value with | PublicationRequirementValue.Proof _ => PrismPM.Production.PublicationAdmission.V1.publicationPublicationAssuranceEqual (assurance) (PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.SourceProof) | PublicationRequirementValue.Execution _ => (!(match assurance with | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.SourceProof => true | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.HumanAssessment => true | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.OperationalAssessment => true | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.Oracle => false | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.ReproducibleBuild => false | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.BrowserJourney => false | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.FaultRecovery => false | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.LiveJourney => false)) | PublicationRequirementValue.Assessment _ => (match assurance with | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.HumanAssessment => true | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.OperationalAssessment => true | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.SourceProof => false | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.Oracle => false | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.ReproducibleBuild => false | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.BrowserJourney => false | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.FaultRecovery => false | PrismPM.Production.PublicationAdmission.V1.PublicationAssurance.LiveJourney => false))

@[expose] public def publicationLinkageRequirementsMatch : (requirements : PublicationRequirements) -> (obligations : PrismPM.Production.PublicationAdmission.V1.PublicationObligations) -> (fuel : Nat) -> Bool
  | _requirements, _obligations, Nat.zero => true
  | requirements, obligations, Nat.succ rest => (match publicationLinkagePublicationRequirementsAt (requirements) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) with | Option.none => (!PrismPM.Production.PublicationAdmission.V1.publicationPublicationObligationsHas (obligations) ((LexLeanRuntime.subtract (4095) (rest) : Nat))) | Option.some requirement => (match PrismPM.Production.PublicationAdmission.V1.publicationPublicationObligationsAt (obligations) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) with | Option.none => false | Option.some obligation => ((LexLeanRuntime.equal ((requirement).obligation) ((obligation).id) : Bool) && (publicationLinkageRequirementMemberAbsent (requirements) ((requirement).member) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) && (publicationLinkageRequirementKind ((requirement).requirement) ((obligation).assurance) && (publicationLinkageRequirementsMatch (requirements) (obligations) (rest) && true))))))

@[expose] public def publicationLinkageValidate (closure : PublicationClosure) (capture : PublicationCapture) : Option (PublicationLinkageError) := (match publicationLinkageMetadataValid (closure) (capture) with | Bool.false => Option.some (PublicationLinkageError.InvalidMetadata) | Bool.true => (match (publicationLinkageMemberEqual ((closure).system) (((capture).sourceLink).systemMember) && ((LexLeanRuntime.equal ((closure).target) (((capture).sourceLink).target) : Bool) && true)) with | Bool.false => Option.some (PublicationLinkageError.SourceMismatch) | Bool.true => (match (publicationLinkageServicesPartition ((closure).services) ((capture).components) && (publicationLinkageControlsPartition ((closure).controls) ((capture).controls) && (publicationLinkageManifestScan ((capture).verificationFiles) ((capture).verificationManifest) (65536) && true))) with | Bool.false => Option.some (PublicationLinkageError.InventoryMismatch) | Bool.true => (match publicationLinkageRequirementsMatch ((closure).requirements) (((closure).declaration).obligations) (4096) with | Bool.false => Option.some (PublicationLinkageError.RequirementMismatch) | Bool.true => Option.none))))

end PrismPM.Production.PublicationAdmission.LinkageV1
