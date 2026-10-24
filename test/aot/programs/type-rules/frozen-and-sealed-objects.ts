// `delete` and stores on typed objects that are frozen, sealed or non-extensible.
interface Rec { a: number; b: string; opt?: number; flag?: boolean; inner: { n: number } }
const fixedWith: Rec = Object.preventExtensions({ flag: false, a: 1, b: "b", opt: 0, inner: { n: 1 } })
try { delete fixedWith.opt; console.log("delete of a field the literal has: no error") } catch (e) { console.log("delete of a field the literal has:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { delete fixedWith.flag; console.log("of the other: no error") } catch (e) { console.log("of the other:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { fixedWith.opt = 1; fixedWith.flag = true; console.log("stores to them: no error") } catch (e) { console.log("stores to them:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(fixedWith), Object.isExtensible(fixedWith), Object.isSealed(fixedWith), Object.isFrozen(fixedWith))
// The same without preventExtensions.
const made = { a: 1, b: "b", opt: 0, inner: { n: 1 } }
const seen: Rec = made
try { delete seen.opt; console.log("made as its own type, seen as Rec: no error") } catch (e) { console.log("made as its own type, seen as Rec:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(made.opt + 1, Object.keys(seen).join())
