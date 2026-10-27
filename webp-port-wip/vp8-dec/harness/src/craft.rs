//! Makes lossy files the reference encoder never writes: the first partition of a real file is decoded and written
//! again with other header settings, or a whole frame is made up. The boolean coder here is the one of RFC 6386, written
//! independently of bun_webp.
use crate::images::Rng;

#[allow(dead_code)]
mod vp8 {
    #[path = "/root/ref/crate/src/vp8/common.rs"]
    pub mod common;
    #[path = "/root/ref/crate/src/vp8/tables.rs"]
    pub mod tables;
}
use vp8::tables::{BMODES_PROBA, COEFFS_UPDATE_PROBA};

struct Bd<'a> {
    data: &'a [u8],
    pos: usize,
    value: u32,
    range: u32,
    bit_count: u32,
}

impl<'a> Bd<'a> {
    fn new(data: &'a [u8]) -> Self {
        let b = |i: usize| data.get(i).copied().unwrap_or(0) as u32;
        Bd { data, pos: 2, value: (b(0) << 8) | b(1), range: 255, bit_count: 0 }
    }
    fn bit(&mut self, prob: u8) -> bool {
        let split = 1 + (((self.range - 1) * prob as u32) >> 8);
        let big = split << 8;
        let ret = self.value >= big;
        if ret {
            self.range -= split;
            self.value -= big;
        } else {
            self.range = split;
        }
        while self.range < 128 {
            self.value <<= 1;
            self.range <<= 1;
            self.bit_count += 1;
            if self.bit_count == 8 {
                self.bit_count = 0;
                self.value |= self.data.get(self.pos).copied().unwrap_or(0) as u32;
                self.pos += 1;
            }
        }
        ret
    }
    fn lit(&mut self, n: u32) -> u32 {
        (0..n).fold(0, |v, _| (v << 1) | self.bit(128) as u32)
    }
    fn flag(&mut self) -> bool {
        self.bit(128)
    }
    fn signed(&mut self, n: u32) -> i32 {
        let v = self.lit(n) as i32;
        if self.flag() { -v } else { v }
    }
    fn opt_signed(&mut self, n: u32) -> Option<i32> {
        self.flag().then(|| self.signed(n))
    }
}

pub struct Be {
    out: Vec<u8>,
    range: u32,
    bottom: u32,
    bit_count: i32,
}

impl Be {
    fn new() -> Self {
        Be { out: vec![], range: 255, bottom: 0, bit_count: 24 }
    }
    fn carry(&mut self) {
        for b in self.out.iter_mut().rev() {
            if *b == 255 {
                *b = 0;
            } else {
                *b += 1;
                break;
            }
        }
    }
    fn bit(&mut self, prob: u8, v: bool) {
        let split = 1 + (((self.range - 1) * prob as u32) >> 8);
        if v {
            self.bottom = self.bottom.wrapping_add(split);
            self.range -= split;
        } else {
            self.range = split;
        }
        while self.range < 128 {
            self.range <<= 1;
            if self.bottom & (1 << 31) != 0 {
                self.carry();
            }
            self.bottom <<= 1;
            self.bit_count -= 1;
            if self.bit_count == 0 {
                self.out.push((self.bottom >> 24) as u8);
                self.bottom &= (1 << 24) - 1;
                self.bit_count = 8;
            }
        }
    }
    fn lit(&mut self, n: u32, v: u32) {
        for i in (0..n).rev() {
            self.bit(128, (v >> i) & 1 != 0);
        }
    }
    fn flag(&mut self, v: bool) {
        self.bit(128, v);
    }
    fn signed(&mut self, n: u32, v: i32) {
        self.lit(n, v.unsigned_abs());
        self.flag(v < 0);
    }
    fn opt_signed(&mut self, n: u32, v: Option<i32>) {
        self.flag(v.is_some());
        if let Some(v) = v {
            self.signed(n, v);
        }
    }
    fn finish(mut self) -> Vec<u8> {
        let mut c = self.bit_count;
        let mut v = self.bottom;
        if v & (1u32 << (32 - c)) != 0 {
            self.carry();
        }
        v <<= c & 7;
        c >>= 3;
        for _ in 0..c {
            v <<= 8;
        }
        for _ in 0..4 {
            self.out.push((v >> 24) as u8);
            v <<= 8;
        }
        self.out
    }
}

