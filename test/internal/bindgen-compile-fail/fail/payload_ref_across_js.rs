// E0500: `&T` into a wrapper's payload in use while JavaScript re-enters and may mutate it.
fn f<'a>(this: JsWrapper<'a, Socket>, cx: &mut JsCall<'a>, callback: JsValue<'a, JSFunction>) {
    this.with(&cx.payloads, |socket| {
        let _ = callback.call(cx, JsValue::UNDEFINED, &[]);
        socket.bytes_written
    });
}
