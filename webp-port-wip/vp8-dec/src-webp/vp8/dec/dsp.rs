//! `dsp/dec.c`: the inverse transforms, the intra predictions and the loop filters.

use crate::util::{Bug, Checked, SliceExt};
use crate::vp8::common::IntraMode;

/// The stride of the work buffer.
pub(super) const BPS: usize = 32;

/// The samples of one macroblock with those above and to the left of it, 4x4 blocks shown as one character:
/// ```text
///   .+------   one row
///   .|yyyyt.
///   .|yyyyt.
///   .|yyyyt.
///   .|yyyy..
///   .+--.+--   one row
///   .|uu.|vv
///   .|uu.|vv
/// ```
/// `|`, `-` and `+` are the left, top and top left samples, `t` the top right ones of the 4x4 blocks below them.
pub(super) type YuvB = [u8; YUV_SIZE];
pub(super) const YUV_SIZE: usize = BPS * 17 + BPS * 9;
pub(super) const Y_OFF: usize = BPS + 8;
pub(super) const U_OFF: usize = Y_OFF + BPS * 16 + BPS;
pub(super) const V_OFF: usize = U_OFF + 16;

#[inline(always)]
fn clip_8b(v: i32) -> u8 {
    v.clamp(0, 255) as u8
}

//------------------------------------------------------------------------------
// Transforms (paragraph 14.4)

/// Four rows of four samples in the work buffer, from the first sample to the last.
pub(super) type Block4 = [u8; 3 * BPS + 4];

// Coefficients that no encoder produces overflow these products in libwebp too.
#[inline(always)]
fn mul1(a: i32) -> i32 {
    (a.wrapping_mul(20091) >> 16) + a
}

#[inline(always)]
fn mul2(a: i32) -> i32 {
    a.wrapping_mul(35468) >> 16
}

#[inline(always)]
fn store(dst: &mut Block4, rows: [[i32; 4]; 4]) {
    for (dst, row) in dst.chunks_mut(BPS).zip(rows) {
        for (dst, v) in dst.iter_mut().zip(row) {
            *dst = clip_8b(i32::from(*dst) + (v >> 3));
        }
    }
}

#[inline(always)]
fn transform_1d(in0: i32, in1: i32, in2: i32, in3: i32) -> [i32; 4] {
    let a = in0 + in2;
    let b = in0 - in2;
    let c = mul2(in1) - mul1(in3);
    let d = mul1(in1) + mul2(in3);
    [a + d, b + c, b - c, a - d]
}

pub(super) fn transform_one(input: &[i16; 16], dst: &mut Block4) {
    let [
        i0,
        i1,
        i2,
        i3,
        i4,
        i5,
        i6,
        i7,
        i8,
        i9,
        i10,
        i11,
        i12,
        i13,
        i14,
        i15,
    ] = input.map(i32::from);
    let [a0, a1, a2, a3] = transform_1d(i0, i4, i8, i12);
    let [b0, b1, b2, b3] = transform_1d(i1, i5, i9, i13);
    let [c0, c1, c2, c3] = transform_1d(i2, i6, i10, i14);
    let [d0, d1, d2, d3] = transform_1d(i3, i7, i11, i15);
    store(
        dst,
        [
            transform_1d(a0 + 4, b0, c0, d0),
            transform_1d(a1 + 4, b1, c1, d1),
            transform_1d(a2 + 4, b2, c2, d2),
            transform_1d(a3 + 4, b3, c3, d3),
        ],
    );
}

/// When only `input[0]`, `input[1]` and `input[4]` are not zero.
pub(super) fn transform_ac3(input: &[i16; 16], dst: &mut Block4) {
    let a = i32::from(input[0]) + 4;
    let c4 = mul2(i32::from(input[4]));
    let d4 = mul1(i32::from(input[4]));
    let c1 = mul2(i32::from(input[1]));
    let d1 = mul1(i32::from(input[1]));
    store(
        dst,
        [a + d4, a + c4, a - c4, a - d4].map(|dc| [dc + d1, dc + c1, dc - c1, dc - d1]),
    );
}

pub(super) fn transform_dc(input: &[i16; 16], dst: &mut Block4) {
    store(dst, [[i32::from(input[0]) + 4; 4]; 4]);
}