#[derive(Clone)]
struct Header {
    color_space: bool,
    clamp: bool,
    seg_enabled: bool,
    update_map: bool,
    update_data: bool,
    absolute: bool,
    seg_quant: [Option<i32>; 4],
    seg_lf: [Option<i32>; 4],
    seg_probs: [Option<u8>; 3],
    simple: bool,
    level: u32,
    sharpness: u32,
    lf_delta: bool,
    lf_delta_update: bool,
    deltas: [Option<i32>; 8],
    log2_parts: u32,
    base_q: u32,
    dq: [Option<i32>; 5],
    refresh: bool,
    coeff_updates: Vec<Option<u8>>,
    skip_prob: Option<u8>,
}

impl Header {
    fn read(d: &mut Bd) -> Self {
        let color_space = d.flag();
        let clamp = d.flag();
        let seg_enabled = d.flag();
        let (mut update_map, mut update_data, mut absolute) = (false, false, false);
        let (mut seg_quant, mut seg_lf, mut seg_probs) = ([None; 4], [None; 4], [None; 3]);
        if seg_enabled {
            update_map = d.flag();
            update_data = d.flag();
            if update_data {
                absolute = d.flag();
                for q in &mut seg_quant { *q = d.opt_signed(7); }
                for q in &mut seg_lf { *q = d.opt_signed(6); }
            }
            if update_map {
                for p in &mut seg_probs { *p = d.flag().then(|| d.lit(8) as u8); }
            }
        }
        let simple = d.flag();
        let level = d.lit(6);
        let sharpness = d.lit(3);
        let lf_delta = d.flag();
        let mut lf_delta_update = false;
        let mut deltas = [None; 8];
        if lf_delta {
            lf_delta_update = d.flag();
            if lf_delta_update {
                for x in &mut deltas { *x = d.opt_signed(6); }
            }
        }
        let log2_parts = d.lit(2);
        let base_q = d.lit(7);
        let mut dq = [None; 5];
        for x in &mut dq { *x = d.opt_signed(4); }
        let refresh = d.flag();
        let coeff_updates = COEFFS_UPDATE_PROBA.as_flattened().as_flattened().as_flattened().iter()
            .map(|&p| d.bit(p).then(|| d.lit(8) as u8)).collect();
        let skip_prob = d.flag().then(|| d.lit(8) as u8);
        Header {
            color_space, clamp, seg_enabled, update_map, update_data, absolute, seg_quant, seg_lf, seg_probs, simple, level,
            sharpness, lf_delta, lf_delta_update, deltas, log2_parts, base_q, dq, refresh, coeff_updates, skip_prob,
        }
    }

    fn write(&self, e: &mut Be) {
        e.flag(self.color_space);
        e.flag(self.clamp);
        e.flag(self.seg_enabled);
        if self.seg_enabled {
            e.flag(self.update_map);
            e.flag(self.update_data);
            if self.update_data {
                e.flag(self.absolute);
                for &q in &self.seg_quant { e.opt_signed(7, q); }
                for &q in &self.seg_lf { e.opt_signed(6, q); }
            }
            if self.update_map {
                for &p in &self.seg_probs {
                    e.flag(p.is_some());
                    if let Some(p) = p { e.lit(8, p as u32); }
                }
            }
        }
        e.flag(self.simple);
        e.lit(6, self.level);
        e.lit(3, self.sharpness);
        e.flag(self.lf_delta);
        if self.lf_delta {
            e.flag(self.lf_delta_update);
            if self.lf_delta_update {
                for &x in &self.deltas { e.opt_signed(6, x); }
            }
        }
        e.lit(2, self.log2_parts);
        e.lit(7, self.base_q);
        for &x in &self.dq { e.opt_signed(4, x); }
        e.flag(self.refresh);
        for (&p, &u) in COEFFS_UPDATE_PROBA.as_flattened().as_flattened().as_flattened().iter().zip(&self.coeff_updates) {
            e.bit(p, u.is_some());
            if let Some(u) = u { e.lit(8, u as u32); }
        }
        e.flag(self.skip_prob.is_some());
        if let Some(p) = self.skip_prob { e.lit(8, p as u32); }
    }

    fn seg_tree_probs(&self) -> [u8; 3] {
        self.seg_probs.map(|p| p.unwrap_or(255))
    }

