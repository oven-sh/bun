// E0521: a value carried out of the call it belongs to.
fn f(global: *mut JSGlobalObject) {
    let mut escaped = None;
    unsafe { JsCall::with(global, |cx| escaped = cx.heap.create_utf8_string(b"text").ok()) };
}
