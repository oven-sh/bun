// `undefined` and `null` out of `any` pass into every variable of type number or boolean and stay what they are: `var`, `let`, hoisted reads, captured and module-level variables.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
const o: any = { present: 5 }
attempt("var, read early by a hoisted function", () => { peek(); var n = 0; n = o.missing; return n; function peek() { return String(n) } })
attempt("var, every read after the declaration", () => { var n = 0; const peek = () => String(n); n = o.missing; return peek() })
attempt("var, not captured", () => { var n = 0; n = o.missing; return String(n) })
var ofModule = 0
attempt("var of the module", () => { ofModule = o.missing; return String(ofModule) })
attempt("var that is cleared elsewhere", () => { var n = 0; const clear = () => { n = undefined! }; clear(); n = o.missing; return String(n) })
attempt("var without a value", () => { var n: number; n = o.missing; return String(n) })
attempt("let without a value", () => { let n: number; n = o.missing; return String(n) })
attempt("boolean", () => { peek(); var b = false; b = o.missing; return String(b); function peek() { return String(b) } })
attempt("null", () => { peek(); var n = 0; n = JSON.parse("null"); return String(n); function peek() { return String(n) } })
attempt("the initializer of a var, annotated", () => { peek(); var n: number = o.missing; return String(n); function peek() { return String(n) } })
attempt("the initializer of a var is `undefined!`", () => { peek(); var n: number = undefined!; return String(n); function peek() { return String(n) } })
// What fits is stored, the clear is let through, and a type with `undefined` in it takes it.
attempt("a number out of any", () => { peek(); var n = 0; n = o.present; return n + 1; function peek() { return String(n) } })
attempt("the clear", () => { var n = 0; const read = () => String(n); n = undefined!; return read() })
attempt("number | undefined", () => { var n: number | undefined = 0; n = o.missing; return String(n) })
attempt("the blank start", () => { return peek(); var n = 0; function peek() { return String(n) } })