    /// `keep_content`: leave alone what the coefficients depend on.
    fn randomize(&mut self, rng: &mut Rng, keep_content: bool) {
        let opt = |rng: &mut Rng, max: i64| (rng.below(3) != 0).then(|| match rng.below(4) { 0 => max, 1 => -max, _ => rng.range(-max, max) } as i32);
        if rng.below(2) == 0 { self.color_space = rng.below(2) == 0; self.clamp = rng.below(2) == 0; }
        if rng.below(2) == 0 {
            self.seg_enabled = rng.below(4) != 0;
            self.update_map = rng.below(3) != 0;
            self.update_data = rng.below(4) != 0;
            self.absolute = rng.below(2) == 0;
            for q in &mut self.seg_quant {
                *q = opt(rng, 127);
                if self.absolute && rng.below(4) != 0 { *q = q.map(|v| v.abs()); }
            }
            for q in &mut self.seg_lf {
                *q = opt(rng, 63);
                if self.absolute && rng.below(4) != 0 { *q = q.map(|v| v.abs()); }
            }
            for p in &mut self.seg_probs { *p = (rng.below(3) != 0).then(|| rng.next() as u8); }
        }
        if rng.below(4) != 0 {
            self.simple = rng.below(2) == 0;
            self.level = match rng.below(5) { 0 => 0, 1 => 63, _ => rng.below(64) as u32 };
            self.sharpness = rng.below(8) as u32;
        }
        if rng.below(2) == 0 {
            self.lf_delta = rng.below(4) != 0;
            self.lf_delta_update = rng.below(4) != 0;
            for x in &mut self.deltas { *x = opt(rng, 63); }
        }
        if rng.below(2) == 0 {
            self.base_q = match rng.below(5) { 0 => 0, 1 => 127, _ => rng.below(128) as u32 };
            for x in &mut self.dq { *x = opt(rng, 15); }
        }
        self.refresh = rng.below(2) == 0;
        if !keep_content {
            let density = [0, 1, 20, 300][rng.below(4) as usize];
            for u in &mut self.coeff_updates {
                if rng.below(1000) < density { *u = Some(match rng.below(4) { 0 => 0, 1 => 255, _ => rng.next() as u8 }); }
            }
        }
    }
}

#[derive(Clone)]
struct Mb {
    segment: u8,
    skip: bool,
    /// 16x16 mode, or the sixteen 4x4 modes.
    ymode: Result<u8, [u8; 16]>,
    uvmode: u8,
}

// Modes are numbered as in libwebp's common_dec.h: DC 0, TM 1, VE 2, HE 3, RD 4, VR 5, LD 6, VL 7, HD 8, HU 9.
const BMODE_TREE: [i8; 18] = [0, 1, -1, 2, -2, 3, 4, 6, -3, 5, -4, -5, -6, 7, -7, 8, -8, -9];

fn read_bmode(d: &mut Bd, p: &[u8; 9]) -> u8 {
    let mut i = BMODE_TREE[d.bit(p[0]) as usize];
    while i > 0 {
        i = BMODE_TREE[2 * i as usize + d.bit(p[i as usize]) as usize];
    }
    (-i) as u8
}

fn write_bmode(e: &mut Be, p: &[u8; 9], mode: u8) {
    // The path to the leaf, by depth-first search.
    fn path(node: usize, mode: u8, acc: &mut Vec<(usize, bool)>) -> bool {
        for b in [false, true] {
            let next = BMODE_TREE[2 * node + b as usize];
            acc.push((node, b));
            let is_leaf = next < 0 || (next == 0 && node == 0 && !b);
            if is_leaf {
                if (-next) as u8 == mode { return true; }
            } else if path(next as usize, mode, acc) {
                return true;
            }
            acc.pop();
        }
        false
    }
    let mut acc = vec![];
    assert!(path(0, mode, &mut acc));
    for (node, b) in acc {
        e.bit(p[node], b);
    }
}

