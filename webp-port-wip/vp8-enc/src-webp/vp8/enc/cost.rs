//! `cost_enc.c` and `dsp/cost.c`: what it costs to code the coefficients, in 1/256 bit.

use super::dsp::{self, Coeffs, Lanes};
use super::iterator::EncIterator;
use super::tables::{
    COEFFS_PROBA0, ENC_BANDS, ENTROPY_COST, LEVEL_CODES, LEVEL_FIXED_COSTS, MAX_VARIABLE_LEVEL,
    NUM_BANDS, NUM_CTX, NUM_PROBAS, NUM_TYPES, Probas,
};
use crate::util::{Checked, SliceExt};

pub(super) const TYPE_I16_AC: usize = 0;
pub(super) const TYPE_I16_DC: usize = 1;
pub(super) const TYPE_CHROMA_A: usize = 2;
pub(super) const TYPE_I4_AC: usize = 3;

type LevelCosts = [u16; MAX_VARIABLE_LEVEL + 1];

/// The probabilities of the frame.
pub(super) struct Proba {
    /// For the tree of the segments.
    pub(super) segments: [u8; 3],
    pub(super) coeffs: Probas<u8>,
    /// How often each of `coeffs` was used, in the high 16 bits, and how often for a 1, in the low ones.
    pub(super) stats: Probas<u32>,
    level_cost: [[[LevelCosts; NUM_CTX]; NUM_BANDS]; NUM_TYPES],
    /// Whether `level_cost` is behind `coeffs`.
    pub(super) dirty: bool,
}

/// The cost of coding `bit` when the probability of a 0 is `proba / 256`.
#[inline(always)]
pub(super) fn bit_cost(bit: bool, proba: u8) -> Checked<i32> {
    let proba = if bit { 255 - proba } else { proba };
    Ok(i32::from(ENTROPY_COST.at(usize::from(proba))?))
}

fn variable_level_cost(level: usize, probas: &[u8; NUM_PROBAS]) -> Checked<i32> {
    let [mut pattern, mut bits] = LEVEL_CODES.at(level - 1)?;
    let mut cost = 0;
    for &proba in probas.iter().skip(2) {
        if pattern & 1 != 0 {
            cost += bit_cost(bits & 1 != 0, proba)?;
        }
        bits >>= 1;
        pattern >>= 1;
    }
    Ok(cost)
}

impl Proba {
    pub(super) fn new() -> Self {
        Self {
            segments: [255; 3],
            coeffs: COEFFS_PROBA0,
            stats: [[[[0; NUM_PROBAS]; NUM_CTX]; NUM_BANDS]; NUM_TYPES],
            level_cost: [[[[0; MAX_VARIABLE_LEVEL + 1]; NUM_CTX]; NUM_BANDS]; NUM_TYPES],
            dirty: true,
        }
    }

    pub(super) fn calculate_level_costs(&mut self) -> Checked {
        if !self.dirty {
            return Ok(());
        }
        let bands = self.coeffs.as_flattened().iter();
        for (probas, tables) in bands.zip(self.level_cost.as_flattened_mut()) {
            for (ctx, (p, table)) in probas.iter().zip(tables).enumerate() {
                let cost0 = if ctx > 0 { bit_cost(true, p[0])? } else { 0 };
                let cost_base = bit_cost(true, p[1])? + cost0;
                for (v, cost) in table.iter_mut().enumerate() {
                    *cost = if v == 0 {
                        bit_cost(false, p[1])? + cost0
                    } else {
                        cost_base + variable_level_cost(v, p)?
                    } as u16;
                }
            }
        }
        self.dirty = false;
        Ok(())
    }

