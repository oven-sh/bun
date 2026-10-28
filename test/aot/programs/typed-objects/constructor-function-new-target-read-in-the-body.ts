// A constructor function reads `new.target`: the function itself under `new`, whatever Reflect.construct() or a subclass names, and undefined in a plain call.
// VALIDATED compiles
const show = (o: object): string => Object.keys(o).join() + " " + JSON.stringify(o)
const attempt = (label: string, run: () => unknown) => { try { console.log(label, String(run())) } catch (error) { console.log(label, "throws", (error as Error).constructor.name) } }
const nameOf = (target: unknown): string => (typeof target === "function" ? target.name || "no name" : String(target))

interface Record1 { how: string; isOwn: boolean; value: number }
function Record1(this: Record1, value: number) { this.how = nameOf(new.target); this.isOwn = (new.target as unknown) === Record1; this.value = value }
const Record1Class = Record1 as unknown as new (value: number) => Record1
function Other() {}
class Modern {}
class Heir extends (Record1 as any) { constructor(value: number) { super(value) } }
class Grandchild extends Heir {}
const given: any = {}

console.log("new:", show(new Record1Class(1)))
console.log("no parentheses:", show(new (Record1 as any)))
console.log("Reflect.construct:", show(Reflect.construct(Record1, [2])), show(Reflect.construct(Record1, [3], Record1)), show(Reflect.construct(Record1, [4], Other)), show(Reflect.construct(Record1, [5], Modern)))
console.log("classes below it:", show(new Heir(6)), show(new (Grandchild as any)(7)), show(Reflect.construct(Heir, [8], Record1)), show(Reflect.construct(Heir, [9], Other)))
console.log("plain calls:", Record1.call(given, 10), show(given), Reflect.apply(Record1, given, [11]), show(given), (Record1 as any).bind(given)(12), show(given))
const bound = (Record1 as any).bind({ ignored: true }, 13), boundTwice = bound.bind(null)
console.log("bound:", show(new bound()), show(new boundTwice()), show(Reflect.construct(bound, [], bound)), show(Reflect.construct(bound, [], Other)), show(Reflect.construct(Record1, [14], bound)))
const proxy: any = new Proxy(Record1, {})
console.log("a proxy:", show(new proxy(15)), new proxy(16).isOwn, show(Reflect.construct(Record1, [17], proxy)))

// Callable with and without `new`.
interface Either { value: number; depth: number }
function Either(this: Either | undefined, value: number, depth = 0): Either | undefined {
  if (!new.target) return new (Either as any)(value, depth + 1)
  this!.value = value; this!.depth = depth
  return undefined
}
const either: any = Either
console.log(show(either(1)), show(new either(2)), show(either.call({ unused: true }, 3)), either(4) instanceof either, show(Reflect.construct(Either, [5], Other)), Reflect.construct(Either, [6], Other) instanceof either)

// Refuses one of the two.
function OnlyNew(this: any) { if (new.target === undefined) throw new TypeError("needs new"); this.made = true }
function NeverNew(this: any) { if (new.target) throw new TypeError("no new"); return "called" }
function OnlyItself(this: any) { if ((new.target as unknown) !== OnlyItself) throw new TypeError("abstract"); this.made = true }
function NeverItself(this: any) { if ((new.target as unknown) === NeverItself) throw new TypeError("abstract"); this.made = nameOf(new.target) }
class Concrete extends (NeverItself as any) {}
class TooDeep extends (OnlyItself as any) {}
attempt("needs new, has it:", () => show(new (OnlyNew as any)()))
attempt("needs new, has none:", () => (OnlyNew as any)())
attempt("no new, has one:", () => new (NeverNew as any)())
attempt("no new, has none:", () => (NeverNew as any)())
attempt("only itself:", () => show(new (OnlyItself as any)()))
attempt("only itself, below:", () => new TooDeep())
attempt("never itself:", () => new (NeverItself as any)())
attempt("never itself, below:", () => show(new Concrete()))

// What new.target has: its prototype, its own properties, a construction of it.
interface Reads { fromPrototype: string; fromStatic: string; sameAsOwn: boolean }
function Reads(this: Reads) {
  const target: any = new.target
  this.fromPrototype = target.prototype.mark
  this.fromStatic = target.mark
  this.sameAsOwn = Object.getPrototypeOf(this) === target.prototype
}
Reads.prototype.mark = "the prototype of Reads"
;(Reads as any).mark = "Reads"
function Marked() {}
Marked.prototype.mark = "the prototype of Marked"
;(Marked as any).mark = "Marked"
console.log(show(new (Reads as any)()), show(Reflect.construct(Reads, [], Marked)))
interface Chain { depth: number; inner: Chain | null }
function Chain(this: Chain, depth: number) { this.depth = depth; this.inner = depth > 0 ? new (new.target as any)(depth - 1) : null }
class ChainBelow extends (Chain as any) { below = true }
console.log(JSON.stringify(new (Chain as any)(2)), JSON.stringify(new (ChainBelow as any)(1)))

// Where else it can be read: arrow functions see the one of the function around them, other functions have their own.
interface Nested { arrow: string; later: () => string; inner: string; constructedInner: string; parameter: string; evaluated: string }
function Nested(this: Nested, parameter = nameOf(new.target)) {
  const arrow = () => nameOf(new.target)
  function inner(this: any) { return nameOf(new.target) }
  function Constructed(this: any) { this.seen = nameOf(new.target) }
  this.arrow = arrow()
  this.later = () => (() => nameOf(new.target))()
  this.inner = inner()
  this.constructedInner = new (Constructed as any)().seen
  this.parameter = parameter
  this.evaluated = [1].map(() => nameOf(new.target)).join()
}
for (const made of [new (Nested as any)(), Reflect.construct(Nested, [], Other), (Nested.call(given), given)]) console.log(JSON.stringify(made), made.later())

// It is a value like any other: kept, compared, passed on, and gone when the call is over.
const seen: unknown[] = []
function Keeps(this: any, passTo: (target: unknown) => void) { seen.push(new.target); passTo(new.target); this.type = typeof new.target }
const passed: string[] = []
for (const target of [Keeps, Other, Modern]) Reflect.construct(Keeps, [(value: unknown) => passed.push(nameOf(value))], target)
Keeps.call({}, (value: unknown) => passed.push(nameOf(value)))
console.log(seen.map(nameOf).join(), passed.join(), seen[0] === Keeps, seen[1] === Other, seen[3] === undefined, show(new (Keeps as any)(() => {})))

let own = 0, foreign = 0, none = 0
const targets: Function[] = [Record1, Other, Record1, Heir]
for (let round = 0; round < 16000; round++) {
  const made: Record1 = round & 1 ? new Record1Class(round) : Reflect.construct(Record1, [round], targets[(round >> 1) & 3])
  if (made.isOwn) own++; else foreign++
  if (round % 16 === 0) { Record1.call(given, round); if (given.how === "undefined") none++ }
}
console.log(own, foreign, none)
