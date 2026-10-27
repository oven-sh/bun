//! Deterministic synthetic RGBA images.

#[derive(Clone)]
pub struct Rng(pub u64);
impl Rng {
    pub fn next(&mut self) -> u64 {
        // splitmix64
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    pub fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    pub fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + self.below((hi - lo + 1) as u64) as i64
    }
}

pub struct Image {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
    pub desc: String,
}

pub const COLOR_KINDS: u64 = 10;
pub const ALPHA_KINDS: u64 = 8;

fn size(rng: &mut Rng) -> (u32, u32) {
    match rng.below(12) {
        0 => (1, 1),
        1 => (rng.range(1, 400) as u32, 1),
        2 => (1, rng.range(1, 400) as u32),
        3 => (rng.range(1, 8) as u32, rng.range(1, 8) as u32),
        4 | 5 => (rng.range(1, 40) as u32, rng.range(1, 40) as u32),
        6 => (16 * rng.range(1, 10) as u32, 16 * rng.range(1, 10) as u32),
        7 => (rng.range(200, 700) as u32, rng.range(200, 700) as u32),
        _ => (rng.range(1, 200) as u32, rng.range(1, 200) as u32),
    }
}

pub fn synth(seed: u64) -> Image {
    let mut rng = Rng(seed);
    let (w, h) = size(&mut rng);
    let ck = rng.below(COLOR_KINDS);
    let ak = rng.below(ALPHA_KINDS);
    synth_kind(&mut rng, w, h, ck, ak)
}

pub fn synth_kind(rng: &mut Rng, w: u32, h: u32, ck: u64, ak: u64) -> Image {
    let (wu, hu) = (w as usize, h as usize);
    let mut rgba = vec![0u8; wu * hu * 4];
    let f: Vec<f64> = (0..12).map(|_| rng.range(1, 1000) as f64 / 4000.0).collect();
    let base: Vec<u8> = (0..4).map(|_| rng.next() as u8).collect();
    let ncol = [2u64, 3, 4, 5, 16, 17, 40, 200, 256, 300][rng.below(10) as usize];
    let pal: Vec<[u8; 3]> = (0..ncol).map(|_| [rng.next() as u8, rng.next() as u8, rng.next() as u8]).collect();
    let tile = rng.range(2, 24) as usize;
    let tiles: Vec<[u8; 3]> = (0..tile * tile).map(|_| [rng.next() as u8, rng.next() as u8, rng.next() as u8]).collect();
    let amp = rng.range(1, 40) as f64;
    for y in 0..hu {
        for x in 0..wu {
            let (xf, yf) = (x as f64, y as f64);
            let wave = |a: usize| 127.5 + 127.5 * ((xf * f[a]).sin() * (yf * f[a + 1]).cos());
            let px: [u8; 3] = match ck {
                0 => [base[0], base[1], base[2]],
                1 => [(x * 255 / wu.max(1)) as u8, (y * 255 / hu.max(1)) as u8, ((x + y) * 255 / (wu + hu)) as u8],
                2 => [rng.next() as u8, rng.next() as u8, rng.next() as u8],
                3 => [wave(0) as u8, wave(2) as u8, wave(4) as u8],
                4 => pal[rng.below(ncol) as usize],
                5 => pal[((wave(0) + wave(2)) / 512.0 * ncol as f64) as usize % ncol as usize],
                6 => {
                    let n = |r: &mut Rng| (r.below(1000) as f64 / 1000.0 - 0.5) * amp;
                    let c = |v: f64| v.clamp(0.0, 255.0) as u8;
                    [c(wave(0) + n(rng)), c(wave(2) + n(rng)), c(wave(4) + n(rng))]
                }
                7 => tiles[(y % tile) * tile + x % tile],
                8 => {
                    let on = ((x / 3) ^ (y / 5)) & 1 == 0 || (x * 7 + y * 13) % 11 == 0;
                    if on { [0, 0, 0] } else { [255, 255, 255] }
                }
                _ => {
                    let g = wave(0) as u8;
                    [g, g, g]
                }
            };
            let a: u8 = match ak {
                0 | 1 | 2 => 255,
                3 => 0,
                4 => if (xf * f[6]).sin() + (yf * f[7]).cos() > 0.0 { 255 } else { 0 },
                5 => (x * 255 / wu.max(1)) as u8,
                6 => rng.next() as u8,
                _ => [0u8, 64, 128, 255][((wave(8)) / 64.0) as usize & 3],
            };
            let o = (y * wu + x) * 4;
            rgba[o..o + 3].copy_from_slice(&px);
            rgba[o + 3] = a;
        }
    }
    Image { w, h, rgba, desc: format!("synth {w}x{h} color={ck} alpha={ak}") }
}
