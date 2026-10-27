//! hs FIRST COUNT: the port's histogram costs against the reference's, on made-up histograms of up to 16383^2 symbols.
use bun_webp::dev_hooks::{hook_add_thresh, hook_bits_entropy, hook_estimate};
use fzgen::images::Rng;
unsafe extern "C" {
    fn hs_init();
    fn hs_estimate(cache_bits: i32, v: *const u32) -> u64;
    fn hs_bits_entropy(v: *const u32, n: i32) -> u64;
    fn hs_add_thresh(cache_bits: i32, a: *const u32, b: *const u32, threshold: i64, out: *mut i64);
}
const MAX: u64 = 16383 * 16383;

/// `n` counts that add up to about `total` (never more).
fn fill(rng: &mut Rng, out: &mut [u32], total: u64) {
    let n = out.len() as u64;
    out.fill(0);
    if total == 0 { return; }
    match rng.below(9) {
        0 => { let each = (total / n) as u32; out.fill(each); }
        1 => { let each = total / n; for o in out.iter_mut() { *o = (each - rng.below(each / 8 + 1)) as u32; } }
        2 => { let i = rng.below(n) as usize; out[i] = total as u32; }
        3 => { let (i, j) = (rng.below(n) as usize, rng.below(n) as usize); let a = rng.below(total + 1); out[i] = a as u32; out[j] = out[j].saturating_add((total - a) as u32); }
        4 => { let mut left = total; for o in out.iter_mut() { let v = left / 2; *o = v as u32; left -= v; } }
        5 => { let k = 1 + rng.below(n.min(12)); for _ in 0..k { let i = rng.below(n) as usize; out[i] = out[i].saturating_add((total / k) as u32); } }
        6 => { let run = 1 + rng.below(n) as usize; let at = rng.below(n - run as u64 + 1) as usize; let each = (total / run as u64) as u32; out[at..at + run].fill(each); }
        7 => { let i = rng.below(n) as usize; out[i] = (total - (n - 1).min(total)) as u32; if total >= n { for (k, o) in out.iter_mut().enumerate() { if k != i { *o = 1; } } } }
        _ => { let mut left = total; for o in out.iter_mut() { let v = rng.below(left / 4 + 1); *o = v as u32; left -= v; } }
    }
    debug_assert!(out.iter().map(|&v| v as u64).sum::<u64>() <= total);
}

fn histogram(rng: &mut Rng, cache_bits: u32, total: u64) -> Vec<u32> {
    let lit = 256 + 24 + if cache_bits > 0 { 1usize << cache_bits } else { 0 };
    let mut v = vec![0u32; lit + 3 * 256 + 40];
    // `copies` of the symbols are copies: they count in literal (as lengths) and distance, not in red, blue, alpha.
    // A copy is two pixels or more, so there are at most total / 2 of them, and they leave total - 2 * copies literals.
    let copies = match rng.below(4) { 0 => 0, 1 => total / 2, _ => rng.below(total / 2 + 1) };
    let total = total - copies;
    let (l, rest) = v.split_at_mut(lit);
    {
        let (green, more) = l.split_at_mut(256);
        let (len, cache) = more.split_at_mut(24);
        let cached = if cache.is_empty() { 0 } else { rng.below(total - copies + 1) };
        fill(rng, green, total - copies - cached);
        fill(rng, len, copies);
        if !cache.is_empty() { fill(rng, cache, cached); }
    }
    let (r, rest) = rest.split_at_mut(256);
    let (b, rest) = rest.split_at_mut(256);
    let (a, d) = rest.split_at_mut(256);
    fill(rng, r, total - copies);
    fill(rng, b, total - copies);
    fill(rng, a, total - copies);
    fill(rng, d, copies);
    v
}

fn main() {
    let a: Vec<u64> = std::env::args().skip(1).map(|s| s.parse().unwrap()).collect();
    if std::env::var_os("FZ_SIMD").is_none() { fzgen::reference::disable_simd(); }
    unsafe { hs_init() };
    let (mut big, mut below) = (0u64, 0u64);
    for seed in a[0]..a[0] + a[1] {
        let mut rng = Rng(seed.wrapping_mul(0x9e3779b97f4a7c15) ^ 0x4157);
        let cache_bits = [0u32, 0, 1, 4, 10][rng.below(5) as usize];
        let total = match rng.below(8) { 0 => MAX, 1 => MAX - rng.below(1000), 2 => rng.below(70000), 3 => 65535 + rng.below(3), 4 => rng.below(1 << 20), _ => rng.below(MAX + 1) };
        let h = histogram(&mut rng, cache_bits, total);
        let (r, m) = (unsafe { hs_estimate(cache_bits as i32, h.as_ptr()) }, hook_estimate(cache_bits, &h));
        assert_eq!(Some(r), m, "seed {seed}: estimate_bits, {total} symbols");
        if total > 140_000_000 { big += 1; }
        for part in [&h[..256], &h[h.len() - 40..], &h[..h.len() - 808]] {
            assert_eq!(unsafe { hs_bits_entropy(part.as_ptr(), part.len() as i32) }, hook_bits_entropy(part), "seed {seed}: bits_entropy");
        }
        // Two histograms that together are one image at most.
        let ta = rng.below(total + 1);
        let (x, y) = (histogram(&mut rng, cache_bits, ta), histogram(&mut rng, cache_bits, total - ta));
        for threshold in [i64::MAX, 0, -1, 1, i64::MIN, rng.next() as i64, (rng.next() >> 8) as i64, -((rng.next() >> 8) as i64), (rng.next() >> 20) as i64] {
            let mut out = [0i64; 4];
            unsafe { hs_add_thresh(cache_bits as i32, x.as_ptr(), y.as_ptr(), threshold, out.as_mut_ptr()) };
            let m = hook_add_thresh(cache_bits, &x, &y, threshold);
            assert_eq!(out, m, "seed {seed}: add_thresh, threshold {threshold}");
            below += out[2] as u64;
        }
    }
    println!("{} cases, 0 differ; {big} of over 140M symbols; the combined cost was below the threshold {below} times", a[1]);
}
