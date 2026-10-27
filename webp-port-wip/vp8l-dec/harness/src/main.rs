//! Differential test of bun_webp against the reference libwebp v1.6.0.
//!
//!   webp-diff dec FILE|DIR...            get_info + decode: same accept/reject, same pixels
//!   webp-diff gen OUTDIR COUNT [SEED]    decoder test files from the reference's advanced encoder, random settings
//!   webp-diff mutate DIR ITERS [SEED]    corrupt files of DIR at random, then as `dec`
//!   webp-diff lossless FIRST COUNT       encode synthetic images FIRST..FIRST+COUNT: same bytes
//!   webp-diff lossy FIRST COUNT          same, at several qualities
//!   webp-diff lossless-img FILE|DIR...   encode the pixels of these WebP files (read with the reference)
//!   webp-diff lossy-img FILE|DIR...
//!   webp-diff bench-dec FILE N | bench-lossy FILE N | bench-lossless FILE N
//!
//! Added for the lossless and alpha decoders (gen_ll.rs is a generator of VP8L bitstreams that uses the whole format):
//!   webp-diff par JOBS SUBCOMMAND ARGS... SEED   JOBS processes with SEED, SEED + 1, ...; sums up their counts
//!   webp-diff fuzz-ll COUNT SEED         generated lossless files and WEBP_DIFF_MUTANTS (4) mutants of each, as `dec`
//!   webp-diff gen-ll OUTDIR COUNT [SEED] the same files, written out
//!   webp-diff alpha FILE|DIR...          dev_hooks::alpha_decode of the ALPH payload = A channel of the reference
//!   webp-diff alpha-mutate DIR ITERS [SEED]  the same, after corrupting only the ALPH payload
//!   webp-diff fuzz-alpha COUNT SEED      generated ALPH payloads (and mutants) in valid lossy files
//!   webp-diff gen-transforms OUTDIR      1500x1000 files with one predictor / transform / kind of backward reference
//!   webp-diff gen-tiny OUTDIR            50-byte files of 8000x8000 pixels
//!   webp-diff bench-min N FILE|DIR...    best of N, reference and bun_webp interleaved
//!   webp-diff bench-alpha N FILE|DIR... | bench-unfilter
//! `dec`-like comparisons also compare the status code, and skip files the lossy stub refuses. `mutate` only uses
//! lossless files, shorter than WEBP_DIFF_MAX_LEN. WEBP_DIFF_ODD_BUFFERS=1: padded strides, buffers of the wrong size.
//!
//! WEBP_DIFF_NOSIMD=1 makes the reference use its plain C code. WEBP_DIFF_VP8_ONLY=1 compares only the `VP8 ` chunk of
//! lossy output. WEBP_DIFF_KEEP=DIR writes failing inputs/outputs there. Exit code 1 if anything differed.
mod gen_ll;
mod images;
mod reference;

use images::{Image, Rng};
use std::path::{Path, PathBuf};

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
    out
}

fn keep(name: &str, bytes: &[u8]) {
    if let Ok(dir) = std::env::var("WEBP_DIFF_KEEP") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(Path::new(&dir).join(name), bytes).unwrap();
    }
}

static SKIPPED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static ACCEPTED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn status_of<T>(r: &Result<T, bun_webp::DecodeError>) -> i32 {
    use bun_webp::DecodeError::*;
    match r {
        Ok(_) => 0,
        Err(OutOfMemory) => 1,
        Err(InvalidParam) => 2,
        Err(BitstreamError) => 3,
        Err(UnsupportedFeature) => 4,
        Err(Suspended) => 5,
        Err(NotEnoughData) => 7,
        Err(Bug) => -1,
    }
}

/// `file` with the payload of its ALPH chunk replaced.
fn with_alpha(file: &[u8], payload: &[u8]) -> Vec<u8> {
    let c = chunks(file).into_iter().find(|c| c.0 == "ALPH").unwrap();
    let mut out = file[..c.1 - 4].to_vec();
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    if payload.len() & 1 == 1 { out.push(0); }
    out.extend_from_slice(&file[c.1 + c.2 + (c.2 & 1)..]);
    let riff = (out.len() - 8) as u32;
    out[4..8].copy_from_slice(&riff.to_le_bytes());
    out
}

