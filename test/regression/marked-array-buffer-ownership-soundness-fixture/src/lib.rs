//! Compile-fail fixture for
//! `test/regression/marked-array-buffer-ownership-soundness.test.ts`.
//!
//! This crate must NOT compile. `MarkedArrayBuffer` has no safe constructor
//! that adopts a borrowed `&mut [u8]` as allocator-owned storage — ownership
//! transfer requires a `Box<[u8]>` (`MarkedArrayBuffer::from_owned_bytes`).
//!
//! Before the fix for issue #31969, `MarkedArrayBuffer::from_bytes` accepted
//! exactly this code: it stored the stack slice's pointer with
//! `owns_buffer: true`, and `destroy()` then freed the stack address with the
//! default allocator.

use bun_jsc::{JSType, MarkedArrayBuffer};

pub fn free_a_stack_buffer() {
    let mut bytes = [0u8; 1];
    let mut buffer = MarkedArrayBuffer::from_bytes(&mut bytes, JSType::Uint8Array);
    buffer.destroy();
}
