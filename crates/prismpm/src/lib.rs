//! Prism Platform Model (PrismPM) Core Library.

#![deny(missing_docs)]
#![forbid(unsafe_code)]
// Public failures deliberately carry the complete registered span, labels,
// notes, help, and cause chain by value. Boxing the error would weaken the
// stable Controller API solely to satisfy a size heuristic.
#![allow(clippy::result_large_err)]

pub mod acceptance;
mod application_build;
pub mod authority;
mod browser_build;
mod browser_oracle;
pub mod cli;
pub mod config;
pub mod contracts;
pub mod controller;
pub mod deployment;
pub mod diagnostics;
pub mod error;
mod exporter;
pub mod holo;
mod lean_project;
mod library_build;
mod library_verification;
pub mod lifecycle;
pub mod oci;
pub mod operations;
mod release_verification;
pub mod sdk;
pub mod supply_chain;
pub mod system;
pub mod template;
#[cfg(test)]
mod test_compiler;
pub mod upstream_conformance;
mod verification;

pub use controller::Controller;
pub use error::{DiagnosticCode, PrismError};