fn read_mbs(d: &mut Bd, h: &Header, mb_w: usize, mb_h: usize) -> Vec<Mb> {
    let sp = h.seg_tree_probs();
    let mut top = vec![0u8; 4 * mb_w];
    let mut out = vec![];
    for _ in 0..mb_h {
        let mut left = [0u8; 4];
        for x in 0..mb_w {
            let segment = if h.update_map {
                if !d.bit(sp[0]) { d.bit(sp[1]) as u8 } else { 2 + d.bit(sp[2]) as u8 }
            } else { 0 };
            let skip = h.skip_prob.is_some_and(|p| d.bit(p));
            let top = &mut top[4 * x..4 * x + 4];
            let ymode = if d.bit(145) {
                let m = if d.bit(156) { if d.bit(128) { 1 } else { 3 } } else if d.bit(163) { 2 } else { 0 };
                top.fill(m);
                left.fill(m);
                Ok(m)
            } else {
                let mut modes = [0u8; 16];
                for y in 0..4 {
                    for x in 0..4 {
                        let m = read_bmode(d, &BMODES_PROBA[top[x] as usize][left[y] as usize]);
                        top[x] = m;
                        left[y] = m;
                        modes[4 * y + x] = m;
                    }
                }
                Err(modes)
            };
            let uvmode = if !d.bit(142) { 0 } else if !d.bit(114) { 2 } else if d.bit(183) { 1 } else { 3 };
            out.push(Mb { segment, skip, ymode, uvmode });
        }
    }
    out
}

fn write_mbs(e: &mut Be, h: &Header, mb_w: usize, mbs: &[Mb]) {
    let sp = h.seg_tree_probs();
    let mut top = vec![0u8; 4 * mb_w];
    for row in mbs.chunks(mb_w) {
        let mut left = [0u8; 4];
        for (x, mb) in row.iter().enumerate() {
            if h.update_map {
                e.bit(sp[0], mb.segment >= 2);
                e.bit(sp[1 + (mb.segment >= 2) as usize], mb.segment & 1 != 0);
            }
            if let Some(p) = h.skip_prob { e.bit(p, mb.skip); }
            let top = &mut top[4 * x..4 * x + 4];
            e.bit(145, mb.ymode.is_ok());
            match mb.ymode {
                Ok(m) => {
                    e.bit(156, m == 1 || m == 3);
                    match m { 1 => e.bit(128, true), 3 => e.bit(128, false), 2 => e.bit(163, true), _ => e.bit(163, false) }
                    top.fill(m);
                    left.fill(m);
                }
                Err(modes) => for y in 0..4 {
                    for x in 0..4 {
                        let m = modes[4 * y + x];
                        write_bmode(e, &BMODES_PROBA[top[x] as usize][left[y] as usize], m);
                        top[x] = m;
                        left[y] = m;
                    }
                },
            }
            e.bit(142, mb.uvmode != 0);
            if mb.uvmode != 0 {
                e.bit(114, mb.uvmode != 2);
                if mb.uvmode != 2 { e.bit(183, mb.uvmode == 1); }
            }
        }
    }
}

fn find_vp8(file: &[u8]) -> Option<(usize, usize)> {
    let mut pos = 12;
    while pos + 8 <= file.len() {
        let size = u32::from_le_bytes(file[pos + 4..pos + 8].try_into().unwrap()) as usize;
        if &file[pos..pos + 4] == b"VP8 " {
            return Some((pos, size));
        }
        pos += 8 + size + (size & 1);
    }
    None
}

/// Makes the RIFF and `VP8 ` sizes agree with the length of the file.
pub fn fix_sizes(file: &mut Vec<u8>) {
    if file.len() < 20 { return; }
    if let Some((pos, _)) = find_vp8(file) {
        let size = file.len() - pos - 8;
        file[pos + 4..pos + 8].copy_from_slice(&(size as u32).to_le_bytes());
        if size & 1 != 0 { file.push(0); }
    }
    let riff = (file.len() - 8) as u32;
    file[4..8].copy_from_slice(&riff.to_le_bytes());
}

fn frame_bytes(rng: &mut Rng, w: usize, h: usize, part0: &[u8], rest: &[u8]) -> Vec<u8> {
    let profile = rng.below(4) as u32;
    let tag = (profile << 1) | (1 << 4) | ((part0.len() as u32) << 5);
    let mut f = tag.to_le_bytes()[..3].to_vec();
    f.extend([0x9d, 0x01, 0x2a]);
    f.extend(((w as u16) | ((rng.below(4) as u16) << 14)).to_le_bytes());
    f.extend(((h as u16) | ((rng.below(4) as u16) << 14)).to_le_bytes());
    f.extend(part0);
    f.extend(rest);
    f
}

