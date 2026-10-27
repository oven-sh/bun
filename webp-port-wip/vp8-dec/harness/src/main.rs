//! Differential test of bun_webp's lossy decoder against the reference libwebp v1.6.0 (both its SIMD and its plain C
//! flavour, in one process).
//!
//!   webp-diff dec FILE|DIR...                      get_info + decode: same accept/reject, same status, same pixels
//!   webp-diff gen OUTDIR COUNT [SEED]              lossy test files from the reference's advanced encoder
//!   webp-diff mutate DIR ITERS [SEED] [THREADS]    corrupt files of DIR at random, then as `dec`
//!   webp-diff enc SRC.webp OUT.webp QUALITY        re-encode the pixels of SRC as lossy (for benchmarks)
//!   webp-diff bench-dec FILE N
//!
//! WEBP_DIFF_FILTER=substr keeps only the files whose path contains it. WEBP_DIFF_KEEP=DIR writes failing inputs there.
//! WEBP_DIFF_STUB_ALPHA=1: bun_webp's alpha decoder is a stub that returns 255s. Exit code 1 if anything differed.
#![allow(dead_code)]
mod craft;
mod images;
mod profile;
mod reference;

use images::{Image, Rng};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

fn files(args: &[String]) -> Vec<PathBuf> {
    let mut out = vec![];
    for a in args {
        let p = Path::new(a);
        if p.is_dir() {
            let mut v: Vec<_> = std::fs::read_dir(p).unwrap().map(|e| e.unwrap().path()).filter(|p| p.is_file()).collect();
            v.sort();
            out.extend(v);
        } else {
            out.push(p.to_path_buf());
        }
    }
    if let Ok(f) = std::env::var("WEBP_DIFF_FILTER") {
        out.retain(|p| p.to_string_lossy().contains(&f));
    }
    out
}

fn keep(name: &str, bytes: &[u8]) {
    if let Ok(dir) = std::env::var("WEBP_DIFF_KEEP") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(Path::new(&dir).join(name), bytes).unwrap();
    }
}

/// bun_webp hit a stub of another package.
static STUB: AtomicU64 = AtomicU64::new(0);
/// The reference's SIMD and plain C code gave different pixels.
static REF_SELF_DIFF: AtomicU64 = AtomicU64::new(0);
/// The reference failed on a file with ALPH while bun_webp (alpha stubbed) did not.
static ALPHA_UNKNOWN: AtomicU64 = AtomicU64::new(0);
static ACCEPTED: AtomicU64 = AtomicU64::new(0);
static STATUS: [AtomicU64; 8] = [const { AtomicU64::new(0) }; 8];

fn code(e: bun_webp::DecodeError) -> i32 {
    use bun_webp::DecodeError::*;
    match e {
        OutOfMemory => 1,
        InvalidParam => 2,
        BitstreamError => 3,
        UnsupportedFeature => 4,
        NotEnoughData => 7,
        Bug => -1,
    }
}

fn first_diff(a: &[u8], b: &[u8], stride: usize, mask_alpha: bool) -> Option<String> {
    if a == b {
        return None;
    }
    let differs = |i: usize| a[i] != b[i] && !(mask_alpha && i % 4 == 3);
    let i = (0..a.len()).find(|&i| differs(i))?;
    let n = (0..a.len()).filter(|&i| differs(i)).count();
    Some(format!("{n} bytes differ, first at x={} y={} channel={}: {} vs {}", i % stride / 4, i / stride, i % 4, a[i], b[i]))
}

