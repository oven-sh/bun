// E0500: `&mut T` into a wrapper's payload in use while JavaScript re-enters.
fn f<'a>(this: JsWrapper<'a, Socket>, cx: &mut JsCall<'a>, callback: JsValue<'a, JSFunction>) {
    this.with_mut(&mut cx.payloads, |socket| {
        let _ = callback.call(cx, JsValue::UNDEFINED, &[]);
        socket.bytes_written += 1;
    });
}
