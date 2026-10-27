//! Stand-in for Bun's crate of that name: the one type that bun_webp takes from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllocError;
impl core::fmt::Display for AllocError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("OutOfMemory")
    }
}
impl core::error::Error for AllocError {}
