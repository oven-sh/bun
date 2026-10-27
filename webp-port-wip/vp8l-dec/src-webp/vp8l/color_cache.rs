//! `color_cache_utils.c`: recently used colours, addressed by a hash of the colour.

use crate::util::{Checked, OutOfMemory, SliceExt, try_vec};

const HASH_MUL: u32 = 0x1e35_a7bd;

pub(crate) struct ColorCache {
    colors: Vec<u32>,
    /// `32 - hash_bits`
    hash_shift: u32,
}

impl ColorCache {
    /// `hash_bits` is 1 to `MAX_CACHE_BITS`.
    pub(crate) fn new(hash_bits: u32) -> Result<Self, OutOfMemory> {
        debug_assert!((1..32).contains(&hash_bits));
        Ok(Self {
            colors: try_vec(0, 1 << hash_bits)?,
            hash_shift: 32 - hash_bits,
        })
    }

    #[inline]
    pub(crate) fn lookup(&self, key: usize) -> Checked<u32> {
        self.colors.at(key)
    }

    #[inline]
    pub(crate) fn insert(&mut self, argb: u32) -> Checked {
        let key = argb.wrapping_mul(HASH_MUL) >> self.hash_shift;
        self.colors.put(key as usize, argb)
    }
}
