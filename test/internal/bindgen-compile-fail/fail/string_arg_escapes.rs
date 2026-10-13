// lifetime: the UTF-8 view of a string argument stored past the call.
struct Route {
    path: &'static [u8],
}
impl Route {
    fn configure<'a>(&mut self, path: &'a [u8]) {
        self.path = path;
    }
}
