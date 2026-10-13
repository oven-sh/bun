// E0502: a `&JSGlobalObject`, with which anything can run, held while a wrapper's payload is borrowed.
fn f<'a>(this: JsWrapper<'a, Socket>, cx: &mut JsCall<'a>) {
    let global = cx.global();
    this.with(&cx.payloads, |socket| {
        let _ = (global, socket);
    });
}
