//! The lossless encoder.

use crate::container::Image;
use crate::{EncodeError, Input};

/// `WebPEncodeLosslessRGBA`, without the container.
pub(crate) fn encode(_input: &Input<'_>) -> Result<Image, EncodeError> {
    Err(EncodeError::Bug)
}
