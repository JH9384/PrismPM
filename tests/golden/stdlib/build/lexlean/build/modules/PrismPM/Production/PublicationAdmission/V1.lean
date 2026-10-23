module
public import Init
public import LexLeanRuntime.Portable
public import PrismPM.Foundation.Bytes
set_option autoImplicit false
set_option maxRecDepth 100000
set_option maxHeartbeats 1000000000
set_option linter.constructorNameAsVariable false
namespace PrismPM.Production.PublicationAdmission.V1

public inductive PublicationPhase where
  | Unready
  | ProducerReady
  | DeploymentAuthorized
  | Accepted

public inductive PublicationMoment where
  | PrePublication
  | DeploymentOnly

public inductive PublicationAssurance where
  | SourceProof
  | Oracle
  | ReproducibleBuild
  | BrowserJourney
  | FaultRecovery
  | HumanAssessment
  | LiveJourney
  | OperationalAssessment

public inductive PublicationOutcome where
  | Satisfied
  | Rejected
  | Unknown

public inductive PublicationTrust where
  | Candidate
  | Accepted
  | Rejected
  | Unknown

public inductive PublicationRefKind where
  | ProtectedBranch
  | ProtectedTag

public structure PublicationTarget where
  url : String
  publisher : String
  environment : String
  adapter : ByteArray

public structure PublicationObligation where
  id : Nat
  moment : PublicationMoment
  assurance : PublicationAssurance
  authority : ByteArray
  scope : ByteArray

public structure PublicationObligationChunk where
  items : List (PublicationObligation)

public structure PublicationObligations where
  chunks : List (PublicationObligationChunk)

public structure PublicationDeclaration where
  stage : String
  policy : ByteArray
  target : PublicationTarget
  clock : ByteArray
  clockAuthority : ByteArray
  trustAuthority : ByteArray
  decisionAuthority : ByteArray
  refAuthority : ByteArray
  deploymentAuthority : ByteArray
  integrityAuthority : ByteArray
  minimumTrust : PublicationTrust
  refKind : PublicationRefKind
  obligations : PublicationObligations

public structure PublicationSubject where
  producer : String
  source : ByteArray
  release : ByteArray
  model : ByteArray
  build : ByteArray
  services : ByteArray
  controls : ByteArray
  dependencies : ByteArray
  sdk : ByteArray
  compiler : ByteArray
  runtime : ByteArray
  oracles : ByteArray
  tree : ByteArray

public structure PublicationContext where
  declaration : PublicationDeclaration
  declarationIdentity : ByteArray
  subject : PublicationSubject
  «instance» : ByteArray
  publisherRevision : ByteArray
  publisherRef : String
  digest : ByteArray

public structure PublicationClock where
  domain : ByteArray
  authority : ByteArray
  receipt : ByteArray
  tick : Nat

public structure PublicationFact where
  context : ByteArray
  obligation : Nat
  assurance : PublicationAssurance
  authority : ByteArray
  scope : ByteArray
  evidence : ByteArray
  deployment : Option (ByteArray)
  «from» : Nat
  «until» : Nat
  outcome : PublicationOutcome

public structure PublicationFactChunk where
  items : List (PublicationFact)

public structure PublicationFacts where
  chunks : List (PublicationFactChunk)

public structure PublicationTrustFact where
  context : ByteArray
  authority : ByteArray
  receipt : ByteArray
  status : PublicationTrust
  «from» : Nat
  «until» : Nat

public structure PublicationDecision where
  context : ByteArray
  authority : ByteArray
  refAuthority : ByteArray
  decision : ByteArray
  refEvidence : ByteArray
  ready : ByteArray
  publisherRevision : ByteArray
  publisherRef : String
  refKind : PublicationRefKind
  «from» : Nat
  «until» : Nat
  outcome : PublicationOutcome

public structure PublicationDeployment where
  context : ByteArray
  decision : ByteArray
  authority : ByteArray
  receipt : ByteArray
  publisherRevision : ByteArray
  deploymentRevision : ByteArray
  deploymentId : String
  observed : Nat
  «from» : Nat
  «until» : Nat

public structure PublicationIntegrity where
  context : ByteArray
  authority : ByteArray
  receipt : ByteArray
  release : ByteArray
  model : ByteArray
  build : ByteArray
  tree : ByteArray
  url : String
  deployment : ByteArray
  observed : Nat
  «from» : Nat
  «until» : Nat

public structure PublicationState where
  context : PublicationContext
  revision : Nat
  phase : PublicationPhase
  clock : PublicationClock
  readyAt : Nat
  authorizedAt : Nat
  observedAt : Nat
  trust : Option (PublicationTrustFact)
  readiness : PublicationFacts
  ready : Option (ByteArray)
  decision : Option (PublicationDecision)
  deployment : Option (PublicationDeployment)
  integrity : Option (PublicationIntegrity)
  live : PublicationFacts

public inductive PublicationOperation where
  | Prepare (_ : PublicationTrustFact) (_ : PublicationFacts) (_ : ByteArray)
  | Authorize (_ : PublicationDecision)
  | Observe (_ : PublicationDeployment) (_ : PublicationIntegrity)
  | Accept (_ : PublicationFacts)

public inductive PublicationError where
  | BadDeclaration
  | BadSubject
  | BadContext
  | BadClock
  | BadState
  | ContextChanged
  | StaleRevision
  | ClockRollback
  | WrongPhase
  | BadTrust
  | IncompleteReadiness
  | BadAuthorization
  | BadDeployment
  | BadIntegrity
  | IncompleteLiveAssessment

@[expose] public def publicationPublicationPhaseEqual (left : PublicationPhase) (right : PublicationPhase) : Bool := (match left with | PublicationPhase.Unready => (match right with | PublicationPhase.Unready => true | PublicationPhase.ProducerReady => false | PublicationPhase.DeploymentAuthorized => false | PublicationPhase.Accepted => false) | PublicationPhase.ProducerReady => (match right with | PublicationPhase.Unready => false | PublicationPhase.ProducerReady => true | PublicationPhase.DeploymentAuthorized => false | PublicationPhase.Accepted => false) | PublicationPhase.DeploymentAuthorized => (match right with | PublicationPhase.Unready => false | PublicationPhase.ProducerReady => false | PublicationPhase.DeploymentAuthorized => true | PublicationPhase.Accepted => false) | PublicationPhase.Accepted => (match right with | PublicationPhase.Unready => false | PublicationPhase.ProducerReady => false | PublicationPhase.DeploymentAuthorized => false | PublicationPhase.Accepted => true))

@[expose] public def publicationPublicationMomentEqual (left : PublicationMoment) (right : PublicationMoment) : Bool := (match left with | PublicationMoment.PrePublication => (match right with | PublicationMoment.PrePublication => true | PublicationMoment.DeploymentOnly => false) | PublicationMoment.DeploymentOnly => (match right with | PublicationMoment.PrePublication => false | PublicationMoment.DeploymentOnly => true))

