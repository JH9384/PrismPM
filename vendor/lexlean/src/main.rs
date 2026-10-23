//! The `lexlean` executable (SPEC.md §23).

#![forbid(unsafe_code)]

fn main() {
    // Not a plain `std::process::exit`: an interrupt that is ending the
    // children ends the process by the signal, and this exit waits for it
    // (§17.17).
    lexlean::verify::lifeline::exit_at_end(lexlean::cli::main_entry());
}
