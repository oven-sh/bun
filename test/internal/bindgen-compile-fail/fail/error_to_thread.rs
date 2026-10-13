// E0277: a pending exception sent to another thread.
fn f(error: bindgen::Error<'static>) {
    std::thread::spawn(move || drop(error));
}
