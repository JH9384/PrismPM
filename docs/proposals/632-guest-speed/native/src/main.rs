// e. Native x86_64 reference: same scalar kernels, median of 11 timed samples.
#[path = "../../kernels.rs"]
mod kernels;
use kernels::*;
use std::hint::black_box;
use std::time::Instant;

fn rng(seed: &mut u64) -> u8 {
    // xorshift64*
    *seed ^= *seed >> 12;
    *seed ^= *seed << 25;
    *seed ^= *seed >> 27;
    (seed.wrapping_mul(0x2545F4914F6CDD1D) >> 56) as u8
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

fn time<F: FnMut()>(mut f: F, reps: usize) -> f64 {
    for _ in 0..3 {
        f();
    }
    let mut s = vec![];
    for _ in 0..11 {
        let t = Instant::now();
        for _ in 0..reps {
            f();
        }
        s.push(t.elapsed().as_secs_f64() * 1e9 / reps as f64);
    }
    median(s)
}

fn main() {
    let mut seed = 0x9E3779B97F4A7C15u64;
    let big = 1usize << 20;
    let a: Vec<u8> = (0..big).map(|_| rng(&mut seed)).collect();
    let b: Vec<u8> = (0..big).map(|_| rng(&mut seed)).collect();
    let (r, c) = (4096usize, 4096usize);
    let m: Vec<u8> = (0..r * c).map(|_| rng(&mut seed)).collect();
    let v: Vec<u8> = (0..c).map(|_| rng(&mut seed)).collect();
    let fns: [(&str, DotFn); 4] = [("checked", dot_checked), ("wrap", dot_wrap), ("iter", dot_iter), ("chunk", dot_chunk)];
    let label = std::env::args().nth(1).unwrap_or_default();
    for (name, f) in fns {
        for n in [4096usize, big] {
            let reps = if n == 4096 { 2000 } else { 10 };
            let res = f(&a[..n], &b[..n]).unwrap();
            let ns = time(|| { black_box(f(black_box(&a[..n]), black_box(&b[..n])).unwrap()); }, reps);
            println!("native {label} dot_{name} n={n} result={res} ns={ns:.1} ns_per_elem={:.4} GMAC/s={:.2}", ns / n as f64, n as f64 / ns);
        }
        let mut out = vec![0i32; r];
        let ns = time(|| { matvec(f, black_box(&m), black_box(&v), r, c, &mut out).unwrap(); black_box(&out); }, 2);
        let cs: i64 = out.iter().map(|&x| x as i64).sum();
        println!("native {label} matvec_{name} 4096x4096 checksum={cs} ns={ns:.0} ns_per_elem={:.4} GMAC/s={:.2}", ns / (r * c) as f64, (r * c) as f64 / ns);
    }
}
