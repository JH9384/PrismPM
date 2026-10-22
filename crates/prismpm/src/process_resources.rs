//! Bounded process resources inherited by SDK compiler children.

use crate::error::PrismError;

#[cfg(unix)]
const STACK_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) fn configure() -> Result<(), PrismError> {
    #[cfg(unix)]
    {
        use rustix::process::{getrlimit, setrlimit, Resource, Rlimit};

        let previous = getrlimit(Resource::Stack);
        if previous
            .maximum
            .is_some_and(|maximum| maximum < STACK_BYTES)
        {
            return Err(PrismError::new(
                "PP5401",
                "SDK requires a 64 MiB process stack; the host hard limit is lower",
            ));
        }
        if previous.current != Some(STACK_BYTES) {
            setrlimit(
                Resource::Stack,
                Rlimit {
                    current: Some(STACK_BYTES),
                    maximum: previous.maximum,
                },
            )
            .map_err(|error| {
                PrismError::new("PP5401", format!("SDK process stack setup failed: {error}"))
            })?;
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use rustix::process::{getrlimit, Resource};
    use std::process::Command;

    fn child(name: &str, limits: &str) {
        let output = Command::new("/bin/sh")
            .args(["-c", &format!("{limits}\nexec \"$@\""), "--"])
            .arg(std::env::current_exe().unwrap())
            .args([
                "--exact",
                &format!("process_resources::tests::{name}"),
                "--nocapture",
            ])
            .env("PRISMPM_TEST_STACK_PROCESS", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    }

    fn probe() -> bool {
        match std::env::var("PRISMPM_TEST_STACK_PROCESS") {
            Ok(value) => {
                assert_eq!(value, "1");
                true
            }
            Err(std::env::VarError::NotPresent) => false,
            Err(error) => panic!("invalid test subprocess selector: {error}"),
        }
    }

    #[test]
    fn compiler_children_inherit_the_bounded_stack() {
        if !probe() {
            child(
                "compiler_children_inherit_the_bounded_stack",
                "ulimit -S -s 8192",
            );
            return;
        }
        let before = getrlimit(Resource::Stack);
        assert_eq!(before.current, Some(8 * 1024 * 1024));
        configure().unwrap();
        let after = getrlimit(Resource::Stack);
        assert_eq!(after.current, Some(STACK_BYTES));
        assert_eq!(after.maximum, before.maximum);
        let output = Command::new("/bin/sh")
            .args(["-c", "ulimit -S -s"])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), "65536");
        configure().unwrap();
        assert_eq!(getrlimit(Resource::Stack), after);
    }

    #[test]
    fn an_unlimited_soft_stack_is_bounded_without_changing_the_hard_limit() {
        if !probe() {
            child(
                "an_unlimited_soft_stack_is_bounded_without_changing_the_hard_limit",
                "ulimit -S -s unlimited",
            );
            return;
        }
        let before = getrlimit(Resource::Stack);
        assert_eq!(before.current, None);
        configure().unwrap();
        let after = getrlimit(Resource::Stack);
        assert_eq!(after.current, Some(STACK_BYTES));
        assert_eq!(after.maximum, before.maximum);
    }

    #[test]
    fn an_insufficient_hard_stack_is_a_typed_refusal() {
        if !probe() {
            child(
                "an_insufficient_hard_stack_is_a_typed_refusal",
                "ulimit -S -s 8192\nulimit -H -s 8192",
            );
            return;
        }
        let before = getrlimit(Resource::Stack);
        assert_eq!(before.maximum, Some(8 * 1024 * 1024));
        let error = configure().unwrap_err();
        assert_eq!(error.code, "PP5401");
        assert!(error.message.contains("stack"));
        assert_eq!(getrlimit(Resource::Stack), before);
    }
}
