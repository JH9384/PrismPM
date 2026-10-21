// Executes the finite modeled corpus against generated code, not a host codec.
// The only formal claims in WireCorpus are its three named length theorems.
use prism_stdlib as wire;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const PROBES: &[&str] = &[
    "probeEmptyCapabilitiesExact",
    "probeManifestExact",
    "probeManifestValid",
    "probeManifestReferences",
    "probeArchiveBodyExact",
    "probeArchiveFrameExact",
    "probeArchiveFrameValid",
    "probeSection0",
    "probeSection1",
    "probeSection2",
    "probeSection3",
    "probeSection4",
    "probeSection5",
    "probeSection6",
    "probeSection7",
    "probeDirectoryExtension",
    "probeProvenanceExtension",
    "probeFooterExact",
    "probeBodyDecodeExact",
    "probeBadMagic",
    "probeOlderVersion",
    "probeNewerVersion",
    "probeNonzeroFlags",
    "probeNonzeroPadding",
    "probeWrongSectionCount",
    "probeUnknownSectionKind",
    "probeOutOfRangeOffset",
    "probePayloadInsideTable",
    "probeOutOfRangeLength",
    "probeBadFooter",
    "probeTrailingPayloadByte",
    "probeU64Maximum",
    "probeU64MaximumBytes",
    "probeInvalidManifestLabel",
    "probeInvalidManifestIndex",
    "probeInvalidSectionIndex",
    "probeInvalidExtensionIndex",
    "probeInvalidFooterSize",
    "probeDuplicateBlobsRejected",
    "probeUnsortedBlobsRejected",
    "probeMissingManifestReference",
    "probeCapabilityEscalationRejected",
    "probeContentBlob0",
    "probeContentBlobLabel0",
    "probeContentBlobBytes0",
    "probeContentBlob1",
    "probeContentBlobLabel1",
    "probeContentBlobBytes1",
    "probeContentBlob2",
    "probeContentBlobLabel2",
    "probeContentBlobBytes2",
    "probeContentBlob3",
    "probeContentBlobLabel3",
    "probeContentBlobBytes3",
    "probeShortContentBlob",
    "probeInvalidBlobLabel",
    "probeEmptyBlobContentRepresentable",
];

#[derive(Clone, Debug, PartialEq)]
enum TestValue {
    Bytes(Vec<u8>),
    Nat(u64),
    Bool(bool),
    Optional(Option<Vec<u8>>),
}
impl TestValue {
    fn bytes(&self) -> Vec<u8> {
        match self {
            Self::Bytes(value) => value.clone(),
            _ => panic!("expected fixture bytes: {self:?}"),
        }
    }
    fn nat(&self) -> u64 {
        match self {
            Self::Nat(value) => *value,
            _ => panic!("expected fixture Nat: {self:?}"),
        }
    }
    fn boolean(&self) -> bool {
        match self {
            Self::Bool(value) => *value,
            _ => panic!("expected fixture Bool: {self:?}"),
        }
    }
}
fn bytes(hex: &str) -> Vec<u8> {
    assert_eq!(hex.len() % 2, 0);
    hex.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}
fn fixture_bytes(value: &Value) -> Vec<u8> {
    bytes(value.as_str().unwrap())
}

