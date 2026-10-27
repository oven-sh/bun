//! A generator of VP8L bitstreams that uses the whole format, not only what libwebp's encoder emits. Most streams are
//! valid; some are deliberately not.
use crate::images::Rng;

pub struct BitWriter {
    pub bytes: Vec<u8>,
    acc: u64,
    n: u32,
}

impl BitWriter {
    pub fn new() -> Self {
        Self { bytes: vec![], acc: 0, n: 0 }
    }
    pub fn put(&mut self, v: u32, bits: u32) {
        assert!(bits <= 32);
        if bits == 0 {
            return;
        }
        self.acc |= ((v as u64) & ((1u64 << bits) - 1)) << self.n;
        self.n += bits;
        while self.n >= 8 {
            self.bytes.push(self.acc as u8);
            self.acc >>= 8;
            self.n -= 8;
        }
    }
    pub fn finish(mut self) -> Vec<u8> {
        if self.n > 0 {
            self.bytes.push(self.acc as u8);
        }
        self.bytes
    }
}

fn chance(rng: &mut Rng, percent: u64) -> bool {
    rng.below(100) < percent
}

fn pick<T: Copy>(rng: &mut Rng, v: &[T]) -> T {
    v[rng.below(v.len() as u64) as usize]
}

#[derive(Clone)]
struct Code {
    lengths: Vec<u8>,
    codes: Vec<u32>,
    symbols: Vec<usize>,
}

/// The depths of the leaves of a random binary tree.
fn tree_depths(rng: &mut Rng, n: usize, max_len: u8) -> Vec<u8> {
    if n == 1 {
        return vec![rng.range(1, max_len as i64) as u8];
    }
    let style = rng.below(3);
    let mut leaves = vec![0u8];
    while leaves.len() < n {
        let candidates: Vec<usize> = (0..leaves.len()).filter(|&i| leaves[i] < max_len).collect();
        let i = match style {
            0 => pick(rng, &candidates),
            1 => *candidates.iter().max_by_key(|&&i| leaves[i]).unwrap(),
            _ => *candidates.iter().min_by_key(|&&i| leaves[i]).unwrap(),
        };
        leaves[i] += 1;
        let d = leaves[i];
        leaves.push(d);
    }
    for i in (1..leaves.len()).rev() {
        leaves.swap(i, rng.below(i as u64 + 1) as usize);
    }
    leaves
}

fn make_code(lengths: Vec<u8>) -> Code {
    let symbols: Vec<usize> = (0..lengths.len()).filter(|&s| lengths[s] > 0).collect();
    let mut codes = vec![0u32; lengths.len()];
    let mut next = 0u32;
    for len in 1..=15u8 {
        for &s in &symbols {
            if lengths[s] == len {
                codes[s] = next.reverse_bits() >> (32 - len as u32);
                next += 1;
            }
        }
        next <<= 1;
    }
    Code { lengths, codes, symbols }
}

fn random_code(rng: &mut Rng, alphabet: usize, mut symbols: Vec<usize>, max_len: u8) -> Code {
    symbols.sort();
    symbols.dedup();
    let depths = tree_depths(rng, symbols.len(), max_len);
    let mut lengths = vec![0u8; alphabet];
    for (&s, d) in symbols.iter().zip(depths) {
        lengths[s] = d;
    }
    make_code(lengths)
}

fn emit(w: &mut BitWriter, code: &Code, symbol: usize) {
    if code.symbols.len() > 1 {
        w.put(code.codes[symbol], code.lengths[symbol] as u32);
    }
}

const ORDER: [usize; 19] = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

