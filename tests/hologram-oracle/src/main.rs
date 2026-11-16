use axum::body::to_bytes;
use axum::extract::{Request, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use hologram::archive::HoloWriter;
use hologram::space::{address_bytes, AppManifest, Layer, Realization};
use hologram_live::holo::{inspect_bytes, plan_bytes, HoloCatalog, HoloExecutor, HoloRuntime};
use hologram_live::store::ObjectStore;
use hologram_view_surface::{
    PortableViewAttachment, PortableViewSurface, SurfaceFuture, ViewAttachmentId,
    ViewIntentRequest, APPLICATION_INVOKE_INTENT, VIEW_INTENT_VERSION,
};
use serde_json::{json, Value};
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[derive(Default)]
struct RecordingSurface {
    attachment: Mutex<Option<PortableViewAttachment>>,
    attached: AtomicUsize,
    detached: AtomicUsize,
}

// An acceptance adapter, never an application server or deployment target.
// Axum/Hyper own HTTP parsing. Immutable assets and invocations come exclusively
// from the pinned upstream attachment, not a reimplementation of the guest.
#[derive(Clone)]
struct BrowserSurface {
    surface: Arc<RecordingSurface>,
    authority: String,
}

fn response(status: StatusCode, kind: &'static str, bytes: Vec<u8>) -> Response {
    (
        status,
        [
            (header::CONTENT_TYPE, kind),
            (header::CACHE_CONTROL, "no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        bytes,
    )
        .into_response()
}

async fn portable_http(State(host): State<BrowserSurface>, request: Request) -> Response {
    let reject = |status| response(status, "text/plain; charset=utf-8", Vec::new());
    let origin = format!("http://{}", host.authority);
    if request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        != Some(host.authority.as_str())
        || request.uri().query().is_some()
    {
        return reject(StatusCode::BAD_REQUEST);
    }
    if request.headers().contains_key(header::ORIGIN)
        && request
            .headers()
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            != Some(origin.as_str())
    {
        return reject(StatusCode::FORBIDDEN);
    }
    let attachment = match host.surface.attachment.lock() {
        Ok(value) => value.clone(),
        Err(_) => return reject(StatusCode::INTERNAL_SERVER_ERROR),
    };
    let Some(attachment) = attachment else {
        return reject(StatusCode::GONE);
    };
    if request.uri().path() == "/_hologram/intent" {
        if request.method() != Method::POST {
            return reject(StatusCode::METHOD_NOT_ALLOWED);
        }
        if request
            .headers()
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            != Some(origin.as_str())
        {
            return reject(StatusCode::FORBIDDEN);
        }
        if request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            != Some("application/json")
        {
            return reject(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        }
        // JSON may represent a UTF-8 payload byte using six ASCII bytes. The
        // authoritative DTO separately enforces the decoded 64KiB byte bound.
        let maximum = hologram_view_surface::MAX_INTENT_PAYLOAD_BYTES * 6 + 256;
        let body = match to_bytes(request.into_body(), maximum).await {
            Ok(body) => body,
            Err(_) => return reject(StatusCode::PAYLOAD_TOO_LARGE),
        };
        let intent: ViewIntentRequest = match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(_) => return reject(StatusCode::BAD_REQUEST),
        };
        if intent.validate().is_err() {
            return reject(StatusCode::BAD_REQUEST);
        }
        match attachment.intents.handle(&attachment.id, intent).await {
            Ok(result) => match serde_json::to_vec(&result) {
                Ok(bytes) => response(StatusCode::OK, "application/json", bytes),
                Err(_) => reject(StatusCode::INTERNAL_SERVER_ERROR),
            },
            Err(_) => reject(StatusCode::BAD_REQUEST),
        }
    } else {
        if request.method() != Method::GET && request.method() != Method::HEAD {
            return reject(StatusCode::METHOD_NOT_ALLOWED);
        }
        let path = if request.uri().path() == "/" {
            attachment.entry.as_str()
        } else {
            request.uri().path().strip_prefix('/').unwrap_or("")
        };
        let Some(asset) = attachment.assets.iter().find(|asset| asset.path == path) else {
            return reject(StatusCode::NOT_FOUND);
        };
        let mime = match asset.path.as_str() {
            "index.html" => "text/html; charset=utf-8",
            "app.js" => "text/javascript; charset=utf-8",
            "app.css" => "text/css; charset=utf-8",
            _ => return reject(StatusCode::NOT_FOUND),
        };
        response(
            StatusCode::OK,
            mime,
            if request.method() == Method::HEAD {
                Vec::new()
            } else {
                asset.bytes.to_vec()
            },
        )
    }
}

async fn browser_line(
    reader: &mut BufReader<tokio::process::ChildStdout>,
) -> Result<Value, Box<dyn std::error::Error>> {
    let mut line = Vec::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(120);
    // Do not permit a child to allocate an unbounded report before validation.
    loop {
        let available = tokio::time::timeout_at(deadline, reader.fill_buf()).await??;
        if available.is_empty() {
            return Err("browser oracle closed stdout before evidence".into());
        }
        let count = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |n| n + 1);
        if line.len() + count > 65_536 {
            return Err("browser evidence exceeds 64KiB".into());
        }
        line.extend_from_slice(&available[..count]);
        reader.consume(count);
        if line.last() == Some(&b'\n') {
            return Ok(serde_json::from_slice(&line)?);
        }
    }
}

async fn browser_start(
    surface: Arc<RecordingSurface>,
    application: &Value,
    script: &std::path::Path,
    node: &std::path::Path,
    browser: &std::path::Path,
) -> Result<
    (
        tokio::process::Child,
        BufReader<tokio::process::ChildStdout>,
        tokio::task::JoinHandle<std::io::Result<()>>,
        Value,
    ),
    Box<dyn std::error::Error>,
> {
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
    let authority = listener.local_addr()?.to_string();
    let host = BrowserSurface {
        surface,
        authority: authority.clone(),
    };
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().fallback(portable_http).with_state(host),
        )
        .await
    });
    if !node.is_absolute() || !node.is_file() || !browser.is_absolute() || !browser.is_file() {
        return Err("controller must supply verified absolute Node and browser executables".into());
    }
    let mut child = tokio::process::Command::new(node)
        .arg(script)
        // Both the SDK and source devcontainer install the same pinned image
        // payload here. Never inherit a caller-selected browser cache path.
        .env("PLAYWRIGHT_BROWSERS_PATH", "/ms-playwright")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()?;
    child
        .stdin
        .as_mut()
        .ok_or("browser stdin missing")?
        .write_all(
            format!(
                "{}\n",
                json!({"origin":format!("http://{authority}"), "application":application, "browser_executable":browser})
            )
            .as_bytes(),
        )
        .await?;
    let mut reader = BufReader::new(child.stdout.take().ok_or("browser stdout missing")?);
    let live = browser_line(&mut reader).await?;
    if live != json!({"stage":"live"}) {
        return Err("browser did not finish live journeys".into());
    }
    Ok((child, reader, server, json!({"stage":"stopped"})))
}

