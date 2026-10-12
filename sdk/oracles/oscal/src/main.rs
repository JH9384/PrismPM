//! Imported JSON-schema validation only; no OSCAL control-fulfillment claim.
#![forbid(unsafe_code)]

mod input;
use input::{parse, subject, ResourceRefusal};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, error::Error, path::Path};
const ROOTS: [(&str, &str); 7] = [
    ("assessment-plan", "assessment-plan"),
    ("assessment-results", "assessment-results"),
    ("catalog", "catalog"),
    ("component-definition", "component"),
    ("plan-of-action-and-milestones", "poam"),
    ("profile", "profile"),
    ("system-security-plan", "ssp"),
];
const SCHEMAS: [(&str, &str, &[u8]); 8] = [
    (
        "assessment-plan",
        "add46ade21dc1659f7bac0e83637a9270ba1468ebf6bbd26ac0c6085d2eb0e67",
        include_bytes!(
            "../../../../standards/oracles/oscal-1.1.0/oscal_assessment-plan_schema.json"
        ),
    ),
    (
        "assessment-results",
        "fdee9614db5a21ad0c1747945def60810278fc5bf7287d2bf93ce2f53ed46977",
        include_bytes!(
            "../../../../standards/oracles/oscal-1.1.0/oscal_assessment-results_schema.json"
        ),
    ),
    (
        "catalog",
        "936c53978eb47880dfa8b471640ae09b111b38d837686022ef7db07e26fa629d",
        include_bytes!("../../../../standards/oracles/oscal-1.1.0/oscal_catalog_schema.json"),
    ),
    (
        "complete",
        "c57fe854b05dd6c249343349ea76aaf59cca87289e5c791ba832eedc2a0ae653",
        include_bytes!("../../../../standards/oracles/oscal-1.1.0/oscal_complete_schema.json"),
    ),
    (
        "component",
        "41c14d6a7d6798a7cc3b87d07bf2888b2027210acd79d27f10b6579610f3afd2",
        include_bytes!("../../../../standards/oracles/oscal-1.1.0/oscal_component_schema.json"),
    ),
    (
        "poam",
        "7e06835a32ab03561e96cfc9c623dd7b1ffd3924958a0e6a333008cb711b0f5f",
        include_bytes!("../../../../standards/oracles/oscal-1.1.0/oscal_poam_schema.json"),
    ),
    (
        "profile",
        "e40698f88744d07ff4d06512d7359b18c10bf15ca97de6ce0b61d53bd82d19af",
        include_bytes!("../../../../standards/oracles/oscal-1.1.0/oscal_profile_schema.json"),
    ),
    (
        "ssp",
        "c361dd9aadb7e0cf9b195194f2e1e88829d2b2b183d0e3ac32d4590d1acb72dd",
        include_bytes!("../../../../standards/oracles/oscal-1.1.0/oscal_ssp_schema.json"),
    ),
];

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Clone)]
struct Offline(BTreeMap<String, Value>);

impl jsonschema::Retrieve for Offline {
    fn retrieve(
        &self,
        uri: &jsonschema::Uri<String>,
    ) -> Result<Value, Box<dyn Error + Send + Sync>> {
        self.0
            .get(uri.as_str())
            .cloned()
            .ok_or_else(|| format!("unregistered offline schema resource: {uri}").into())
    }
}