fn write_code(w: &mut BitWriter, rng: &mut Rng, code: &Code, broken: bool) {
    let n = code.symbols.len();
    let simple_ok = n <= 2 && code.symbols.iter().all(|&s| s < 256) && (n == 1 || code.symbols.iter().all(|&s| code.lengths[s] == 1));
    if simple_ok && chance(rng, 70) {
        w.put(1, 1);
        // One symbol may also be written twice.
        let twice = n == 1 && chance(rng, 10);
        w.put((n == 2 || twice) as u32, 1);
        let (a, b) = if n == 2 && chance(rng, 50) { (code.symbols[1], code.symbols[0]) } else { (code.symbols[0], code.symbols[n - 1]) };
        if a < 2 && chance(rng, 70) {
            w.put(0, 1);
            w.put(a as u32, 1);
        } else {
            w.put(1, 1);
            w.put(a as u32, 8);
        }
        if n == 2 || twice {
            w.put(b as u32, 8);
        }
        return;
    }
    let mut lengths = code.lengths.clone();
    if broken {
        let i = rng.below(lengths.len() as u64) as usize;
        lengths[i] = rng.below(16) as u8;
    }
    // (token, extra bits value, extra bits count)
    let mut tokens: Vec<(usize, u32, u32)> = vec![];
    let use_rle = chance(rng, 80);
    let mut prev = 8u8;
    let mut i = 0;
    while i < lengths.len() {
        let l = lengths[i];
        let mut run = 1;
        while i + run < lengths.len() && lengths[i + run] == l {
            run += 1;
        }
        if use_rle && l == 0 && run >= 3 && chance(rng, 90) {
            if run >= 11 && chance(rng, 80) {
                let r = run.min(138).min(rng.range(11, 138) as usize).max(11);
                tokens.push((18, (r - 11) as u32, 7));
                i += r;
            } else {
                let r = run.min(10).min(rng.range(3, 10) as usize);
                tokens.push((17, (r - 3) as u32, 3));
                i += r;
            }
        } else if use_rle && l != 0 && l == prev && run >= 3 && chance(rng, 90) {
            let r = run.min(6).min(rng.range(3, 6) as usize);
            tokens.push((16, (r - 3) as u32, 2));
            i += r;
        } else {
            tokens.push((l as usize, 0, 0));
            if l != 0 {
                prev = l;
            }
            i += 1;
        }
    }
    let mut max_symbol = None;
    if chance(rng, 40) {
        while tokens.len() > 2 && matches!(tokens.last(), Some(&(0 | 17 | 18, _, _))) {
            tokens.pop();
        }
        if tokens.len() >= 2 {
            max_symbol = Some(tokens.len());
        }
    }
    if broken && chance(rng, 30) {
        // A repeat that may go over the end, or come first.
        let at = if chance(rng, 50) { 0 } else { tokens.len() };
        let t = pick(rng, &[(16usize, 2u32), (17, 3), (18, 7)]);
        tokens.insert(at, (t.0, rng.next() as u32 & ((1 << t.1) - 1), t.1));
        if let Some(m) = &mut max_symbol {
            *m += 1;
        }
    }
    let mut needed: Vec<usize> = tokens.iter().map(|t| t.0).collect();
    for _ in 0..rng.below(4) {
        needed.push(rng.below(19) as usize);
    }
    let mut cl = random_code(rng, 19, needed, 7);
    if broken && chance(rng, 30) {
        let i = rng.below(19) as usize;
        cl.lengths[i] = rng.below(8) as u8;
    }
    w.put(0, 1);
    let last = (0..19).rev().find(|&i| cl.lengths[ORDER[i]] != 0).unwrap_or(0);
    let num_codes = (last + 1).max(4).max(if chance(rng, 20) { rng.range(4, 19) as usize } else { 0 });
    w.put(num_codes as u32 - 4, 4);
    for &o in &ORDER[..num_codes] {
        w.put(cl.lengths[o] as u32, 3);
    }
    match max_symbol {
        Some(m) => {
            w.put(1, 1);
            let m = if broken && chance(rng, 20) { rng.below(70000) as usize + 2 } else { m };
            let need = 32 - (m as u32 - 2).leading_zeros();
            let k = (need.max(2) - 2).div_ceil(2).min(7);
            let k = if chance(rng, 30) { rng.range(k as i64, 7) as u32 } else { k };
            w.put(k, 3);
            w.put(m as u32 - 2, 2 + 2 * k);
        }
        None => w.put(0, 1),
    }
    for &(t, extra, bits) in &tokens {
        emit(w, &cl, t);
        w.put(extra, bits);
    }
}

