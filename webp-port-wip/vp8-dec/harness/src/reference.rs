//! Safe wrappers over the reference libwebp v1.6.0 (/root/ref/build/libwebp_ref.a).
use std::ffi::{c_int, c_void};

unsafe extern "C" {
    fn WebPGetInfo(data: *const u8, len: usize, w: *mut c_int, h: *mut c_int) -> c_int;
    fn WebPDecodeRGBAInto(data: *const u8, len: usize, out: *mut u8, out_len: usize, stride: c_int) -> *mut u8;
    fn WebPEncodeRGBA(rgba: *const u8, w: c_int, h: c_int, stride: c_int, q: f32, out: *mut *mut u8) -> usize;
    fn WebPEncodeLosslessRGBA(rgba: *const u8, w: c_int, h: c_int, stride: c_int, out: *mut *mut u8) -> usize;
    fn WebPFree(ptr: *mut c_void);
    fn ref_disable_simd();
    fn ref_decode_status(data: *const u8, size: usize, out: *mut u8, out_size: usize, stride: c_int) -> c_int;
    fn ref_icc(data: *const u8, size: usize, icc: *mut *const u8, icc_size: *mut usize) -> c_int;
    fn ref_mux_icc(file: *const u8, size: usize, icc: *const u8, icc_size: usize, out: *mut *mut u8) -> usize;
    fn c_ref_disable_simd();
    fn c_ref_decode_status(data: *const u8, size: usize, out: *mut u8, out_size: usize, stride: c_int) -> c_int;
    fn ref_encode_advanced(rgba: *const u8, w: c_int, h: c_int, stride: c_int, p: *const c_int, out: *mut *mut u8) -> usize;
}

pub fn disable_simd() {
    unsafe { ref_disable_simd() }
}

pub fn get_info(data: &[u8]) -> Option<(u32, u32)> {
    let (mut w, mut h) = (0, 0);
    if unsafe { WebPGetInfo(data.as_ptr(), data.len(), &mut w, &mut h) } == 0 {
        return None;
    }
    Some((w as u32, h as u32))
}

pub fn decode_rgba_into(data: &[u8], out: &mut [u8], stride: usize) -> bool {
    !unsafe { WebPDecodeRGBAInto(data.as_ptr(), data.len(), out.as_mut_ptr(), out.len(), stride as c_int) }.is_null()
}

/// The VP8StatusCode: 0 OK, 1 OUT_OF_MEMORY, 2 INVALID_PARAM, 3 BITSTREAM_ERROR, 4 UNSUPPORTED_FEATURE, 5 SUSPENDED,
/// 6 USER_ABORT, 7 NOT_ENOUGH_DATA.
pub fn decode_status(data: &[u8], out: &mut [u8], stride: usize) -> i32 {
    unsafe { ref_decode_status(data.as_ptr(), data.len(), out.as_mut_ptr(), out.len(), stride as c_int) }
}

/// The same from the second copy of the library, which runs its plain C code once `c_disable_simd` was called.
pub fn c_decode_status(data: &[u8], out: &mut [u8], stride: usize) -> i32 {
    unsafe { c_ref_decode_status(data.as_ptr(), data.len(), out.as_mut_ptr(), out.len(), stride as c_int) }
}

pub fn c_disable_simd() {
    unsafe { c_ref_disable_simd() }
}

fn take(ptr: *mut u8, len: usize) -> Option<Vec<u8>> {
    if len == 0 || ptr.is_null() {
        return None;
    }
    let v = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
    unsafe { WebPFree(ptr.cast()) };
    Some(v)
}

pub fn encode_rgba(rgba: &[u8], w: u32, h: u32, stride: usize, q: f32) -> Option<Vec<u8>> {
    let mut out = std::ptr::null_mut();
    let n = unsafe { WebPEncodeRGBA(rgba.as_ptr(), w as c_int, h as c_int, stride as c_int, q, &mut out) };
    take(out, n)
}

pub fn encode_lossless_rgba(rgba: &[u8], w: u32, h: u32, stride: usize) -> Option<Vec<u8>> {
    let mut out = std::ptr::null_mut();
    let n = unsafe { WebPEncodeLosslessRGBA(rgba.as_ptr(), w as c_int, h as c_int, stride as c_int, &mut out) };
    take(out, n)
}

pub fn icc(data: &[u8]) -> Option<Vec<u8>> {
    let (mut p, mut n) = (std::ptr::null(), 0);
    if unsafe { ref_icc(data.as_ptr(), data.len(), &mut p, &mut n) } == 0 {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(p, n) }.to_vec())
}

pub fn mux_icc(file: &[u8], icc: &[u8]) -> Option<Vec<u8>> {
    let mut out = std::ptr::null_mut();
    let n = unsafe { ref_mux_icc(file.as_ptr(), file.len(), icc.as_ptr(), icc.len(), &mut out) };
    take(out, n)
}

/// See shim.c for the order of `p`.
pub fn encode_advanced(rgba: &[u8], w: u32, h: u32, p: &[i32; 23]) -> Option<Vec<u8>> {
    let mut out = std::ptr::null_mut();
    let n = unsafe { ref_encode_advanced(rgba.as_ptr(), w as c_int, h as c_int, (w * 4) as c_int, p.as_ptr(), &mut out) };
    take(out, n)
}
