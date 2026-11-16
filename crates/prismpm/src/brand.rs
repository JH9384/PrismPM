//! Hologram brand assets carried by every generated browser closure (closure v2).
//!
//! The bytes are vendored in `vendor/hologram-brand` from a pinned
//! hologram-brand-kit commit (`model/dependencies.toml`, row `hologram-brand`).
//! Closure v1 is the six-file page; closure v2 adds the brand files and a
//! per-application web app manifest beside it, flat, so the page installs on
//! phones and renders in Geist, Archivo and Geist Mono without remote fonts.

use prod_codegen::PackageFile;
use std::collections::BTreeSet;

/// Brand files, flat beside `index.html`, in the order they are documented.
pub const BRAND_FILES: [(&str, &[u8]); 9] = [
    (
        "Archivo-SemiBold.woff2",
        include_bytes!("../vendor/hologram-brand/fonts/Archivo-SemiBold.woff2"),
    ),
    (
        "Geist-Medium.woff2",
        include_bytes!("../vendor/hologram-brand/fonts/Geist-Medium.woff2"),
    ),
    (
        "Geist-Regular.woff2",
        include_bytes!("../vendor/hologram-brand/fonts/Geist-Regular.woff2"),
    ),
    (
        "Geist-SemiBold.woff2",
        include_bytes!("../vendor/hologram-brand/fonts/Geist-SemiBold.woff2"),
    ),
    (
        "GeistMono-Regular.woff2",
        include_bytes!("../vendor/hologram-brand/fonts/GeistMono-Regular.woff2"),
    ),
    (
        "OFL-Archivo.txt",
        include_bytes!("../vendor/hologram-brand/fonts/OFL-Archivo.txt"),
    ),
    (
        "OFL-Geist.txt",
        include_bytes!("../vendor/hologram-brand/fonts/OFL-Geist.txt"),
    ),
    (
        "icon-512.png",
        include_bytes!("../vendor/hologram-brand/icon-512.png"),
    ),
    (
        "icon.svg",
        include_bytes!("../vendor/hologram-brand/icon.svg"),
    ),
];

/// The generated web app manifest's file name.
pub const MANIFEST: &str = "manifest.webmanifest";

/// Same-origin brand fonts. `font-display: swap` keeps text visible while they load.
pub const FONT_FACES: &str = "@font-face{font-family:Geist;src:url(Geist-Regular.woff2) format(\"woff2\");font-weight:400;font-style:normal;font-display:swap}\n@font-face{font-family:Geist;src:url(Geist-Medium.woff2) format(\"woff2\");font-weight:500;font-style:normal;font-display:swap}\n@font-face{font-family:Geist;src:url(Geist-SemiBold.woff2) format(\"woff2\");font-weight:600 700;font-style:normal;font-display:swap}\n@font-face{font-family:\"Geist Mono\";src:url(GeistMono-Regular.woff2) format(\"woff2\");font-weight:400 600;font-style:normal;font-display:swap}\n@font-face{font-family:Archivo;src:url(Archivo-SemiBold.woff2) format(\"woff2\");font-weight:500 700;font-style:normal;font-display:swap}\n";

/// Head links that make the page installable and theme the browser chrome.
pub const HEAD_LINKS: &str = "<link rel=\"manifest\" href=\"manifest.webmanifest\"><link rel=\"icon\" href=\"icon.svg\" type=\"image/svg+xml\"><link rel=\"apple-touch-icon\" href=\"icon-512.png\"><meta name=\"theme-color\" content=\"#f3f3ee\" media=\"(prefers-color-scheme: light)\"><meta name=\"theme-color\" content=\"#151312\" media=\"(prefers-color-scheme: dark)\">";

