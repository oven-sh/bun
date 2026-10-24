// What a type guard, an assertion function, `typeof`, a comparison, an assignment or `delete` narrows a variable or property to.
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): unknown => v
// Guards and assertion functions.
function isNumber(v: unknown): v is number { return v !== null }
attempt("a2", () => { const v = hide(1); if (isNumber(v)) return v + 1; return "no" })
attempt("a3", () => { const v = hide(null); if (isNumber(v)) return v + 1; return "no" })
attempt("a6", () => [1, "two", 3n].filter(isNumber).length)
function assertString(v: unknown): asserts v is string {}
attempt("b2", () => { const v = hide("abc"); assertString(v); return v.length })
attempt("b4", () => { const v = hide(5); assertString(v); return v.toUpperCase() })
// A generic function of the program.
function cast<T>(v: unknown): T { return v as T }
function first<T>(items: T[]): T { return items[0] }
attempt("c2", () => cast<number>(1) + 1)
attempt("c3", () => typeof cast<unknown>("s"))
attempt("c5", () => first<number>(JSON.parse("[1]")) + 1)
function prop<T, K extends keyof T>(o: T, k: K): T[K] { return o[k] }
attempt("d2", () => prop(JSON.parse('{"x":1}') as { x: number }, "x") + 1)
// A narrowing that a call or an alias undoes: the checker keeps it, the value has moved on. No cast, no any.
interface Slot { v: number | string; w?: number | string }
const slot: Slot = { v: 1 }
function spoil() { slot.v = "spoiled"; slot.w = "w" }
attempt("e1", () => { slot.v = 1; if (typeof slot.v === "number") { spoil(); return slot.v + 1 } return "no" })
attempt("e2", () => { slot.v = 1; slot.w = 2; if (typeof slot.w === "number") { spoil(); return slot.w * 2 } return "no" })
attempt("e3", () => { slot.v = 5; spoil(); return slot.v + 1 })
attempt("e4", () => { const alias: Slot = slot; slot.v = 5; alias.v = "aliased"; return slot.v + 1 })
attempt("e5", () => { slot.v = 5; spoil(); slot.v += 1; return slot.v })
let captured: number | string = 1
function recapture() { captured = "late" }
attempt("f1", () => { captured = 1; if (typeof captured === "number") { recapture(); return captured + 1 } return "no" })
attempt("f2", () => { captured = 2; recapture(); return captured + 1 })
attempt("f3", () => { let local: number | string = 1; const set = () => { local = "set" }; set(); return local + 1 })
attempt("f4", () => { let local: number | string | boolean = true; const set = () => { local = "set" }; if (local === true) { set(); return !local } return "no" })
attempt("f5", () => { captured = 2; recapture(); captured += 1; return captured })
// delete, and stores through `any`.
interface Opt { n?: number; s?: string }
attempt("g1", () => { const o: Opt = { n: 1 }; o.n = 2; delete o.n; return o.n })
attempt("g2", () => { const o: Opt = { n: 1 }; if (o.n !== undefined) { delete o.n; return String(o.n) + typeof o.n } return "no" })
attempt("g3", () => { const o: Opt = {}; o.s = "x"; Object.assign(o, { s: undefined }); return o.s })
attempt("g4", () => { const o: Opt = {}; if (o.n === undefined) { o.n = 3; return o.n + 1 } return "no" })
// `in`, equality, truthiness, typeof in a switch, a loop that widens again.
type NorS = { tag: "n"; n: number } | { tag: "s"; s: string }
function pickOne(x: NorS): unknown { return "n" in x ? x.n : x.s }
attempt("h1", () => pickOne(JSON.parse('{"tag":"s","n":4}')))
attempt("h2", () => pickOne(JSON.parse('{"tag":"n","s":"t"}')))
attempt("h3", () => { const v = hide("0"); if (v === 0 || v === "0") return v + "!"; return "no" })
attempt("h4", () => { const v = hide(0) as number | string; if (!v) return typeof v; return "truthy" })
attempt("h5", () => { const v = hide("") as number | string; return v || "empty" })
attempt("i1", () => { const v = hide(7n); switch (typeof v) { case "number": return v + 1; case "bigint": return v + 1n; default: return "other" } })
attempt("i2", () => { let v: number | string = 0; for (let i = 0; i < 3; i++) { v = typeof v === "number" ? v + 1 : v + "!"; if (i === 1) v = String(v) } return v })
