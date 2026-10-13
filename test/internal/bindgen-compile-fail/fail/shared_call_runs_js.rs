// E0308: running JavaScript through a shared reference to the capability.
fn f<'a>(cx: &JsCall<'a>, callback: JsValue<'a, JSFunction>) {
    let _ = callback.call(cx, JsValue::UNDEFINED, &[]);
}