/// The web app manifest for one application. Keys are written in a fixed
/// order and every value comes from the model or this module, so the bytes
/// are a pure function of the application name.
pub fn web_manifest(name: &str) -> Vec<u8> {
    let name = serde_json::to_string(name).expect("a string always serializes");
    format!(
        "{{\"name\":{name},\"short_name\":{name},\"start_url\":\"./\",\"scope\":\"./\",\"display\":\"standalone\",\"background_color\":\"#151312\",\"theme_color\":\"#151312\",\"icons\":[{{\"src\":\"icon.svg\",\"sizes\":\"any\",\"type\":\"image/svg+xml\",\"purpose\":\"any\"}},{{\"src\":\"icon-512.png\",\"sizes\":\"512x512\",\"type\":\"image/png\",\"purpose\":\"any maskable\"}}]}}\n"
    )
    .into_bytes()
}

/// The brand files plus this application's manifest, as closure assets.
pub fn assets(name: &str) -> Vec<PackageFile> {
    let mut files = BRAND_FILES
        .iter()
        .map(|(path, bytes)| PackageFile {
            path: (*path).into(),
            bytes: bytes.to_vec(),
        })
        .collect::<Vec<_>>();
    files.push(PackageFile {
        path: MANIFEST.into(),
        bytes: web_manifest(name),
    });
    files
}

/// Closure v1: the six-file page earlier SDKs wrote.
pub fn closure_v1(stem: &str) -> BTreeSet<String> {
    ["app.css", "app.js", "index.html", "provenance.json"]
        .into_iter()
        .map(str::to_owned)
        .chain([format!("{stem}.js"), format!("{stem}_bg.wasm")])
        .collect()
}

/// Closure v2: closure v1, the brand files and the manifest (16 files).
pub fn closure_v2(stem: &str) -> BTreeSet<String> {
    let mut names = closure_v1(stem);
    names.extend(BRAND_FILES.iter().map(|(path, _)| (*path).to_owned()));
    names.insert(MANIFEST.to_owned());
    names
}

/// The closure version of an exact file set, or `None` when it is neither.
pub fn closure_version(names: &BTreeSet<String>, stem: &str) -> Option<u8> {
    if *names == closure_v2(stem) {
        Some(2)
    } else if *names == closure_v1(stem) {
        Some(1)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closure_v2_is_closure_v1_plus_ten_flat_brand_files() {
        let v1 = closure_v1("core");
        let v2 = closure_v2("core");
        assert_eq!((v1.len(), v2.len()), (6, 16));
        assert!(v1.is_subset(&v2));
        assert!(v2.iter().all(|name| !name.contains('/')));
        assert_eq!(closure_version(&v2, "core"), Some(2));
        assert_eq!(closure_version(&v1, "core"), Some(1));
        let mut partial = v2.clone();
        partial.remove("icon.svg");
        assert_eq!(closure_version(&partial, "core"), None);
    }

    #[test]
    fn the_manifest_names_the_application_and_its_brand_icons() {
        let manifest: serde_json::Value =
            serde_json::from_slice(&web_manifest("Calculator \"v1\"")).unwrap();
        assert_eq!(manifest["name"], "Calculator \"v1\"");
        assert_eq!(manifest["display"], "standalone");
        let icons = manifest["icons"].as_array().unwrap();
        assert!(icons
            .iter()
            .all(|icon| BRAND_FILES.iter().any(|(path, _)| *path == icon["src"])));
        assert_eq!(web_manifest("A"), web_manifest("A"));
    }

    #[test]
    fn every_font_face_and_head_link_names_a_closure_file() {
        let names = closure_v2("core");
        for source in [FONT_FACES, HEAD_LINKS] {
            for part in source.split(['(', ')', '"']).filter(|part| {
                part.ends_with(".woff2")
                    || part.ends_with(".png")
                    || part.ends_with(".svg")
                    || part.ends_with(".webmanifest")
            }) {
                assert!(names.contains(part), "{part}");
            }
        }
        for (path, bytes) in BRAND_FILES {
            assert!(!bytes.is_empty(), "{path}");
        }
    }
}
