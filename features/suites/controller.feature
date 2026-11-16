Feature: controller

  @CT-01 @build
  Scenario: The Controller API exposes owned request and result types for load, check, and build.
    Given the prismpm crate
    When Controller methods are invoked
    Then owned request and result types are returned

  @CT-02 @build
  Scenario: The Controller encapsulates LexLean Engine operations without exposing internal compiler types.
    Given Controller public interfaces
    When types are inspected
    Then LexLean internal IR types are not exposed

  @CT-03 @build
  Scenario: prismpm check validates models in memory without modifying the filesystem.
    Given a valid PrismPM project
    When prismpm check runs
    Then validation succeeds and the filesystem remains unmodified

  @CT-04 @build
  Scenario: prismpm build atomically publishes artifacts under content-addressed build directories.
    Given a valid PrismPM project
    When prismpm build runs
    Then artifacts are atomically published under .prism/build/<id>

  @CT-05 @build
  Scenario: The CLI produces structured machine-readable JSON output on stdout.
    Given prismpm CLI invocation with machine flag
    When command completes
    Then stdout contains valid canonical JSON

  @CT-06 @build
  Scenario: The Controller enforces positive resource and entity limits.
    Given project configuration with limits
    When limits are exceeded
    Then processing is halted with registered diagnostic codes

  @CT-07 @build
  Scenario: All public errors carry registered PP diagnostic codes.
    Given failure scenarios
    When diagnostics are emitted
    Then every error code belongs to the closed PP namespace

  @CT-08 @build
  Scenario: The Controller operates completely offline during build and check.
    Given network disabled
    When check or build is executed
    Then operations succeed without network requests

  @CT-09 @build
  Scenario: Project configuration is strictly validated against schemas/project.schema.json.
    Given prismpm.toml configuration
    When loaded by Controller
    Then unknown fields, absent required fields, invalid formats and out-of-range limits return their registered diagnostics

  @CT-10 @build
  Scenario: The Controller preserves cause chains for underlying LexLean diagnostics.
    Given a LexLean syntax error
    When handled by Controller
    Then the original diagnostic cause is preserved in structured output

  @CT-11 @build
  Scenario: Controller cleanup removes only the configured real output directory and rejects a symlink target.
    Given a Prism project with a configured output directory
    When Controller cleanup is called
    Then only that real directory is removed and a symlink in its place is rejected

  @CT-12 @build
  Scenario: The prism.errors namespace holds the same error classes and functions as the prism-code exports, their stable codes and the constants of @prism-code/spec, imports no other Prism module, and every code prism-code raises, the code of each error class and each check code of a PrismCodeError, is a row of model/sdk-diagnostics.toml owned by its module's capability, with no code left unregistered.
    Given the prism-code package, ERRORS.md, model/errors.toml and the committed list of unregistered codes
    When the owning Node suites compare the namespace with the package exports and scan the codes raised in sdk/npm/prism-code/src and crates/prismpm/src
    Then the namespace holds the same objects and stable codes, its import closure is errors.mjs and the vendored spec, and every PP code is registered
    And a new unregistered code, or a listed code that is no longer unregistered, fails the case

  @CT-13 @build
  Scenario: The Controller reads the LexLean build root from the project's lexlean.toml instead of assuming .lexlean, so a project that configures another build root builds and publishes through the root it configures.
    Given a Prism project whose lexlean.toml configures a build root other than .lexlean
    When the Controller builds it
    Then the LexLean artifacts are read from and published through that root and nothing is written under .lexlean
