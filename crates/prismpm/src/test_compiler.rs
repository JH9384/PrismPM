//! Test-only resource scheduling. Never caches compilation or acceptance.

use std::cell::RefCell;
use std::rc::{Rc, Weak};
use std::sync::{Mutex, MutexGuard, OnceLock};

static COMPILER: Mutex<()> = Mutex::new(());
type OwnedSlot = (&'static Mutex<()>, Weak<MutexGuard<'static, ()>>);
thread_local! {
    static OWNED: RefCell<Vec<OwnedSlot>> = const { RefCell::new(Vec::new()) };
    static BEFORE_WAIT: RefCell<Option<Box<dyn FnOnce()>>> = const { RefCell::new(None) };
}

/// Not Send: nested leases keep ownership until the last same-thread drop.
pub(crate) struct CompilerSlot {
    _guard: Rc<MutexGuard<'static, ()>>,
}

pub(crate) fn acquire() -> CompilerSlot {
    acquire_from(&COMPILER)
}

fn acquire_from(mutex: &'static Mutex<()>) -> CompilerSlot {
    if let Some(guard) = OWNED.with(|owned| {
        owned
            .borrow()
            .iter()
            .find(|(key, _)| std::ptr::eq(*key, mutex))
            .and_then(|(_, guard)| guard.upgrade())
    }) {
        return CompilerSlot { _guard: guard };
    }
    BEFORE_WAIT.with(|hook| {
        if let Some(notify) = hook.borrow_mut().take() {
            notify();
        }
    });
    let guard = Rc::new(
        mutex
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
    );
    OWNED.with(|owned| {
        let mut owned = owned.borrow_mut();
        owned.retain(|(_, guard)| guard.strong_count() > 0);
        owned.push((mutex, Rc::downgrade(&guard)));
    });
    CompilerSlot { _guard: guard }
}

pub(crate) fn initialize<T>(cell: &OnceLock<T>, build: impl FnOnce() -> T) -> &T {
    initialize_with(&COMPILER, cell, build)
}

fn initialize_with<'a, T>(
    mutex: &'static Mutex<()>,
    cell: &'a OnceLock<T>,
    build: impl FnOnce() -> T,
) -> &'a T {
    if let Some(value) = cell.get() {
        return value;
    }
    // Always acquire before OnceLock's initialization lock. An owning test
    // may request this fixture while a competing test waits for the compiler.
    let _slot = acquire_from(mutex);
    cell.get_or_init(build)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Barrier};
    use std::time::Duration;

    // Exercise the same scheduler without waiting behind real compiler tests.
    static COMPILER: Mutex<()> = Mutex::new(());
    fn acquire() -> CompilerSlot {
        super::acquire_from(&COMPILER)
    }
    fn initialize<T>(cell: &OnceLock<T>, build: impl FnOnce() -> T) -> &T {
        super::initialize_with(&COMPILER, cell, build)
    }

    #[test]
    fn every_waiting_owner_executes_without_overlap_and_cleans_up_while_owned() {
        let active = AtomicUsize::new(0);
        let complete = AtomicUsize::new(0);
        let barrier = Barrier::new(9);
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    barrier.wait();
                    let _slot = acquire();
                    assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0);
                    struct Cleanup<'a>(&'a AtomicUsize, &'a AtomicUsize);
                    impl Drop for Cleanup<'_> {
                        fn drop(&mut self) {
                            assert!(matches!(
                                COMPILER.try_lock(),
                                Err(std::sync::TryLockError::WouldBlock)
                            ));
                            assert_eq!(self.0.fetch_sub(1, Ordering::SeqCst), 1);
                            self.1.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                    let _cleanup = Cleanup(&active, &complete);
                    std::thread::yield_now();
                });
            }
            barrier.wait();
        });
        assert_eq!(complete.load(Ordering::SeqCst), 8);
    }

    #[test]
    fn nested_lease_remains_owned_after_outer_drop_and_light_work_proceeds() {
        let outer = acquire();
        let inner = acquire();
        drop(outer);
        assert!(matches!(
            COMPILER.try_lock(),
            Err(std::sync::TryLockError::WouldBlock)
        ));
        let (tx, rx) = mpsc::channel();
        let lightweight = std::thread::spawn(move || tx.send(42).unwrap());
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), 42);
        lightweight.join().unwrap();
        drop(inner);
        let _next = acquire();
    }

    #[test]
    fn nested_fixture_and_competing_initializer_cannot_invert_locks() {
        const MODE: &str = "PRISMPM_TEST_COMPILER_ORDER_PROBE";
        let Ok(mode) = std::env::var(MODE) else {
            // Isolate the intentional deadlock adversary from all other tests.
            for mode in ["correct", "inverted"] {
                let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "test_compiler::tests::nested_fixture_and_competing_initializer_cannot_invert_locks", "--nocapture"])
                    .env(MODE, mode)
                    .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
                    .spawn().unwrap();
                let deadline = std::time::Instant::now() + Duration::from_secs(20);
                while child.try_wait().unwrap().is_none() {
                    if std::time::Instant::now() >= deadline {
                        child.kill().unwrap();
                        child.wait().unwrap();
                        panic!("scheduler subprocess exceeded independent deadline");
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                let output = child.wait_with_output().unwrap();
                assert_eq!(
                    output.status.success(),
                    mode == "correct",
                    "{}",
                    String::from_utf8_lossy(&output.stderr)
                );
                if mode == "inverted" {
                    assert!(String::from_utf8_lossy(&output.stderr)
                        .contains("compiler initialization did not finish"));
                }
            }
            return;
        };
        assert!(matches!(mode.as_str(), "correct" | "inverted"));
        let cell = Arc::new(OnceLock::new());
        let (ready_tx, ready_rx) = mpsc::channel();
        let (start_tx, start_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();
        let (entered_tx, entered_rx) = mpsc::channel();
        let first_cell = Arc::clone(&cell);
        let first_done = done_tx.clone();
        let first = std::thread::spawn(move || {
            let _slot = acquire();
            ready_tx.send(()).unwrap();
            start_rx.recv().unwrap();
            first_done.send(*initialize(&first_cell, || 42)).unwrap();
        });
        ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let second = std::thread::spawn(move || {
            BEFORE_WAIT.with(|hook| {
                *hook.borrow_mut() = Some(Box::new(move || entered_tx.send(()).unwrap()))
            });
            let value = if mode == "inverted" {
                // Deliberately acquire the two real locks in the wrong order.
                cell.get_or_init(|| {
                    let _slot = acquire();
                    99
                })
            } else {
                initialize(&cell, || panic!("first owner initializes"))
            };
            done_tx.send(*value).unwrap();
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        start_tx.send(()).unwrap();
        for _ in 0..2 {
            assert_eq!(
                done_rx
                    .recv_timeout(Duration::from_secs(5))
                    .expect("compiler initialization did not finish"),
                42
            );
        }
        first.join().unwrap();
        second.join().unwrap();
    }

    #[test]
    fn panicking_owner_does_not_suppress_subsequent_work() {
        assert!(std::thread::spawn(|| {
            let _slot = acquire();
            panic!("deliberate owning-test failure");
        })
        .join()
        .is_err());
        let _slot = acquire();
        let cell = OnceLock::new();
        assert_eq!(*initialize(&cell, || 7), 7);
    }
}
