//! Conditional construction from a fully replayed capture, never authorization.

use super::*;
use prism_stdlib::{
    PublicationAssurance, PublicationContext, PublicationDeclaration, PublicationMoment,
    PublicationObligation, PublicationObligationChunk, PublicationObligations, PublicationRefKind,
    PublicationSubject, PublicationTarget, PublicationTrust,
};

/// Values supplied by the future authenticated host. Their presence is not
/// authentication of the attempt, workload, protected ref or publisher.
pub(super) struct ConditionalAttempt {
    pub(super) instance: Vec<u8>,
    pub(super) revision: Vec<u8>,
    pub(super) reference: String,
}

pub(super) struct LinkedContext {
    pub(super) context: PublicationContext,
    pub(super) context_preimage: Vec<u8>,
    pub(super) context_request: Vec<u8>,
    pub(super) linkage_preimages: [Vec<u8>; 7],
}

fn bytes(value: &Literal, width: usize) -> Result<Vec<u8>, PrismError> {
    match value {
        Literal::Bytes(value) if value.len() == width => Ok(value.clone()),
        _ => Err(invalid("publication field has the wrong byte width")),
    }
}

fn text(value: &Literal) -> Result<String, PrismError> {
    let value = value.text()?;
    if value.is_empty() || value.len() > 2048 {
        return Err(invalid("publication text exceeds its UTF-8 byte domain"));
    }
    Ok(value.to_owned())
}

fn tag(value: &Literal, name: &str, maximum: usize) -> Result<usize, PrismError> {
    match value {
        Literal::Variant(member, tag, fields)
            if member.module == sdk_source::ADMISSION
                && member.name == name
                && *tag < maximum
                && fields.is_empty() =>
        {
            Ok(*tag)
        }
        _ => Err(invalid(
            "publication field is not the exact closed source enum",
        )),
    }
}

