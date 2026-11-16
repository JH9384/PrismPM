Feature: assurance

  @AL-03 @build
  Scenario: A holo without provenance reports P0 even when its proof statement is valid, and the reasons name the missing provenance beside every proof check that did not pass.
    Given the Calculator archive signed with a proof statement about its guest and no provenance statement
    When prismpm check judges it under the default policy
    Then the level is P0 and the verdict fails
    And the reasons name provenance.statement, and the proof checks that passed are absent from them

  @AL-05 @build
  Scenario: A statement's verifiedLevels never changes the computed level: a claim other than P2 is a shape failure of the proof statement, and no claim raises the level.
    Given a proof statement whose verifiedLevels claims P3
    When prismpm check judges the holo that carries it
    Then the level is P0 and proof.statement fails with PP5502
    And a statement claiming P2 reaches the same level

  @AL-06 @build
  Scenario: prismpm check and prism-code check return equal verdicts for every committed verdict fixture: the same holo digest, level, policy, result, and the same check ids, codes and withheld levels in the same order.
    Given the verdicts prism-code check --json prints for the reference archive, a P0 policy and a tampered guest
    When prismpm check judges the same bytes under the same policies
    Then every member of the verdict other than the messages is equal

  @AL-07 @build
  Scenario: The prism.verify namespace of prism-code gives the verdicts and refusals of experimental_verify, check and @prism-code/verify on every archive of the conformance corpus, leaves a signed holo at P0 with no signer or another signer, refuses outside Node instead of appearing to pass, and at load imports no Node module and only the modules the nine-module design gives verify or errors.
    Given every archive of the conformance corpus and the signed reference fixtures
    When prism.verify judges each of them
    Then the outcome equals the one the code under it returns, and no signer or another signer leaves a signed holo at P0
    And outside Node its Node-only members refuse, and its import graph holds no other module
