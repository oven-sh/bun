// E0521: ArrayBuffer bytes carried out of the closure that bounds them.
fn f<'a>(cx: &mut JsCall<'a>, buffer: JsValue<'a, ArrayBuffer>) -> u8 {
    let mut escaped: &[u8] = &[];
    buffer.with_bytes(&cx.heap, |bytes| escaped = bytes);
    escaped[0]
}