/// `src` with other settings in the frame's headers.
fn transcode(rng: &mut Rng, src: &[u8]) -> Option<Vec<u8>> {
    let (pos, size) = find_vp8(src)?;
    let frame = src.get(pos + 8..pos + 8 + size)?;
    let part_len = (u32::from_le_bytes([frame[0], frame[1], frame[2], 0]) >> 5) as usize;
    let w = (u16::from_le_bytes([frame[6], frame[7]]) & 0x3fff) as usize;
    let h = (u16::from_le_bytes([frame[8], frame[9]]) & 0x3fff) as usize;
    let (mb_w, mb_h) = (w.div_ceil(16), h.div_ceil(16));
    let mut d = Bd::new(frame.get(10..10 + part_len)?);
    let mut hdr = Header::read(&mut d);
    let mut mbs = read_mbs(&mut d, &hdr, mb_w, mb_h);
    let had_skip = hdr.skip_prob.is_some();
    let keep_content = rng.below(4) != 0;
    hdr.randomize(rng, keep_content);
    for mb in &mut mbs {
        if rng.below(2) == 0 { mb.segment = rng.below(4) as u8; }
    }
    match rng.below(4) {
        // Macroblocks without coefficients then have to say so in the token partition, which they do not: garbage.
        0 => hdr.skip_prob = None,
        1 => hdr.skip_prob = Some(rng.next() as u8),
        _ => {}
    }
    if !had_skip {
        for mb in &mut mbs { mb.skip = false; }
    }
    let mut e = Be::new();
    hdr.write(&mut e);
    write_mbs(&mut e, &hdr, mb_w, &mbs);
    let part0 = e.finish();
    // Any size with the same number of macroblocks.
    let (mut nw, mut nh) = (w, h);
    let has_vp8x = &src[12..16] == b"VP8X";
    if rng.below(3) == 0 {
        nw = 16 * (mb_w - 1) + rng.range(1, 16) as usize;
        nh = 16 * (mb_h - 1) + rng.range(1, 16) as usize;
    }
    let frame = frame_bytes(rng, nw, nh, &part0, &frame[10 + part_len..]);
    let mut out = src[..pos + 8].to_vec();
    out.extend(frame);
    if has_vp8x {
        out[24..27].copy_from_slice(&((nw - 1) as u32).to_le_bytes()[..3]);
        out[27..30].copy_from_slice(&((nh - 1) as u32).to_le_bytes()[..3]);
    }
    fix_sizes(&mut out);
    Some(out)
}

fn noise(rng: &mut Rng, len: usize) -> Vec<u8> {
    // Bytes near 0 decode as runs of the likelier symbol, bytes near 255 as the unlikelier.
    let kind = rng.below(5);
    (0..len).map(|_| match kind {
        0 => rng.next() as u8,
        1 => (rng.next() as u8) & (rng.next() as u8),
        2 => (rng.next() as u8) | (rng.next() as u8),
        3 => if rng.below(8) == 0 { rng.next() as u8 } else { 0 },
        _ => if rng.below(8) == 0 { rng.next() as u8 } else { 255 },
    }).collect()
}

