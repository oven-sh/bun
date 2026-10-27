//! TEMPORARY: what the differential harness calls while the port is in pieces.

use crate::EncodeError;

pub fn alpha_encode(alpha: &[u8], width: usize, height: usize) -> Result<Vec<u8>, EncodeError> {
    crate::alpha::enc::encode(alpha, width, height)
}
