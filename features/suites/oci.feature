Feature: oci

  @OC-01 @build
  Scenario: Product releases use OCI 1.1 descriptors, manifests, indexes, subjects, annotations, and referrers with registered media types.
    Given the locked PrismPM production fixture
    When the OC-01 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-02 @build
  Scenario: A locked build atomically emits a verified root only after every declared source, proof, package, oracle, and release gate passes.
    Given the locked PrismPM production fixture
    When the OC-02 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-03 @build
  Scenario: The release graph closes over all artifacts and binds SBOM, provenance, validation, signature, policy, and deployment referrers to exact subjects.
    Given the locked PrismPM production fixture
    When the OC-03 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-04 @build
  Scenario: Push, pull, and inspect preserve and validate complete OCI graph closure without executing artifact content or rebuilding.
    Given the locked PrismPM production fixture
    When the OC-04 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-05 @build
  Scenario: Local and GHCR registry profiles pass claimed OCI distribution operations and fail safely under mutation, interruption, concurrency, and tag races.
    Given the locked PrismPM production fixture
    When the OC-05 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-06 @build
  Scenario: Promotion adds signed evidence around one immutable subject digest and never changes or rebuilds release content.
    Given the locked PrismPM production fixture
    When the OC-06 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-07 @build
  Scenario: Browser export replays the immutable release closure without source or execution and atomically copies only its exact browser artifacts without granting publication authority.
    Given the locked PrismPM production fixture
    When the OC-07 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-08 @build
  Scenario: Browser publication integrity replays the source-free release and compares its complete browser closure at one explicit canonical HTTPS base, rejecting redirects and bounded transport failures without claiming deployment authorization or product acceptance.
    Given the locked PrismPM production fixture
    When the OC-08 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-09 @build
  Scenario: A private source-modeled publication reducer binds complete stage obligations, immutable subjects, scoped authorization and distinct deployment evidence without treating conditional facts as authentication or enabling public deployment.
    Given the locked PrismPM production fixture
    When the OC-09 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-10 @build
  Scenario: Private publication context linkage projects a unique source-owned declaration and binds generated canonical preimages to the complete captured release and tool closure without inventing absent identities, authenticating caller facts, or authorizing deployment.
    Given the locked PrismPM production fixture
    When the OC-10 contract is exercised
    Then its positive evidence passes and its planted defect is rejected

  @OC-11 @build
  Scenario: The prism.images namespace of prism-code exposes build, pull, push, list, get, tag, remove, prune, inspect and verify in developer-view terms over the code that already does the work: pull refuses a failing image before writing a byte, verify returns the verdict of check, credentials come only from Docker's configuration, and an option a verb does not have is refused.
    Given images built, pushed and planted in a store or a registry, including one with changed bytes, a false statement and a verdict below the policy
    When prism.images pulls, pushes, inspects, verifies and builds them
    Then a failing image leaves no byte at any output, and every value returned is the one the code underneath returned, in developer-view terms

  @OC-12 @build
  Scenario: The local image store of prism-code keeps each image once under its BLAKE3 digest with tags as names, build and pull write into it and push reads from it, its bytes are hashed again on every read, and remove and prune follow the store model's decision table: an image a container references is never removed without force or while it runs, and prune removes only images no container references.
    Given images kept in a store by build and pull, tagged once and twice, untagged, held by created and running containers, and one whose bytes changed on disk
    When prism.images lists, tags, removes and prunes them, and prism.system reports and prunes
    Then every outcome is the decision table's row, no held image is deleted, and a changed image is refused, not served
