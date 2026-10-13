//! Bounded diagnostic timing, separate from conformance acceptance evidence.

use std::io::Write;
use std::time::{Duration, Instant};

fn milliseconds(duration: Duration) -> u64 {
    duration.as_millis().min(9_007_199_254_740_991) as u64
}

fn record(id: &str, queue: Duration, elapsed: Duration, panicking: bool) -> Option<String> {
    let bytes = id.as_bytes();
    // Never forward an arbitrary caller's path, prose, environment or payload.
    if bytes.len() != 5
        || !bytes[..2].iter().all(u8::is_ascii_uppercase)
        || bytes[2] != b'-'
        || !bytes[3..].iter().all(u8::is_ascii_digit)
    {
        return None;
    }
    Some(format!(
        "\n# prismpm-conformance-owner-diagnostic {{\"scope\":\"conformance-owner-diagnostic-not-acceptance\",\"owner\":\"{id}\",\"queue_ms\":{},\"elapsed_ms\":{},\"panicking\":{panicking}}}\n",
        milliseconds(queue), milliseconds(elapsed),
    ))
}

fn emit(writer: &mut impl Write, line: Option<String>) {
    if let Some(line) = line {
        // One preformatted, bounded record; complete short writes. A closed
        // diagnostic pipe cannot replace the owning assertion or its result.
        let _ = writer.write_all(line.as_bytes());
    }
}

pub(super) struct OwnerTiming<'a> {
    id: &'a str,
    queue: Duration,
    started: Instant,
}

impl<'a> OwnerTiming<'a> {
    // Construct only AFTER compiler-slot admission. This measures owner-body
    // wall time, not compiler CPU time. Only this admission wait is separated;
    // later OnceLock waits and nested owners remain part of the owner's body.
    pub(super) fn after_admission(id: &'a str, queue: Duration) -> Self {
        Self {
            id,
            queue,
            started: Instant::now(),
        }
    }
}

impl Drop for OwnerTiming<'_> {
    fn drop(&mut self) {
        // Stop body timing before any optional diagnostic transport contention.
        let line = record(
            self.id,
            self.queue,
            self.started.elapsed(),
            std::thread::panicking(),
        );
        emit(&mut std::io::stderr().lock(), line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_separates_queue_from_execution_and_is_not_acceptance() {
        assert_eq!(
            record("ST-16", Duration::from_millis(99), Duration::from_millis(7), false).unwrap(),
            "\n# prismpm-conformance-owner-diagnostic {\"scope\":\"conformance-owner-diagnostic-not-acceptance\",\"owner\":\"ST-16\",\"queue_ms\":99,\"elapsed_ms\":7,\"panicking\":false}\n"
        );
        assert!(record("DK-16", Duration::ZERO, Duration::ZERO, true)
            .unwrap()
            .ends_with("\"panicking\":true}\n"));
    }

    #[test]
    fn identifiers_cannot_inject_private_or_unbounded_fields() {
        for id in [
            "",
            "ST-1",
            "ST-160",
            "st-16",
            "ST-AA",
            "ST_16",
            "../ST-16",
            "ST-16\nsecret",
            "ST-\"1",
            "🦀-16",
        ] {
            assert!(
                record(id, Duration::ZERO, Duration::ZERO, false).is_none(),
                "{id:?}"
            );
        }
        assert!(record("ST-16", Duration::MAX, Duration::MAX, false)
            .unwrap()
            .contains("\"elapsed_ms\":9007199254740991"));
    }

    #[test]
    fn short_writes_preserve_the_complete_record() {
        #[derive(Default)]
        struct Short(Vec<u8>);
        impl Write for Short {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                let count = bytes.len().min(7);
                self.0.extend_from_slice(&bytes[..count]);
                Ok(count)
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let line = record("ST-16", Duration::ZERO, Duration::ZERO, false).unwrap();
        let mut output = Short::default();
        emit(&mut output, Some(line.clone()));
        assert_eq!(output.0, line.as_bytes());
        emit(&mut output, None);
        assert_eq!(output.0, line.as_bytes());
    }

    #[test]
    fn closed_diagnostic_transport_does_not_change_the_result() {
        struct Closed;
        impl Write for Closed {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                panic!("no flush required")
            }
        }
        emit(
            &mut Closed,
            record("ST-16", Duration::ZERO, Duration::ZERO, false),
        );
    }

    #[test]
    fn timing_preserves_the_exact_failure_payload() {
        let payload = vec![1u8, 7, 255];
        let failure = std::panic::catch_unwind(|| {
            let _timer = OwnerTiming::after_admission("ST-16", Duration::ZERO);
            std::panic::panic_any(payload.clone());
        })
        .unwrap_err();
        assert_eq!(*failure.downcast::<Vec<u8>>().unwrap(), payload);
    }

    #[test]
    fn timing_preserves_success_and_nested_owner_lifetimes() {
        let outer = OwnerTiming::after_admission("HO-13", Duration::ZERO);
        let result = {
            let _inner = OwnerTiming::after_admission("ST-16", Duration::ZERO);
            42
        };
        assert_eq!(result, 42);
        drop(outer);
    }
}
