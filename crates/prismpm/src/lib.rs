//! Prism Platform Model (PrismPM) Core Library.

#![deny(missing_docs)]
#![forbid(unsafe_code)]
// Public failures deliberately carry the complete registered span, labels,
// notes, help, and cause chain by value. Boxing the error would weaken the
// stable Controller API solely to satisfy a size heuristic.
#![allow(clippy::result_large_err)]

pub mod acceptance;
mod application_build;
pub mod attest;
pub mod authority;
mod binary_cli;
mod brand;
mod browser_build;
mod browser_oracle;
pub mod cli;
pub mod config;
pub mod contract_owners;
pub mod contracts;
pub mod controller;
pub mod deployment;
mod design;
pub mod diagnostics;
pub mod error;
mod exporter;
mod features;
pub mod generate;
pub mod holo;
mod input_lock;
pub mod inspect;
mod lean_project;
mod library_build;
mod library_verification;
pub mod lifecycle;
mod lock_command;
pub mod model_contract;
pub mod oci;
pub mod operations;
mod process_resources;
mod reference;
mod release_verification;
pub mod replay;
#[cfg(test)]
mod resource_adapter;
pub mod sdk;
pub mod server_build;
pub mod server_host;
pub mod server_release;
pub mod session_guest;
pub use verification::server as server_verification;
pub mod supply_chain;
pub mod system;
pub mod template;
#[cfg(test)]
mod test_compiler;
mod text_cli;
mod threat_model;
pub mod upstream_conformance;
mod verification;
mod workbench;

pub use controller::Controller;
pub use error::{DiagnosticCode, PrismError};
