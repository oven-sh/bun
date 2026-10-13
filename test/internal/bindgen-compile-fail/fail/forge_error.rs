// E0603: an `Err` that says something was thrown when nothing was.
fn f<'a>() -> bindgen::Result<'a, ()> {
    Err(bindgen::Error(unreachable!(), Default::default(), Default::default()))
}
