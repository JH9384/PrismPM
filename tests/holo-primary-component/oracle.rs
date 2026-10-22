//! Independent pinned upstream oracle. It never produces the archive executed
//! by the runtime: only the `synthetic` codec fixture uses HoloWriter.
use hologram::archive::{HoloLoader, HoloWriter, SectionKind};
use hologram::space::{address_bytes, AppManifest, Layer, Realization};
use hologram_live::holo::{inspect_bytes, plan_bytes, HoloCatalog, HoloExecutor, HoloRuntime};
use hologram_live::store::ObjectStore;
use serde_json::{json, Value};
use std::{error::Error, fs, sync::Arc};

const COMPONENT: &str = "https://uor.foundation/extension/prismpm-component/v1";
const LIVE: &str = "d8208266d8abdc2445b7bbc0cef412a566adfaf1";
const HOLOGRAM: &str = "2bda6a9a9476872dade705bd61ece4209607f6da";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn manifest(guest: &[u8]) -> AppManifest {
    AppManifest {
        primary: Some(0),
        requires: address_bytes(&hologram_live::holo_capability::empty_canonical()),
        layers: vec![Layer::wasm_with_contract(
            address_bytes(guest),
            "holo_run",
            "hologram:guest/core-wasm@1",
        )],
        children: Vec::new(),
    }
}

fn profile_check(condition: bool, label: &str) -> Result<(), Box<dyn Error>> {
    if condition {
        Ok(())
    } else {
        Err(format!("component profile link mismatch: {label}").into())
    }
}

fn closed(value: &Value, fields: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
        let mut expected = fields.to_vec();
        keys.sort_unstable();
        expected.sort_unstable();
        keys == expected
    })
}

fn digest(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        text.len() == 64
            && text
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn canonical(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonical).collect()),
        Value::Object(object) => {
            let mut rows = object.into_iter().collect::<Vec<_>>();
            rows.sort_by(|left, right| left.0.cmp(&right.0));
            Value::Object(
                rows.into_iter()
                    .map(|(key, value)| (key, canonical(value)))
                    .collect(),
            )
        }
        other => other,
    }
}

fn profile_object(bytes: &[u8], fields: &[&str], label: &str) -> Result<Value, Box<dyn Error>> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| format!("component profile link mismatch: {label}"))?;
    profile_check(closed(&value, fields), label)?;
    profile_check(
        serde_json::to_vec(&canonical(value.clone()))? == bytes,
        label,
    )?;
    Ok(value)
}

