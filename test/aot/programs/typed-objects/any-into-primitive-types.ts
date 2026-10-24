// A value of type `any` reaches a variable, assignment, return, argument, field, array element or `catch` variable declared `number`, `string` or `boolean`.
/* expected
a1 TypeError
a2 5
a3 TypeError
a4 four!
a5 TypeError
a6 no
a7 TypeError
a8 TypeError
a9 TypeError
a10 TypeError
a11 TypeError
a12 TypeError
a13 NaN
a14 -Infinity
a15 1e+300
b1 TypeError
b2 0
b3 12
c1 TypeError
c2 14
d1 TypeError
d2 8
e1 TypeError
e2 1/c/{"count":1,"label":"c"}
e3 TypeError
e4 2
e5 2/c
f1 TypeError
f2 l3
f3 TypeError
f4 TypeError
f5 x
g1 TypeError
g2 1
g3 undefined
g3t undefined
g4 1,6
h1 s
h2 TypeError
h3 undefined
h4 null
h5 TypeError
j1 TypeError
j2 42
k1 8
k2 42
k3 41
k4 string
k5 4true
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): any => v
attempt("a1", () => { const n: number = hide("s"); return n + 1 })
attempt("a2", () => { const n: number = hide(4); return n + 1 })
attempt("a3", () => { const s: string = hide(4); return s + "!" })
attempt("a4", () => { const s: string = hide("four"); return s + "!" })
attempt("a5", () => { const b: boolean = hide(1); return b ? "yes" : "no" })
attempt("a6", () => { const b: boolean = hide(false); return b ? "yes" : "no" })
attempt("a7", () => { const n: number = hide(true); return n })
// An object or a function is of another kind too, and nothing is converted.
attempt("a8", () => { const n: number = hide({}); return n })
attempt("a9", () => { const s: string = hide(["x"]); return s })
attempt("a10", () => { const n: number = hide(10n); return n })
attempt("a11", () => { const s: string = hide(Symbol("x")); return typeof s })
attempt("a12", () => { const n: number = hide(new Number(5)); return n })
attempt("a13", () => { const n: number = hide(NaN); return n })
attempt("a14", () => { const n: number = hide(-0); return 1 / n })
attempt("a15", () => { const n: number = hide(1e300); return n })
let total: number = 0
attempt("b1", () => { total = hide("12"); return total })
attempt("b2", () => total)
attempt("b3", () => { total = hide(12); return total })
function toNumber(v: any): number { return v }
attempt("c1", () => toNumber("7") * 2)
attempt("c2", () => toNumber(7) * 2)
function double(n: number): number { return n * 2 }
attempt("d1", () => double(hide("4")))
attempt("d2", () => double(hide(4)))
interface Counter { count: number; label: string }
const counter: Counter = { count: 1, label: "c" }
attempt("e1", () => { counter.count = hide("2"); return counter.count })
attempt("e2", () => counter.count + "/" + counter.label + "/" + JSON.stringify(counter))
attempt("e3", () => { counter.label = hide(2); return counter.label })
attempt("e4", () => { counter.count = hide(2); return counter.count })
attempt("e5", () => counter.count + "/" + counter.label)
attempt("f1", () => { const made: Counter = { count: hide("x"), label: "l" }; return made.label })
attempt("f2", () => { const made: Counter = { count: hide(3), label: hide("l") }; return made.label + made.count })
attempt("f3", () => { const made: Counter = { ...{ label: "l" }, count: hide("x") }; return made.label })
attempt("f4", () => { const count = hide("x"); const made: Counter = { count, label: "l" }; return made.label })
attempt("f5", () => { const made = { count: hide("x"), label: "l" }; return made.count })
const numbers: number[] = [1]
attempt("g1", () => { numbers[1] = hide("s"); return numbers.length })
attempt("g2", () => numbers.length)
attempt("g3", () => numbers[1])
attempt("g3t", () => { const n: number = numbers[1]; return n })
attempt("g4", () => { numbers[1] = hide(6); return numbers.join() })
attempt("h1", () => { const u: number | string = hide("s"); return u })
attempt("h2", () => { const u: number | string = hide(true); return String(u) })
attempt("h3", () => { const u: number | undefined = hide(undefined); return u })
attempt("h4", () => { const u: string | null = hide(null); return u })
attempt("h5", () => { const u: number | undefined = hide("s"); return u })
attempt("j1", () => { try { throw "boom" } catch (e: any) { const code: number = e; return code } })
attempt("j2", () => { try { throw 42 } catch (e: any) { const code: number = e; return code } })
// No declared type is entered: nothing is checked.
attempt("k1", () => hide("4") * 2)
attempt("k2", () => hide("4") + 2)
attempt("k3", () => { const v = hide("4"); return v + 1 })
attempt("k4", () => { const v: unknown = hide("4"); return typeof v })
attempt("k5", () => { const list: any[] = [hide("4"), hide(true)]; return list.join("") })
