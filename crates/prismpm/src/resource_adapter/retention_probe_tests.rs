//! Private /2 component: actual typed source, NativeLibrary verification, native
//! consumer and wasm-bindgen execution. No new public exporter/profile receipt.
use crate::controller::VerifyRequest;
use crate::holo::model_document::ModelDocument;
use crate::library_build::{regular_bytes, write};
use crate::verification::{executable, run_process, run_process_limited_allowed, ProcessRecord};
use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};

fn copy_tree(source: &Path, target: &Path) {
    std::fs::create_dir_all(target).unwrap();
    for row in std::fs::read_dir(source).unwrap() {
        let row = row.unwrap();
        if matches!(
            row.file_name().to_str(),
            Some(".prism" | ".lexlean" | ".lake")
        ) {
            continue;
        }
        let path = target.join(row.file_name());
        if row.file_type().unwrap().is_dir() {
            copy_tree(&row.path(), &path);
        } else {
            assert!(row.file_type().unwrap().is_file());
            std::fs::copy(row.path(), path).unwrap();
        }
    }
}
fn retain_record(work: &Path, name: &str, record: &ProcessRecord) {
    write(
        &work.join(format!("{name}.json")),
        &serde_json::to_vec_pretty(record).unwrap(),
    )
    .unwrap();
}
fn command(
    work: &Path,
    name: &str,
    program: &Path,
    args: &[String],
    cwd: &Path,
    env: &BTreeMap<String, String>,
) -> ProcessRecord {
    let record = run_process(
        name,
        program,
        args,
        cwd,
        env,
        &[(work, "$RETENTION_COMPONENT")],
        "PP5203",
    )
    .unwrap_or_else(|error| {
        write(
            &work.join(format!("{name}-failure.txt")),
            format!("{error:?}").as_bytes(),
        )
        .unwrap();
        panic!("{name}: {error:?}; retained {}", work.display());
    });
    retain_record(work, name, &record);
    record
}
fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| (*v).to_owned()).collect()
}