fn subsample(size: usize, bits: u32) -> usize {
    (size + (1 << bits) - 1) >> bits
}

const CODE_TO_PLANE: [u8; 120] = [
    0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a, 0x26, 0x2a, 0x38, 0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a,
    0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35, 0x3b, 0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c, 0x03,
    0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c, 0x55, 0x5b, 0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e,
    0x66, 0x6a, 0x22, 0x2e, 0x54, 0x5c, 0x43, 0x4d, 0x65, 0x6b, 0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d, 0x11, 0x1f,
    0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b, 0x31, 0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41,
    0x4f, 0x10, 0x20, 0x62, 0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f, 0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71, 0x7f, 0x60, 0x70,
];

fn plane_distance(xsize: usize, code: usize) -> usize {
    if code > 120 {
        return code - 120;
    }
    let c = CODE_TO_PLANE[code - 1] as i64;
    ((c >> 4) * xsize as i64 + 8 - (c & 0xf)).max(1) as usize
}

/// (value, extra bits value, extra bits count) of a random length or distance with this prefix symbol.
fn prefix_value(rng: &mut Rng, symbol: usize) -> (usize, u32, u32) {
    if symbol < 4 {
        return (symbol + 1, 0, 0);
    }
    let bits = ((symbol - 2) >> 1) as u32;
    let extra = match rng.below(4) {
        0 => 0,
        1 => (1 << bits) - 1,
        _ => rng.next() as u32 & ((1 << bits) - 1),
    };
    (((2 + (symbol & 1)) << bits) + extra as usize + 1, extra, bits)
}

fn subset(rng: &mut Rng, lo: usize, hi: usize, count: usize) -> Vec<usize> {
    (0..count).map(|_| rng.range(lo as i64, hi as i64 - 1) as usize).collect()
}

#[derive(Clone, Copy, Default)]
pub struct Opts {
    /// Red, blue and alpha have one symbol, and there is no colour cache.
    pub green_only: bool,
    /// How likely something invalid is, in percent.
    pub broken: u64,
}

fn channel_count(rng: &mut Rng) -> usize {
    match rng.below(8) {
        0 | 1 => 1,
        2 => 2,
        3 => rng.range(3, 4) as usize,
        4 | 5 => rng.range(3, 20) as usize,
        6 => rng.range(20, 120) as usize,
        _ => rng.range(120, 400) as usize,
    }
}