/// Returns an explanation if the decoders disagree. bun_webp is held to the reference's plain C code.
pub fn diff_decode(data: &[u8]) -> Option<String> {
    let ri = reference::get_info(data);
    let mi = bun_webp::get_info(data).ok();
    if ri != mi {
        return Some(format!("get_info: reference {ri:?}, bun_webp {mi:?}"));
    }
    let (w, h) = ri?;
    if w as u64 * h as u64 > 300 << 20 {
        return None;
    }
    let stride = w as usize * 4;
    let mut a = vec![0u8; stride * h as usize];
    let mut b = vec![0u8; stride * h as usize];
    let mut c = vec![0u8; stride * h as usize];
    let status_simd = reference::decode_status(data, &mut a, stride);
    let status = reference::c_decode_status(data, &mut c, stride);
    let mine = bun_webp::decode_rgba_into(data, &mut b, stride);
    if status != status_simd {
        return Some(format!("reference: SIMD status {status_simd}, plain C status {status}"));
    }
    STATUS[status as usize & 7].fetch_add(1, Relaxed);
    if matches!(mine, Err(bun_webp::DecodeError::Bug)) {
        return Some("decode: bun_webp reported Bug".into());
    }
    if mine == Err(bun_webp::DecodeError::UnsupportedFeature) && status != 4 {
        STUB.fetch_add(1, Relaxed);
        return None;
    }
    let stub_alpha = std::env::var_os("WEBP_DIFF_STUB_ALPHA").is_some() && data.windows(4).any(|w| w == b"ALPH");
    if (status == 0) != mine.is_ok() {
        if stub_alpha && mine.is_ok() {
            ALPHA_UNKNOWN.fetch_add(1, Relaxed);
            return None;
        }
        return Some(format!("decode: reference status {status}, bun_webp {mine:?}"));
    }
    if let Err(e) = mine {
        // libwebp calls a malformed ALPH header out of memory, bun_webp a bitstream error. And bun_webp decodes the whole
        // plane before the second row of macroblocks, so it sees bad alpha before it sees that the frame is cut short.
        let alpha_kind = (status == 1 || status == 7) && code(e) == 3 && data.windows(4).any(|w| w == b"ALPH");
        if code(e) != status && !stub_alpha && !alpha_kind {
            return Some(format!("status: reference {status}, bun_webp {e:?}"));
        }
        return None;
    }
    ACCEPTED.fetch_add(1, Relaxed);
    if let Some(d) = first_diff(&c, &b, stride, stub_alpha) {
        let simd = if first_diff(&a, &b, stride, stub_alpha).is_none() { " (bun_webp is the same as the SIMD reference)" } else { "" };
        return Some(format!("pixels, plain C reference vs bun_webp: {d}{simd}"));
    }
    if a != c {
        let n = REF_SELF_DIFF.fetch_add(1, Relaxed);
        if n < 3 {
            println!("NOTE reference SIMD vs plain C: {}", first_diff(&a, &c, stride, false).unwrap());
        }
        keep(&format!("ref-self-diff-{n}.webp"), data);
    }
    None
}

fn load(path: &Path) -> Option<Image> {
    let data = std::fs::read(path).ok()?;
    let (w, h) = reference::get_info(&data)?;
    let mut rgba = vec![0u8; w as usize * h as usize * 4];
    reference::decode_rgba_into(&data, &mut rgba, w as usize * 4).then_some(())?;
    Some(Image { w, h, rgba, desc: path.file_name()?.to_string_lossy().into_owned() })
}

fn random_config(rng: &mut Rng) -> [i32; 23] {
    [
        0,
        rng.range(0, 100) as i32,
        rng.range(0, 6) as i32,
        rng.range(1, 4) as i32,
        rng.range(0, 100) as i32,
        [0, 0, 20, 60, 100][rng.below(5) as usize],
        rng.range(0, 7) as i32,
        rng.range(0, 1) as i32,
        rng.range(0, 1) as i32,
        rng.range(0, 1) as i32,
        rng.range(0, 2) as i32,
        [100, 100, 80, 30, 0][rng.below(5) as usize],
        rng.range(1, 3) as i32,
        rng.range(0, 7) as i32,
        rng.range(0, 3) as i32,
        [0, 0, 50, 100][rng.below(4) as usize],
        [100, 100, 60, 0][rng.below(4) as usize],
        rng.range(0, 1) as i32,
        rng.range(0, 1) as i32,
        rng.range(0, 3) as i32,
        rng.range(0, 1) as i32,
        0,
        0,
    ]
}

