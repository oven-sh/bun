// A primitive is passed through `any` as an object type that it does not satisfy: a number has no `length`.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
const hide = (v: unknown): any => v
interface HasLength { length: number }
interface Fixable { toFixed(digits: number): string }
function lengthOf(x: HasLength): number { return x.length }
attempt("a number as { length }", () => { const h: HasLength = hide(5); return h.length })
attempt("a boolean as { toFixed }, typeof", () => { const h: Fixable = hide(true); return typeof h })
attempt("a boolean as { toFixed }, called", () => { const h: Fixable = hide(true); return h.toFixed(1) })
attempt("a number as an argument", () => (lengthOf as any)(5))
// What has the member passes.
attempt("a string as { length }", () => { const h: HasLength = hide("abc"); return h.length })
attempt("a number as { toFixed }", () => { const h: Fixable = hide(2); return h.toFixed(1) })
