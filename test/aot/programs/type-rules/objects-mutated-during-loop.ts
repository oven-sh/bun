// A typed object is changed in the middle of a loop over it: every change succeeds, as in plain Bun. A field that holds a value of another kind afterwards throws a TypeError at its next typed read.
interface Cell { v: number; w: number; tag?: string }
type Act = (c: Cell, i: number) => void
function cell(): Cell { return { v: 1, w: 2 } }
let reached = 0
function sumWith(c: Cell, n: number, at: number, act: Act): number {
  let s = 0
  for (let i = 0; i < n; i++) { reached = i; if (i === at) act(c, i); s += c.v + c.w }
  return s
}
const acts: [string, Act][] = [
  ["accessor", c => { Object.defineProperty(c, "v", { get: () => 1000, set() {}, enumerable: true, configurable: true }) }],
  ["read-only (rule 2)", c => { Object.defineProperty(c, "w", { writable: false }) }],
  ["delete of a required field (rule 3)", c => { delete (c as any).v; (c as any).v = 3 }],
  ["another prototype (rule 4)", c => { Object.setPrototypeOf(c, { tag: "inherited" }) }],
  ["a store that does not fit (rule 1)", c => { (c as any).v = "7.5" }],
]
for (const [label, act] of acts) {
  const c = cell()
  try { sumWith(c, 100, 50, act); console.log(label + ": no error") } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
  console.log(reached, JSON.stringify(c), Object.getPrototypeOf(c) === Object.prototype)
}
// Inside one expression.
function redefine(c: Cell, x: number): number { Object.defineProperty(c, "v", { get: () => x, configurable: true, enumerable: true }); return 0 }
const e2 = cell()
try { console.log(e2.v * 100 + redefine(e2, 5) + e2.v); console.log("between two reads: no error") } catch (e) { console.log("between two reads:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Methods. (An own property by the name of a method and a method replaced on the prototype, where the checker sees the store, are exact: typed-objects/objects-mutated-during-loop.)
class Runner { n = 1; go(x: number): string { return "orig" + x + this.n } get size(): number { return this.n } }
function reparent(r: Runner): number { Object.setPrototypeOf(r, { go() { return "other" }, size: -1 }); return 7 }
const r1 = new Runner()
try { console.log(r1.go(reparent(r1))); console.log("another prototype for an instance (rule 4): no error") } catch (e) { console.log("another prototype for an instance (rule 4):", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(r1.go(0), r1.size, Object.keys(r1).join())
// An element is replaced with an object that inherits its fields: any object passes the type Cell, and the fields are read through the prototype.
const cells: Cell[] = [cell(), cell(), cell()]
let seen = 0
try { cells.forEach((c, i, all) => { if (i === 0) all[2] = Object.create({ v: 0.5, w: 0.25 }); seen += c.v }); console.log("element under Object.create: no error") } catch (e) { console.log("element under Object.create:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(seen)