struct Oracle(BTreeMap<&'static str, jsonschema::Validator>);

impl Oracle {
    fn new() -> Result<Self, Box<dyn Error>> {
        let mut validators = BTreeMap::new();
        for (name, expected, bytes) in SCHEMAS {
            if digest(bytes) != expected {
                return Err(format!("changed official OSCAL schema: {name}").into());
            }
            let schema = parse(bytes)?;
            if schema["$schema"] != "http://json-schema.org/draft-07/schema#" {
                return Err("wrong OSCAL schema dialect".into());
            }
            let validator = jsonschema::options()
                .with_draft(jsonschema::Draft::Draft7)
                .should_validate_formats(true)
                .with_retriever(Offline(BTreeMap::new()))
                .build(&schema)?;
            validators.insert(name, validator);
        }
        Ok(Self(validators))
    }

    fn structural(&self, value: &Value) -> Option<&'static str> {
        let selected: Vec<_> = ROOTS
            .iter()
            .filter(|(root, _)| value.get(*root).is_some())
            .collect();
        if selected.len() != 1 {
            return None;
        }
        let (root, schema) = selected[0];
        (self.0[schema].is_valid(value) && self.0["complete"].is_valid(value)).then_some(*root)
    }

    fn validate(&self, value: &Value) -> Option<&'static str> {
        let root = self.structural(value)?;
        (value[root]["metadata"]["oscal-version"] == "1.1.0").then_some(root)
    }
}

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 2 {
        eprintln!("usage: oscal-validator INPUT");
        std::process::exit(2);
    }
    let oracle = Oracle::new().unwrap_or_else(|error| {
        eprintln!("OSCAL oracle unavailable: {error}");
        std::process::exit(6);
    });
    let result = (|| -> Result<Value, Box<dyn Error>> {
        let bytes = subject(Path::new(&args[1]))?;
        let value = parse(&bytes)?;
        let root = oracle
            .validate(&value)
            .ok_or("OSCAL 1.1.0 JSON structural validation rejected the subject")?;
        Ok(
            json!({"schema":"prismpm/oscal-json-structural-result/1", "oracle":"nist-oscal-1.1.0-json-schema",
            "edition":"1.1.0", "valid":true, "subject":{"sha256":digest(&bytes),"bytes":bytes.len()},
            "model":root, "scope":"json-structural-validation-only", "complete_standard_acceptance":false}),
        )
    })();
    match result {
        Ok(report) => println!("{report}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(if error.downcast_ref::<ResourceRefusal>().is_some() {
                5
            } else {
                4
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn tree(name: &str, expected: &str, count: usize) -> Vec<(String, Vec<u8>)> {
        fn visit(root: &Path, directory: &Path, rows: &mut Vec<(String, Vec<u8>)>) {
            let mut entries: Vec<_> = fs::read_dir(directory)
                .unwrap()
                .map(Result::unwrap)
                .collect();
            entries.sort_by_key(fs::DirEntry::file_name);
            for entry in entries {
                let path = entry.path();
                let metadata = fs::symlink_metadata(&path).unwrap();
                assert!(!metadata.file_type().is_symlink());
                if metadata.is_dir() {
                    visit(root, &path, rows);
                } else {
                    assert!(metadata.is_file());
                    rows.push((
                        path.strip_prefix(root)
                            .unwrap()
                            .to_str()
                            .unwrap()
                            .to_owned(),
                        fs::read(path).unwrap(),
                    ));
                }
            }
        }
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../standards/corpora")
            .join(name);
        let mut rows = Vec::new();
        visit(&root, &root, &mut rows);
        rows.sort_unstable_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
        let mut hash = Sha256::new();
        for (path, bytes) in &rows {
            hash.update((path.len() as u64).to_be_bytes());
            hash.update(path.as_bytes());
            hash.update((bytes.len() as u64).to_be_bytes());
            hash.update(bytes);
        }
        assert_eq!(rows.len(), count);
        assert_eq!(format!("{:x}", hash.finalize()), expected);
        rows
    }

    #[test]
    fn all_draft7_and_four_format_cases() {
        let rows = tree(
            "json-schema-draft7",
            "194c92717167698830d5b88e1912d4e561edd33a7f2e995a3654f6a909da1e83",
            121,
        );
        let remotes = Offline(
            rows.iter()
                .filter_map(|(path, bytes)| {
                    path.strip_prefix("remotes/").map(|path| {
                        (
                            format!("http://localhost:1234/{path}"),
                            parse(bytes).unwrap(),
                        )
                    })
                })
                .collect(),
        );
        let mut files = 0;
        let mut positive = 0;
        let mut negative = 0;
        let mut failures = Vec::new();
        for (path, bytes) in rows
            .iter()
            .filter(|(path, _)| path.starts_with("tests/draft7/"))
        {
            let groups = parse(bytes).unwrap();
            files += 1;
            for group in groups.as_array().unwrap() {
                let validator = jsonschema::options()
                    .with_draft(jsonschema::Draft::Draft7)
                    .should_validate_formats(path.contains("/optional/format/"))
                    .with_retriever(remotes.clone())
                    .build(&group["schema"])
                    .unwrap();
                for case in group["tests"].as_array().unwrap() {
                    let expected = case["valid"].as_bool().unwrap();
                    let observed = validator.is_valid(&case["data"]);
                    if observed != expected {
                        failures.push(json!({"file":path,"group":group["description"],
                        "case":case["description"],"data":case["data"],"expected":expected,"observed":observed}));
                    }
                    if expected {
                        positive += 1;
                    } else {
                        negative += 1;
                    }
                }
            }
        }
        assert_eq!(files, 41);
        assert_eq!((positive, negative), (634, 486));
        println!("complete draft7 cases: positive={positive} negative={negative}");
        assert!(
            failures.is_empty(),
            "complete upstream mismatch inventory: {}",
            Value::Array(failures)
        );
    }

    #[test]
    fn all_official_cross_edition_documents() {
        fn diagnostic(error: jsonschema::ValidationError<'_>) -> Value {
            json!({"instance":error.instance_path().to_string(),"schema":error.schema_path().to_string(),
                "keyword":error.kind().keyword()})
        }
        let rows = tree(
            "oscal-content-bae69b5a",
            "faf2b57fea7429ea81704308f5b2f81c66e40cc06f45e6f1733f53ed161e4fef",
            45,
        );
        let oracle = Oracle::new().unwrap();
        let mut count = 0;
        let mut failures = Vec::new();
        for (path, bytes) in rows {
            if path == "LICENSE.md" {
                continue;
            }
            assert!(path.ends_with(".json"));
            let value = parse(&bytes).unwrap();
            let (root, model) = ROOTS
                .iter()
                .find(|(root, _)| value.get(*root).is_some())
                .unwrap();
            if oracle.structural(&value).is_none() {
                failures.push(json!({"path":path,"model":model,
                    "model_errors":oracle.0[model].iter_errors(&value).map(diagnostic).collect::<Vec<_>>(),
                    "complete_errors":oracle.0["complete"].iter_errors(&value).map(diagnostic).collect::<Vec<_>>()}));
            }
            assert_eq!(value[root]["metadata"]["oscal-version"], "1.1.1");
            assert_eq!(oracle.validate(&value), None, "wrong edition: {path}");
            count += 1;
        }
        assert_eq!(count, 44);
        assert!(
            failures.is_empty(),
            "official content structural mismatches: {}",
            Value::Array(failures)
        );
    }

    #[test]
    fn strict_json_duplicates_and_invalid_bytes() {
        for bytes in [
            br#"{"a":1,"a":2}"#.as_slice(),
            br#"{"a":{"b":1,"b":2}}"#,
            b"{}{}",
            b"{\"a\":1,}",
            b"/*x*/{}",
            b"",
            &[0xc0, 0xaf],
        ] {
            assert!(parse(bytes).is_err());
        }
        assert_eq!(parse(br#"{"a":[{},1]}"#).unwrap(), json!({"a":[{},1]}));
    }

    #[test]
    fn all_seven_local_models_and_subject_mutations() {
        let corpus = parse(include_bytes!("../local-subjects.json")).unwrap();
        assert_eq!(
            corpus["source"],
            "PrismPM-local-examples-not-NIST-test-vectors"
        );
        let oracle = Oracle::new().unwrap();
        let positives = corpus["positives"].as_array().unwrap();
        let negatives = corpus["negatives"].as_array().unwrap();
        assert_eq!(positives.len(), 7);
        assert_eq!(negatives.len(), 57);
        let mut roots = Vec::new();
        for document in positives {
            roots.push(
                oracle
                    .validate(document)
                    .expect("valid local model document"),
            );
        }
        roots.sort_unstable();
        let mut expected: Vec<_> = ROOTS.iter().map(|(root, _)| *root).collect();
        expected.sort_unstable();
        assert_eq!(roots, expected);
        for row in negatives {
            assert!(
                oracle.validate(&row["value"]).is_none(),
                "invalid local subject: {}",
                row["id"]
            );
        }
    }

    #[test]
    fn fragment_reference_diagnostic() {
        let schema = json!({"$schema":"http://json-schema.org/draft-07/schema#", "$id":"https://example.org/model.json",
            "type":"object", "definitions":{
                "directive":{"$id":"#directive","$ref":"#/definitions/text"},
                "model":{"$id":"#model","type":"object","properties":{"name":{"$ref":"#/definitions/text"}},"required":["name"]},
                "text":{"type":"string"}},
            "properties":{"$schema":{"$ref":"#directive"},"model":{"$ref":"#model"}},"required":["model"]});
        let validator = jsonschema::options()
            .with_draft(jsonschema::Draft::Draft7)
            .with_retriever(Offline(BTreeMap::new()))
            .build(&schema)
            .unwrap();
        assert!(validator.is_valid(&json!({"model":{"name":"actual model"}})));
        assert!(!validator.is_valid(&json!({"model":"not the model object"})));
        assert!(!validator.is_valid(&json!({"model":{"name":42}})));
    }

    #[test]
    fn subject_numbers_are_not_rounded_before_schema_validation() {
        let integer = jsonschema::options()
            .build(&json!({"type":"integer"}))
            .unwrap();
        let fractional = parse(b"1.0000000000000000000000000000000001").unwrap();
        assert!(
            !integer.is_valid(&fractional),
            "a fractional JSON number must not become an integer"
        );
        assert!(integer.is_valid(&parse(b"18446744073709551617").unwrap()));
        assert_eq!(
            parse(b"18446744073709551617").unwrap().to_string(),
            "18446744073709551617"
        );
        assert!(integer.is_valid(&parse(b"1e400").unwrap()));
        assert_eq!(
            parse(br#"{"$serde_json::private::Number":"1"}"#).unwrap(),
            json!({"$serde_json::private::Number":"1"}),
            "number internals cannot reinterpret an actual JSON object"
        );
    }
}