@[expose] public def publicationPublicationAssuranceEqual (left : PublicationAssurance) (right : PublicationAssurance) : Bool := (match left with | PublicationAssurance.SourceProof => (match right with | PublicationAssurance.SourceProof => true | PublicationAssurance.Oracle => false | PublicationAssurance.ReproducibleBuild => false | PublicationAssurance.BrowserJourney => false | PublicationAssurance.FaultRecovery => false | PublicationAssurance.HumanAssessment => false | PublicationAssurance.LiveJourney => false | PublicationAssurance.OperationalAssessment => false) | PublicationAssurance.Oracle => (match right with | PublicationAssurance.SourceProof => false | PublicationAssurance.Oracle => true | PublicationAssurance.ReproducibleBuild => false | PublicationAssurance.BrowserJourney => false | PublicationAssurance.FaultRecovery => false | PublicationAssurance.HumanAssessment => false | PublicationAssurance.LiveJourney => false | PublicationAssurance.OperationalAssessment => false) | PublicationAssurance.ReproducibleBuild => (match right with | PublicationAssurance.SourceProof => false | PublicationAssurance.Oracle => false | PublicationAssurance.ReproducibleBuild => true | PublicationAssurance.BrowserJourney => false | PublicationAssurance.FaultRecovery => false | PublicationAssurance.HumanAssessment => false | PublicationAssurance.LiveJourney => false | PublicationAssurance.OperationalAssessment => false) | PublicationAssurance.BrowserJourney => (match right with | PublicationAssurance.SourceProof => false | PublicationAssurance.Oracle => false | PublicationAssurance.ReproducibleBuild => false | PublicationAssurance.BrowserJourney => true | PublicationAssurance.FaultRecovery => false | PublicationAssurance.HumanAssessment => false | PublicationAssurance.LiveJourney => false | PublicationAssurance.OperationalAssessment => false) | PublicationAssurance.FaultRecovery => (match right with | PublicationAssurance.SourceProof => false | PublicationAssurance.Oracle => false | PublicationAssurance.ReproducibleBuild => false | PublicationAssurance.BrowserJourney => false | PublicationAssurance.FaultRecovery => true | PublicationAssurance.HumanAssessment => false | PublicationAssurance.LiveJourney => false | PublicationAssurance.OperationalAssessment => false) | PublicationAssurance.HumanAssessment => (match right with | PublicationAssurance.SourceProof => false | PublicationAssurance.Oracle => false | PublicationAssurance.ReproducibleBuild => false | PublicationAssurance.BrowserJourney => false | PublicationAssurance.FaultRecovery => false | PublicationAssurance.HumanAssessment => true | PublicationAssurance.LiveJourney => false | PublicationAssurance.OperationalAssessment => false) | PublicationAssurance.LiveJourney => (match right with | PublicationAssurance.SourceProof => false | PublicationAssurance.Oracle => false | PublicationAssurance.ReproducibleBuild => false | PublicationAssurance.BrowserJourney => false | PublicationAssurance.FaultRecovery => false | PublicationAssurance.HumanAssessment => false | PublicationAssurance.LiveJourney => true | PublicationAssurance.OperationalAssessment => false) | PublicationAssurance.OperationalAssessment => (match right with | PublicationAssurance.SourceProof => false | PublicationAssurance.Oracle => false | PublicationAssurance.ReproducibleBuild => false | PublicationAssurance.BrowserJourney => false | PublicationAssurance.FaultRecovery => false | PublicationAssurance.HumanAssessment => false | PublicationAssurance.LiveJourney => false | PublicationAssurance.OperationalAssessment => true))

@[expose] public def publicationPublicationOutcomeEqual (left : PublicationOutcome) (right : PublicationOutcome) : Bool := (match left with | PublicationOutcome.Satisfied => (match right with | PublicationOutcome.Satisfied => true | PublicationOutcome.Rejected => false | PublicationOutcome.Unknown => false) | PublicationOutcome.Rejected => (match right with | PublicationOutcome.Satisfied => false | PublicationOutcome.Rejected => true | PublicationOutcome.Unknown => false) | PublicationOutcome.Unknown => (match right with | PublicationOutcome.Satisfied => false | PublicationOutcome.Rejected => false | PublicationOutcome.Unknown => true))

@[expose] public def publicationPublicationTrustEqual (left : PublicationTrust) (right : PublicationTrust) : Bool := (match left with | PublicationTrust.Candidate => (match right with | PublicationTrust.Candidate => true | PublicationTrust.Accepted => false | PublicationTrust.Rejected => false | PublicationTrust.Unknown => false) | PublicationTrust.Accepted => (match right with | PublicationTrust.Candidate => false | PublicationTrust.Accepted => true | PublicationTrust.Rejected => false | PublicationTrust.Unknown => false) | PublicationTrust.Rejected => (match right with | PublicationTrust.Candidate => false | PublicationTrust.Accepted => false | PublicationTrust.Rejected => true | PublicationTrust.Unknown => false) | PublicationTrust.Unknown => (match right with | PublicationTrust.Candidate => false | PublicationTrust.Accepted => false | PublicationTrust.Rejected => false | PublicationTrust.Unknown => true))

@[expose] public def publicationPublicationRefKindEqual (left : PublicationRefKind) (right : PublicationRefKind) : Bool := (match left with | PublicationRefKind.ProtectedBranch => (match right with | PublicationRefKind.ProtectedBranch => true | PublicationRefKind.ProtectedTag => false) | PublicationRefKind.ProtectedTag => (match right with | PublicationRefKind.ProtectedBranch => false | PublicationRefKind.ProtectedTag => true))

@[expose] public def publicationPublicationErrorEqual (left : PublicationError) (right : PublicationError) : Bool := (match left with | PublicationError.BadDeclaration => (match right with | PublicationError.BadDeclaration => true | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.BadSubject => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => true | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.BadContext => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => true | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.BadClock => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => true | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.BadState => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => true | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.ContextChanged => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => true | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.StaleRevision => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => true | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.ClockRollback => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => true | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.WrongPhase => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => true | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.BadTrust => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => true | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.IncompleteReadiness => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => true | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.BadAuthorization => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => true | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.BadDeployment => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => true | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => false) | PublicationError.BadIntegrity => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => true | PublicationError.IncompleteLiveAssessment => false) | PublicationError.IncompleteLiveAssessment => (match right with | PublicationError.BadDeclaration => false | PublicationError.BadSubject => false | PublicationError.BadContext => false | PublicationError.BadClock => false | PublicationError.BadState => false | PublicationError.ContextChanged => false | PublicationError.StaleRevision => false | PublicationError.ClockRollback => false | PublicationError.WrongPhase => false | PublicationError.BadTrust => false | PublicationError.IncompleteReadiness => false | PublicationError.BadAuthorization => false | PublicationError.BadDeployment => false | PublicationError.BadIntegrity => false | PublicationError.IncompleteLiveAssessment => true))

@[expose] public def publicationPublicationTargetEqual (left : PublicationTarget) (right : PublicationTarget) : Bool := ((LexLeanRuntime.equal ((left).url) ((right).url) : Bool) && ((LexLeanRuntime.equal ((left).publisher) ((right).publisher) : Bool) && ((LexLeanRuntime.equal ((left).environment) ((right).environment) : Bool) && ((LexLeanRuntime.equal ((left).adapter) ((right).adapter) : Bool) && true))))

