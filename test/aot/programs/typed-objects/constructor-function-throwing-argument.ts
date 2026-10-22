// `new F(a(), b())` where an argument throws: the function is read first, the arguments run from left to right, and nothing of the construction happens, neither the read of `prototype` nor the body. What an argument changes on its way is seen by the construction that follows.
const log: string[] = []
const note = <T>(label: string, value: T): T => { log.push(label); return value }
const fail = (label: string): never => { log.push(label + " throws"); throw new RangeError(label) }
const flush = (label: string, result?: unknown) => { console.log(label + ":", log.join(", "), "|", String(result)); log.length = 0 }
const attempt = (label: string, run: () => unknown) => { try { flush(label, run()) } catch (error) { flush(label, "threw " + (error as Error).constructor.name + (error instanceof RangeError ? " " + error.message : "")) } }
const show = (o: object): string => Object.keys(o).join() + " " + JSON.stringify(o)

interface Triple { a: number; b: number; c: number }
function Triple(this: Triple, a: number, b: number, c: number) { log.push("body"); this.a = a; this.b = b; this.c = c }
Triple.prototype.sum = function (this: Triple) { return this.a + this.b + this.c }
const TripleClass = Triple as unknown as new (a: number, b: number, c: number) => Triple
const sumOf = (triple: Triple) => triple.a + triple.b + triple.c

attempt("nothing throws", () => show(new TripleClass(note("a", 1), note("b", 2), note("c", 3))))
attempt("the first", () => new TripleClass(fail("a"), note("b", 2), note("c", 3)))
attempt("the second", () => new TripleClass(note("a", 1), fail("b"), note("c", 3)))
attempt("the last", () => new TripleClass(note("a", 1), note("b", 2), fail("c")))
attempt("one more than the function takes", () => new (TripleClass as any)(note("a", 1), note("b", 2), note("c", 3), fail("d")))
attempt("in a spread", () => new (TripleClass as any)(note("a", 1), ...[note("b", 2), fail("c")]))
attempt("an iterator that throws", () => new (TripleClass as any)(note("a", 1), ...(function* () { yield note("b", 2); fail("the iterator") })()))
attempt("a getter", () => new TripleClass(note("a", 1), ({ get b(): number { return fail("the getter") } }).b, note("c", 3)))
attempt("a conversion", () => new TripleClass(note("a", 1), +({ valueOf() { return fail("valueOf") } } as any), note("c", 3)))
attempt("a construction inside", () => new TripleClass(note("a", 1), sumOf(new TripleClass(note("inner a", 4), fail("inner b"), 6)), note("c", 3)))
attempt("a construction inside that succeeds", () => show(new TripleClass(note("a", 1), sumOf(new TripleClass(note("inner a", 4), note("inner b", 5), 6)), note("c", 3))))

// The function is read before its arguments run.
const holder: { make: any } = { make: TripleClass }
function Single(this: any, only: number) { log.push("the other body"); this.only = only }
attempt("the callee is replaced by an argument", () => show(new holder.make(note("a", 1), (holder.make = Single, note("b", 2)), 3)))
attempt("and the next construction", () => show(new holder.make(note("a", 1))))
holder.make = undefined
attempt("no constructor, and an argument that throws", () => new holder.make(fail("a")))
attempt("no constructor", () => new holder.make(note("a", 1)))
holder.make = () => 0
attempt("an arrow function", () => new holder.make(note("a", 1), note("b", 2)))
attempt("a variable in its dead zone", () => new notYet(note("a", 1)))
const notYet: any = TripleClass

// `prototype` is read after the arguments, once, and not at all if one throws.
const born = (Triple as Function).prototype, replacement = { sum() { return "replaced" } }
attempt("an argument replaces the prototype", () => { const made: any = new TripleClass(note("a", 1), (Triple.prototype = replacement, note("b", 2)), 3); return made.sum() + " " + (Object.getPrototypeOf(made) === replacement) })
Triple.prototype = born
attempt("an argument replaces the prototype and the next one throws", () => new TripleClass(note("a", 1), (Triple.prototype = replacement, note("b", 2)), fail("c")))
console.log(Triple.prototype === replacement, (new TripleClass(1, 2, 3) as any).sum())
Triple.prototype = born
log.length = 0
const watched: any = new Proxy(Triple, { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver) } })
attempt("a watched function", () => show(new watched(note("a", 1), note("b", 2), note("c", 3))))
attempt("a watched function, and an argument throws", () => new watched(note("a", 1), fail("b"), note("c", 3)))
attempt("a watched new.target", () => show(Reflect.construct(Triple, [note("a", 1), note("b", 2), note("c", 3)], watched)))
attempt("a watched new.target, and an argument throws", () => Reflect.construct(Triple, [note("a", 1), fail("b")], watched))
attempt("the read of prototype throws", () => Reflect.construct(Triple, [note("a", 1)], new Proxy(Triple, { get(target, key) { return fail("get " + String(key)) } })))

// A default value runs in the function: the object is there, and `prototype` has been read.
interface Defaults { a: number; b: number }
function Defaults(this: Defaults, a: number = note("default a", 10), b: number = fail("default b")) { log.push("body"); this.a = a; this.b = b }
const DefaultsClass = Defaults as unknown as new (a?: number, b?: number) => Defaults
const watchedDefaults: any = new Proxy(Defaults, { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver) } })
attempt("both given", () => show(new DefaultsClass(note("a", 1), note("b", 2))))
attempt("the second default throws", () => new DefaultsClass())
attempt("undefined takes the default", () => new DefaultsClass(note("a", 1), note("b", undefined)))
attempt("watched", () => new watchedDefaults())
interface Unpacks { x: number }
function Unpacks(this: Unpacks, { x }: { x: number }) { log.push("body"); this.x = x }
attempt("a pattern that has nothing to unpack", () => new (Unpacks as any)(note("a", undefined)))
attempt("a pattern whose getter throws", () => new (Unpacks as any)({ get x() { return fail("get x") } }))

// The body throws halfway: what it has stored so far is there for whoever holds the object.
const kept: any[] = []
interface Half { first: number; second: number; third: number }
function Half(this: Half, stop: number) { kept.push(this); this.first = 1; if (stop === 1) fail("after the first"); this.second = 2; if (stop === 2) fail("after the second"); this.third = 3 }
const HalfClass = Half as unknown as new (stop: number) => Half
for (const stop of [1, 2, 3]) attempt("stops at " + stop, () => show(new HalfClass(stop)))
console.log(kept.map(show).join(" | "), kept.every(each => each instanceof HalfClass))

let total = 0, thrown = 0
const sometimes = (round: number): number => { if (round % 7 === 3) throw new RangeError("round " + round); return round & 3 }
for (let round = 0; round < 21000; round++) {
  try { total += sumOf(new TripleClass(round & 1, sometimes(round), sometimes(round + 1))) } catch { thrown++ }
  log.length = 0
}
console.log(total, thrown, notYet === TripleClass)
