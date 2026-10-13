// What outlives a call is a `Strong`; a capability turns it back into a value.
struct Pending {
    socket: JsWrapperStrong<Socket>,
    callback: Strong,
}
fn start<'a>(this: JsWrapper<'a, Socket>, heap: &JsHeap<'a>, callback: JsValue<'a, JSFunction>) -> Pending {
    Pending { socket: this.to_strong(heap), callback: callback.to_strong(heap) }
}
fn finish<'a>(pending: Pending, cx: &mut JsCall<'a>) -> bindgen::Result<'a, JsValue<'a>> {
    let socket = pending.socket.get(&cx.heap);
    socket.with_mut(&mut cx.payloads, |socket| socket.pending.clear());
    let Some(callback) = JsValue::new(&cx.heap, pending.callback.get()).as_function() else {
        return Ok(JsValue::UNDEFINED);
    };
    callback.call(cx, socket.as_value(), &[])
}