@[expose] public def publicationPublicationObligationEqual (left : PublicationObligation) (right : PublicationObligation) : Bool := ((Nat.beq ((left).id) ((right).id)) && (publicationPublicationMomentEqual ((left).moment) ((right).moment) && (publicationPublicationAssuranceEqual ((left).assurance) ((right).assurance) && ((LexLeanRuntime.equal ((left).authority) ((right).authority) : Bool) && ((LexLeanRuntime.equal ((left).scope) ((right).scope) : Bool) && true)))))

@[expose] public def publicationPublicationSubjectEqual (left : PublicationSubject) (right : PublicationSubject) : Bool := ((LexLeanRuntime.equal ((left).producer) ((right).producer) : Bool) && ((LexLeanRuntime.equal ((left).source) ((right).source) : Bool) && ((LexLeanRuntime.equal ((left).release) ((right).release) : Bool) && ((LexLeanRuntime.equal ((left).model) ((right).model) : Bool) && ((LexLeanRuntime.equal ((left).build) ((right).build) : Bool) && ((LexLeanRuntime.equal ((left).services) ((right).services) : Bool) && ((LexLeanRuntime.equal ((left).controls) ((right).controls) : Bool) && ((LexLeanRuntime.equal ((left).dependencies) ((right).dependencies) : Bool) && ((LexLeanRuntime.equal ((left).sdk) ((right).sdk) : Bool) && ((LexLeanRuntime.equal ((left).compiler) ((right).compiler) : Bool) && ((LexLeanRuntime.equal ((left).runtime) ((right).runtime) : Bool) && ((LexLeanRuntime.equal ((left).oracles) ((right).oracles) : Bool) && ((LexLeanRuntime.equal ((left).tree) ((right).tree) : Bool) && true)))))))))))))

@[expose] public def publicationPublicationObligationsRowAt : (items : List (PublicationObligation)) -> (index : Nat) -> Option (PublicationObligation)
  | List.nil, _index => Option.none
  | List.cons head tail, index => (match (Nat.beq (index) (0)) with | Bool.false => publicationPublicationObligationsRowAt (tail) ((LexLeanRuntime.subtract (index) (1) : Nat)) | Bool.true => Option.some (head))

@[expose] public def publicationPublicationObligationsChunkAt : (chunks : List (PublicationObligationChunk)) -> (index : Nat) -> Option (PublicationObligation)
  | List.nil, _index => Option.none
  | List.cons head tail, index => (match (Nat.blt (index) (64)) with | Bool.false => publicationPublicationObligationsChunkAt (tail) ((LexLeanRuntime.subtract (index) (64) : Nat)) | Bool.true => publicationPublicationObligationsRowAt ((head).items) (index))

@[expose] public def publicationPublicationObligationsAt (items : PublicationObligations) (index : Nat) : Option (PublicationObligation) := publicationPublicationObligationsChunkAt ((items).chunks) (index)

@[expose] public def publicationPublicationObligationsHas (items : PublicationObligations) (index : Nat) : Bool := (match publicationPublicationObligationsAt (items) (index) with | Option.none => false | Option.some _ => true)

@[expose] public def publicationObligationAtEqual (left : PublicationObligations) (right : PublicationObligations) (index : Nat) : Bool := (match publicationPublicationObligationsAt (left) (index) with | Option.none => (!publicationPublicationObligationsHas (right) (index)) | Option.some head => (match publicationPublicationObligationsAt (right) (index) with | Option.none => false | Option.some other => publicationPublicationObligationEqual (head) (other)))

@[expose] public def publicationObligationsEqual : (left : PublicationObligations) -> (right : PublicationObligations) -> (fuel : Nat) -> Bool
  | left, right, Nat.zero => ((!publicationPublicationObligationsHas (left) (4096)) && ((!publicationPublicationObligationsHas (right) (4096)) && true))
  | left, right, Nat.succ rest => (publicationObligationAtEqual (left) (right) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) && ((match publicationPublicationObligationsHas (left) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) with | Bool.false => true | Bool.true => publicationObligationsEqual (left) (right) (rest)) && true))

@[expose] public def publicationPublicationDeclarationEqual (left : PublicationDeclaration) (right : PublicationDeclaration) : Bool := ((LexLeanRuntime.equal ((left).stage) ((right).stage) : Bool) && ((LexLeanRuntime.equal ((left).policy) ((right).policy) : Bool) && (publicationPublicationTargetEqual ((left).target) ((right).target) && ((LexLeanRuntime.equal ((left).clock) ((right).clock) : Bool) && ((LexLeanRuntime.equal ((left).clockAuthority) ((right).clockAuthority) : Bool) && ((LexLeanRuntime.equal ((left).trustAuthority) ((right).trustAuthority) : Bool) && ((LexLeanRuntime.equal ((left).decisionAuthority) ((right).decisionAuthority) : Bool) && ((LexLeanRuntime.equal ((left).refAuthority) ((right).refAuthority) : Bool) && ((LexLeanRuntime.equal ((left).deploymentAuthority) ((right).deploymentAuthority) : Bool) && ((LexLeanRuntime.equal ((left).integrityAuthority) ((right).integrityAuthority) : Bool) && (publicationPublicationTrustEqual ((left).minimumTrust) ((right).minimumTrust) && (publicationPublicationRefKindEqual ((left).refKind) ((right).refKind) && (publicationObligationsEqual ((left).obligations) ((right).obligations) (4096) && true)))))))))))))

@[expose] public def publicationPublicationContextEqual (left : PublicationContext) (right : PublicationContext) : Bool := (publicationPublicationDeclarationEqual ((left).declaration) ((right).declaration) && ((LexLeanRuntime.equal ((left).declarationIdentity) ((right).declarationIdentity) : Bool) && (publicationPublicationSubjectEqual ((left).subject) ((right).subject) && ((LexLeanRuntime.equal ((left).«instance») ((right).«instance») : Bool) && ((LexLeanRuntime.equal ((left).publisherRevision) ((right).publisherRevision) : Bool) && ((LexLeanRuntime.equal ((left).publisherRef) ((right).publisherRef) : Bool) && ((LexLeanRuntime.equal ((left).digest) ((right).digest) : Bool) && true)))))))

@[expose] public def publicationPublicationClockEqual (left : PublicationClock) (right : PublicationClock) : Bool := ((LexLeanRuntime.equal ((left).domain) ((right).domain) : Bool) && ((LexLeanRuntime.equal ((left).authority) ((right).authority) : Bool) && ((LexLeanRuntime.equal ((left).receipt) ((right).receipt) : Bool) && ((Nat.beq ((left).tick) ((right).tick)) && true))))

@[expose] public def publicationPublicationTrustFactEqual (left : PublicationTrustFact) (right : PublicationTrustFact) : Bool := ((LexLeanRuntime.equal ((left).context) ((right).context) : Bool) && ((LexLeanRuntime.equal ((left).authority) ((right).authority) : Bool) && ((LexLeanRuntime.equal ((left).receipt) ((right).receipt) : Bool) && (publicationPublicationTrustEqual ((left).status) ((right).status) && ((Nat.beq ((left).«from») ((right).«from»)) && ((Nat.beq ((left).«until») ((right).«until»)) && true))))))

