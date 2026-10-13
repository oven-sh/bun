// E0478: a payload that holds a value the GC would not see. Values go in the class's `values`.
struct Holder<'a> {
    callback: JsValue<'a>,
}
unsafe impl<'a> JsPayload for Holder<'a> {
    const INTERNAL_FIELDS_OFFSET: usize = 24;
    const PAYLOAD_OFFSET: usize = 24;
    unsafe fn create_cell(_: *mut JSGlobalObject, _: *mut core::ffi::c_void) -> core::ptr::NonNull<u8> {
        unreachable!()
    }
    fn cell_from_js(_: JSValue) -> *mut u8 {
        unreachable!()
    }
}
