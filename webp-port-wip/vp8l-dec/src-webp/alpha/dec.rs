//! `alpha_dec.c`: the alpha plane of a lossy image.

use super::unfilters::{Filter, unfilter};
use crate::util::{SliceExt, try_vec};
use crate::{DecodeError, vp8l};

const ALPHA_NO_COMPRESSION: u8 = 0;
const ALPHA_LOSSLESS_COMPRESSION: u8 = 1;
const ALPHA_PREPROCESSED_LEVELS: u8 = 1;

/// The `width * height` alpha values of an `ALPH` payload. libwebp decodes them as the rows of the image are, which
/// fails for the same payloads. Where it fails in `ALPHInit`, its status is `VP8_STATUS_OUT_OF_MEMORY`; here, malformed
/// data is always a `BitstreamError`.
pub(crate) fn decode(data: &[u8], width: usize, height: usize) -> Result<Vec<u8>, DecodeError> {
    if width == 0 || height == 0 {
        return Err(DecodeError::Bug);
    }
    let mut plane = try_vec(0, width * height)?;

    let Some((&header, alpha_data @ [_, ..])) = data.split_first() else {
        return Err(DecodeError::BitstreamError);
    };
    let method = header & 0x03;
    let filter = match (header >> 2) & 0x03 {
        0 => Filter::None,
        1 => Filter::Horizontal,
        2 => Filter::Vertical,
        _ => Filter::Gradient,
    };
    let pre_processing = (header >> 4) & 0x03;
    let rsrv = (header >> 6) & 0x03;
    if pre_processing > ALPHA_PREPROCESSED_LEVELS || rsrv != 0 {
        return Err(DecodeError::BitstreamError);
    }

    match method {
        ALPHA_NO_COMPRESSION => {
            let deltas = alpha_data
                .get(..plane.len())
                .ok_or(DecodeError::BitstreamError)?;
            plane.write_at(0, deltas)?;
        }
        ALPHA_LOSSLESS_COMPRESSION => {
            vp8l::dec::decode_alpha(alpha_data, width, height, &mut plane)?;
        }
        _ => return Err(DecodeError::BitstreamError),
    }
    unfilter(filter, &mut plane, width)?;
    Ok(plane)
}