// Concrete fixture binding only; this is not a public descriptor projector.
fn descriptor_binding(
    snapshot: &serde_json::Value,
    library: &crate::holo::model_document::ModelLibrary,
) -> Result<(), &'static str> {
    let fail = "source descriptor/nominal/export binding";
    let modules = snapshot["modules"].as_array().ok_or(fail)?;
    let module = modules
        .iter()
        .find(|m| m["lean_module"] == "LibraryProbe.Probe")
        .ok_or(fail)?;
    let declarations = module["declarations"].as_array().ok_or(fail)?;
    let declaration = |name: &str| {
        declarations
            .iter()
            .find(|d| d["logical_id"] == name)
            .map(|d| &d["linked_ir"])
            .ok_or(fail)
    };
    let descriptor = declaration("resourceAdapter")?;
    if descriptor["kind"] != "definition"
        || !descriptor["parameters"].as_array().ok_or(fail)?.is_empty()
        || descriptor
            .pointer("/result/member/module")
            .and_then(serde_json::Value::as_str)
            != Some("Foundation.Stream.V2.Model")
        || descriptor
            .pointer("/result/member/name")
            .and_then(serde_json::Value::as_str)
            != Some("ResourceAdapter")
        || descriptor["body"]["kind"] != "record"
    {
        return Err(fail);
    }
    let expected = [
        ("profile", "prismpm/private-resource-component/2"),
        ("configDecodeRoot", "LibraryProbe.Probe.configDecode"),
        ("eventDecodeRoot", "LibraryProbe.Probe.eventDecode"),
        ("initRoot", "LibraryProbe.Probe.init"),
        ("advanceRoot", "LibraryProbe.Probe.advance"),
        ("requestReleaseRoot", "LibraryProbe.Probe.requestRelease"),
        (
            "observationEncodeRoot",
            "LibraryProbe.Probe.observationEncode",
        ),
    ];
    let fields = descriptor["body"]["fields"].as_array().ok_or(fail)?;
    if fields.len() != expected.len() {
        return Err(fail);
    }
    for (field, value) in expected {
        let rows = fields
            .iter()
            .filter(|row| row["field"] == field)
            .collect::<Vec<_>>();
        if rows.len() != 1
            || rows[0]["value"]["kind"] != "string"
            || rows[0]["value"]["value"] != value
        {
            return Err(fail);
        }
        if field != "profile" {
            if !library.export_roots.iter().any(|root| root == value) {
                return Err(fail);
            }
            let function = declaration(value.rsplit('.').next().ok_or(fail)?)?;
            if function["kind"] != "definition" {
                return Err(fail);
            }
        }
    }
    for name in [
        "Config",
        "State",
        "Event",
        "Observation",
        "Transition",
        "Status",
        "Phase",
        "Pending",
    ] {
        let ty = declaration(name)?;
        if !["structure", "inductive"]
            .iter()
            .any(|kind| ty["kind"] == *kind)
            || !ty["type_parameters"].as_array().ok_or(fail)?.is_empty()
            || !ty["parameters"].as_array().ok_or(fail)?.is_empty()
        {
            return Err(fail);
        }
    }
    let transition = declaration("Transition")?;
    for (field, nominal) in [("owner", "State"), ("observation", "Observation")] {
        let field = transition["fields"]
            .as_array()
            .ok_or(fail)?
            .iter()
            .find(|row| row["name"] == field)
            .ok_or(fail)?;
        if field["type"]["kind"] != "named"
            || field
                .pointer("/type/member/name")
                .and_then(serde_json::Value::as_str)
                != Some(nominal)
            || field
                .pointer("/type/member/module")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|owner| Some(owner) != module["name"].as_str())
            || !field["type"]["arguments"]
                .as_array()
                .ok_or(fail)?
                .is_empty()
        {
            return Err(fail);
        }
    }
    Ok(())
}

