use super::*;

#[test]
fn seeded_exporter_authority_matches_the_retained_native_execution_platform() {
    // Reader counterexamples, not native execution or SDK acceptance. Distinct
    // inventories make a foreign receipt valid for the other locked platform.
    let register: toml::Value =
        toml::from_str(include_str!("../../model/dependencies.toml")).unwrap();
    let compiler = register["dependency"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"].as_str() == Some("lean4-prod"))
        .unwrap();
    let revision = compiler["revision"].as_str().unwrap();
    let toolchain = format!(
        "leanprover/lean4:v{}",
        compiler["lean_version"].as_str().unwrap()
    );
    let archive = hex(include_bytes!("../../vendor/lean4-prod/lean.tar"));
    let mut platforms = Vec::new();
    let mut children = Vec::new();
    let mut executions = Vec::new();
    for (index, architecture) in ["amd64", "arm64"].into_iter().enumerate() {
        let child = hex(format!("{architecture} child fixture").as_bytes());
        let seed = hex(format!("{architecture} seed fixture").as_bytes());
        let artifacts = json!([
            {"id":"lean4-prod-exporter","kind":"binary","version":revision,"digest":format!("sha256:{child}")},
            {"id":"lean4-prod-exporter-seed","kind":"dependency-lock","version":"1","digest":format!("sha256:{seed}")}
        ]);
        let document = String::from_utf8(encode_value(&json!({
            "schema":"prismpm/sdk-inventory/1","artifacts":artifacts,
            "commands":[{"command":"lake","executable":"/usr/local/bin/lake","sha256":"c".repeat(64)}]
        })).unwrap()).unwrap();
        let inventory = hex(document.as_bytes());
        let manifest = format!(
            "sha256:{}",
            hex(format!("{architecture} manifest fixture").as_bytes())
        );
        children.push(json!({"digest":manifest,"size":100,"mediaType":"application/vnd.oci.image.manifest.v1+json",
            "platform":{"os":"linux","architecture":architecture}}));
        platforms.push(json!({"platform":format!("linux/{architecture}"),"manifest_digest":manifest,
            "inventory_digest":format!("sha256:{inventory}"),"inventory_document":document,"inventory":artifacts}));
        executions.push(json!({"schema":"prismpm/exporter-execution/1","source_archive_sha256":archive,
            "executable":{"byte_length":1234+index,"mode":0o755,"sha256":child},
            "acquisition":{"schema":"prismpm/exporter-acquisition/1","mode":"sdk-seed",
                "compiler_revision":revision,"toolchain":toolchain,"platform":format!("linux/{architecture}"),
                "archive_sha256":archive,"inventory_sha256":inventory,"manifest_sha256":seed,"executable_sha256":child}}));
    }
    let index = String::from_utf8(
        encode_value(&json!({"schemaVersion":2,
        "mediaType":"application/vnd.oci.image.index.v1+json","manifests":children}))
        .unwrap(),
    )
    .unwrap();
    let lock = json!({"schema":"prismpm/sdk-lock/2","sdk_version":"0.3.0",
        "sdk_image":format!("example.invalid/fixture@sha256:{}",hex(index.as_bytes())),
        "sdk_index":index,"standards_lock":format!("sha256:{}","d".repeat(64)),"platforms":platforms});
    for (native, host) in ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"]
        .into_iter()
        .enumerate()
    {
        let output = [
            format!("Lean (version 4.32.1, {host}, commit f054605aea4b840552cca2e725580bffd1e1b704, Release)\n"),
            "Lake version 5.0.0-src+f054605 (Lean version 4.32.1)\n".to_owned(),
            "rustfmt 1.9.0-stable (8bab26f4f6 2026-07-14)\n".to_owned(),
            format!("commit-hash: 8bab26f4f68e0e26f0bb7960be334d5b520ea452\nhost: {host}\nrelease: 1.97.1\n"),
            "timeout (GNU coreutils) 9.4\n".to_owned(),
        ];
        let mut processes: Vec<_> = PREFLIGHT.iter().zip(output).map(|(tool, stdout)| json!({
            "tool":tool,"argv":if *tool=="rustc-version" {vec!["--version","--verbose"]} else {vec!["--version"]},
            "executable_sha256":"e".repeat(64),"exit_code":0,"stdout":stdout,"stderr":""
        })).collect();
        process_order(&processes, &PREFLIGHT).unwrap();
        processes.push(json!({"tool":"prod-export","argv":["exe","prod-export"],"executable_sha256":"e".repeat(64),
            "exit_code":0,"stdout":"","stderr":"","exporter":executions[native]}));
        let retained = |rows: &[Value]| {
            BTreeMap::from([(
                "manifest.json".to_owned(),
                encode_value(&json!({"processes":rows})).unwrap(),
            )])
        };
        validate_exporter_authority(&retained(&processes), &lock).unwrap();
        let original = processes.clone();
        processes.last_mut().unwrap()["exporter"] = executions[1 - native].clone();
        let error = validate_exporter_authority(&retained(&processes), &lock)
            .expect_err("foreign locked exporter cannot replace the retained native execution");
        assert!(error.message.contains("platform"), "{}", error.message);
        let mut mixed = original.clone();
        mixed.push(processes.last().unwrap().clone());
        assert!(validate_exporter_authority(&retained(&mixed), &lock).is_err());
        for omitted in 0..PREFLIGHT.len() {
            let mut incomplete = original.clone();
            incomplete.remove(omitted);
            assert!(validate_exporter_authority(&retained(&incomplete), &lock).is_err());
        }
        let mut swapped = original.clone();
        swapped.swap(0, 1);
        assert!(validate_exporter_authority(&retained(&swapped), &lock).is_err());
        let mut conflicting = original.clone();
        conflicting[3]["stdout"] =
            json!(format!(
            "commit-hash: 8bab26f4f68e0e26f0bb7960be334d5b520ea452\nhost: {}\nrelease: 1.97.1\n",
            if native == 0 { "aarch64-unknown-linux-gnu" } else { "x86_64-unknown-linux-gnu" }
        ));
        assert!(validate_exporter_authority(&retained(&conflicting), &lock).is_err());
        let mut cold = original;
        cold.last_mut().unwrap()["exporter"]["acquisition"] = crate::exporter::cold_acquisition();
        validate_exporter_authority(&retained(&cold), &lock).unwrap();
    }
}

#[test]
fn exporter_process_evidence_requires_the_actual_child_and_pinned_archive() {
    let exporter = json!({
        "schema":"prismpm/exporter-execution/1",
        "source_archive_sha256":hex(include_bytes!("../../vendor/lean4-prod/lean.tar")),
        "acquisition":crate::exporter::cold_acquisition(),
        "executable":{"byte_length":1234,"mode":0o755,"sha256":"b".repeat(64)}
    });
    let record = json!({"tool":"prod-export","argv":["exe","prod-export"],
        "executable_sha256":"a".repeat(64),"exit_code":0,"stdout":"","stderr":"", "exporter":exporter});
    process_records(&json!([record.clone()]), false).unwrap();
    for (pointer, value) in [
        ("/exporter", Value::Null),
        ("/exporter/source_archive_sha256", json!("c".repeat(64))),
        ("/exporter/schema", json!("other")),
        ("/exporter/acquisition", Value::Null),
        ("/exporter/acquisition/mode", json!("sdk-seed")),
        ("/exporter/executable/byte_length", json!(0)),
        ("/exporter/executable/byte_length", json!(268435457_u64)),
        ("/exporter/executable/mode", json!(0o644)),
        ("/exporter/executable/mode", json!(0o4755)),
        ("/exporter/executable/sha256", json!("invalid")),
        ("/argv", json!(["build", "prod-export"])),
    ] {
        let mut changed = record.clone();
        *changed.pointer_mut(pointer).unwrap() = value;
        assert!(
            process_records(&json!([changed]), false).is_err(),
            "accepted {pointer}"
        );
    }
    let mut missing = record.clone();
    missing.as_object_mut().unwrap().remove("exporter");
    assert!(process_records(&json!([missing]), false).is_err());
    let mut extra = record;
    extra["exporter"]["extra"] = json!(true);
    assert!(process_records(&json!([extra]), false).is_err());
}

#[test]
fn evidence_paths_reject_aliases_and_escape() {
    for path in [
        "",
        "/manifest.json",
        "../x",
        "a/../x",
        "./x",
        "a//x",
        "a/./x",
        "a\\x",
        "a/",
        "a\0x",
    ] {
        assert!(safe_path(path).is_err(), "accepted {path:?}");
    }
    safe_path("proof/nested/manifest.json").unwrap();
}

#[test]
fn evidence_json_preserves_lexlean_framing_and_rejects_duplicate_keys() {
    for bytes in [
        b"{\"a\":1,\"a\":1}".as_slice(),
        b"{ \"a\":1}",
        b"{\"a\":1}\n",
    ] {
        assert!(canonical_json(bytes, false).is_err());
    }
    assert!(canonical_json(b"{\"a\":1}", true).is_err());
    assert!(canonical_json(b"{\"a\":1}\n\n", true).is_err());
    canonical_json(b"{\"a\":1}\n", true).unwrap();
    canonical_json(b"{\"a\":1}", false).unwrap();
}

#[test]
fn evidence_descriptors_bind_size_hash_and_closed_fields() {
    let bytes = b"retained evidence";
    let valid = json!({"byte_length":bytes.len(), "sha256":hex(bytes)});
    descriptor(&valid, bytes).unwrap();
    for changed in [
        json!({"byte_length":bytes.len()+1, "sha256":hex(bytes)}),
        json!({"byte_length":bytes.len(), "sha256":"0".repeat(64)}),
        json!({"byte_length":bytes.len(), "sha256":hex(bytes), "passed":true}),
    ] {
        assert!(descriptor(&changed, bytes).is_err());
    }
}

#[test]
fn native_export_framing_is_the_imported_named_export_format() {
    let bytes = b"{\n  \"included_definitions\": [\"PrismPM.root\"],\n  \"requested_roots\": [\"PrismPM.root\"]\n}\n";
    let value = named_export_json(bytes).unwrap();
    assert!(named_export_json(&encode_value(&value).unwrap()).is_err());
    assert!(named_export_json(b"{\n  \"a\": [],\n  \"a\": []\n}\n").is_err());
}

/// The owning runtime test supplies genuinely produced evidence. No synthetic
/// record can establish the baseline used by these coherent mutations.
pub(crate) fn reject_mutations(
    build_manifest: &[u8],
    build_files: &BTreeMap<String, Vec<u8>>,
    verification_files: &BTreeMap<String, Vec<u8>>,
) {
    let binding = validate(build_manifest, build_files, verification_files).unwrap();
    let rejected_build = |manifest: &[u8], files: &BTreeMap<String, Vec<u8>>, expected: &str| {
        let error = validate(manifest, files, verification_files).unwrap_err();
        assert_eq!(error.code, "PP6101");
        assert!(error.message.contains(expected), "{}", error.message);
    };
    let rejected = |files: &BTreeMap<String, Vec<u8>>, expected: &str| {
        let error = validate(build_manifest, build_files, files).unwrap_err();
        assert_eq!(error.code, "PP6101");
        assert!(error.message.contains(expected), "{}", error.message);
    };
    if binding.family == "application" {
        let original = canonical_json(build_manifest, false).unwrap();
        let mut legacy = original.clone();
        legacy["inputs"]["schema"] = json!("prismpm/build-inputs/1");
        legacy["inputs"]
            .as_object_mut()
            .unwrap()
            .remove("application_artifacts_sha256");
        rejected_build(
            &encode_value(&legacy).unwrap(),
            build_files,
            "legacy application build inputs lack artifact closure",
        );
        for schema in [json!("prismpm/build-inputs/3"), Value::Null] {
            let mut build = original.clone();
            build["inputs"]["schema"] = schema;
            rejected_build(
                &encode_value(&build).unwrap(),
                build_files,
                "unknown build inputs schema",
            );
        }
        let mut extra = original.clone();
        extra["inputs"]["unrecognized"] = json!(true);
        rejected_build(
            &encode_value(&extra).unwrap(),
            build_files,
            "evidence object fields are not closed",
        );
        for replacement in [
            None,
            Some(json!("0".repeat(64))),
            Some(json!("SHA256:invalid")),
        ] {
            let mut build = original.clone();
            if let Some(value) = replacement {
                build["inputs"]["application_artifacts_sha256"] = value;
            } else {
                build["inputs"]
                    .as_object_mut()
                    .unwrap()
                    .remove("application_artifacts_sha256");
            }
            assert_eq!(
                validate(
                    &encode_value(&build).unwrap(),
                    build_files,
                    verification_files
                )
                .unwrap_err()
                .code,
                "PP6101"
            );
        }
        // Rehash a changed actual artifact row, but retain the old build input.
        // File-descriptor integrity alone must not admit an identity collision.
        let path = "application/model-provenance.json";
        let mut bytes = build_files[path].clone();
        bytes.push(b' ');
        let mut files = build_files.clone();
        files.insert(path.into(), bytes.clone());
        let mut build = original;
        let row = build["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|row| row["path"] == path)
            .unwrap();
        row["byte_length"] = json!(bytes.len());
        row["sha256"] = json!(hex(&bytes));
        rejected_build(
            &encode_value(&build).unwrap(),
            &files,
            "application artifact closure",
        );
    } else {
        let original = canonical_json(build_manifest, false).unwrap();
        assert_eq!(original["inputs"]["schema"], "prismpm/build-inputs/1");
        assert!(original["inputs"]
            .get("application_artifacts_sha256")
            .is_none());
    }
    if binding.family == "native" {
        // A genuine successful transcript cannot replace semantic replay.
        // Rebind the outer file descriptor after changing linked source, while
        // retaining its old claimed semantic identity and all process evidence.
        let path = "lexlean/snapshot.json";
        let mut snapshot = canonical_json(&build_files[path], true).unwrap();
        let core = snapshot["modules"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|module| module["name"] == "Foundation.Core")
            .unwrap();
        let definition = core["linked_ir"]["semantic"]["declarations"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|declaration| declaration["name"] == "portableTrue")
            .unwrap();
        assert_eq!(definition["body"], json!({"kind":"bool","value":true}));
        definition["body"]["value"] = json!(false);
        let mut bytes = encode_value(&snapshot).unwrap();
        bytes.push(b'\n');
        let mut build = canonical_json(build_manifest, false).unwrap();
        let descriptor = build["files"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|row| row["path"] == path)
            .unwrap();
        descriptor["byte_length"] = json!(bytes.len());
        descriptor["sha256"] = json!(hex(&bytes));
        let mut files = build_files.clone();
        files.insert(path.into(), bytes);
        rejected_build(
            &encode_value(&build).unwrap(),
            &files,
            "LexLean snapshot semantic recipe differs",
        );
    }
    for name in verification_files.keys() {
        let mut changed = verification_files.clone();
        changed.remove(name);
        rejected(&changed, "verification");
    }
    let mut changed = verification_files.clone();
    changed.insert("undeclared.json".into(), b"{}".to_vec());
    rejected(&changed, "verification");

    let mut manifest = canonical_json(&verification_files["manifest.json"], false).unwrap();
    manifest["build_id"] = json!("0".repeat(64));
    let mut changed = verification_files.clone();
    changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
    rejected(&changed, "build identity");

    for omission in [false, true] {
        let mut manifest = canonical_json(&verification_files["manifest.json"], false).unwrap();
        if omission {
            manifest["processes"].as_array_mut().unwrap().pop();
        } else {
            manifest["processes"][0]["exit_code"] = json!(1);
        }
        let mut changed = verification_files.clone();
        changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
        rejected(&changed, "process");
    }

    let original = canonical_json(&verification_files["manifest.json"], false).unwrap();
    if binding.family == "application" {
        if original["schema"] == "prismpm/application-verification-manifest/2" {
            for (pointer, replacement) in [
                (
                    "/exporter_owner/schema",
                    json!("prismpm/verification-exporter-owner/2"),
                ),
                ("/exporter_owner/phases/0/phase", json!("replay")),
                (
                    "/exporter_owner/phases/0/model_sha256",
                    json!("0".repeat(64)),
                ),
                (
                    "/exporter_owner/phases/0/lexlean_manifest_sha256",
                    json!("0".repeat(64)),
                ),
                (
                    "/exporter_owner/phases/0/artifacts/0/sha256",
                    json!("0".repeat(64)),
                ),
                (
                    "/exporter_owner/phases/0/processes/0/executable_sha256",
                    json!("0".repeat(64)),
                ),
                (
                    "/exporter_owner/phases/0/processes/2/argv",
                    json!(["exe", "prod-export", "--undeclared"]),
                ),
                (
                    "/exporter_owner/phases/0/processes/2/exporter/source_archive_sha256",
                    json!("0".repeat(64)),
                ),
                (
                    "/exporter_owner/phases/1/processes/2/argv",
                    json!(["exe", "prod-export", "--undeclared"]),
                ),
            ] {
                let mut manifest = original.clone();
                *manifest.pointer_mut(pointer).unwrap() = replacement;
                let mut changed = verification_files.clone();
                changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
                assert_eq!(
                    validate(build_manifest, build_files, &changed)
                        .unwrap_err()
                        .code,
                    "PP6101",
                    "{pointer}"
                );
            }
            let mut manifest = original.clone();
            manifest.as_object_mut().unwrap().remove("exporter_owner");
            let mut changed = verification_files.clone();
            changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
            assert_eq!(
                validate(build_manifest, build_files, &changed)
                    .unwrap_err()
                    .code,
                "PP6101"
            );
        }
        // Start from real regenerated evidence, not a fabricated success row.
        let last = original["processes"].as_array().unwrap().len() - 1;
        assert_eq!(original["processes"][last]["tool"], "application-export");
        for mutation in ["order", "extra", "lake", "child", "archive", "acquisition"] {
            let mut manifest = original.clone();
            match mutation {
                "order" => manifest["processes"]
                    .as_array_mut()
                    .unwrap()
                    .swap(last - 1, last - 2),
                "extra" => {
                    let duplicate = manifest["processes"][last].clone();
                    manifest["processes"]
                        .as_array_mut()
                        .unwrap()
                        .push(duplicate);
                }
                "lake" => manifest["processes"][last]["executable_sha256"] = json!("0".repeat(64)),
                "child" => {
                    manifest["processes"][last]["exporter"]["executable"]["sha256"] =
                        json!("0".repeat(64))
                }
                "archive" => {
                    manifest["processes"][last]["exporter"]["source_archive_sha256"] =
                        json!("0".repeat(64))
                }
                "acquisition" => {
                    manifest["processes"][last]["exporter"]
                        .as_object_mut()
                        .unwrap()
                        .remove("acquisition");
                }
                _ => unreachable!(),
            }
            let mut changed = verification_files.clone();
            changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
            let error = validate(build_manifest, build_files, &changed).unwrap_err();
            assert_eq!(error.code, "PP6101", "{mutation}");
        }
    }
    for index in 0..original["processes"].as_array().unwrap().len() {
        let mut manifest = original.clone();
        manifest["processes"][index]["argv"] = json!(["--version"]);
        if manifest == original {
            manifest["processes"][index]["argv"] = json!(["--not-the-required-stage"]);
        }
        let mut changed = verification_files.clone();
        changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
        rejected(&changed, "process");
    }
    let mut manifest = original.clone();
    manifest["processes"][0]["stdout"] = json!("Lean unapproved-version\n");
    let mut changed = verification_files.clone();
    changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
    rejected(&changed, "process");

    // Recompute the LexLean framed identity and the outer descriptor too: an
    // omitted proof audit must fail for its incomplete declaration closure.
    let mut lex = canonical_json(&verification_files["lexlean-attestation.json"], true).unwrap();
    lex["declarations"].as_array_mut().unwrap().pop();
    let mut body = lex.clone();
    body.as_object_mut().unwrap().remove("attestation_id");
    lex["attestation_id"] = json!(lex_ids::attestation_id(
        std::str::from_utf8(&encode_value(&body).unwrap()).unwrap()
    )
    .to_hex());
    let mut lex_bytes = encode_value(&lex).unwrap();
    lex_bytes.push(b'\n');
    let mut manifest = original.clone();
    if binding.family == "application" {
        manifest["lexlean_attestation_sha256"] = json!(hex(&lex_bytes));
    } else {
        manifest["lexlean_attestation_id"] = lex["attestation_id"].clone();
        manifest["artifacts"]["lexlean_attestation"] =
            json!({"byte_length":lex_bytes.len(),"sha256":hex(&lex_bytes)});
    }
    let mut changed = verification_files.clone();
    changed.insert("lexlean-attestation.json".into(), lex_bytes);
    changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
    rejected(&changed, "declaration audit");

    // Rewrite the manifest too: the intended failure is the inner evidence,
    // not a stale outer checksum or an OCI descriptor mismatch.
    let mut changed = verification_files.clone();
    let mut manifest = canonical_json(&changed["manifest.json"], false).unwrap();
    if binding.family == "application" {
        for mutation in 0..4 {
            let path = "application/lexlean-build-manifest.json";
            let mut selected = canonical_json(&build_files[path], true).unwrap();
            match mutation {
                0 => {
                    selected["inputs"].as_array_mut().unwrap().remove(0);
                }
                1 => {
                    let duplicate = selected["inputs"][0].clone();
                    selected["inputs"]
                        .as_array_mut()
                        .unwrap()
                        .insert(0, duplicate);
                }
                2 => {
                    selected["selection"].as_array_mut().unwrap().clear();
                }
                3 => {
                    selected["outputs"].as_array_mut().unwrap().remove(0);
                }
                _ => unreachable!(),
            }
            let mut bytes = encode_value(&selected).unwrap();
            bytes.push(b'\n');
            let mut build = canonical_json(build_manifest, false).unwrap();
            let descriptor = build["files"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|row| row["path"] == path)
                .unwrap();
            descriptor["byte_length"] = json!(bytes.len());
            descriptor["sha256"] = json!(hex(&bytes));
            let mut files = build_files.clone();
            files.insert(path.into(), bytes);
            // Repair the newly bound outer closure and its dependent receipts:
            // the original semantic gate, not a stale build ID, must reject.
            build["inputs"]["application_artifacts_sha256"] =
                json!(hex(&encode_value(&build["files"]).unwrap()));
            let new_build_id = hex(&encode_value(&build["inputs"]).unwrap());
            let mut evidence = verification_files.clone();
            let mut acceptance =
                canonical_json(&evidence["application-acceptance.json"], false).unwrap();
            acceptance["build_id"] = json!(new_build_id);
            let acceptance_bytes = encode_value(&acceptance).unwrap();
            let mut verified = canonical_json(&evidence["manifest.json"], false).unwrap();
            verified["build_id"] = json!(new_build_id);
            verified["acceptance_sha256"] = json!(hex(&acceptance_bytes));
            evidence.insert("application-acceptance.json".into(), acceptance_bytes);
            evidence.insert("manifest.json".into(), encode_value(&verified).unwrap());
            let error = validate(&encode_value(&build).unwrap(), &files, &evidence).unwrap_err();
            assert_eq!(error.code, "PP6101");
            assert!(
                error.message.contains("application selected"),
                "{}",
                error.message
            );
        }
        let mut acceptance =
            canonical_json(&changed["application-acceptance.json"], false).unwrap();
        acceptance["modeled_vectors"] = json!(0);
        let bytes = encode_value(&acceptance).unwrap();
        manifest["acceptance_sha256"] = json!(hex(&bytes));
        changed.insert("application-acceptance.json".into(), bytes);
        changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
        rejected(&changed, "application acceptance");

        let mut changed = verification_files.clone();
        let mut manifest = canonical_json(&changed["manifest.json"], false).unwrap();
        let oracle = manifest["processes"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|row| row["tool"] == "hologram-oracle")
            .unwrap();
        let mut report: Value = serde_json::from_str(oracle["stdout"].as_str().unwrap()).unwrap();
        report["portable_browser"]["skipped"] = json!(1);
        oracle["stdout"] = json!(serde_json::to_string(&report).unwrap());
        changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
        rejected(&changed, "oracle");
    } else {
        let mut execution = canonical_json(&changed["execution.json"], false).unwrap();
        execution["case_count"] = json!(0);
        let bytes = encode_value(&execution).unwrap();
        manifest["execution"] = execution;
        manifest["artifacts"]["execution_evidence"] =
            json!({"byte_length":bytes.len(),"sha256":hex(&bytes)});
        for row in manifest["processes"].as_array_mut().unwrap() {
            if row["tool"] == "generated-validator" {
                row["stdout"] = json!(String::from_utf8(bytes.clone()).unwrap());
            }
        }
        changed.insert("execution.json".into(), bytes);
        changed.insert("manifest.json".into(), encode_value(&manifest).unwrap());
        rejected(&changed, "native execution");
    }
}
