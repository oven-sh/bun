// Getters and setters of classes: read through interface types, and overridden only in part by subclasses.
interface Sized { size: number }
interface Titled { title: string; size?: number }
const seen: string[] = []
function flush(): string { return seen.splice(0).join(",") }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class Bag implements Sized {
  items: number[] = []
  get size(): number { seen.push("get"); return this.items.length }
  set size(n: number) { seen.push("set" + n); this.items.length = n }
}
class Fixed implements Sized { size = 3 }
class GetOnly implements Sized { get size(): number { return 42 } }
class Half extends Bag { override get size(): number { return super.size + 100 } }
class Both extends Bag {
  override get size(): number { return super.size * 2 }
  override set size(n: number) { super.size = n + 1 }
}
function grow(s: Sized): number { s.size += 2; return s.size }
console.log(attempt(() => grow(new Bag())), flush())
console.log(attempt(() => grow(new Fixed())), attempt(() => grow({ size: 1 })), attempt(() => grow(new GetOnly())), flush() === "")
console.log(attempt(() => grow(new Half())), flush())
console.log(attempt(() => grow(new Both())), flush())
const bag = new Bag()
bag.size = (seen.push("rhs"), 1)
console.log(flush(), "size" in bag, Object.hasOwn(bag, "size"), JSON.stringify(bag), Object.keys(bag).join(), bag.size++, bag.size, flush())
const sizes: Sized[] = [new Fixed(), new GetOnly(), { size: 1 }, new Both(), bag]
let total = 0
for (let i = 0; i < 50; i++) total += sizes[i % sizes.length].size
console.log(total, flush().length)
// An optional field of an interface that one class answers with a getter on its prototype.
class Paper implements Titled { title = "paper"; get size(): number { seen.push("paper"); return 9 } }
class Blank implements Titled { title = "blank" }
function sizeOr(t: Titled): string { return t.title + ":" + String(t.size) + ":" + ("size" in t) + ":" + Object.hasOwn(t, "size") }
const titled: Titled[] = [new Paper(), new Blank(), { title: "lit" }, { title: "lit2", size: 1 }]
console.log(titled.map(t => sizeOr(t)).join(" "), flush())
console.log(titled.map(t => attempt(() => { t.size = 5; return t.size })).join(), Object.keys(titled[1]).join(), flush())
// A getter that throws, static ones, a setter alone.
class Moody { mood = 0; get risky(): number { if (this.mood++ % 2 === 0) throw new RangeError("even"); return this.mood } }
const moody = new Moody()
console.log(attempt(() => moody.risky), attempt(() => moody.risky), attempt(() => moody.risky + moody.risky), moody.mood)
class Tally { static #n = 0; static get next(): number { return ++Tally.#n } static set next(x: number) { Tally.#n = x } }
console.log(Tally.next, Tally.next, (Tally.next = 10), Tally.next, Tally.next++, Tally.next)
class Sink { last = 0; set value(x: number) { this.last = x * 2 } }
const sink = new Sink()
sink.value = 4
console.log(sink.last, (sink as any).value, "value" in sink, JSON.stringify(sink))
