// The result of an untyped function that is called through a type promising a primitive is checked where the call returns.
/* expected
a1 6
a2 TypeError
a3 TypeError
b1 s!
b2 TypeError
c1 true
c2 TypeError
c3 TypeError
d1 TypeError
d2 1,2
e1 TypeError
e2 3
f1 TypeError
f2 4
f3 TypeError
f4 big
f5 TypeError
f6 4
f7 object
f8 4
g1 TypeError
g2 ab
h1 TypeError
h2 10
i1 TypeError
i2 2
j1 51
j2 string
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const parse: (text: string) => number = JSON.parse
attempt("a1", () => parse("5") + 1)
attempt("a2", () => parse('"5"') + 1)
attempt("a3", () => parse("[5]") + 1)
const identity: (v: unknown) => string = (v: any) => v
attempt("b1", () => identity("s") + "!")
attempt("b2", () => identity(5) + "!")
function untyped(v: any) { return v }
function typed(v: any): boolean { return untyped(v) }
attempt("c1", () => typed(true))
attempt("c2", () => { const b: boolean = typed("true"); return b })
attempt("c3", () => { const b: boolean = typed(1); return b })
attempt("d1", () => ["a"].map((x: any): number => x).join())
attempt("d2", () => [1, 2].map((x: any): number => x).join())
const loose: any = (v: unknown) => v
attempt("e1", () => { const n: number = loose("3"); return n })
attempt("e2", () => { const n: number = loose(3); return n })
// Methods of objects of the program.
interface Api { size(): number }
const wrong: Api = { size: (): any => "big" }
const right: Api = { size: () => 3 }
attempt("f1", () => wrong.size() + 1)
attempt("f2", () => right.size() + 1)
attempt("f3", () => { const apis: Api[] = [right, wrong]; let s = 0; for (const a of apis) s += a.size(); return s })
attempt("f4", () => (wrong as any).size())
// An ordinary object (a literal checked against `any` is one) passes the cast as it is. Its function is called as the type says.
const plainWrong: any = { size: () => "big" }, plainRight: any = { size: () => 3 }
attempt("f5", () => (plainWrong as Api).size() + 1)
attempt("f6", () => (plainRight as Api).size() + 1)
// An object of the program that was created as another type passes the cast as it is.
attempt("f7", () => typeof ({ size: () => "big" } as unknown as Api))
attempt("f8", () => ({ size: () => 3 } as unknown as Api).size() + 1)
// A function value that travels through a field of function type.
interface Holder { make: (a: string, b: string) => string }
const holder: Holder = { make: (a, b) => a + b }
attempt("g1", () => { (holder as any).make = () => 7; return holder.make("a", "b").length })
attempt("g2", () => { (holder as any).make = (a: string, b: string) => a + b; return holder.make("a", "b") })
// Callbacks: the caller was promised a number.
function apply(f: (n: number) => number, n: number): number { return f(n) * 2 }
attempt("h1", () => apply(untyped.bind(null, "x"), 5))
attempt("h2", () => apply(untyped, 5))
// Accessors count as functions.
class Gauge { raw: any = 1; get level(): number { return this.raw } }
attempt("i1", () => { const g = new Gauge(); g.raw = "high"; return g.level + 1 })
attempt("i2", () => new Gauge().level + 1)
// Nothing was promised: nothing is checked.
attempt("j1", () => untyped("5") + 1)
attempt("j2", () => typeof loose("3"))
