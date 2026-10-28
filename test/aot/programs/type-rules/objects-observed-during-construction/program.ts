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

const l1 = withHook(n => { (n as any).tag = "t"; n.note = "early" }, () => leaf(5))
console.log("extra first", keys(l1) + " " + l1.value + l1.note + (l1 as any).tag + JSON.stringify(l1))
const l2 = withHook(n => {
  try { Object.setPrototypeOf(n, { describe(this: Leaf) { return "leaf of " + this.value }, note: "inherited" }); console.log("another prototype: no error") } catch (e) { console.log("another prototype:", e instanceof TypeError ? "TypeError" : "other " + e) }
}, () => leaf(12))
console.log(keys(l2), "describe" in l2, l2.note, "note" in l2, l2 instanceof NdCtor, l2.value)
const l3 = withHook(n => {
  const k = n.kind
  try { delete (n as any).kind; console.log("delete of a required field: no error") } catch (e) { console.log("delete of a required field:", e instanceof TypeError ? "TypeError" : "other " + e) }
  ;(n as any).kind = k
}, () => leaf(13))
console.log(keys(l3), l3.kind, l3.serial, l3.value)
attempt("sealed, with room made", () => { const l = withHook(n => { (n as any).value = 0; Object.seal(n) }, () => leaf(8)); return keys(l) + " " + l.value + Object.isSealed(l) })
attempt("read only", () => keys(withHook(n => { Object.defineProperty(n, "value", { value: 7, writable: false, enumerable: true, configurable: true }) }, () => leaf(9))))
attempt("read only, cast again", () => String((last() as Leaf).value))
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(last(), "value")))
const stores: number[] = []
attempt("accessor", () => {
  const l = withHook(n => { Object.defineProperty(n, "value", { get() { return stores.length * 10 }, set(v: number) { stores.push(v) }, enumerable: false, configurable: true }) }, () => leaf(11))
  return keys(l) + " " + l.value + " " + stores.join() + " " + JSON.stringify(l) + " " + ("value" in l) + " " + (l.value + 0.5)
})
