// E0277: a wrapper's `Strong` sent to another thread; it is made, read and dropped on the JS thread.
fn f(strong: JsWrapperStrong<Socket>) {
    std::thread::spawn(move || drop(strong));
}
