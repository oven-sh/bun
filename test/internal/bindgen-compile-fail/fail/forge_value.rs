// E0423: a value made without a capability.
fn f<'a>() -> JsValue<'a> {
    JsValue(JSValue::UNDEFINED, Default::default(), Default::default())
}