#[test]
fn source_owned_retention_cleanup_and_release_execute_in_native_and_wasm() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    // Deliberately retain ALL outputs, including failures/uncertain compiler
    // custody roots. The producer owns later evidence packaging/retirement.
    let work = tempfile::Builder::new()
        .prefix("prism-retention-v2-")
        .tempdir()
        .unwrap()
        .keep();
    println!("retained private resource /2 workspace: {}", work.display());
    let project = work.join("project");
    copy_tree(
        &root.join("tests/fixtures/library/native-library/project"),
        &project,
    );
    copy_tree(
        &root.join("tests/fixtures/stream/resource-retention-v2/project"),
        &project,
    );
    let receipt = crate::Controller::load(&project)
        .unwrap()
        .verify(VerifyRequest { config_path: None })
        .unwrap_or_else(|error| {
            write(
                &work.join("source-verify-failure.txt"),
                format!("{error:?}").as_bytes(),
            )
            .unwrap();
            panic!("actual source/native verification: {error:?}");
        });
    write(
        &work.join("genuine-native-library-receipt.json"),
        &serde_json::to_vec_pretty(&receipt).unwrap(),
    )
    .unwrap();
    let build = project.join(".prism/build").join(&receipt.build_id);
    let model: ModelDocument =
        serde_json::from_slice(&regular_bytes(&build, "model.prism.json").unwrap()).unwrap();
    let library = model.library.as_ref().unwrap();
    let snapshot: serde_json::Value =
        serde_json::from_slice(&regular_bytes(&build, "lexlean/snapshot.json").unwrap()).unwrap();
    descriptor_binding(&snapshot, library).expect("actual bound source descriptor");
    let mut controls = Vec::new();
    for role in [
        "profile",
        "configDecodeRoot",
        "eventDecodeRoot",
        "initRoot",
        "advanceRoot",
        "requestReleaseRoot",
        "observationEncodeRoot",
    ] {
        let mut mutant = snapshot.clone();
        let module = mutant["modules"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|m| m["lean_module"] == "LibraryProbe.Probe")
            .unwrap();
        let descriptor = module["declarations"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|d| d["logical_id"] == "resourceAdapter")
            .unwrap();
        let field = descriptor["linked_ir"]["body"]["fields"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|r| r["field"] == role)
            .unwrap();
        // Select another genuine exported function, not merely a missing name.
        field["value"]["value"] = serde_json::json!(if role == "profile" {
            "prismpm/private-resource-component/1"
        } else if role == "advanceRoot" {
            "LibraryProbe.Probe.init"
        } else {
            "LibraryProbe.Probe.advance"
        });
        assert_eq!(
            descriptor_binding(&mutant, library),
            Err("source descriptor/nominal/export binding")
        );
        controls.push(role);
    }
    let mut missing = library.clone();
    missing
        .export_roots
        .retain(|root| root != "LibraryProbe.Probe.advance");
    assert!(descriptor_binding(&snapshot, &missing).is_err());
    controls.push("missing-export");
    write(
        &work.join("descriptor-binding-controls.json"),
        &serde_json::to_vec_pretty(&controls).unwrap(),
    )
    .unwrap();
    let generated =
        String::from_utf8(regular_bytes(&build, "library/package/src/lib.rs").unwrap()).unwrap();
    // Mathematical totality is insufficient: these exact generated APIs MUST
    // be infallible before the facade can use this bounded first-slice shape.
    for signature in [
        "pub fn configDecode(bytes: alloc::vec::Vec<u8>) -> crate::Config",
        "pub fn eventDecode(bytes: alloc::vec::Vec<u8>) -> crate::Event",
        "pub fn init(config: &crate::Config) -> crate::Transition",
        "pub fn observationEncode(observation: &crate::Observation) -> alloc::vec::Vec<u8>",
        "pub fn requestRelease(state: &crate::State) -> crate::Transition",
        "pub fn advance(state: &crate::State, event: crate::Event) -> Result<crate::Transition, crate::ComputeError>",
    ] {
        assert!(
            generated.contains(signature),
            "actual generated signature gate failed: {signature}; retained {}",
            work.display()
        );
    }
    let component = work.join("component");
    let archive = regular_bytes(
        &build,
        &format!(
            "library/{}-{}.crate",
            library.cargo_name, library.cargo_version
        ),
    )
    .unwrap();
    let cargo_home =
        crate::library_verification::registry_cargo_home(&component, library, &archive).unwrap();
    tar::Archive::new(Cursor::new(include_bytes!(
        "../../../../vendor/registry.tar"
    )))
    .unpack(component.join("registry"))
    .unwrap();
    let mut env = BTreeMap::from([
        (
            "CARGO_HOME".to_owned(),
            cargo_home.to_string_lossy().into_owned(),
        ),
        ("CARGO_NET_OFFLINE".to_owned(), "true".to_owned()),
        ("CARGO_INCREMENTAL".to_owned(), "0".to_owned()),
        ("CARGO_PROFILE_DEV_DEBUG".to_owned(), "0".to_owned()),
        ("CARGO_BUILD_JOBS".to_owned(), "2".to_owned()),
    ]);
    let cargo = executable("cargo").unwrap();
    let dependency = format!(
        "prism_resource_core = {{package={:?},version={:?}}}\n",
        library.cargo_name,
        format!("={}", library.cargo_version)
    );
    let native = component.join("native");
    write(&native.join("Cargo.toml"),format!("[package]\nname=\"retention-native\"\nversion=\"0.1.0\"\nedition=\"2021\"\npublish=false\n\n[dependencies]\n{dependency}\n[profile.dev]\npanic=\"abort\"\ndebug=0\n\n[[bin]]\nname=\"affinity-refusal\"\npath=\"src/affinity.rs\"\n").as_bytes()).unwrap();
    write(
        &native.join("src/main.rs"),
        include_bytes!("retention_probe_native.rs.in"),
    )
    .unwrap();
    let core = include_str!("retention_probe_core.rs.in");
    write(&native.join("src/ownership.rs"), core.as_bytes()).unwrap();
    write(&native.join("src/affinity.rs"),b"mod ownership;\nfn main(){let (owner,_)=ownership::Owner::begin(vec![1]).unwrap();std::thread::spawn(move||drop(owner));}\n").unwrap();
    env.insert(
        "CARGO_TARGET_DIR".to_owned(),
        component
            .join("native-target")
            .to_string_lossy()
            .into_owned(),
    );
    command(
        &work,
        "native-lock",
        &cargo,
        &args(&["generate-lockfile", "--offline"]),
        &native,
        &env,
    );
    command(
        &work,
        "native-build",
        &cargo,
        &args(&[
            "build",
            "--locked",
            "--offline",
            "--bin",
            "retention-native",
        ]),
        &native,
        &env,
    );
    let binary = component.join("native-target/debug/retention-native");
    let positive = command(&work, "native-positive", &binary, &[], &native, &env);
    assert!(positive
        .stdout
        .starts_with("private generated retained-state native component passed:"));
    assert!(positive.stderr.is_empty());
    // Each mutant MUST first compile successfully, then fail at its exact
    // intended normal-flow invariant with explicit42 (no panic/unwind lane).
    for (index, (before, after, marker)) in [
        (
            "if self.release_authorized && !blocked() && !std::thread::panicking() {",
            "if true {",
            "ungranted wrapper Drop must quarantine actual State",
        ),
        (
            "self.release_authorized = authorized;",
            "self.release_authorized = true;",
            "source refused early release",
        ),
        (
            "CHECKED_FAILURE.with(|held| held.set(true));",
            "drop(self.state.take()); CHECKED_FAILURE.with(|held| held.set(true));",
            "known pre-call owner must survive checked error",
        ),
        (
            "self.release_authorized && !blocked() && !std::thread::panicking()",
            "self.release_authorized && !std::thread::panicking()",
            "checked failure must invalidate prior release grant",
        ),
    ]
    .iter()
    .enumerate()
    {
        assert_eq!(core.matches(before).count(), 1);
        write(
            &native.join("src/ownership.rs"),
            core.replacen(before, after, 1).as_bytes(),
        )
        .unwrap();
        command(
            &work,
            &format!("native-mutant-{index}-build"),
            &cargo,
            &args(&[
                "build",
                "--locked",
                "--offline",
                "--bin",
                "retention-native",
            ]),
            &native,
            &env,
        );
        let record = run_process_limited_allowed(
            &format!("native-mutant-{index}"),
            &binary,
            &[],
            &native,
            &env,
            &[(&work, "$RETENTION_COMPONENT")],
            "PP5203",
            "30",
            1024 * 1024,
            &[42],
        )
        .unwrap_or_else(|error| {
            write(
                &work.join(format!("native-mutant-{index}-unexpected-failure.txt")),
                format!("{error:?}").as_bytes(),
            )
            .unwrap();
            panic!("unexpected mutant execution failure: {error:?}");
        });
        retain_record(&work, &format!("native-mutant-{index}"), &record);
        assert_eq!(
            record.stderr.trim(),
            *marker,
            "only intended invariant kills mutant"
        );
        assert!(!record.stdout.contains("component passed"));
    }
    write(&native.join("src/ownership.rs"), core.as_bytes()).unwrap();
    command(
        &work,
        "native-restored-build",
        &cargo,
        &args(&[
            "build",
            "--locked",
            "--offline",
            "--bin",
            "retention-native",
        ]),
        &native,
        &env,
    );
    let restored = command(&work, "native-restored", &binary, &[], &native, &env);
    assert_eq!(restored.stdout, positive.stdout);
    assert!(restored.stderr.is_empty());
    // Separate compile-time ownership control, never counted as a runtime
    // killed mutant or a generated-acceptance failure.
    let affinity = run_process_limited_allowed(
        "native-affinity-refusal",
        &cargo,
        &args(&[
            "check",
            "--locked",
            "--offline",
            "--bin",
            "affinity-refusal",
        ]),
        &native,
        &env,
        &[(&work, "$RETENTION_COMPONENT")],
        "PP5203",
        "60",
        1024 * 1024,
        &[101],
    )
    .unwrap_or_else(|error| {
        write(
            &work.join("native-affinity-unexpected-failure.txt"),
            format!("{error:?}").as_bytes(),
        )
        .unwrap();
        panic!("unexpected affinity execution failure: {error:?}");
    });
    retain_record(&work, "native-affinity-refusal", &affinity);
    assert!(
        affinity.stderr.contains("E0277")
            && affinity.stderr.contains("Rc<()>")
            && affinity
                .stderr
                .contains("cannot be sent between threads safely")
    );

    let browser = component.join("browser");
    write(&browser.join("Cargo.toml"),format!("[package]\nname=\"retention-browser\"\nversion=\"0.1.0\"\nedition=\"2021\"\npublish=false\n\n[lib]\ncrate-type=[\"cdylib\"]\n\n[dependencies]\njs-sys=\"=0.3.99\"\nwasm-bindgen=\"=0.2.122\"\n{dependency}\n[profile.release]\npanic=\"abort\"\n").as_bytes()).unwrap();
    write(
        &browser.join("src/lib.rs"),
        include_bytes!("retention_probe_facade.rs.in"),
    )
    .unwrap();
    write(&browser.join("src/ownership.rs"), core.as_bytes()).unwrap();
    env.insert(
        "CARGO_TARGET_DIR".to_owned(),
        component.join("wasm-target").to_string_lossy().into_owned(),
    );
    command(
        &work,
        "wasm-lock",
        &cargo,
        &args(&["generate-lockfile", "--offline"]),
        &browser,
        &env,
    );
    command(
        &work,
        "wasm-build",
        &cargo,
        &args(&[
            "build",
            "--locked",
            "--offline",
            "--release",
            "--target",
            "wasm32-unknown-unknown",
        ]),
        &browser,
        &env,
    );
    let binding = component.join("binding");
    std::fs::create_dir(&binding).unwrap();
    let wasm = component.join("wasm-target/wasm32-unknown-unknown/release/retention_browser.wasm");
    command(
        &work,
        "wasm-bindgen",
        &executable("wasm-bindgen").unwrap(),
        &[
            "--target".into(),
            "web".into(),
            "--out-name".into(),
            "retention".into(),
            "--out-dir".into(),
            binding.to_string_lossy().into_owned(),
            wasm.to_string_lossy().into_owned(),
        ],
        &browser,
        &env,
    );
    write(&binding.join("package.json"), b"{\"type\":\"module\"}\n").unwrap();
    let node = command(
        &work,
        "wasm-node",
        &executable("node").unwrap(),
        &[
            "--expose-gc".into(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("src/resource_adapter/retention_probe.mjs")
                .to_string_lossy()
                .into_owned(),
            root.join("crates/prismpm/src/resource_adapter/retained_runtime_v2.mjs")
                .to_string_lossy()
                .into_owned(),
            binding.join("retention.js").to_string_lossy().into_owned(),
            binding
                .join("retention_bg.wasm")
                .to_string_lossy()
                .into_owned(),
        ],
        &component,
        &BTreeMap::new(),
    );
    assert!(node
        .stdout
        .starts_with("private generated retained-state Wasm component passed:"));
    assert!(node.stderr.is_empty());
    println!("{}", positive.stdout.trim());
    println!("{}", node.stdout.trim());
}