/// `file` is lossy, valid but for the ALPH payload.
fn diff_alpha(file: &[u8]) -> Option<String> {
    let (w, h) = reference::get_info(file).expect("get_info");
    let payload = chunk(file, "ALPH").unwrap();
    let stride = w as usize * 4;
    let mut a = vec![0u8; stride * h as usize];
    let status = reference::decode_status(file, &mut a, stride);
    let mine = bun_webp::dev_hooks::alpha_decode(payload, w as usize, h as usize);
    if status == 0 { ACCEPTED.fetch_add(1, std::sync::atomic::Ordering::Relaxed); }
    if matches!(mine, Err(bun_webp::DecodeError::Bug)) {
        return Some("alpha: bun_webp reported Bug".into());
    }
    if (status == 0) != mine.is_ok() {
        return Some(format!("alpha: reference status {status}, bun_webp {:?}", mine.err()));
    }
    // ALPHInit failing is reported as out of memory by libwebp.
    if status != 0 && status != 3 && status != 1 {
        return Some(format!("alpha: unexpected reference status {status}"));
    }
    if let Ok(plane) = mine {
        let r: Vec<u8> = a.chunks_exact(4).map(|p| p[3]).collect();
        if r != plane {
            let i = r.iter().zip(&plane).position(|(x, y)| x != y).unwrap();
            return Some(format!("alpha: differs first at x={} y={} reference={} bun_webp={}", i % w as usize, i / w as usize, r[i], plane[i]));
        }
    }
    None
}

/// Returns an explanation if the two decoders disagree.
fn diff_decode(data: &[u8]) -> Option<String> {
    let ri = reference::get_info(data);
    let mi = bun_webp::get_info(data).ok();
    if ri != mi {
        return Some(format!("get_info: reference {ri:?}, bun_webp {mi:?}"));
    }
    let (w, h) = ri?;
    if w as u64 * h as u64 > 64 << 20 {
        return None;
    }
    let mut stride = w as usize * 4;
    let mut len = stride * h as usize;
    // WEBP_DIFF_ODD_BUFFERS=1: padded or short rows, buffers that are too small or too large
    if std::env::var_os("WEBP_DIFF_ODD_BUFFERS").is_some() {
        let x = data.iter().fold(0u64, |a, &b| a.wrapping_mul(31).wrapping_add(b as u64));
        stride = (stride + [0, 0, 1, 4, 13][(x % 5) as usize]).saturating_sub([0, 0, 0, 1][(x / 5 % 4) as usize]);
        len = (stride * (h as usize - 1) + w as usize * 4 + [0, 0, 7][(x / 20 % 3) as usize]).saturating_sub([0, 0, 1, 4][(x / 60 % 4) as usize]);
    }
    let mut a = vec![0u8; len];
    let mut b = vec![0u8; len];
    let status = reference::decode_status(data, &mut a, stride);
    let mine = bun_webp::decode_rgba_into(data, &mut b, stride);
    // The lossy decoder is a stub in this worktree.
    if mine == Err(bun_webp::DecodeError::UnsupportedFeature) && status != 4 {
        SKIPPED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        return None;
    }
    if status == 0 { ACCEPTED.fetch_add(1, std::sync::atomic::Ordering::Relaxed); }
    if status != status_of(&mine) {
        return Some(format!("decode: reference status {status}, bun_webp {mine:?}"));
    }
    if matches!(mine, Err(bun_webp::DecodeError::Bug)) {
        return Some("decode: bun_webp reported Bug".into());
    }
    if status == 0 && a != b {
        let i = a.iter().zip(&b).position(|(x, y)| x != y).unwrap();
        let n = a.iter().zip(&b).filter(|(x, y)| x != y).count();
        return Some(format!(
            "pixels: {n} bytes differ, first at x={} y={} channel={} reference={} bun_webp={}",
            i % stride / 4, i / stride, i % 4, a[i], b[i]
        ));
    }
    None
}

