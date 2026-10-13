// A list of values the GC can see.
fn pair<'a>(heap: &JsHeap<'a>, a: JsValue<'a>, b: JsValue<'a>) -> bindgen::Result<'a, JsValue<'a>> {
    to_js::array(heap, [a, b], to_js::any)
}
fn collect<'a>(heap: &JsHeap<'a>, names: &[&[u8]]) -> bindgen::Result<'a, ()> {
    MarkedArgumentBuffer::new(|values| {
        for name in names {
            values.append(heap.create_utf8_string(name)?.to_js());
        }
        Ok(())
    })
}
