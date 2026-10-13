// The converted form for now, the value itself for whatever holds it longer.
fn to_a_class_value<'a>(this: JsWrapper<'a, Socket>, heap: &JsHeap<'a>, name: WithValue<'a, &'a [u8]>) -> usize {
    this.ondata_set_cached(heap, name.value);
    name.converted.len()
}
fn to_a_strong<'a>(heap: &JsHeap<'a>, name: WithValue<'a, &'a [u8]>) -> (Vec<u8>, Strong) {
    (name.converted.to_vec(), name.value.to_strong(heap))
}
fn to_a_call<'a>(
    cx: &mut JsCall<'a>,
    callback: JsValue<'a, JSFunction>,
    name: WithValue<'a, &'a [u8]>,
) -> bindgen::Result<'a, JsValue<'a>> {
    if name.converted.is_empty() {
        return Ok(name.value);
    }
    callback.call(cx, JsValue::UNDEFINED, &[name.value])
}
