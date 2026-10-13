// E0500: two `&mut T`; the two wrappers may be the same object.
fn f<'a>(a: JsWrapper<'a, Socket>, b: JsWrapper<'a, Socket>, cx: &mut JsCall<'a>) {
    a.with_mut(&mut cx.payloads, |a| {
        b.with_mut(&mut cx.payloads, |b| core::mem::swap(a, b));
    });
}