/// Paragraph 14.3: from the block of the DCs to the DC of each of the 16 blocks of `out`.
pub(super) fn transform_wht(input: &[i16; 16], out: &mut [[i16; 16]]) {
    let [
        i0,
        i1,
        i2,
        i3,
        i4,
        i5,
        i6,
        i7,
        i8,
        i9,
        i10,
        i11,
        i12,
        i13,
        i14,
        i15,
    ] = input.map(i32::from);
    let vertical = |in0: i32, in4: i32, in8: i32, in12: i32| {
        let a0 = in0 + in12;
        let a1 = in4 + in8;
        let a2 = in4 - in8;
        let a3 = in0 - in12;
        [a0 + a1, a3 + a2, a0 - a1, a3 - a2]
    };
    let [a0, a1, a2, a3] = vertical(i0, i4, i8, i12);
    let [b0, b1, b2, b3] = vertical(i1, i5, i9, i13);
    let [c0, c1, c2, c3] = vertical(i2, i6, i10, i14);
    let [d0, d1, d2, d3] = vertical(i3, i7, i11, i15);
    let horizontal = |t0: i32, t1: i32, t2: i32, t3: i32| {
        let dc = t0 + 3;
        let a0 = dc + t3;
        let a1 = t1 + t2;
        let a2 = t1 - t2;
        let a3 = dc - t3;
        [a0 + a1, a3 + a2, a0 - a1, a3 - a2].map(|v| (v >> 3) as i16)
    };
    let dcs = [
        horizontal(a0, b0, c0, d0),
        horizontal(a1, b1, c1, d1),
        horizontal(a2, b2, c2, d2),
        horizontal(a3, b3, c3, d3),
    ];
    for (out, dc) in out.iter_mut().zip(dcs.as_flattened()) {
        out[0] = *dc;
    }
}

//------------------------------------------------------------------------------
// Intra predictions

/// Predicts the luma (`N` = 16) or one chroma plane (`N` = 8) of a macroblock, whose first sample is at `off`. Without
/// `has_top` or `has_left` the macroblock is on that edge of the image.
pub(super) fn predict_block<const N: usize>(
    mode: IntraMode,
    has_top: bool,
    has_left: bool,
    yuv_b: &mut YuvB,
    off: usize,
) -> Checked {
    let top: [u8; N] = *yuv_b.array_at(off - BPS)?;
    let top_left = i32::from(yuv_b.at(off - BPS - 1)?);
    let left = yuv_b.iter().skip(off - 1).step_by(BPS).take(N);
    let left_sum: u32 = left.map(|&v| u32::from(v)).sum();
    // Each starts with the sample to the left of the row.
    let rows = yuv_b.sub_mut(off - 1..)?.chunks_mut(BPS).take(N);
    let rows = rows.filter_map(|row| {
        let (left, row) = row.split_first_mut()?;
        Some((*left, row.first_chunk_mut::<N>()?))
    });
    match mode {
        IntraMode::Dc => {
            let shift = N.trailing_zeros();
            let top_sum: u32 = top.iter().map(|&v| u32::from(v)).sum();
            let dc = match (has_top, has_left) {
                (true, true) => (top_sum + left_sum + N as u32) >> (shift + 1),
                (true, false) => (top_sum + N as u32 / 2) >> shift,
                (false, true) => (left_sum + N as u32 / 2) >> shift,
                (false, false) => 0x80,
            };
            for (_, row) in rows {
                *row = [dc as u8; N];
            }
        }
        IntraMode::TrueMotion => {
            for (left, row) in rows {
                let delta = i32::from(left) - top_left;
                for (dst, &top) in row.iter_mut().zip(&top) {
                    *dst = clip_8b(i32::from(top) + delta);
                }
            }
        }
        IntraMode::Vertical => {
            for (_, row) in rows {
                *row = top;
            }
        }
        IntraMode::Horizontal => {
            for (left, row) in rows {
                *row = [left; N];
            }
        }
        _ => return Err(Bug),
    }
    Ok(())
}

/// A 4x4 block in the work buffer with its neighbours: it starts at the top left sample and ends at the last sample of
/// the block.
pub(super) type Luma4 = [u8; 4 * BPS + 5];

#[inline(always)]
fn avg2(a: u8, b: u8) -> u8 {
    ((u32::from(a) + u32::from(b) + 1) >> 1) as u8
}

#[inline(always)]
fn avg3(a: u8, b: u8, c: u8) -> u8 {
    ((u32::from(a) + 2 * u32::from(b) + u32::from(c) + 2) >> 2) as u8
}

