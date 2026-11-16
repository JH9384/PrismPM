//! Codes of the Prism SDK modules (#440), distinct from CLI PP codes.

use crate::ModelError;
use serde::Deserialize;

/// Open register of the codes the SDK modules raise; each module adds its rows.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SdkDiagnostics {
    /// Registry version.
    pub spec: String,
    /// Canonically ordered codes and meanings.
    pub error: Vec<SdkDiagnostic>,
}

/// One code an SDK module raises.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SdkDiagnostic {
    /// Exact code carried by the error: `<module>.<name>` on a `PrismCodeError`,
    /// or the snake_case code of an error class.
    pub code: String,
    /// The error class whose own code this is, such as `SigningError`; absent on a check code.
    #[serde(default)]
    pub class: Option<String>,
    /// Owning conformance id.
    pub capability: String,
    /// Normative failure meaning.
    pub statement: String,
}

impl SdkDiagnostics {
    /// Reject duplicate, unordered or malformed rows and an owner `ids` does not hold.
    pub fn check(&self, is_registered: impl Fn(&str) -> bool) -> Result<(), ModelError> {
        if self.spec != "prismpm/sdk-diagnostics/1"
            || !self
                .error
                .windows(2)
                .all(|rows| rows[0].code < rows[1].code)
        {
            return Err(ModelError::Inconsistent(
                "SDK diagnostics must have the exact spec and sorted, unique codes".to_string(),
            ));
        }
        for row in &self.error {
            let word = |text: &str, joiner: u8| {
                !text.is_empty()
                    && text.bytes().all(|b| b.is_ascii_lowercase() || b == joiner)
                    && !text.starts_with(joiner as char)
                    && !text.ends_with(joiner as char)
            };
            let well_formed = match &row.class {
                // A class code is one snake_case word, owned by a class named `<Name>Error`.
                Some(class) => {
                    word(&row.code, b'_')
                        && class.len() > "Error".len()
                        && class.ends_with("Error")
                        && class.starts_with(|c: char| c.is_ascii_uppercase())
                        && class.bytes().all(|b| b.is_ascii_alphanumeric())
                }
                None => row
                    .code
                    .split_once('.')
                    .is_some_and(|(module, name)| word(module, b'-') && word(name, b'-')),
            };
            if !well_formed || row.statement.trim().is_empty() || !is_registered(&row.capability) {
                return Err(ModelError::Inconsistent(format!(
                    "SDK diagnostic {} needs a <module>.<name> code (or a snake_case code with its class), a statement and a registered capability",
                    row.code
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn register(codes: &[&str]) -> SdkDiagnostics {
        SdkDiagnostics {
            spec: "prismpm/sdk-diagnostics/1".to_string(),
            error: codes
                .iter()
                .map(|code| SdkDiagnostic {
                    code: (*code).to_string(),
                    class: None,
                    capability: "DK-39".to_string(),
                    statement: "A meaning.".to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn check_rejects_disorder_malformed_codes_and_unknown_owners() {
        let known = |id: &str| id == "DK-39";
        assert!(register(&["networks.exists", "networks.store"])
            .check(known)
            .is_ok());
        for codes in [
            ["networks.store", "networks.exists"],
            ["networks.exists", "networks.exists"],
        ] {
            assert!(register(&codes).check(known).is_err());
        }
        for code in [
            "PP1001",
            "networks",
            "networks.",
            ".exists",
            "Networks.exists",
        ] {
            assert!(register(&[code]).check(known).is_err(), "{code}");
        }
        assert!(register(&["networks.exists"]).check(|_| false).is_err());
        let class = |code: &str, class: &str| {
            let mut one = register(&[code]);
            one.error[0].class = Some(class.to_string());
            one.check(known).is_ok()
        };
        assert!(class("signing_failed", "SigningError"));
        assert!(!class("signing_failed", "Signing"));
        assert!(!class("signing_failed", "signingError"));
        assert!(!class("signing-failed", "SigningError"));
        assert!(!class("_signing", "SigningError"));
        assert!(!class("networks.exists", "SigningError"));
        assert!(register(&["signing_failed"]).check(known).is_err());
        let mut wrong = register(&["networks.exists"]);
        wrong.spec = "prismpm/sdk-diagnostics/2".to_string();
        assert!(wrong.check(known).is_err());
    }
}
