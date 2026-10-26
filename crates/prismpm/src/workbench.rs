//! SDK-owned, closed Text/3 workbench projection over the existing byte adapter.

use crate::error::PrismError;
use crate::holo::canonical::encode_value;
use crate::holo::workbench::WorkbenchApplication;
use prod_codegen::{
    generate_holoview_bundle, generate_text_view_v1_for_module, GeneratedViewV1, PackageFile,
    TextBrowserAdapterBinding, TextViewV1,
};
use serde_json::json;
use sha2::{Digest, Sha256};

fn html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn javascript(value: &serde_json::Value) -> Result<String, PrismError> {
    Ok(serde_json::to_string(value)
        .map_err(|error| PrismError::new("PP5203", error.to_string()))?
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029"))
}
fn records(files: &[PackageFile]) -> Vec<serde_json::Value> {
    files
        .iter()
        .map(|file| json!({"path":file.path,"sha256":format!("{:x}",Sha256::digest(&file.bytes))}))
        .collect()
}

pub(crate) fn generate(
    module: &prod_ir::Module,
    app: &WorkbenchApplication,
    model_id: &str,
    view_id: &str,
    core_sha: &str,
    entry: &str,
) -> Result<GeneratedViewV1, PrismError> {
    crate::holo::workbench::validate(app)?;
    // The old adapter remains authoritative for UTF-8 byte copying, checked
    // guest failures, exact limits and generated package dependencies.
    let evaluated = TextViewV1 {
        title: app.view.title.clone(),
        heading: app.view.heading.clone(),
        input_label: app.view.raw.label.clone(),
        submit_label: app.view.raw.submit_label.clone(),
        output_label: app.view.raw.response_label.clone(),
        input_error: app.view.statuses.input_error.clone(),
        response_error: app.view.statuses.response_error.clone(),
        max_input_bytes: app.request_maximum,
        max_output_bytes: app.response_maximum,
        model_id: model_id.to_owned(),
        view_model_id: view_id.to_owned(),
        generated_core_sha256: core_sha.to_owned(),
    };
    let mut generated = generate_text_view_v1_for_module(
        module,
        &evaluated,
        &TextBrowserAdapterBinding {
            package_name: format!("{}-browser", app.cargo_name),
            package_version: app.cargo_version.clone(),
            core_crate_name: app.cargo_name.clone(),
            core_crate_version: app.cargo_version.clone(),
            core_function: entry.to_owned(),
        },
    )
    .map_err(|error| PrismError::new("PP5203", error.to_string()))?;
    let raw = &app.view.raw;
    // Disabled source-owned controls and form-action:none protect drafts even
    // before module execution. Mount transfers the exact pre-init raw draft.
    let index = format!(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"form-action 'none'\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title><link rel=\"stylesheet\" href=\"app.css\"></head><body><main id=\"workbench-main\" tabindex=\"-1\"><h1>{}</h1><p id=\"status\" role=\"status\" aria-live=\"polite\" aria-atomic=\"true\">{}</p><details id=\"raw-editor\"{}><summary>{}</summary><form id=\"application-form\" novalidate><label for=\"request\">{}</label><textarea id=\"request\" rows=\"5\">{}</textarea><button id=\"submit\" type=\"submit\" disabled>{}</button></form></details><pre id=\"result\"></pre></main><script type=\"module\" src=\"app.js\"></script></body></html>\n",
        html(&app.view.title),
        html(&app.view.heading),
        html(&app.view.statuses.initializing),
        if raw.expanded { " open" } else { "" },
        html(&raw.label),
        html(&app.view.labels.request),
        html(&raw.initial_value),
        html(&raw.submit_label)
    );
    let guidance = app
        .view
        .guidance
        .iter()
        .map(|step| format!("<li>{}</li>", html(step)))
        .collect::<String>();
    let mut documentation = String::new();
    for section in &app.view.sections {
        documentation.push_str(&format!(
            "<section id=\"guide-{}\"><h3>{}</h3>",
            section.id,
            html(&section.title)
        ));
        for paragraph in &section.paragraphs {
            documentation.push_str(&format!("<p>{}</p>", html(paragraph)));
        }
        documentation.push_str("</section>");
    }
    let links = app
        .view
        .links
        .iter()
        .map(|link| {
            format!(
                "<a href=\"{}\" rel=\"noreferrer\">{}</a>",
                html(&link.https_url),
                html(&link.label)
            )
        })
        .collect::<String>();
    let index=index.replace("<meta name=\"viewport\"",&format!("<meta name=\"description\" content=\"{}\"><link rel=\"canonical\" href=\"{}\"><meta name=\"viewport\"",html(&app.view.purpose),html(&app.cargo_homepage)))
        .replace("<p id=\"status\"",&format!("<p>{}</p><p>{}</p><ol class=\"guidance\">{}</ol><noscript><p>{}</p></noscript><p id=\"status\"",html(&app.view.purpose),html(&app.view.audience),guidance,html(&app.view.statuses.script_required)))
        .replace("</main>",&format!("<section id=\"guide\"><h2>{}</h2>{}</section><footer id=\"links\"><h2>{}</h2>{}</footer></main>",html(&app.view.labels.guide),documentation,html(&app.view.labels.links),links));
    let view = javascript(
        &serde_json::to_value(&app.view)
            .map_err(|error| PrismError::new("PP5203", error.to_string()))?,
    )?;
    let binding = javascript(&json!(format!("./{}.js", app.cargo_name.replace('-', "_"))))?;
    let assets = |transport: &str| -> Vec<PackageFile> {
        let source = include_str!("workbench/runtime.js")
            .replace("__INPUT_LIMIT__", &app.request_maximum.to_string())
            .replace("__OUTPUT_LIMIT__", &app.response_maximum.to_string())
            .replace("__BINDING__", &binding)
            .replace("__TRANSPORT__", &format!("{transport:?}"))
            // Source strings are substituted last and never scanned as template syntax.
            .replace("__VIEW__", &view);
        vec![
            PackageFile {
                path: "app.css".into(),
                bytes: include_bytes!("workbench/style.css").to_vec(),
            },
            PackageFile {
                path: "app.js".into(),
                bytes: source.into_bytes(),
            },
            PackageFile {
                path: "index.html".into(),
                bytes: index.as_bytes().to_vec(),
            },
        ]
    };
    generated.browser_assets = assets("browser");
    generated.hologram_assets = assets("hologram");
    generated.hologram_bundle = generate_holoview_bundle(&generated.hologram_assets)
        .map_err(|error| PrismError::new("PP5203", error.to_string()))?;
    let manifest = json!({"schema":"prismpm/workbench-view-projection/1","profile":"prism.workbench-view/1","model_id":model_id,"view_model_id":view_id,"generated_core_sha256":core_sha,"max_input_bytes":app.request_maximum,"max_output_bytes":app.response_maximum,"browser_adapter":records(&generated.browser_adapter.files),"hologram_bundle":{"path":generated.hologram_bundle.path,"sha256":format!("{:x}",Sha256::digest(&generated.hologram_bundle.bytes))},"projections":[{"target":"browser-wasm-bindgen","files":records(&generated.browser_assets)},{"target":"hologram-intent-v1","files":records(&generated.hologram_assets)}]});
    crate::contracts::CanonicalDocument::from_value(
        "prismpm/workbench-view-projection/1",
        manifest.clone(),
    )?;
    generated.view_manifest = PackageFile {
        path: "view-manifest.json".into(),
        bytes: encode_value(&manifest)?,
    };
    Ok(generated)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workbench_generated_assets_bind_model_text_and_byte_adapter() {
        let model: crate::holo::model_document::ModelDocument = serde_json::from_slice(
            include_bytes!("../../../tests/data/workbench-model-document.json"),
        )
        .unwrap();
        let Some(app) = model
            .application
            .as_ref()
            .and_then(crate::holo::model_document::Application::workbench)
        else {
            panic!("closed fixture");
        };
        let app = &app;
        let (_, module) = prod_ir::parser::parse_module(
            "(module Fixture (def dispatch ((input Bytes)) Bytes input))",
        )
        .unwrap();
        let generated = generate(
            &module,
            app,
            &"1".repeat(64),
            &"2".repeat(64),
            &"3".repeat(64),
            "dispatch",
        )
        .unwrap();
        assert_eq!(
            generated
                .browser_assets
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            ["app.css", "app.js", "index.html"]
        );
        assert_eq!(generated.hologram_assets.len(), 3);
        let source = String::from_utf8(generated.browser_assets[1].bytes.clone()).unwrap();
        assert!(source.contains("new Worker(new URL(import.meta.url),{type:'module'})"));
        assert!(!source.contains("blob:"));
        assert!(source.contains(&app.view.operations[0].label));
        assert!(
            String::from_utf8(generated.hologram_assets[1].bytes.clone())
                .unwrap()
                .contains("const TRANSPORT = \"hologram\"")
        );
        let html = String::from_utf8(generated.browser_assets[2].bytes.clone()).unwrap();
        for text in [
            &app.view.purpose,
            &app.view.statuses.script_required,
            &app.view.statuses.initializing,
            &app.cargo_homepage,
        ] {
            assert!(html.contains(&super::html(text)));
        }
        assert!(html.contains("form-action 'none'"));
        let manifest: serde_json::Value =
            serde_json::from_slice(&generated.view_manifest.bytes).unwrap();
        crate::contracts::CanonicalDocument::from_value(
            "prismpm/workbench-view-projection/1",
            manifest.clone(),
        )
        .unwrap();
        assert_eq!(
            manifest["projections"][0]["files"],
            serde_json::to_value(records(&generated.browser_assets)).unwrap()
        );
        assert_eq!(
            manifest["projections"][1]["files"],
            serde_json::to_value(records(&generated.hologram_assets)).unwrap()
        );
        assert_eq!(manifest["model_id"], "1".repeat(64));
        let mut hostile = app.clone();
        hostile.view.title="__INPUT_LIMIT__ __OUTPUT_LIMIT__ __BINDING__ __TRANSPORT__ __VIEW__ </script> \u{2028} quoted \"text\"".to_owned();
        let generated = generate(
            &module,
            &hostile,
            &"1".repeat(64),
            &"2".repeat(64),
            &"3".repeat(64),
            "dispatch",
        )
        .unwrap();
        for assets in [generated.browser_assets, generated.hologram_assets] {
            let source = std::str::from_utf8(&assets[1].bytes).unwrap();
            let embedded = source
                .split_once("const VIEW = ")
                .unwrap()
                .1
                .split_once(";\nconst INPUT_LIMIT")
                .unwrap()
                .0;
            let decoded: serde_json::Value = serde_json::from_str(embedded)
                .expect("source marker text must remain valid literal JSON");
            assert_eq!(
                decoded["title"], hostile.view.title,
                "source marker text must survive renderer substitution byte-for-byte"
            );
        }
    }
}
