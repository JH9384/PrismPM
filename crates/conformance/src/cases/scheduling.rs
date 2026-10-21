//! Bound concurrent owning compiler fixtures, without changing their checks.

use std::cell::Cell;
use std::sync::{Mutex, MutexGuard, OnceLock};

static COMPILER: Mutex<()> = Mutex::new(());
thread_local! {
    static OWNS_COMPILER: Cell<bool> = const { Cell::new(false) };
}

pub(super) struct CompilerSlot {
    guard: Option<MutexGuard<'static, ()>>,
}

impl Drop for CompilerSlot {
    fn drop(&mut self) {
        if self.guard.is_some() {
            OWNS_COMPILER.set(false);
        }
    }
}

fn compiler_slot() -> CompilerSlot {
    if OWNS_COMPILER.get() {
        return CompilerSlot { guard: None };
    }
    // A failed owning test must not suppress subsequent independent tests.
    let guard = COMPILER
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    OWNS_COMPILER.set(true);
    CompilerSlot { guard: Some(guard) }
}

pub(super) fn for_owner(id: &str) -> Option<CompilerSlot> {
    matches!(
        id,
        "DK-10"
            | "DK-11"
            | "DK-12"
            | "DK-13"
            | "DK-14"
            | "DK-15"
            | "DK-16"
            | "DK-17"
            | "DK-18"
            | "DK-20"
            | "DK-22"
            | "DK-23"
            | "DK-24"
            | "DK-25"
            | "DK-27"
            | "HO-13"
            | "OC-07"
            | "OC-08"
            | "OC-09"
            | "ST-11"
            | "ST-12"
            | "ST-13"
            | "ST-14"
            | "ST-15"
            | "ST-16"
            | "SY-08"
    )
    .then(compiler_slot)
}

pub(super) fn compiler_once<T>(cell: &OnceLock<T>, initialize: impl FnOnce() -> T) -> &T {
    if let Some(value) = cell.get() {
        return value;
    }
    // Acquire the compiler slot BEFORE OnceLock's initialization lock. An
    // owning test may request this same shared verification while holding it.
    let _slot = compiler_slot();
    cell.get_or_init(initialize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};
    use std::time::Duration;

    #[test]
    fn every_waiting_compiler_owner_runs_once_without_overlap_or_skip() {
        let owners = (10..=18)
            .map(|id| format!("DK-{id}"))
            .chain([
                "DK-20".to_owned(),
                "DK-22".to_owned(),
                "DK-23".to_owned(),
                "DK-24".to_owned(),
                "DK-25".to_owned(),
                "DK-27".to_owned(),
                "HO-13".to_owned(),
                "OC-07".to_owned(),
                "OC-08".to_owned(),
                "OC-09".to_owned(),
                "ST-11".to_owned(),
                "ST-12".to_owned(),
                "ST-13".to_owned(),
                "ST-14".to_owned(),
                "ST-15".to_owned(),
                "ST-16".to_owned(),
                "SY-08".to_owned(),
            ])
            .collect::<Vec<_>>();
        let barrier = Arc::new(Barrier::new(owners.len() + 1));
        let active = AtomicUsize::new(0);
        let completed = Mutex::new(Vec::new());
        std::thread::scope(|scope| {
            for id in &owners {
                let (barrier, active, completed) = (Arc::clone(&barrier), &active, &completed);
                scope.spawn(move || {
                    barrier.wait();
                    let _slot = for_owner(id).expect("owning fixture is scheduled");
                    assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0);
                    std::thread::sleep(Duration::from_millis(5));
                    completed.lock().unwrap().push(id.clone());
                    assert_eq!(active.fetch_sub(1, Ordering::SeqCst), 1);
                });
            }
            barrier.wait();
        });
        let mut actual = completed.into_inner().unwrap();
        actual.sort();
        assert_eq!(actual, owners);
        assert_eq!(active.load(Ordering::SeqCst), 0);
        for id in [
            "DK-07", "DK-08", "DK-09", "DK-19", "RP-01", "ST-10", "VR-01",
        ] {
            assert!(
                for_owner(id).is_none(),
                "lightweight dispatch is unchanged: {id}"
            );
        }
    }

    #[test]
    fn nested_shared_verification_and_competing_initializer_cannot_deadlock() {
        let cell = Arc::new(OnceLock::new());
        let (owned_tx, owned_rx) = std::sync::mpsc::channel();
        let (continue_tx, continue_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let owner_cell = Arc::clone(&cell);
        let owner_done = done_tx.clone();
        let owner = std::thread::spawn(move || {
            let _slot = for_owner("DK-17").unwrap();
            owned_tx.send(()).unwrap();
            continue_rx.recv().unwrap();
            let value = compiler_once(&owner_cell, || 42);
            owner_done.send(*value).unwrap();
        });
        owned_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let waiter = std::thread::spawn(move || {
            continue_tx.send(()).unwrap();
            done_tx
                .send(*compiler_once(&cell, || panic!("owner initializes first")))
                .unwrap();
        });
        for _ in 0..2 {
            assert_eq!(done_rx.recv_timeout(Duration::from_secs(5)).unwrap(), 42);
        }
        owner.join().unwrap();
        waiter.join().unwrap();
    }

    #[test]
    fn failed_owner_releases_slot_and_does_not_hide_later_tests() {
        let failed = std::thread::spawn(|| {
            let _slot = for_owner("DK-14").unwrap();
            panic!("deliberate owning failure");
        });
        assert!(failed.join().is_err());
        let _slot = for_owner("DK-16").unwrap();
        let cell = OnceLock::new();
        assert_eq!(*compiler_once(&cell, || 7), 7);
        assert_eq!(
            *compiler_once(&cell, || panic!("cached result must be reused")),
            7
        );
    }
}
