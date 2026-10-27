//! Extra lossy-encoder cases, run on several threads.
//!   webp-diff x seeds FIRST COUNT | sizes | allq [FILE...] | extreme | big FILE W H [Q...] | flat | noise | alpha | stride | badq | imgs DIR
use crate::images::{self, Image, Rng};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

type Case = Box<dyn Fn() -> (Image, Vec<f32>) + Send + Sync>;

fn run_cases(cases: Vec<Case>) -> (u64, u64) {
    let threads: usize = std::env::var("WEBP_DIFF_THREADS").ok().and_then(|s| s.parse().ok()).unwrap_or(12);
    // Initialise the reference's dsp tables on one thread.
    let warm = images::synth(1);
    crate::reference::encode_rgba(&warm.rgba, warm.w, warm.h, warm.w as usize * 4, 50.0);
    let (next, total, bad) = (AtomicUsize::new(0), AtomicU64::new(0), AtomicU64::new(0));
    let out = Mutex::new(());
    std::thread::scope(|s| {
        for _ in 0..threads.min(cases.len().max(1)) {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(case) = cases.get(i) else { break };
                let (img, qs) = case();
                for q in qs {
                    total.fetch_add(1, Ordering::Relaxed);
                    if let Some(d) = crate::diff_encode(&img, Some(q)) {
                        if bad.fetch_add(1, Ordering::Relaxed) < 40 {
                            let _g = out.lock().unwrap();
                            println!("DIFF {}: {d}", img.desc);
                        }
                    }
                }
            });
        }
    });
    (total.into_inner(), bad.into_inner())
}

fn kind(seed: u64, w: u32, h: u32, ck: u64, ak: u64) -> Image {
    images::synth_kind(&mut Rng(seed), w, h, ck, ak)
}

fn tile(src: &Image, w: u32, h: u32) -> Image {
    let mut rgba = vec![0u8; w as usize * h as usize * 4];
    for y in 0..h as usize {
        // Mirror every other tile so that there are no hard edges only.
        let ty = y / src.h as usize;
        let sy = if ty & 1 == 0 { y % src.h as usize } else { src.h as usize - 1 - y % src.h as usize };
        for x in 0..w as usize {
            let sx = x % src.w as usize;
            let s = (sy * src.w as usize + sx) * 4;
            let d = (y * w as usize + x) * 4;
            rgba[d..d + 4].copy_from_slice(&src.rgba[s..s + 4]);
        }
    }
    Image { w, h, rgba, desc: format!("{} tiled {w}x{h}", src.desc) }
}

fn with_alpha(mut img: Image, name: &str, f: impl Fn(usize, usize, &mut Rng) -> u8, garbage: bool) -> Image {
    let mut rng = Rng(img.w as u64 * 7919 + img.h as u64);
    for y in 0..img.h as usize {
        for x in 0..img.w as usize {
            let o = (y * img.w as usize + x) * 4;
            let a = f(x, y, &mut rng);
            img.rgba[o + 3] = a;
            if a == 0 && garbage {
                for c in 0..3 { img.rgba[o + c] = rng.next() as u8; }
            }
        }
    }
    img.desc = format!("{} alpha:{name}", img.desc);
    img
}