@[expose] public def publicationPublicationDecisionEqual (left : PublicationDecision) (right : PublicationDecision) : Bool := ((LexLeanRuntime.equal ((left).context) ((right).context) : Bool) && ((LexLeanRuntime.equal ((left).authority) ((right).authority) : Bool) && ((LexLeanRuntime.equal ((left).refAuthority) ((right).refAuthority) : Bool) && ((LexLeanRuntime.equal ((left).decision) ((right).decision) : Bool) && ((LexLeanRuntime.equal ((left).refEvidence) ((right).refEvidence) : Bool) && ((LexLeanRuntime.equal ((left).ready) ((right).ready) : Bool) && ((LexLeanRuntime.equal ((left).publisherRevision) ((right).publisherRevision) : Bool) && ((LexLeanRuntime.equal ((left).publisherRef) ((right).publisherRef) : Bool) && (publicationPublicationRefKindEqual ((left).refKind) ((right).refKind) && ((Nat.beq ((left).«from») ((right).«from»)) && ((Nat.beq ((left).«until») ((right).«until»)) && (publicationPublicationOutcomeEqual ((left).outcome) ((right).outcome) && true))))))))))))

@[expose] public def publicationPublicationDeploymentEqual (left : PublicationDeployment) (right : PublicationDeployment) : Bool := ((LexLeanRuntime.equal ((left).context) ((right).context) : Bool) && ((LexLeanRuntime.equal ((left).decision) ((right).decision) : Bool) && ((LexLeanRuntime.equal ((left).authority) ((right).authority) : Bool) && ((LexLeanRuntime.equal ((left).receipt) ((right).receipt) : Bool) && ((LexLeanRuntime.equal ((left).publisherRevision) ((right).publisherRevision) : Bool) && ((LexLeanRuntime.equal ((left).deploymentRevision) ((right).deploymentRevision) : Bool) && ((LexLeanRuntime.equal ((left).deploymentId) ((right).deploymentId) : Bool) && ((Nat.beq ((left).observed) ((right).observed)) && ((Nat.beq ((left).«from») ((right).«from»)) && ((Nat.beq ((left).«until») ((right).«until»)) && true))))))))))

@[expose] public def publicationPublicationIntegrityEqual (left : PublicationIntegrity) (right : PublicationIntegrity) : Bool := ((LexLeanRuntime.equal ((left).context) ((right).context) : Bool) && ((LexLeanRuntime.equal ((left).authority) ((right).authority) : Bool) && ((LexLeanRuntime.equal ((left).receipt) ((right).receipt) : Bool) && ((LexLeanRuntime.equal ((left).release) ((right).release) : Bool) && ((LexLeanRuntime.equal ((left).model) ((right).model) : Bool) && ((LexLeanRuntime.equal ((left).build) ((right).build) : Bool) && ((LexLeanRuntime.equal ((left).tree) ((right).tree) : Bool) && ((LexLeanRuntime.equal ((left).url) ((right).url) : Bool) && ((LexLeanRuntime.equal ((left).deployment) ((right).deployment) : Bool) && ((Nat.beq ((left).observed) ((right).observed)) && ((Nat.beq ((left).«from») ((right).«from»)) && ((Nat.beq ((left).«until») ((right).«until»)) && true))))))))))))

@[expose] public def publicationEmptyPublicationObligation (items : List (PublicationObligation)) : Bool := (match items with | List.nil => true | List.cons _ _ => false)

@[expose] public def publicationEmptyPublicationObligationChunk (items : List (PublicationObligationChunk)) : Bool := (match items with | List.nil => true | List.cons _ _ => false)

@[expose] public def publicationEmptyPublicationFact (items : List (PublicationFact)) : Bool := (match items with | List.nil => true | List.cons _ _ => false)

@[expose] public def publicationEmptyPublicationFactChunk (items : List (PublicationFactChunk)) : Bool := (match items with | List.nil => true | List.cons _ _ => false)

@[expose] public def publicationFactsEmpty (items : PublicationFacts) : Bool := publicationEmptyPublicationFactChunk ((items).chunks)

@[expose] public def publicationPublicationObligationsRowsValid : (items : List (PublicationObligation)) -> (fuel : Nat) -> (full : Bool) -> Bool
  | items, Nat.zero, _full => publicationEmptyPublicationObligation (items)
  | items, Nat.succ rest, full => (match items with | List.nil => (!full) | List.cons _ tail => publicationPublicationObligationsRowsValid (tail) (rest) (full))

@[expose] public def publicationPublicationObligationsChunksValid : (chunks : List (PublicationObligationChunk)) -> (fuel : Nat) -> Bool
  | chunks, Nat.zero => publicationEmptyPublicationObligationChunk (chunks)
  | chunks, Nat.succ rest => (match chunks with | List.nil => true | List.cons head tail => ((!publicationEmptyPublicationObligation ((head).items)) && (publicationPublicationObligationsRowsValid ((head).items) (64) ((!publicationEmptyPublicationObligationChunk (tail))) && (publicationPublicationObligationsChunksValid (tail) (rest) && true))))

@[expose] public def publicationPublicationObligationsCanonical (items : PublicationObligations) : Bool := publicationPublicationObligationsChunksValid ((items).chunks) (64)

@[expose] public def publicationPublicationFactsRowsValid : (items : List (PublicationFact)) -> (fuel : Nat) -> (full : Bool) -> Bool
  | items, Nat.zero, _full => publicationEmptyPublicationFact (items)
  | items, Nat.succ rest, full => (match items with | List.nil => (!full) | List.cons _ tail => publicationPublicationFactsRowsValid (tail) (rest) (full))

@[expose] public def publicationPublicationFactsChunksValid : (chunks : List (PublicationFactChunk)) -> (fuel : Nat) -> Bool
  | chunks, Nat.zero => publicationEmptyPublicationFactChunk (chunks)
  | chunks, Nat.succ rest => (match chunks with | List.nil => true | List.cons head tail => ((!publicationEmptyPublicationFact ((head).items)) && (publicationPublicationFactsRowsValid ((head).items) (64) ((!publicationEmptyPublicationFactChunk (tail))) && (publicationPublicationFactsChunksValid (tail) (rest) && true))))

@[expose] public def publicationPublicationFactsCanonical (items : PublicationFacts) : Bool := publicationPublicationFactsChunksValid ((items).chunks) (64)

@[expose] public def publicationPublicationFactsRowAt : (items : List (PublicationFact)) -> (index : Nat) -> Option (PublicationFact)
  | List.nil, _index => Option.none
  | List.cons head tail, index => (match (Nat.beq (index) (0)) with | Bool.false => publicationPublicationFactsRowAt (tail) ((LexLeanRuntime.subtract (index) (1) : Nat)) | Bool.true => Option.some (head))

@[expose] public def publicationPublicationFactsChunkAt : (chunks : List (PublicationFactChunk)) -> (index : Nat) -> Option (PublicationFact)
  | List.nil, _index => Option.none
  | List.cons head tail, index => (match (Nat.blt (index) (64)) with | Bool.false => publicationPublicationFactsChunkAt (tail) ((LexLeanRuntime.subtract (index) (64) : Nat)) | Bool.true => publicationPublicationFactsRowAt ((head).items) (index))

@[expose] public def publicationPublicationFactsAt (items : PublicationFacts) (index : Nat) : Option (PublicationFact) := publicationPublicationFactsChunkAt ((items).chunks) (index)

@[expose] public def publicationPublicationFactsHas (items : PublicationFacts) (index : Nat) : Bool := (match publicationPublicationFactsAt (items) (index) with | Option.none => false | Option.some _ => true)