/// The colour cache bit, the meta codes and the pixels. With `pixels`, these are coded as literals.
fn entropy_image(w: &mut BitWriter, rng: &mut Rng, xs: usize, ys: usize, level0: bool, pixels: Option<&[u32]>, o: Opts) {
    let mut cache_bits = 0;
    if !o.green_only && pixels.is_none() && chance(rng, 35) {
        cache_bits = rng.range(1, 11) as u32;
        if chance(rng, o.broken) {
            cache_bits = pick(rng, &[0, 12, 13, 15]);
        }
        w.put(1, 1);
        w.put(cache_bits, 4);
        if !(1..=11).contains(&cache_bits) {
            cache_bits = 0;
        }
    } else {
        w.put(0, 1);
    }

    let mut meta_bits = 0;
    let mut meta: Vec<u32> = vec![];
    let mut num_groups = 1;
    if level0 {
        if chance(rng, 45) {
            w.put(1, 1);
            meta_bits = rng.range(2, 9) as u32;
            w.put(meta_bits - 2, 3);
            let (mx, my) = (subsample(xs, meta_bits), subsample(ys, meta_bits));
            let top = match rng.below(12) {
                0 => 1,
                1..=6 => rng.range(1, 6),
                7..=9 => rng.range(1, 40),
                10 => rng.range(1, 300),
                _ => rng.range(900, 2500),
            } as u64;
            meta = (0..mx * my).map(|_| rng.below(top) as u32).collect();
            num_groups = *meta.iter().max().unwrap() as usize + 1;
            let argb: Vec<u32> = meta.iter().map(|&g| (g << 8) | (rng.next() as u32 & 0xff0000ff)).collect();
            entropy_image(w, rng, mx, my, false, Some(&argb), Opts { green_only: false, ..o });
        } else {
            w.put(0, 1);
        }
    }

    let simple_groups = num_groups > 60;
    let mut groups: Vec<[Code; 5]> = vec![];
    for _ in 0..num_groups {
        let mut sym: [Vec<usize>; 5] = Default::default();
        if let Some(p) = pixels {
            for &argb in p {
                sym[0].push((argb >> 8 & 0xff) as usize);
                sym[1].push((argb >> 16 & 0xff) as usize);
                sym[2].push((argb & 0xff) as usize);
                sym[3].push((argb >> 24) as usize);
            }
            sym[4].push(rng.below(40) as usize);
        } else {
            let n = if simple_groups { rng.range(1, 2) as usize } else { channel_count(rng) };
            sym[0] = subset(rng, 0, 256, n);
            if !chance(rng, 30) {
                let n = rng.range(1, if simple_groups { 1 } else { 8 }) as usize;
                let hi = pick(rng, &[4usize, 8, 12, 24]);
                sym[0].extend(subset(rng, 256, 256 + hi, n));
            }
            if cache_bits > 0 && !chance(rng, 20) {
                let n = rng.range(1, if simple_groups { 1 } else { 30 }) as usize;
                sym[0].extend(subset(rng, 280, 280 + (1 << cache_bits), n));
            }
            // Rarely, no literal at all.
            if chance(rng, 2) && sym[0].iter().any(|&s| s >= 256) {
                sym[0].retain(|&s| s >= 256);
            }
            for s in &mut sym[1..4] {
                let n = if o.green_only || simple_groups { 1 } else { channel_count(rng) };
                *s = subset(rng, 0, 256, n);
            }
            let hi = pick(rng, &[1usize, 4, 10, 16, 40]);
            let n = rng.range(1, 10) as usize;
            sym[4] = subset(rng, 0, hi, n);
        }
        let short = chance(rng, 30);
        let codes: Vec<Code> = (0..5)
            .map(|j| {
                let alphabet = [280 + if cache_bits > 0 { 1 << cache_bits } else { 0 }, 256, 256, 256, 40][j];
                let mut s = std::mem::take(&mut sym[j]);
                if short && pixels.is_none() {
                    s.sort();
                    s.dedup();
                    s.truncate(2);
                }
                random_code(rng, alphabet, s, 15)
            })
            .collect();
        for c in &codes {
            let broken = chance(rng, o.broken) && chance(rng, 20);
            write_code(w, rng, c, broken);
        }
        groups.push(codes.try_into().ok().unwrap());
    }

    let n = xs * ys;
    let mx = subsample(xs, meta_bits);
    let mut pos = 0;
    while pos < n {
        let (x, y) = (pos % xs, pos / xs);
        let g = &groups[if meta_bits == 0 { 0 } else { meta[(y >> meta_bits) * mx + (x >> meta_bits)] as usize }];
        if let Some(p) = pixels {
            let argb = p[pos];
            emit(w, &g[0], (argb >> 8 & 0xff) as usize);
            emit(w, &g[1], (argb >> 16 & 0xff) as usize);
            emit(w, &g[2], (argb & 0xff) as usize);
            emit(w, &g[3], (argb >> 24) as usize);
            pos += 1;
            continue;
        }
        let allow_bad = chance(rng, o.broken) && chance(rng, 3);
        for attempt in 0.. {
            let mut s = pick(rng, &g[0].symbols);
            if attempt >= 12 {
                // Whatever is left: a literal if there is one.
                s = g[0].symbols[0];
            }
            if s < 256 {
                emit(w, &g[0], s);
                for c in &g[1..4] {
                    let s = pick(rng, &c.symbols);
                    emit(w, c, s);
                }
                pos += 1;
            } else if s < 280 {
                let (len, le, lb) = prefix_value(rng, s - 256);
                let ds = pick(rng, &g[4].symbols);
                let (dc, de, db) = prefix_value(rng, ds);
                let dist = plane_distance(xs, dc);
                if (dist > pos || pos + len > n) && !allow_bad && attempt < 12 {
                    continue;
                }
                emit(w, &g[0], s);
                w.put(le, lb);
                emit(w, &g[4], ds);
                w.put(de, db);
                pos += len;
            } else {
                emit(w, &g[0], s);
                pos += 1;
            }
            break;
        }
    }
}

