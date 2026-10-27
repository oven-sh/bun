//! Chooses golden test cases by the edge coverage they add in the reference libwebp (plain C paths).
#![allow(dead_code)]
mod images;
mod reference;
use images::Rng;
use std::path::Path;

unsafe extern "C" {
    fn cov_begin();
    fn cov_end(keep: i32) -> u32;
    fn cov_total() -> u32;
    fn cov_guards() -> u32;
}

fn chunks(file: &[u8]) -> Vec<(String, usize, usize)> {
    let mut out = vec![];
    let mut pos = 12;
    while pos + 8 <= file.len() {
        let size = u32::from_le_bytes(file[pos + 4..pos + 8].try_into().unwrap()) as usize;
        out.push((String::from_utf8_lossy(&file[pos..pos + 4]).into_owned(), pos + 8, size));
        pos = pos.saturating_add(8 + size + (size & 1));
    }
    out
}

fn chunk<'a>(file: &'a [u8], tag: &str) -> Option<&'a [u8]> {
    chunks(file).into_iter().find(|c| c.0 == tag).and_then(|c| file.get(c.1..c.1.checked_add(c.2)?))
}


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


fn run_decode(data: &[u8]) {
    let Some((w, h)) = reference::get_info(data) else { return };
    if w as u64 * h as u64 > 1 << 16 { return; }
    let mut out = vec![0u8; w as usize * h as usize * 4];
    if reference::decode_rgba_into(data, &mut out, w as usize * 4) {
        reference::icc(data);
    }
}

fn gain(data: &[u8], keep: bool) -> u32 {
    unsafe { cov_begin() };
    run_decode(data);
    unsafe { cov_end(keep as i32) }
}

