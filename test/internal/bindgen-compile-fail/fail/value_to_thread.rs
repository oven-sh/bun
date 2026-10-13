// E0277: a value sent to another thread.
fn f(value: JsValue<'static>) {
    std::thread::spawn(move || drop(value));
}