/// The transforms and the image, i.e. the bitstream without its 5 bytes of header.
pub fn stream(w: &mut BitWriter, rng: &mut Rng, width: usize, height: usize, mut o: Opts) {
    let mut xs = width;
    let mut kinds = vec![0u32, 1, 2, 3];
    for i in (1..4).rev() {
        kinds.swap(i, rng.below(i as u64 + 1) as usize);
    }
    kinds.truncate(pick(rng, &[0usize, 1, 1, 2, 2, 3, 4]));
    if o.green_only {
        kinds = vec![3];
    }
    if chance(rng, o.broken) && chance(rng, 10) && !kinds.is_empty() {
        let k = pick(rng, &kinds);
        kinds.push(k);
    }
    for kind in kinds {
        w.put(1, 1);
        w.put(kind, 2);
        let sub = Opts { green_only: false, ..o };
        match kind {
            0 | 1 => {
                let bits = rng.range(2, 9) as u32;
                w.put(bits - 2, 3);
                entropy_image(w, rng, subsample(xs, bits), subsample(height, bits), false, None, sub);
            }
            3 => {
                let n = match rng.below(3) {
                    0 => pick(rng, &[1usize, 2, 3, 4, 5, 16, 17, 256]),
                    1 => rng.range(1, 20) as usize,
                    _ => rng.range(1, 256) as usize,
                };
                w.put(n as u32 - 1, 8);
                entropy_image(w, rng, n, 1, false, None, sub);
                xs = subsample(xs, if n > 16 { 0 } else if n > 4 { 1 } else if n > 2 { 2 } else { 3 });
            }
            _ => {}
        }
    }
    w.put(0, 1);
    if o.green_only && chance(rng, 10) {
        o.green_only = false;
    }
    entropy_image(w, rng, xs, height, true, None, o);
}

pub fn size(rng: &mut Rng) -> (usize, usize) {
    match rng.below(40) {
        0 => (1, 1),
        1 | 2 => (rng.range(1, 600) as usize, 1),
        3 | 4 => (1, rng.range(1, 600) as usize),
        5 => (pick(rng, &[16383usize, 16384, 8191, 4097]), rng.range(1, 2) as usize),
        6 => (rng.range(1, 2) as usize, pick(rng, &[16383usize, 16384, 8191, 4097])),
        7..=14 => (rng.range(1, 9) as usize, rng.range(1, 9) as usize),
        15..=17 => (rng.range(1, 9) as usize, rng.range(1, 100) as usize),
        18..=20 => (rng.range(1, 100) as usize, rng.range(1, 40) as usize),
        21 => (rng.range(100, 400) as usize, rng.range(17, 120) as usize),
        _ => (rng.range(1, 40) as usize, rng.range(1, 40) as usize),
    }
}

