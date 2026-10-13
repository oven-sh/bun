// E0521: a pending exception carried out of the call it belongs to.
fn f(global: *mut JSGlobalObject) {
    let mut escaped = None;
    unsafe { JsCall::with(global, |cx| escaped = Some(cx.heap.throw_out_of_memory())) };
}
