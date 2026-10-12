# OSCAL JSON source acquisition

The adjacent inventory pins the original corpora; `standards/oracles/oscal-1.1.0/manifest.json` pins all seven official model schemas, the complete schema and license. Imported bytes are unchanged.

The 44 NIST documents declare OSCAL 1.1.1 despite the source repository's v1.1.0 tag. They are cross-edition structural probes, not 1.1.0 admission fixtures. The JSON Schema selection contains all 1,120 mandatory draft-07 and four used-format cases, including positive and negative outcomes.

This commit imports sources only. It adds no executable oracle, SDK authority, control-fulfillment evidence or whole-standard acceptance. Released validator defects are documented in [upstream issue 1668](https://github.com/Stranger6667/jsonschema/issues/1668); [PR 1669](https://github.com/Stranger6667/jsonschema/pull/1669) awaits upstream CI/review. Local candidate execution is not an installed SDK oracle.