struct Corpus {
    declarations: BTreeMap<String, Value>,
}
impl Corpus {
    fn load() -> Self {
        let source = include_str!("../stdlib/src/Foundation/Holo/V1/WireCorpus.lex.tex");
        // The corpus is language-1.2 notation; LexLean reads it back to its
        // semantic-module JSON, exactly as the compiler does.
        let module: Value = lexlean::sdk::read_module(source).unwrap();
        let declarations = module["declarations"].as_array().unwrap();
        let by_name: BTreeMap<_, _> = declarations
            .iter()
            .map(|value| (value["name"].as_str().unwrap().to_owned(), value.clone()))
            .collect();
        assert_eq!(
            by_name.len(),
            declarations.len(),
            "duplicate corpus declaration"
        );
        Self {
            declarations: by_name,
        }
    }
    fn call(&self, name: &str, arguments: &[TestValue]) -> TestValue {
        let declaration = &self.declarations[name];
        assert_eq!(
            declaration["kind"], "definition",
            "only fixture definitions execute"
        );
        let parameters = declaration["parameters"].as_array().unwrap();
        assert_eq!(parameters.len(), arguments.len());
        let environment = parameters
            .iter()
            .zip(arguments)
            .map(|(parameter, argument)| {
                (
                    parameter["name"].as_str().unwrap().to_owned(),
                    argument.clone(),
                )
            })
            .collect();
        self.evaluate(&declaration["body"], &environment)
    }
    fn evaluate(&self, expression: &Value, environment: &BTreeMap<String, TestValue>) -> TestValue {
        match expression["kind"].as_str().unwrap() {
            "bytes" => TestValue::Bytes(fixture_bytes(&expression["hex"])),
            "nat" => TestValue::Nat(expression["value"].as_str().unwrap().parse().unwrap()),
            "bool" => TestValue::Bool(expression["value"].as_bool().unwrap()),
            "var" => environment[expression["name"].as_str().unwrap()].clone(),
            "primitive" => {
                assert_eq!(
                    expression["operation"], "append",
                    "fixture construction only"
                );
                let arguments = expression["arguments"].as_array().unwrap();
                assert_eq!(arguments.len(), 2);
                let mut left = self.evaluate(&arguments[0], environment).bytes();
                left.extend(self.evaluate(&arguments[1], environment).bytes());
                TestValue::Bytes(left)
            }
            "beq" => TestValue::Bool(
                self.evaluate(&expression["left"], environment)
                    == self.evaluate(&expression["right"], environment),
            ),
            "and" => TestValue::Bool(
                self.evaluate(&expression["left"], environment).boolean()
                    && self.evaluate(&expression["right"], environment).boolean(),
            ),
            "not" => TestValue::Bool(!self.evaluate(&expression["value"], environment).boolean()),
            "match" => {
                let TestValue::Optional(value) =
                    self.evaluate(&expression["scrutinee"], environment)
                else {
                    panic!("only fixture Option matching is supported")
                };
                let constructor = if value.is_some() {
                    "Option.some"
                } else {
                    "Option.none"
                };
                let branches = expression["branches"].as_array().unwrap();
                assert_eq!(branches.len(), 2);
                let branch = branches
                    .iter()
                    .find(|branch| branch["constructor"]["name"] == constructor)
                    .unwrap();
                let binders = branch["binders"].as_array().unwrap();
                let mut nested = environment.clone();
                if let Some(value) = value {
                    assert_eq!(binders.len(), 1);
                    nested.insert(
                        binders[0].as_str().unwrap().to_owned(),
                        TestValue::Bytes(value),
                    );
                } else {
                    assert!(binders.is_empty());
                }
                self.evaluate(&branch["body"], &nested)
            }
            "call" => {
                let function = &expression["function"];
                let name = function["name"].as_str().unwrap();
                let arguments: Vec<_> = expression["arguments"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|argument| self.evaluate(argument, environment))
                    .collect();
                if function.get("module").is_none() {
                    return self.call(name, &arguments);
                }
                assert_eq!(function["module"], "Foundation.Holo.V1.Wire");
                generated_call(name, &arguments)
            }
            kind => panic!("unsupported fixture expression {kind}"),
        }
    }
}
// Every codec operation below calls generated production code. This dispatcher
// handles test values only; it contains no framing, encoding, or decoding logic.
fn generated_call(name: &str, arguments: &[TestValue]) -> TestValue {
    let b = |index: usize| arguments[index].bytes();
    let n = |index: usize| arguments[index].nat();
    match name {
        "emptyCapabilities" => TestValue::Bytes(wire::emptyCapabilities()),
        "appManifest" => TestValue::Optional(wire::appManifest(b(0), b(1), b(2))),
        "validAppManifest" => TestValue::Bool(wire::validAppManifest(&b(0))),
        "manifestReference" => TestValue::Optional(wire::manifestReference(b(0), n(1)).unwrap()),
        "archiveBody" => TestValue::Optional(
            wire::archiveBody(b(0), b(1), b(2), b(3), b(4), b(5), b(6), b(7)).unwrap(),
        ),
        "validArchiveBody" => TestValue::Bool(wire::validArchiveBody(&b(0)).unwrap()),
        "frameArchive" => TestValue::Optional(wire::frameArchive(b(0), b(1)).unwrap()),
        "validArchiveFrame" => TestValue::Bool(wire::validArchiveFrame(&b(0)).unwrap()),
        "archiveSection" => TestValue::Optional(wire::archiveSection(b(0), n(1)).unwrap()),
        "archiveExtension" => TestValue::Optional(wire::archiveExtension(b(0), n(1)).unwrap()),
        "archiveBodyBytes" => TestValue::Optional(wire::archiveBodyBytes(b(0)).unwrap()),
        "archiveFooter" => TestValue::Optional(wire::archiveFooter(b(0)).unwrap()),
        "contentBlob" => TestValue::Optional(wire::contentBlob(b(0), b(1))),
        "contentBlobLabel" => TestValue::Optional(wire::contentBlobLabel(b(0))),
        "contentBlobBytes" => TestValue::Optional(wire::contentBlobBytes(b(0))),
        "wireBytesEqual" => TestValue::Bool(wire::wireBytesEqual(&b(0), &b(1))),
        "wireEncodeLe64" => TestValue::Bytes(wire::wireEncodeLe64(n(0))),
        "wireDecodeLe64" => TestValue::Nat(wire::wireDecodeLe64(b(0)).unwrap()),
        name => panic!("unmapped generated codec function {name}"),
    }
}
#[test]
fn all_57_modeled_wire_cases_execute_generated_code() {
    let corpus = Corpus::load();
    let expected: BTreeSet<_> = PROBES.iter().copied().collect();
    let actual: BTreeSet<_> = corpus
        .declarations
        .keys()
        .filter(|name| name.starts_with("probe"))
        .map(String::as_str)
        .collect();
    assert_eq!(PROBES.len(), 57);
    assert_eq!(expected.len(), PROBES.len(), "duplicate execution mapping");
    assert_eq!(actual, expected, "complete corpus-to-execution bijection");
    for name in PROBES {
        assert!(corpus.call(name, &[]).boolean(), "{name}");
        println!("generated codec corpus PASS {name}");
    }
}

