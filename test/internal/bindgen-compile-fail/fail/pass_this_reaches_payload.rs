// E0609: a `passThis` method with `&mut self` aliasing itself. `JsHeap` leads to no `JsPayloads`.
impl Socket {
    fn f<'a>(&mut self, this: JsWrapper<'a, Socket>, heap: &JsHeap<'a>) {
        self.bytes_written = this.with(&heap.payloads, |socket| socket.bytes_written);
    }
}