@[expose] public def publicationTargetValid (target : PublicationTarget) : Bool := (((Nat.blt (0) ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((target).url) : ByteArray)) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((target).url) : ByteArray)) : Nat)) (2048)) && true)) && (((Nat.blt (0) ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((target).publisher) : ByteArray)) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((target).publisher) : ByteArray)) : Nat)) (2048)) && true)) && (((Nat.blt (0) ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((target).environment) : ByteArray)) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((target).environment) : ByteArray)) : Nat)) (2048)) && true)) && ((Nat.beq ((LexLeanRuntime.length ((target).adapter) : Nat)) (32)) && true))))

@[expose] public def publicationObligationValid (item : PublicationObligation) : Bool := ((Nat.blt (0) ((item).id)) && ((Nat.ble ((item).id) (4294967295)) && ((Nat.beq ((LexLeanRuntime.length ((item).authority) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((item).scope) : Nat)) (32)) && ((match (item).moment with | PublicationMoment.PrePublication => (publicationPublicationAssuranceEqual ((item).assurance) (PublicationAssurance.SourceProof) || (publicationPublicationAssuranceEqual ((item).assurance) (PublicationAssurance.Oracle) || (publicationPublicationAssuranceEqual ((item).assurance) (PublicationAssurance.ReproducibleBuild) || (publicationPublicationAssuranceEqual ((item).assurance) (PublicationAssurance.BrowserJourney) || (publicationPublicationAssuranceEqual ((item).assurance) (PublicationAssurance.FaultRecovery) || (publicationPublicationAssuranceEqual ((item).assurance) (PublicationAssurance.HumanAssessment) || false)))))) | PublicationMoment.DeploymentOnly => (publicationPublicationAssuranceEqual ((item).assurance) (PublicationAssurance.HumanAssessment) || (publicationPublicationAssuranceEqual ((item).assurance) (PublicationAssurance.LiveJourney) || (publicationPublicationAssuranceEqual ((item).assurance) (PublicationAssurance.OperationalAssessment) || false)))) && true)))))

@[expose] public def publicationObligationAtValid (items : PublicationObligations) (index : Nat) : Bool := (match publicationPublicationObligationsAt (items) (index) with | Option.none => false | Option.some head => (publicationObligationValid (head) && ((match (Nat.beq (index) (0)) with | Bool.false => (match publicationPublicationObligationsAt (items) ((LexLeanRuntime.subtract (index) (1) : Nat)) with | Option.none => false | Option.some previous => (Nat.blt ((previous).id) ((head).id))) | Bool.true => true) && true)))

@[expose] public def publicationObligationsScan : (items : PublicationObligations) -> (fuel : Nat) -> Bool
  | items, Nat.zero => (!publicationPublicationObligationsHas (items) (4096))
  | items, Nat.succ rest => (match publicationPublicationObligationsHas (items) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) with | Bool.false => true | Bool.true => (publicationObligationAtValid (items) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) && (publicationObligationsScan (items) (rest) && true)))

@[expose] public def publicationObligationsValid (items : PublicationObligations) (previous : Nat) (fuel : Nat) : Bool := ((Nat.beq (previous) (0)) && ((Nat.beq (fuel) (4096)) && (publicationPublicationObligationsCanonical (items) && (publicationObligationsScan (items) (fuel) && true))))

@[expose] public def publicationMomentAt (items : PublicationObligations) (index : Nat) (moment : PublicationMoment) : Bool := (match publicationPublicationObligationsAt (items) (index) with | Option.none => false | Option.some head => publicationPublicationMomentEqual ((head).moment) (moment))

@[expose] public def publicationMomentScan : (items : PublicationObligations) -> (moment : PublicationMoment) -> (fuel : Nat) -> Bool
  | _items, _moment, Nat.zero => false
  | items, moment, Nat.succ rest => (publicationPublicationObligationsHas (items) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) && ((publicationMomentAt (items) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) (moment) || (publicationMomentScan (items) (moment) (rest) || false)) && true))

@[expose] public def publicationMomentPresent (items : PublicationObligations) (moment : PublicationMoment) : Bool := publicationMomentScan (items) (moment) (4096)

@[expose] public def publicationDeclarationValid (declaration : PublicationDeclaration) : Bool := (((Nat.blt (0) ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((declaration).stage) : ByteArray)) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((declaration).stage) : ByteArray)) : Nat)) (2048)) && true)) && (publicationTargetValid ((declaration).target) && ((Nat.beq ((LexLeanRuntime.length ((declaration).policy) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((declaration).clock) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((declaration).clockAuthority) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((declaration).trustAuthority) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((declaration).decisionAuthority) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((declaration).refAuthority) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((declaration).deploymentAuthority) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((declaration).integrityAuthority) : Nat)) (32)) && ((publicationPublicationTrustEqual ((declaration).minimumTrust) (PublicationTrust.Candidate) || (publicationPublicationTrustEqual ((declaration).minimumTrust) (PublicationTrust.Accepted) || false)) && (publicationObligationsValid ((declaration).obligations) (0) (4096) && (publicationMomentPresent ((declaration).obligations) (PublicationMoment.PrePublication) && (publicationMomentPresent ((declaration).obligations) (PublicationMoment.DeploymentOnly) && true))))))))))))))

@[expose] public def publicationSubjectValid (subject : PublicationSubject) : Bool := (((Nat.blt (0) ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((subject).producer) : ByteArray)) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((subject).producer) : ByteArray)) : Nat)) (2048)) && true)) && ((Nat.beq ((LexLeanRuntime.length ((subject).source) : Nat)) (20)) && ((Nat.beq ((LexLeanRuntime.length ((subject).release) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).model) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).build) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).services) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).controls) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).dependencies) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).sdk) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).compiler) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).runtime) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).oracles) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((subject).tree) : Nat)) (32)) && true)))))))))))))

@[expose] public def publicationContextValid (context : PublicationContext) : Bool := (publicationDeclarationValid ((context).declaration) && (publicationSubjectValid ((context).subject) && ((Nat.beq ((LexLeanRuntime.length ((context).declarationIdentity) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((context).«instance») : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((context).digest) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((context).publisherRevision) : Nat)) (20)) && (((Nat.blt (0) ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((context).publisherRef) : ByteArray)) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((context).publisherRef) : ByteArray)) : Nat)) (2048)) && true)) && true)))))))

@[expose] public def publicationClockValid (context : PublicationContext) (clock : PublicationClock) : Bool := ((LexLeanRuntime.equal ((clock).domain) (((context).declaration).clock) : Bool) && ((LexLeanRuntime.equal ((clock).authority) (((context).declaration).clockAuthority) : Bool) && ((Nat.beq ((LexLeanRuntime.length ((clock).receipt) : Nat)) (32)) && ((Nat.ble ((clock).tick) (4294967295)) && true))))

