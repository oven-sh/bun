// E0521: a value of one call used in another.
fn f(global: *mut JSGlobalObject) {
    unsafe {
        JsCall::with(global, |outer| {
            let value = JsValue::new(&outer.heap, JSValue::NULL);
            JsCall::with(global, |inner| drop(inner.heap.throw_value(value)));
        })
    };
}
