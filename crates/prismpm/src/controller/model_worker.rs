//! Keep linked-model construction, traversal and destruction on its modeled stack.

use super::{config_witness::Witness, ProjectConfig};
use crate::error::PrismError;
use camino::Utf8PathBuf;
use std::cell::RefCell;
use std::marker::PhantomData;
use std::path::Path;
use std::rc::Rc;

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Plan {
    pub(super) config: ProjectConfig,
    pub(super) project_file: Utf8PathBuf,
    config_identity: String,
    stack_bytes: usize,
    prism_witness: Witness,
    lexlean_witness: Witness,
}

impl Plan {
    pub(super) fn load(root: &Path, selected: Option<&Path>) -> Result<Self, PrismError> {
        // The first shallow load only resolves the already validated selected
        // path. The typed configuration used by this plan is then reloaded
        // between observations of that exact descriptor-backed witness.
        let (_, selected_path) = ProjectConfig::load(root, selected)?;
        let prism_witness = Witness::capture(&selected_path)?;
        let loaded = ProjectConfig::load(root, selected);
        prism_witness.check()?;
        let (config, reloaded_path) = loaded?;
        if reloaded_path != selected_path {
            return Err(scope_failure());
        }
        let project_file = super::utf8(config.lexlean_path(root)?)?;
        let lexlean_witness = Witness::capture(project_file.as_std_path())?;
        let project = lexlean::project::Project::load(&project_file);
        prism_witness.check()?;
        lexlean_witness.check()?;
        let project = project.map_err(|error| {
            PrismError::from_lexlean(
                "PP2001",
                "LexLean project load failed",
                error,
                config.limits.max_diagnostics,
            )
        })?;
        if project.config_bytes.as_slice() != lexlean_witness.bytes() {
            return Err(scope_failure());
        }
        // This is the selected compiler's public checked-arithmetic resource
        // plan, not an ambient test-stack setting or a new fixed allowance.
        let stack_bytes = project.config.limits.compile_stack_plan().stack_bytes;
        Ok(Self {
            config,
            project_file,
            config_identity: project.config.config_sha256().to_string(),
            stack_bytes,
            prism_witness,
            lexlean_witness,
        })
    }

    pub(super) fn observe(&self) -> Result<(), PrismError> {
        self.prism_witness.check()?;
        self.lexlean_witness.check()
    }
}

thread_local! {
    static ACTIVE: RefCell<Option<Plan>> = const { RefCell::new(None) };
}

struct Guard(PhantomData<Rc<()>>);

impl Guard {
    fn enter(plan: &Plan) -> Result<Self, PrismError> {
        ACTIVE.with(|active| {
            let mut active = active.borrow_mut();
            if active.is_some() {
                return Err(scope_failure());
            }
            *active = Some(plan.clone());
            Ok(Self(PhantomData))
        })
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        ACTIVE.with(|active| {
            active.borrow_mut().take();
        });
    }
}

fn scope_failure() -> PrismError {
    PrismError::new(
        "PP9001",
        "model worker configuration or execution scope disagrees",
    )
}

pub(super) fn require_active(plan: &Plan) -> Result<(), PrismError> {
    plan.observe()?;
    ACTIVE.with(|active| {
        if active.borrow().as_ref() == Some(plan) {
            Ok(())
        } else {
            Err(scope_failure())
        }
    })
}

pub(super) fn require_current_selection(
    root: &Path,
    selected: Option<&Path>,
) -> Result<(), PrismError> {
    let active = ACTIVE
        .with(|active| active.borrow().clone())
        .ok_or_else(scope_failure)?;
    active.observe()?;
    let current = Plan::load(root, selected)?;
    active.observe()?;
    require_active(&current)
}

#[derive(Clone, Copy)]
pub(super) enum Kind {
    Model,
    Verification,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Model => "model",
            Self::Verification => "verification",
        }
    }

    fn failure(self, message: String) -> PrismError {
        // Preserve the existing verification boundary's diagnostic contract.
        let code = match self {
            Self::Model => "PP9001",
            Self::Verification => "PP5008",
        };
        PrismError::new(code, message)
    }
}

pub(super) fn run<T: Send>(
    plan: &Plan,
    kind: Kind,
    operation: impl FnOnce() -> Result<T, PrismError> + Send,
) -> Result<T, PrismError> {
    plan.observe()?;
    let active = ACTIVE.with(|active| active.borrow().clone());
    if let Some(active) = active {
        // Reuse only this exact project/configuration/budget. In particular,
        // verification's thread-local reentrancy guard stays on this thread.
        return if active == *plan {
            let result = operation();
            plan.observe()?;
            result
        } else {
            Err(scope_failure())
        };
    }
    std::thread::scope(|scope| {
        let worker = std::thread::Builder::new()
            .name(format!("prismpm-{}", kind.name()))
            .stack_size(plan.stack_bytes)
            .spawn_scoped(scope, move || {
                plan.observe()?;
                let _guard = Guard::enter(plan)?;
                let result = operation();
                plan.observe()?;
                result
            })
            .map_err(|error| kind.failure(format!("start {} worker: {error}", kind.name())))?;
        worker
            .join()
            .map_err(|_| kind.failure(format!("{} worker terminated unexpectedly", kind.name())))?
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    fn plan() -> (tempfile::TempDir, Plan) {
        let fixture = super::super::release_tests::calculator_project();
        let plan = Plan::load(fixture.path(), None).unwrap();
        (fixture, plan)
    }

    #[test]
    fn scope_requires_entry_and_reuses_only_the_exact_model_budget() {
        let (_fixture, plan) = plan();
        assert_eq!(require_active(&plan).unwrap_err().code, "PP9001");
        run(&plan, Kind::Model, || {
            require_active(&plan)?;
            let thread = std::thread::current().id();
            run(&plan, Kind::Model, || {
                assert_eq!(std::thread::current().id(), thread);
                require_active(&plan)
            })?;
            let mut changed = plan.clone();
            changed.config.limits.max_entities += 1;
            assert_eq!(
                run(&changed, Kind::Model, || Ok(())).unwrap_err().code,
                "PP9001"
            );
            require_active(&plan)
        })
        .unwrap();
        assert_eq!(require_active(&plan).unwrap_err().code, "PP9001");
    }

    #[test]
    fn unwind_drops_owned_work_before_releasing_worker_scope() {
        struct Owned(Plan, Arc<AtomicBool>);
        impl Drop for Owned {
            fn drop(&mut self) {
                self.1
                    .store(require_active(&self.0).is_ok(), Ordering::SeqCst);
            }
        }
        let (_fixture, plan) = plan();
        let dropped_in_scope = Arc::new(AtomicBool::new(false));
        let error = run::<()>(&plan, Kind::Model, || {
            let _owned = Owned(plan.clone(), dropped_in_scope.clone());
            panic!("actual model worker unwind");
        })
        .unwrap_err();
        assert_eq!(error.code, "PP9001");
        assert!(dropped_in_scope.load(Ordering::SeqCst));
        assert_eq!(require_active(&plan).unwrap_err().code, "PP9001");
        run(&plan, Kind::Model, || require_active(&plan)).unwrap();
    }

    #[test]
    fn selected_compiler_owns_the_stack_plan() {
        let fixture = super::super::release_tests::calculator_project();
        let plan = Plan::load(fixture.path(), None).unwrap();
        let project = lexlean::project::Project::load(&plan.project_file).unwrap();
        assert_eq!(
            plan.stack_bytes,
            project.config.limits.compile_stack_plan().stack_bytes
        );
    }
}
