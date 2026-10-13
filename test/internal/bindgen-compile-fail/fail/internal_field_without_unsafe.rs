// E0133: reading an internal field by number; only the generated accessors know how many there are.
fn f<'a>(this: JsWrapper<'a, Socket>, heap: &JsHeap<'a>) -> JsValue<'a> {
    this.internal_field(heap, 7)
}
