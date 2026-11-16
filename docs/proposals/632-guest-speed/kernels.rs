// Shared scalar kernels (no_std-compatible). Bytes are interpreted as i8.
// Each returns Err(Trap) where generated code would trap.

#[derive(Clone, Copy, Debug)]
pub struct Trap;

// a. "generated-style": tail recursion `go a b i acc` lowered to a loop,
// Option-returning indexing, checked i32 mul/add, checked index increment.
#[inline(never)]
pub fn dot_checked(a: &[u8], b: &[u8]) -> Result<i32, Trap> {
    let mut i: usize = 0;
    let mut acc: i32 = 0;
    loop {
        if i >= a.len() {
            return Ok(acc);
        }
        let x = match a.get(i) {
            Some(v) => *v as i8 as i32,
            None => return Err(Trap),
        };
        let y = match b.get(i) {
            Some(v) => *v as i8 as i32,
            None => return Err(Trap),
        };
        let p = match x.checked_mul(y) {
            Some(v) => v,
            None => return Err(Trap),
        };
        acc = match acc.checked_add(p) {
            Some(v) => v,
            None => return Err(Trap),
        };
        i = match i.checked_add(1) {
            Some(v) => v,
            None => return Err(Trap),
        };
    }
}

// Same loop shape, wrapping arithmetic (bounds checks kept).
#[inline(never)]
pub fn dot_wrap(a: &[u8], b: &[u8]) -> Result<i32, Trap> {
    let mut i: usize = 0;
    let mut acc: i32 = 0;
    loop {
        if i >= a.len() {
            return Ok(acc);
        }
        let x = match a.get(i) {
            Some(v) => *v as i8 as i32,
            None => return Err(Trap),
        };
        let y = match b.get(i) {
            Some(v) => *v as i8 as i32,
            None => return Err(Trap),
        };
        acc = acc.wrapping_add(x.wrapping_mul(y));
        i += 1;
    }
}

// Idiomatic best case for the autovectoriser: equal-length check hoisted, zip/fold, wrapping.
#[inline(never)]
pub fn dot_iter(a: &[u8], b: &[u8]) -> Result<i32, Trap> {
    if a.len() != b.len() {
        return Err(Trap);
    }
    Ok(a.iter().zip(b.iter()).fold(0i32, |s, (&x, &y)| {
        s.wrapping_add((x as i8 as i32) * (y as i8 as i32))
    }))
}

// "Proof-aware" generated shape: wrapping inside chunks of CHUNK terms, which provably
// cannot overflow i32 (CHUNK * 16384 <= 2^31-1), chunk sums folded in i64, one final
// range check. Exact result; traps iff the exact sum does not fit i32.
pub const CHUNK: usize = 65536;
#[inline(never)]
pub fn dot_chunk(a: &[u8], b: &[u8]) -> Result<i32, Trap> {
    if a.len() != b.len() {
        return Err(Trap);
    }
    let mut total: i64 = 0;
    for (ca, cb) in a.chunks(CHUNK).zip(b.chunks(CHUNK)) {
        let s = ca.iter().zip(cb.iter()).fold(0i32, |s, (&x, &y)| {
            s.wrapping_add((x as i8 as i32) * (y as i8 as i32))
        });
        total += s as i64;
    }
    i32::try_from(total).map_err(|_| Trap)
}

pub type DotFn = fn(&[u8], &[u8]) -> Result<i32, Trap>;

// Matvec in the generated style: map dot over rows.
#[inline(always)]
pub fn matvec(dot: DotFn, m: &[u8], v: &[u8], rows: usize, cols: usize, out: &mut [i32]) -> Result<(), Trap> {
    let mut r = 0;
    while r < rows {
        let row = m.get(r * cols..(r + 1) * cols).ok_or(Trap)?;
        *out.get_mut(r).ok_or(Trap)? = dot(row, v)?;
        r += 1;
    }
    Ok(())
}
