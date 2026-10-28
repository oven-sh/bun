function text(v: unknown): string { return Object.is(v, -0) ? "-0" : typeof v === "object" ? JSON.stringify(v) : String(v) }
interface Valued<T> { value: T }
class Cell<T> implements Valued<T> {
  constructor(public value: T, public next: Cell<T> | null = null) {}
  static of<U>(value: U): Cell<U> { return new Cell(value) }
  static chain<U>(...values: U[]): Cell<U> | null { let head: Cell<U> | null = null; for (let i = values.length - 1; i >= 0; i--) head = new Cell(values[i], head); return head }
  map<U>(f: (v: T) => U): Cell<U> { return new Cell(f(this.value), this.next === null ? null : this.next.map(f)) }
  toArray(): T[] { const out: T[] = []; for (let c: Cell<T> | null = this; c !== null; c = c.next) out.push(c.value); return out }
  replace(value: T): T { const old = this.value; this.value = value; return old }
}
class NumberCell extends Cell<number> { double(): number { return this.value * 2 } }
class Labelled<T> extends Cell<T> { constructor(value: T, public label: string) { super(value) } describe(): string { return this.label + "=" + text(this.value) } }
const n = new Cell(1.5)
const s = new Cell("s")
const o = new Cell({ deep: [1] })
const u = new Cell<number | undefined>(undefined)
const made = Cell.of(-0)
const numberCell = new NumberCell(21)
const labelled = new Labelled(true, "flag")
console.log(n.value + 1, s.value + 1, o.value.deep.length, u.value, Object.is(made.value, -0), numberCell.double(), labelled.describe())
console.log([n, s, o, u, made, numberCell, labelled].map(c => Object.keys(c).join("") + JSON.stringify(c) + (c instanceof Cell) + (c.constructor === Cell)).join(" "))
console.log(Object.getPrototypeOf(n) === Object.getPrototypeOf(s), n.map === (s.map as unknown), Object.getPrototypeOf(numberCell) === NumberCell.prototype, numberCell instanceof Cell)

const edges = [0, -0, NaN, 2 ** 31, -(2 ** 31) - 1, 1e300, 0.1]
console.log(edges.map(v => text(n.replace(v))).join(), text(n.value), edges.map(v => text(Cell.of(v).value)).join(), edges.map(v => text(new NumberCell(v).double())).join())
console.log(s.replace(""), s.replace("x") === "", text(o.replace({ deep: [] })), text(u.replace(3)), text(u.replace(undefined)), "value" in u)

const chain = Cell.chain(1, 2, 3.5)!
const words = Cell.chain("a", "b")!
console.log(chain.toArray().join(), chain.map(v => v * 2).toArray().join(), chain.map(v => "n" + v).toArray().join(), words.map(w => w.length).toArray().reduce((x, y) => x + y, 0), words.map(w => ({ w })).toArray().map(text).join(), Cell.chain<boolean>())
chain.next!.next!.next = numberCell
console.log(chain.toArray().join(), (chain.next!.next!.next as NumberCell).double(), chain.map(String).toArray().join("|"))

// Instances and literals through one interface.
function read<T>(v: Valued<T>): T { return v.value }
function write<T>(v: Valued<T>, value: T): void { v.value = value }
const numbersByInterface: Valued<number>[] = [n, made, numberCell, { value: 4 }, chain, JSON.parse('{"value":6}')]
console.log(numbersByInterface.map(read).map(text).join())
numbersByInterface.forEach((v, i) => write(v, i + 0.5))
console.log(n.value, made.value, numberCell.double(), chain.value, numbersByInterface.map(v => Object.keys(v).join("")).join())

class Stack<T> {
  private items: T[] = []
  size = 0
  push(x: T): this { this.items.push(x); this.size++; return this }
  pop(): T | undefined { if (this.size > 0) this.size--; return this.items.pop() }
  peek(): T | undefined { return this.items[this.size - 1] }
}
const stack = new Stack<number>().push(1).push(2.5)
const stackOfCells = new Stack<Cell<string>>().push(s).push(words)
console.log(stack.peek(), stack.pop(), stack.pop(), stack.pop(), stack.peek(), stack.size, stackOfCells.peek()?.value, stackOfCells.pop()?.toArray().join(), stackOfCells.size, JSON.stringify(stackOfCells))

class Both<A, B> {
  constructor(public first: A, public second: B) {}
  swap(): Both<B, A> { return new Both(this.second, this.first) }
  mapFirst<C>(f: (a: A) => C): Both<C, B> { return new Both(f(this.first), this.second) }
}
const both = new Both(1, "one")
console.log(both.swap().first + "!", both.swap().second + 1, both.swap().swap().first + 1, JSON.stringify(both.swap()), both.mapFirst(x => [x]).first.length, both.mapFirst(x => x / 4).swap().second, both.swap() instanceof Both)

class Lazy<T> {
  private cached?: T
  private done = false
  runs = 0
  constructor(private make: () => T) {}
  get(): T { if (!this.done) { this.cached = this.make(); this.done = true; this.runs++ } return this.cached as T }
}
const lazyNumber = new Lazy(() => 0.25)
const lazyNothing = new Lazy<undefined>(() => undefined)
const lazyCell = new Lazy(() => new Cell("made late"))
console.log(Object.keys(lazyNumber).join(), lazyNumber.get() + lazyNumber.get(), lazyNumber.runs, lazyNothing.get(), lazyNothing.get(), lazyNothing.runs, lazyCell.get() === lazyCell.get(), lazyCell.get().value, Object.keys(lazyNumber).join())

class Registry<V extends { id: number }> {
  private byId: Record<number, V> = {}
  count = 0
  add(v: V): V { if (!(v.id in this.byId)) this.count++; this.byId[v.id] = v; return v }
  find(id: number): V | undefined { return this.byId[id] }
  ids(): string { return Object.keys(this.byId).join() }
}
const registry = new Registry<{ id: number; label?: string }>()
registry.add({ id: 7, label: "seven" }); registry.add({ id: 2 }); registry.add({ id: 7 })
console.log(registry.count, registry.ids(), registry.find(7)?.label, registry.find(2)?.id, registry.find(3), "label" in registry.find(7)!)

let total = 0
const mixedCells: Cell<number>[] = [n, made, numberCell, chain, Cell.of(3), new Labelled(4, "l")]
for (let i = 0; i < 5000; i++) { const c = mixedCells[i % mixedCells.length]; total += c.value + read(c) + c.toArray().length }
console.log(total)
