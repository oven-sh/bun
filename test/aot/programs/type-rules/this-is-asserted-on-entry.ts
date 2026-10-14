// A method of a literal is called, with `call`, on an object that is not of the type its `this` has (it lacks `get`).
type Box = { inner?: { value: number, get(): number } }
const full: Box = { inner: { value: 4, get() { return this.value + 1 } } }
try { (full.inner?.get)?.call({ value: 9 }); console.log("call on another object: no error") } catch (e) { console.log("call on another object:", e instanceof TypeError ? "TypeError" : "other " + e) }