// These are independent format/provenance consistency checks, not a substitute
// for the owning compiler's actual source, proof, package and executable checks.
fn component_links(
    model_bytes: &[u8],
    metadata_bytes: &[u8],
    provenance_bytes: &[u8],
    guest: &[u8],
) -> Result<(), Box<dyn Error>> {
    let model = profile_object(
        model_bytes,
        &[
            "schema",
            "profile",
            "entry",
            "source",
            "input_ir_sha256",
            "captured_inputs",
            "generated_packages",
            "guest_sha256",
            "native",
            "source_semantics",
            "application_acceptance",
        ],
        "model shape",
    )?;
    let metadata = profile_object(metadata_bytes, &["schema", "source"], "metadata shape")?;
    let provenance = profile_object(
        provenance_bytes,
        &[
            "schema",
            "profile",
            "source",
            "input_ir_sha256",
            "model_content_kappa",
            "guest_content_kappa",
            "capabilities_content_kappa",
            "application_kappa",
            "generated_packages",
            "hologram_live_revision",
            "uor_hologram_revision",
        ],
        "provenance shape",
    )?;
    profile_check(
        model["schema"] == "prismpm/component-model/1"
            && metadata["schema"] == "prismpm/component-source/1"
            && provenance["schema"] == "prismpm/component-provenance/1"
            && model["profile"] == "holo/1-primary-component"
            && provenance["profile"] == model["profile"],
        "profile schema",
    )?;
    profile_check(
        model["entry"]
            == "PrismPM.Foundation.Browser.Application.V1.SessionWire.sourceSessionWireBytes"
            && model["source_semantics"] == "private-generated-session"
            && model["application_acceptance"] == false,
        "private source entry",
    )?;
    let capabilities = hologram_live::holo_capability::empty_canonical();
    let application = manifest(guest).canonicalize();
    for (field, bytes) in [
        ("model_content_kappa", model_bytes),
        ("guest_content_kappa", guest),
        ("capabilities_content_kappa", capabilities.as_slice()),
        ("application_kappa", application.as_slice()),
    ] {
        profile_check(
            provenance[field].as_str() == Some(address_bytes(bytes).as_str()),
            field,
        )?;
    }
    let source = &model["source"];
    profile_check(
        source == &metadata["source"] && source == &provenance["source"],
        "source equality",
    )?;
    profile_check(
        closed(
            source,
            &[
                "source_id",
                "semantic_id",
                "attestation_id",
                "build_id",
                "exact_proof",
                "modules",
            ],
        ) && ["source_id", "semantic_id", "attestation_id", "build_id"]
            .iter()
            .all(|field| digest(&source[*field]))
            && closed(&source["exact_proof"], &["attestation", "buildManifest"])
            && digest(&source["exact_proof"]["attestation"])
            && digest(&source["exact_proof"]["buildManifest"]),
        "source facts",
    )?;
    profile_check(
        model["captured_inputs"]
            .as_object()
            .is_some_and(|values| !values.is_empty() && values.values().all(digest)),
        "captured input closure",
    )?;
    profile_check(
        source["modules"].as_object().is_some_and(|modules| {
            !modules.is_empty()
                && modules.contains_key("Foundation.Browser.Application.V1.SessionWire")
                && modules.iter().all(|(name, value)| {
                    let path = if name == "PrimaryComponent" {
                        "tests/holo-primary-component/Fixture.lex.tex".to_owned()
                    } else {
                        format!("stdlib/src/{}.lex.tex", name.replace('.', "/"))
                    };
                    digest(value) && &model["captured_inputs"][path] == value
                })
        }),
        "module input closure",
    )?;
    let module_paths = source["modules"]
        .as_object()
        .ok_or("module map absent")?
        .keys()
        .map(|name| {
            if name == "PrimaryComponent" {
                "tests/holo-primary-component/Fixture.lex.tex".to_owned()
            } else {
                format!("stdlib/src/{}.lex.tex", name.replace('.', "/"))
            }
        })
        .collect::<std::collections::BTreeSet<_>>();
    let captured_sources = model["captured_inputs"]
        .as_object()
        .ok_or("input map absent")?
        .keys()
        .filter(|path| path.ends_with(".lex.tex"))
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();
    profile_check(module_paths == captured_sources, "module input closure")?;
    profile_check(
        digest(&model["input_ir_sha256"])
            && model["input_ir_sha256"] == provenance["input_ir_sha256"],
        "IR equality",
    )?;
    profile_check(
        model["generated_packages"] == provenance["generated_packages"]
            && model["generated_packages"]
                .as_array()
                .is_some_and(|packages| {
                    packages.len() == 3
                        && packages
                            .iter()
                            .zip([
                                ("generated", "native"),
                                ("session-a", "wasm"),
                                ("session-b", "wasm"),
                            ])
                            .all(|(package, (path, kind))| {
                                closed(package, &["path", "kind", "files"])
                                    && package["path"] == path
                                    && package["kind"] == kind
                                    && package["files"].as_object().is_some_and(|files| {
                                        !files.is_empty() && files.values().all(digest)
                                    })
                            })
                }),
        "package closure equality",
    )?;
    profile_check(
        closed(&model["native"], &["std", "no-std"])
            && digest(&model["native"]["std"])
            && digest(&model["native"]["no-std"])
            && digest(&model["guest_sha256"]),
        "executable facts",
    )?;
    let guest_sha = hologram::space::kappa::address_bytes_axis("sha256", guest)
        .map_err(|_| "pinned SHA-256 axis unavailable")?;
    let guest_sha = std::str::from_utf8(&guest_sha)?
        .strip_prefix("sha256:")
        .ok_or("pinned SHA-256 axis has noncanonical label")?;
    profile_check(
        model["guest_sha256"].as_str() == Some(guest_sha),
        "guest SHA-256",
    )?;
    profile_check(
        provenance["hologram_live_revision"] == LIVE
            && provenance["uor_hologram_revision"] == HOLOGRAM,
        "authority revisions",
    )?;
    Ok(())
}

