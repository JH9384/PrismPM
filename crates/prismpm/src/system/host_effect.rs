//! Closed containing-system profile for a service whose application acts through host effects.
//!
//! `prismpm/system-model/3` is the projection of
//! `Production.HostEffectSystem.SystemModel`. It names the server application
//! contract and the effects that application declares, the components that
//! run it (`api`, `worker`, `job`, `telemetry-collector`), their parameters,
//! secret references, volumes and networks, and the listeners it publishes.
//! The only target is the Compose adapter. A served application listens on
//! `127.0.0.1` only, and a port Docker publishes from a bridge network reaches
//! the container's interface, never its loopback, so an `api` component runs on
//! the host network and declares none: there its loopback is the host's.

use super::{secret_file_environment, spdx, CanonicalDocument, PrismError, Projection};
use crate::holo::canonical::encode_value;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const SCHEMA: &str = "prismpm/system-model/3";
pub(super) const MODULE: &str = "Production.HostEffectSystem";

fn invalid(message: &str) -> PrismError {
    PrismError::new("PP2101", message)
}

fn rows<'a>(system: &'a Value, name: &str) -> &'a [Value] {
    system[name].as_array().map_or(&[], Vec::as_slice)
}

fn text<'a>(row: &'a Value, field: &str) -> &'a str {
    row[field].as_str().unwrap_or_default()
}

fn strings<'a>(row: &'a Value, field: &str) -> Vec<&'a str> {
    row[field]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect()
}

fn ids<'a>(system: &'a Value, name: &str) -> BTreeSet<&'a str> {
    rows(system, name)
        .iter()
        .map(|row| text(row, "id"))
        .collect()
}

/// The loopback address of the Compose adapter's projection policy: the only
/// address a listener may bind and the only host address the projection names.
fn loopback() -> Result<String, PrismError> {
    crate::deployment::projection_policy("compose")?["loopback_address"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| PrismError::new("PP7101", "compose adapter names no loopback address"))
}

/// The scalar and list bindings the modeled manifest predicate checks.
pub(crate) fn certificate(system: &Value) -> Value {
    json!({
        "application_model_digest":system["application_profile"]["application_model_digest"],
        "effects":system["application_profile"]["effects"],
        "listeners":rows(system, "listeners").iter().map(|row| row["id"].clone()).collect::<Vec<_>>(),
        "product_id":system["product"]["id"],
        "product_version":system["product"]["version"]
    })
}

/// Hold a host-effect system to the application it binds. The manifest check
/// only sees the system's own effect list; this compares it with the host
/// protocol the selected server application declares, so a system cannot name
/// an effect its application never requests, or omit one it does.
pub(crate) fn validate_application(
    system: &Value,
    model: &crate::holo::model_document::ModelDocument,
) -> Result<(), PrismError> {
    let Some(crate::holo::model_document::Application::Server(application)) = &model.application
    else {
        return Err(invalid(
            "host-effect system requires a selected server application",
        ));
    };
    let declared: BTreeSet<&str> = application
        .host
        .effects
        .iter()
        .map(|effect| effect.name.as_str())
        .collect();
    let listed: BTreeSet<&str> = strings(&system["application_profile"], "effects")
        .into_iter()
        .collect();
    if declared != listed {
        return Err(invalid(&format!(
            "host-effect system lists effects {listed:?}, but its server application declares {declared:?}"
        )));
    }
    Ok(())
}

fn subset(items: &[&str], within: &BTreeSet<&str>) -> bool {
    items.iter().all(|item| within.contains(item))
}

