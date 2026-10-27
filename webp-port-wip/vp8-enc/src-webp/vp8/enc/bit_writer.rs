//! `bit_writer_utils.c`: the boolean entropy coder of VP8.

use crate::util::OutOfMemory;

pub(super) struct BitWriter {
    /// The range, minus 1.
    range: i32,
    value: i32,
    /// How many 0xff bytes wait to know whether a carry turns them into 0x00.
    run: usize,
    /// The bits of `value` that are not written yet, minus 8.
    nb_bits: i32,
    buf: Vec<u8>,
    out_of_memory: bool,
}

impl BitWriter {
    pub(super) fn new(expected_size: usize) -> Result<Self, OutOfMemory> {
        let mut buf = Vec::new();
        buf.try_reserve(expected_size).map_err(|_| OutOfMemory)?;
        Ok(Self {
            range: 255 - 1,
            value: 0,
            run: 0,
            nb_bits: -8,
            buf,
            out_of_memory: false,
        })
    }

    fn flush(&mut self) {
        let s = 8 + self.nb_bits;
        let bits = self.value >> s;
        self.value -= bits << s;
        self.nb_bits -= 8;
        if bits & 0xff == 0xff {
            self.run += 1;
            return;
        }
        if self.buf.try_reserve(self.run + 1).is_err() {
            self.out_of_memory = true;
            return;
        }
        let carry = bits & 0x100 != 0;
        if carry && let Some(last) = self.buf.last_mut() {
            *last = last.wrapping_add(1);
        }
        let pending = if carry { 0x00 } else { 0xff };
        self.buf.extend(core::iter::repeat_n(pending, self.run));
        self.run = 0;
        self.buf.push(bits as u8);
    }

    #[inline]
    fn renormalize(&mut self) {
        if self.range < 127 {
            let shift = (self.range as u8 + 1).leading_zeros() as i32;
            self.range = ((self.range + 1) << shift) - 1;
            self.value <<= shift;
            self.nb_bits += shift;
            if self.nb_bits > 0 {
                self.flush();
            }
        }
    }

    #[inline]
    fn put(&mut self, bit: bool, split: i32) -> bool {
        if bit {
            self.value += split + 1;
            self.range -= split + 1;
        } else {
            self.range = split;
        }
        self.renormalize();
        bit
    }

    /// `prob` is the probability of a 0, out of 256.
    #[inline]
    pub(super) fn put_bit(&mut self, bit: bool, prob: u8) -> bool {
        self.put(bit, (self.range * i32::from(prob)) >> 8)
    }

    #[inline]
    pub(super) fn put_bit_uniform(&mut self, bit: bool) -> bool {
        self.put(bit, self.range >> 1)
    }

    /// The `nb_bits` low bits of `value`, the highest first.
    pub(super) fn put_bits(&mut self, value: u32, nb_bits: u32) {
        for shift in (0..nb_bits).rev() {
            self.put_bit_uniform((value >> shift) & 1 != 0);
        }
    }

    pub(super) fn put_signed_bits(&mut self, value: i32, nb_bits: u32) {
        if !self.put_bit_uniform(value != 0) {
            return;
        }
        self.put_bits(
            (value.unsigned_abs() << 1) | u32::from(value < 0),
            nb_bits + 1,
        );
    }

    pub(super) fn finish(mut self) -> Result<Vec<u8>, OutOfMemory> {
        self.put_bits(0, (9 - self.nb_bits) as u32);
        self.nb_bits = 0;
        self.flush();
        if self.out_of_memory {
            return Err(OutOfMemory);
        }
        Ok(self.buf)
    }
}
