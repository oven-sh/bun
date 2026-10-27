//! More synthetic inputs for the lossless and the alpha encoders.
use crate::images::{Image, Rng};

pub const HARD_KINDS: u64 = 16;

fn dims(rng: &mut Rng) -> (usize, usize) {
    match rng.below(10) {
        0 => (rng.range(1, 12) as usize, rng.range(1, 300) as usize),
        1 => (rng.range(1, 600) as usize, rng.range(1, 12) as usize),
        2 | 3 => (rng.range(1, 64) as usize, rng.range(1, 64) as usize),
        4 => (rng.range(120, 400) as usize, rng.range(120, 400) as usize),
        _ => (rng.range(1, 160) as usize, rng.range(1, 160) as usize),
    }
}

fn color(rng: &mut Rng, style: u64) -> [u8; 4] {
    let r = rng.next();
    let b = r.to_le_bytes();
    match style {
        0 => [b[0], b[1], b[2], 255],
        1 => [b[0], b[1], b[2], b[3]],
        2 => [b[0], b[0], b[0], 255],
        3 => [b[0], 10, 200, 255],
        4 => [7, b[0], 9, 255],
        5 => [7, 9, b[0], 255],
        6 => [50, 60, 70, b[0].max(1)],
        7 => [b[0] & 0xf0, b[1] & 0xf0, b[2] & 0xf0, 255],
        _ => [b[0], b[1], b[2], if b[3] < 100 { 0 } else { b[4] }],
    }
}

/// `n` different colours.
fn distinct(rng: &mut Rng, n: usize, style: u64) -> Vec<[u8; 4]> {
    let mut v: Vec<[u8; 4]> = vec![];
    let mut tries = 0;
    while v.len() < n {
        tries += 1;
        let c = if tries > 4000 { color(rng, 1) } else { color(rng, style) };
        // After WebPReplaceTransparentPixels all the transparent colours are one.
        if c[3] == 0 && v.iter().any(|o| o[3] == 0) { continue; }
        if !v.contains(&c) { v.push(c); }
    }
    v
}

pub fn hard(seed: u64) -> Image {
    let mut rng = Rng(seed ^ 0x5eed_1234);
    let kind = seed % HARD_KINDS;
    let (w, h) = dims(&mut rng);
    hard_kind(&mut rng, kind, w, h)
}

