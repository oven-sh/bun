// E0521: a value of one call used in another.
fn f(global: *mut JSGlobalObject) {
    unsafe {
        JsCall::with(global, |outer| {
            let error = outer.heap.throw_value(JsValue::NULL);
            JsCall::with(global, |inner| drop(inner.take_exception(error)));
        })
    };
}