@[expose] public def publicationTrustValid (context : PublicationContext) (fact : PublicationTrustFact) (now : Nat) : Bool := ((LexLeanRuntime.equal ((fact).context) ((context).digest) : Bool) && ((LexLeanRuntime.equal ((fact).authority) (((context).declaration).trustAuthority) : Bool) && ((Nat.beq ((LexLeanRuntime.length ((fact).receipt) : Nat)) (32)) && (((Nat.ble ((fact).«from») (now)) && ((Nat.ble (now) ((fact).«until»)) && ((Nat.ble ((fact).«until») (4294967295)) && true))) && ((publicationPublicationTrustEqual ((fact).status) (PublicationTrust.Accepted) || ((publicationPublicationTrustEqual ((fact).status) (PublicationTrust.Candidate) && (publicationPublicationTrustEqual (((context).declaration).minimumTrust) (PublicationTrust.Candidate) && true)) || false)) && true)))))

@[expose] public def publicationOptionalDigestEqual (left : Option (ByteArray)) (right : Option (ByteArray)) : Bool := (match left with | Option.none => (match right with | Option.none => true | Option.some _ => false) | Option.some leftValue => (match right with | Option.none => false | Option.some rightValue => ((Nat.beq ((LexLeanRuntime.length (leftValue) : Nat)) (32)) && ((LexLeanRuntime.equal (leftValue) (rightValue) : Bool) && true))))

@[expose] public def publicationFactValid (context : PublicationContext) (obligation : PublicationObligation) (fact : PublicationFact) (deployment : Option (ByteArray)) (now : Nat) : Bool := ((LexLeanRuntime.equal ((fact).context) ((context).digest) : Bool) && ((Nat.beq ((fact).obligation) ((obligation).id)) && (publicationPublicationAssuranceEqual ((fact).assurance) ((obligation).assurance) && (publicationOptionalDigestEqual ((fact).deployment) (deployment) && ((LexLeanRuntime.equal ((fact).authority) ((obligation).authority) : Bool) && ((LexLeanRuntime.equal ((fact).scope) ((obligation).scope) : Bool) && ((Nat.beq ((LexLeanRuntime.length ((fact).evidence) : Nat)) (32)) && (((Nat.ble ((fact).«from») (now)) && ((Nat.ble (now) ((fact).«until»)) && ((Nat.ble ((fact).«until») (4294967295)) && true))) && (publicationPublicationOutcomeEqual ((fact).outcome) (PublicationOutcome.Satisfied) && true)))))))))

@[expose] public def publicationFactAtValid (context : PublicationContext) (obligations : PublicationObligations) (facts : PublicationFacts) (deployment : Option (ByteArray)) (now : Nat) (obligationIndex : Nat) (factIndex : Nat) : Bool := (match publicationPublicationObligationsAt (obligations) (obligationIndex) with | Option.none => false | Option.some head => (match publicationPublicationFactsAt (facts) (factIndex) with | Option.none => false | Option.some fact => publicationFactValid (context) (head) (fact) (deployment) (now)))

@[expose] public def publicationFactsScan : (context : PublicationContext) -> (obligations : PublicationObligations) -> (facts : PublicationFacts) -> (moment : PublicationMoment) -> (deployment : Option (ByteArray)) -> (now : Nat) -> (fuel : Nat) -> (factFuel : Nat) -> Bool
  | _context, _obligations, facts, _moment, _deployment, _now, Nat.zero, factFuel => (!publicationPublicationFactsHas (facts) ((LexLeanRuntime.subtract (4096) (factFuel) : Nat)))
  | context, obligations, facts, moment, deployment, now, Nat.succ rest, factFuel => (match publicationPublicationObligationsHas (obligations) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) with | Bool.false => (!publicationPublicationFactsHas (facts) ((LexLeanRuntime.subtract (4096) (factFuel) : Nat))) | Bool.true => (match publicationMomentAt (obligations) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) (moment) with | Bool.false => publicationFactsScan (context) (obligations) (facts) (moment) (deployment) (now) (rest) (factFuel) | Bool.true => ((Nat.blt (0) (factFuel)) && (publicationFactAtValid (context) (obligations) (facts) (deployment) (now) ((LexLeanRuntime.subtract (4095) (rest) : Nat)) ((LexLeanRuntime.subtract (4096) (factFuel) : Nat)) && (publicationFactsScan (context) (obligations) (facts) (moment) (deployment) (now) (rest) ((LexLeanRuntime.subtract (factFuel) (1) : Nat)) && true)))))

@[expose] public def publicationFactsComplete (context : PublicationContext) (obligations : PublicationObligations) (facts : PublicationFacts) (moment : PublicationMoment) (deployment : Option (ByteArray)) (now : Nat) : Bool := (publicationPublicationFactsCanonical (facts) && (publicationFactsScan (context) (obligations) (facts) (moment) (deployment) (now) (4096) (4096) && true))

@[expose] public def publicationDecisionValid (context : PublicationContext) (ready : ByteArray) (decision : PublicationDecision) (now : Nat) : Bool := ((LexLeanRuntime.equal ((decision).context) ((context).digest) : Bool) && ((LexLeanRuntime.equal ((decision).authority) (((context).declaration).decisionAuthority) : Bool) && ((LexLeanRuntime.equal ((decision).refAuthority) (((context).declaration).refAuthority) : Bool) && ((Nat.beq ((LexLeanRuntime.length ((decision).decision) : Nat)) (32)) && ((Nat.beq ((LexLeanRuntime.length ((decision).refEvidence) : Nat)) (32)) && ((LexLeanRuntime.equal ((decision).ready) (ready) : Bool) && ((LexLeanRuntime.equal ((decision).publisherRevision) ((context).publisherRevision) : Bool) && ((LexLeanRuntime.equal ((decision).publisherRef) ((context).publisherRef) : Bool) && (publicationPublicationRefKindEqual ((decision).refKind) (((context).declaration).refKind) && (((Nat.ble ((decision).«from») (now)) && ((Nat.ble (now) ((decision).«until»)) && ((Nat.ble ((decision).«until») (4294967295)) && true))) && (publicationPublicationOutcomeEqual ((decision).outcome) (PublicationOutcome.Satisfied) && true)))))))))))

@[expose] public def publicationDeploymentValid (context : PublicationContext) (decision : PublicationDecision) (deployment : PublicationDeployment) (now : Nat) : Bool := ((LexLeanRuntime.equal ((deployment).context) ((context).digest) : Bool) && ((LexLeanRuntime.equal ((deployment).decision) ((decision).decision) : Bool) && ((LexLeanRuntime.equal ((deployment).authority) (((context).declaration).deploymentAuthority) : Bool) && ((Nat.beq ((LexLeanRuntime.length ((deployment).receipt) : Nat)) (32)) && ((LexLeanRuntime.equal ((deployment).publisherRevision) ((context).publisherRevision) : Bool) && ((Nat.beq ((LexLeanRuntime.length ((deployment).deploymentRevision) : Nat)) (20)) && (((Nat.blt (0) ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((deployment).deploymentId) : ByteArray)) : Nat))) && ((Nat.ble ((LexLeanRuntime.length ((LexLeanRuntime.utf8Encode ((deployment).deploymentId) : ByteArray)) : Nat)) (2048)) && true)) && ((Nat.ble ((deployment).observed) (now)) && (((Nat.ble ((deployment).«from») ((deployment).observed)) && ((Nat.ble ((deployment).observed) ((deployment).«until»)) && ((Nat.ble ((deployment).«until») (4294967295)) && true))) && (((Nat.ble ((deployment).«from») (now)) && ((Nat.ble (now) ((deployment).«until»)) && ((Nat.ble ((deployment).«until») (4294967295)) && true))) && true))))))))))