pub(super) fn predict_luma4(mode: IntraMode, dst: &mut Luma4) {
    let [x, a, b, c, d, e, f, g, h] = [
        dst[0], dst[1], dst[2], dst[3], dst[4], dst[5], dst[6], dst[7], dst[8],
    ];
    let [i, j, k, l] = [dst[BPS], dst[2 * BPS], dst[3 * BPS], dst[4 * BPS]];
    let rows = match mode {
        IntraMode::Dc => {
            let sum: u32 = [a, b, c, d, i, j, k, l].iter().map(|&v| u32::from(v)).sum();
            [[((sum + 4) >> 3) as u8; 4]; 4]
        }
        IntraMode::TrueMotion => [i, j, k, l].map(|left| {
            [a, b, c, d].map(|top| clip_8b(i32::from(top) + i32::from(left) - i32::from(x)))
        }),
        IntraMode::Vertical => [[avg3(x, a, b), avg3(a, b, c), avg3(b, c, d), avg3(c, d, e)]; 4],
        IntraMode::Horizontal => [
            [avg3(x, i, j); 4],
            [avg3(i, j, k); 4],
            [avg3(j, k, l); 4],
            [avg3(k, l, l); 4],
        ],
        IntraMode::DownRight => {
            let [e0, e1, e2, e3, e4, e5, e6] = [
                avg3(j, k, l),
                avg3(i, j, k),
                avg3(x, i, j),
                avg3(a, x, i),
                avg3(b, a, x),
                avg3(c, b, a),
                avg3(d, c, b),
            ];
            [
                [e3, e4, e5, e6],
                [e2, e3, e4, e5],
                [e1, e2, e3, e4],
                [e0, e1, e2, e3],
            ]
        }
        IntraMode::DownLeft => {
            let [e0, e1, e2, e3, e4, e5, e6] = [
                avg3(a, b, c),
                avg3(b, c, d),
                avg3(c, d, e),
                avg3(d, e, f),
                avg3(e, f, g),
                avg3(f, g, h),
                avg3(g, h, h),
            ];
            [
                [e0, e1, e2, e3],
                [e1, e2, e3, e4],
                [e2, e3, e4, e5],
                [e3, e4, e5, e6],
            ]
        }
        IntraMode::VerticalRight => [
            [avg2(x, a), avg2(a, b), avg2(b, c), avg2(c, d)],
            [avg3(i, x, a), avg3(x, a, b), avg3(a, b, c), avg3(b, c, d)],
            [avg3(j, i, x), avg2(x, a), avg2(a, b), avg2(b, c)],
            [avg3(k, j, i), avg3(i, x, a), avg3(x, a, b), avg3(a, b, c)],
        ],
        IntraMode::VerticalLeft => [
            [avg2(a, b), avg2(b, c), avg2(c, d), avg2(d, e)],
            [avg3(a, b, c), avg3(b, c, d), avg3(c, d, e), avg3(d, e, f)],
            [avg2(b, c), avg2(c, d), avg2(d, e), avg3(e, f, g)],
            [avg3(b, c, d), avg3(c, d, e), avg3(d, e, f), avg3(f, g, h)],
        ],
        IntraMode::HorizontalUp => [
            [avg2(i, j), avg3(i, j, k), avg2(j, k), avg3(j, k, l)],
            [avg2(j, k), avg3(j, k, l), avg2(k, l), avg3(k, l, l)],
            [avg2(k, l), avg3(k, l, l), l, l],
            [l, l, l, l],
        ],
        IntraMode::HorizontalDown => [
            [avg2(i, x), avg3(i, x, a), avg3(x, a, b), avg3(a, b, c)],
            [avg2(j, i), avg3(j, i, x), avg2(i, x), avg3(i, x, a)],
            [avg2(k, j), avg3(k, j, i), avg2(j, i), avg3(j, i, x)],
            [avg2(l, k), avg3(l, k, j), avg2(k, j), avg3(k, j, i)],
        ],
    };
    for (dst, row) in dst.chunks_mut(BPS).skip(1).zip(rows) {
        for (dst, v) in dst.iter_mut().skip(1).zip(row) {
            *dst = v;
        }
    }
}

//------------------------------------------------------------------------------
// Edge filtering
//
// The arithmetic is in 8 bits with saturation and without branches, which gives the same results as libwebp's tables
// and compiles to vector instructions.

