// Nobody wrote the type of this literal, and `as any` lets it out: its prototype may be changed as that of any object.
const plain = { a: 1 }
const parent = { inherited: "yes", hello() { return "hi " + (this as any).a } }
try { Object.setPrototypeOf(plain, parent); console.log("another prototype: no error") } catch (e) { console.log("another prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log((plain as any).inherited, typeof (plain as any).hello, plain.a, Object.getPrototypeOf(plain) === parent, Object.keys(plain).join())
try { Object.setPrototypeOf(plain, null); console.log("no prototype: no error") } catch (e) { console.log("no prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(Object.getPrototypeOf(plain) === Object.prototype, plain.a, "toString" in plain)
