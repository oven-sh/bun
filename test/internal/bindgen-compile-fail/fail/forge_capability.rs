// E0423: making a capability out of nothing.
fn f<'a>() -> JsHeap<'a> {
    JsHeap(Default::default(), Default::default(), Default::default())
}
