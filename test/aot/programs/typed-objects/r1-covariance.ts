// TypeScript's own unsoundness (covariant fields, generics, bivariant method parameters, index signatures) puts a value of another kind into a primitive type without any cast.
/* expected
a1 2
a2 text
a3 TypeError
a4 text
a5 {"v":"text"}
a6 6
b1 TypeError
b2 0
b3 3
c1 TypeError
c2 s
c3 8
d1 TypeError
d2 2v,w
e1 TypeError
e2 s
e3 5
f1 TypeError
f2 ok 2
g1 TypeError
g2 4
*/
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
interface Narrow { v: number }
interface Wide { v: number | string }
const narrow: Narrow = { v: 1 }
const wide: Wide = narrow
attempt("a1", () => narrow.v + 1)
attempt("a2", () => { wide.v = "text"; return wide.v })
attempt("a3", () => narrow.v)
attempt("a4", () => wide.v)
attempt("a5", () => JSON.stringify(narrow))
attempt("a6", () => { wide.v = 5; return narrow.v + 1 })
// Method parameters are bivariant.
interface Sink { put(v: number | string): void }
class NumberSink { last = 0; put(v: number) { this.last = v } }
const numberSink = new NumberSink()
const sink: Sink = numberSink
attempt("b1", () => { sink.put("s"); return "stored" })
attempt("b2", () => numberSink.last)
attempt("b3", () => { sink.put(3); return numberSink.last })
interface Box<T> { value: T }
const ofNumber: Box<number> = { value: 1 }
const ofEither: Box<number | string> = ofNumber
attempt("c1", () => { ofEither.value = "s"; return ofNumber.value })
attempt("c2", () => ofEither.value)
attempt("c3", () => { ofEither.value = 7; return ofNumber.value + 1 })
// A type literal has an implicit index signature.
type Lit = { v: number }
const lit: Lit = { v: 1 }
const dict: { [k: string]: number | string } = lit
attempt("d1", () => { dict["v"] = "d"; return lit.v })
attempt("d2", () => { dict["w"] = "extra"; dict["v"] = 2; return lit.v + Object.keys(lit).join() })
class Loose { v: number | string = 1 }
class Strict extends Loose { declare v: number; plus() { return this.v + 1 } }
const strict = new Strict()
const asLoose: Loose = strict
attempt("e1", () => { asLoose.v = "s"; return strict.plus() })
attempt("e2", () => asLoose.v)
attempt("e3", () => { asLoose.v = 4; return strict.plus() })
// A callback that takes less than it is given.
function feed(f: (v: number | string) => string): string { return f("fed") }
class Eater { eat(v: number): string { return "ok " + (v + 1) } }
const eater: { eat(v: number | string): string } = new Eater()
attempt("f1", () => feed(v => eater.eat(v)))
attempt("f2", () => eater.eat(1))
// Readonly is no protection either.
const frozenView: Readonly<Narrow> = narrow
attempt("g1", () => { wide.v = "again"; return frozenView.v })
attempt("g2", () => { wide.v = 3; return frozenView.v + 1 })