@[expose] public def publicationIntegrityValid (context : PublicationContext) (deployment : PublicationDeployment) (integrity : PublicationIntegrity) (now : Nat) : Bool := ((LexLeanRuntime.equal ((integrity).context) ((context).digest) : Bool) && ((LexLeanRuntime.equal ((integrity).authority) (((context).declaration).integrityAuthority) : Bool) && ((Nat.beq ((LexLeanRuntime.length ((integrity).receipt) : Nat)) (32)) && ((LexLeanRuntime.equal ((integrity).deployment) ((deployment).receipt) : Bool) && ((Nat.ble ((deployment).observed) ((integrity).observed)) && ((Nat.ble ((integrity).observed) (now)) && (((Nat.ble ((integrity).«from») ((integrity).observed)) && ((Nat.ble ((integrity).observed) ((integrity).«until»)) && ((Nat.ble ((integrity).«until») (4294967295)) && true))) && ((LexLeanRuntime.equal ((integrity).release) (((context).subject).release) : Bool) && ((LexLeanRuntime.equal ((integrity).model) (((context).subject).model) : Bool) && ((LexLeanRuntime.equal ((integrity).build) (((context).subject).build) : Bool) && ((LexLeanRuntime.equal ((integrity).tree) (((context).subject).tree) : Bool) && ((LexLeanRuntime.equal ((integrity).url) ((((context).declaration).target).url) : Bool) && (((Nat.ble ((integrity).«from») (now)) && ((Nat.ble (now) ((integrity).«until»)) && ((Nat.ble ((integrity).«until») (4294967295)) && true))) && true)))))))))))))

@[expose] public def publicationReadyStateValid (state : PublicationState) (now : Nat) : Bool := ((Nat.ble ((state).readyAt) (now)) && ((match (state).trust with | Option.none => false | Option.some trust => (publicationTrustValid ((state).context) (trust) (now) && (publicationTrustValid ((state).context) (trust) ((state).readyAt) && true))) && (publicationFactsComplete ((state).context) ((((state).context).declaration).obligations) ((state).readiness) (PublicationMoment.PrePublication) (Option.none) (now) && (publicationFactsComplete ((state).context) ((((state).context).declaration).obligations) ((state).readiness) (PublicationMoment.PrePublication) (Option.none) ((state).readyAt) && ((match (state).ready with | Option.none => false | Option.some ready => (Nat.beq ((LexLeanRuntime.length (ready) : Nat)) (32))) && true)))))

@[expose] public def publicationAuthorizedStateValid (state : PublicationState) (now : Nat) : Bool := (publicationReadyStateValid (state) (now) && ((Nat.ble ((state).readyAt) ((state).authorizedAt)) && ((Nat.ble ((state).authorizedAt) (now)) && ((match (state).ready with | Option.none => false | Option.some ready => (match (state).decision with | Option.none => false | Option.some decision => (publicationDecisionValid ((state).context) (ready) (decision) (now) && (publicationDecisionValid ((state).context) (ready) (decision) ((state).authorizedAt) && true)))) && true))))

@[expose] public def publicationObservedStateValid (state : PublicationState) (now : Nat) : Bool := (publicationAuthorizedStateValid (state) (now) && ((Nat.ble ((state).authorizedAt) ((state).observedAt)) && ((Nat.ble ((state).observedAt) (now)) && ((match (state).decision with | Option.none => false | Option.some decision => (match (state).deployment with | Option.none => false | Option.some deployment => ((Nat.ble ((state).authorizedAt) ((deployment).observed)) && (((Nat.ble ((decision).«from») ((deployment).observed)) && ((Nat.ble ((deployment).observed) ((decision).«until»)) && ((Nat.ble ((decision).«until») (4294967295)) && true))) && (publicationDeploymentValid ((state).context) (decision) (deployment) (now) && ((match (state).integrity with | Option.none => false | Option.some integrity => ((Nat.ble ((integrity).observed) ((state).observedAt)) && (publicationIntegrityValid ((state).context) (deployment) (integrity) (now) && true))) && true)))))) && true))))

@[expose] public def publicationStatePhaseValid (state : PublicationState) (now : Nat) : Bool := (match (state).phase with | PublicationPhase.Unready => ((Nat.beq ((state).revision) (0)) && ((Nat.beq ((state).readyAt) (0)) && ((Nat.beq ((state).authorizedAt) (0)) && ((Nat.beq ((state).observedAt) (0)) && ((match (state).trust with | Option.none => true | Option.some _ => false) && ((match (state).ready with | Option.none => true | Option.some _ => false) && ((match (state).decision with | Option.none => true | Option.some _ => false) && ((match (state).deployment with | Option.none => true | Option.some _ => false) && ((match (state).integrity with | Option.none => true | Option.some _ => false) && (publicationFactsEmpty ((state).readiness) && (publicationFactsEmpty ((state).live) && true))))))))))) | PublicationPhase.ProducerReady => ((Nat.beq ((state).revision) (1)) && ((Nat.beq ((state).readyAt) (((state).clock).tick)) && ((Nat.beq ((state).authorizedAt) (0)) && ((Nat.beq ((state).observedAt) (0)) && (publicationReadyStateValid (state) (now) && ((match (state).decision with | Option.none => true | Option.some _ => false) && ((match (state).deployment with | Option.none => true | Option.some _ => false) && ((match (state).integrity with | Option.none => true | Option.some _ => false) && (publicationFactsEmpty ((state).live) && true))))))))) | PublicationPhase.DeploymentAuthorized => (publicationFactsEmpty ((state).live) && ((((Nat.beq ((state).revision) (2)) && ((Nat.beq ((state).authorizedAt) (((state).clock).tick)) && ((Nat.beq ((state).observedAt) (0)) && (publicationAuthorizedStateValid (state) (now) && ((match (state).deployment with | Option.none => true | Option.some _ => false) && ((match (state).integrity with | Option.none => true | Option.some _ => false) && true)))))) || (((Nat.beq ((state).revision) (3)) && ((Nat.beq ((state).observedAt) (((state).clock).tick)) && (publicationObservedStateValid (state) (now) && true))) || false)) && true)) | PublicationPhase.Accepted => ((Nat.beq ((state).revision) (4)) && (publicationObservedStateValid (state) (now) && (publicationFactsComplete ((state).context) ((((state).context).declaration).obligations) ((state).live) (PublicationMoment.DeploymentOnly) ((match (state).deployment with | Option.none => Option.none | Option.some deployment => Option.some ((deployment).receipt))) (now) && true))))

@[expose] public def publicationStateValid (state : PublicationState) (now : Nat) : Bool := (publicationContextValid ((state).context) && (publicationClockValid ((state).context) ((state).clock) && ((Nat.ble (((state).clock).tick) (now)) && ((Nat.ble (now) (4294967295)) && (publicationStatePhaseValid (state) (((state).clock).tick) && (publicationStatePhaseValid (state) (now) && true))))))