fn mutate(rng: &mut Rng, data: &mut Vec<u8>) {
    for _ in 0..rng.range(1, 6) {
        if data.is_empty() {
            return;
        }
        let n = data.len() as u64;
        match rng.below(10) {
            0 | 1 | 2 => { let i = rng.below(n) as usize; data[i] ^= 1 << rng.below(8); }
            3 => { let i = rng.below(n) as usize; data[i] = rng.next() as u8; }
            4 => { let i = rng.below(n.min(64)) as usize; data[i] = rng.next() as u8; }
            5 => { data.truncate(rng.below(n) as usize); }
            6 => { let i = rng.below(n) as usize; let l = rng.below(16) as usize; let e = (i + l).min(data.len()); data.drain(i..e); }
            7 => { let i = rng.below(n) as usize; for _ in 0..rng.below(8) { data.insert(i, rng.next() as u8); } }
            // The frame header and the start of the first partition.
            8 => if let Some(p) = data.windows(4).position(|w| w == b"VP8 ") {
                let i = p + 8 + rng.below(40) as usize;
                if i < data.len() { data[i] ^= 1 << rng.below(8); }
            },
            // Cut a little off the end, and keep the sizes in the headers consistent with that half of the time.
            _ => {
                let cut = rng.below(n.min(200)) as usize;
                data.truncate(data.len() - cut);
                if rng.below(2) == 0 { craft::fix_sizes(data); }
            }
        }
    }
}

