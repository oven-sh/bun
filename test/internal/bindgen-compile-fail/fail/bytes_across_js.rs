// E0500: ArrayBuffer bytes in use while JavaScript runs (it can detach, resize or transfer them).
fn f<'a>(cx: &mut JsCall<'a>, buffer: JsValue<'a, ArrayBuffer>, callback: JsValue<'a, JSFunction>) {
    buffer.with_bytes(&cx.heap, |bytes| {
        let _ = callback.call(cx, JsValue::UNDEFINED, &[]);
        bytes[0]
    });
}
