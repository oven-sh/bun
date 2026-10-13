// lifetime: of a `withValue` argument, the converted form stored instead of the value.
struct Route {
    path: &'static [u8],
}
impl Route {
    fn configure<'a>(&mut self, path: WithValue<'a, &'a [u8]>) {
        self.path = path.converted;
    }
}
