//! TEMPORARY: what the differential harness calls directly.

use crate::DecodeError;

pub fn alpha_decode(data: &[u8], width: usize, height: usize) -> Result<Vec<u8>, DecodeError> {
    crate::alpha::dec::decode(data, width, height)
}