fn tail(rng: &mut Rng, bytes: &mut Vec<u8>) {
    match rng.below(4) {
        0 => {}
        1 => bytes.push(rng.next() as u8),
        _ => {
            for _ in 0..rng.below(12) {
                bytes.push(rng.next() as u8);
            }
        }
    }
}

/// A whole lossless file.
pub fn file(rng: &mut Rng) -> Vec<u8> {
    let (width, height) = size(rng);
    let o = Opts { green_only: chance(rng, 5), broken: pick(rng, &[0, 0, 0, 5, 30]) };
    let mut w = BitWriter::new();
    w.put(0x2f, 8);
    w.put(width as u32 - 1, 14);
    w.put(height as u32 - 1, 14);
    w.put(rng.below(2) as u32, 1);
    w.put(0, 3);
    stream(&mut w, rng, width, height, o);
    let mut payload = w.finish();
    tail(rng, &mut payload);
    if chance(rng, 3) && payload.len() >= 12 {
        return payload;
    }
    let mut out = b"RIFF\0\0\0\0WEBPVP8L".to_vec();
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(&payload);
    if payload.len() & 1 == 1 {
        out.push(0);
    }
    let riff = (out.len() - 8) as u32;
    out[4..8].copy_from_slice(&riff.to_le_bytes());
    out
}

/// The payload of an ALPH chunk.
pub fn alpha_payload(rng: &mut Rng, width: usize, height: usize) -> Vec<u8> {
    let mut header = (rng.below(4) << 2 | rng.below(2) << 4) as u8;
    if chance(rng, 2) {
        header |= (rng.next() as u8) & 0xe2;
    }
    if chance(rng, 8) {
        let mut out = vec![header & !3];
        let n = width * height;
        let n = match rng.below(10) {
            0 => n.saturating_sub(1),
            1 => n + 1,
            2 => rng.below(n as u64 + 1) as usize,
            _ => n,
        };
        out.extend((0..n).map(|_| rng.next() as u8));
        return out;
    }
    let o = Opts { green_only: chance(rng, 65), broken: pick(rng, &[0, 0, 0, 5, 30]) };
    let mut w = BitWriter::new();
    w.put((header | 1) as u32, 8);
    stream(&mut w, rng, width, height, o);
    let mut out = w.finish();
    tail(rng, &mut out);
    out
}

fn riff(payload: Vec<u8>) -> Vec<u8> {
    let mut out = b"RIFF\0\0\0\0WEBPVP8L".to_vec();
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(&payload);
    if payload.len() & 1 == 1 {
        out.push(0);
    }
    let riff = (out.len() - 8) as u32;
    out[4..8].copy_from_slice(&riff.to_le_bytes());
    out
}

fn simple1(w: &mut BitWriter, symbol: u32) {
    w.put(1, 1);
    w.put(0, 1);
    w.put(1, 1);
    w.put(symbol, 8);
}

fn simple2(w: &mut BitWriter, a: u32, b: u32) {
    w.put(1, 1);
    w.put(1, 1);
    w.put(1, 1);
    w.put(a, 8);
    w.put(b, 8);
}