/// Sixteen samples next to each other along an edge: of one row for a horizontal edge, of one column for a vertical one.
type Line = [u8; 16];

#[inline(always)]
fn abs_diff(a: u8, b: u8) -> u8 {
    a.saturating_sub(b) | b.saturating_sub(a)
}

/// From 0..=255 to -128..=127.
#[inline(always)]
fn signed(v: u8) -> i8 {
    (v ^ 0x80) as i8
}

#[inline(always)]
fn unsigned(v: i8) -> u8 {
    v as u8 ^ 0x80
}

/// `4 * |p0 - q0| + |p1 - q1| <= 2 * thresh + 1`, for a `thresh` under 255: it is 193 at most.
#[inline(always)]
fn needs_filter(p1: u8, p0: u8, q0: u8, q1: u8, thresh: u8) -> bool {
    let d = abs_diff(p0, q0);
    d.saturating_add(d).saturating_add(abs_diff(p1, q1) >> 1) <= thresh
}

/// `3 * (q0 - p0) + outer`, clipped.
#[inline(always)]
fn base_delta(outer: i8, p0: i8, q0: i8) -> i8 {
    let d = q0.saturating_sub(p0);
    outer.saturating_add(d).saturating_add(d).saturating_add(d)
}

/// Paragraph 15.2. The lines are `p1`, `p0`, and on the other side of the edge `q0`, `q1`.
fn simple_filter(lines: &mut [Line; 4], thresh: u8) {
    let [p1, p0, q0, q1] = lines;
    for (((&p1, p0), q0), &q1) in p1.iter().zip(p0).zip(q0).zip(q1.iter()) {
        let mask = needs_filter(p1, *p0, *q0, q1, thresh);
        let (p0s, q0s) = (signed(*p0), signed(*q0));
        let a = base_delta(signed(p1).saturating_sub(signed(q1)), p0s, q0s);
        let a = if mask { a } else { 0 };
        *p0 = unsigned(p0s.saturating_add(a.saturating_add(3) >> 3));
        *q0 = unsigned(q0s.saturating_sub(a.saturating_add(4) >> 3));
    }
}

#[derive(Clone, Copy)]
pub(super) struct Thresholds {
    pub(super) thresh: u8,
    pub(super) ithresh: u8,
    pub(super) hev_thresh: u8,
}

/// Paragraph 15.3: `FilterLoop24` for an edge inside a macroblock, `FilterLoop26` for one between macroblocks. The lines
/// are `p3`, `p2`, `p1`, `p0`, and on the other side of the edge `q0`, `q1`, `q2`, `q3`.
fn complex_filter<const INNER: bool>(lines: &mut [Line; 8], t: Thresholds) {
    let [p3, p2, p1, p0, q0, q1, q2, q3] = lines;
    let lanes = p3.iter().zip(p2).zip(p1).zip(p0);
    let lanes = lanes.zip(q0).zip(q1).zip(q2).zip(q3.iter());
    for (((((((&p3, p2), p1), p0), q0), q1), q2), &q3) in lanes {
        let near = abs_diff(*p1, *p0).max(abs_diff(*q1, *q0));
        let far = abs_diff(p3, *p2).max(abs_diff(*p2, *p1));
        let far = far.max(abs_diff(q3, *q2)).max(abs_diff(*q2, *q1));
        let mask = needs_filter(*p1, *p0, *q0, *q1, t.thresh) & (near.max(far) <= t.ithresh);
        let hev = near > t.hev_thresh;
        let (p1s, p0s, q0s, q1s) = (signed(*p1), signed(*p0), signed(*q0), signed(*q1));
        let outer = p1s.saturating_sub(q1s);
        if INNER {
            // `DoFilter2` with high edge variance, else `DoFilter4`.
            let a = base_delta(if hev { outer } else { 0 }, p0s, q0s);
            let a = if mask { a } else { 0 };
            let a1 = a.saturating_add(4) >> 3;
            let a2 = a.saturating_add(3) >> 3;
            let a3 = if hev { 0 } else { (a1 + 1) >> 1 };
            *p1 = unsigned(p1s.saturating_add(a3));
            *p0 = unsigned(p0s.saturating_add(a2));
            *q0 = unsigned(q0s.saturating_sub(a1));
            *q1 = unsigned(q1s.saturating_sub(a3));
        } else {
            let a = base_delta(outer, p0s, q0s);
            let a = if mask { a } else { 0 };
            // `DoFilter2` with high edge variance. Without, these are 0.
            let simple = if hev { a } else { 0 };
            let s1 = simple.saturating_add(4) >> 3;
            let s2 = simple.saturating_add(3) >> 3;
            // Else `DoFilter6`. With, these are 0.
            let a = i16::from(if hev { 0 } else { a });
            let a1 = ((27 * a + 63) >> 7) as i8;
            let a2 = ((18 * a + 63) >> 7) as i8;
            let a3 = ((9 * a + 63) >> 7) as i8;
            *p2 = unsigned(signed(*p2).saturating_add(a3));
            *p1 = unsigned(p1s.saturating_add(a2));
            *p0 = unsigned(p0s.saturating_add(s2).saturating_add(a1));
            *q0 = unsigned(q0s.saturating_sub(s1).saturating_sub(a1));
            *q1 = unsigned(q1s.saturating_sub(a2));
            *q2 = unsigned(signed(*q2).saturating_sub(a3));
        }
    }
}