pub fn run(args: &[String]) -> (u64, u64) {
    let num = |i: usize, d: u64| args.get(i).map_or(d, |s| s.parse().unwrap());
    let mut cases: Vec<Case> = vec![];
    match args.first().map(String::as_str) {
        Some("seeds") => for seed in num(1, 0)..num(1, 0) + num(2, 100) {
            cases.push(Box::new(move || (images::synth(seed), vec![crate::QUALITIES[seed as usize % 7], 75.0])));
        },
        Some("sizes") => for w in 1..=33u32 { for h in 1..=33u32 {
            cases.push(Box::new(move || (kind((w * 64 + h) as u64, w, h, 6, 0), vec![75.0, ((w * 37 + h * 11) % 101) as f32])));
            cases.push(Box::new(move || (kind((w * 64 + h) as u64 + 9999, w, h, 2, 6), vec![75.0, ((w * 13 + h * 29) % 101) as f32])));
            cases.push(Box::new(move || (kind((w * 64 + h) as u64 + 5555, w, h, 3, 4), vec![((w * 7 + h * 3) % 101) as f32])));
            cases.push(Box::new(move || (kind((w * 64 + h) as u64 + 7777, w, h, 1, 5), vec![((w * 5 + h * 17) % 101) as f32])));
        }},
        Some("allq") => {
            let mut qs: Vec<f32> = (0..=100).map(|q| q as f32).collect();
            qs.extend([0.5, 0.01, 33.3, 74.99, 75.01, 97.9, 97.99, 98.01, 98.5, 99.5, 99.99, 12.345]);
            for f in &args[1..] {
                for &q in &qs {
                    let f = f.clone();
                    cases.push(Box::new(move || (crate::load(std::path::Path::new(&f)).unwrap(), vec![q])));
                }
            }
            for seed in [3u64, 17, 42, 77, 1234, 4321, 999, 31337] {
                let qs = qs.clone();
                cases.push(Box::new(move || (images::synth(seed), qs.clone())));
            }
            for (ck, ak) in [(6, 0), (3, 0), (2, 0), (8, 0), (6, 5), (3, 7), (0, 0), (9, 4)] {
                let qs = qs.clone();
                cases.push(Box::new(move || (kind(ck * 10 + ak, 97, 61, ck, ak), qs.clone())));
            }
        }
        Some("extreme") => for (w, h) in [(16383u32, 1u32), (1, 16383), (16383, 16), (16, 16383), (16383, 17), (17, 16383), (16383, 2), (2, 16383), (8191, 33), (4097, 4)] {
            for (ck, ak) in [(6u64, 0u64), (2, 6), (3, 4), (0, 3), (8, 0), (1, 5)] {
                cases.push(Box::new(move || (kind(w as u64 + ck, w, h, ck, ak), vec![75.0, 0.0, 100.0])));
            }
        },
        Some("big") => {
            let (f, w, h) = (args[1].clone(), num(2, 4000) as u32, num(3, 3000) as u32);
            let qs: Vec<f32> = if args.len() > 4 { args[4..].iter().map(|s| s.parse().unwrap()).collect() } else { vec![75.0] };
            for q in qs {
                let f = f.clone();
                cases.push(Box::new(move || {
                    let img = if f.starts_with("synth:") {
                        let mut it = f[6..].split(',').map(|s| s.parse::<u64>().unwrap());
                        let (ck, ak) = (it.next().unwrap(), it.next().unwrap());
                        kind(1, w, h, ck, ak)
                    } else {
                        tile(&crate::load(std::path::Path::new(&f)).unwrap(), w, h)
                    };
                    (img, vec![q])
                }));
            }
        }
        Some("flat") => for (i, c) in [[0u8, 0, 0], [255, 255, 255], [128, 128, 128], [255, 0, 0], [0, 255, 0], [0, 0, 255], [1, 2, 3], [254, 253, 252], [17, 200, 90]].into_iter().enumerate() {
            for (w, h) in [(1u32, 1u32), (16, 16), (17, 15), (64, 64), (100, 37), (333, 222), (1024, 8)] {
                for a in [255u8, 0, 1, 128, 254] {
                    cases.push(Box::new(move || {
                        let rgba = [c[0], c[1], c[2], a].repeat((w * h) as usize);
                        (Image { w, h, rgba, desc: format!("flat {i} {w}x{h} a={a}") }, vec![0.0, 30.0, 75.0, 98.0, 99.0, 100.0])
                    }));
                }
            }
        },
        Some("noise") => for (w, h) in [(64u32, 64u32), (255, 257), (1024, 1024), (2048, 1536)] {
            for ck in [2u64, 4, 8, 7] {
                for q in [100.0f32, 99.0, 98.0, 90.0, 50.0, 0.0] {
                    cases.push(Box::new(move || (kind(w as u64 * 3 + ck, w, h, ck, 0), vec![q])));
                }
            }
        },
        Some("alpha") => for (w, h) in [(8u32, 8u32), (16, 16), (24, 40), (31, 33), (64, 64), (129, 67), (200, 200), (400, 300)] {
            for ck in [6u64, 2, 3, 1, 0] {
                let base = move || kind(w as u64 * 31 + h as u64 + ck, w, h, ck, 0);
                let qs = vec![75.0f32, 0.0, 100.0, 40.0];
                macro_rules! add { ($name:expr, $garbage:expr, $f:expr) => {{ let qs = qs.clone(); cases.push(Box::new(move || (with_alpha(base(), $name, $f, $garbage), qs.clone()))); }} }
                add!("all0-garbage", true, |_, _, _| 0);
                add!("all0", false, |_, _, _| 0);
                add!("all1", false, |_, _, _| 1);
                add!("all254", false, |_, _, _| 254);
                add!("one-transparent", true, |x, y, _| if x == 3 && y == 5 { 0 } else { 255 });
                add!("one-opaque", true, |x, y, _| if x == 3 && y == 5 { 255 } else { 0 });
                add!("one-254-last", false, move |x, y, _| if x + 1 == w as usize && y + 1 == h as usize { 254 } else { 255 });
                add!("grad-1-254", false, move |x, _, _| (1 + x * 253 / w as usize) as u8);
                add!("vgrad-0-255", true, move |_, y, _| (y * 255 / h as usize) as u8);
                add!("blocks8", true, |x, y, _| if ((x / 8) + (y / 8)) % 3 == 0 { 0 } else { 255 });
                add!("blocks8-runs", true, |x, y, _| if (x / 8) % 5 < 3 && (y / 8) % 2 == 0 { 0 } else { 200 });
                add!("blocks5", true, |x, y, _| if ((x / 5) + (y / 5)) % 2 == 0 { 0 } else { 255 });
                add!("rows-odd", true, |_, y, _| if y % 2 == 0 { 0 } else { 255 });
                add!("cols-odd", true, |x, _, _| if x % 2 == 0 { 0 } else { 255 });
                add!("sparse0", true, |_, _, r| if r.below(10) == 0 { 0 } else { 255 });
                add!("sparse-opaque", true, |_, _, r| if r.below(10) == 0 { 255 } else { 0 });
                add!("random", true, |_, _, r| r.next() as u8);
                add!("low", true, |_, _, r| r.below(4) as u8);
                add!("half-rows", true, move |_, y, _| if y < h as usize / 2 { 255 } else { 0 });
            }
        },
        Some("imgs") => for f in crate::files(&args[1..]) {
            for q in crate::QUALITIES {
                let f = f.clone();
                cases.push(Box::new(move || (crate::load(&f).unwrap(), vec![q])));
            }
        },
        Some("stride") => {
            let (mut total, mut bad) = (0, 0);
            for seed in 0..400u64 {
                let img = images::synth(seed);
                if img.w > 300 { continue; }
                let mut rng = Rng(seed);
                let stride = img.w as usize * 4 + rng.range(1, 37) as usize;
                let mut padded: Vec<u8> = (0..stride * img.h as usize).map(|_| rng.next() as u8).collect();
                for y in 0..img.h as usize {
                    padded[y * stride..y * stride + img.w as usize * 4].copy_from_slice(&img.rgba[y * img.w as usize * 4..(y + 1) * img.w as usize * 4]);
                }
                // The last row need not be padded.
                padded.truncate(stride * (img.h as usize - 1) + img.w as usize * 4);
                let r = crate::reference::encode_rgba(&padded, img.w, img.h, stride, 75.0);
                let m = bun_webp::encode_rgba(&padded, img.w, img.h, stride, bun_webp::Compression::Lossy { quality: 75.0 }, None).ok();
                let same = if std::env::var_os("WEBP_DIFF_VP8_ONLY").is_some() {
                    r.as_deref().and_then(|r| crate::chunk(r, "VP8 ")) == m.as_deref().and_then(|m| crate::chunk(m, "VP8 "))
                } else { r == m };
                total += 1;
                if !same { bad += 1; println!("DIFF stride seed {seed}"); }
            }
            return (total, bad);
        }
        Some("badq") => {
            let img = images::synth(5);
            let (mut total, mut bad) = (0, 0);
            for q in [-1.0f32, -0.001, 100.001, 101.0, 1e30, f32::INFINITY, f32::NEG_INFINITY, f32::NAN, -0.0, 100.0, 0.0] {
                let r = if q.is_nan() { None } else { crate::reference::encode_rgba(&img.rgba, img.w, img.h, img.w as usize * 4, q) };
                let m = bun_webp::encode_rgba(&img.rgba, img.w, img.h, img.w as usize * 4, bun_webp::Compression::Lossy { quality: q }, None);
                println!("q={q}: reference {:?} bytes, bun_webp {:?}", r.as_ref().map(Vec::len), m.as_ref().map(Vec::len));
                total += 1;
                if r.is_some() != m.is_ok() { bad += 1; }
            }
            return (total, bad);
        }
        _ => panic!("see src/extra.rs"),
    }
    run_cases(cases)
}
