//! `prismpm lock` and `prismpm update` (docs/proposals/265-lock-update.md).
//!
//! Both rewrite `prismpm.lock` without building, and both report what changed
//! as `prismpm/sdk-lock-change/1`. `lock` pins what the project determines
//! and leaves every pin that still resolves alone. `update` also moves the
//! pins the project does not determine: the toolchain and generator pins, and
//! with `--toolchain` the SDK image itself.

use crate::contracts::CanonicalDocument;
use crate::error::PrismError;
use crate::input_lock::{
    changed_fields, create_lock, with_inputs, write_lock, SDK_LOCK_V1, SDK_LOCK_V3,
};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::path::Path;

const CHANGE_SCHEMA: &str = "prismpm/sdk-lock-change/1";

/// Pins that only `prismpm update` moves: the compilers and generators the
/// running PrismPM carries, which `prismpm lock` never reinterprets.
const MOVED_BY_UPDATE: [&str; 2] = ["inputs.generation", "inputs.toolchain"];

/// An SDK image to pin, with the standards-lock digest it selects.
pub(crate) struct Target<'a> {
    pub(crate) sdk_image: &'a str,
    pub(crate) standards_lock: &'a str,
}

type Committed = Option<(CanonicalDocument, Vec<u8>)>;

/// `prismpm lock [--check]`: write or refresh the pinned inputs.
pub(crate) fn lock(
    root: &Path,
    check: bool,
    current: impl FnOnce() -> Result<Value, PrismError>,
) -> Result<(Value, String), PrismError> {
    lock_committed(root, crate::sdk::committed_lock(root)?, check, current)
}

