// E0521: a reference into a wrapper's payload carried out of the closure that bounds it.
fn f<'a>(this: JsWrapper<'a, Socket>, cx: &mut JsCall<'a>) -> usize {
    let mut escaped: &[u8] = &[];
    this.with(&cx.payloads, |socket| escaped = &socket.pending);
    escaped.len()
}