pub fn hard_kind(rng: &mut Rng, kind: u64, mut w: usize, mut h: usize) -> Image {
    const NS: [usize; 12] = [1, 2, 3, 4, 5, 15, 16, 17, 18, 255, 256, 257];
    let n = NS[rng.below(12) as usize];
    let style = rng.below(9);
    let mut extra = String::new();
    let mut px: Vec<[u8; 4]>;
    let f: Vec<f64> = (0..8).map(|_| rng.range(1, 1000) as f64 / 3000.0).collect();
    match kind {
        // Exactly n colours (if there is room), at random or in some structure.
        0 | 1 | 2 => {
            let pal = distinct(rng, n, style);
            px = (0..w * h).map(|i| {
                let (x, y) = (i % w, i / w);
                let k = match kind {
                    0 => rng.below(n as u64) as usize,
                    1 => (((x as f64 * f[0]).sin() + (y as f64 * f[1]).cos() + 2.0) / 4.0 * n as f64) as usize % n,
                    _ => (x / 3 + y / 2) % n,
                };
                pal[k]
            }).collect();
            // Make sure that each colour is there.
            for (i, c) in pal.iter().enumerate() { if i < px.len() { let at = (i * 7919) % px.len(); px[at] = *c; } }
            extra = format!("n={n} style={style}");
        }
        // More than 17 colours, one of which is transparent black.
        3 => {
            let n = rng.range(18, 256) as usize;
            let st = [0, 1, 7][rng.below(3) as usize];
            let mut pal = distinct(rng, n, st);
            pal[0] = [rng.next() as u8, 3, 4, 0];
            px = (0..w * h).map(|_| pal[rng.below(n as u64) as usize]).collect();
            extra = format!("n={n}");
        }
        // One channel varies.
        4 => {
            let style = rng.range(2, 6) as u64;
            let smooth = rng.below(2) == 0;
            px = (0..w * h).map(|i| {
                if smooth {
                    let v = (127.5 + 127.0 * ((i % w) as f64 * f[0]).sin() * ((i / w) as f64 * f[1]).cos()) as u8;
                    match style { 2 => [v, v, v, 255], 3 => [v, 10, 200, 255], 4 => [7, v, 9, 255], 5 => [7, 9, v, 255], _ => [50, 60, 70, v.max(1)] }
                } else { color(rng, style) }
            }).collect();
            extra = format!("style={style} smooth={smooth}");
        }
        // Flat areas.
        5 => {
            let bg = color(rng, style);
            px = vec![bg; w * h];
            for _ in 0..rng.below(6) {
                let c = color(rng, style);
                let (x0, y0) = (rng.below(w as u64) as usize, rng.below(h as u64) as usize);
                let (x1, y1) = (rng.range(x0 as i64, w as i64) as usize, rng.range(y0 as i64, h as i64) as usize);
                for y in y0..y1 { for x in x0..x1 { px[y * w + x] = c; } }
            }
        }
        // Noise that comes back after a long distance.
        6 => {
            w = rng.range(1, 40) as usize;
            let period = rng.range(1, 400) as usize;
            h = period * 2 + rng.range(0, 60) as usize;
            let block: Vec<[u8; 4]> = (0..w * period).map(|_| color(rng, style)).collect();
            px = (0..w * h).map(|i| block[i % block.len()]).collect();
            extra = format!("period={period}");
        }
        // Transparent pixels with garbage in them.
        7 => {
            let t = rng.range(1, 9) as f64 / 10.0;
            px = (0..w * h).map(|i| {
                let (x, y) = ((i % w) as f64, (i / w) as f64);
                let hole = ((x * f[0]).sin() * (y * f[1]).cos() + 1.0) / 2.0 < t;
                let base = [(127.0 + 100.0 * (x * f[2]).sin()) as u8, (127.0 + 100.0 * (y * f[3]).sin()) as u8, ((x + y) * 2.0) as u8];
                if hole { [rng.next() as u8, rng.next() as u8, rng.next() as u8, 0] } else { [base[0], base[1], base[2], if style < 4 { 255 } else { (rng.next() as u8).max(1) }] }
            }).collect();
        }
        // Like a photo.
        8 => {
            let amp = rng.range(0, 12) as i64;
            px = (0..w * h).map(|i| {
                let (x, y) = ((i % w) as f64, (i / w) as f64);
                let mut c = [0u8; 4];
                for k in 0..3 {
                    let v = 127.0 + 60.0 * (x * f[k] * 0.3).sin() + 60.0 * (y * f[k + 3] * 0.3).cos();
                    c[k] = (v as i64 + rng.range(-amp, amp)).clamp(0, 255) as u8;
                }
                c[3] = 255;
                c
            }).collect();
            extra = format!("amp={amp}");
        }
        // Glyphs.
        9 => {
            let (gw, gh) = (rng.range(3, 9) as usize, rng.range(4, 12) as usize);
            let nglyph = rng.range(2, 30) as usize;
            let glyphs: Vec<bool> = (0..nglyph * gw * gh).map(|_| rng.below(3) == 0).collect();
            let cols = w / gw + 1;
            let text: Vec<usize> = (0..cols * (h / gh + 1)).map(|_| rng.below(nglyph as u64) as usize).collect();
            let (fg, bg) = (color(rng, style), color(rng, style));
            px = (0..w * h).map(|i| {
                let (x, y) = (i % w, i / w);
                let g = text[(y / gh) * cols + x / gw];
                if glyphs[g * gw * gh + (y % gh) * gw + x % gw] { fg } else { bg }
            }).collect();
        }
        // Stripes.
        10 => {
            let p = rng.range(1, 20) as usize;
            let pal = distinct(rng, p, style);
            let dir = rng.below(3);
            px = (0..w * h).map(|i| pal[match dir { 0 => i % w, 1 => i / w, _ => i % w + i / w } % p]).collect();
            extra = format!("p={p} dir={dir}");
        }
        // Few colours in a narrow image.
        11 => {
            w = rng.range(1, 14) as usize;
            h = rng.range(1, 400) as usize;
            let n = rng.range(2, 16) as usize;
            let pal = distinct(rng, n, style);
            let run = rng.range(1, 12) as u64;
            let mut cur = pal[0];
            px = (0..w * h).map(|_| { if rng.below(run) == 0 { cur = pal[rng.below(n as u64) as usize]; } cur }).collect();
            extra = format!("n={n} run={run}");
        }
        // Runs around the longest copy.
        12 => {
            w = rng.range(1000, 9000) as usize;
            h = rng.range(1, 6) as usize;
            let n = rng.range(2, 40) as usize;
            let pal = distinct(rng, n, style);
            px = vec![];
            while px.len() < w * h {
                let len = [1, 2, 3, 5, 100, 4094, 4095, 4096, 4097, 8190, 8191, 9000][rng.below(12) as usize];
                let c = pal[rng.below(n as u64) as usize];
                for _ in 0..len { px.push(c); }
            }
            px.truncate(w * h);
        }
        // Colours that differ in alpha only, which defeats the hashes of ApplyPalette.
        13 => {
            let n = rng.range(2, 255) as usize;
            let base = color(rng, 0);
            let base2 = color(rng, 0);
            let pal: Vec<[u8; 4]> = (0..n).map(|i| { let b = if i % 2 == 0 || style < 4 { base } else { base2 }; [b[0], b[1], b[2], (i + 1) as u8] }).collect();
            px = (0..w * h).map(|_| pal[rng.below(n as u64) as usize]).collect();
            extra = format!("n={n}");
        }
        // Tiles of different nature, for the histogram clustering.
        14 => {
            w = rng.range(100, 500) as usize;
            h = rng.range(100, 500) as usize;
            let t = rng.range(8, 64) as usize;
            let cols = w / t + 1;
            let kinds: Vec<u64> = (0..cols * (h / t + 1)).map(|_| rng.below(5)).collect();
            let cs: Vec<[u8; 4]> = (0..8).map(|_| color(rng, 0)).collect();
            px = (0..w * h).map(|i| {
                let (x, y) = (i % w, i / w);
                match kinds[(y / t) * cols + x / t] {
                    0 => cs[0],
                    1 => color(rng, 0),
                    2 => [(x * 3) as u8, (y * 3) as u8, (x + y) as u8, 255],
                    3 => cs[rng.below(8) as usize],
                    _ => { let v = rng.below(16) as u8; [100 + v, 100 + v / 2, 90, 255] }
                }
            }).collect();
            extra = format!("t={t}");
        }
        // Gradients with exact repeats of rows.
        _ => {
            let rep = rng.range(1, 8) as usize;
            px = (0..w * h).map(|i| {
                let (x, y) = (i % w, (i / w) / rep);
                [(x * 2 + y) as u8, (x + y * 3) as u8, (x ^ y) as u8, 255]
            }).collect();
        }
    }
    let rgba = px.into_iter().flatten().collect();
    Image { w: w as u32, h: h as u32, rgba, desc: format!("hard {w}x{h} kind={kind} {extra}") }
}

