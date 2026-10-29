// `for..in` over typed objects, and over objects that inherit from them and are cast to the type.
interface Rec { a: number; b?: string; c?: boolean; d: number }
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
function keysOf(o: object): string { const out: string[] = []; for (const k in o) out.push(k); return out.join("") }
const full: Rec = { a: 1, b: "b", c: true, d: 4 }
rule("heir cast to the type", () => keysOf(Object.create(full) as Rec))
const moved: Rec = { a: 1, d: 2 }
rule("a literal for prototype", () => Object.setPrototypeOf(moved, { inherited: 1, a: "hidden by own" }) === moved)
rule("an object of the type for prototype", () => Object.setPrototypeOf(moved, full) === moved)
rule("no prototype", () => Object.setPrototypeOf(moved, null) === moved)
rule("the prototype it has", () => Object.setPrototypeOf(moved, Object.prototype) === moved)
console.log(keysOf(moved), moved.b, moved.a + moved.d)
class Base2 { p = 1; method() { return 0 } get acc() { return 0 } }
class Derived2 extends Base2 { q = 2 }
const inst = new Derived2()
rule("enumerable addition to the prototype of a class", () => { (Base2.prototype as any).patched = true; return "stored" })
rule("another prototype for the prototype of a class", () => Object.setPrototypeOf(Base2.prototype, { polluted: 1 }) === Base2.prototype)
console.log(keysOf(inst))
// Key order: indices, then strings in the order in which they were created.
const dressed: Rec = { a: 1, d: 2 }
const anyDressed: any = dressed
anyDressed.x = 1; anyDressed[5] = 1; dressed.b = "late"; anyDressed[Symbol("s")] = 1; anyDressed[0] = 1
console.log(keysOf(dressed), Object.keys(dressed).join(""), JSON.stringify(dressed))
const parsed: Rec = JSON.parse('{"d":1,"z":0,"a":2,"1":3}')
console.log(keysOf(parsed))
const accessor: Rec = { a: 1, d: 2 }
let reads = 0
rule("field made an accessor", () => { Object.defineProperty(accessor, "a", { get() { reads++; return 7 }, enumerable: true, configurable: true }); return "defined" })
const hiddenField: Rec = { a: 1, b: "h", d: 2 }
rule("field made not enumerable", () => { Object.defineProperty(hiddenField, "b", { enumerable: false }); return "defined" })
console.log(keysOf(accessor), accessor.a, reads, keysOf(hiddenField), hiddenField.b)