    /// The cost of the levels of a block from `first` on, in the context `ctx0`. There are `num_levels` up to the last one
    /// that is not zero, and `levels` is only called for if that is not 0.
    #[inline]
    pub(super) fn get_residual_cost(
        &self,
        coeff_type: usize,
        first: usize,
        ctx0: u8,
        num_levels: u8,
        levels: impl FnOnce() -> Checked<Coeffs>,
    ) -> Checked<i32> {
        let (num_levels, mut ctx) = (usize::from(num_levels), usize::from(ctx0.min(2)));
        let probas = self.coeffs.at_ref(coeff_type)?;
        let costs = self.level_cost.at_ref(coeff_type)?;
        // `first` is 0 or 1, which are their own bands.
        let p0 = probas.at_ref(first)?.at_ref(ctx)?[0];
        if num_levels == 0 {
            return bit_cost(false, p0);
        }
        // The tables have the cost of the 1 bit of `p0`, which is not coded after a zero, for the other contexts only.
        let mut cost = if ctx == 0 { bit_cost(true, p0)? } else { 0 };
        let levels = levels()?;
        let levels = levels.as_flattened().sub(first..num_levels)?;
        for (&level, &band) in levels.iter().zip(ENC_BANDS.sub(first..)?) {
            let v = usize::from(level.unsigned_abs());
            let table = costs.at_ref(usize::from(band))?.at_ref(ctx)?;
            cost += i32::from(LEVEL_FIXED_COSTS.at(v)?)
                + i32::from(table.at(v.min(MAX_VARIABLE_LEVEL))?);
            ctx = v.min(2);
        }
        if num_levels < 16 {
            let band = usize::from(ENC_BANDS.at(num_levels)?);
            cost += bit_cost(false, probas.at_ref(band)?.at_ref(ctx)?[0])?;
        }
        Ok(cost)
    }
}

impl EncIterator {
    /// The cost of one of several candidates for the current 4x4 block.
    pub(super) fn get_cost_luma4(
        &self,
        proba: &Proba,
        levels: &Coeffs,
        num_levels: u8,
    ) -> Checked<i32> {
        let ctx = self.top_nz.at(self.i4 & 3)? + self.left_nz.at(self.i4 >> 2)?;
        proba.get_residual_cost(TYPE_I4_AC, 0, ctx, num_levels, || Ok(*levels))
    }

    pub(super) fn get_cost_luma16(
        &mut self,
        proba: &Proba,
        dc_levels: &Coeffs,
        ac_levels: &Lanes<i16, 16>,
        num_ac_levels: &[u8; 16],
    ) -> Checked<i32> {
        self.nz_to_bytes()?;
        let ctx = self.top_nz[8] + self.left_nz[8];
        let num_levels = dsp::num_levels_block(*dc_levels);
        let dc_levels = || Ok(*dc_levels);
        let mut cost = proba.get_residual_cost(TYPE_I16_DC, 0, ctx, num_levels, dc_levels)?;
        let mut blocks = num_ac_levels.iter().enumerate();
        for left_nz in self.left_nz.iter_mut().take(4) {
            for (top_nz, (n, &num_levels)) in self.top_nz.iter_mut().take(4).zip(&mut blocks) {
                let ctx = *top_nz + *left_nz;
                let levels = || ac_levels.at(n);
                cost += proba.get_residual_cost(TYPE_I16_AC, 1, ctx, num_levels, levels)?;
                *top_nz = u8::from(num_levels != 0);
                *left_nz = *top_nz;
            }
        }
        Ok(cost)
    }

    /// The cost of the eight blocks of `uv_levels` from `first_block` on.
    pub(super) fn get_cost_uv<const L: usize>(
        &mut self,
        proba: &Proba,
        uv_levels: &Lanes<i16, L>,
        num_levels: &[u8; L],
        first_block: usize,
    ) -> Checked<i32> {
        self.nz_to_bytes()?;
        let mut cost = 0;
        let mut blocks = num_levels.iter().enumerate().skip(first_block);
        let top_nz = self.top_nz.sub_mut(4..8)?.as_chunks_mut::<2>().0;
        let left_nz = self.left_nz.sub_mut(4..8)?.as_chunks_mut::<2>().0;
        for (top_nz, left_nz) in top_nz.iter_mut().zip(left_nz) {
            for left_nz in left_nz {
                for (top_nz, (n, &num_levels)) in top_nz.iter_mut().zip(&mut blocks) {
                    let ctx = *top_nz + *left_nz;
                    let levels = || uv_levels.at(n);
                    cost += proba.get_residual_cost(TYPE_CHROMA_A, 0, ctx, num_levels, levels)?;
                    *top_nz = u8::from(num_levels != 0);
                    *left_nz = *top_nz;
                }
            }
        }
        Ok(cost)
    }
}