/// The checks `Production.HostEffectSystem.validateManifest` makes over the
/// model, applied to the projected value. The closed schema owns shapes,
/// patterns and constants; this owns identities and references.
pub(super) fn validate(system: &Value, manifest: &Value) -> Result<(), PrismError> {
    let components = rows(system, "components");
    let listeners = rows(system, "listeners");
    let collections = [
        "components",
        "artifacts",
        "parameters",
        "secret_references",
        "volumes",
        "networks",
        "listeners",
        "targets",
    ];
    let identities = std::iter::once(text(&system["product"], "id"))
        .chain(
            collections
                .iter()
                .flat_map(|name| rows(system, name).iter().map(|row| text(row, "id"))),
        )
        .collect::<Vec<_>>();
    if identities.iter().collect::<BTreeSet<_>>().len() != identities.len() {
        return Err(invalid(
            "host-effect system identities are duplicated across its collections",
        ));
    }
    let effects = strings(&system["application_profile"], "effects");
    if effects.is_empty() || effects.iter().collect::<BTreeSet<_>>().len() != effects.len() {
        return Err(invalid(
            "host-effect system must declare at least one effect, each once",
        ));
    }
    let artifacts = ids(system, "artifacts");
    let parameters = ids(system, "parameters");
    let secrets = ids(system, "secret_references");
    let volumes = ids(system, "volumes");
    let networks = ids(system, "networks");
    let component_ids = ids(system, "components");
    let mut earlier = BTreeSet::new();
    for component in components {
        let kind = text(component, "kind");
        if !artifacts.contains(text(component, "artifact"))
            || !subset(&strings(component, "parameters"), &parameters)
            || !subset(&strings(component, "secrets"), &secrets)
            || !subset(&strings(component, "volumes"), &volumes)
            || !subset(&strings(component, "networks"), &networks)
        {
            return Err(invalid(
                "host-effect component references an undeclared artifact, parameter, secret, volume or network",
            ));
        }
        // An api component runs on the host network, so it declares none; every
        // other component is on at least one declared network.
        if (kind == "api") != strings(component, "networks").is_empty() {
            return Err(invalid(
                "host-effect api component declares no network, and every other component at least one",
            ));
        }
        // On the host network a second replica of an api component would bind
        // the same loopback port as the first, so an api component runs once.
        if kind == "api" && component["resources"]["replicas_max"].as_u64() != Some(1) {
            return Err(invalid(
                "host-effect api component runs exactly one replica",
            ));
        }
        if !subset(&strings(component, "depends_on"), &earlier) {
            return Err(invalid(
                "host-effect component depends on a component not declared before it",
            ));
        }
        if kind != "job" && strings(component, "readiness").is_empty() {
            return Err(invalid(
                "host-effect component other than a job needs a readiness command",
            ));
        }
        if component["resources"]["replicas_min"].as_u64()
            > component["resources"]["replicas_max"].as_u64()
        {
            return Err(invalid(
                "host-effect component replica minimum exceeds its maximum",
            ));
        }
        earlier.insert(text(component, "id"));
    }
    if rows(system, "secret_references")
        .iter()
        .any(|secret| !subset(&strings(secret, "consumers"), &component_ids))
    {
        return Err(invalid(
            "host-effect secret reference names an undeclared consumer",
        ));
    }
    let address = loopback()?;
    let mut ports = BTreeSet::new();
    for listener in listeners {
        let owner = components
            .iter()
            .find(|component| component["id"] == listener["component"]);
        if listener["bind_address"] != address.as_str()
            || !owner.is_some_and(|component| component["kind"] == "api")
            || !ports.insert(listener["port"].as_u64())
        {
            return Err(invalid(
                "host-effect listener must bind the loopback address, use a distinct port, and belong to an api component",
            ));
        }
    }
    if listeners.is_empty() {
        return Err(invalid("host-effect system must publish a listener"));
    }
    let target = &system["targets"][0];
    let (adapter, _) = crate::deployment::descriptor("compose")?;
    if rows(system, "targets").len() != 1
        || target["adapter_digest"] != crate::deployment::digest("compose")?
        || target["api_version"] != adapter["target_api"]
    {
        return Err(PrismError::new(
            "PP7101",
            "host-effect system target is not bound to the locked compose adapter",
        ));
    }
    if &certificate(system) != manifest {
        return Err(invalid(
            "host-effect system manifest binding differs from the model",
        ));
    }
    Ok(())
}

