#![no_std]
// One exported kernel family per build, selected by cargo feature, so binary size
// and codegen are per variant. ABI: dot(pa, pb, n) -> i32; matvec(pm, pv, rows, cols, pout).
// Err => wasm `unreachable` trap, as generated code does.

#[path = "../../kernels.rs"]
mod kernels;

use core::arch::wasm32;
use core::slice::from_raw_parts as sl;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    wasm32::unreachable()
}

#[inline(always)]
fn ok<T>(r: Result<T, kernels::Trap>) -> T {
    match r {
        Ok(v) => v,
        Err(_) => wasm32::unreachable(),
    }
}

macro_rules! export_scalar {
    ($f:path) => {
        #[no_mangle]
        pub unsafe extern "C" fn dot(pa: *const u8, pb: *const u8, n: usize) -> i32 {
            ok($f(sl(pa, n), sl(pb, n)))
        }
        #[no_mangle]
        pub unsafe extern "C" fn matvec(pm: *const u8, pv: *const u8, rows: usize, cols: usize, pout: *mut i32) {
            let out = core::slice::from_raw_parts_mut(pout, rows);
            ok(kernels::matvec($f, sl(pm, rows * cols), sl(pv, cols), rows, cols, out))
        }
    };
}

#[cfg(feature = "v_checked")]
export_scalar!(kernels::dot_checked);
#[cfg(feature = "v_wrap")]
export_scalar!(kernels::dot_wrap);
#[cfg(feature = "v_iter")]
export_scalar!(kernels::dot_iter);
#[cfg(feature = "v_chunk")]
export_scalar!(kernels::dot_chunk);

// c. Hand-written SIMD128 kernel ("external kernel" stand-in, linked into the module).
// Contract: equal lengths; exact result; traps iff the exact sum does not fit i32.
#[cfg(feature = "v_simd")]
mod simd {
    use super::kernels::{Trap, CHUNK};
    use core::arch::wasm32::*;

    // extend i8->i16, then i32x4.dot_i16x8_s. n % 32 == 0, n <= CHUNK: lanes cannot overflow.
    #[inline(always)]
    unsafe fn block_dot(a: *const u8, b: *const u8, n: usize) -> i32 {
        let mut acc0 = i32x4_splat(0);
        let mut acc1 = i32x4_splat(0);
        let mut i = 0;
        while i < n {
            let va = v128_load(a.add(i) as *const v128);
            let vb = v128_load(b.add(i) as *const v128);
            let wa = v128_load(a.add(i + 16) as *const v128);
            let wb = v128_load(b.add(i + 16) as *const v128);
            acc0 = i32x4_add(acc0, i32x4_dot_i16x8(i16x8_extend_low_i8x16(va), i16x8_extend_low_i8x16(vb)));
            acc1 = i32x4_add(acc1, i32x4_dot_i16x8(i16x8_extend_high_i8x16(va), i16x8_extend_high_i8x16(vb)));
            acc0 = i32x4_add(acc0, i32x4_dot_i16x8(i16x8_extend_low_i8x16(wa), i16x8_extend_low_i8x16(wb)));
            acc1 = i32x4_add(acc1, i32x4_dot_i16x8(i16x8_extend_high_i8x16(wa), i16x8_extend_high_i8x16(wb)));
            i += 32;
        }
        let s = i32x4_add(acc0, acc1);
        i32x4_extract_lane::<0>(s) + i32x4_extract_lane::<1>(s) + i32x4_extract_lane::<2>(s) + i32x4_extract_lane::<3>(s)
    }

