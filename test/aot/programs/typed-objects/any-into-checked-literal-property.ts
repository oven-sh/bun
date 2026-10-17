// A value of type `any` becomes a property of an object literal that is checked against a type.
/* expected
plain TypeError
spread TypeError
shorthand TypeError
pushed 0
nested TypeError
right l3 undefined null
untyped x
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): any => v
interface Counter { count: number; label: string; extra?: number | null }
attempt("plain", () => { const made: Counter = { count: hide("x"), label: "l" }; return made.label })
attempt("spread", () => { const made: Counter = { ...{ label: "l" }, count: hide("x") }; return made.label })
attempt("shorthand", () => { const count = hide("x"); const made: Counter = { count, label: "l" }; return made.label })
const list: Counter[] = []
try { list.push({ count: hide("x"), label: "t" }) } catch {}
console.log("pushed", list.length)
attempt("nested", () => { const made: { inner: Counter } = { inner: { count: 1, label: hide(2) } }; return typeof made })
attempt("right", () => { const a: Counter = { count: hide(3), label: hide("l"), extra: hide(undefined) }; const b: Counter = { count: 1, label: "", extra: hide(null) }; return a.label + a.count + " " + a.extra + " " + b.extra })
attempt("untyped", () => { const made = { count: hide("x") }; return made.count })
