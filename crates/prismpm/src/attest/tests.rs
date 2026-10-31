//! HO-28 to HO-30: attestation verification, local-key attest and every typed
//! refusal, against the JavaScript implementation's own fixtures and the
//! Sigstore conformance bundles.

use super::*;
use crate::holo::archive::{attach_attestations, strip_attestations};

/// The reference archive, `calculator-example` `artifacts/Calculator.holo`, unsigned.
const CALCULATOR: &[u8] = include_bytes!("../../../../sdk/npm/prism-code/fixtures/Calculator.holo");
/// Test-only keys, generated once with OpenSSL and committed; they protect nothing.
const P256_PRIVATE: &str = include_str!("../../tests/data/attest/p256.private.pem");
const P256_PUBLIC: &str = include_str!("../../tests/data/attest/p256.public.pem");
const ED25519_PRIVATE: &str = include_str!("../../tests/data/attest/ed25519.private.pem");
const ED25519_PUBLIC: &str = include_str!("../../tests/data/attest/ed25519.public.pem");
const OTHER_PUBLIC: &str = include_str!("../../tests/data/attest/other.public.pem");
/// `experimental_attest` of `sdk/npm/prism-code` with the keys above: the proof statement by the P-256 key
/// over the guest, then the provenance statement by the Ed25519 key over `guest`, `view` and `copy=model`.
const JAVASCRIPT_KEYED: &str =
    include_str!("../../tests/data/attest/javascript-keyed.bundles.jsonl");

const REKOR2_BUNDLE: &str =
    include_str!("../../../../sdk/npm/verify/test/fixtures/sigstore-conformance/rekor2-dsse-happy-path/bundle.sigstore.json");
const REKOR2_ROOT: &str =
    include_str!("../../../../sdk/npm/verify/test/fixtures/sigstore-conformance/rekor2-dsse-happy-path/trusted_root.json");
const REKOR1_ROOT: &str =
    include_str!("../../../../sdk/npm/verify/test/fixtures/sigstore-rekor1/trusted_root.json");
const REKOR1_HAPPY: &str =
    include_str!("../../../../sdk/npm/verify/test/fixtures/sigstore-rekor1/rekor1-dsse-happy-path/bundle.sigstore.json");
const REKOR1_MISMATCH_ENVELOPE: &str = include_str!(
    "../../../../sdk/npm/verify/test/fixtures/sigstore-rekor1/rekor1-dsse-mismatch-envelope_fail/bundle.sigstore.json"
);
const REKOR1_MISMATCH_SIGNATURE: &str = include_str!(
    "../../../../sdk/npm/verify/test/fixtures/sigstore-rekor1/rekor1-dsse-mismatch-sig_fail/bundle.sigstore.json"
);

const PROOF: &str = "https://uor.foundation/prism/proof/v1";
const PROVENANCE: &str = "https://slsa.dev/provenance/v1";
/// The GitHub Actions identity that signed the Sigstore conformance bundles.
const SIGNER: &str = "https://github.com/sigstore-conformance/extremely-dangerous-public-oidc-beacon/.github/workflows/extremely-dangerous-oidc-beacon.yml@refs/heads/main";

