// A method of an object literal is called, with `call`, on an object that does not match the type of its `this`.
type Box = { inner?: { value: number, get(): number } }
const full: Box = { inner: { value: 4, get() { return this.value + 1 } } }
try { (full.inner?.get)?.call({ value: 9 }); console.log("call on another object: no error") } catch (e) { console.log("call on another object:", e instanceof TypeError ? "TypeError" : "other " + e) }
