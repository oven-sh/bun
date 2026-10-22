// `undefined!` and `null!` as placeholders for a `number`, `boolean` or numeric enum: `x!` tests nothing, and undefined and null pass every written type and stay what they are.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
enum Target { ES5, ES2015 }
attempt("variable, number", () => { let position: number = undefined!; return position })
attempt("variable, boolean", () => { let isStrict: boolean = undefined!; return isStrict })
attempt("variable, enum", () => { let target: Target = undefined!; return target })
attempt("variable, number, null", () => { let position: number = null!; return position })
let position = 0, isStrict = true, target = Target.ES2015
attempt("module variable cleared, number", () => { position = undefined! })
attempt("module variable cleared, boolean", () => { isStrict = undefined! })
attempt("module variable cleared, enum", () => { target = undefined! })
console.log(position, isStrict, target)
attempt("captured variable", () => { let pos: number = undefined!; return { get: () => pos, set: (p: number) => { pos = p } }.get() })
class Binder { label: string = null!; count: number = undefined! }
attempt("field of a class", () => Object.keys(new Binder()).join())
interface Links { type: string; id: number }
attempt("field of a literal", () => { const links: Links = { type: undefined!, id: undefined! }; return Object.keys(links).join() })
function visit(depth: number = undefined!): string { return String(depth) }
attempt("default of a parameter, taken", () => visit())
attempt("default of a parameter, not taken", () => visit(1))
// A type that names undefined takes it too.
attempt("variable, number | undefined", () => { let position: number | undefined = undefined!; return position })