pub const PLANE_KINDS: u64 = 16;

pub fn plane(seed: u64) -> (usize, usize, Vec<u8>, String) {
    let mut rng = Rng(seed ^ 0xa1fa_0000);
    let kind = seed % PLANE_KINDS;
    let (w, h) = match rng.below(12) {
        0 => (1, 1),
        1 => (rng.range(1, 5) as usize, rng.range(1, 5) as usize),
        2 => (rng.range(1, 500) as usize, rng.range(1, 3) as usize),
        3 => (rng.range(1, 3) as usize, rng.range(1, 500) as usize),
        4 => (rng.range(150, 420) as usize, rng.range(150, 420) as usize),
        _ => (rng.range(1, 130) as usize, rng.range(1, 130) as usize),
    };
    let f: Vec<f64> = (0..6).map(|_| rng.range(1, 1000) as f64 / 3000.0).collect();
    let levels = [2u64, 3, 4, 5, 15, 16, 17, 18, 40, 191, 192, 193, 194, 256][rng.below(14) as usize];
    let lv: Vec<u8> = { let mut v: Vec<u8> = (0..=255).collect(); for i in 0..256 { let j = rng.below(256) as usize; v.swap(i, j); } v.truncate(levels as usize); v };
    let mut a: Vec<u8> = (0..w * h).map(|i| {
        let (x, y) = ((i % w) as f64, (i / w) as f64);
        let wave = ((x * f[0]).sin() * (y * f[1]).cos() + 1.0) / 2.0;
        match kind {
            0 => if wave > 0.5 { 255 } else { 0 },
            1 => (x * 255.0 / w as f64) as u8,
            2 => (y * 255.0 / h as f64) as u8,
            3 => ((x + y) * 255.0 / (w + h) as f64) as u8,
            4 => rng.next() as u8,
            5 => lv[rng.below(levels) as usize],
            6 => lv[(wave * levels as f64) as usize % levels as usize],
            7 => 255,
            8 => { let d = ((x - w as f64 / 2.0).powi(2) + (y - h as f64 / 2.0).powi(2)).sqrt(); ((w.min(h) as f64 * 0.4 - d) * 40.0).clamp(0.0, 255.0) as u8 }
            9 => 0,
            10 => lv[0],
            11 => lv[((i % w) / 3 + (i / w) / 2) % levels as usize],
            12 => (wave * 255.0) as u8,
            13 => ((wave * 255.0) as i64 + rng.range(-3, 3)).clamp(0, 255) as u8,
            14 => if rng.below(50) == 0 { rng.next() as u8 } else { 255 },
            _ => { let d = ((x - w as f64 / 2.0).powi(2) + (y - h as f64 / 2.0).powi(2)).sqrt(); (d * f[2] * 20.0) as u8 }
        }
    }).collect();
    if kind == 7 { let at = rng.below((w * h) as u64) as usize; a[at] = rng.below(255) as u8; }
    (w, h, a, format!("plane {w}x{h} kind={kind} levels={levels}"))
}
