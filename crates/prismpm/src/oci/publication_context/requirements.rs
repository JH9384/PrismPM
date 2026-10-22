//! Bind declared requirements to retained source/SDK contracts, not outcomes.

use super::*;

#[cfg(test)]
thread_local! { static AUDIT_PARSE_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

struct ProofAudits<'a> {
    sources: BTreeMap<Member, (&'a lexlean::SnapshotDeclaration, String)>,
    audits: BTreeMap<String, Value>,
}

impl<'a> ProofAudits<'a> {
    fn parse(snapshot: &'a SemanticSnapshot, bytes: &[u8]) -> Result<Self, PrismError> {
        if bytes.len() > 67_108_864 {
            return Err(invalid(
                "captured kernel audit exceeds the verification JSON bound",
            ));
        }
        #[cfg(test)]
        AUDIT_PARSE_COUNT.with(|count| count.set(count.get() + 1));
        let mut attestation: Value =
            serde_json::from_slice(bytes).map_err(|error| invalid(error.to_string()))?;
        let Some(Value::Array(rows)) = attestation
            .as_object_mut()
            .and_then(|object| object.remove("declarations"))
        else {
            return Err(invalid("captured kernel audit declarations absent"));
        };
        let mut audits = BTreeMap::new();
        for row in rows {
            let name = row["name"]
                .as_str()
                .filter(|name| !name.is_empty())
                .ok_or_else(|| invalid("captured kernel audit declaration identity absent"))?
                .to_owned();
            if audits.insert(name, row).is_some() {
                return Err(invalid(
                    "captured kernel audit declaration identity is duplicated",
                ));
            }
        }
        let mut sources = BTreeMap::new();
        for module in snapshot.modules() {
            for declaration in module.declarations() {
                let member = Member {
                    module: module.name().to_owned(),
                    name: declaration.logical_id().to_owned(),
                };
                let name = format!("{}.{}", module.lean_module(), declaration.lean_name());
                if sources.insert(member, (declaration, name)).is_some() {
                    return Err(invalid(
                        "captured source declaration identity is duplicated",
                    ));
                }
            }
        }
        Ok(Self { sources, audits })
    }

    fn from_capture(
        captured: &VerifiedReleaseCapture,
        snapshot: &'a SemanticSnapshot,
    ) -> Result<Self, PrismError> {
        Self::parse(
            snapshot,
            captured
                .verification
                .runtime
                .get("lexlean-attestation.json")
                .ok_or_else(|| invalid("required theorem has no captured kernel audit"))?,
        )
    }
}

fn natural(value: &Literal) -> Result<u32, PrismError> {
    match value {
        Literal::Nat(value) => Ok(*value),
        _ => Err(invalid("source requirement ID is not a natural")),
    }
}

fn variant(value: &Literal) -> Result<(usize, &[Literal]), PrismError> {
    match value {
        Literal::Variant(_, tag, fields) => Ok((*tag, fields)),
        _ => Err(invalid("source requirement is not a typed variant")),
    }
}

fn sdk_executable(lock: &Value, executable: &str) -> Result<(), PrismError> {
    let inventories: Vec<&Value> = match lock["schema"].as_str() {
        Some("prismpm/sdk-lock/1") => vec![&lock["inventory"]],
        Some("prismpm/sdk-lock/2") => lock["platforms"]
            .as_array()
            .ok_or_else(|| invalid("SDK platform inventory absent"))?
            .iter()
            .map(|platform| &platform["inventory"])
            .collect(),
        _ => return Err(invalid("unsupported captured SDK lock")),
    };
    if inventories.is_empty() {
        return Err(invalid("captured SDK oracle executable inventory absent"));
    }
    for inventory in inventories {
        let matches = inventory
            .as_array()
            .ok_or_else(|| invalid("captured SDK inventory absent"))?
            .iter()
            .filter(|row| row["id"] == executable)
            .collect::<Vec<_>>();
        if matches.len() != 1
            || !matches[0]["kind"]
                .as_str()
                .is_some_and(|kind| matches!(kind, "oracle" | "binary"))
        {
            return Err(invalid(
                "declared execution requirement has no exact SDK executable contract",
            ));
        }
    }
    Ok(())
}

fn proof_audit(
    index: &ProofAudits<'_>,
    member: &Member,
    semantic: &Value,
) -> Result<(), PrismError> {
    let (declaration, name) = index.sources.get(member).ok_or_else(|| {
        invalid("required theorem declaration absent from retained source snapshot")
    })?;
    if declaration.kind() != "theorem"
        || declaration.linked_ir() != semantic
        || semantic.get("statement").is_none()
        || semantic.get("proof").is_none()
    {
        return Err(invalid(
            "required theorem proposition or proof differs from retained source snapshot",
        ));
    }
    let audit = index
        .audits
        .get(name)
        .ok_or_else(|| invalid("required theorem is absent from the retained kernel audit"))?;
    let policy = serde_json::to_value(declaration.axiom_policy())
        .map_err(|error| invalid(error.to_string()))?;
    if audit["result"] != "ok" || audit["policy"] != policy {
        return Err(invalid(
            "required theorem does not match its retained kernel audit and axiom policy",
        ));
    }
    let observed = audit["observed"]
        .as_array()
        .ok_or_else(|| invalid("required theorem observed axioms absent"))?;
    let permitted = match declaration.axiom_policy().kind() {
        "none" => observed.is_empty() && declaration.axiom_policy().axioms().is_empty(),
        "exact" => {
            observed.iter().all(Value::is_string)
                && observed.iter().filter_map(Value::as_str).eq(declaration
                    .axiom_policy()
                    .axioms()
                    .iter()
                    .map(String::as_str))
        }
        "allow" => observed.iter().all(|axiom| {
            axiom.as_str().is_some_and(|axiom| {
                declaration
                    .axiom_policy()
                    .axioms()
                    .iter()
                    .any(|allowed| allowed == axiom)
            })
        }),
        _ => false,
    };
    if !permitted {
        return Err(invalid(
            "required theorem violates its declared axiom policy",
        ));
    }
    Ok(())
}

fn declared_members(
    projection: &Projection,
    sdk_modules: &BTreeSet<String>,
) -> Result<BTreeSet<Member>, PrismError> {
    let kinds = [
        "ProofRequirement",
        "ExecutionRequirement",
        "AssessmentRequirement",
    ];
    let mut members = BTreeSet::new();
    for (member, declaration) in &projection.definitions {
        if sdk_modules.contains(&member.module) || declaration["kind"] != "definition" {
            continue;
        }
        let result = &declaration["result"];
        let owner = result
            .pointer("/member/module")
            .and_then(Value::as_str)
            .unwrap_or(&member.module);
        let selected = result["kind"] == "named"
            && owner == sdk_source::LINKAGE
            && result
                .pointer("/member/name")
                .and_then(Value::as_str)
                .is_some_and(|name| kinds.contains(&name));
        if !selected {
            continue;
        }
        if !result["arguments"].as_array().is_some_and(Vec::is_empty)
            || !declaration["parameters"]
                .as_array()
                .is_some_and(Vec::is_empty)
        {
            return Err(invalid(
                "declared publication requirements must be exact nongeneric closed source values",
            ));
        }
        members.insert(member.clone());
    }
    Ok(members)
}

pub(super) fn validate(
    captured: &VerifiedReleaseCapture,
    snapshot: &SemanticSnapshot,
    projection: &Projection,
    sdk_modules: &BTreeSet<String>,
    corpora: &super::corpora::CapturedCorpora,
) -> Result<(), PrismError> {
    let obligations = rows_field(
        projection
            .value
            .field("declaration")?
            .field("obligations")?,
        64,
        4096,
        "items",
    )?;
    let requirements = rows(projection.value.field("requirements")?, 64, 4096)?;
    if obligations.len() < 2 || requirements.len() != obligations.len() {
        return Err(invalid(
            "publication requirements do not exactly cover declaration obligations",
        ));
    }
    let expected = declared_members(projection, sdk_modules)?;
    let mut selected = BTreeSet::new();
    let mut proof_audits = None;
    let mut checked_proofs = BTreeSet::new();
    let mut previous = 0;
    for (obligation, requirement) in obligations.iter().zip(requirements) {
        let id = natural(obligation.field("id")?)?;
        if id <= previous || natural(requirement.field("obligation")?)? != id {
            return Err(invalid(
                "publication obligation/requirement ordering or identity differs",
            ));
        }
        previous = id;
        let member = requirement.field("member")?.member()?;
        if !expected.contains(&member) || !selected.insert(member.clone()) {
            return Err(invalid(
                "publication requirement selects a foreign or duplicate source member",
            ));
        }
        let (assurance, _) = variant(obligation.field("assurance")?)?;
        let expected_kind = match assurance {
            0 => 0,
            1 | 2 | 3 | 4 | 6 => 1,
            5 | 7 => 2,
            _ => return Err(invalid("unknown publication assurance")),
        };
        let (kind, fields) = variant(requirement.field("requirement")?)?;
        if kind != expected_kind
            || fields.len() != 1
            || projection.closed_member(&member)? != fields[0]
        {
            return Err(invalid(
                "publication requirement kind or actual source definition differs",
            ));
        }
        match kind {
            0 => {
                let theorem = fields[0].field("theorem")?.member()?;
                let declaration = projection.definitions.get(&theorem).ok_or_else(|| {
                    invalid("required source theorem is absent from the proved graph")
                })?;
                if declaration["kind"] != "theorem" {
                    return Err(invalid("source proof requirement must identify an audited theorem, not a Boolean definition"));
                }
                if checked_proofs.insert(theorem.clone()) {
                    if proof_audits.is_none() {
                        proof_audits = Some(ProofAudits::from_capture(captured, snapshot)?);
                    }
                    proof_audit(
                        proof_audits.as_ref().expect("initialized proof index"),
                        &theorem,
                        declaration,
                    )?;
                }
            }
            1 => {
                let oracle = identifier(fields[0].field("oracle")?)?;
                let matches = captured.standards_lock.value()["oracles"]
                    .as_array()
                    .ok_or_else(|| invalid("captured oracle contracts absent"))?
                    .iter()
                    .filter(|row| row["id"] == oracle)
                    .collect::<Vec<_>>();
                if matches.len() != 1 {
                    return Err(invalid(
                        "execution requirement oracle contract is absent or ambiguous",
                    ));
                }
                let contract = matches[0];
                corpora.require(&oracle, contract)?;
                let corpus = contract
                    .pointer("/corpus/sha256")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        invalid(
                            "execution requirement has no actual retained oracle corpus identity",
                        )
                    })?;
                if fields[0].field("suite")? != &Literal::Bytes(hex_bytes(corpus, 32)?) {
                    return Err(invalid(
                        "execution requirement corpus differs from the captured oracle contract",
                    ));
                }
                sdk_executable(
                    captured.sdk_lock.value(),
                    contract["executable"]
                        .as_str()
                        .ok_or_else(|| invalid("oracle executable absent"))?,
                )?;
                let (selector, input) = variant(fields[0].field("input")?)?;
                match (selector, input) {
                    (0, [path]) => {
                        let path = path.text()?;
                        if !captured.build_files.contains_key(path) {
                            return Err(invalid(
                                "execution requirement selects an absent captured build artifact",
                            ));
                        }
                    }
                    (1, [member]) => {
                        if !projection.definitions.contains_key(&member.member()?) {
                            return Err(invalid(
                                "execution requirement selects an absent source member",
                            ));
                        }
                    }
                    (2, []) => {} // Selected target+all declaration target fields were bound above.
                    _ => return Err(invalid("execution input selector is malformed")),
                }
            }
            2 => {
                for name in ["criterion", "subject"] {
                    let value = fields[0].field(name)?.text()?;
                    if value.is_empty() || value.len() > 2048 {
                        return Err(invalid("assessment requirement omits its explicit bounded criterion or subject"));
                    }
                }
            }
            _ => unreachable!("closed source requirement kind was checked"),
        }
    }
    if selected != expected {
        return Err(invalid(
            "source publication omits declared execution/assessment requirements",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Existing recorded compiler fixtures exercise this indexing boundary only;
    // they are not a freshly replayed release or a manufactured capture factory.
    fn recorded() -> (SemanticSnapshot, Vec<u8>, Member) {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/golden/stdlib");
        let snapshot = serde_json::from_slice(
            &std::fs::read(root.join("build/lexlean/snapshot.json")).unwrap(),
        )
        .unwrap();
        let audit = std::fs::read(root.join("verified/lexlean-attestation.json")).unwrap();
        let member = Member {
            module: "Foundation.Arch".to_owned(),
            name: "componentIdentityUnique".to_owned(),
        };
        (snapshot, audit, member)
    }

    #[test]
    fn retained_audit_is_parsed_once_for_the_complete_requirement_cardinality() {
        let (snapshot, audit, member) = recorded();
        AUDIT_PARSE_COUNT.with(|count| count.set(0));
        let index = ProofAudits::parse(&snapshot, &audit).unwrap();
        let semantic = index.sources[&member].0.linked_ir();
        for _ in 0..4096 {
            proof_audit(&index, &member, semantic).unwrap();
        }
        AUDIT_PARSE_COUNT.with(|count| assert_eq!(count.get(), 1));
    }

    #[test]
    fn audit_index_rejects_missing_duplicate_changed_policy_and_source_records() {
        let (snapshot, audit, member) = recorded();
        let original: Value = serde_json::from_slice(&audit).unwrap();
        let index = ProofAudits::parse(&snapshot, &audit).unwrap();
        let (declaration, name) = &index.sources[&member];
        let semantic = declaration.linked_ir();
        for defect in [
            "missing",
            "duplicate",
            "policy",
            "observed",
            "result",
            "unnamed",
        ] {
            let mut changed = original.clone();
            let rows = changed["declarations"].as_array_mut().unwrap();
            let position = rows.iter().position(|row| row["name"] == *name).unwrap();
            match defect {
                "missing" => {
                    rows.remove(position);
                }
                "duplicate" => {
                    rows.push(rows[position].clone());
                }
                "policy" => rows[position]["policy"] = json!({"kind":"allow","axioms":[]}),
                "observed" => rows[position]["observed"] = json!(["False.elim"]),
                "result" => rows[position]["result"] = json!("error"),
                "unnamed" => rows[position]["name"] = json!(""),
                _ => unreachable!(),
            }
            let result = ProofAudits::parse(&snapshot, &serde_json::to_vec(&changed).unwrap())
                .and_then(|index| proof_audit(&index, &member, semantic));
            assert!(result.is_err(), "{defect}");
        }
        let mut wrong_proposition = semantic.clone();
        wrong_proposition
            .as_object_mut()
            .unwrap()
            .remove("statement");
        assert!(proof_audit(&index, &member, &wrong_proposition).is_err());
        let absent = Member {
            module: member.module.clone(),
            name: "absentTheorem".to_owned(),
        };
        assert!(proof_audit(&index, &absent, semantic).is_err());
        let (definition, (declaration, _)) = index
            .sources
            .iter()
            .find(|(_, (declaration, _))| declaration.kind() == "definition")
            .unwrap();
        assert!(proof_audit(&index, definition, declaration.linked_ir()).is_err());
        let mut duplicated_source = serde_json::to_value(&snapshot).unwrap();
        let rows = duplicated_source["modules"][0]["declarations"]
            .as_array_mut()
            .unwrap();
        rows.push(rows[0].clone());
        let duplicated_source = serde_json::from_value(duplicated_source).unwrap();
        assert!(ProofAudits::parse(&duplicated_source, &audit).is_err());
        for malformed in [b"null".as_slice(), b"{}", b"{\"declarations\":{}}"] {
            assert!(ProofAudits::parse(&snapshot, malformed).is_err());
        }
    }
}