/// For benchmarks: one transform whose data is the same everywhere, and pixels of 4 bits each.
/// kind 0: predictor `value`; kind 1: cross colour with all multipliers `value`; kind 2: subtract green;
/// kind 3: a palette of `value` colours.
pub fn transform_file(rng: &mut Rng, kind: u32, value: u32, width: usize, height: usize) -> Vec<u8> {
    let mut w = BitWriter::new();
    w.put(0x2f, 8);
    w.put(width as u32 - 1, 14);
    w.put(height as u32 - 1, 14);
    w.put(1, 1);
    w.put(0, 3);
    w.put(1, 1);
    w.put(kind, 2);
    let mut xs = width;
    match kind {
        0 | 1 => {
            w.put(3, 3);
            w.put(0, 1);
            let other = if kind == 1 { value } else { 0 };
            for s in [value, other, other, 255, 0] {
                simple1(&mut w, s);
            }
        }
        3 => {
            w.put(value - 1, 8);
            w.put(0, 1);
            for s in [3, 5, 7, 0, 0] {
                simple1(&mut w, s);
            }
            xs = subsample(xs, if value > 16 { 0 } else if value > 4 { 1 } else if value > 2 { 2 } else { 3 });
        }
        _ => {}
    }
    w.put(0, 1);
    w.put(0, 1);
    w.put(0, 1);
    simple2(&mut w, 1, 250);
    simple2(&mut w, 2, 253);
    simple2(&mut w, 0, 5);
    simple2(&mut w, 0, 255);
    simple1(&mut w, 0);
    for _ in 0..xs * height {
        w.put(rng.next() as u32, 4);
    }
    riff(w.finish())
}

/// (symbol, extra bits value, extra bits count) of a length or a distance code.
fn prefix_encode(value: usize) -> (usize, u32, u32) {
    if value <= 4 {
        return (value - 1, 0, 0);
    }
    let v = value - 1;
    let high = usize::BITS - 1 - v.leading_zeros();
    let second = (v >> (high - 1)) & 1;
    let bits = high - 1;
    (2 * high as usize + second, (v & ((1 << bits) - 1)) as u32, bits)
}

/// For benchmarks: no transform; a row of literals, then only backward references of this distance and length.
pub fn backref_file(rng: &mut Rng, dist: usize, len: usize, width: usize, height: usize) -> Vec<u8> {
    let mut w = BitWriter::new();
    w.put(0x2f, 8);
    w.put(width as u32 - 1, 14);
    w.put(height as u32 - 1, 14);
    w.put(1, 1);
    w.put(0, 3);
    w.put(0, 1);
    w.put(0, 1);
    w.put(0, 1);
    let (ls, le, lb) = prefix_encode(len);
    let (ds, de, db) = prefix_encode(dist + 120);
    let mut lengths = vec![0u8; 280];
    lengths[3] = 2;
    lengths[200] = 2;
    lengths[256 + ls] = 1;
    let green = make_code(lengths);
    let mut quiet = Rng(1);
    write_code(&mut w, &mut quiet, &green, false);
    simple2(&mut w, 2, 253);
    simple2(&mut w, 0, 5);
    simple1(&mut w, 255);
    simple1(&mut w, ds as u32);
    let n = width * height;
    let mut pos = 0;
    while pos < n {
        if pos < 2 * width || pos + len > n {
            emit(&mut w, &green, if rng.below(2) == 0 { 3 } else { 200 });
            w.put(rng.next() as u32, 2);
            pos += 1;
        } else {
            emit(&mut w, &green, 256 + ls);
            w.put(le, lb);
            w.put(de, db);
            pos += len;
        }
    }
    riff(w.finish())
}

/// A few dozen bytes that make a large image: every code has a single symbol, so that no pixel takes any bit.
pub fn tiny_file(width: usize, height: usize, mode: u32) -> Vec<u8> {
    let mut w = BitWriter::new();
    w.put(0x2f, 8);
    w.put(width as u32 - 1, 14);
    w.put(height as u32 - 1, 14);
    w.put(1, 1);
    w.put(0, 3);
    w.put(1, 1);
    w.put(2, 2);
    for (kind, value) in [(0, mode), (1, 77)] {
        w.put(1, 1);
        w.put(kind, 2);
        w.put(0, 3);
        w.put(0, 1);
        let other = if kind == 1 { value } else { 0 };
        for s in [value, other, other, 255, 0] {
            simple1(&mut w, s);
        }
    }
    w.put(0, 1);
    w.put(0, 1);
    w.put(0, 1);
    for s in [3, 250, 7, 1, 0] {
        simple1(&mut w, s);
    }
    riff(w.finish())
}