fn synthetic() -> Result<Value, Box<dyn Error>> {
    // Deliberately not runnable. These independently assembled bytes are codec
    // expectations only and are never passed to either execution API.
    let guest = b"\0asm\x01\0\0\0";
    let model = b"{\"synthetic\":true}";
    let metadata = b"synthetic component source metadata";
    let provenance = b"{\"synthetic_provenance\":true}";
    let capabilities = hologram_live::holo_capability::empty_canonical();
    let manifest = manifest(guest);
    let mut blobs = [capabilities.as_slice(), guest.as_slice(), model.as_slice()]
        .map(|bytes| (address_bytes(bytes), bytes));
    blobs.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    let directory = hologram_live::holo_directory::encode(&hologram_live::holo_directory::derive(
        &manifest,
        blobs
            .iter()
            .map(|(label, bytes)| (label.as_bytes(), *bytes)),
    )?)?;
    let extension = |key: &str, payload: &[u8]| -> Result<Vec<u8>, Box<dyn Error>> {
        let mut writer = HoloWriter::new();
        writer.add_extension(key, payload.to_vec());
        let archive = writer.finish()?;
        Ok(HoloLoader::from_bytes(&archive)?
            .into_plan()?
            .section(SectionKind::Extension)?
            .to_vec())
    };
    let mut sections = vec![
        (SectionKind::AppManifest, manifest.canonicalize()),
        (SectionKind::Metadata, metadata.to_vec()),
        (
            SectionKind::Extension,
            extension(
                hologram_live::holo_directory::DIRECTORY_EXTENSION_KEY,
                &directory,
            )?,
        ),
        (SectionKind::Extension, extension(COMPONENT, provenance)?),
    ];
    for (label, bytes) in &blobs {
        let mut payload = label.as_bytes().to_vec();
        payload.extend_from_slice(bytes);
        sections.push((SectionKind::ContentBlob, payload));
    }
    let archive = HoloWriter::assemble(sections.clone());
    let plan = HoloLoader::from_bytes(&archive)?.into_plan()?;
    assert_eq!(plan.sections().len(), 7);
    assert_eq!(plan.sections()[0].offset, 178);
    assert_eq!(manifest.canonicalize().len(), 258);
    Ok(json!({
        "schema":"prismpm/primary-codec-oracle/1", "scope":"synthetic-codec-only",
        "hologram_revision":HOLOGRAM, "live_revision":LIVE,
        "requires":manifest.requires.to_string(), "guest":address_bytes(guest).to_string(),
        "capabilities":hex(&capabilities), "manifest":hex(&manifest.canonicalize()),
        "metadata":hex(metadata), "directory":hex(&directory), "provenance":hex(provenance),
        "blobs":sections[4..].iter().map(|(_, bytes)| hex(bytes)).collect::<Vec<_>>(),
        "body":hex(&archive[..archive.len()-32]), "footer":hex(&archive[archive.len()-32..]),
        "archive":hex(&archive), "sections":sections.iter().map(|(_, bytes)| hex(bytes)).collect::<Vec<_>>(),
    }))
}