/// A frame that is made up from start to end.
fn random_frame(rng: &mut Rng) -> Vec<u8> {
    const SIDES: [usize; 14] = [1, 2, 3, 15, 16, 17, 18, 31, 32, 33, 47, 48, 49, 64];
    let side = |rng: &mut Rng| if rng.below(4) == 0 { rng.range(1, 150) as usize } else { SIDES[rng.below(14) as usize] };
    let (mut w, mut h) = (side(rng), side(rng));
    match rng.below(200) {
        0 => w = 16383,
        1 => h = 16383,
        2 => w = rng.range(1000, 16383) as usize,
        3 => h = rng.range(1000, 16383) as usize,
        _ => {}
    }
    if w > 1000 { h = h.min(40); }
    if h > 1000 { w = w.min(40); }
    let (mb_w, mb_h) = (w.div_ceil(16), h.div_ceil(16));
    let mut hdr = Header {
        color_space: false, clamp: false, seg_enabled: false, update_map: false, update_data: false, absolute: false,
        seg_quant: [None; 4], seg_lf: [None; 4], seg_probs: [None; 3], simple: false, level: 0, sharpness: 0, lf_delta: false,
        lf_delta_update: false, deltas: [None; 8], log2_parts: rng.below(4) as u32, base_q: rng.below(128) as u32, dq: [None; 5],
        refresh: false, coeff_updates: vec![None; 4 * 8 * 3 * 11], skip_prob: (rng.below(2) == 0).then(|| rng.next() as u8),
    };
    hdr.randomize(rng, false);
    let i4_share = rng.below(5);
    let skip_share = rng.below(5);
    let mbs: Vec<Mb> = (0..mb_w * mb_h).map(|_| Mb {
        segment: rng.below(4) as u8,
        skip: rng.below(4) < skip_share,
        ymode: if rng.below(4) < i4_share { Err(std::array::from_fn(|_| rng.below(10) as u8)) } else { Ok(rng.below(4) as u8) },
        uvmode: rng.below(4) as u8,
    }).collect();
    let mut e = Be::new();
    hdr.write(&mut e);
    write_mbs(&mut e, &hdr, mb_w, &mbs);
    let part0 = e.finish();
    let parts = 1usize << hdr.log2_parts;
    // About as much as the macroblocks take, sometimes less.
    let per_mb = [1, 8, 40, 200, 700][rng.below(5) as usize];
    let mut sizes = vec![];
    let mut data = vec![];
    for p in 0..parts {
        let rows = (mb_h + parts - 1 - p) / parts;
        let len = rows * mb_w * per_mb / [1, 1, 1, 2][rng.below(4) as usize] + rng.below(4) as usize;
        let bytes = noise(rng, len);
        if p + 1 < parts {
            let said = match rng.below(12) { 0 => 0, 1 => 0xff_ffff, 2 => len + 1, _ => len };
            sizes.extend(&(said as u32).to_le_bytes()[..3]);
        }
        data.extend(bytes);
    }
    sizes.extend(data);
    let frame = frame_bytes(rng, w, h, &part0, &sizes);
    let mut out = b"RIFF\0\0\0\0WEBPVP8 \0\0\0\0".to_vec();
    out.extend(frame);
    fix_sizes(&mut out);
    out
}

pub fn craft(rng: &mut Rng, src: &[u8]) -> Option<Vec<u8>> {
    let mut out = if rng.below(2) == 0 { random_frame(rng) } else { transcode(rng, src)? };
    // Cut off the end, with and without telling the headers.
    if rng.below(4) == 0 {
        let most = if rng.below(2) == 0 { 16 } else { 4000 };
        let cut = rng.below((out.len() as u64).min(most)) as usize;
        out.truncate(out.len() - cut);
        if rng.below(4) != 0 { fix_sizes(&mut out); }
    }
    Some(out)
}

/// `src` with the loop filter switched off, or made simple.
pub fn refilter(src: &[u8], level: Option<u32>, simple: bool) -> Option<Vec<u8>> {
    let (pos, size) = find_vp8(src)?;
    let frame = src.get(pos + 8..pos + 8 + size)?;
    let part_len = (u32::from_le_bytes([frame[0], frame[1], frame[2], 0]) >> 5) as usize;
    let w = (u16::from_le_bytes([frame[6], frame[7]]) & 0x3fff) as usize;
    let h = (u16::from_le_bytes([frame[8], frame[9]]) & 0x3fff) as usize;
    let (mb_w, mb_h) = (w.div_ceil(16), h.div_ceil(16));
    let mut d = Bd::new(frame.get(10..10 + part_len)?);
    let mut hdr = Header::read(&mut d);
    let mbs = read_mbs(&mut d, &hdr, mb_w, mb_h);
    if let Some(level) = level { hdr.level = level; }
    hdr.simple = simple;
    let mut e = Be::new();
    hdr.write(&mut e);
    write_mbs(&mut e, &hdr, mb_w, &mbs);
    let part0 = e.finish();
    let tag = (1u32 << 4) | ((part0.len() as u32) << 5);
    let mut out = src[..pos + 8].to_vec();
    out.extend(&tag.to_le_bytes()[..3]);
    out.extend(&frame[3..10]);
    out.extend(part0);
    out.extend(&frame[10 + part_len..]);
    fix_sizes(&mut out);
    Some(out)
}
