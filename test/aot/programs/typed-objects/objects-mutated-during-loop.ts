// An object changes in the middle of a loop or an expression, so no cached check or loaded value may be reused after the call that changed it.
interface Cell { v: number; w: number; tag?: string }
type Act = (c: Cell, i: number) => void
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function cell(): Cell { return { v: 1, w: 2 } }
function sumWith(c: Cell, n: number, at: number, act: Act): number {
  let s = 0
  for (let i = 0; i < n; i++) { if (i === at) act(c, i); s += c.v + c.w + (c.tag ?? "").length }
  return s
}
function storeWith(c: Cell, n: number, at: number, act: Act): string {
  let i = 0
  try { for (; i < n; i++) { if (i === at) act(c, i); c.v = i; c.w += 1 } } catch (e) { return (e as Error).constructor.name + "@" + i + "/" + c.v + "/" + c.w }
  return "done/" + c.v + "/" + c.w
}
const acts: Act[] = [
  () => {},
  c => { Object.freeze(c) },
  c => { (c as any).v = 7.5 },
  c => { (c as any).tag = "late" },
  c => { c.tag = "x"; delete (c as any).tag },
  c => { Object.defineProperty(c, "w", { value: 100 }); (c as any).extra = 1 },
  c => { (c as any)[0] = "index"; (c as any)[Symbol.for("k")] = 1 },
  c => { Reflect.set(c, "w", -2); Object.seal(c) },
  c => { Object.preventExtensions(c) },
]
console.log(acts.map(act => sumWith(cell(), 100, 50, act)).join())
console.log(acts.map(act => sumWith(cell(), 100, 0, act)).join(), acts.map(act => sumWith(cell(), 100, 100, act)).join())
console.log(acts.map(act => storeWith(cell(), 100, 50, act)).join())
// Inside one expression.
function touch(c: Cell, x: number): number { (c as any).v = x; return 0 }
const e1 = cell(), e3 = cell(), e4 = cell(), e5 = cell()
console.log(e1.v + touch(e1, 20) + e1.v, (e3.v += touch(e3, 9) + 1), e3.v)
const sneaky = { valueOf() { (e4 as any).v = 50; return 0 } }
console.log(e4.v + Number(sneaky) + e4.v, attempt(() => (e5.tag ??= (Object.preventExtensions(e5), "x"))), attempt(() => { e5.v = (Object.freeze(e5), 8) }), e5.v)
// The callee of a method call is found before its arguments are evaluated.
class Runner { n = 1; go(x: number): string { return "orig" + x + this.n } get size(): number { return this.n } }
function bump(r: Runner): number { r.n++; return 5 }
const r1 = new Runner()
console.log(r1.go(bump(r1)), r1.go(0), r1.size)
// The checker sees both stores, so `go` is a replaced method.
function patchOwn(r: Runner): number { (r as any).go = () => "own"; return 5 }
function patchClass(): number { Runner.prototype.go = function () { return "class" }; return 6 }
const r2 = new Runner(), r3 = new Runner()
console.log(r2.go(patchOwn(r2)), r3.go(patchClass()), r2.go(0), r3.go(0), new Runner().go(0), Object.keys(r2).join())
// Object.assign returns its first argument, with a property that the type lacks.
const assigned = cell()
Object.assign(assigned, { w: 100, extra: 1 })
console.log(JSON.stringify(assigned), assigned.w)
// A typed alias, and a function that reaches the same object by another way.
let shared: Cell = cell()
function poke(): number { shared.v += 10; return 0 }
function swapShared(): number { shared = JSON.parse('{"v":-1,"w":-2}'); return 0 }
function readTwice(c: Cell): number { const x = c.v; poke(); return x * 1000 + c.v }
function readShared(): number { const x = shared.v; swapShared(); return x * 1000 + shared.v }
console.log(readTwice(shared), readTwice(cell()), readShared(), shared.w)
// Callbacks of built-ins change the elements still to come.
const cells: Cell[] = []
for (let i = 0; i < 10; i++) cells.push(cell())
let total = 0
cells.forEach((c, i, all) => {
  if (i + 1 < all.length && i % 3 === 0) (all[i + 1] as any).v = 100 + i
  if (i + 2 < all.length && i % 4 === 0) all[i + 2] = { v: 0.5, w: 0.25 }
  total += c.v + c.w
})
console.log(total, cells.map(c => c.v).join(), cells.reduce((s, c) => s + c.w, 0))
// finally and catch run between two reads.
function around(c: Cell): string {
  let out = ""
  try { out += c.v; throw new Error("x") } catch (e) { touch(c, 77) } finally { out += "," + c.v; touch(c, 1) }
  return out + "," + c.v
}
console.log(around(cell()))
