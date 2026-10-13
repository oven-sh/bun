// E0200: claiming a cell layout; only generated code knows it.
struct Fake;
impl JsPayload for Fake {
    const INTERNAL_FIELDS_OFFSET: usize = 0;
    const PAYLOAD_OFFSET: usize = 0;
    unsafe fn create_cell(_: *mut JSGlobalObject, _: *mut core::ffi::c_void) -> core::ptr::NonNull<core::ffi::c_void> {
        unreachable!()
    }
    fn cell_from_js(_: JSValue) -> *mut core::ffi::c_void {
        unreachable!()
    }
}