fn small(rng: &mut Rng) -> images::Image {
    let (w, h) = match rng.below(8) {
        0 => (1, 1),
        1 => (rng.range(1, 64) as u32, 1),
        2 => (1, rng.range(1, 64) as u32),
        3 | 4 => (rng.range(1, 17) as u32, rng.range(1, 17) as u32),
        _ => (rng.range(1, 48) as u32, rng.range(1, 48) as u32),
    };
    let (c, a) = (rng.below(images::COLOR_KINDS), rng.below(images::ALPHA_KINDS));
    images::synth_kind(rng, w, h, c, a)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    reference::disable_simd();
    match args[0].as_str() {
        "dec" => {
            let (out, n, seed): (&str, u64, u64) = (&args[1], args[2].parse().unwrap(), args[3].parse().unwrap());
            let mut rng = Rng(seed);
            let mut kept: Vec<Vec<u8>> = vec![];
            let mut round = |cands: &mut Vec<Vec<u8>>, kept: &mut Vec<Vec<u8>>, what: &str| {
                cands.sort_by_key(Vec::len);
                let before = kept.len();
                for c in cands.drain(..) {
                    if c.len() <= 2500 && gain(&c, false) > 0 { gain(&c, true); kept.push(c); }
                }
                eprintln!("{what}: +{} cases, {} edges of {}", kept.len() - before, unsafe { cov_total() }, unsafe { cov_guards() });
            };
            let mut cands = vec![];
            for _ in 0..n {
                let img = small(&mut rng);
                if let Some(f) = reference::encode_advanced(&img.rgba, img.w, img.h, &random_config(&mut rng)) { cands.push(f); }
            }
            // The encoder ran under coverage too; only what cov_end(keep) records counts, so nothing to reset.
            round(&mut cands, &mut kept, "encoded");
            for r in 0..6 {
                let pool = kept.clone();
                for _ in 0..n { cands.push(random_container(&mut rng, &pool)); }
                round(&mut cands, &mut kept, &format!("containers {r}"));
                let pool = kept.clone();
                for _ in 0..n * 20 {
                    let mut d = pool[rng.below(pool.len() as u64) as usize].clone();
                    mutate(&mut rng, &mut d);
                    cands.push(d);
                }
                round(&mut cands, &mut kept, &format!("mutants {r}"));
            }
            std::fs::create_dir_all(out).unwrap();
            for (i, k) in kept.iter().enumerate() { std::fs::write(Path::new(out).join(format!("{i:05}.webp")), k).unwrap(); }
        }
        // Beyond coverage: random valid files, damaged files that still decode, damaged files that do not.
        "extra" => {
            let (out, n, seed): (&str, usize, u64) = (&args[1], args[2].parse().unwrap(), args[3].parse().unwrap());
            let mut rng = Rng(seed);
            std::fs::create_dir_all(out).unwrap();
            let mut valid = vec![];
            while valid.len() < n {
                let img = small(&mut rng);
                if let Some(f) = reference::encode_advanced(&img.rgba, img.w, img.h, &random_config(&mut rng)) { if f.len() <= 1200 { valid.push(f); } }
            }
            let decode = |d: &[u8]| -> Option<Vec<u8>> {
                let (w, h) = reference::get_info(d)?;
                if w as u64 * h as u64 > 1 << 14 { return None; }
                let mut o = vec![0u8; w as usize * h as usize * 4];
                reference::decode_rgba_into(d, &mut o, w as usize * 4).then_some(o)
            };
            let (mut ok, mut bad) = (vec![], vec![]);
            while ok.len() < n || bad.len() < n / 2 {
                let src = &valid[rng.below(valid.len() as u64) as usize];
                let mut d = src.clone();
                mutate(&mut rng, &mut d);
                match decode(&d) {
                    Some(px) if ok.len() < n && Some(&px) != decode(src).as_ref() => ok.push(d),
                    None if bad.len() < n / 2 && d.len() > 30 && reference::get_info(&d).is_some() => bad.push(d),
                    _ => {}
                }
            }
            let icc: Vec<Vec<u8>> = valid.iter().take(40).filter_map(|f| {
                let p: Vec<u8> = (0..rng.range(1, 300)).map(|_| rng.next() as u8).collect();
                reference::mux_icc(f, &p)
            }).collect();
            for (tag, v) in [("valid", valid), ("ok", ok), ("bad", bad), ("icc", icc)] {
                for (i, k) in v.iter().enumerate() { std::fs::write(Path::new(out).join(format!("{tag}-{i:05}.webp")), k).unwrap(); }
            }
        }
        // Keeps a subset of DIR with the same coverage, smallest files first, most valuable last-added dropped first.
        "min" => {
            let mut files: Vec<_> = std::fs::read_dir(&args[1]).unwrap().map(|e| e.unwrap().path()).collect();
            files.sort();
            let mut data: Vec<(std::path::PathBuf, Vec<u8>)> = files.into_iter().map(|p| { let d = std::fs::read(&p).unwrap(); (p, d) }).collect();
            // Greedy set cover: repeatedly take the file that adds the most edges per byte.
            let mut total = 0;
            let mut chosen = 0;
            loop {
                let mut best: Option<(usize, f64)> = None;
                for (i, (_, d)) in data.iter().enumerate() {
                    let g = gain(d, false);
                    if g > 0 {
                        let score = g as f64 / (d.len() as f64 + 200.0);
                        if best.is_none_or(|b| score > b.1) { best = Some((i, score)); }
                    }
                }
                let Some((i, _)) = best else { break };
                let (p, d) = data.swap_remove(i);
                gain(&d, true);
                total += d.len();
                chosen += 1;
                println!("{}", p.display());
            }
            eprintln!("{chosen} files, {total} bytes, {} edges", unsafe { cov_total() });
        }
        "enc" => {
            let mut files: Vec<_> = std::fs::read_dir(&args[1]).unwrap().map(|e| e.unwrap().path()).collect();
            files.sort_by_key(|p| std::fs::metadata(p).unwrap().len());
            let mut n = 0;
            for p in files {
                let name = p.file_stem().unwrap().to_string_lossy().into_owned();
                let v: Vec<u32> = name.split('-').map(|s| s.parse().unwrap()).collect();
                let rgba = std::fs::read(&p).unwrap();
                let (w, h) = (v[1], v[2]);
                for q in [-1i32, 75, 0, 100, 30, 90, 55, 10] {
                    unsafe { cov_begin() };
                    if q < 0 { reference::encode_lossless_rgba(&rgba, w, h, w as usize * 4); } else { reference::encode_rgba(&rgba, w, h, w as usize * 4, q as f32); }
                    if unsafe { cov_end(1) } > 0 {
                        n += 1;
                        let opt = if q < 0 { "{\"lossless\":true}".to_string() } else { format!("{{\"quality\":{q}}}") };
                        println!("{{\"image\":{{\"seed\":{},\"width\":{w},\"height\":{h},\"color\":{},\"alpha\":{}}},\"options\":{opt}}}", v[0], v[3], v[4]);
                    }
                }
            }
            eprintln!("{n} cases, {} edges of {}", unsafe { cov_total() }, unsafe { cov_guards() });
        }
        _ => panic!(),
    }
}
