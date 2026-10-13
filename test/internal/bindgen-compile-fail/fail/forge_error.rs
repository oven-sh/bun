// E0423: an `Err` that says something was thrown when nothing was.
fn f<'a>() -> bindgen::Result<'a, ()> {
    Err(bindgen::Error(Default::default(), Default::default(), Default::default()))
}