fn value(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

fn keyed(key: &str) -> VerifyPolicy {
    VerifyPolicy {
        key: Some(key.to_owned()),
        ..VerifyPolicy::default()
    }
}

fn typed(key: &str, predicate_type: &str) -> VerifyPolicy {
    VerifyPolicy {
        predicate_type: Some(predicate_type.to_owned()),
        ..keyed(key)
    }
}

fn keyless(identity: Option<&str>, pattern: Option<&str>) -> VerifyPolicy {
    VerifyPolicy {
        certificate_identity: identity.map(str::to_owned),
        certificate_identity_regexp: pattern.map(str::to_owned),
        certificate_oidc_issuer: Some(GITHUB_ACTIONS_ISSUER.to_owned()),
        trusted_root: Some(value(REKOR2_ROOT)),
        ..VerifyPolicy::default()
    }
}

fn request(predicate_type: &str, predicate: &str, subjects: &[&str], key: &str) -> AttestRequest {
    AttestRequest {
        predicate_type: predicate_type.to_owned(),
        predicate: predicate.as_bytes().to_vec(),
        subjects: subjects.iter().map(|s| (*s).to_owned()).collect(),
        key: key.to_owned(),
    }
}

fn code<T: std::fmt::Debug>(result: Result<T, PrismError>) -> String {
    result.unwrap_err().code.to_string()
}

fn check(error: &PrismError) -> String {
    error
        .notes
        .iter()
        .find_map(|note| note.message.strip_prefix("check: "))
        .unwrap_or_else(|| panic!("no check note on {error}"))
        .to_owned()
}

fn failed(result: &VerificationResult) -> &AttestationError {
    assert!(!result.passed, "{result:?}");
    result.error.as_ref().unwrap()
}

fn javascript_lines() -> Vec<Vec<u8>> {
    JAVASCRIPT_KEYED
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.as_bytes().to_vec())
        .collect()
}

/// A keyed DSSE bundle signed by hand, so a test can sign a statement `attest` would never write.
fn sign_by_hand(statement: &Value, key: &str) -> Vec<u8> {
    let key = crypto::SigningKey::from_pem(key).unwrap();
    let payload = serde_json::to_vec(statement).unwrap();
    let signature = key.sign(&transparency::pae(DSSE_PAYLOAD_TYPE, &payload));
    serde_json::to_vec(&json!({
        "mediaType": BUNDLE_MEDIA_TYPE,
        "verificationMaterial": {"publicKey": {"hint": "by-hand"}},
        "dsseEnvelope": {
            "payload": STANDARD.encode(&payload),
            "payloadType": DSSE_PAYLOAD_TYPE,
            "signatures": [{"sig": STANDARD.encode(&signature)}],
        },
    }))
    .unwrap()
}

fn guest() -> (String, Vec<u8>) {
    let parsed = parse_application(CALCULATOR).unwrap();
    let label = parsed.identities.guest_content_kappa.clone();
    let content = parsed.blobs[&label].clone();
    assert!(label.starts_with("blake3:") && content.starts_with(b"\0asm"));
    (label, content)
}

// ------------------------------------------------------------------------ HO-28

#[test]
fn ho_28_keyed_bundles_signed_by_javascript_verify_in_rust() {
    let signed = attach_attestations(CALCULATOR, &javascript_lines()).unwrap();
    let proof = verify_attestations(&signed, &typed(P256_PUBLIC, PROOF)).unwrap();
    assert!(proof.passed, "{proof:?}");
    assert_eq!(proof.results.len(), 1);
    let signer = proof.results[0].signer.as_ref().unwrap();
    assert_eq!(signer.identity, None);
    assert_eq!(signer.key_id.as_deref().map(str::len), Some(64));
    assert_eq!(proof.results[0].time, None);
    assert_eq!(proof.results[0].subjects, ["guest"]);

    let provenance = verify_attestations(&signed, &typed(ED25519_PUBLIC, PROVENANCE)).unwrap();
    assert!(provenance.passed, "{provenance:?}");
    assert_eq!(provenance.results[0].subjects, ["guest", "view", "copy"]);

    // Without a type every bundle is checked; the result passes when one does, and says which did not.
    let all = verify_attestations(&signed, &keyed(P256_PUBLIC)).unwrap();
    assert!(all.passed);
    assert_eq!(
        all.results.iter().map(|r| r.passed).collect::<Vec<_>>(),
        [true, false]
    );
    assert_eq!(
        all.results[1].error.as_ref().unwrap().kind,
        ErrorKind::SignatureInvalid
    );
    assert_eq!(all.error, None);
    let document = all.to_value();
    assert_eq!(document["schema"], VERIFICATION_SCHEMA);
    assert_eq!(document["results"][1]["error"]["code"], "PP3102");
    assert_eq!(document["results"][1]["error"]["kind"], "signature_invalid");

    // One key that signed neither: nothing passes, and the result carries the first failure.
    let none = verify_attestations(&signed, &keyed(OTHER_PUBLIC)).unwrap();
    assert_eq!(failed(&none).kind, ErrorKind::SignatureInvalid);
    assert!(failed(&none).check.starts_with("signature."), "{none:?}");
}