async fn execute(args: &[String]) -> Result<Value, Box<dyn Error>> {
    if args.len() != 6 {
        return Err("archive guest model metadata provenance vectors".into());
    }
    let archive = fs::read(&args[0])?;
    let guest = fs::read(&args[1])?;
    let model = fs::read(&args[2])?;
    let metadata = fs::read(&args[3])?;
    let provenance = fs::read(&args[4])?;
    let expected = manifest(&guest);
    let capabilities = hologram_live::holo_capability::empty_canonical();
    let plan = HoloLoader::from_bytes(&archive)?.into_plan()?;
    assert_eq!(
        plan.sections()
            .iter()
            .map(|row| row.kind as u8)
            .collect::<Vec<_>>(),
        vec![15, 8, 14, 14, 16, 16, 16]
    );
    assert_eq!(
        plan.app_manifest(),
        Some(expected.canonicalize().as_slice())
    );
    assert_eq!(plan.section(SectionKind::Metadata)?, metadata);
    let blobs = plan.content_blobs()?;
    let mut exact_blobs = [capabilities.as_slice(), guest.as_slice(), model.as_slice()]
        .map(|bytes| (address_bytes(bytes), bytes));
    exact_blobs.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    assert_eq!(
        blobs,
        exact_blobs
            .iter()
            .map(|(label, bytes)| (label.as_bytes(), *bytes))
            .collect::<Vec<_>>()
    );
    let directory = hologram_live::holo_directory::encode(&hologram_live::holo_directory::derive(
        &expected,
        blobs.iter().copied(),
    )?)?;
    assert_eq!(
        plan.extensions()?,
        vec![
            (
                hologram_live::holo_directory::DIRECTORY_EXTENSION_KEY,
                directory.as_slice()
            ),
            (COMPONENT, provenance.as_slice()),
        ]
    );
    component_links(&model, &metadata, &provenance, &guest)?;
    let kappa = address_bytes(&archive).to_string();
    let inspection = inspect_bytes(&kappa, "source-session.holo", &archive)?;
    assert!(inspection.footer_verified && inspection.directory_embedded);
    assert_eq!(
        inspection.application_kappa.as_deref(),
        Some(address_bytes(&expected.canonicalize()).as_str())
    );
    let execution_plan = serde_json::to_value(plan_bytes(&archive)?)?;
    assert_eq!(execution_plan["runnable"], true);
    assert_eq!(
        execution_plan["layers"]
            .as_array()
            .ok_or("layers absent")?
            .len(),
        1
    );
    assert_eq!(
        execution_plan["layers"][0]["provider"]["name"],
        "wasmtime-direct"
    );
    assert_eq!(execution_plan["blockers"], json!([]));

    let vectors: Value = serde_json::from_slice(&fs::read(&args[5])?)?;
    let vectors = vectors.as_array().ok_or("vectors must be an array")?;
    if vectors.is_empty() {
        return Err("empty runtime corpus".into());
    }
    let direct = HoloExecutor::default().start_session(&archive).await?;
    assert_eq!(direct.archive_kappa(), kappa);
    let store_root = tempfile::tempdir()?;
    let catalog = Arc::new(HoloCatalog::new(Arc::new(ObjectStore::open(
        store_root.path(),
    )?)));
    // Import the exact Prism-produced bytes, never an upstream reconstruction.
    let imported = catalog.import("source-session.holo".into(), archive.clone())?;
    assert_eq!(imported.kappa, kappa);
    let resident = HoloRuntime::new(catalog, 8);
    let unloaded = resident
        .run(&kappa, vec![vec![]])
        .await
        .expect_err("not yet loaded");
    let unloaded_message =
        format!("{kappa} is not loaded as a resident holo; run `hologram holo load {kappa}` first");
    assert_eq!(unloaded.code(), "LIVE_NOT_FOUND");
    assert_eq!(unloaded.to_string(), unloaded_message);
    resident.load(&kappa).await?;
    let mut names = std::collections::BTreeSet::new();
    let mut observations = Vec::new();
    for vector in vectors {
        let object = vector.as_object().ok_or("vector object required")?;
        if object.keys().map(String::as_str).collect::<Vec<_>>() != ["id", "request", "response"] {
            return Err("closed vector fields required".into());
        }
        let id = vector["id"].as_str().ok_or("id missing")?;
        if !names.insert(id) {
            return Err("duplicate vector".into());
        }
        let input = fs::read(vector["request"].as_str().ok_or("request path missing")?)?;
        let expected = fs::read(vector["response"].as_str().ok_or("response path missing")?)?;
        if input.len() > 67_108_864 || expected.len() > 67_108_864 {
            return Err("admitted binary frame bound exceeded".into());
        }
        for _ in 0..2 {
            let result = direct.invoke(vec![input.clone()]).await?;
            assert_eq!(result.outputs, vec![expected.clone()], "direct {id}");
            let result = resident.run(&kappa, vec![input.clone()]).await?;
            assert_eq!(result.outputs, vec![expected.clone()], "resident {id}");
        }
        observations.push(
            json!({"id":id,"request_kappa":address_bytes(&input).to_string(),
            "response_kappa":address_bytes(&expected).to_string(),"request_length":input.len(),
            "response_length":expected.len(),"direct_repeats":2,"resident_repeats":2}),
        );
    }
    // Both genuine upstream paths must reach the generated allocation guard;
    // a host length check alone cannot demonstrate this first-over refusal.
    let direct_over = direct
        .invoke(vec![vec![0; 67_108_865]])
        .await
        .expect_err("direct first-over allocation");
    let resident_over = resident
        .run(&kappa, vec![vec![0; 67_108_865]])
        .await
        .expect_err("resident first-over allocation");
    let allocation_prefix = format!("guest {kappa} trapped in `holo_alloc`: ");
    for error in [&direct_over, &resident_over] {
        assert_eq!(error.code(), "LIVE_PROTOCOL_ERROR");
        assert!(
            error.to_string().starts_with(&allocation_prefix),
            "actual allocation-export trap: {error}"
        );
    }
    direct.stop().await?;
    direct.stop().await?;
    let stopped = direct
        .invoke(vec![vec![]])
        .await
        .expect_err("direct session stopped");
    assert_eq!(stopped.code(), "LIVE_CONFLICT");
    assert_eq!(
        stopped.to_string(),
        format!(
            "application {} is not running (state Stopped)",
            direct.application_kappa()
        )
    );
    resident.unload(&kappa).await?;
    resident.unload(&kappa).await?;
    let after_unload = resident
        .run(&kappa, vec![vec![]])
        .await
        .expect_err("resident unloaded");
    assert_eq!(after_unload.code(), "LIVE_NOT_FOUND");
    assert_eq!(after_unload.to_string(), unloaded_message);
    assert!(resident.list().await?.is_empty());
    Ok(
        json!({"schema":"prismpm/primary-binary-oracle/1","scope":"private-component-only",
        "hologram_revision":HOLOGRAM,"live_revision":LIVE,"archive_kappa":kappa,
        "application_kappa":inspection.application_kappa,"archive_fingerprint":inspection.archive_fingerprint,
        "exact_archive_direct_and_resident":true,"lifecycle_refusals":3,
        "actual_allocator_first_over_refusals":2,
        "allocation_errors":[{"code":direct_over.code(),"message":direct_over.to_string()},
          {"code":resident_over.code(),"message":resident_over.to_string()}],
        "lifecycle_errors":[{"code":unloaded.code(),"message":unloaded.to_string()},
          {"code":stopped.code(),"message":stopped.to_string()},
          {"code":after_unload.code(),"message":after_unload.to_string()}],"vectors":observations}),
    )
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let result = match args.as_slice() {
        [mode] if mode == "synthetic" => synthetic()?,
        [mode, path] if mode == "identity" => {
            let bytes = fs::read(path)?;
            let kappa = address_bytes(&bytes).to_string();
            json!({"kappa":kappa,"digest":kappa.strip_prefix("blake3:").ok_or("digest axis")?,"length":bytes.len()})
        }
        [mode, path] if mode == "inspect" => {
            let bytes = fs::read(path)?;
            let kappa = address_bytes(&bytes).to_string();
            match inspect_bytes(&kappa, "component.holo", &bytes) {
                Ok(inspection) => json!({"accepted":true,"inspection":inspection}),
                Err(error) => json!({"accepted":false,"error":error.to_string()}),
            }
        }
        [mode, path] if mode == "reject" => {
            let bytes = fs::read(path)?;
            match HoloExecutor::default().start_session(&bytes).await {
                Ok(session) => {
                    session.stop().await?;
                    return Err("negative archive started an execution session".into());
                }
                Err(error) => json!({"refused_before_session":true,"error":error.to_string()}),
            }
        }
        [mode, rest @ ..] if mode == "execute" => execute(rest).await?,
        _ => return Err("closed primary oracle operation".into()),
    };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}
