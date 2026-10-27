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
//! WEBP_DIFF_NOSIMD=1 makes the reference use its plain C code. WEBP_DIFF_VP8_ONLY=1 compares only the `VP8 ` chunk of
//! lossy output. WEBP_DIFF_KEEP=DIR writes failing inputs/outputs there. Exit code 1 if anything differed.
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
    let stride = w as usize * 4;
    let mut a = vec![0u8; stride * h as usize];
    let mut b = vec![0u8; stride * h as usize];
    let status = reference::decode_status(data, &mut a, stride);
    let mine = bun_webp::decode_rgba_into(data, &mut b, stride);
    if (status == 0) != mine.is_ok() {
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

fn put_chunk(out: &mut Vec<u8>, rng: &mut Rng, tag: &[u8], payload: &[u8]) {
    out.extend_from_slice(tag);
    let mut size = payload.len() as u32;
    match rng.below(40) { 0 => size = size.wrapping_add(1), 1 => size = size.wrapping_sub(1), 2 => size = rng.next() as u32, 3 => size = size.wrapping_add(2), _ => {} }
    out.extend_from_slice(&size.to_le_bytes());
    out.extend_from_slice(payload);
    if payload.len() & 1 != 0 && rng.below(30) != 0 { out.push(0); }
}

fn random_container(rng: &mut Rng, pool: &[Vec<u8>]) -> Vec<u8> {
    let src = &pool[rng.below(pool.len() as u64) as usize];
    let (w, h) = reference::get_info(src).unwrap_or((1, 1));
    let image = |rng: &mut Rng, out: &mut Vec<u8>, src: &[u8]| {
        let order = rng.below(12);
        if order == 0 { if let Some(b) = chunk(src, "VP8 ") { put_chunk(out, rng, b"VP8 ", b); } }
        if let Some(a) = chunk(src, "ALPH") { if rng.below(8) != 0 { put_chunk(out, rng, b"ALPH", a); } if rng.below(20) == 0 { put_chunk(out, rng, b"ALPH", a); } }
        else if rng.below(10) == 0 { put_chunk(out, rng, b"ALPH", &[0, 1, 2, 3]); }
        if order != 0 { if let Some(b) = chunk(src, "VP8 ") { put_chunk(out, rng, b"VP8 ", b); } }
        if let Some(b) = chunk(src, "VP8L") { put_chunk(out, rng, b"VP8L", b); }
    };
    let mut body = vec![];
    if rng.below(12) != 0 {
        let mut flags = 0x20u8;
        if chunk(src, "ALPH").is_some() || rng.below(4) == 0 { flags |= 0x10; }
        if rng.below(4) == 0 { flags |= 0x02; }
        if rng.below(6) == 0 { flags ^= 1 << rng.below(8); }
        let (mut cw, mut ch) = (w - 1, h - 1);
        if rng.below(15) == 0 { cw = rng.below(1 << 24) as u32; }
        if rng.below(15) == 0 { ch = rng.below(1 << 24) as u32; }
        if flags & 2 != 0 && rng.below(2) == 0 { cw += rng.below(50) as u32; ch += rng.below(50) as u32; }
        let mut p = vec![flags, rng.below(30).min(1).wrapping_sub(1) as u8 & rng.next() as u8, 0, 0];
        p.extend_from_slice(&cw.to_le_bytes()[..3]);
        p.extend_from_slice(&ch.to_le_bytes()[..3]);
        for _ in 0..[0, 0, 0, 0, 0, 0, 1, 2, 5][rng.below(9) as usize] { p.push(rng.next() as u8); }
        if rng.below(40) == 0 { p.truncate(rng.below(10) as usize); }
        put_chunk(&mut body, rng, b"VP8X", &p);
    }
    let mut did_image = false;
    for _ in 0..rng.range(1, 7) {
        match rng.below(14) {
            0 | 1 | 2 => { let n = [0, 1, 2, 7, 64, 301][rng.below(6) as usize]; let p: Vec<u8> = (0..n).map(|_| rng.next() as u8).collect(); put_chunk(&mut body, rng, b"ICCP", &p); }
            3 | 4 | 5 | 6 => { image(rng, &mut body, src); did_image = true; }
            7 => { let n = rng.range(4, 9) as usize; put_chunk(&mut body, rng, b"ANIM", &vec![1; n]); }
            8 | 9 => {
                let mut p = vec![];
                for v in [rng.below(20) as u32 * (rng.below(3) == 0) as u32, rng.below(20) as u32 * (rng.below(3) == 0) as u32, w - 1, h - 1, 100] { p.extend_from_slice(&v.to_le_bytes()[..3]); }
                p.push(rng.below(4) as u8);
                if rng.below(10) != 0 { let k = rng.below(pool.len() as u64) as usize; image(rng, &mut p, if rng.0 & 1 == 0 { src } else { &pool[k] }); }
                if rng.below(10) == 0 { put_chunk(&mut p, rng, b"JUNK", &[1, 2, 3]); }
                put_chunk(&mut body, rng, b"ANMF", &p);
            }
            10 => put_chunk(&mut body, rng, b"EXIF", &[1, 2, 3, 4, 5]),
            11 => put_chunk(&mut body, rng, b"XMP ", &[1, 2]),
            12 => put_chunk(&mut body, rng, b"JUNK", &[9; 3]),
            _ => put_chunk(&mut body, rng, b"VP8X", &[0; 10]),
        }
    }
    if !did_image && rng.below(6) != 0 { image(rng, &mut body, src); }
    let mut out = b"RIFF".to_vec();
    let mut riff = body.len() as u32 + 4;
    match rng.below(25) { 0 => riff = riff.wrapping_add(rng.range(-9, 9) as u32), 1 => riff = rng.next() as u32, _ => {} }
    out.extend_from_slice(&riff.to_le_bytes());
    out.extend_from_slice(b"WEBP");
    out.extend_from_slice(&body);
    match rng.below(25) { 0 => { let n = rng.below(out.len() as u64) as usize; out.truncate(n); } 1 => out.extend_from_slice(&[0; 5]), 2 => { let i = rng.below(out.len() as u64) as usize; out[i] ^= 1 << rng.below(8); } _ => {} }
    out
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
                    std::fs::write(Path::new(&args[1]).join(format!("{i:05}-{}.webp", if p[0] != 0 { "ll" } else { "vp8" })), out).unwrap();
                }
            }
        }
        Some("mutate") => {
            let corpus: Vec<Vec<u8>> = files(&args[1..2]).iter().map(|f| std::fs::read(f).unwrap()).collect();
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
        Some("container") => {
            // Structure-aware container fuzz: get_info, icc_profile and decode accept/reject.
            let pool: Vec<Vec<u8>> = files(&args[1..2]).iter().map(|f| std::fs::read(f).unwrap()).filter(|d| d.len() < 3000).collect();
            let mut rng = Rng(num(3, 1));
            let (mut some, mut some_anim) = (0u64, 0u64);
            for i in 0..num(2, 1000) {
                let data = random_container(&mut rng, &pool);
                let (r, m) = (reference::icc(&data), bun_webp::icc_profile(&data).map(<[u8]>::to_vec));
                if r.is_some() { some += 1; if data[20] & 2 != 0 { some_anim += 1; } }
                let d = if r != m { Some(format!("icc: reference {:?} bun_webp {:?}", r.map(|v| v.len()), m.map(|v| v.len()))) } else {
                    let (ri, mi) = (reference::get_info(&data), bun_webp::get_info(&data).ok());
                    (ri != mi).then(|| format!("get_info: reference {ri:?}, bun_webp {mi:?}"))
                };
                if d.is_some() { keep(&format!("container-{i}.webp"), &data); }
                report(&format!("container {i} {:?}", chunks(&data).iter().map(|c| format!("{}:{}", c.0, c.2)).collect::<Vec<_>>()), d);
            }
            println!("profiles found: {some}, of which in animations: {some_anim}");
        }
        Some("icc-enc") => for seed in num(1, 0)..num(1, 0) + num(2, 100) {
            // encode_rgba with a profile against the reference's encoder followed by its muxer.
            let img = images::synth(seed);
            let stride = img.w as usize * 4;
            let mut rng = Rng(seed ^ 0x1cc);
            let icc: Vec<u8> = (0..[1u64, 2, 3, 128, 3145][seed as usize % 5]).map(|_| rng.next() as u8).collect();
            for lossy in [None, Some(75.0f32)] {
                let r = match lossy { Some(q) => reference::encode_rgba(&img.rgba, img.w, img.h, stride, q), None => reference::encode_lossless_rgba(&img.rgba, img.w, img.h, stride) };
                let r = r.and_then(|r| reference::mux_icc(&r, &icc));
                let c = match lossy { Some(quality) => bun_webp::Compression::Lossy { quality }, None => bun_webp::Compression::Lossless };
                let m = bun_webp::encode_rgba(&img.rgba, img.w, img.h, stride, c, Some(&icc));
                report(&format!("seed {seed} ({}) {lossy:?}", img.desc), diff_bytes("icc", r.as_deref(), m.as_deref().map_err(|e| format!("{e:?}"))));
                if let Ok(m) = &m { report("icc back", (bun_webp::icc_profile(m) != Some(&icc[..])).then(|| "profile does not come back".to_string())); }
            }
        },
        Some("huge") => {
            // W H COLOR_KIND ALPHA_KIND lossless|QUALITY
            let (w, h) = (num(1, 16383) as u32, num(2, 16383) as u32);
            let mut rng = Rng(5);
            let img = images::synth_kind(&mut rng, w, h, num(3, 2), num(4, 0));
            let q = args[5].parse::<f32>().ok();
            report(&format!("{} {}", img.desc, args[5]), diff_encode(&img, q));
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
    println!("{total} compared, {bad} differ");
    std::process::exit((bad != 0) as i32);
}
