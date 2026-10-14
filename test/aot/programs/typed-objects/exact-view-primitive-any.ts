// A primitive is used through an object type that it satisfies (`{ length: number } = "abc"`), directly and through `any`.
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): any => v
interface HasLength { length: number }
interface Fixable { toFixed(digits: number): string }
function lengthOf(x: HasLength): number { return x.length }
// No any at all: plain assignments the checker accepts.
attempt("a1", () => { const h: HasLength = "abc"; return h.length })
attempt("a2", () => { const h: Fixable = 2; return h.toFixed(1) })
attempt("a3", () => [lengthOf("abc"), lengthOf([1, 2]), lengthOf((a: number) => a), lengthOf({ length: 4 })].join(" "))
attempt("a4", () => { const e: {} = 5; return typeof e })
attempt("a5", () => { const o: Object = "s"; return o.toString() })
attempt("a6", () => { const d: { description?: string } = Symbol("desc"); return d.description })
// The same values through any.
attempt("b1", () => { const h: HasLength = hide("abc"); return h.length })
attempt("b2", () => { const h: Fixable = hide(2); return h.toFixed(1) })
attempt("b3", () => { const e: {} = hide(5); return typeof e })
attempt("b4", () => { const o: Object = hide("s"); return typeof o })
attempt("b5", () => { const v: { valueOf(): boolean } = hide(true); return v.valueOf() })
attempt("b6", () => [(lengthOf as any)("abc"), (lengthOf as any)([1, 2, 3])].join())
// References can be null or undefined.
attempt("c4", () => { const h: HasLength = hide(null); return h === null })
attempt("c6", () => (lengthOf as any)(undefined))
