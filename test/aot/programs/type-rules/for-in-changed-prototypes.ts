// `for..in` over typed objects after attempts to change their prototype, their class's prototype, or the kind of their fields.
interface Rec { a: number; b?: string; c?: boolean; d: number }
function keysOf(o: object): string { const out: string[] = []; for (const k in o) out.push(k); return out.join("") }
function at(o: Rec, k: string): string { return String((o as unknown as Record<string, unknown>)[k]) }
function pairs(o: Rec): string { const out: string[] = []; for (const k in o) out.push(k + "=" + at(o, k)); return out.join("&") }
const full: Rec = { a: 1, b: "b", c: true, d: 4 }

const proto: Rec = { a: 10, b: "proto", d: 40 }
try { const child = Object.create(proto) as Rec & { own?: number }; console.log(keysOf(child)); console.log("inheritor of a compiled object cast to its type: no error") } catch (e) { console.log("inheritor of a compiled object cast to its type:", e instanceof TypeError ? "TypeError" : "other " + e) }

const moved: Rec = { a: 1, d: 2 }
try { Object.setPrototypeOf(moved, { inherited: 1, a: "hidden by own" }); console.log("another prototype: no error") } catch (e) { console.log("another prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.setPrototypeOf(moved, full); console.log("a compiled object for prototype: no error") } catch (e) { console.log("a compiled object for prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.setPrototypeOf(moved, null); console.log("no prototype: no error") } catch (e) { console.log("no prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(keysOf(moved), moved.a + moved.d, moved.b, moved.c)

class Base2 { p = 1; method() { return 0 } get acc() { return 0 } }
class Derived2 extends Base2 { q = 2; r?: number }
const inst = new Derived2()
try { (Base2.prototype as any).patched = true; console.log("property added to the prototype of a class: no error") } catch (e) { console.log("property added to the prototype of a class:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(keysOf(inst).replace("r", ""))
// Deleting an absent property is not an error, as in ECMAScript.
try { console.log(delete (Base2.prototype as any).patched); console.log("absent property of the prototype of a class deleted: no error") } catch (e) { console.log("absent property of the prototype of a class deleted:", e instanceof TypeError ? "TypeError" : "other " + e) }

const dressed: Rec = { a: 1, d: 2 }
const anyDressed: any = dressed
anyDressed.x = 1; anyDressed[5] = 1; dressed.b = "late"; anyDressed[Symbol("s")] = 1; anyDressed[0] = 1
console.log(keysOf(dressed))

const accessor: Rec = { a: 1, d: 2 }
let reads = 0
try { Object.defineProperty(accessor, "a", { get() { reads++; return 7 }, enumerable: true, configurable: true }); console.log("field made an accessor: no error") } catch (e) { console.log("field made an accessor:", e instanceof TypeError ? "TypeError" : "other " + e) }
const hiddenField: Rec = { a: 1, b: "h", d: 2 }
try { Object.defineProperty(hiddenField, "b", { enumerable: false }); console.log("field made non-enumerable: no error") } catch (e) { console.log("field made non-enumerable:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(keysOf(accessor), reads, pairs(accessor), reads, keysOf(hiddenField), hiddenField.b)

const parsed: Rec = JSON.parse('{"d":1,"z":0,"a":2,"1":3}')
console.log(keysOf(parsed), pairs(parsed))