/// Which edges of a macroblock are filtered in one direction, and how: the one it shares with its neighbour, and those
/// between its own 4x4 blocks.
#[derive(Clone, Copy)]
pub(super) struct Edges<T> {
    pub(super) outer: Option<T>,
    pub(super) inner: Option<T>,
}

impl<T> Edges<T> {
    /// The lines that the filters use, out of the last four of the neighbour followed by the `size` of the macroblock.
    fn span(&self, size: usize) -> core::ops::Range<usize> {
        let start = if self.outer.is_some() { 0 } else { 4 };
        start..if self.inner.is_some() { 4 + size } else { 8 }
    }
}

/// `lines` is what `Edges::span` says.
fn simple_filter_lines(lines: &mut [Line], edges: Edges<u8>) -> Checked {
    let mut at = 2;
    if let Some(thresh) = edges.outer {
        simple_filter(lines.array_at_mut(at)?, thresh);
        at += 4;
    }
    if let Some(thresh) = edges.inner {
        while at + 6 <= lines.len() {
            simple_filter(lines.array_at_mut(at)?, thresh);
            at += 4;
        }
    }
    Ok(())
}

/// `lines` is what `Edges::span` says.
fn complex_filter_lines(lines: &mut [Line], edges: Edges<Thresholds>) -> Checked {
    let mut at = 0;
    if let Some(t) = edges.outer {
        complex_filter::<false>(lines.array_at_mut(at)?, t);
        at += 4;
    }
    if let Some(t) = edges.inner {
        while at + 8 <= lines.len() {
            complex_filter::<true>(lines.array_at_mut(at)?, t);
            at += 4;
        }
    }
    Ok(())
}

/// Four samples next to each other in a row.
type Quad = [u8; 4];

/// From 16 rows of `G` quads to `G` times 4 columns.
// Not inlined: next to the code that fills `tile`, LLVM moves every byte on its own.
#[inline(never)]
fn transpose<const G: usize>(tile: &[[Quad; G]; 16], columns: &mut [[Line; 4]; G]) -> Checked {
    for (g, columns) in columns.iter_mut().enumerate() {
        // Lane `i` of `a`, `b`, `c`, `d` is a block of 4 rows, which is transposed by swapping parts of it.
        let (mut a, mut b, mut c, mut d) = ([0u32; 4], [0u32; 4], [0u32; 4], [0u32; 4]);
        let lanes = a.iter_mut().zip(&mut b).zip(&mut c).zip(&mut d);
        for ((((a, b), c), d), [row_a, row_b, row_c, row_d]) in lanes.zip(tile.as_chunks::<4>().0) {
            *a = u32::from_le_bytes(row_a.at(g)?);
            *b = u32::from_le_bytes(row_b.at(g)?);
            *c = u32::from_le_bytes(row_c.at(g)?);
            *d = u32::from_le_bytes(row_d.at(g)?);
        }
        let swap = |a: &mut [u32; 4], b: &mut [u32; 4], shift: u32, mask: u32| {
            for (a, b) in a.iter_mut().zip(b) {
                let t = ((*a >> shift) ^ *b) & mask;
                *b ^= t;
                *a ^= t << shift;
            }
        };
        swap(&mut a, &mut b, 8, 0x00ff_00ff);
        swap(&mut c, &mut d, 8, 0x00ff_00ff);
        swap(&mut a, &mut c, 16, 0x0000_ffff);
        swap(&mut b, &mut d, 16, 0x0000_ffff);
        for (line, column) in columns.iter_mut().zip([a, b, c, d]) {
            for (line, v) in line.as_chunks_mut::<4>().0.iter_mut().zip(column) {
                *line = v.to_le_bytes();
            }
        }
    }
    Ok(())
}

