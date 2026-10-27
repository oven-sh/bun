//! `alpha_enc.c`

use crate::EncodeError;

/// The `ALPH` payload for `width * height` alpha values, as `VP8EncStartAlpha`/`VP8EncFinishAlpha` make it with the
/// default configuration: `method` 4, `alpha_compression` 1, `alpha_filtering` 1, `alpha_quality` 100.
pub(crate) fn encode(_alpha: &[u8], _width: usize, _height: usize) -> Result<Vec<u8>, EncodeError> {
    Err(EncodeError::Bug)
}