fn chunks(file: &[u8]) -> Vec<(String, usize, usize)> {
    let mut out = vec![];
    let mut pos = 12;
    while pos + 8 <= file.len() {
        let size = u32::from_le_bytes(file[pos + 4..pos + 8].try_into().unwrap()) as usize;
        out.push((String::from_utf8_lossy(&file[pos..pos + 4]).into_owned(), pos + 8, size));
        pos += 8 + size + (size & 1);
    }
    out
}

fn chunk<'a>(file: &'a [u8], tag: &str) -> Option<&'a [u8]> {
    chunks(file).into_iter().find(|c| c.0 == tag).map(|c| &file[c.1..c.1 + c.2])
}

fn diff_bytes(what: &str, r: Option<&[u8]>, m: Result<&[u8], String>) -> Option<String> {
    match (r, m) {
        (None, Err(_)) => None,
        (None, Ok(m)) => Some(format!("{what}: reference failed, bun_webp made {} bytes", m.len())),
        (Some(r), Err(e)) => Some(format!("{what}: reference made {} bytes, bun_webp failed: {e}", r.len())),
        (Some(r), Ok(m)) if r == m => None,
        (Some(r), Ok(m)) => {
            let i = r.iter().zip(m).position(|(x, y)| x != y).unwrap_or(r.len().min(m.len()));
            Some(format!(
                "{what}: {} vs {} bytes, first difference at offset {i}; reference chunks {:?}, bun_webp chunks {:?}",
                r.len(), m.len(), chunks(r), chunks(m)
            ))
        }
    }
}

fn diff_encode(img: &Image, lossy: Option<f32>) -> Option<String> {
    let stride = img.w as usize * 4;
    let (r, compression, what) = match lossy {
        Some(q) => (reference::encode_rgba(&img.rgba, img.w, img.h, stride, q), bun_webp::Compression::Lossy { quality: q }, format!("lossy q={q}")),
        None => (reference::encode_lossless_rgba(&img.rgba, img.w, img.h, stride), bun_webp::Compression::Lossless, "lossless".to_string()),
    };
    let m = bun_webp::encode_rgba(&img.rgba, img.w, img.h, stride, compression, None);
    let d = if std::env::var_os("WEBP_DIFF_VP8_ONLY").is_some() && lossy.is_some() {
        diff_bytes(&what, r.as_deref().and_then(|r| chunk(r, "VP8 ")), m.as_deref().map(|m| chunk(m, "VP8 ").unwrap_or(&[])).map_err(|e| format!("{e:?}")))
    } else {
        diff_bytes(&what, r.as_deref(), m.as_deref().map_err(|e| format!("{e:?}")))
    };
    if d.is_some() {
        let tag = img.desc.replace([' ', '/'], "_");
        if let Some(r) = &r { keep(&format!("{tag}.{what}.ref.webp"), r); }
        if let Ok(m) = &m { keep(&format!("{tag}.{what}.bun.webp"), m); }
    }
    d
}

fn load(path: &Path) -> Option<Image> {
    let data = std::fs::read(path).ok()?;
    let (w, h) = reference::get_info(&data)?;
    let mut rgba = vec![0u8; w as usize * h as usize * 4];
    reference::decode_rgba_into(&data, &mut rgba, w as usize * 4).then_some(())?;
    Some(Image { w, h, rgba, desc: path.file_name()?.to_string_lossy().into_owned() })
}

const QUALITIES: [f32; 7] = [75.0, 0.0, 100.0, 20.0, 50.0, 90.0, 83.5];

fn random_config(rng: &mut Rng) -> [i32; 23] {
    let lossless = (rng.below(2) == 0) as i32;
    [
        lossless,
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
        if data.is_empty() { return; }
        let n = data.len() as u64;
        match rng.below(8) {
            0 | 1 | 2 => { let i = rng.below(n) as usize; data[i] ^= 1 << rng.below(8); }
            3 => { let i = rng.below(n) as usize; data[i] = rng.next() as u8; }
            4 => { let i = rng.below(n.min(64)) as usize; data[i] = rng.next() as u8; }
            5 => { data.truncate(rng.below(n) as usize); }
            6 => { let i = rng.below(n) as usize; let l = rng.below(16) as usize; let e = (i + l).min(data.len()); data.drain(i..e); }
            _ => { let i = rng.below(n) as usize; for _ in 0..rng.below(8) { data.insert(i, rng.next() as u8); } }
        }
    }
}

