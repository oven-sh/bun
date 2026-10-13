// Methods that cannot run JavaScript get plain references.
impl Socket {
    fn bytes_written(&self) -> u64 {
        self.bytes_written
    }
    fn write<'a>(&mut self, data: &'a [u8]) -> usize {
        self.pending.extend_from_slice(data);
        data.len()
    }
    fn pending<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsValue<'a, JSString>> {
        heap.create_utf8_string(&self.pending)
    }
    fn check<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, ()> {
        if self.pending.is_empty() {
            return Err(heap.throw_type_error(format_args!("nothing is pending")));
        }
        Ok(())
    }
    // `passThis`: the wrapper reaches the class's `internalFields`, not the payload.
    fn listen<'a>(&mut self, this: JsWrapper<'a, Socket>, heap: &JsHeap<'a>, callback: JsValue<'a>) {
        self.bytes_written = 0;
        this.set_ondata_field(heap, callback);
    }
}
