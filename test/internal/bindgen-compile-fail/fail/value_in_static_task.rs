// lifetime: a value captured by a task that runs later. A `Strong` is what outlives the call.
fn queue(_: Box<dyn FnOnce() + 'static>) {}
fn f<'a>(cx: &mut JsCall<'a>, value: JsValue<'a>) {
    queue(Box::new(move || drop(value)));
}