#[test]
fn corpus_bytes_are_bound_to_independent_upstream_vectors() {
    let corpus = Corpus::load();
    let fixture: Value = serde_json::from_str(include_str!("data/holo-codec-v1.json")).unwrap();
    for (name, expected) in [
        ("oracleManifest", &fixture["manifest"]["bytes_hex"]),
        (
            "oracleCapabilities",
            &fixture["empty_capabilities"]["bytes_hex"],
        ),
        ("oracleBody", &fixture["archive"]["body_hex"]),
        ("oracleFrame", &fixture["archive"]["bytes_hex"]),
        ("oracleFooter", &fixture["archive"]["footer_hex"]),
    ] {
        assert_eq!(
            corpus.call(name, &[]).bytes(),
            fixture_bytes(expected),
            "{name}"
        );
    }
    let malformed = [
        ("probeBadMagic", "bad-magic"),
        ("probeOlderVersion", "older-version"),
        ("probeNewerVersion", "newer-version"),
        ("probeNonzeroFlags", "nonzero-flags"),
        ("probeNonzeroPadding", "nonzero-padding"),
        ("probeWrongSectionCount", "wrong-section-count"),
        ("probeUnknownSectionKind", "unknown-section-kind"),
        ("probeOutOfRangeOffset", "out-of-range-offset"),
        ("probePayloadInsideTable", "payload-inside-table"),
        ("probeOutOfRangeLength", "out-of-range-length"),
        ("probeBadFooter", "bad-footer"),
        ("probeTrailingPayloadByte", "trailing-payload-byte"),
    ];
    assert_eq!(
        fixture["malformed_archives"].as_array().unwrap().len(),
        malformed.len()
    );
    for (probe, name) in malformed {
        let body = &corpus.declarations[probe]["body"];
        let call = if body["kind"] == "not" {
            &body["value"]
        } else {
            body
        };
        assert_eq!(call["function"]["name"], "validArchiveFrame");
        let actual = corpus
            .evaluate(&call["arguments"][0], &BTreeMap::new())
            .bytes();
        let expected = fixture["malformed_archives"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == name)
            .unwrap();
        assert_eq!(actual, fixture_bytes(&expected["bytes_hex"]), "{name}");
        // A footer bitflip is structurally valid. Cryptographic rejection belongs
        // to the host BLAKE3 check and is not claimed by this pure framing model.
        assert_eq!(
            wire::validArchiveFrame(&actual).unwrap(),
            name == "bad-footer",
            "{name}"
        );
    }
}

#[test]
fn generated_octet_and_u64_boundaries() {
    for value in 0..=255 {
        assert_eq!(wire::wireEncodeOctet(value), vec![value as u8]);
        assert_eq!(wire::wireDecodeOctet(vec![value as u8]), value);
    }
    assert!(wire::wireEncodeOctet(256).is_empty());
    for value in [
        0,
        1,
        255,
        256,
        65_535,
        65_536,
        u32::MAX as u64,
        u32::MAX as u64 + 1,
        u64::MAX - 1,
        u64::MAX,
    ] {
        let encoded = wire::wireEncodeLe64(value);
        assert_eq!(encoded, value.to_le_bytes());
        assert_eq!(wire::wireDecodeLe64(encoded).unwrap(), value);
    }
}
