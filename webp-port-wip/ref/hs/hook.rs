/// Test hooks (private copy only). `v`: literal, red, blue, alpha, distance, one after the other.
fn hook_make(cache_bits: u32, v: &[u32]) -> Histogram {
    let mut h = Histogram::new(cache_bits).ok().unwrap_or_else(|| std::process::abort());
    let mut rest = v;
    for p in h.populations_mut() {
        let (now, later) = rest.split_at(p.len());
        p.copy_from_slice(now);
        rest = later;
    }
    h
}
pub fn hook_estimate(cache_bits: u32, v: &[u32]) -> Option<u64> {
    hook_make(cache_bits, v).estimate_bits().ok()
}
pub fn hook_bits_entropy(v: &[u32]) -> u64 {
    bits_entropy(v)
}
pub fn hook_add_thresh(cache_bits: u32, a: &[u32], b: &[u32], threshold: i64) -> [i64; 4] {
    let (mut a, mut b) = (hook_make(cache_bits, a), hook_make(cache_bits, b));
    a.compute_cost();
    b.compute_cost();
    let r = histogram_add_thresh(&a, &b, threshold);
    [a.bit_cost as i64, b.bit_cost as i64, i64::from(r.is_some()), r.unwrap_or(0)]
}
