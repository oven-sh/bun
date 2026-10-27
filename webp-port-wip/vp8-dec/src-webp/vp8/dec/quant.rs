//! `quant_dec.c`: the dequantisation factors.

use super::SegmentHeader;
use super::bit_reader::BitReader;
use crate::util::{Checked, SliceExt};
use crate::vp8::common::NUM_MB_SEGMENTS;
use crate::vp8::tables::{AC_TABLE, DC_TABLE};

/// The factor of the DC coefficient, then that of the others.
pub(super) type Quant = [i32; 2];

#[derive(Clone, Copy, Default)]
pub(super) struct QuantMatrix {
    pub(super) y1_mat: Quant,
    pub(super) y2_mat: Quant,
    pub(super) uv_mat: Quant,
}

fn dc(q: i32, max: i32) -> Checked<i32> {
    Ok(i32::from(DC_TABLE.at(q.clamp(0, max) as usize)?))
}

fn ac(q: i32) -> Checked<i32> {
    Ok(i32::from(AC_TABLE.at(q.clamp(0, 127) as usize)?))
}

/// `VP8ParseQuant`, paragraph 9.6.
pub(super) fn parse_quant(
    br: &mut BitReader<'_>,
    hdr: &SegmentHeader,
) -> Checked<[QuantMatrix; NUM_MB_SEGMENTS]> {
    let base_q0 = br.get_value(7) as i32;
    let mut delta = || if br.get() { br.get_signed_value(4) } else { 0 };
    let dqy1_dc = delta();
    let dqy2_dc = delta();
    let dqy2_ac = delta();
    let dquv_dc = delta();
    let dquv_ac = delta();

    let matrix = |q: i32| -> Checked<QuantMatrix> {
        Ok(QuantMatrix {
            y1_mat: [dc(q + dqy1_dc, 127)?, ac(q)?],
            // x * 155 / 100
            y2_mat: [
                dc(q + dqy2_dc, 127)? * 2,
                ((ac(q + dqy2_ac)? * 101581) >> 16).max(8),
            ],
            uv_mat: [dc(q + dquv_dc, 117)?, ac(q + dquv_ac)?],
        })
    };
    if !hdr.use_segment {
        return Ok([matrix(base_q0)?; NUM_MB_SEGMENTS]);
    }
    let mut dqm = [QuantMatrix::default(); NUM_MB_SEGMENTS];
    for (m, &quantizer) in dqm.iter_mut().zip(&hdr.quantizer) {
        let base = if hdr.absolute_delta { 0 } else { base_q0 };
        *m = matrix(i32::from(quantizer) + base)?;
    }
    Ok(dqm)
}
