// Typed functions, methods, constructors and setters are called from code that does not know their types.
/* expected
a1 8
a2 TypeError
a3 A
a4 TypeError
a5 TypeError
a6 true
a7 4
a8 TypeError
a9 8
b1 TypeError
b2 TypeError
b3 TypeError
b4 8
b5 TypeError
b6 8
c1 TypeError
c2 2,4
d1 TypeError
d2 0
d3 20
d4 TypeError
d5 3
e1 3
e2 TypeError
e3 11
e4 11
e5 TypeError
e6 undefined
e7 TypeError
e8 number
f1 TypeError
f2 1
f3 5
g1 string
g2 number
g3 TypeError
h1 TypeError
h2 6
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
function twice(n: number): number { return n * 2 }
function shout(s: string): string { return s.toUpperCase() }
function flip(b: boolean): boolean { return !b }
const loose: any = { twice, shout, flip }
attempt("a1", () => loose.twice(4))
attempt("a2", () => loose.twice("4"))
attempt("a3", () => loose.shout("a"))
attempt("a4", () => loose.shout(5))
attempt("a5", () => loose.flip(0))
attempt("a6", () => loose.flip(false))
attempt("a7", () => loose.twice(2, "extra", {}))
// It makes no difference that the compiler can see which function is called.
attempt("a8", () => (twice as any)("4"))
attempt("a9", () => (twice as any)(4))
attempt("b1", () => twice.call(null, "4" as any))
attempt("b2", () => twice.apply(null, ["4"] as any))
attempt("b3", () => Reflect.apply(twice, null, ["4"]))
attempt("b4", () => Reflect.apply(twice, null, [4]))
attempt("b5", () => (twice.bind(null) as any)("4"))
attempt("b6", () => (twice.bind(null) as any)(4))
attempt("c1", () => (["1", "2"] as any[]).map(twice).join())
attempt("c2", () => [1, 2].map(twice).join())
class Temp {
  static made = 0
  constructor(public degrees: number) { Temp.made++ }
  add(n: number) { return this.degrees + n }
}
attempt("d1", () => new (Temp as any)("hot").degrees)
attempt("d2", () => Temp.made)
attempt("d3", () => new (Temp as any)(20).degrees)
attempt("d4", () => (new Temp(1) as any).add("2"))
attempt("d5", () => (new Temp(1) as any).add(2))
function sumAll(...ns: number[]): number { let s = 0; for (const n of ns) s += n; return s }
function withDefault(n: number = 10): number { return n + 1 }
function optional(n?: number): string { return typeof n }
attempt("e1", () => (sumAll as any)(1, 2))
attempt("e2", () => (sumAll as any)(1, "2"))
attempt("e3", () => (withDefault as any)())
attempt("e4", () => (withDefault as any)(undefined))
attempt("e5", () => (withDefault as any)("1"))
attempt("e6", () => (optional as any)())
attempt("e7", () => (optional as any)("x"))
attempt("e8", () => (optional as any)(1))
class Dial { private at = 1; set value(n: number) { this.at = n } get value(): number { return this.at } }
const dial = new Dial()
attempt("f1", () => { (dial as any).value = "x"; return "stored" })
attempt("f2", () => dial.value)
attempt("f3", () => { (dial as any).value = 5; return dial.value })
function either(v: number | string): string { return typeof v }
attempt("g1", () => (either as any)("s"))
attempt("g2", () => (either as any)(1))
attempt("g3", () => (either as any)(true))
// A closure handed out as a callback.
function adder(base: number): (n: number) => number { return (n: number) => base + n }
const handed: any = adder(1)
attempt("h1", () => handed("5"))
attempt("h2", () => handed(5))