@[expose] public def publicationInitialize (context : PublicationContext) (clock : PublicationClock) : Except (PublicationError) (PublicationState) := (match publicationDeclarationValid ((context).declaration) with | Bool.false => Except.error (PublicationError.BadDeclaration) | Bool.true => (match publicationSubjectValid ((context).subject) with | Bool.false => Except.error (PublicationError.BadSubject) | Bool.true => (match publicationContextValid (context) with | Bool.false => Except.error (PublicationError.BadContext) | Bool.true => (match publicationClockValid (context) (clock) with | Bool.false => Except.error (PublicationError.BadClock) | Bool.true => Except.ok (({ context := context, revision := 0, phase := PublicationPhase.Unready, clock := clock, readyAt := 0, authorizedAt := 0, observedAt := 0, trust := Option.none, readiness := ({ chunks := ([] : List (PublicationFactChunk)) } : PublicationFacts), ready := Option.none, decision := Option.none, deployment := Option.none, integrity := Option.none, live := ({ chunks := ([] : List (PublicationFactChunk)) } : PublicationFacts) } : PublicationState))))))

@[expose] public def publicationInspect (context : PublicationContext) (state : PublicationState) (clock : PublicationClock) : Except (PublicationError) (PublicationState) := (match publicationContextValid (context) with | Bool.false => Except.error (PublicationError.BadContext) | Bool.true => (match publicationPublicationContextEqual (context) ((state).context) with | Bool.false => Except.error (PublicationError.ContextChanged) | Bool.true => (match publicationClockValid (context) (clock) with | Bool.false => Except.error (PublicationError.BadClock) | Bool.true => (match (Nat.ble (((state).clock).tick) ((clock).tick)) with | Bool.false => Except.error (PublicationError.ClockRollback) | Bool.true => (match publicationStateValid (state) ((clock).tick) with | Bool.false => Except.error (PublicationError.BadState) | Bool.true => Except.ok (state))))))

@[expose] public def publicationTransition (context : PublicationContext) (state : PublicationState) (revision : Nat) (clock : PublicationClock) (operation : PublicationOperation) : Except (PublicationError) (PublicationState) := (match publicationContextValid (context) with | Bool.false => Except.error (PublicationError.BadContext) | Bool.true => (match publicationPublicationContextEqual (context) ((state).context) with | Bool.false => Except.error (PublicationError.ContextChanged) | Bool.true => (match publicationClockValid (context) (clock) with | Bool.false => Except.error (PublicationError.BadClock) | Bool.true => (match (Nat.ble (((state).clock).tick) ((clock).tick)) with | Bool.false => Except.error (PublicationError.ClockRollback) | Bool.true => (match publicationStateValid (state) ((clock).tick) with | Bool.false => Except.error (PublicationError.BadState) | Bool.true => (match (Nat.beq (revision) ((state).revision)) with | Bool.false => Except.error (PublicationError.StaleRevision) | Bool.true => (match operation with | PublicationOperation.Prepare trust readiness ready => (match (publicationPublicationPhaseEqual ((state).phase) (PublicationPhase.Unready) && ((Nat.beq ((state).revision) (0)) && true)) with | Bool.false => Except.error (PublicationError.WrongPhase) | Bool.true => (match publicationTrustValid ((state).context) (trust) ((clock).tick) with | Bool.false => Except.error (PublicationError.BadTrust) | Bool.true => (match ((Nat.beq ((LexLeanRuntime.length (ready) : Nat)) (32)) && (publicationFactsComplete ((state).context) ((((state).context).declaration).obligations) (readiness) (PublicationMoment.PrePublication) (Option.none) ((clock).tick) && true)) with | Bool.false => Except.error (PublicationError.IncompleteReadiness) | Bool.true => Except.ok (({ context := (state).context, revision := 1, phase := PublicationPhase.ProducerReady, clock := clock, readyAt := (clock).tick, authorizedAt := (state).authorizedAt, observedAt := (state).observedAt, trust := Option.some (trust), readiness := readiness, ready := Option.some (ready), decision := (state).decision, deployment := (state).deployment, integrity := (state).integrity, live := (state).live } : PublicationState))))) | PublicationOperation.Authorize decision => (match (publicationPublicationPhaseEqual ((state).phase) (PublicationPhase.ProducerReady) && ((Nat.beq ((state).revision) (1)) && true)) with | Bool.false => Except.error (PublicationError.WrongPhase) | Bool.true => (match (state).ready with | Option.none => Except.error (PublicationError.BadState) | Option.some ready => (match publicationDecisionValid ((state).context) (ready) (decision) ((clock).tick) with | Bool.false => Except.error (PublicationError.BadAuthorization) | Bool.true => Except.ok (({ context := (state).context, revision := 2, phase := PublicationPhase.DeploymentAuthorized, clock := clock, readyAt := (state).readyAt, authorizedAt := (clock).tick, observedAt := (state).observedAt, trust := (state).trust, readiness := (state).readiness, ready := (state).ready, decision := Option.some (decision), deployment := (state).deployment, integrity := (state).integrity, live := (state).live } : PublicationState))))) | PublicationOperation.Observe deployment integrity => (match (publicationPublicationPhaseEqual ((state).phase) (PublicationPhase.DeploymentAuthorized) && ((Nat.beq ((state).revision) (2)) && true)) with | Bool.false => Except.error (PublicationError.WrongPhase) | Bool.true => (match (state).decision with | Option.none => Except.error (PublicationError.BadState) | Option.some decision => (match ((Nat.ble ((state).authorizedAt) ((deployment).observed)) && (((Nat.ble ((decision).«from») ((deployment).observed)) && ((Nat.ble ((deployment).observed) ((decision).«until»)) && ((Nat.ble ((decision).«until») (4294967295)) && true))) && (publicationDeploymentValid ((state).context) (decision) (deployment) ((clock).tick) && true))) with | Bool.false => Except.error (PublicationError.BadDeployment) | Bool.true => (match publicationIntegrityValid ((state).context) (deployment) (integrity) ((clock).tick) with | Bool.false => Except.error (PublicationError.BadIntegrity) | Bool.true => Except.ok (({ context := (state).context, revision := 3, phase := PublicationPhase.DeploymentAuthorized, clock := clock, readyAt := (state).readyAt, authorizedAt := (state).authorizedAt, observedAt := (clock).tick, trust := (state).trust, readiness := (state).readiness, ready := (state).ready, decision := (state).decision, deployment := Option.some (deployment), integrity := Option.some (integrity), live := (state).live } : PublicationState)))))) | PublicationOperation.Accept live => (match (publicationPublicationPhaseEqual ((state).phase) (PublicationPhase.DeploymentAuthorized) && ((Nat.beq ((state).revision) (3)) && true)) with | Bool.false => Except.error (PublicationError.WrongPhase) | Bool.true => (match publicationFactsComplete ((state).context) ((((state).context).declaration).obligations) (live) (PublicationMoment.DeploymentOnly) ((match (state).deployment with | Option.none => Option.none | Option.some deployment => Option.some ((deployment).receipt))) ((clock).tick) with | Bool.false => Except.error (PublicationError.IncompleteLiveAssessment) | Bool.true => Except.ok (({ context := (state).context, revision := 4, phase := PublicationPhase.Accepted, clock := clock, readyAt := (state).readyAt, authorizedAt := (state).authorizedAt, observedAt := (state).observedAt, trust := (state).trust, readiness := (state).readiness, ready := (state).ready, decision := (state).decision, deployment := (state).deployment, integrity := (state).integrity, live := live } : PublicationState)))))))))))

end PrismPM.Production.PublicationAdmission.V1
