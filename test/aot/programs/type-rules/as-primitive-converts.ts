// `x as T` where `T` is a primitive type and `x` is `unknown`, `any` or a union.
/* expected
a1 NaN
a2 2
a3 1
a4 3
a5 true
a6 true
a7 number
a8 string
b1 NaN
b2 2
b3 1
b4 ONE
c1 6
c2 6
c3 6
c4 6
d1 51
d2 true
d3 string
d4 string
d5 number
e1 6
e2 5
e3 1x
f1 TypeError
f2 bigint
f3 TypeError
f4 symbol
g1 1,2,3
g2 1,2,3
g3 8
g4 8
h1 5
h2 purple
h3 1
h4 9
h5 1
h6 z
h7 1
h8 2.5
h9 false
h10 false
h11 NaN
h12 -8
h13 null
h14 NaN
h15 TypeError
h16 blue
h17 5
h18 no
h19 5
h20 2
h21 2.5
h22 2.5
h23 2147483648
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): unknown => v
attempt("a1", () => (hide("s") as number) + 1)
attempt("a2", () => (hide(1) as number) + 1)
attempt("a3", () => (hide(1) as string).length)
attempt("a4", () => (hide("abc") as string).length)
attempt("a5", () => (hide("true") as boolean) === true)
attempt("a6", () => (hide(true) as boolean) === true)
attempt("a7", () => typeof (hide({ valueOf() { return 1 } }) as number))
attempt("a8", () => typeof (hide([1]) as string))
function pick(flag: boolean): number | string { return flag ? 1 : "one" }
attempt("b1", () => (pick(false) as number) * 2)
attempt("b2", () => (pick(true) as number) * 2)
attempt("b3", () => (pick(true) as string).toUpperCase())
attempt("b4", () => (pick(false) as string).toUpperCase())
attempt("c1", () => ("5" as unknown as number) + 1)
attempt("c2", () => (5 as unknown as number) + 1)
attempt("c3", () => (<number><unknown>"5") + 1)
attempt("c4", () => ((hide("5") as any) as number) + 1)
// Casts to any, unknown and to a union that has the kind do nothing. A value of none of the kinds of a union: ToPrimitive, then ToString if a string is among them.
attempt("d1", () => ("5" as any) + 1)
attempt("d2", () => ("5" as unknown as any as unknown) === "5")
attempt("d3", () => typeof (hide("5") as number | string))
attempt("d4", () => typeof (hide(true) as number | string))
attempt("d5", () => typeof (hide(5) as number | string | boolean))
attempt("e1", () => (5 as const) + 1)
attempt("e2", () => ({ n: 5 } satisfies { n: number }).n)
attempt("e3", () => String(pick(true) as number | string) + "x")
attempt("f1", () => typeof (hide(5) as bigint))
attempt("f2", () => typeof (hide(5n) as bigint))
attempt("f3", () => typeof (hide("s") as symbol))
attempt("f4", () => typeof (hide(Symbol.iterator) as symbol))
// The converted value goes on into a typed place.
const kept: number[] = [1, 2]
attempt("g1", () => { kept.push(hide("3") as number); return kept.join() })
attempt("g2", () => kept.join())
interface Cell { v: number }
const cell: Cell = { v: 7 }
attempt("g3", () => { cell.v = hide("8") as number; return cell.v })
attempt("g4", () => cell.v)
// The values of a literal type or an enum are not validated, so they are not facts: the cast converts to the WIDENED primitive: a string, a number, a boolean. `null` and
// `undefined` pass where that is a string, as for every reference, and are converted where it is a number. A declared slot of the literal type is tested like any other.
type Colour = "red" | "green"
enum Small { Zero, One, Two }
enum Word { A = "a", B = "b" }
const enum Flag { None = 0, X = 1, Y = 2 }
attempt("h1", () => hide(5) as Colour)
attempt("h2", () => hide("purple") as Colour)
attempt("h3", () => hide("1") as Small)
attempt("h4", () => hide(9) as Small)
attempt("h5", () => hide(1) as Word)
attempt("h6", () => hide("z") as Word)
attempt("h7", () => { const v = hide(true) as 0 | 1; return v })
attempt("h8", () => hide(2.5) as 0 | 1)
attempt("h9", () => { const v = hide(0) as true; return v })
attempt("h10", () => hide(false) as true)
attempt("h11", () => { const v = hide("x") as Flag; return v })
attempt("h12", () => hide(-8) as Flag)
attempt("h13", () => hide(null) as Colour)
attempt("h14", () => hide(undefined) as Small)
attempt("h15", () => { const c: Colour = hide(5) as any; return c })
attempt("h16", () => { const c: Colour = hide("blue") as any; return c })
attempt("h17", () => hide(5) as `id${number}`)
attempt("h18", () => hide("no") as `id${number}`)
attempt("h19", () => hide(5) as 1 | 2 | 3)
attempt("h20", () => hide(2) as 1 | 2 | 3)
attempt("h21", () => hide(2.5) as 1 | 2 | 3)
attempt("h22", () => hide(2.5) as Small)
attempt("h23", () => hide(2 ** 31) as Flag)
