// A store from untyped code that does not fit the declared type of a field succeeds, as in plain Bun. Untyped code reads the value back, and a typed read of the field throws a TypeError.
interface Rec { n: number; s: string }
function poke(target: any, key: string, value: unknown) { target[key] = value }
function peek(target: any, key: string): unknown { return target[key] }
const r: Rec = { n: 1, s: "s" }
try { poke(r, "n", "text"); console.log("a string stored to a number field: no error") } catch (e) { console.log("a string stored to a number field:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log((r as any).n, peek(r, "n"))
try { console.log(r.n); console.log("a typed read of the field: no error") } catch (e) { console.log("a typed read of the field:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { poke(r, "n", () => 7); console.log("a function stored to a number field: no error") } catch (e) { console.log("a function stored to a number field:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log((r as any).n()); console.log("the stored function called: no error") } catch (e) { console.log("the stored function called:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(Reflect.set(r, "n", "text")); console.log("the same by Reflect.set: no error") } catch (e) { console.log("the same by Reflect.set:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const source: any = { s: 5 }; Object.assign(r, source); console.log("the same by Object.assign: no error") } catch (e) { console.log("the same by Object.assign:", e instanceof TypeError ? "TypeError" : "other " + e) }
// undefined passes every written type, so a typed read gives it back.
poke(r, "n", 2.5); poke(r, "s", undefined)
console.log(r.n, r.s)
try { poke(r, "n", undefined); console.log("undefined stored to a number field: no error") } catch (e) { console.log("undefined stored to a number field:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(r.n, Object.keys(r).join())
interface Narrow { m: number; t: string }
interface Loose { m: number | string }
const narrow: Narrow = { m: 1, t: "t" }
const loose: Loose = narrow
try { poke(narrow, "m", "text"); console.log("a string stored to a number field whose slot is for number | string: no error") } catch (e) { console.log("a string stored to a number field whose slot is for number | string:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(loose.m, peek(narrow, "m"))
try { console.log(narrow.m); console.log("read through the view that says number: no error") } catch (e) { console.log("read through the view that says number:", e instanceof TypeError ? "TypeError" : "other " + e) }
