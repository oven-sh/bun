/// Lengths of a complete code over `k` of the `n` symbols: leaves are split at random, `deep` favours the deepest.
fn complete(rng: &mut Rng, n: usize, k: usize, max_len: u8, deep: u64) -> Vec<u8> {
    let mut leaves = vec![0u8];
    while leaves.len() < k {
        let splittable: Vec<usize> = (0..leaves.len()).filter(|&i| leaves[i] < max_len).collect();
        if splittable.is_empty() { break; }
        let i = if rng.below(100) < deep { *splittable.iter().max_by_key(|&&i| leaves[i]).unwrap() } else { splittable[rng.below(splittable.len() as u64) as usize] };
        leaves[i] += 1;
        let l = leaves[i];
        leaves.push(l);
    }
    let mut out = vec![0u8; n];
    let mut at: Vec<usize> = (0..n).collect();
    for i in 0..leaves.len().min(n) { let j = i + rng.below((n - i) as u64) as usize; at.swap(i, j); out[at[i]] = leaves[i]; }
    out
}
// per case: n in [19 (root 7, lengths up to 7), 40, 256, 280, 282, 296, 344, 536, 1304, 2328]; max_len in [15, 15, 15, 9, 8, 10, 12];
// k in {1..4, n, random, 2..41, n / 2}; lengths: random / sparse random / all equal / complete(deep = 0, 30, 60, 90, 100);
// then 0, 0, 0, 1, 1, 2 or 5 single edits (zero it, -1, +1, random), so that many codes are off by one from complete.
