// E0308: running JavaScript with the capability to allocate only.
fn f<'a>(heap: &JsHeap<'a>, callback: JsValue<'a, JSFunction>) {
    let _ = callback.call(heap, JsValue::UNDEFINED, &[]);
}