/// From 4 columns to 16 rows of a quad.
// Not inlined, for the same reason.
#[inline(never)]
fn interleave(columns: &[Line; 4], rows: &mut [Quad; 16]) {
    let [a, b, c, d] = columns;
    for ((((row, &a), &b), &c), &d) in rows.iter_mut().zip(a).zip(b).zip(c).zip(d) {
        *row = [a, b, c, d];
    }
}

/// Whether all the samples of the row are the same.
#[inline(always)]
fn is_flat(row: &[Quad]) -> bool {
    let first = row.first().map_or(0, |&quad| u32::from_le_bytes(quad));
    first == first.rotate_left(8) && row.iter().all(|&quad| u32::from_le_bytes(quad) == first)
}

/// Calls `filter` with `4 * G` columns of 16 rows: 16 rows of luma (`B` = 16) or 8 of each chroma plane (`B` = 8). The
/// planes are made of blocks of `B` samples, `stride` of them in a row. The first row starts in block `at`, or with the
/// last quad of the block before if `with_left`.
#[inline(always)]
fn with_columns<const B: usize, const G: usize>(
    planes: &mut [&mut [[u8; B]]],
    at: usize,
    stride: usize,
    with_left: bool,
    filter: impl FnOnce(&mut [Line]) -> Checked,
) -> Checked {
    let mut tile = [[[0; 4]; G]; 16];
    for (plane, rows) in planes.iter().zip(tile.as_chunks_mut::<B>().0) {
        let mut at = at;
        for row in rows {
            let block = plane.at_ref(at)?.as_chunks::<4>().0.iter();
            if with_left {
                let left = plane.at_ref(at.wrapping_sub(1))?.last_chunk::<4>();
                for (to, from) in row.iter_mut().zip(left.into_iter().chain(block)) {
                    *to = *from;
                }
            } else {
                for (to, from) in row.iter_mut().zip(block) {
                    *to = *from;
                }
            }
            at += stride;
        }
    }
    // The filters leave such rows as they are.
    if tile.iter().all(|row| is_flat(row)) {
        return Ok(());
    }
    let mut columns = [[[0; 16]; 4]; G];
    transpose(&tile, &mut columns)?;

    filter(columns.as_flattened_mut())?;

    let mut quads = [[[0; 4]; 16]; G];
    for (columns, quads) in columns.iter().zip(&mut quads) {
        interleave(columns, quads);
    }
    for (plane, first_row) in planes.iter_mut().zip([0, B]) {
        let mut at = at;
        for i in first_row..first_row + B {
            let mut row = quads.iter().map(|quads| quads.at(i));
            if with_left {
                let left = plane.at_mut(at.wrapping_sub(1))?;
                *left.last_chunk_mut::<4>().ok_or(Bug)? = row.next().ok_or(Bug)??;
            }
            for (to, from) in plane.at_mut(at)?.as_chunks_mut::<4>().0.iter_mut().zip(row) {
                *to = from?;
            }
            at += stride;
        }
    }
    Ok(())
}

/// Filters the vertical edges of the macroblock whose first row is block `at` of each of `planes`.
#[inline(always)]
fn h_filter<const B: usize, T>(
    planes: &mut [&mut [[u8; B]]],
    at: usize,
    stride: usize,
    edges: &Edges<T>,
    filter: impl FnOnce(&mut [Line]) -> Checked,
) -> Checked {
    match (edges.outer.is_some(), edges.inner.is_some(), B) {
        (true, true, 16) => with_columns::<B, 5>(planes, at, stride, true, filter),
        (true, true, _) => with_columns::<B, 3>(planes, at, stride, true, filter),
        (true, false, _) => with_columns::<B, 2>(planes, at, stride, true, filter),
        (false, true, 16) => with_columns::<B, 4>(planes, at, stride, false, filter),
        (false, true, _) => with_columns::<B, 2>(planes, at, stride, false, filter),
        (false, false, _) => Ok(()),
    }
}

