// A method that can run JavaScript: the wrapper, its payload borrowed for as long as nothing else can run.
fn flush<'a>(
    this: JsWrapper<'a, Socket>,
    cx: &mut JsCall<'a>,
    extra: JsValue<'a, ArrayBuffer>,
) -> bindgen::Result<'a, JsValue<'a>> {
    // Payload borrowed mutably and bytes viewed at once: disjoint fields of `cx`.
    extra.with_bytes(&cx.heap, |bytes| {
        this.with_mut(&mut cx.payloads, |socket| socket.pending.extend_from_slice(bytes))
    });
    let chunk = this.with(&cx.payloads, |socket| cx.heap.create_utf8_string(&socket.pending))?;
    let Some(callback) = this.ondata_get_cached(&cx.heap).as_function() else {
        return Ok(JsValue::UNDEFINED);
    };
    let result = callback.call(cx, this.as_value(), &[chunk.as_value()])?;
    // Afterwards everything is looked up again. A `JsValue` stays usable: the stack is scanned.
    let written = extra.with_bytes(&cx.heap, <[u8]>::len).unwrap_or(0);
    this.with_mut(&mut cx.payloads, |socket| {
        socket.pending.clear();
        socket.bytes_written += written as u64;
    });
    Ok(result)
}
