//! cm FIRST COUNT: the port's CostManager against the reference's, on the same random operations, in lock step.
use bun_webp::dev_hooks::{BY_SITE, Hook, Op};
use fzgen::images::Rng;
use std::collections::VecDeque;
use std::ffi::{c_int, c_void};
use std::sync::atomic::Ordering::Relaxed;

unsafe extern "C" {
    fn cm_new(n: c_int, len_costs: *const u32) -> *mut c_void;
    fn cm_literal(c: *mut c_void, i: c_int, cost: i64);
    fn cm_push(c: *mut c_void, cost: i64, position: c_int, len: c_int);
    fn cm_update(c: *mut c_void, i: c_int, clean: c_int);
    fn cm_cost(c: *mut c_void, i: c_int) -> i64;
    fn cm_count(c: *mut c_void) -> c_int;
    fn cm_get(c: *mut c_void, costs: *mut i64, dist: *mut u16);
    fn cm_free(c: *mut c_void);
}

/// The cost is that of pixel `.0` (none: 0) plus `.1`, worked out when the operation is issued.
enum T {
    Lit(Option<usize>, i64, usize),
    Push(usize, i64, usize, usize),
    Upd(usize, bool),
}

const ONE: i64 = 1 << 23;

fn case(seed: u64) -> usize {
    let mut rng = Rng(seed.wrapping_mul(0x9e3779b97f4a7c15) ^ 0xc05f);
    let n = [300usize, 700, 1500, 5000, 9000, 14000][rng.below(6) as usize] + rng.below(200) as usize;
    let mut len_costs = [0u32; 24];
    let regime = rng.below(5);
    for c in len_costs.iter_mut() {
        *c = match regime {
            0 => 0,
            1 => (rng.below(20) as i64 * ONE) as u32,
            2 => if rng.below(2) == 0 { (16 * ONE) as u32 } else { (2 * ONE) as u32 },
            3 => rng.below(24 * ONE as u64) as u32,
            _ => (rng.below(3) as i64 * ONE / 2) as u32,
        };
    }
    let p_push = [50u64, 300, 700, 1000, 1000][rng.below(5) as usize];
    let len_kind = rng.below(5);
    let off_kind = rng.below(6);
    let lit_kind = rng.below(4);
    let stair = rng.range(300, 4000) as usize;
    let p_ahead = [0u64, 0, 30, 200][rng.below(4) as usize];

    let c = unsafe { cm_new(n as c_int, len_costs.as_ptr()) };
    let mut hook = Hook::new(n, &len_costs);
    let mut queue: VecDeque<T> = VecDeque::new();
    queue.push_back(T::Lit(None, ONE, 0));
    let mut i = 0usize;
    let mut max_count = 0usize;
    let r = hook.run(|cost, count| {
        assert_eq!(count as c_int, unsafe { cm_count(c) }, "seed {seed}: number of intervals at pixel {i}");
        max_count = max_count.max(count);
        loop {
            if queue.is_empty() {
                i += 1;
                if i >= n {
                    return None;
                }
                let lit = match lit_kind { 0 => ONE / 8, 1 => 6 * ONE, 2 => rng.below(8 * ONE as u64) as i64, _ => rng.below(2) as i64 * 12 * ONE + 1 };
                queue.push_back(T::Lit(Some(i - 1), lit, i));
                let max_len = (n - i).min(4095);
                let mut off = |rng: &mut Rng| match off_kind {
                    0 => 10 * ONE,
                    1 => rng.below(20 * ONE as u64) as i64,
                    2 => rng.below(4) as i64 * ONE,
                    3 => (30 * ONE - (i as i64 % 3000) * (ONE / 100)).max(0),
                    4 => (i as i64 % 3000) * (ONE / 100),
                    _ => if rng.below(40) == 0 { 0 } else { 18 * ONE + rng.below(3) as i64 },
                };
                let mut len = |rng: &mut Rng, max_len: usize| match len_kind {
                    0 => max_len,
                    1 => rng.range(2, max_len.max(2) as i64) as usize,
                    2 => stair,
                    3 => if rng.below(4) == 0 { rng.range(2, 40) as usize } else { stair },
                    _ => [2usize, 9, 10, 11, 64, 500, 4095][rng.below(7) as usize],
                }.min(max_len);
                if max_len >= 2 && rng.below(1000) < p_push {
                    let (o, l) = (off(&mut rng), len(&mut rng, max_len));
                    if l >= 2 { queue.push_back(T::Push(i - 1, o, i, l)); }
                }
                if rng.below(1000) < p_ahead {
                    let j = i + 1 + rng.below(300) as usize;
                    if j + 2 < n {
                        queue.push_back(T::Upd(j - 1, false));
                        queue.push_back(T::Upd(j, false));
                        let (o, l) = (off(&mut rng), len(&mut rng, (n - j).min(4095)));
                        if l >= 2 { queue.push_back(T::Push(j - 1, o, j, l)); }
                    }
                }
                queue.push_back(T::Upd(i, true));
            }
            match queue.pop_front().unwrap() {
                T::Lit(prev, add, at) => {
                    let v = prev.map_or(0, |p| cost(p)) + add;
                    if let Some(p) = prev { assert_eq!(cost(p), unsafe { cm_cost(c, p as c_int) }, "seed {seed}: cost of pixel {p}"); }
                    unsafe { cm_literal(c, at as c_int, v) };
                    return Some(Op::Literal(at, v));
                }
                T::Push(prev, add, at, len) => {
                    // A pixel ahead that nothing reaches yet.
                    if cost(prev) == i64::MAX { continue; }
                    let v = cost(prev) + add;
                    unsafe { cm_push(c, v, at as c_int, len as c_int) };
                    return Some(Op::Push(v, at, len));
                }
                T::Upd(at, clean) => {
                    unsafe { cm_update(c, at as c_int, clean as c_int) };
                    return Some(Op::Update(at, clean));
                }
            }
        }
    });
    let (costs, dist) = r.unwrap_or_else(|e| panic!("seed {seed}: {e:?}"));
    let (mut rc, mut rd) = (vec![0i64; n], vec![0u16; n]);
    unsafe { cm_get(c, rc.as_mut_ptr(), rd.as_mut_ptr()); cm_free(c); }
    assert!(costs == rc, "seed {seed}: costs differ first at {:?}", costs.iter().zip(&rc).position(|(a, b)| a != b));
    assert!(dist == rd, "seed {seed}: dist_array differs first at {:?}", dist.iter().zip(&rd).position(|(a, b)| a != b));
    max_count
}

fn main() {
    let a: Vec<u64> = std::env::args().skip(1).map(|s| s.parse().unwrap()).collect();
    bun_webp::dev_hooks::BREAK.store(std::env::var_os("CM_BREAK").is_some(), Relaxed);
    let mut full = 0;
    for seed in a[0]..a[0] + a[1] {
        if case(seed) >= 500 { full += 1; }
    }
    println!("{} cases, 0 differ; the list was full in {full}; overflows by site (before-old, split, remainder): {:?}", a[1], BY_SITE.each_ref().map(|c| c.load(Relaxed)));
}
