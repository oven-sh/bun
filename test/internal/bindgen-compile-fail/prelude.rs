// Shared by every case: a class as its author writes it, and what the generator adds.
#![allow(unused)]
use bun_jsc::bindgen::{self, *};
use bun_jsc::{ArrayBuffer, JSFunction, JSGlobalObject, JSString, JSValue, MarkedArgumentBuffer, Strong};

pub struct Socket {
    pub pending: Vec<u8>,
    pub bytes_written: u64,
}
unsafe impl JsPayload for Socket {
    const INTERNAL_FIELDS_OFFSET: usize = 24;
    const PAYLOAD_OFFSET: usize = 32;
    unsafe fn create_cell(_: *mut JSGlobalObject, _: *mut core::ffi::c_void) -> core::ptr::NonNull<core::ffi::c_void> {
        unreachable!()
    }
}
pub trait SocketInternalFields<'a>: Copy {
    fn ondata_field(self, heap: &JsHeap<'a>) -> JsValue<'a>;
    fn set_ondata_field<T>(self, heap: &JsHeap<'a>, value: JsValue<'a, T>);
}
impl<'a> SocketInternalFields<'a> for JsWrapper<'a, Socket> {
    fn ondata_field(self, heap: &JsHeap<'a>) -> JsValue<'a> {
        unsafe { self.internal_field(heap, 0) }
    }
    fn set_ondata_field<T>(self, heap: &JsHeap<'a>, value: JsValue<'a, T>) {
        unsafe { self.set_internal_field(heap, 0, value) }
    }
}
fn main() {}