/// `prismpm update [--toolchain REF] [--dry-run]`: move the pins forward.
pub(crate) fn update(
    root: &Path,
    target: Option<&Target<'_>>,
    dry_run: bool,
    current: impl FnOnce() -> Result<Value, PrismError>,
    capture: impl FnOnce(&Target<'_>) -> Result<CanonicalDocument, PrismError>,
) -> Result<(Value, String), PrismError> {
    update_committed(
        root,
        crate::sdk::committed_lock(root)?,
        target,
        dry_run,
        current,
        capture,
    )
}

fn lock_committed(
    root: &Path,
    committed: Committed,
    check: bool,
    current: impl FnOnce() -> Result<Value, PrismError>,
) -> Result<(Value, String), PrismError> {
    let (lock, original) = bound(committed, "prismpm update --toolchain <sdk-image>")?;
    let inputs = current()?;
    if lock.schema() == SDK_LOCK_V3 {
        let moved = changed_fields(&lock.value()["inputs"], &inputs)
            .into_iter()
            .filter(|field| MOVED_BY_UPDATE.contains(&field.as_str()))
            .collect::<Vec<_>>();
        if !moved.is_empty() {
            return Err(PrismError::new(
                "PP5401",
                format!(
                    "prismpm.lock is stale: {} changed with the toolchain, which `prismpm lock` does not move; run `prismpm update` and commit prismpm.lock",
                    moved.join(", ")
                ),
            ));
        }
    }
    let proposed = with_inputs(lock.value(), inputs)?;
    let change = Change {
        command: "lock",
        from: Some(&lock),
        original: Some(&original),
        to: &proposed,
        dry_run: check,
        notes: Vec::new(),
    };
    if check {
        let changes = change.changes();
        if !changes.is_empty() {
            return Err(PrismError::new(
                "PP5401",
                format!(
                    "prismpm.lock is stale: {} changed; run `prismpm lock` and commit prismpm.lock",
                    paths(&changes)
                ),
            ));
        }
    }
    change.apply(root)
}

fn update_committed(
    root: &Path,
    committed: Committed,
    target: Option<&Target<'_>>,
    dry_run: bool,
    current: impl FnOnce() -> Result<Value, PrismError>,
    capture: impl FnOnce(&Target<'_>) -> Result<CanonicalDocument, PrismError>,
) -> Result<(Value, String), PrismError> {
    if target.is_none() && committed.is_none() {
        return Err(unresolved(
            "prismpm.lock is absent and no SDK is named; run `prismpm update --toolchain <sdk-image>`",
        ));
    }
    if let Some((lock, _)) = &committed {
        legacy(lock)?;
    }
    let inputs = current()?;
    let mut notes = Vec::new();
    let proposed = match target {
        Some(target) => {
            let captured = capture(target).map_err(|error| {
                unresolved(&format!(
                    "the SDK image {} cannot be resolved: {}",
                    target.sdk_image, error.message
                ))
            })?;
            notes.push(format!(
                "the toolchain pins record the PrismPM that ran this command ({}); run `prismpm update` again inside the new SDK image to pin its toolchain",
                env!("CARGO_PKG_VERSION")
            ));
            with_inputs(captured.value(), inputs)?
        }
        None => {
            let (lock, _) = committed.as_ref().expect("checked above");
            with_inputs(lock.value(), inputs)?
        }
    };
    Change {
        command: "update",
        from: committed.as_ref().map(|(lock, _)| lock),
        original: committed.as_ref().map(|(_, bytes)| bytes.as_slice()),
        to: &proposed,
        dry_run,
        notes,
    }
    .apply(root)
}

/// The committed lock, which `prismpm lock` cannot create or upgrade past `/1`.
fn bound(committed: Committed, remedy: &str) -> Result<(CanonicalDocument, Vec<u8>), PrismError> {
    let Some((lock, bytes)) = committed else {
        return Err(unresolved(&format!(
            "prismpm.lock is absent, so there is no SDK to pin inputs to; bind one with `{remedy}`"
        )));
    };
    legacy(&lock)?;
    Ok((lock, bytes))
}

fn legacy(lock: &CanonicalDocument) -> Result<(), PrismError> {
    if lock.schema() == SDK_LOCK_V1 {
        return Err(unresolved(
            "prismpm.lock is a legacy prismpm/sdk-lock/1; run `prismpm lock migrate` and adopt the proposal first",
        ));
    }
    Ok(())
}

/// A lock that cannot be resolved is a configuration failure, exit 2.
fn unresolved(message: &str) -> PrismError {
    PrismError::new("PP1101", message)
}

/// One proposed rewrite of `prismpm.lock`.
struct Change<'a> {
    command: &'static str,
    from: Option<&'a CanonicalDocument>,
    original: Option<&'a [u8]>,
    to: &'a CanonicalDocument,
    dry_run: bool,
    notes: Vec<String>,
}

impl Change<'_> {
    /// Pin-level differences between the committed lock and the proposal.
    fn changes(&self) -> Vec<Value> {
        let mut out = Vec::new();
        diff(
            "",
            self.from.map(|lock| view(lock.value())).as_ref(),
            Some(&view(self.to.value())),
            &mut out,
        );
        out
    }

    /// Write the proposal unless this is a dry run or nothing changed.
    fn apply(self, root: &Path) -> Result<(Value, String), PrismError> {
        let changes = self.changes();
        let changed = self.from.map(CanonicalDocument::bytes) != Some(self.to.bytes());
        let written = changed && !self.dry_run;
        if written {
            match self.original {
                Some(original) => write_lock(root, original, self.to)?,
                None => create_lock(root, self.to)?,
            }
        }
        let human = describe(&self, &changes, changed, written);
        let value = CanonicalDocument::from_value(
            CHANGE_SCHEMA,
            json!({
                "changed": changed,
                "changes": changes,
                "command": self.command,
                "dry_run": self.dry_run,
                "lock_digest": {"from": self.from.map(CanonicalDocument::digest), "to": self.to.digest()},
                "notes": self.notes,
                "schema": CHANGE_SCHEMA,
                "sdk_image": {
                    "from": self.from.map(|lock| lock.value()["sdk_image"].clone()),
                    "to": self.to.value()["sdk_image"]
                },
                "written": written
            }),
        )?
        .value()
        .clone();
        Ok((value, human))
    }
}

