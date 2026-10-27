//! `common_dec.h`: what the decoder and the encoder agree on.

/// How a block is predicted from its neighbours. All ten are for 4x4 luma blocks. Whole macroblocks, luma and chroma,
/// use the first four.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IntraMode {
    Dc,
    TrueMotion,
    Vertical,
    Horizontal,
    DownRight,
    VerticalRight,
    DownLeft,
    VerticalLeft,
    HorizontalDown,
    HorizontalUp,
}

pub(crate) const NUM_BMODES: usize = 10;

pub(crate) const MB_FEATURE_TREE_PROBS: usize = 3;
pub(crate) const NUM_MB_SEGMENTS: usize = 4;
pub(crate) const NUM_REF_LF_DELTAS: usize = 4;
pub(crate) const NUM_MODE_LF_DELTAS: usize = 4;
pub(crate) const MAX_NUM_PARTITIONS: usize = 8;

/// 0: luma AC of a 16x16 macroblock, 1: its DC, 2: chroma, 3: luma of a 4x4 macroblock.
pub(crate) const NUM_TYPES: usize = 4;
pub(crate) const NUM_BANDS: usize = 8;
pub(crate) const NUM_CTX: usize = 3;
pub(crate) const NUM_PROBAS: usize = 11;