/// The projection never widens a binding: a listener of `component` that does
/// not name the adapter's loopback address is refused, not rewritten.
fn listeners_bind(system: &Value, component: &str, address: &str) -> Result<(), PrismError> {
    if rows(system, "listeners")
        .iter()
        .any(|listener| listener["component"] == component && listener["bind_address"] != address)
    {
        return Err(invalid(
            "host-effect listener does not bind the loopback address",
        ));
    }
    Ok(())
}

/// The Compose project: one service per component, hardened by the adapter's
/// policy. No service publishes a port: an api service is on the host network,
/// where its listeners bind the host's loopback, and every other service is on
/// its declared networks only.
pub(super) fn compose(system: &Value) -> Result<Value, PrismError> {
    let policy = crate::deployment::projection_policy("compose")?;
    let address = loopback()?;
    let artifacts = rows(system, "artifacts")
        .iter()
        .map(|row| (text(row, "id"), row))
        .collect::<BTreeMap<_, _>>();
    let parameters = rows(system, "parameters")
        .iter()
        .map(|row| (text(row, "id"), row))
        .collect::<BTreeMap<_, _>>();
    let volumes = rows(system, "volumes")
        .iter()
        .map(|row| (text(row, "id"), row))
        .collect::<BTreeMap<_, _>>();
    let kinds = rows(system, "components")
        .iter()
        .map(|row| (text(row, "id"), text(row, "kind")))
        .collect::<BTreeMap<_, _>>();
    let mut services = Map::new();
    for component in rows(system, "components") {
        let id = text(component, "id");
        let kind = text(component, "kind");
        let artifact = artifacts
            .get(text(component, "artifact"))
            .ok_or_else(|| invalid("host-effect component names an undeclared artifact"))?;
        let mut environment = Map::new();
        for name in strings(component, "parameters") {
            let parameter = parameters
                .get(name)
                .ok_or_else(|| invalid("host-effect component names an undeclared parameter"))?;
            let variable = name.replace('-', "_").to_ascii_uppercase();
            let value = if parameter["default"].is_null() {
                json!(format!("${{{variable}:?required}}"))
            } else {
                parameter["default"].clone()
            };
            environment.insert(variable, value);
        }
        environment.extend(secret_file_environment(component));
        let mounts = strings(component, "volumes")
            .into_iter()
            .map(|name| {
                let volume = volumes
                    .get(name)
                    .ok_or_else(|| invalid("host-effect component names an undeclared volume"))?;
                Ok(json!({"source":name,"target":volume["mount_path"],"type":"volume"}))
            })
            .collect::<Result<Vec<_>, PrismError>>()?;
        let depends_on = strings(component, "depends_on")
            .into_iter()
            .map(|dependency| {
                let condition = if kinds.get(dependency) == Some(&"job") {
                    "service_completed_successfully"
                } else {
                    "service_healthy"
                };
                (
                    dependency.to_owned(),
                    json!({"condition":condition,"required":true}),
                )
            })
            .collect::<Map<_, _>>();
        let secrets = strings(component, "secrets")
            .into_iter()
            .map(|name| json!({"source":name,"target":name}))
            .collect::<Vec<_>>();
        let cpus = format!(
            "{:.3}",
            component["resources"]["cpu_millis"]
                .as_u64()
                .unwrap_or_default() as f64
                / 1000.0
        );
        let memory = format!(
            "{}b",
            component["resources"]["memory_bytes"]
                .as_u64()
                .unwrap_or_default()
        );
        listeners_bind(system, id, &address)?;
        let mut service = json!({
            "cap_drop": policy["cap_drop"],
            "command": component["command"],
            "depends_on": depends_on,
            "deploy": {
                "replicas": component["resources"]["replicas_min"],
                "resources": {
                    "limits": {"cpus": cpus, "memory": memory},
                    "reservations": {"cpus": cpus, "memory": memory}
                }
            },
            "environment": environment,
            "image": format!("{}@{}", text(artifact, "path"), text(artifact, "digest")),
            "read_only": policy["read_only"],
            "restart": if kind == "job" { policy["restart_job"].clone() } else { policy["restart_service"].clone() },
            "secrets": secrets,
            "security_opt": policy["security_opt"],
            "tmpfs": if kind == "telemetry-collector" { policy["tmpfs_telemetry"].clone() } else { policy["tmpfs_default"].clone() },
            "volumes": mounts
        });
        if kind == "api" {
            service["network_mode"] = json!("host");
        } else {
            service["networks"] = component["networks"].clone();
        }
        if kind != "job" {
            service["healthcheck"] = json!({
                "interval": policy["healthcheck"]["interval"],
                "retries": policy["healthcheck"]["retries"],
                "start_period": policy["healthcheck"]["start_period"],
                "test": std::iter::once(json!("CMD")).chain(strings(component, "readiness").into_iter().map(|part| json!(part))).collect::<Vec<_>>(),
                "timeout": policy["healthcheck"]["timeout"]
            });
        }
        services.insert(id.to_owned(), service);
    }
    let networks = rows(system, "networks")
        .iter()
        .map(|row| {
            (
                text(row, "id").to_owned(),
                json!({"internal": row["internal"]}),
            )
        })
        .collect::<Map<_, _>>();
    let volumes = rows(system, "volumes")
        .iter()
        .map(|row| (text(row, "id").to_owned(), json!({})))
        .collect::<Map<_, _>>();
    let secrets = rows(system, "secret_references")
        .iter()
        .map(|row| {
            (
                text(row, "id").to_owned(),
                json!({"file":format!("${{PRISMPM_SECRET_DIR:?required}}/{}", text(row, "provider_key"))}),
            )
        })
        .collect::<Map<_, _>>();
    Ok(json!({
        "name": system["product"]["id"],
        "networks": networks,
        "secrets": secrets,
        "services": services,
        "volumes": volumes
    }))
}