fn describe(change: &Change<'_>, changes: &[Value], changed: bool, written: bool) -> String {
    let mut lines = vec![if !changed {
        "prismpm.lock is current; no pin changed".to_owned()
    } else if written {
        format!("prismpm.lock written: {}", summary(changes))
    } else {
        format!("prismpm.lock would change: {}", summary(changes))
    }];
    for row in changes {
        lines.push(format!(
            "  {}: {} -> {}",
            row["path"].as_str().unwrap_or_default(),
            text(&row["from"]),
            text(&row["to"])
        ));
    }
    lines.push(format!(
        "  lock digest: {} -> {}",
        change
            .from
            .map_or_else(|| "none".to_owned(), CanonicalDocument::digest),
        change.to.digest()
    ));
    for note in &change.notes {
        lines.push(format!("note: {note}"));
    }
    lines.join("\n")
}

fn summary(changes: &[Value]) -> String {
    match changes.len() {
        1 => "1 pin changed".to_owned(),
        count => format!("{count} pins changed"),
    }
}

fn text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn paths(changes: &[Value]) -> String {
    changes
        .iter()
        .filter_map(|row| row["path"].as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// The digest-level view of a lock: every pin a reviewer compares. The bulky
/// platform inventories and the OCI index are covered by their digests.
fn view(lock: &Value) -> Value {
    let mut platforms = Map::new();
    for row in lock["platforms"].as_array().into_iter().flatten() {
        if let Some(name) = row["platform"].as_str() {
            platforms.insert(
                name.to_owned(),
                json!({
                    "inventory_digest": row["inventory_digest"],
                    "manifest_digest": row["manifest_digest"]
                }),
            );
        }
    }
    let mut view = Map::new();
    for key in ["sdk_image", "sdk_version", "standards_lock"] {
        view.insert(key.to_owned(), lock[key].clone());
    }
    view.insert("platforms".to_owned(), Value::Object(platforms));
    if let Some(inputs) = lock.get("inputs") {
        view.insert("inputs".to_owned(), inputs.clone());
    }
    Value::Object(view)
}

/// Leaf differences as RFC 6901 paths, in key order. A missing object side
/// compares as empty, so a newly pinned `inputs` lists each of its pins.
fn diff(path: &str, from: Option<&Value>, to: Option<&Value>, out: &mut Vec<Value>) {
    let members = |value: Option<&Value>| match value {
        None => Some(Map::new()),
        Some(Value::Object(object)) => Some(object.clone()),
        Some(_) => None,
    };
    if let (Some(from_members), Some(to_members)) = (members(from), members(to)) {
        if from.is_some() || to.is_some() {
            let names = from_members
                .keys()
                .chain(to_members.keys())
                .collect::<BTreeSet<_>>();
            for name in names {
                diff(
                    &format!("{path}/{}", name.replace('~', "~0").replace('/', "~1")),
                    from_members.get(name),
                    to_members.get(name),
                    out,
                );
            }
            return;
        }
    }
    if from != to {
        out.push(json!({
            "from": from.cloned().unwrap_or(Value::Null),
            "path": path,
            "to": to.cloned().unwrap_or(Value::Null)
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input_lock::{sample_inputs, sample_platform_lock, SDK_LOCK_V2};

    fn v2(salt: &str) -> CanonicalDocument {
        CanonicalDocument::from_value(SDK_LOCK_V2, sample_platform_lock(salt)).unwrap()
    }

    fn v3(salt: &str, inputs: Value) -> CanonicalDocument {
        with_inputs(v2(salt).value(), inputs).unwrap()
    }

    fn project(lock: &CanonicalDocument) -> (tempfile::TempDir, Committed) {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("prismpm.lock"), lock.bytes()).unwrap();
        (root, Some((lock.clone(), lock.bytes().to_vec())))
    }

    fn on_disk(root: &Path) -> Vec<u8> {
        std::fs::read(root.join("prismpm.lock")).unwrap()
    }

    fn never() -> Result<Value, PrismError> {
        panic!("inputs must not be computed")
    }

    fn no_capture(_: &Target<'_>) -> Result<CanonicalDocument, PrismError> {
        panic!("no SDK may be captured")
    }

    fn paths_of(result: &Value) -> Vec<String> {
        result["changes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["path"].as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn lock_needs_a_bound_sdk_and_reports_exit_two() {
        let root = tempfile::tempdir().unwrap();
        let absent = lock_committed(root.path(), None, false, never).unwrap_err();
        assert_eq!((absent.code.as_str(), absent.exit_code()), ("PP1101", 2));
        assert!(absent.message.contains("prismpm update --toolchain"));
        let digest = format!("sha256:{}", "a".repeat(64));
        let legacy = CanonicalDocument::from_value(
            SDK_LOCK_V1,
            json!({"schema":SDK_LOCK_V1,"sdk_version":"0.3.0",
                "sdk_image":format!("example.invalid/test-sdk@{digest}"),
                "standards_lock":format!("sha256:{}", "b".repeat(64)),
                "inventory":[{"id":"sdk-manifest","kind":"image","version":"0.3.0","digest":digest}]}),
        )
        .unwrap();
        let (root, committed) = project(&legacy);
        let error = lock_committed(root.path(), committed, false, never).unwrap_err();
        assert_eq!((error.code.as_str(), error.exit_code()), ("PP1101", 2));
        assert!(error.message.contains("lock migrate"));
        assert_eq!(on_disk(root.path()), legacy.bytes());
    }

    #[test]
    fn lock_upgrades_a_v2_lock_then_leaves_a_current_lock_untouched() {
        let before = v2("");
        let (root, committed) = project(&before);
        let (result, human) =
            lock_committed(root.path(), committed, false, || Ok(sample_inputs())).unwrap();
        assert_eq!(result["changed"], true);
        assert_eq!(result["written"], true);
        assert_eq!(result["command"], "lock");
        assert!(paths_of(&result).contains(&"/inputs/model/blake3".to_owned()));
        assert!(human.contains("/inputs/model/blake3"), "{human}");
        let after = crate::sdk::parse_full_lock(&on_disk(root.path())).unwrap();
        assert_eq!(after.schema(), SDK_LOCK_V3);
        assert_eq!(after.value()["inputs"], sample_inputs());
        assert_eq!(result["lock_digest"]["from"], before.digest());
        assert_eq!(result["lock_digest"]["to"], after.digest());

        let bytes = on_disk(root.path());
        let committed = Some((after.clone(), bytes.clone()));
        let (again, human) =
            lock_committed(
                root.path(),
                committed.clone(),
                false,
                || Ok(sample_inputs()),
            )
            .unwrap();
        assert_eq!(
            (again["changed"].clone(), again["written"].clone()),
            (false.into(), false.into())
        );
        assert_eq!(again["changes"], json!([]));
        assert!(human.contains("no pin changed"), "{human}");
        assert_eq!(on_disk(root.path()), bytes);
        let (checked, _) =
            lock_committed(root.path(), committed, true, || Ok(sample_inputs())).unwrap();
        assert_eq!(checked["changed"], false);
    }

    #[test]
    fn lock_moves_only_the_pins_the_project_determines() {
        let locked = v3("", sample_inputs());
        let (root, committed) = project(&locked);
        let mut edited = sample_inputs();
        edited["model"]["blake3"] = json!("f".repeat(64));
        edited["spec"]["blake3"] = json!("e".repeat(64));
        let (result, _) =
            lock_committed(root.path(), committed, false, || Ok(edited.clone())).unwrap();
        assert_eq!(
            paths_of(&result),
            ["/inputs/model/blake3", "/inputs/spec/blake3"]
        );
        let after = crate::sdk::parse_full_lock(&on_disk(root.path())).unwrap();
        assert_eq!(after.value()["inputs"], edited);
        assert_eq!(
            crate::input_lock::sdk_projection(after.value()),
            crate::input_lock::sdk_projection(locked.value())
        );
    }

    #[test]
    fn lock_check_writes_nothing_and_names_what_is_stale() {
        let locked = v3("", sample_inputs());
        let (root, committed) = project(&locked);
        let mut edited = sample_inputs();
        edited["model"]["sha256"] = json!("d".repeat(64));
        let error =
            lock_committed(root.path(), committed, true, || Ok(edited.clone())).unwrap_err();
        assert_eq!(error.code, "PP5401");
        assert!(
            error.message.contains("/inputs/model/sha256"),
            "{}",
            error.message
        );
        assert_eq!(on_disk(root.path()), locked.bytes());
        let (root, committed) = project(&v2(""));
        let error =
            lock_committed(root.path(), committed, true, || Ok(sample_inputs())).unwrap_err();
        assert!(error.message.contains("/inputs/"), "{}", error.message);
        assert_eq!(on_disk(root.path()), v2("").bytes());
    }

    #[test]
    fn lock_refuses_to_move_the_toolchain_and_points_at_update() {
        let mut older = sample_inputs();
        older["toolchain"]["rustc"] = json!("1.0.0");
        older["generation"]["application_generator_sha256"] = json!("9".repeat(64));
        let locked = v3("", older);
        let (root, committed) = project(&locked);
        for check in [false, true] {
            let error =
                lock_committed(
                    root.path(),
                    committed.clone(),
                    check,
                    || Ok(sample_inputs()),
                )
                .unwrap_err();
            assert_eq!(error.code, "PP5401");
            assert!(
                error.message.contains("inputs.toolchain"),
                "{}",
                error.message
            );
            assert!(
                error.message.contains("inputs.generation"),
                "{}",
                error.message
            );
            assert!(
                error.message.contains("prismpm update"),
                "{}",
                error.message
            );
            assert_eq!(on_disk(root.path()), locked.bytes());
        }
    }

    #[test]
    fn update_moves_the_toolchain_pins_and_prints_old_and_new() {
        let mut older = sample_inputs();
        older["toolchain"]["rustc"] = json!("1.0.0");
        let locked = v3("", older);
        let (root, committed) = project(&locked);
        let (preview, _) = update_committed(
            root.path(),
            committed.clone(),
            None,
            true,
            || Ok(sample_inputs()),
            no_capture,
        )
        .unwrap();
        assert_eq!(preview["dry_run"], true);
        assert_eq!(preview["changed"], true);
        assert_eq!(preview["written"], false);
        assert_eq!(on_disk(root.path()), locked.bytes());

        let (result, human) = update_committed(
            root.path(),
            committed,
            None,
            false,
            || Ok(sample_inputs()),
            no_capture,
        )
        .unwrap();
        assert_eq!(result["command"], "update");
        assert_eq!(result["written"], true);
        assert_eq!(
            result["changes"],
            json!([{"from":"1.0.0","path":"/inputs/toolchain/rustc","to":sample_inputs()["toolchain"]["rustc"]}])
        );
        assert!(human.contains("1.0.0 ->"), "{human}");
        let after = crate::sdk::parse_full_lock(&on_disk(root.path())).unwrap();
        assert_eq!(result["lock_digest"]["from"], locked.digest());
        assert_eq!(result["lock_digest"]["to"], after.digest());
        assert_eq!(after.value()["inputs"], sample_inputs());
    }

    #[test]
    fn update_pins_a_new_sdk_and_lists_every_digest_that_moved() {
        let locked = v3("", sample_inputs());
        let (root, committed) = project(&locked);
        let image = v2("later/").value()["sdk_image"]
            .as_str()
            .unwrap()
            .to_owned();
        let standards = v2("later/").value()["standards_lock"]
            .as_str()
            .unwrap()
            .to_owned();
        let target = Target {
            sdk_image: &image,
            standards_lock: &standards,
        };
        let (result, human) = update_committed(
            root.path(),
            committed,
            Some(&target),
            false,
            || Ok(sample_inputs()),
            |asked| {
                assert_eq!(asked.sdk_image, image);
                Ok(v2("later/"))
            },
        )
        .unwrap();
        assert_eq!(result["sdk_image"]["from"], locked.value()["sdk_image"]);
        assert_eq!(result["sdk_image"]["to"], image);
        assert_eq!(
            paths_of(&result),
            [
                "/platforms/linux~1amd64/inventory_digest",
                "/platforms/linux~1amd64/manifest_digest",
                "/platforms/linux~1arm64/inventory_digest",
                "/platforms/linux~1arm64/manifest_digest",
                "/sdk_image"
            ]
        );
        assert!(human.contains(&image), "{human}");
        assert!(result["notes"][0]
            .as_str()
            .unwrap()
            .contains("inside the new SDK"));
        let after = crate::sdk::parse_full_lock(&on_disk(root.path())).unwrap();
        assert_eq!(after.schema(), SDK_LOCK_V3);
        assert_eq!(after.value()["sdk_image"], image);
        assert_eq!(after.value()["inputs"], sample_inputs());
    }

    #[test]
    fn update_binds_a_first_sdk_and_refuses_to_clobber_a_racing_lock() {
        let root = tempfile::tempdir().unwrap();
        let image = v2("").value()["sdk_image"].as_str().unwrap().to_owned();
        let standards = v2("").value()["standards_lock"]
            .as_str()
            .unwrap()
            .to_owned();
        let target = Target {
            sdk_image: &image,
            standards_lock: &standards,
        };
        let (result, _) = update_committed(
            root.path(),
            None,
            Some(&target),
            false,
            || Ok(sample_inputs()),
            |_| Ok(v2("")),
        )
        .unwrap();
        assert_eq!(result["lock_digest"]["from"], Value::Null);
        assert_eq!(result["sdk_image"]["from"], Value::Null);
        assert_eq!(result["written"], true);
        assert!(paths_of(&result).contains(&"/inputs/world/blake3".to_owned()));
        let created = on_disk(root.path());
        assert_eq!(
            crate::sdk::parse_full_lock(&created).unwrap().schema(),
            SDK_LOCK_V3
        );
        let error = update_committed(
            root.path(),
            None,
            Some(&target),
            false,
            || Ok(sample_inputs()),
            |_| Ok(v2("")),
        )
        .unwrap_err();
        assert_eq!(error.code, "PP5401");
        assert_eq!(on_disk(root.path()), created);
    }

    #[test]
    fn update_that_cannot_resolve_its_lock_exits_two() {
        let root = tempfile::tempdir().unwrap();
        let absent =
            update_committed(root.path(), None, None, false, never, no_capture).unwrap_err();
        assert_eq!((absent.code.as_str(), absent.exit_code()), ("PP1101", 2));
        let target = Target {
            sdk_image: "example.invalid/test-sdk@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            standards_lock: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        };
        let error = update_committed(
            root.path(),
            None,
            Some(&target),
            false,
            || Ok(sample_inputs()),
            |_| Err(PrismError::new("PP5401", "registry unreachable")),
        )
        .unwrap_err();
        assert_eq!((error.code.as_str(), error.exit_code()), ("PP1101", 2));
        assert!(error.message.contains("registry unreachable"));
        assert!(!root.path().join("prismpm.lock").exists());
        let (locked_root, committed) = project(&v3("", sample_inputs()));
        let error = update_committed(
            locked_root.path(),
            committed,
            Some(&target),
            false,
            || Ok(sample_inputs()),
            |_| Err(PrismError::new("PP5401", "registry unreachable")),
        )
        .unwrap_err();
        assert_eq!(error.exit_code(), 2);
        assert_eq!(on_disk(locked_root.path()), v3("", sample_inputs()).bytes());
    }

    #[test]
    fn update_refuses_a_legacy_lock_before_any_work() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let legacy = CanonicalDocument::from_value(
            SDK_LOCK_V1,
            json!({"schema":SDK_LOCK_V1,"sdk_version":"0.3.0",
                "sdk_image":format!("example.invalid/test-sdk@{digest}"),
                "standards_lock":format!("sha256:{}", "b".repeat(64)),
                "inventory":[{"id":"sdk-manifest","kind":"image","version":"0.3.0","digest":digest}]}),
        )
        .unwrap();
        let (root, committed) = project(&legacy);
        let error =
            update_committed(root.path(), committed, None, false, never, no_capture).unwrap_err();
        assert_eq!(error.exit_code(), 2);
        assert!(error.message.contains("lock migrate"));
        assert_eq!(on_disk(root.path()), legacy.bytes());
    }

    #[test]
    fn diff_lists_leaves_with_escaped_pointers_and_treats_a_missing_object_as_empty() {
        let mut out = Vec::new();
        diff(
            "",
            Some(&json!({"a/b":{"~":1},"same":true})),
            Some(&json!({"a/b":{"~":2},"new":{"x":null},"same":true})),
            &mut out,
        );
        assert_eq!(
            out,
            [
                json!({"from":1,"path":"/a~1b/~0","to":2}),
                json!({"from":null,"path":"/new/x","to":null})
            ]
        );
        let mut none = Vec::new();
        diff("", None, None, &mut none);
        diff("/world", Some(&Value::Null), Some(&Value::Null), &mut none);
        assert!(none.is_empty());
    }
}