impl PortableViewSurface for RecordingSurface {
    fn attach(&self, view: PortableViewAttachment) -> SurfaceFuture<'_> {
        Box::pin(async move {
            *self
                .attachment
                .lock()
                .map_err(|_| "attachment lock poisoned".to_owned())? = Some(view);
            self.attached.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
    }

    fn detach<'a>(&'a self, _id: &'a ViewAttachmentId) -> SurfaceFuture<'a> {
        Box::pin(async move {
            *self
                .attachment
                .lock()
                .map_err(|_| "attachment lock poisoned".to_owned())? = None;
            self.detached.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
    }
}

fn bytes(value: &Value, field: &str) -> Result<Vec<u8>, String> {
    value[field]
        .as_array()
        .ok_or_else(|| format!("acceptance vector has no {field}"))?
        .iter()
        .map(|byte| {
            byte.as_u64()
                .and_then(|byte| u8::try_from(byte).ok())
                .ok_or_else(|| format!("acceptance {field} contains a non-byte"))
        })
        .collect()
}

fn allocation_boundary(
    profile: Option<&str>,
    allocation_cap: usize,
    vectors: &[(Vec<u8>, Vec<u8>)],
) -> Result<(Vec<u8>, Vec<u8>), String> {
    if matches!(
        profile,
        Some(
            "prismpm/text-application/1"
                | "prismpm/text-application/2"
                | "prismpm/text-application/3"
        )
    ) {
        vectors
            .iter()
            .find(|(request, _)| request.len() == allocation_cap)
            .cloned()
            .ok_or_else(|| "text model has no explicit guest-allocation-boundary vector".to_owned())
    } else {
        let (_, response) = vectors
            .iter()
            .find(|(request, _)| request.is_empty())
            .ok_or("model has no empty malformed-request vector")?;
        Ok((vec![b'x'; allocation_cap], response.clone()))
    }
}

/// SHA-256 of `parts` end to end, through the pinned Hologram `sha256` axis,
/// so the harness reads UORC with no hasher of its own.
fn sha256(parts: &[&[u8]]) -> Result<[u8; 32], Box<dyn std::error::Error>> {
    let label = hologram::space::address_bytes_axis("sha256", &parts.concat())
        .map_err(|error| format!("Hologram sha256 axis: {error:?}"))?;
    let hex = std::str::from_utf8(&label)?
        .strip_prefix("sha256:")
        .ok_or("Hologram sha256 axis returned another label")?;
    let mut digest = [0u8; 32];
    for (index, byte) in digest.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[2 * index..2 * index + 2], 16)?;
    }
    Ok(digest)
}

fn kappa(bytes: &[u8]) -> Result<String, Box<dyn std::error::Error>> {
    Ok(format!("sha256:{}", hex(&sha256(&[bytes])?)))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// UORC-SHA256-CHAIN-v1 over `preimage` (ADR-017 §1).
fn uorc_chain(preimage: &[u8]) -> Result<[u8; 32], Box<dyn std::error::Error>> {
    const TAG: &[u8] = b"UORC-SHA256-CHAIN-v1\0";
    let mut chain = sha256(&[TAG, &[0]])?;
    let mut blocks = preimage.chunks_exact(64);
    for block in &mut blocks {
        chain = sha256(&[TAG, &[1], &chain, block])?;
    }
    let tail = blocks.remainder();
    sha256(&[TAG, &[2], &chain, &[tail.len() as u8], tail])
}

/// A shortest-form ULEB128 at `at`, and the offset after it.
fn uleb(data: &[u8], mut at: usize) -> Option<(u64, usize)> {
    let start = at;
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *data.get(at)?;
        at += 1;
        let part = u64::from(byte & 0x7F);
        if shift == 63 && part > 1 {
            return None;
        }
        value |= part << shift;
        if byte < 0x80 {
            return (byte != 0 || at - start == 1).then_some((value, at));
        }
    }
    None
}

/// The ordered objects of a sealed, self-contained raw UORC archive (format 2,
/// profile 1) under the holo decode budget of 16 objects and 2^30 body bytes.
/// This is the "any UORC reader" ADR-017 names; it shares no code with Prism.
fn uorc_objects(archive: &[u8]) -> Result<Vec<&[u8]>, Box<dyn std::error::Error>> {
    if !archive.starts_with(b"UORC\x02\x01") || archive.len() < 8 + 32 {
        return Err("archive is not a UORC format 2 profile 1 archive".into());
    }
    let (preimage, seal) = archive.split_at(archive.len() - 32);
    if uorc_chain(preimage)? != seal {
        return Err("UORC-SHA256-CHAIN-v1 seal does not match the archive".into());
    }
    if preimage[6] != 0 || preimage[7] != 0 {
        return Err("UORC archive is not self-contained and raw".into());
    }
    let (count, mut at) = uleb(preimage, 8).ok_or("UORC object count")?;
    if count == 0 || count > 16 {
        return Err("UORC archive exceeds the holo object budget".into());
    }
    let mut lengths = Vec::new();
    let mut total = 0u64;
    for _ in 0..count {
        let (length, next) = uleb(preimage, at).ok_or("UORC object length")?;
        total = total
            .checked_add(length)
            .filter(|total| *total <= 1 << 30)
            .ok_or("UORC archive exceeds the holo byte budget")?;
        lengths.push(usize::try_from(length)?);
        at = next;
    }
    let (body, mut offset) = uleb(preimage, at).ok_or("UORC body length")?;
    if body != total || (preimage.len() - offset) as u64 != total {
        return Err("UORC body length disagrees with its objects".into());
    }
    Ok(lengths
        .into_iter()
        .map(|length| {
            let object = &preimage[offset..offset + length];
            offset += length;
            object
        })
        .collect())
}

/// A holo v5 read by the UORC reader above, and the Hologram v4 archive that
/// carries its capability set, guest, view and model byte for byte, written by
/// the pinned upstream writer. Hologram Live admits only physical v4, so the
/// harness hands it this projection; every check below runs against it, and
/// the report names the v5 file.
struct HoloV5 {
    application_kappa: String,
    archive_kappa: String,
    seal: String,
    projection: Vec<u8>,
}

fn read_holo_v5(archive: &[u8], name: &str) -> Result<HoloV5, Box<dyn std::error::Error>> {
    const ROLES: [&str; 7] = [
        "manifest",
        "source-manifest",
        "provenance",
        "capabilities",
        "guest",
        "view",
        "model",
    ];
    let objects = uorc_objects(archive)?;
    if objects.len() != ROLES.len() && objects.len() != ROLES.len() + 1 {
        return Err("holo v5 does not hold the application roles".into());
    }
    let manifest: Value = serde_json::from_slice(objects[0])?;
    if manifest["schema"] != "prism/holo/5" || manifest["name"] != name {
        return Err("holo v5 manifest does not name this application".into());
    }
    let listed = manifest["objects"]
        .as_array()
        .ok_or("holo v5 manifest lists no objects")?;
    if listed.len() != 5 {
        return Err("holo v5 manifest does not list objects 1 and 3 to 6".into());
    }
    for (row, index) in listed.iter().zip([1usize, 3, 4, 5, 6]) {
        if row["role"] != ROLES[index]
            || row["kappa"] != kappa(objects[index])?.as_str()
            || row["length"] != objects[index].len()
        {
            return Err(format!(
                "holo v5 manifest disagrees with its {} object",
                ROLES[index]
            )
            .into());
        }
    }
    let [capabilities, guest, view, model] = [objects[3], objects[4], objects[5], objects[6]];
    let layers = &manifest["layers"];
    if manifest["requires"] != kappa(capabilities)?.as_str()
        || layers.as_array().map(Vec::len) != Some(2)
        || layers[0]["kind"] != "wasm"
        || layers[0]["kappa"] != kappa(guest)?.as_str()
        || layers[0]["entry"] != "holo_run"
        || layers[0]["contract"] != "hologram:guest/core-wasm@1"
        || layers[1]["kind"] != "view"
        || layers[1]["kappa"] != kappa(view)?.as_str()
        || layers[1]["entry"] != "index.html"
        || layers[1]["surface"] != "portable"
    {
        return Err("holo v5 layers disagree with the application profile".into());
    }

    let app = AppManifest {
        primary: Some(0),
        requires: address_bytes(capabilities),
        layers: vec![
            Layer::wasm_with_contract(
                address_bytes(guest),
                "holo_run",
                "hologram:guest/core-wasm@1",
            ),
            Layer {
                entry: "index.html".to_owned(),
                ..Layer::view(address_bytes(view), "portable")
            },
        ],
        children: Vec::new(),
    };
    let addressed =
        [capabilities, guest, view, model].map(|content| (address_bytes(content), content));
    let directory = hologram_live::holo_directory::derive(
        &app,
        addressed
            .iter()
            .map(|(label, content)| (label.as_bytes(), *content)),
    )?;
    let mut writer = HoloWriter::new();
    writer.set_app_manifest(app.canonicalize());
    writer.set_metadata(objects[1].to_vec());
    writer.add_extension(
        hologram_live::holo_directory::DIRECTORY_EXTENSION_KEY,
        hologram_live::holo_directory::encode(&directory)?,
    );
    for (label, content) in &addressed {
        writer.add_content_blob(label.as_bytes(), *content);
    }
    Ok(HoloV5 {
        application_kappa: kappa(objects[0])?,
        archive_kappa: kappa(archive)?,
        seal: hex(&archive[archive.len() - 32..]),
        projection: writer.finish()?,
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args_os().skip(1);
    let archive_path = arguments.next().ok_or("archive path is required")?;
    let model_path = arguments.next().ok_or("model path is required")?;
    let wasm_path = arguments.next().ok_or("Core-Wasm path is required")?;
    let browser_script = arguments
        .next()
        .ok_or("portable browser oracle script is required")?;
    let node = arguments
        .next()
        .ok_or("verified Node executable is required")?;
    let browser = arguments
        .next()
        .ok_or("verified browser executable is required")?;
    if arguments.next().is_some() {
        return Err("unexpected argument".into());
    }
    let archive = std::fs::read(archive_path)?;
    let wasm = std::fs::read(wasm_path)?;
    let model: Value = serde_json::from_slice(&std::fs::read(model_path)?)?;
    let application = &model["application"];
    // Match the production fail-fast check to authoritative upstream constants,
    // before guest invocation or any model-sized negative-case allocation.
    if hologram_view_surface::MAX_INTENT_PAYLOAD_BYTES != 65_536
        || hologram_view_surface::MAX_INTENT_OUTPUT_BYTES != 1_048_576
    {
        return Err("pinned portable View transport limits changed".into());
    }
    for (field, maximum) in [
        (
            "request_maximum",
            hologram_view_surface::MAX_INTENT_PAYLOAD_BYTES,
        ),
        (
            "response_maximum",
            hologram_view_surface::MAX_INTENT_OUTPUT_BYTES,
        ),
    ] {
        if application[field]
            .as_u64()
            .is_none_or(|value| value == 0 || value > maximum as u64)
        {
            return Err("application bounds exceed pinned portable View transport limits".into());
        }
    }
    let vectors = application["acceptance_vectors"]
        .as_array()
        .ok_or("model has no acceptance vectors")?;
    if vectors.is_empty() {
        return Err("model acceptance corpus is empty".into());
    }

    let name = application["name"]
        .as_str()
        .ok_or("application name is required")?;
    // A holo v5 (ADR-017) is read here as UORC; Hologram Live runs its
    // upstream-written v4 projection, which carries the same content bytes.
    let holo = read_holo_v5(&archive, name)?;
    let archive = holo.projection.clone();
    let inspection = inspect_bytes("oracle", &format!("{name}.holo"), &archive)?;
    if inspection.format_version != 4 || !inspection.footer_verified {
        return Err("upstream inspection did not verify Hologram v4/footer".into());
    }
    let directory = inspection
        .directory
        .as_ref()
        .ok_or("upstream inspection found no application directory")?;
    if !inspection.directory_embedded
        || directory.primary_layer != Some(0)
        || directory.layers.len() != 2
        || directory.layers[0].kind != "wasm"
        || directory.layers[0].entry != "holo_run"
        || directory.layers[0].contract.as_deref() != Some("hologram:guest/core-wasm@1")
        || directory.layers[1].kind != "view"
        || directory.layers[1].surface.as_deref() != Some("portable")
        || directory.blobs.len() != 4
    {
        return Err("upstream application directory disagrees with the application profile".into());
    }

    let plan = serde_json::to_value(plan_bytes(&archive)?)?;
    if plan["execution_target"] != "direct"
        || plan["runnable"] != false
        || plan["layers"][0]["provider"]["name"] != "wasmtime-direct"
        || plan["layers"][1]["provider"]["status"] != "unavailable"
        || plan["blockers"][0]["error_code"] != "LIVE_CAPABILITY_MISSING"
    {
        return Err(
            "upstream headless plan did not report the exact portable-surface blocker".into(),
        );
    }

    let registry = Arc::new(hologram_view_surface::ViewSurfaceRegistry::new());
    let surface = Arc::new(RecordingSurface::default());
    registry.register_portable(surface.clone())?;
    let session = HoloExecutor::with_view_surfaces(registry)
        .start_session(&archive)
        .await?;
    if surface.attached.load(Ordering::SeqCst) != 1 {
        return Err("portable View did not attach exactly once".into());
    }
    let attachment = surface
        .attachment
        .lock()
        .map_err(|_| "attachment lock poisoned")?
        .clone()
        .ok_or("portable View attachment was not retained")?;
    let paths = attachment
        .assets
        .iter()
        .map(|asset| asset.path.as_str())
        .collect::<Vec<_>>();
    // Closure v2 (#612) may attach the Hologram brand files beside the page.
    const BRAND: [&str; 10] = [
        "Archivo-SemiBold.woff2",
        "Geist-Medium.woff2",
        "Geist-Regular.woff2",
        "Geist-SemiBold.woff2",
        "GeistMono-Regular.woff2",
        "OFL-Archivo.txt",
        "OFL-Geist.txt",
        "icon-512.png",
        "icon.svg",
        "manifest.webmanifest",
    ];
    let mut closure_v2 = ["app.css", "app.js", "index.html"]
        .into_iter()
        .chain(BRAND)
        .collect::<Vec<_>>();
    closure_v2.sort_unstable();
    if attachment.entry != "index.html"
        || (paths != ["app.css", "app.js", "index.html"] && paths != closure_v2)
    {
        return Err("attached portable View asset closure/order is not canonical".into());
    }

    let mut intent_count = 0usize;
    let mut lifecycle_request = None;
    for vector in vectors {
        let request = bytes(vector, "request")?;
        let response = bytes(vector, "response")?;
        let direct = session.invoke(vec![request.clone()]).await?;
        if direct.outputs != vec![response.clone()] {
            return Err("upstream direct execution disagrees with a modeled vector".into());
        }
        if let (Ok(payload), Ok(expected)) =
            (String::from_utf8(request), String::from_utf8(response))
        {
            let request = ViewIntentRequest {
                version: VIEW_INTENT_VERSION,
                name: APPLICATION_INVOKE_INTENT.to_owned(),
                payload,
            };
            let intent = attachment
                .intents
                .handle(&attachment.id, request.clone())
                .await?;
            if intent.version != VIEW_INTENT_VERSION || intent.outputs != vec![expected.clone()] {
                return Err("portable View intent disagrees with a modeled vector".into());
            }
            lifecycle_request.get_or_insert((request, expected));
            intent_count += 1;
        }
    }
    let allocation_cap = usize::try_from(
        application["guest_allocation_maximum"]
            .as_u64()
            .ok_or("model has no guest allocation cap")?,
    )?;
    let boundary_vectors = vectors
        .iter()
        .map(|vector| Ok((bytes(vector, "request")?, bytes(vector, "response")?)))
        .collect::<Result<Vec<_>, String>>()?;
    let (boundary_request, boundary_response) = allocation_boundary(
        application["profile"].as_str(),
        allocation_cap,
        &boundary_vectors,
    )?;
    let at_cap = session.invoke(vec![boundary_request]).await?;
    if at_cap.outputs != vec![boundary_response] {
        return Err("guest allocation cap did not return the modeled boundary response".into());
    }
    if session
        .invoke(vec![vec![b'x'; allocation_cap + 1]])
        .await
        .is_ok()
    {
        return Err("first over-cap Core-Wasm request did not fail".into());
    }

    let (mut browser, mut browser_output, server, stopped) = browser_start(
        surface.clone(),
        application,
        std::path::Path::new(&browser_script),
        std::path::Path::new(&node),
        std::path::Path::new(&browser),
    )
    .await?;
    // Reuse an actually successful modeled intent, not a numeric payload that
    // a different application could reject equally before and after stop.
    let (lifecycle_request, expected) = lifecycle_request.ok_or("no live lifecycle intent")?;
    let live = attachment
        .intents
        .handle(&attachment.id, lifecycle_request.clone())
        .await?;
    if live.version != VIEW_INTENT_VERSION || live.outputs != vec![expected] {
        return Err("lifecycle intent no longer succeeds before stop".into());
    }
    session.stop().await?;
    session.stop().await?;
    if surface.detached.load(Ordering::SeqCst) != 1 {
        return Err("portable View did not detach exactly once".into());
    }
    if attachment
        .intents
        .handle(&attachment.id, lifecycle_request)
        .await
        .is_ok()
    {
        return Err("stale portable View intent remained usable after stop".into());
    }
    browser
        .stdin
        .as_mut()
        .ok_or("browser stdin missing")?
        .write_all(format!("{stopped}\n").as_bytes())
        .await?;
    let portable_browser = browser_line(&mut browser_output).await?;
    browser.stdin.take();
    let status = tokio::time::timeout(std::time::Duration::from_secs(15), browser.wait()).await??;
    server.abort();
    if !status.success() {
        return Err("portable browser oracle failed".into());
    }

    // Resident Hologram deliberately has a headless View provider, so use the
    // exact modeled primary bytes in an upstream-written primary-only archive.
    // The composed archive itself was already checked above, including its
    // mandatory unavailable-surface result under headless planning.
    let capabilities = hologram_live::holo_capability::empty_canonical();
    let manifest = AppManifest {
        primary: Some(0),
        requires: address_bytes(&capabilities),
        layers: vec![Layer::wasm_with_contract(
            address_bytes(&wasm),
            "holo_run",
            "hologram:guest/core-wasm@1",
        )],
        children: Vec::new(),
    };
    let addressed = [
        (address_bytes(&capabilities), capabilities.as_slice()),
        (address_bytes(&wasm), wasm.as_slice()),
    ];
    let directory = hologram_live::holo_directory::derive(
        &manifest,
        addressed
            .iter()
            .map(|(kappa, content)| (kappa.as_bytes(), *content)),
    )?;
    let mut writer = HoloWriter::new();
    writer.set_app_manifest(manifest.canonicalize());
    writer.add_extension(
        hologram_live::holo_directory::DIRECTORY_EXTENSION_KEY,
        hologram_live::holo_directory::encode(&directory)?,
    );
    for (kappa, content) in addressed {
        writer.add_content_blob(kappa.as_bytes(), content);
    }
    let resident_archive = writer.finish()?;
    let store_root = tempfile::tempdir()?;
    let store = Arc::new(ObjectStore::open(store_root.path())?);
    let catalog = Arc::new(HoloCatalog::new(store));
    let resident_kappa = catalog
        .import(format!("{name}-primary.holo"), resident_archive)?
        .kappa;
    let runtime = HoloRuntime::new(catalog, 8);
    runtime.load(&resident_kappa).await?;
    for vector in vectors {
        let response = runtime
            .run(&resident_kappa, vec![bytes(vector, "request")?])
            .await?;
        if response.outputs != vec![bytes(vector, "response")?] {
            return Err("upstream resident execution disagrees with a modeled vector".into());
        }
    }
    runtime.unload(&resident_kappa).await?;
    runtime.unload(&resident_kappa).await?;

    println!(
        "{}",
        serde_json::to_string(&json!({
            "application_kappa": holo.application_kappa,
            "archive_fingerprint": holo.seal,
            "archive_kappa": holo.archive_kappa,
            "direct_vectors": vectors.len(),
            "footer_verified": true,
            "guest_allocation_boundary": "verified",
            "intent_vectors": intent_count,
            "resident_vectors": vectors.len(),
            "portable_browser": portable_browser,
            "schema": "prismpm/hologram-oracle/2",
            "view_attached": 1,
            "view_detached": 1
        }))?
    );
    Ok(())
}