    // extmul i8x16 -> i16x8 (exact: |x*y| <= 16384), then extadd_pairwise -> i32x4.
    #[inline(always)]
    unsafe fn block_extmul(a: *const u8, b: *const u8, n: usize) -> i32 {
        let mut acc0 = i32x4_splat(0);
        let mut acc1 = i32x4_splat(0);
        let mut i = 0;
        while i < n {
            let va = v128_load(a.add(i) as *const v128);
            let vb = v128_load(b.add(i) as *const v128);
            acc0 = i32x4_add(acc0, i32x4_extadd_pairwise_i16x8(i16x8_extmul_low_i8x16(va, vb)));
            acc1 = i32x4_add(acc1, i32x4_extadd_pairwise_i16x8(i16x8_extmul_high_i8x16(va, vb)));
            i += 16;
        }
        let s = i32x4_add(acc0, acc1);
        i32x4_extract_lane::<0>(s) + i32x4_extract_lane::<1>(s) + i32x4_extract_lane::<2>(s) + i32x4_extract_lane::<3>(s)
    }

    #[inline(always)]
    unsafe fn run(blk: unsafe fn(*const u8, *const u8, usize) -> i32, a: &[u8], b: &[u8]) -> Result<i32, Trap> {
        if a.len() != b.len() {
            return Err(Trap);
        }
        let n = a.len();
        let main = n & !31;
        let mut total: i64 = 0;
        let mut i = 0;
        while i < main {
            let m = core::cmp::min(CHUNK, main - i);
            total += blk(a.as_ptr().add(i), b.as_ptr().add(i), m) as i64;
            i += m;
        }
        while i < n {
            total += (a[i] as i8 as i64) * (b[i] as i8 as i64);
            i += 1;
        }
        i32::try_from(total).map_err(|_| Trap)
    }

    #[inline(never)]
    pub fn dot_simd(a: &[u8], b: &[u8]) -> Result<i32, Trap> {
        unsafe { run(block_dot, a, b) }
    }
    #[inline(never)]
    pub fn dot_extmul(a: &[u8], b: &[u8]) -> Result<i32, Trap> {
        unsafe { run(block_extmul, a, b) }
    }
}

#[cfg(feature = "v_simd")]
export_scalar!(simd::dot_simd);

#[cfg(feature = "v_simd")]
#[no_mangle]
pub unsafe extern "C" fn dot2(pa: *const u8, pb: *const u8, n: usize) -> i32 {
    ok(simd::dot_extmul(sl(pa, n), sl(pb, n)))
}
#[cfg(feature = "v_simd")]
#[no_mangle]
pub unsafe extern "C" fn matvec2(pm: *const u8, pv: *const u8, rows: usize, cols: usize, pout: *mut i32) {
    let out = core::slice::from_raw_parts_mut(pout, rows);
    ok(kernels::matvec(simd::dot_extmul, sl(pm, rows * cols), sl(pv, cols), rows, cols, out))
}

// d. Host-import kernel: the guest checks the contract precondition and calls the host.
#[cfg(feature = "v_host")]
mod host {
    #[link(wasm_import_module = "env")]
    extern "C" {
        pub fn host_dot_i8(pa: *const u8, pb: *const u8, n: usize) -> i32;
        pub fn host_matvec_i8(pm: *const u8, pv: *const u8, rows: usize, cols: usize, pout: *mut i32);
    }
}
#[cfg(feature = "v_host")]
#[no_mangle]
pub unsafe extern "C" fn dot(pa: *const u8, pb: *const u8, n: usize) -> i32 {
    host::host_dot_i8(pa, pb, n)
}
// Matvec as one host call per row (4096 crossings) ...
#[cfg(feature = "v_host")]
#[no_mangle]
pub unsafe extern "C" fn matvec(pm: *const u8, pv: *const u8, rows: usize, cols: usize, pout: *mut i32) {
    let mut r = 0;
    while r < rows {
        *pout.add(r) = host::host_dot_i8(pm.add(r * cols), pv, cols);
        r += 1;
    }
}
// ... and as one host call for the whole matvec.
#[cfg(feature = "v_host")]
#[no_mangle]
pub unsafe extern "C" fn matvec2(pm: *const u8, pv: *const u8, rows: usize, cols: usize, pout: *mut i32) {
    host::host_matvec_i8(pm, pv, rows, cols, pout)
}