/// Whether the samples do not change from one line to the next. The filters leave such lines as they are.
#[inline(always)]
fn all_same(lines: &[Line]) -> bool {
    lines.iter().all(|line| Some(line) == lines.first())
}

/// Filters the horizontal edges of the macroblock of luma whose first row is block `at`. There are `above` rows before
/// it.
#[inline(always)]
fn v_filter<T>(
    p: &mut [Line],
    at: usize,
    stride: usize,
    above: usize,
    edges: &Edges<T>,
    filter: impl FnOnce(&mut [Line]) -> Checked,
) -> Checked {
    let span = edges.span(16);
    let loaded = span.start.max(4 - above)..span.end;
    let start = (at + loaded.start * stride)
        .checked_sub(4 * stride)
        .ok_or(Bug)?;
    let mut lines = [[0; 16]; 20];
    let mut from = start;
    for line in lines.sub_mut(loaded.clone())? {
        *line = p.at(from)?;
        from += stride;
    }
    if all_same(lines.sub(loaded.clone())?) {
        return Ok(());
    }
    filter(lines.sub_mut(span)?)?;
    let mut to = start;
    for &line in lines.sub(loaded)? {
        p.put(to, line)?;
        to += stride;
    }
    Ok(())
}

// In all of these the planes are made of blocks as wide as a macroblock, `stride` of them in a row, and `at` is the
// first row of the macroblock.

/// `VP8SimpleHFilter16` and `VP8SimpleHFilter16i`
pub(super) fn simple_h_filter16(
    p: &mut [[u8; 16]],
    at: usize,
    stride: usize,
    edges: Edges<u8>,
) -> Checked {
    h_filter(&mut [p], at, stride, &edges, |lines| {
        simple_filter_lines(lines, edges)
    })
}

/// `VP8SimpleVFilter16` and `VP8SimpleVFilter16i`
pub(super) fn simple_v_filter16(
    p: &mut [[u8; 16]],
    at: usize,
    stride: usize,
    edges: Edges<u8>,
) -> Checked {
    v_filter(p, at, stride, 2, &edges, |lines| {
        simple_filter_lines(lines, edges)
    })
}

/// `VP8HFilter16` and `VP8HFilter16i`
pub(super) fn h_filter16(
    p: &mut [[u8; 16]],
    at: usize,
    stride: usize,
    edges: Edges<Thresholds>,
) -> Checked {
    h_filter(&mut [p], at, stride, &edges, |lines| {
        complex_filter_lines(lines, edges)
    })
}

/// `VP8VFilter16` and `VP8VFilter16i`
pub(super) fn v_filter16(
    p: &mut [[u8; 16]],
    at: usize,
    stride: usize,
    edges: Edges<Thresholds>,
) -> Checked {
    v_filter(p, at, stride, 4, &edges, |lines| {
        complex_filter_lines(lines, edges)
    })
}

/// `VP8HFilter8` and `VP8HFilter8i`
pub(super) fn h_filter8(
    u: &mut [[u8; 8]],
    v: &mut [[u8; 8]],
    at: usize,
    stride: usize,
    edges: Edges<Thresholds>,
) -> Checked {
    h_filter(&mut [u, v], at, stride, &edges, |lines| {
        complex_filter_lines(lines, edges)
    })
}

/// `VP8VFilter8` and `VP8VFilter8i`
pub(super) fn v_filter8(
    u: &mut [[u8; 8]],
    v: &mut [[u8; 8]],
    at: usize,
    stride: usize,
    edges: Edges<Thresholds>,
) -> Checked {
    let span = edges.span(8);
    let start = (at + span.start * stride)
        .checked_sub(4 * stride)
        .ok_or(Bug)?;
    // A row of U, then the same row of V.
    let mut lines = [[0; 16]; 12];
    let lines = lines.sub_mut(span)?;
    let mut from = start;
    for line in lines.iter_mut() {
        let [to_u, to_v] = line.as_chunks_mut::<8>().0 else {
            return Err(Bug);
        };
        *to_u = u.at(from)?;
        *to_v = v.at(from)?;
        from += stride;
    }
    if all_same(lines) {
        return Ok(());
    }
    complex_filter_lines(lines, edges)?;
    let mut to = start;
    for line in lines.iter() {
        let [from_u, from_v] = line.as_chunks::<8>().0 else {
            return Err(Bug);
        };
        u.put(to, *from_u)?;
        v.put(to, *from_v)?;
        to += stride;
    }
    Ok(())
}
