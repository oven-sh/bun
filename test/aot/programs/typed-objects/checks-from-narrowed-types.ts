// A type that comes from narrowing, from a type guard or from context rather than from an annotation is a prediction: nothing is tested and nothing throws. A type argument that the program wrote is tested.
/* expected
e1 a1
e2 2
e3 1a
e4 number,string,bigint
e5 number,number
f1 text1
f2 2
f3 text
f4 object
f5 number
f6 number
g1 TypeError
g2 ab
g3 number
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
// The parameter of a callback has the type its context gives it, and is entered by a caller that knows nothing of it: whatever arrives goes on as it is.
attempt("e1", () => (JSON.parse('["a"]') as number[]).map(n => n + 1).join())
attempt("e2", () => (JSON.parse("[1]") as number[]).map(n => n + 1).join())
attempt("e3", () => (JSON.parse('[1,"a"]') as number[]).reduce((sum, n) => sum + n, 0))
function isNumber(v: unknown): v is number { return v !== null }
attempt("e4", () => [1, "two", 3n].filter(isNumber).map(n => typeof n).join())
attempt("e5", () => [1, null, 3].filter(isNumber).map(n => typeof n).join())
// The receiver is narrowed to a member of a union, or by a guard: the property is tested against what the written type of the receiver declares, not against the narrowed type.
type S = { kind: "n"; v: number } | { kind: "s"; v: string }
function read(s: S): number | string { return s.kind === "n" ? s.v + 1 : s.v }
attempt("f1", () => read(JSON.parse('{"kind":"n","v":"text"}')))
attempt("f2", () => read(JSON.parse('{"kind":"n","v":1}')))
attempt("f3", () => read(JSON.parse('{"kind":"s","v":"text"}')))
class Holder { value: unknown = 5; isText(): this is { value: string } { return true } }
attempt("f4", () => { const h = new Holder(); return h.isText() ? typeof h : "no" })
attempt("f5", () => { const h = new Holder(); return h.isText() ? typeof h.value : "no" })
attempt("f6", () => { const h = new Holder(); return typeof h.value })
class Wrapper<T> { constructor(public inner: T) {} get(): T { return this.inner } }
attempt("g1", () => (new Wrapper<unknown>(5) as Wrapper<string>).get().length)
attempt("g2", () => (new Wrapper<unknown>("ab") as Wrapper<string>).get())
attempt("g3", () => typeof (new Wrapper<unknown>(5) as Wrapper<string> as Wrapper<unknown>).get())