#[test]
fn ho_28_keyless_signer_log_entry_and_signed_time_verify_offline() {
    let bundle = value(REKOR2_BUNDLE);
    let outcome = verify_bundle(&bundle, &keyless(Some(SIGNER), None)).unwrap();
    assert_eq!(outcome.identity.as_deref(), Some(SIGNER));
    assert_eq!(outcome.issuer.as_deref(), Some(GITHUB_ACTIONS_ISSUER));
    assert_eq!(
        outcome.time.as_deref(),
        Some("2026-05-13T19:23:33.000Z"),
        "the time is the signed time, not the verifier's clock"
    );
    assert_eq!(outcome.key_id, None);
    let by_pattern = verify_bundle(
        &bundle,
        &keyless(
            None,
            Some("^https://github\\.com/sigstore-conformance/.+@refs/heads/main$"),
        ),
    )
    .unwrap();
    assert_eq!(by_pattern.identity.as_deref(), Some(SIGNER));
}

#[test]
fn ho_28_certificate_identity_is_exact_not_a_pattern_or_a_prefix() {
    let bundle = value(REKOR2_BUNDLE);
    let mismatch = |identity: String| {
        let error = verify_bundle(&bundle, &keyless(Some(&identity), None)).unwrap_err();
        assert_eq!(error.code, "PP3103", "{identity}: {error}");
        assert_eq!(check(&error), "identity.signer", "{identity}");
    };
    mismatch(SIGNER[..SIGNER.len() - 1].to_owned());
    mismatch(format!("{SIGNER}-evil"));
    mismatch(SIGNER.replace("/.github/", "/Xgithub/"));
    mismatch(".*".to_owned());
    mismatch(SIGNER.replace("@refs/heads/main", "@refs/heads/other"));
    let nobody = verify_bundle(&bundle, &keyless(None, Some("nobody"))).unwrap_err();
    assert_eq!(
        (nobody.code.to_string(), check(&nobody)),
        ("PP3103".to_owned(), "identity.signer".to_owned())
    );

    for issuer in [
        "https://accounts.google.com",
        "https://token.actions.githubusercontent.com/",
    ] {
        let policy = VerifyPolicy {
            certificate_oidc_issuer: Some(issuer.to_owned()),
            ..keyless(Some(SIGNER), None)
        };
        let error = verify_bundle(&bundle, &policy).unwrap_err();
        assert_eq!(
            (error.code.to_string(), check(&error)),
            ("PP3103".to_owned(), "identity.issuer".to_owned())
        );
    }
}

