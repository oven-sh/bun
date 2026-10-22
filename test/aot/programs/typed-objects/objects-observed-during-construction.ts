// Objects that are observed before their constructor has finished: registered, passed to a callback, or left half-initialized by an exception.
enum Kind { Leaf, Pair, Named }
type Mutable<T extends object> = { -readonly [K in keyof T]: T[K] }
interface Nd { readonly kind: Kind; serial: number; note?: string }
interface Leaf extends Nd { readonly kind: Kind.Leaf; readonly value: number }
interface Pair extends Nd { readonly kind: Kind.Pair; readonly first: Nd; readonly second: Nd; readonly weight: number }
interface Named extends Nd { readonly kind: Kind.Named; readonly label: string; readonly target?: Nd }
const registry: Nd[] = []
let onCreate: ((node: Nd) => void) | undefined
function Nd(this: Mutable<Nd>, kind: Kind) {
  this.kind = kind
  this.serial = registry.length
  registry.push(this)
  if (onCreate) onCreate(this)
}
const NdCtor = Nd as any as new (kind: Kind) => Nd
function base<T extends Nd>(kind: T["kind"]) { return new NdCtor(kind) as Mutable<T> }
function leaf(value: number): Leaf { const node = base<Leaf>(Kind.Leaf); node.value = value; return node }
function pair(first: () => Nd, second: () => Nd): Pair {
  const node = base<Pair>(Kind.Pair)
  node.first = first()
  node.weight = registry.length
  node.second = second()
  return node
}
function named(label: string, target?: Nd): Named {
  const node = base<Named>(Kind.Named)
  if (target) node.target = target
  node.label = label
  return node
}
function keys(o: object): string { return Object.keys(o).join() }
function last(): Nd { return registry[registry.length - 1] }
function attempt(label: string, f: () => string) { try { console.log(label, f()) } catch (e) { console.log(label, (e as Error).constructor.name, keys(last())) } }
function withHook<T>(hook: (node: Nd) => void, f: () => T): T { onCreate = hook; try { return f() } finally { onCreate = undefined } }

const seen: string[] = []
const p0 = withHook(n => seen.push(Kind[n.kind] + ":" + keys(n) + ":" + ("value" in n) + ("first" in n) + n.note), () => pair(() => leaf(1), () => named("n", leaf(2))))
console.log(seen.join(" "), keys(p0), keys(p0.first), keys(p0.second), p0.weight, registry.length)

// The thunks run while the pair is half made and find it in the registry.
function halfMade(): string { const half = registry.filter(n => n.kind === Kind.Pair).pop() as Pair; return keys(half) + " " + half.serial + " " + ("weight" in half) + " " + (half.first === undefined) + " " + (half.second === undefined) + " " + half.note }
const notes: string[] = []
const p1 = pair(() => { notes.push(halfMade()); return leaf(3) }, () => { notes.push(halfMade()); return leaf(4) })
notes.push(halfMade())
console.log(notes.join(" | "), (p1.first as Leaf).value + (p1.second as Leaf).value)

attempt("field first", () => { const l = withHook(n => { (n as any).value = 100 }, () => leaf(6)); const m = withHook(n => { (n as any).label = "pre"; (n as any).target = undefined }, () => named("post", l)); return keys(l) + " " + l.value + " " + keys(m) + " " + m.label + (m.target === l) })
attempt("not extensible", () => keys(withHook(n => { Object.preventExtensions(n) }, () => leaf(7))))
attempt("frozen", () => keys(withHook(n => { Object.freeze(n) }, () => named("f"))))
attempt("thrown in the middle", () => keys(pair(() => leaf(14), () => { throw new RangeError("second") })))
const broken = registry.filter(n => n.kind === Kind.Pair).pop() as Pair
console.log(keys(broken), broken.weight, (broken.first as Leaf).value, broken.second === undefined, "second" in broken, JSON.stringify(broken))
;(broken as Mutable<Pair>).second = broken.first
console.log(keys(broken), broken.second === broken.first)
attempt("thrown by the hook", () => keys(withHook(() => { throw new EvalError("hook") }, () => leaf(15))))

// The hook creates its own nodes, and stores the one being created in a typed field of another object.
const holder: { current?: Nd; all: Nd[] } = { all: [] }
let depth = 0
const nested = withHook(n => { holder.current = n; holder.all.push(n); if (depth++ < 2) named("inner" + depth, n) }, () => leaf(16))
console.log(holder.all.map(n => Kind[n.kind] + n.serial + ":" + keys(n)).join(" "), holder.current === nested, holder.all[0] === nested, (holder.all[1] as Named).target === nested, (holder.all[2] as Named).label)

let total = 0, orders = new Set<string>()
for (let i = 0; i < 9000; i++) {
  const hook = i % 3 === 0 ? (n: Nd) => { n.note = "n" + (i & 3) } : i % 3 === 1 ? (n: Nd) => { (n as any)["x" + (i & 1)] = i } : undefined
  onCreate = hook
  const l = i & 4 ? leaf(i) : named("l" + (i & 7))
  onCreate = undefined
  // The fields and the extra property are listed apart.
  orders.add(Object.keys(l).filter(k => k[0] !== "x").join() + "+" + Object.keys(l).filter(k => k[0] === "x").join())
  total += l.kind === Kind.Leaf ? l.value : l.label.length + (l.note ? l.note.length : 0)
}
console.log(total, [...orders].sort().join(" "), registry.length)