fn declaration(value: &Literal) -> Result<PublicationDeclaration, PrismError> {
    let target = value.field("target")?;
    let obligations = rows_field(value.field("obligations")?, 64, 4096, "items")?
        .into_iter()
        .map(|row| {
            let Literal::Nat(id) = row.field("id")? else {
                return Err(invalid("publication obligation ID is not UInt32"));
            };
            Ok(PublicationObligation {
                id: u64::from(*id),
                moment: [
                    PublicationMoment::PrePublication,
                    PublicationMoment::DeploymentOnly,
                ][tag(row.field("moment")?, "PublicationMoment", 2)?],
                assurance: [
                    PublicationAssurance::SourceProof,
                    PublicationAssurance::Oracle,
                    PublicationAssurance::ReproducibleBuild,
                    PublicationAssurance::BrowserJourney,
                    PublicationAssurance::FaultRecovery,
                    PublicationAssurance::HumanAssessment,
                    PublicationAssurance::LiveJourney,
                    PublicationAssurance::OperationalAssessment,
                ][tag(row.field("assurance")?, "PublicationAssurance", 8)?],
                authority: bytes(row.field("authority")?, 32)?,
                scope: bytes(row.field("scope")?, 32)?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    Ok(PublicationDeclaration {
        stage: text(value.field("stage")?)?,
        policy: bytes(value.field("policy")?, 32)?,
        target: PublicationTarget {
            url: text(target.field("url")?)?,
            publisher: text(target.field("publisher")?)?,
            environment: text(target.field("environment")?)?,
            adapter: bytes(target.field("adapter")?, 32)?,
        },
        clock: bytes(value.field("clock")?, 32)?,
        clockAuthority: bytes(value.field("clockAuthority")?, 32)?,
        trustAuthority: bytes(value.field("trustAuthority")?, 32)?,
        decisionAuthority: bytes(value.field("decisionAuthority")?, 32)?,
        refAuthority: bytes(value.field("refAuthority")?, 32)?,
        deploymentAuthority: bytes(value.field("deploymentAuthority")?, 32)?,
        integrityAuthority: bytes(value.field("integrityAuthority")?, 32)?,
        minimumTrust: [
            PublicationTrust::Candidate,
            PublicationTrust::Accepted,
            PublicationTrust::Rejected,
            PublicationTrust::Unknown,
        ][tag(value.field("minimumTrust")?, "PublicationTrust", 4)?],
        refKind: [
            PublicationRefKind::ProtectedBranch,
            PublicationRefKind::ProtectedTag,
        ][tag(value.field("refKind")?, "PublicationRefKind", 2)?],
        obligations: PublicationObligations {
            chunks: obligations
                .chunks(64)
                .map(|items| PublicationObligationChunk {
                    items: items.to_vec(),
                })
                .collect(),
        },
    })
}

fn record(name: &str, fields: Vec<(&str, Literal)>) -> Literal {
    Literal::Record(
        Member {
            module: sdk_source::ADMISSION.to_owned(),
            name: name.to_owned(),
        },
        fields
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
    )
}

fn subject_literal(value: &PublicationSubject) -> Literal {
    record(
        "PublicationSubject",
        vec![
            ("producer", Literal::Text(value.producer.clone())),
            ("source", Literal::Bytes(value.source.clone())),
            ("release", Literal::Bytes(value.release.clone())),
            ("model", Literal::Bytes(value.model.clone())),
            ("build", Literal::Bytes(value.build.clone())),
            ("services", Literal::Bytes(value.services.clone())),
            ("controls", Literal::Bytes(value.controls.clone())),
            ("dependencies", Literal::Bytes(value.dependencies.clone())),
            ("sdk", Literal::Bytes(value.sdk.clone())),
            ("compiler", Literal::Bytes(value.compiler.clone())),
            ("runtime", Literal::Bytes(value.runtime.clone())),
            ("oracles", Literal::Bytes(value.oracles.clone())),
            ("tree", Literal::Bytes(value.tree.clone())),
        ],
    )
}

pub(super) fn construct(
    captured: VerifiedReleaseCapture,
    attempt: ConditionalAttempt,
) -> Result<LinkedContext, PrismError> {
    let prepared = prepare(&captured)?;
    construct_prepared(captured, attempt, prepared)
}

#[cfg(test)]
pub(super) fn construct_fixture(
    captured: VerifiedReleaseCapture,
    attempt: ConditionalAttempt,
    binding: sdk_source::FixtureSourceBinding,
) -> Result<LinkedContext, PrismError> {
    let prepared = prepare_bound(&captured, &SourceBinding::Fixture(binding))?;
    construct_prepared(captured, attempt, prepared)
}

fn construct_prepared(
    captured: VerifiedReleaseCapture,
    attempt: ConditionalAttempt,
    prepared: Prepared,
) -> Result<LinkedContext, PrismError> {
    if attempt.instance.len() != 32
        || attempt.revision.len() != 20
        || attempt.reference.is_empty()
        || attempt.reference.len() > 2048
    {
        return Err(invalid(
            "conditional publisher attempt exceeds its exact domain",
        ));
    }
    let response =
        prism_stdlib::publicationLinkageWireBytes(metadata::request(&captured, &prepared)?)
            .map_err(|e| invalid(format!("generated publication linkage failed: {e:?}")))?;
    let preimages = preimages::linkage(&response)?;
    let declaration_identity = digest(preimages[0]);
    let source_declaration = prepared.projection.value.field("declaration")?;
    let declaration = declaration(source_declaration)?;
    let browser = super::super::browser_export::browser_files(&captured.build_files)?;
    let tree_rows = browser
        .iter()
        .map(|(path, bytes)| {
            serde_json::json!({
                "path":path,"digest":format!("sha256:{}", content_id(bytes)),"size":bytes.len()
            })
        })
        .collect::<Vec<_>>();
    let release_digest = captured
        .state
        .root
        .digest
        .strip_prefix("sha256:")
        .ok_or_else(|| invalid("captured root manifest digest has the wrong domain"))?;
    let sdk = captured.sdk_lock.value()["sdk_image"]
        .as_str()
        .and_then(|value| value.rsplit_once("@sha256:").map(|(_, digest)| digest))
        .ok_or_else(|| invalid("captured SDK image has no immutable identity"))?;
    let subject = PublicationSubject {
        producer: prepared.producer,
        source: prepared.source_revision,
        release: hex_bytes(release_digest, 32)?,
        model: digest(
            captured
                .build_files
                .get("model.prism.json")
                .ok_or_else(|| invalid("captured publication model is absent"))?,
        ),
        build: digest(&captured.build_manifest),
        services: digest(preimages[1]),
        controls: digest(preimages[2]),
        dependencies: digest(preimages[3]),
        sdk: hex_bytes(sdk, 32)?,
        compiler: digest(preimages[4]),
        runtime: digest(preimages[5]),
        oracles: digest(preimages[6]),
        tree: digest(&encode_value(&serde_json::json!(tree_rows))?),
    };
    let context_preimage = prism_stdlib::publicationContextFieldsPreimage(
        &declaration,
        declaration_identity.clone(),
        &subject,
        attempt.instance.clone(),
        attempt.revision.clone(),
        attempt.reference.clone(),
    )
    .map_err(|e| invalid(format!("generated context computation failed: {e:?}")))?
    .map_err(|e| invalid(format!("generated context encoding refused: {e:?}")))?;
    let context = PublicationContext {
        declaration,
        declarationIdentity: declaration_identity,
        subject,
        instance: attempt.instance,
        publisherRevision: attempt.revision,
        publisherRef: attempt.reference,
        digest: digest(&context_preimage),
    };
    let input = record(
        "PublicationContext",
        vec![
            ("declaration", source_declaration.clone()),
            (
                "declarationIdentity",
                Literal::Bytes(context.declarationIdentity.clone()),
            ),
            ("subject", subject_literal(&context.subject)),
            ("instance", Literal::Bytes(context.instance.clone())),
            (
                "publisherRevision",
                Literal::Bytes(context.publisherRevision.clone()),
            ),
            ("publisherRef", Literal::Text(context.publisherRef.clone())),
            ("digest", Literal::Bytes(context.digest.clone())),
        ],
    );
    let context_request = metadata::context_request(&input)?;
    let validated = prism_stdlib::publicationWireBytes(context_request.clone()).map_err(|e| {
        invalid(format!(
            "generated complete context validation failed: {e:?}"
        ))
    })?;
    if preimages::context(&validated)? != context_preimage {
        return Err(invalid(
            "complete context disagrees with its generated six-field preimage",
        ));
    }
    Ok(LinkedContext {
        context,
        context_preimage,
        context_request,
        linkage_preimages: preimages.map(<[u8]>::to_vec),
    })
}