#[test]
fn ho_28_a_missing_or_extra_transparency_requirement_is_a_transparency_failure() {
    let bundle = value(REKOR2_BUNDLE);
    let policy = keyless(Some(SIGNER), None);
    for (entries, timestamps) in [(None, Some(2)), (Some(2), None)] {
        let error = verify_bundle(
            &bundle,
            &VerifyPolicy {
                entries,
                timestamps,
                ..policy.clone()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, "PP3104", "{error}");
    }
    let mut stripped = bundle.clone();
    stripped["verificationMaterial"]["timestampVerificationData"] =
        json!({"rfc3161Timestamps": []});
    assert_eq!(code(verify_bundle(&stripped, &policy)), "PP3104");
    let mut unlogged = bundle.clone();
    unlogged["verificationMaterial"]["tlogEntries"] = json!([]);
    assert_eq!(code(verify_bundle(&unlogged, &policy)), "PP3104");

    // A statement changed after signing no longer matches the log entry or the signature.
    let mut tampered = bundle.clone();
    let payload = base64_any(tampered["dsseEnvelope"]["payload"].as_str().unwrap()).unwrap();
    let mut statement: Value = serde_json::from_slice(&payload).unwrap();
    statement["predicateType"] = json!("https://example.com/other");
    tampered["dsseEnvelope"]["payload"] =
        json!(STANDARD.encode(serde_json::to_vec(&statement).unwrap()));
    let error = verify_bundle(&tampered, &policy).unwrap_err();
    assert!(
        matches!(error.code.as_str(), "PP3104" | "PP3102"),
        "{error}"
    );
}

fn tlog_reasons(transparency: &Transparency) -> Vec<String> {
    let mut out = transparency
        .reasons
        .iter()
        .filter(|reason| reason.check.starts_with("tlog.") && reason.check != "tlog.count")
        .map(|reason| reason.check.clone())
        .collect::<Vec<_>>();
    out.dedup();
    out
}

/// A Rekor v1 bundle carries no RFC 3161 timestamp and its integrated time is never the clock, so the
/// certificate cannot be placed in time; every tlog check still runs and must pass or fail on its own.
fn log_only(bundle: &Value, root: &Value) -> Transparency {
    verify_transparency(bundle, root, 1, 0).unwrap()
}

#[test]
fn ho_28_rekor_v1_and_v2_dsse_entries_are_checked_against_the_envelope() {
    let root = value(REKOR1_ROOT);
    let happy = value(REKOR1_HAPPY);
    assert_eq!(
        happy["verificationMaterial"]["tlogEntries"][0]["kindVersion"],
        json!({"kind": "dsse", "version": "0.0.1"})
    );
    let result = log_only(&happy, &root);
    assert_eq!(tlog_reasons(&result), Vec::<String>::new(), "{result:?}");
    assert!(
        result
            .checks
            .iter()
            .any(|c| c.check.starts_with("tlog.") && c.passed),
        "the entry itself verified"
    );

    // A body that is not about this envelope is tlog.body.
    assert_eq!(
        tlog_reasons(&log_only(&value(REKOR1_MISMATCH_ENVELOPE), &root)),
        ["tlog.body"]
    );
    assert_eq!(
        tlog_reasons(&log_only(&value(REKOR1_MISMATCH_SIGNATURE), &root)),
        ["tlog.body"]
    );
    let mut changed = happy.clone();
    let payload = String::from_utf8(
        base64_any(changed["dsseEnvelope"]["payload"].as_str().unwrap()).unwrap(),
    )
    .unwrap();
    changed["dsseEnvelope"]["payload"] = json!(STANDARD.encode(payload.replace("a.txt", "b.txt")));
    assert_eq!(tlog_reasons(&log_only(&changed, &root)), ["tlog.body"]);
    // The certificate that signed is not the one the log recorded.
    let mut other = happy.clone();
    other["verificationMaterial"]["certificate"] =
        value(REKOR1_MISMATCH_SIGNATURE)["verificationMaterial"]["certificate"].clone();
    let reasons = log_only(&other, &root)
        .reasons
        .iter()
        .map(|r| r.check.clone())
        .collect::<Vec<_>>();
    assert!(
        reasons
            .iter()
            .any(|r| r == "tlog.body" || r == "certificate.chain"),
        "{reasons:?}"
    );

    // The checkpoint is held to the pinned log: origin, key and root.
    let mut wrong_origin = root.clone();
    for log in wrong_origin["tlogs"].as_array_mut().unwrap() {
        if log["baseUrl"] == "https://rekor.sigstore.dev" {
            log["baseUrl"] = json!("https://rekor.example.com");
        }
    }
    assert!(tlog_reasons(&log_only(&happy, &wrong_origin)).contains(&"tlog.checkpoint".to_owned()));
    let mut damaged = happy.clone();
    damaged["verificationMaterial"]["tlogEntries"][0]["inclusionProof"]["rootHash"] =
        json!(STANDARD.encode([7u8; 32]));
    assert!(!tlog_reasons(&log_only(&damaged, &root)).is_empty());
    let mut prefix = happy.clone();
    let envelope = prefix["verificationMaterial"]["tlogEntries"][0]["inclusionProof"]["checkpoint"]
        ["envelope"]
        .as_str()
        .unwrap()
        .replace("rekor.sigstore.dev - ", "rekor.sigstore.devX - ");
    prefix["verificationMaterial"]["tlogEntries"][0]["inclusionProof"]["checkpoint"]["envelope"] =
        json!(envelope);
    assert!(tlog_reasons(&log_only(&prefix, &root)).contains(&"tlog.checkpoint".to_owned()));

    // dsse/0.0.2 has no production bundle yet; its body check is exercised on bodies built from a real envelope.
    let facts = transparency::signed_facts(&happy).unwrap();
    let certificate = base64_any(
        happy["verificationMaterial"]["certificate"]["rawBytes"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let signature = STANDARD.encode(&facts.signatures[0]);
    let payload_hash = STANDARD.encode(crypto::sha256(facts.payload.as_ref().unwrap()));
    let entry = |overrides: Value| {
        let mut record = json!({
            "payloadHash": {"algorithm": "SHA2_256", "digest": payload_hash.clone()},
            "signatures": [{"content": signature.clone(), "verifier": {"x509Certificate": {"rawBytes": STANDARD.encode(&certificate)}, "keyDetails": "PKIX_ECDSA_P256_SHA_256"}}],
        });
        for (key, value) in overrides.as_object().unwrap() {
            record[key] = value.clone();
        }
        let body = json!({"apiVersion": "0.0.2", "kind": "dsse", "spec": {"dsseV002": record}});
        json!({"kindVersion": {"kind": "dsse", "version": "0.0.2"}, "canonicalizedBody": STANDARD.encode(serde_json::to_vec(&body).unwrap())})
    };
    let problem =
        |entry: &Value| transparency::body_problem(entry, &facts, Some(certificate.as_slice()));
    assert_eq!(problem(&entry(json!({}))), None);
    assert!(problem(&entry(
        json!({"payloadHash": {"algorithm": "SHA2_256", "digest": STANDARD.encode([1u8; 32])}})
    ))
    .unwrap()
    .contains("payload hash"));
    assert!(problem(&entry(
        json!({"payloadHash": {"algorithm": "SHA2_512", "digest": STANDARD.encode([1u8; 64])}})
    ))
    .unwrap()
    .contains("payload hash"));
    assert!(problem(&entry(
        json!({"signatures": [{"content": STANDARD.encode([3u8; 70])}]})
    ))
    .unwrap()
    .contains("signature is not"));
    assert!(problem(&entry(json!({"signatures": [{"content": signature.clone(), "verifier": {"x509Certificate": {"rawBytes": STANDARD.encode([4u8; 40])}}}]}))).unwrap().contains("certificate is not"));
    assert!(problem(&entry(json!({"signatures": []})))
        .unwrap()
        .contains("signature is not"));
    assert!(problem(&entry(json!({"signatures": [{}]})))
        .unwrap()
        .contains("signature is not"));
    let message_only = transparency::Facts {
        signatures: facts.signatures.clone(),
        payload: None,
        digest: facts.digest.clone(),
    };
    assert!(transparency::body_problem(
        &entry(json!({})),
        &message_only,
        Some(certificate.as_slice())
    )
    .unwrap()
    .contains("not about a message-signature"));
    let mut lying = entry(json!({}));
    lying["kindVersion"] = json!({"kind": "dsse", "version": "0.0.1"});
    assert!(problem(&lying)
        .unwrap()
        .contains("not the entry kind it declares"));

    // An entry kind that is none of the supported three is tlog.kind.
    for kind in [
        json!({"kind": "intoto", "version": "0.0.2"}),
        json!({"kind": "hashedrekord", "version": "0.0.1"}),
        json!({"kind": "dsse", "version": "0.0.3"}),
        Value::Null,
    ] {
        let mut bundle = happy.clone();
        bundle["verificationMaterial"]["tlogEntries"][0]["kindVersion"] = kind.clone();
        assert!(
            tlog_reasons(&log_only(&bundle, &root)).contains(&"tlog.kind".to_owned()),
            "{kind}"
        );
    }
}

#[test]
fn ho_28_a_trusted_root_that_does_not_pin_what_the_policy_needs_is_refused() {
    let bundle = value(REKOR2_BUNDLE);
    let with_root = |root: Option<Value>| VerifyPolicy {
        trusted_root: root,
        ..keyless(Some(SIGNER), None)
    };
    let error = verify_bundle(&bundle, &with_root(Some(json!({"mediaType": "x"})))).unwrap_err();
    assert_eq!(
        (error.code.to_string(), check(&error)),
        ("PP3107".to_owned(), "trustedroot.invalid".to_owned())
    );
    let mut no_tlog = value(REKOR2_ROOT);
    no_tlog["tlogs"] = json!([]);
    assert_eq!(
        code(verify_bundle(&bundle, &with_root(Some(no_tlog)))),
        "PP3107"
    );
    // Nothing is fetched: a keyless verify without a pinned root is refused, not guessed.
    assert_eq!(code(verify_bundle(&bundle, &with_root(None))), "PP3107");
    // A keyed verify that needs no evidence needs no root.
    let signed = attach_attestations(CALCULATOR, &javascript_lines()).unwrap();
    assert!(
        verify_attestations(&signed, &keyed(P256_PUBLIC))
            .unwrap()
            .passed
    );
}

// ------------------------------------------------------------------------ HO-29

#[test]
fn ho_29_a_local_key_signs_a_statement_into_the_holo_that_verifies_offline() {
    let (label, content) = guest();
    for (private, public) in [
        (P256_PRIVATE, P256_PUBLIC),
        (ED25519_PRIVATE, ED25519_PUBLIC),
    ] {
        let before = CALCULATOR.to_vec();
        let out = attest(
            CALCULATOR,
            &request(
                PROOF,
                r#"{"verifier":"lean4","accepted":true}"#,
                &[],
                private,
            ),
        )
        .unwrap();
        assert_eq!(
            CALCULATOR,
            before.as_slice(),
            "the input holo is not modified"
        );
        assert_eq!(out.attestations, 1);
        assert_eq!(out.subjects, ["guest"]);
        assert_eq!(out.statement["predicateType"], PROOF);
        assert_eq!(
            out.statement["predicate"],
            json!({"verifier": "lean4", "accepted": true})
        );
        assert_eq!(out.key_id.len(), 64);

        // The section is the bundle exactly as signed; the unsigned holo is recoverable byte for byte.
        let stored = read_attestations(&out.holo).unwrap();
        assert_eq!(stored.len(), 1);
        assert!(stored[0].resolved());
        assert_eq!(stored[0].line, out.bundle);
        assert_eq!(strip_attestations(&out.holo).unwrap(), CALCULATOR);

        // The subject is the guest blob with both digests, recomputed from its bytes.
        assert_eq!(
            out.statement["subject"],
            json!([{"name": "guest", "digest": {"sha256": der::hex(&crypto::sha256(&content)), "blake3": &label[7..]}}])
        );
        // The bundle has the shape the JavaScript signer writes.
        let bundle: Value = serde_json::from_slice(&out.bundle).unwrap();
        assert_eq!(
            bundle["verificationMaterial"]["publicKey"]["hint"],
            out.key_id
        );
        assert_eq!(
            bundle["verificationMaterial"]["timestampVerificationData"],
            json!({})
        );
        assert_eq!(bundle["dsseEnvelope"]["signatures"][0]["keyid"], out.key_id);

        let result = verify_attestations(&out.holo, &typed(public, PROOF)).unwrap();
        assert!(result.passed, "{result:?}");
        assert_eq!(result.error, None);
        assert_eq!(result.results.len(), 1);
        let signer = result.results[0].signer.as_ref().unwrap();
        assert_eq!(signer.identity, None);
        assert_eq!(signer.key_id.as_deref(), Some(out.key_id.as_str()));
        assert_eq!(result.results[0].time, None);
    }
}

#[test]
fn ho_29_several_attestations_and_a_type_select_which_bundles_are_checked() {
    let first = attest(CALCULATOR, &request(PROOF, r#"{"n":1}"#, &[], P256_PRIVATE)).unwrap();
    let second = attest(
        &first.holo,
        &request(
            PROVENANCE,
            r#"{"n":2}"#,
            &["guest", "view", "copy=model"],
            ED25519_PRIVATE,
        ),
    )
    .unwrap();
    assert_eq!(second.attestations, 2);
    assert_eq!(second.subjects, ["guest", "view", "copy"]);
    assert!(
        verify_attestations(&second.holo, &typed(P256_PUBLIC, PROOF))
            .unwrap()
            .passed
    );
    assert!(
        verify_attestations(&second.holo, &typed(ED25519_PUBLIC, PROVENANCE))
            .unwrap()
            .passed
    );
    let all = verify_attestations(&second.holo, &keyed(P256_PUBLIC)).unwrap();
    assert!(all.passed);
    assert_eq!(
        all.results.iter().map(|r| r.passed).collect::<Vec<_>>(),
        [true, false]
    );
    assert_eq!(
        all.results[1].error.as_ref().unwrap().kind,
        ErrorKind::SignatureInvalid
    );
    let none = verify_attestations(&second.holo, &keyed(OTHER_PUBLIC)).unwrap();
    assert_eq!(failed(&none).kind, ErrorKind::SignatureInvalid);
    // A label and the capabilities role name blobs too.
    let (label, _) = guest();
    let labelled = attest(
        CALCULATOR,
        &request(PROOF, "{}", &[&label, "capabilities"], P256_PRIVATE),
    )
    .unwrap();
    assert_eq!(labelled.subjects, [label, "capabilities".to_owned()]);
    assert!(read_attestations(&labelled.holo).unwrap()[0].resolved());
}

// ------------------------------------------------------------------------ HO-30

#[test]
fn ho_30_the_wrong_key_a_wrong_subject_and_a_missing_attestation_are_typed() {
    let signed = attest(CALCULATOR, &request(PROOF, "{}", &[], P256_PRIVATE))
        .unwrap()
        .holo;
    let wrong = verify_attestations(&signed, &typed(OTHER_PUBLIC, PROOF)).unwrap();
    assert_eq!(failed(&wrong).code, "PP3102");
    assert!(failed(&wrong).check.starts_with("signature."));
    let error: PrismError = failed(&wrong).clone().into();
    assert_eq!(error.code, "PP3102");

    // A statement that names the wrong digest is a subject mismatch, even with a valid signature.
    let (label, content) = guest();
    let statement = |sha256: String| json!({"_type": STATEMENT_TYPE, "subject": [{"name": "guest", "digest": {"sha256": sha256, "blake3": &label[7..]}}], "predicateType": PROOF, "predicate": {}});
    let sound = attach_attestations(
        CALCULATOR,
        &[sign_by_hand(
            &statement(der::hex(&crypto::sha256(&content))),
            P256_PRIVATE,
        )],
    )
    .unwrap();
    assert!(
        verify_attestations(&sound, &keyed(P256_PUBLIC))
            .unwrap()
            .passed,
        "the by-hand bundle is sound"
    );
    let forged = attach_attestations(
        CALCULATOR,
        &[sign_by_hand(&statement("0".repeat(64)), P256_PRIVATE)],
    )
    .unwrap();
    let result = verify_attestations(&forged, &keyed(P256_PUBLIC)).unwrap();
    assert_eq!(
        (
            failed(&result).code.as_str(),
            failed(&result).check.as_str()
        ),
        ("PP3105", "attestation.subject")
    );

    // A holo without the requested attestation.
    let bare = verify_attestations(CALCULATOR, &keyed(P256_PUBLIC)).unwrap();
    assert_eq!(
        (failed(&bare).code.as_str(), failed(&bare).check.as_str()),
        ("PP3106", "attestation.none")
    );
    assert!(bare.results.is_empty());
    let other = verify_attestations(&signed, &typed(P256_PUBLIC, PROVENANCE)).unwrap();
    assert_eq!(failed(&other).check, "attestation.type");
    assert!(failed(&other).message.contains("prism/proof/v1"));

    // A corrupted holo is refused before any signature is looked at.
    let mut broken = signed.clone();
    *broken.last_mut().unwrap() ^= 0xff;
    assert_eq!(
        code(verify_attestations(&broken, &keyed(P256_PUBLIC))),
        "PP3004"
    );
    assert_eq!(
        code(attest(&broken, &request(PROOF, "{}", &[], P256_PRIVATE))),
        "PP3004"
    );

    // A keyed bundle can still be held to a log entry and a timestamp by a pinned root.
    let held = VerifyPolicy {
        trusted_root: Some(value(REKOR2_ROOT)),
        entries: Some(1),
        ..keyed(P256_PUBLIC)
    };
    let result = verify_attestations(&signed, &held).unwrap();
    assert_eq!(
        failed(&result).code,
        "PP3104",
        "a bundle with no log entry cannot satisfy entries 1"
    );
}

#[test]
fn ho_30_the_policy_and_the_signing_request_are_checked_first() {
    let issuer = GITHUB_ACTIONS_ISSUER.to_owned();
    let invalid = |policy: VerifyPolicy| {
        let error = verify_attestations(CALCULATOR, &policy).unwrap_err();
        assert_eq!(
            (error.code.to_string(), check(&error)),
            ("PP1001".to_owned(), "policy.invalid".to_owned()),
            "{policy:?}"
        );
    };
    let base = VerifyPolicy::default();
    invalid(base.clone());
    invalid(VerifyPolicy {
        certificate_oidc_issuer: Some(issuer.clone()),
        ..base.clone()
    });
    invalid(VerifyPolicy {
        certificate_identity: Some("someone".into()),
        ..base.clone()
    });
    invalid(VerifyPolicy {
        certificate_identity: Some("a".into()),
        certificate_identity_regexp: Some("a".into()),
        certificate_oidc_issuer: Some(issuer.clone()),
        ..base.clone()
    });
    invalid(VerifyPolicy {
        certificate_identity_regexp: Some("(".into()),
        certificate_oidc_issuer: Some(issuer.clone()),
        ..base.clone()
    });
    invalid(VerifyPolicy {
        certificate_identity: Some("someone".into()),
        ..keyed(P256_PUBLIC)
    });
    invalid(VerifyPolicy {
        certificate_oidc_issuer: Some(issuer),
        ..keyed(P256_PUBLIC)
    });
    invalid(VerifyPolicy {
        entries: Some(1),
        ..keyed(P256_PUBLIC)
    });
    invalid(keyed("not a key"));
    invalid(keyed(&P256_PRIVATE.replace("PRIVATE", "PUBLIC")));
    invalid(keyed(P256_PRIVATE));

    // attest refuses what it cannot sign, each with its check.
    let refused = |request: AttestRequest| {
        let error = attest(CALCULATOR, &request).unwrap_err();
        assert_eq!(error.code, "PP3101", "{error}");
        check(&error)
    };
    assert_eq!(
        refused(request("not a uri", "{}", &[], P256_PRIVATE)),
        "sign.predicate"
    );
    assert_eq!(
        refused(request("", "{}", &[], P256_PRIVATE)),
        "sign.predicate"
    );
    assert_eq!(
        refused(request(PROOF, "{nope", &[], P256_PRIVATE)),
        "sign.predicate"
    );
    assert_eq!(
        refused(request(PROOF, "", &[], P256_PRIVATE)),
        "sign.predicate"
    );
    assert_eq!(
        refused(request(PROOF, "{}", &["nonsense"], P256_PRIVATE)),
        "sign.subject"
    );
    assert_eq!(
        refused(request(
            PROOF,
            "{}",
            &[&format!("blake3:{}", "1".repeat(64))],
            P256_PRIVATE
        )),
        "sign.subject"
    );
    assert_eq!(
        refused(request(PROOF, "{}", &["guest", "guest"], P256_PRIVATE)),
        "sign.subject"
    );
    assert_eq!(refused(request(PROOF, "{}", &[], "not a key")), "sign.key");
    assert_eq!(refused(request(PROOF, "{}", &[], P256_PUBLIC)), "sign.key");
    // A predicate may be any JSON value.
    assert_eq!(
        attest(CALCULATOR, &request(PROOF, "[1,2]", &[], P256_PRIVATE))
            .unwrap()
            .statement["predicate"],
        json!([1, 2])
    );
}
