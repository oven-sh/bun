// E0500: `&T` and `&mut T`; the two wrappers may be the same object.
fn f<'a>(a: JsWrapper<'a, Socket>, b: JsWrapper<'a, Socket>, cx: &mut JsCall<'a>) {
    a.with(&cx.payloads, |a| {
        b.with_mut(&mut cx.payloads, |b| b.bytes_written = a.bytes_written);
    });
}