/// Audit an emitted Compose project against the roles the model gives its
/// components: the services are exactly the components; an api service is on
/// the host network alone and runs one replica; every other service is on its
/// declared networks and names no network mode; and no service publishes or
/// exposes a port. The locked Compose oracle accepts any published port and
/// any network mode, so this is the check that a published wildcard, or a
/// worker moved onto the host network, cannot pass.
pub(crate) fn audit_compose(compose: &Value, system: &Value) -> Result<(), PrismError> {
    let components = rows(system, "components")
        .iter()
        .map(|row| (text(row, "id"), row))
        .collect::<BTreeMap<_, _>>();
    let services = compose["services"].as_object();
    if services.map_or(0, Map::len) != components.len() {
        return Err(invalid(
            "compose services are not the components of the model",
        ));
    }
    for (name, service) in services.into_iter().flatten() {
        let component = components.get(name.as_str()).ok_or_else(|| {
            invalid(&format!(
                "compose service {name} is not a component of the model"
            ))
        })?;
        let mode = service.get("network_mode");
        let networks = service.get("networks");
        let placed = if component["kind"] == "api" {
            mode == Some(&json!("host"))
                && networks.is_none()
                && service["deploy"]["replicas"] == json!(1)
        } else {
            mode.is_none() && networks == Some(&component["networks"])
        };
        if !placed {
            return Err(invalid(&format!(
                "compose service {name} is not placed as its component kind requires"
            )));
        }
        if service.get("ports").is_some() || service.get("expose").is_some() {
            return Err(invalid(&format!(
                "compose service {name} publishes or exposes a port"
            )));
        }
    }
    Ok(())
}

/// The mcp-loopback example, bound to the locked compose adapter.
#[cfg(test)]
pub(crate) fn example() -> (CanonicalDocument, Value) {
    let mut fixture: Value =
        serde_json::from_str(include_str!("host-effect-fixture.json")).unwrap();
    fixture["model"]["targets"][0]["adapter_digest"] =
        json!(crate::deployment::digest("compose").unwrap());
    (
        CanonicalDocument::from_value(SCHEMA, fixture["model"].clone()).unwrap(),
        fixture["manifest"].clone(),
    )
}