fn time<T>(n: usize, mut f: impl FnMut() -> T) -> f64 {
    // The best of a few rounds: other work runs on this machine.
    (0..5).map(|_| {
        let t = std::time::Instant::now();
        for _ in 0..n { std::hint::black_box(f()); }
        t.elapsed().as_secs_f64() * 1000.0 / n as f64
    }).fold(f64::MAX, f64::min)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    reference::c_disable_simd();
    let (mut total, mut bad) = (0u64, 0u64);
    let mut report = |name: &str, d: Option<String>| {
        total += 1;
        if let Some(d) = d {
            bad += 1;
            if bad <= 40 { println!("DIFF {name}: {d}"); }
        }
    };
    let num = |i: usize, default: u64| args.get(i).map_or(default, |s| s.parse().unwrap());
    match args.first().map(String::as_str) {
        Some("dec") => for f in files(&args[1..]) {
            report(&f.display().to_string(), diff_decode(&std::fs::read(&f).unwrap()));
        },
        Some("gen") => {
            std::fs::create_dir_all(&args[1]).unwrap();
            let mut rng = Rng(num(3, 1));
            let srcs: Vec<Image> = files(&["/root/ref/corpus/img".into()]).iter().filter_map(|p| load(p)).filter(|i| i.w <= 300).collect();
            for i in 0..num(2, 100) {
                let synth;
                let img = if rng.below(3) == 0 { &srcs[rng.below(srcs.len() as u64) as usize] } else { synth = images::synth(rng.next()); &synth };
                let p = random_config(&mut rng);
                if let Some(out) = reference::encode_advanced(&img.rgba, img.w, img.h, &p) {
                    std::fs::write(Path::new(&args[1]).join(format!("{i:05}-vp8.webp")), out).unwrap();
                }
            }
        }
        Some("craft") => {
            // craft DIR ITERS [SEED] [THREADS]: rewrite the headers of files of DIR with random valid settings
            let corpus: Vec<Vec<u8>> = files(&args[1..2]).iter().map(|f| std::fs::read(f).unwrap()).collect();
            diff_decode(&corpus[0]);
            let (iters, seed, threads) = (num(2, 1000), num(3, 1), num(4, 1));
            let found = std::sync::Mutex::new(vec![]);
            std::thread::scope(|s| for t in 0..threads {
                let (corpus, found) = (&corpus, &found);
                s.spawn(move || {
                    let mut rng = Rng(seed.wrapping_mul(1_000_003).wrapping_add(t));
                    for i in 0..iters / threads {
                        let src = &corpus[rng.below(corpus.len() as u64) as usize];
                        let Some(data) = craft::craft(&mut rng, src) else { continue };
                        if let Some(d) = diff_decode(&data) {
                            keep(&format!("craft-{seed}-{t}-{i}.webp"), &data);
                            found.lock().unwrap().push((format!("craft {seed}-{t}-{i}"), d));
                        }
                    }
                });
            });
            let found = found.into_inner().unwrap();
            let kept = found.len() as u64;
            for (name, d) in found { report(&name, Some(d)); }
            for _ in kept..iters / threads * threads { report("", None); }
        }
        Some("mutate") => {
            let corpus: Vec<Vec<u8>> = files(&args[1..2]).iter().map(|f| std::fs::read(f).unwrap()).collect();
            diff_decode(&corpus[0]);
            let (iters, seed, threads) = (num(2, 1000), num(3, 1), num(4, 1));
            let found = std::sync::Mutex::new(vec![]);
            std::thread::scope(|s| for t in 0..threads {
                let (corpus, found) = (&corpus, &found);
                s.spawn(move || {
                    let mut rng = Rng(seed.wrapping_mul(1_000_003).wrapping_add(t));
                    for i in 0..iters / threads {
                        let mut data = corpus[rng.below(corpus.len() as u64) as usize].clone();
                        mutate(&mut rng, &mut data);
                        if let Some(d) = diff_decode(&data) {
                            keep(&format!("mutant-{seed}-{t}-{i}.webp"), &data);
                            found.lock().unwrap().push((format!("mutant {seed}-{t}-{i}"), d));
                        }
                    }
                });
            });
            let found = found.into_inner().unwrap();
            let kept = found.len() as u64;
            for (name, d) in found { report(&name, Some(d)); }
            for _ in kept..iters / threads * threads { report("", None); }
        }
        Some("enc") => {
            let img = load(Path::new(&args[1])).unwrap();
            let out = reference::encode_rgba(&img.rgba, img.w, img.h, img.w as usize * 4, args[3].parse().unwrap()).unwrap();
            std::fs::write(&args[2], out).unwrap();
            return;
        }
        Some("refilter") => {
            // refilter IN OUT off|simple
            let src = std::fs::read(&args[1]).unwrap();
            let out = if args[3] == "off" { craft::refilter(&src, Some(0), false) } else { craft::refilter(&src, None, true) };
            std::fs::write(&args[2], out.unwrap()).unwrap();
            return;
        }
        Some("profile") => {
            // profile FILE N OUT [ref]
            let data = std::fs::read(&args[1]).unwrap();
            let (w, h) = reference::get_info(&data).unwrap();
            let mut out = vec![0u8; w as usize * h as usize * 4];
            let s = w as usize * 4;
            profile::start();
            for _ in 0..num(2, 100) {
                if args.len() > 4 { reference::decode_rgba_into(&data, &mut out, s); } else { bun_webp::decode_rgba_into(&data, &mut out, s).unwrap(); }
            }
            profile::stop(&args[3]);
            return;
        }
        Some("bench-dec") => {
            let data = std::fs::read(&args[1]).unwrap();
            let (w, h) = reference::get_info(&data).unwrap();
            let mut out = vec![0u8; w as usize * h as usize * 4];
            let n = num(2, 20) as usize;
            let s = w as usize * 4;
            let r = time(n, || reference::decode_rgba_into(&data, &mut out, s));
            let c = time(n, || reference::c_decode_status(&data, &mut out, s));
            let m = time(n, || bun_webp::decode_rgba_into(&data, &mut out, s).is_ok());
            println!("decode {w}x{h}: reference {r:.2} ms, its plain C {c:.2} ms, bun_webp {m:.2} ms ({:.2}x of the reference)", m / r);
            #[cfg(feature = "stages")]
            {
                let runs = (5 * n) as f64;
                let t: Vec<f64> = bun_webp::dev_hooks::NANOS.iter().map(|x| x.load(Relaxed) as f64 / runs / 1e6).collect();
                println!("    modes {:.2}  coeffs {:.2}  reconstruct {:.2}  filter {:.2}  emit {:.2} ms; {:.0} of {} macroblocks have residuals", t[0], t[1], t[2], t[3], t[4], t[5] * 1e6, w.div_ceil(16) * h.div_ceil(16));
            }
            return;
        }
        _ => { eprintln!("see the top of src/main.rs"); std::process::exit(2); }
    }
    println!("{total} compared, {bad} differ");
    println!(
        "  accepted {}, reference statuses {:?}, stub hit {}, unknown because of the alpha stub {}, reference SIMD != plain C {}",
        ACCEPTED.load(Relaxed), STATUS.iter().map(|s| s.load(Relaxed)).collect::<Vec<_>>(), STUB.load(Relaxed),
        ALPHA_UNKNOWN.load(Relaxed), REF_SELF_DIFF.load(Relaxed)
    );
    std::process::exit((bad != 0) as i32);
}