fn time<T>(n: usize, mut f: impl FnMut() -> T) -> f64 {
    let t = std::time::Instant::now();
    for _ in 0..n { std::hint::black_box(f()); }
    t.elapsed().as_secs_f64() * 1000.0 / n as f64
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if std::env::var_os("WEBP_DIFF_NOSIMD").is_some() {
        reference::disable_simd();
    }
    let (mut total, mut bad) = (0u64, 0u64);
    let mut report = |name: &str, d: Option<String>| {
        total += 1;
        if let Some(d) = d {
            bad += 1;
            if bad <= 40 { println!("DIFF {name}: {d}"); }
        }
    };
    let num = |i: usize, default: u64| args.get(i).map_or(default, |s| s.parse().unwrap());
    let max_len: usize = std::env::var("WEBP_DIFF_MAX_LEN").map_or(usize::MAX, |s| s.parse().unwrap());
    match args.first().map(String::as_str) {
        // par JOBS SUBCOMMAND ARGS... SEED: JOBS processes, with SEED, SEED + 1, ...
        Some("par") => {
            let jobs: u64 = args[1].parse().unwrap();
            let seed: u64 = args.last().unwrap().parse().unwrap();
            let children: Vec<_> = (0..jobs).map(|j| {
                std::process::Command::new(std::env::current_exe().unwrap())
                    .args(&args[2..args.len() - 1]).arg((seed + j).to_string())
                    .stdout(std::process::Stdio::piped()).spawn().unwrap()
            }).collect();
            let mut failed = false;
            let mut sums = [0u64; 4];
            for c in children {
                let out = c.wait_with_output().unwrap();
                failed |= !out.status.success();
                let text = String::from_utf8_lossy(&out.stdout).into_owned();
                for line in text.lines() {
                    if line.contains(" compared, ") {
                        let n: Vec<u64> = line.split(|c: char| !c.is_ascii_digit()).filter(|t| !t.is_empty()).map(|t| t.parse().unwrap()).collect();
                        for (s, n) in sums.iter_mut().zip(n) { *s += n; }
                    } else {
                        println!("{line}");
                    }
                }
                if !out.status.success() && out.status.code() != Some(1) { println!("CHILD DIED: {:?}", out.status); }
            }
            println!("TOTAL {} compared, {} differ ({} accepted by the reference, {} skipped as lossy)", sums[0], sums[1], sums[2], sums[3]);
            std::process::exit(failed as i32);
        }
        Some("dec") => for f in files(&args[1..]) {
            report(&f.display().to_string(), diff_decode(&std::fs::read(&f).unwrap()));
        },
        // fuzz-ll COUNT SEED: generated lossless files, and WEBP_DIFF_MUTANTS (default 4) mutants of each
        Some("fuzz-ll") => {
            let mut rng = Rng(num(2, 1).wrapping_mul(0x9e3779b97f4a7c15));
            let mutants = std::env::var("WEBP_DIFF_MUTANTS").map_or(4, |s| s.parse().unwrap());
            for i in 0..num(1, 1000) {
                let file = gen_ll::file(&mut rng);
                let d = diff_decode(&file);
                if d.is_some() { keep(&format!("gen-{}-{i}.webp", num(2, 1)), &file); }
                report(&format!("generated {i}"), d);
                for m in 0..mutants {
                    let mut data = file.clone();
                    mutate(&mut rng, &mut data);
                    let d = diff_decode(&data);
                    if d.is_some() { keep(&format!("gen-{}-{i}-{m}.webp", num(2, 1)), &data); }
                    report(&format!("generated {i} mutant {m}"), d);
                }
            }
        }
        // gen-transforms OUTDIR: one file per predictor and per other transform, for bench-min
        Some("gen-transforms") => {
            std::fs::create_dir_all(&args[1]).unwrap();
            let mut rng = Rng(1);
            let mut write = |name: String, kind, value| {
                std::fs::write(Path::new(&args[1]).join(name), gen_ll::transform_file(&mut rng, kind, value, 1500, 1000)).unwrap();
            };
            for mode in 0..16 { write(format!("predictor-{mode:02}.webp"), 0, mode); }
            write("cross-color.webp".into(), 1, 37);
            write("cross-color-zero.webp".into(), 1, 0);
            write("subtract-green.webp".into(), 2, 0);
            for colors in [2, 4, 16, 256] { write(format!("palette-{colors:03}.webp"), 3, colors); }
            for (dist, len) in [(1, 4), (1, 12), (1, 64), (1, 1000), (2, 5), (2, 12), (2, 64), (3, 7), (5, 12), (8, 30), (7, 4096), (1500, 4), (1500, 8), (1500, 64), (1499, 1000)] {
                std::fs::write(Path::new(&args[1]).join(format!("backref-{dist:04}-{len:04}.webp")), gen_ll::backref_file(&mut rng, dist, len, 1500, 1000)).unwrap();
            }
        }
        Some("gen-tiny") => {
            std::fs::create_dir_all(&args[1]).unwrap();
            for mode in [1, 11, 13] {
                std::fs::write(Path::new(&args[1]).join(format!("tiny-{mode:02}.webp")), gen_ll::tiny_file(8000, 8000, mode)).unwrap();
            }
        }
        Some("gen-ll") => {
            std::fs::create_dir_all(&args[1]).unwrap();
            let mut rng = Rng(num(3, 1).wrapping_mul(0x9e3779b97f4a7c15));
            for i in 0..num(2, 100) {
                std::fs::write(Path::new(&args[1]).join(format!("{i:05}-ll.webp")), gen_ll::file(&mut rng)).unwrap();
            }
        }
        // fuzz-alpha COUNT SEED: generated ALPH payloads in valid lossy files, and mutants of the payloads
        Some("fuzz-alpha") => {
            let mut rng = Rng(num(2, 1).wrapping_mul(0x9e3779b97f4a7c15));
            let mutants = std::env::var("WEBP_DIFF_MUTANTS").map_or(4, |s| s.parse().unwrap());
            let mut bases = std::collections::HashMap::new();
            for i in 0..num(1, 1000) {
                let (mut w, mut h) = gen_ll::size(&mut rng);
                if w > 16383 { w = 16383; }
                if h > 16383 { h = 16383; }
                let base = bases.entry((w, h)).or_insert_with(|| {
                    let rgba: Vec<u8> = (0..w * h * 4).map(|i| if i % 4 == 3 { (i / 4 % 251) as u8 } else { 128 }).collect();
                    reference::encode_rgba(&rgba, w as u32, h as u32, w * 4, 5.0).unwrap()
                });
                let payload = gen_ll::alpha_payload(&mut rng, w, h);
                let file = with_alpha(base, &payload);
                let d = diff_alpha(&file);
                if d.is_some() { keep(&format!("gen-alpha-{}-{i}.webp", num(2, 1)), &file); }
                report(&format!("generated alpha {i}"), d);
                for m in 0..mutants {
                    let mut data = payload.clone();
                    mutate(&mut rng, &mut data);
                    let file = with_alpha(base, &data);
                    let d = diff_alpha(&file);
                    if d.is_some() { keep(&format!("gen-alpha-{}-{i}-{m}.webp", num(2, 1)), &file); }
                    report(&format!("generated alpha {i} mutant {m}"), d);
                }
            }
        }
        Some("alpha") => for f in files(&args[1..]) {
            let data = std::fs::read(&f).unwrap();
            if chunk(&data, "ALPH").is_none() || chunk(&data, "VP8 ").is_none() { continue; }
            report(&f.display().to_string(), diff_alpha(&data));
        },
        Some("alpha-mutate") => {
            let corpus: Vec<Vec<u8>> = files(&args[1..2]).iter().map(|f| std::fs::read(f).unwrap())
                .filter(|d| chunk(d, "ALPH").is_some() && chunk(d, "VP8 ").is_some() && d.len() < 20000).collect();
            let mut rng = Rng(num(3, 1));
            for i in 0..num(2, 1000) {
                let file = &corpus[rng.below(corpus.len() as u64) as usize];
                let mut payload = chunk(file, "ALPH").unwrap().to_vec();
                mutate(&mut rng, &mut payload);
                let data = with_alpha(file, &payload);
                let d = diff_alpha(&data);
                if d.is_some() { keep(&format!("alpha-mutant-{i}.webp"), &data); }
                report(&format!("alpha mutant {i}"), d);
            }
        }
        Some("gen") => {
            std::fs::create_dir_all(&args[1]).unwrap();
            let mut rng = Rng(num(3, 1));
            let srcs: Vec<Image> = files(&["/root/ref/corpus/img".into()]).iter().filter_map(|p| load(p)).filter(|i| i.w <= 300).collect();
            for i in 0..num(2, 100) {
                let synth;
                let img = if rng.below(3) == 0 { &srcs[rng.below(srcs.len() as u64) as usize] } else { synth = images::synth(rng.next()); &synth };
                let p = random_config(&mut rng);
                if let Some(out) = reference::encode_advanced(&img.rgba, img.w, img.h, &p) {
                    std::fs::write(Path::new(&args[1]).join(format!("{i:05}-{}.webp", if p[0] != 0 { "ll" } else { "vp8" })), out).unwrap();
                }
            }
        }
        Some("mutate") => {
            let corpus: Vec<Vec<u8>> = files(&args[1..2]).iter().map(|f| std::fs::read(f).unwrap())
                .filter(|d| chunk(d, "VP8L").is_some() && d.len() < max_len).collect();
            let mut rng = Rng(num(3, 1));
            for i in 0..num(2, 1000) {
                let mut data = corpus[rng.below(corpus.len() as u64) as usize].clone();
                mutate(&mut rng, &mut data);
                let d = diff_decode(&data);
                if d.is_some() { keep(&format!("mutant-{i}.webp"), &data); }
                report(&format!("mutant {i}"), d);
            }
        }
        Some(cmd @ ("lossless" | "lossy")) => for seed in num(1, 0)..num(1, 0) + num(2, 100) {
            let img = images::synth(seed);
            let name = format!("seed {seed} ({})", img.desc);
            if cmd == "lossless" {
                report(&name, diff_encode(&img, None));
            } else {
                for q in [QUALITIES[seed as usize % QUALITIES.len()], 75.0] { report(&name, diff_encode(&img, Some(q))); }
            }
        },
        Some(cmd @ ("lossless-img" | "lossy-img")) => for f in files(&args[1..]) {
            let Some(img) = load(&f) else { continue };
            if cmd == "lossless-img" {
                report(&img.desc, diff_encode(&img, None));
            } else {
                for q in QUALITIES { report(&img.desc, diff_encode(&img, Some(q))); }
            }
        },
        // bench-unfilter: raw alpha of random bytes, with each filter
        Some("bench-unfilter") => {
            let (w, h) = (1000usize, 1000usize);
            let mut rng = Rng(5);
            for filter in 0..4u8 {
                let mut payload = vec![filter << 2];
                payload.extend((0..w * h).map(|_| rng.next() as u8));
                let mut m = f64::MAX;
                for _ in 0..30 { m = m.min(time(1, || bun_webp::dev_hooks::alpha_decode(&payload, w, h).is_ok())); }
                println!("filter {filter}: {:.2} ns/px", m * 1e6 / (w * h) as f64);
            }
            return;
        }
        // bench-alpha N FILE...: alpha_decode against what the ALPH chunk adds to the reference's time
        Some("bench-alpha") => {
            let n = num(1, 20);
            let (mut tr, mut tm) = (0.0, 0.0);
            for f in files(&args[2..]) {
                let data = std::fs::read(&f).unwrap();
                let Some(payload) = chunk(&data, "ALPH") else { continue };
                if chunk(&data, "VP8 ").is_none() { continue; }
                let (w, h) = reference::get_info(&data).unwrap();
                if (w as u64 * h as u64) < 40000 { continue; }
                let c = chunks(&data).into_iter().find(|c| c.0 == "ALPH").unwrap();
                let mut without = data[..c.1 - 8].to_vec();
                without.extend_from_slice(&data[c.1 + c.2 + (c.2 & 1)..]);
                let riff = (without.len() - 8) as u32;
                without[4..8].copy_from_slice(&riff.to_le_bytes());
                let mut out = vec![0u8; w as usize * h as usize * 4];
                let (mut a, mut b, mut m) = (f64::MAX, f64::MAX, f64::MAX);
                for _ in 0..n {
                    a = a.min(time(1, || assert!(reference::decode_rgba_into(&data, &mut out, w as usize * 4))));
                    b = b.min(time(1, || assert!(reference::decode_rgba_into(&without, &mut out, w as usize * 4))));
                    m = m.min(time(1, || bun_webp::dev_hooks::alpha_decode(payload, w as usize, h as usize).is_ok()));
                }
                let r = a - b;
                tr += r; tm += m;
                println!("{:28} {w:5}x{h:<5} header {:02x} {:7} bytes  reference {r:7.3} ms  bun_webp {m:7.3} ms  {:.2} ns/px", f.file_name().unwrap().to_string_lossy(), payload[0], payload.len(), m * 1e6 / (w as f64 * h as f64));
            }
            println!("sum: reference {tr:.2} ms, bun_webp {tm:.2} ms, {:.2}x", tm / tr);
            return;
        }
        // bench-min N FILE...: the best of N runs of each decoder, interleaved
        Some("bench-min") => {
            let n = num(1, 20);
            let (mut tr, mut tm) = (0.0, 0.0);
            for f in files(&args[2..]) {
                let data = std::fs::read(&f).unwrap();
                let (w, h) = reference::get_info(&data).unwrap();
                let mut out = vec![0u8; w as usize * h as usize * 4];
                let (mut r, mut m) = (f64::MAX, f64::MAX);
                for _ in 0..n {
                    r = r.min(time(1, || reference::decode_rgba_into(&data, &mut out, w as usize * 4)));
                    m = m.min(time(1, || bun_webp::decode_rgba_into(&data, &mut out, w as usize * 4).is_ok()));
                }
                tr += r; tm += m;
                println!("{:32} {w:5}x{h:<5} reference {r:8.3} ms  bun_webp {m:8.3} ms  {:.2}x  {:.2} ns/px", f.file_name().unwrap().to_string_lossy(), m / r, m * 1e6 / (w as f64 * h as f64));
            }
            println!("sum: reference {tr:.2} ms, bun_webp {tm:.2} ms, {:.2}x", tm / tr);
            return;
        }
        Some("bench-dec") => {
            let data = std::fs::read(&args[1]).unwrap();
            let (w, h) = reference::get_info(&data).unwrap();
            let mut out = vec![0u8; w as usize * h as usize * 4];
            let n = num(2, 20) as usize;
            let r = time(n, || reference::decode_rgba_into(&data, &mut out, w as usize * 4));
            let m = time(n, || bun_webp::decode_rgba_into(&data, &mut out, w as usize * 4).is_ok());
            println!("decode {w}x{h}: reference {r:.2} ms, bun_webp {m:.2} ms ({:.2}x)", m / r);
        }
        Some(cmd @ ("bench-lossy" | "bench-lossless")) => {
            let img = load(Path::new(&args[1])).unwrap();
            let n = num(2, 5) as usize;
            let s = img.w as usize * 4;
            let (r, m) = if cmd == "bench-lossy" {
                (time(n, || reference::encode_rgba(&img.rgba, img.w, img.h, s, 80.0)),
                 time(n, || bun_webp::encode_rgba(&img.rgba, img.w, img.h, s, bun_webp::Compression::Lossy { quality: 80.0 }, None).is_ok()))
            } else {
                (time(n, || reference::encode_lossless_rgba(&img.rgba, img.w, img.h, s)),
                 time(n, || bun_webp::encode_rgba(&img.rgba, img.w, img.h, s, bun_webp::Compression::Lossless, None).is_ok()))
            };
            println!("{cmd} {}x{}: reference {r:.2} ms, bun_webp {m:.2} ms ({:.2}x)", img.w, img.h, m / r);
        }
        _ => { eprintln!("see the top of src/main.rs"); std::process::exit(2); }
    }
    println!("{total} compared, {bad} differ ({} accepted by the reference, {} skipped as lossy)",
        ACCEPTED.load(std::sync::atomic::Ordering::Relaxed), SKIPPED.load(std::sync::atomic::Ordering::Relaxed));
    std::process::exit((bad != 0) as i32);
}
