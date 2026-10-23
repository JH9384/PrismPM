Feature: facets

  @FT-01 @build
  Scenario: prism.arch defines ISO/IEC/IEEE 42010:2022 architecture description concepts in LexLean.
    Given language/prism.arch package
    When package is loaded by LexLean
    Then ISO 42010 architectural primitives are defined

  @FT-02 @build
  Scenario: prism.sec defines ISO/IEC 27034 application security concepts in LexLean.
    Given language/prism.sec package
    When package is loaded by LexLean
    Then ISO 27034 application security concepts are defined

  @FT-03 @build
  Scenario: prism.sec defines ISO/IEC 27034-5 application security control data structures.
    Given language/prism.sec package
    When security control structures are verified
    Then control objectives, activities, and measurements are present

  @FT-04 @build
  Scenario: prism.sec defines ISO/IEC 27005:2022 information security risk management concepts.
    Given language/prism.sec package
    When risk models are evaluated
    Then threat, asset, likelihood, and impact mappings are complete

  @FT-05 @build
  Scenario: prism.qual defines ISO/IEC 25010:2023 product quality characteristics and requirements.
    Given language/prism.qual package
    When quality models are evaluated
    Then product quality characteristics and measures are defined

  @FT-06 @build
  Scenario: Facet packages use closed lexical signatures and renderer-token coverage.
    Given all prism.* facet packages
    When renderer-token audits run
    Then all surface tokens are closed and covered

  @FT-07 @build
  Scenario: Shared terms across facets have unique ownership and acyclic dependencies.
    Given cross-facet imports
    When dependency graph is checked
    Then ownership is unique and the import graph is acyclic

  @FT-08 @build
  Scenario: Every standards entry links to exactly one row in model/standards.toml.
    Given facet glossary entries
    When standards links are validated
    Then each entry binds to an active standard row

  @FT-09 @build
  Scenario: Facet lexicons produce deterministic canonical LaTeX and Lean lowerings.
    Given verified facet packages
    When LexLean backend generates outputs
    Then canonical LaTeX and Lean match oracles

  @FT-10 @build
  Scenario: Lexicon package locks reproduce across multiple directory roots.
    Given clean checkouts in two directories
    When lexlean lock runs
    Then identical lexlean.lock files are produced

  @FT-11 @build
  Scenario: prism.arch defines OPM (ISO/PAS 19450) and UML 2.5.1 design view entries as ISO/IEC/IEEE 42010 views.
    Given language/prism.arch entries for design views, OPM things, links and zoom, and UML components, lifelines, messages and state machines
    When the entries are mapped to the standards register
    Then ISO/PAS 19450 and OMG UML 2.5.1 each own exactly their entries and the 42010 row owns the view and system declaration entries

  @FT-12 @build
  Scenario: prism.arch defines Feature and Journey declarations: a feature states what a product does with the interface calls that realize it and the acceptance rows that accept it, and a journey is an ordered sequence of features performed by a stakeholder.
    Given language/prism.arch entries for features and journeys
    When the entries are mapped to the standards register
    Then the 42010 row owns the feature and journey entries

  @FT-13 @build
  Scenario: The SDK checks features and journeys in prismpm check and refuses a feature without a call with PP2014, a feature without an acceptance row with PP2015, a journey step that names an undeclared feature with PP2016, a journey whose actor is not a declared stakeholder with PP2017, and a malformed declaration or a call or acceptance row that names no declaration with PP2018.
    Given a model whose Foundation.Arch features name interface calls and acceptance rows and whose journeys name a stakeholder and features
    When the controller checks the model
    Then a feature without a call is refused with PP2014 and a feature without an acceptance row with PP2015
    And a journey step naming an undeclared feature is refused with PP2016 and a journey whose actor is not a declared stakeholder with PP2017
    And a malformed declaration or a call or acceptance row naming no declaration is refused with PP2018 before any artifact is written
