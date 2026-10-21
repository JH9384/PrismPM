//! Bounded raw-file request adapter shared by generated command-line programs.
//!
//! The fragment reads at most the modeled request maximum plus one byte from a
//! regular file or standard input, reserving its own buffer fallibly, and
//! rejects oversized input before any application code runs. It does not decode
//! text, consult the environment or spawn processes. `crate::text_cli` composes
//! it with the modeled grammar; the including program owns the failure type.

/// Source of `reserve_input`, `bounded_read`, `open_failure` and `input`.
pub(crate) const INPUT_ADAPTER: &str = include_str!("binary_cli/input.rs.in");

#[cfg(test)]
mod tests {
    use super::INPUT_ADAPTER;

    #[test]
    fn raw_input_adapter_is_bounded_fallible_and_binary_safe() {
        assert!(INPUT_ADAPTER.contains("try_reserve_exact"));
        assert!(INPUT_ADAPTER.contains("symlink_metadata"));
        for name in [
            "InputMissing",
            "InputOpen",
            "InputType",
            "InputRead",
            "InputLimit",
            "AdapterAllocation",
        ] {
            assert!(INPUT_ADAPTER.contains(name), "{name}");
        }
        for forbidden in [
            "from_utf8",
            "read_to_string",
            "Command::new",
            "std::env::var",
            "create_new",
        ] {
            assert!(!INPUT_ADAPTER.contains(forbidden), "{forbidden}");
        }
    }

    #[test]
    fn nofollow_flag_is_selected_per_architecture() {
        // aarch64 Linux defines O_NOFOLLOW as 0o100000, not the x86_64 value.
        assert!(INPUT_ADAPTER.contains("target_arch = \"aarch64\""));
        assert!(INPUT_ADAPTER.contains("const NOFOLLOW: i32 = 0o100000;"));
        assert!(INPUT_ADAPTER.contains("const NOFOLLOW: i32 = 0o400000;"));
    }
}
