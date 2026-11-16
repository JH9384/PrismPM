//! The thin host of the Prism factory.
//!
//! This crate decides nothing. It hands bytes to the four certified roots
//! exported from `prism-factory/model` (`plan`, `reweigh`, `workflow`,
//! `delegate`) and
//! returns their bytes. The same functions back the command-line host on a
//! laptop or a runner and the WebAssembly page on GitHub Pages.
#![forbid(unsafe_op_in_unsafe_fn)]

/// A certified root stopped with an explicit overflow failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Overflow;

/// The plan of the factory for a request (`tree`, `receipt` and `weight` lines).
pub fn plan(request: &[u8]) -> Result<Vec<u8>, Overflow> {
    factory_plan::run(factory_plan::Bytes::lit(request))
        .map(|out| out.octets().to_vec())
        .map_err(|_| Overflow)
}

/// The forge's delegation plan for a request (`tree`, `signed`, `trust-*` and
/// `event` lines): every obligation's route and identity, its sandbox, what a
/// lent runner establishes, and the check.
pub fn delegate(request: &[u8]) -> Result<Vec<u8>, Overflow> {
    factory_delegate::run(factory_delegate::Bytes::lit(request))
        .map(|out| out.octets().to_vec())
        .map_err(|_| Overflow)
}

/// The next priority levels for a request (`weight` and `outcome` lines).
pub fn reweigh(request: &[u8]) -> Result<Vec<u8>, Overflow> {
    factory_reweigh::run(factory_reweigh::Bytes::lit(request))
        .map(|out| out.octets().to_vec())
        .map_err(|_| Overflow)
}

/// A generated GitHub workflow projection: `b"release"` for the release
/// skeleton (job fragments are placed by the host), `b"cut"` for the release
/// cut, `b"delegate"` for the forge's delegation wrapper, anything else for the pull-request workflow.
pub fn workflow(selector: &[u8]) -> Result<Vec<u8>, Overflow> {
    factory_workflow::run(factory_workflow::Bytes::lit(selector))
        .map(|out| out.octets().to_vec())
        .map_err(|_| Overflow)
}

/// The WebAssembly ABI for the page: the caller writes a request into memory
/// from [`factory_alloc`], calls a root, and reads `length` bytes at `pointer`
/// from the returned `pointer << 32 | length`. A zero return is an overflow.
#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::alloc::{alloc, dealloc, Layout};

    #[no_mangle]
    pub extern "C" fn factory_alloc(length: usize) -> *mut u8 {
        let layout = Layout::from_size_align(length.max(1), 1).expect("layout");
        // SAFETY: the layout has a non-zero size.
        unsafe { alloc(layout) }
    }

    /// # Safety
    /// `pointer` must come from `factory_alloc(length)` and be freed once.
    #[no_mangle]
    pub unsafe extern "C" fn factory_free(pointer: *mut u8, length: usize) {
        let layout = Layout::from_size_align(length.max(1), 1).expect("layout");
        // SAFETY: guaranteed by the caller.
        unsafe { dealloc(pointer, layout) }
    }

    fn give(out: Vec<u8>) -> u64 {
        let length = out.len();
        let pointer = factory_alloc(length);
        // SAFETY: `pointer` holds `length` writable bytes.
        unsafe { std::ptr::copy_nonoverlapping(out.as_ptr(), pointer, length) };
        ((pointer as u64) << 32) | length as u64
    }

    fn take(pointer: *const u8, length: usize) -> Vec<u8> {
        // SAFETY: the caller wrote `length` bytes at `pointer`.
        unsafe { std::slice::from_raw_parts(pointer, length) }.to_vec()
    }

    /// # Safety
    /// `pointer` must hold `length` initialized bytes.
    #[no_mangle]
    pub unsafe extern "C" fn factory_plan(pointer: *const u8, length: usize) -> u64 {
        super::plan(&take(pointer, length)).map(give).unwrap_or(0)
    }

    /// # Safety
    /// `pointer` must hold `length` initialized bytes.
    #[no_mangle]
    pub unsafe extern "C" fn factory_reweigh(pointer: *const u8, length: usize) -> u64 {
        super::reweigh(&take(pointer, length)).map(give).unwrap_or(0)
    }

    #[no_mangle]
    pub extern "C" fn factory_workflow() -> u64 {
        super::workflow(b"").map(give).unwrap_or(0)
    }
}
