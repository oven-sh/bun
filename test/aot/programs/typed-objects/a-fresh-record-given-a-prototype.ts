// Object.setPrototypeOf on a record that nothing has seen since its allocation is a compare and a store. Every other case goes the long way, and all behave as without --aot.
// VALIDATED compiles
declare const gc: undefined | (() => void)
interface Point { x: number; y: number }
const kinds: object[] = []
for (let i = 0; i < 40; i++) kinds.push({ kind() { return "kind " + i } })
function make(x: number, prototype: object | null): Point {
  const made: Point = { x, y: x + 1 }
  Object.setPrototypeOf(made, prototype)
  return made
}
function makeSeen(x: number, seen: unknown[], prototype: object): Point {
  const made: Point = { x, y: x + 1 }
  seen.push(made)
  Object.setPrototypeOf(made, prototype)
  return made
}
const sum = (point: Point) => point.x + point.y
const kindOf = (point: any): string => (typeof point.kind === "function" ? point.kind() : "none")
let total = 0
const said: string[] = []
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < kinds.length; i++) {
    const point = make(i, kinds[i]), again = make(i, kinds[i])
    total += sum(point) + sum(again)
    if (Object.getPrototypeOf(point) !== kinds[i] || Object.getPrototypeOf(again) !== kinds[i] || kindOf(point) !== "kind " + i) said.push("wrong at " + i)
  }
  if (typeof gc === "function") gc()
}
console.log(total, said.join())
const bare = make(1, null)
console.log(Object.getPrototypeOf(bare), sum(bare), kindOf(bare), Object.keys(bare).join())
const seen: unknown[] = []
const known = makeSeen(2, seen, kinds[3])
console.log(seen[0] === known, kindOf(known), sum(known))
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())) } catch (error) { console.log(what, (error as Error).constructor.name) } }
attempt("a number", () => sum(make(3, JSON.parse("5"))))
attempt("undefined", () => sum(make(3, JSON.parse("[]")[0])))
attempt("a cycle", () => { const base: Point = { x: 1, y: 2 }; const heir = Object.create(base); Object.setPrototypeOf(base, heir); return "no error" })
attempt("itself", () => { const self: Point = { x: 1, y: 2 }; Object.setPrototypeOf(self, self); return "no error" })
attempt("frozen", () => { const frozen: Point = { x: 1, y: 2 }; Object.freeze(frozen); Object.setPrototypeOf(frozen, kinds[0]); return "no error" })
attempt("not extensible, the same prototype", () => { const closed = make(1, kinds[0]); Object.preventExtensions(closed); Object.setPrototypeOf(closed, kinds[0]); return kindOf(closed) })
const withAccessor = { get x() { return "inherited x" }, set y(value: number) { said.push("the setter ran") }, kind() { return "accessors" } }
const shadowing = make(7, withAccessor)
shadowing.y = 9
console.log(sum(shadowing), kindOf(shadowing), (shadowing as any).x, said.join())
const changing = { kind() { return "before" } }
const early = make(1, changing)
changing.kind = () => "after"
;(changing as any).more = 1
console.log(kindOf(early), kindOf(make(2, changing)), (make(3, changing) as any).more)