/// The projections of a host-effect system: the Compose project and SPDX.
pub(super) fn projections(system: &CanonicalDocument) -> Result<Vec<Projection>, PrismError> {
    let value = system.value();
    let compose = compose(value)?;
    audit_compose(&compose, value)?;
    Ok(vec![
        Projection {
            path: "projections/compose.json".to_owned(),
            media_type: "application/vnd.docker.compose.project+yaml".to_owned(),
            bytes: encode_value(&compose)?,
        },
        Projection {
            path: "projections/spdx.json".to_owned(),
            media_type: "application/spdx+json;version=3.0.1".to_owned(),
            bytes: encode_value(&spdx(value))?,
        },
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Value, Value) {
        let (document, manifest) = example();
        (document.value().clone(), manifest)
    }

    fn document(model: &Value) -> Result<CanonicalDocument, PrismError> {
        CanonicalDocument::from_value(SCHEMA, model.clone())
    }

    /// The code a mutated model is refused with: the closed schema first,
    /// then the identity and reference checks.
    fn refusal(model: &Value, manifest: &Value) -> Option<String> {
        match document(model) {
            Err(error) => Some(error.code.to_string()),
            Ok(document) => validate(document.value(), manifest)
                .err()
                .map(|error| error.code.to_string()),
        }
    }

    #[test]
    fn host_effect_system_contract_is_registered_and_closed() {
        let error = CanonicalDocument::from_value(SCHEMA, json!({"schema":SCHEMA})).unwrap_err();
        assert!(
            !error.message.contains("unsupported contract"),
            "host-effect system contract must be registered: {error:?}"
        );
        assert_eq!(error.code, "PP1101");
        let (model, _) = fixture();
        let mut extra = model.clone();
        extra["unmodeled"] = json!(true);
        assert_eq!(document(&extra).unwrap_err().code, "PP1101");
        let mut component = model;
        component["components"][0]["unmodeled"] = json!(true);
        assert_eq!(document(&component).unwrap_err().code, "PP1101");
        let adapter = crate::deployment::descriptor("compose").unwrap().0;
        assert_eq!(
            adapter["model_schemas"],
            json!(["prismpm/system-model/1", SCHEMA]),
            "the compose adapter admits exactly the transactional and host-effect profiles"
        );
        assert_eq!(
            adapter["projection_policy"]["loopback_address"],
            "127.0.0.1"
        );
        assert_eq!(
            crate::deployment::required_oracles(&json!({"schema":SCHEMA}))
                .unwrap()
                .iter()
                .map(|row| row.2)
                .collect::<Vec<_>>(),
            ["spdx-3.0.1-model", "compose-fee041b3"]
        );
    }

    #[test]
    fn host_effect_system_validates_the_loopback_example_and_binds_its_manifest() {
        let (model, manifest) = fixture();
        validate(&model, &manifest).unwrap();
        assert_eq!(certificate(&model), manifest);
        assert_eq!(
            model["application_profile"]["contract"],
            "prismpm/server-application/1"
        );
        assert_eq!(
            model["application_profile"]["protocol"],
            "prismpm/host-effects/1"
        );
        assert_eq!(model["listeners"][0]["bind_address"], "127.0.0.1");
        for (field, value) in [
            (
                "application_model_digest",
                json!(format!("sha256:{}", "e".repeat(64))),
            ),
            ("effects", json!(["engine.check"])),
            ("listeners", json!(["other"])),
            ("product_id", json!("other-product")),
            ("product_version", json!("9.9.9")),
        ] {
            let mut changed = manifest.clone();
            changed[field] = value;
            assert_eq!(
                validate(&model, &changed).unwrap_err().code,
                "PP2101",
                "manifest field {field}"
            );
        }
        let mut stale = model.clone();
        stale["targets"][0]["adapter_digest"] = json!(format!("sha256:{}", "0".repeat(64)));
        assert_eq!(validate(&stale, &manifest).unwrap_err().code, "PP7101");
    }

    #[test]
    fn host_effect_system_compose_puts_each_api_on_the_host_network() {
        let (document, _) = example();
        let compose = compose(document.value()).unwrap();
        audit_compose(&compose, document.value()).unwrap();
        assert_eq!(compose["name"], "mcp-loopback");
        let services = compose["services"].as_object().unwrap();
        let mut names = services.keys().map(String::as_str).collect::<Vec<_>>();
        names.sort_unstable();
        assert_eq!(
            names,
            [
                "engine-host",
                "gateway",
                "signer",
                "telemetry-collector",
                "verifier"
            ]
        );
        // The gateway listens on 127.0.0.1, which on the host network is the
        // host's loopback; a port published from a bridge network would reach
        // the container's interface and never that listener.
        assert_eq!(services["gateway"]["network_mode"], "host");
        assert_eq!(services["gateway"].get("networks"), None);
        for (name, service) in services {
            assert_eq!(service.get("ports"), None, "{name} publishes nothing");
            assert_eq!(service.get("expose"), None, "{name} exposes nothing");
            if name != "gateway" {
                assert_eq!(service.get("network_mode"), None, "{name}");
                assert_eq!(service["networks"], json!(["backend"]), "{name}");
            }
            assert_eq!(service["cap_drop"], json!(["ALL"]));
            assert_eq!(service["read_only"], true);
            assert_eq!(service["security_opt"], json!(["no-new-privileges:true"]));
            assert!(service["image"].as_str().unwrap().contains("@sha256:"));
        }
        assert_eq!(services["verifier"].get("healthcheck"), None);
        assert_eq!(services["verifier"]["restart"], "no");
        assert_eq!(services["signer"]["restart"], "unless-stopped");
        assert_eq!(
            services["engine-host"]["depends_on"],
            json!({"verifier":{"condition":"service_completed_successfully","required":true}})
        );
        assert_eq!(
            services["gateway"]["depends_on"]["signer"]["condition"],
            "service_healthy"
        );
        assert_eq!(
            services["gateway"]["environment"],
            json!({"LISTEN_PORT":"8765","LOG_LEVEL":"info"})
        );
        assert_eq!(
            services["signer"]["environment"],
            json!({"SIGNING_KEY_FILE":"/run/secrets/signing-key"})
        );
        assert_eq!(
            compose["secrets"]["signing-key"]["file"],
            "${PRISMPM_SECRET_DIR:?required}/signing-key"
        );
        assert_eq!(
            services["verifier"]["volumes"],
            json!([{"source":"toolchain-cache","target":"/var/cache/lexlean","type":"volume"}])
        );
        assert_eq!(compose["networks"], json!({"backend":{"internal":true}}));
        assert_eq!(
            services["telemetry-collector"]["tmpfs"],
            crate::deployment::projection_policy("compose").unwrap()["tmpfs_telemetry"]
        );
        let projections = projections(&document).unwrap();
        assert_eq!(
            projections
                .iter()
                .map(|projection| projection.path.as_str())
                .collect::<Vec<_>>(),
            ["projections/compose.json", "projections/spdx.json"]
        );
        assert_eq!(projections[0].bytes, encode_value(&compose).unwrap());
        assert_eq!(
            crate::system::projections(&document, &[]).unwrap()[0].bytes,
            projections[0].bytes,
            "the generic projection entry point selects this profile"
        );
    }

    #[test]
    fn host_effect_system_refuses_every_non_loopback_port_binding() {
        let (model, manifest) = fixture();
        for address in [
            "0.0.0.0",
            "::",
            "::1",
            "localhost",
            "127.0.0.2",
            "192.168.1.5",
            "",
        ] {
            let mut changed = model.clone();
            changed["listeners"][0]["bind_address"] = json!(address);
            // The closed schema names the one admitted address, so do the
            // checks behind it, and so does the projection itself.
            assert_eq!(
                document(&changed).unwrap_err().code,
                "PP1101",
                "{address:?}"
            );
            assert_eq!(
                validate(&changed, &manifest).unwrap_err().code,
                "PP2101",
                "{address:?}"
            );
            assert_eq!(compose(&changed).unwrap_err().code, "PP2101", "{address:?}");
        }
        let (document, _) = example();
        let projected = compose(document.value()).unwrap();
        // No published port passes, the loopback long form included: under the
        // host network nothing needs publishing, and from a bridge network a
        // published port cannot reach a listener on the container's loopback.
        for service in ["gateway", "signer"] {
            for ports in [
                json!([{"host_ip":"0.0.0.0","protocol":"tcp","published":8765,"target":8765}]),
                json!([{"host_ip":"127.0.0.1","protocol":"tcp","published":8765,"target":8765}]),
                json!([{"protocol":"tcp","published":8765,"target":8765}]),
                json!(["8765:8765"]),
                json!(["127.0.0.1:8765:8765"]),
                json!([]),
            ] {
                let mut changed = projected.clone();
                changed["services"][service]["ports"] = ports.clone();
                assert_eq!(
                    audit_compose(&changed, &model).unwrap_err().code,
                    "PP2101",
                    "{service} {ports}"
                );
            }
        }
        let refused = |changed: &Value, case: &str| {
            assert_eq!(
                audit_compose(changed, &model).unwrap_err().code,
                "PP2101",
                "{case}"
            );
        };
        for (service, field, value) in [
            ("signer", "network_mode", json!("host")),
            ("signer", "networks", json!(["backend", "edge"])),
            ("signer", "expose", json!([8765])),
            ("gateway", "expose", json!([8765])),
            ("gateway", "network_mode", json!("bridge")),
            ("gateway", "network_mode", json!("none")),
            ("gateway", "network_mode", json!("service:signer")),
            ("gateway", "networks", json!(["backend"])),
            ("gateway", "networks", json!([])),
        ] {
            let mut changed = projected.clone();
            changed["services"][service][field] = value.clone();
            refused(&changed, &format!("{service} {field} {value}"));
        }
        // Each role moved whole, so no second field gives it away: a worker
        // taken onto the host network, the api put on the worker's network.
        for (service, from, to) in [("signer", "worker", "api"), ("gateway", "api", "worker")] {
            let mut changed = projected.clone();
            let entry = changed["services"][service].as_object_mut().unwrap();
            if to == "api" {
                entry.remove("networks");
                entry.insert("network_mode".to_owned(), json!("host"));
            } else {
                entry.remove("network_mode");
                entry.insert("networks".to_owned(), json!(["backend"]));
            }
            refused(&changed, &format!("{service} as {to}, modeled as {from}"));
        }
        let mut changed = projected.clone();
        changed["services"]["gateway"]["deploy"]["replicas"] = json!(2);
        refused(&changed, "two gateway replicas on one loopback port");
        let mut changed = projected.clone();
        changed["services"]["absent"] = projected["services"]["signer"].clone();
        refused(&changed, "a service the model lacks");
        let mut changed = projected.clone();
        changed["services"]
            .as_object_mut()
            .unwrap()
            .remove("signer");
        refused(&changed, "a component without its service");
    }

    type Edit = Box<dyn Fn(&mut Value)>;

    #[test]
    fn host_effect_system_refuses_open_or_inconsistent_declarations() {
        let (model, manifest) = fixture();
        assert_eq!(refusal(&model, &manifest), None);
        let edits: Vec<(&str, Edit, &str)> = vec![
            (
                "identity shared by a network and a component",
                Box::new(|m| m["networks"][0]["id"] = json!("gateway")),
                "PP2101",
            ),
            (
                "no declared effect",
                Box::new(|m| m["application_profile"]["effects"] = json!([])),
                "PP1101",
            ),
            (
                "duplicate declared effect",
                Box::new(|m| {
                    m["application_profile"]["effects"] = json!(["engine.check", "engine.check"])
                }),
                "PP1101",
            ),
            (
                "undotted uppercase effect",
                Box::new(|m| m["application_profile"]["effects"][0] = json!("Engine.Check")),
                "PP1101",
            ),
            (
                "another application contract",
                Box::new(|m| {
                    m["application_profile"]["contract"] =
                        json!("prismpm/browser-resident-application/1")
                }),
                "PP1101",
            ),
            (
                "another effect protocol",
                Box::new(|m| {
                    m["application_profile"]["protocol"] = json!("prismpm/host-effects/2")
                }),
                "PP1101",
            ),
            (
                "unknown component kind",
                Box::new(|m| m["components"][0]["kind"] = json!("database")),
                "PP1101",
            ),
            (
                "component image absent",
                Box::new(|m| m["components"][3]["artifact"] = json!("absent-image")),
                "PP2101",
            ),
            (
                "dependency absent",
                Box::new(|m| m["components"][3]["depends_on"] = json!(["absent"])),
                "PP2101",
            ),
            (
                "dependency declared later",
                Box::new(|m| m["components"][0]["depends_on"] = json!(["gateway"])),
                "PP2101",
            ),
            (
                "component depends on itself",
                Box::new(|m| m["components"][3]["depends_on"] = json!(["gateway"])),
                "PP2101",
            ),
            (
                "parameter absent",
                Box::new(|m| m["components"][3]["parameters"] = json!(["absent"])),
                "PP2101",
            ),
            (
                "secret absent",
                Box::new(|m| m["components"][1]["secrets"] = json!(["absent"])),
                "PP2101",
            ),
            (
                "volume absent",
                Box::new(|m| m["components"][0]["volumes"] = json!(["absent"])),
                "PP2101",
            ),
            (
                "network absent",
                Box::new(|m| m["components"][1]["networks"] = json!(["backend", "absent"])),
                "PP2101",
            ),
            (
                "worker without a network",
                Box::new(|m| m["components"][1]["networks"] = json!([])),
                "PP2101",
            ),
            (
                "service without readiness",
                Box::new(|m| m["components"][1]["readiness"] = json!([])),
                "PP2101",
            ),
            (
                "replica minimum above maximum",
                Box::new(|m| m["components"][3]["resources"]["replicas_min"] = json!(2)),
                "PP2101",
            ),
            (
                "api component with a second replica",
                Box::new(|m| m["components"][3]["resources"]["replicas_max"] = json!(2)),
                "PP2101",
            ),
            (
                "secret consumer absent",
                Box::new(|m| m["secret_references"][0]["consumers"] = json!(["absent"])),
                "PP2101",
            ),
            (
                "listener on a worker",
                Box::new(|m| m["listeners"][0]["component"] = json!("signer")),
                "PP2101",
            ),
            (
                "listener on an absent component",
                Box::new(|m| m["listeners"][0]["component"] = json!("absent")),
                "PP2101",
            ),
            (
                "api on a network",
                Box::new(|m| m["components"][3]["networks"] = json!(["backend"])),
                "PP2101",
            ),
            (
                "udp listener",
                Box::new(|m| m["listeners"][0]["protocol"] = json!("udp")),
                "PP1101",
            ),
            (
                "port zero",
                Box::new(|m| m["listeners"][0]["port"] = json!(0)),
                "PP1101",
            ),
            (
                "two listeners on one port",
                Box::new(|m| {
                    let mut second = m["listeners"][0].clone();
                    second["id"] = json!("second");
                    m["listeners"].as_array_mut().unwrap().push(second);
                }),
                "PP2101",
            ),
            (
                "no listener",
                Box::new(|m| m["listeners"] = json!([])),
                "PP1101",
            ),
            (
                "kubernetes target",
                Box::new(|m| m["targets"][0]["kind"] = json!("kubernetes")),
                "PP1101",
            ),
            (
                "second target",
                Box::new(|m| {
                    let mut second = m["targets"][0].clone();
                    second["id"] = json!("second-target");
                    m["targets"].as_array_mut().unwrap().push(second);
                }),
                "PP1101",
            ),
            (
                "other supported platform",
                Box::new(|m| m["product"]["supported_platforms"] = json!(["browser"])),
                "PP1101",
            ),
        ];
        for (name, edit, code) in edits {
            let mut changed = model.clone();
            edit(&mut changed);
            assert_ne!(changed, model, "{name} must change the model");
            assert_eq!(
                refusal(&changed, &manifest),
                Some(code.to_owned()),
                "{name}"
            );
        }
        // The one-replica rule is the api's alone: a worker may run several.
        let mut workers = model.clone();
        workers["components"][1]["resources"]["replicas_max"] = json!(3);
        assert_eq!(refusal(&workers, &manifest), None);
    }
}
