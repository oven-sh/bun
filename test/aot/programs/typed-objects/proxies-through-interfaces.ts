// Proxies of typed objects, used as `any`: every read, store, `in`, `delete` and copy reaches the traps in order, and the traps reach the object.
interface Point3 { x: number; y: number; z?: number; tag: string }
const traps: string[] = []
function flush(): string { return traps.splice(0).join(" ") }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function spy(target: object): any {
  return new Proxy(target, {
    get(t, k, r) { traps.push("get:" + String(k)); return Reflect.get(t, k, r) },
    set(t, k, x, r) { traps.push("set:" + String(k)); return Reflect.set(t, k, x, r) },
    has(t, k) { traps.push("has:" + String(k)); return Reflect.has(t, k) },
    deleteProperty(t, k) { traps.push("delete:" + String(k)); return Reflect.deleteProperty(t, k) },
    ownKeys(t) { traps.push("keys"); return Reflect.ownKeys(t) },
    getOwnPropertyDescriptor(t, k) { traps.push("gopd:" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k) },
    defineProperty(t, k, d) { traps.push("define:" + String(k)); return Reflect.defineProperty(t, k, d) },
  })
}
const target: Point3 = { x: 1, y: 2, tag: "t" }
const p = spy(target)
function norm1(q: any): number { return q.x + q.y + (q.z ?? 0) }
console.log(norm1(p), flush())
console.log(norm1(target), flush() === "")
p.z = 3
console.log(flush(), Object.keys(target).join(), target.z)
p.x++
p.y += p.x
console.log(flush(), JSON.stringify(target), target.x + target.y)
console.log("z" in p, "w" in p, delete p.z, "z" in target, flush())
console.log(Object.keys(p).join(), flush())
console.log(JSON.stringify(p), flush())
const copy: Point3 = { ...p, tag: "copy" }
console.log(JSON.stringify(copy), flush())
const { x, ...others } = p
console.log(x, JSON.stringify(others), flush())
console.log(JSON.stringify(Object.assign({}, p)), flush())
Object.assign(p, { x: 10, tag: "assigned" })
console.log(flush(), target.x, target.tag)
// Traps that refuse or change a store.
const held: Point3 = { x: 0, y: 0, tag: "s" }
const strict: any = new Proxy<object>(held, { set: (t, k, v) => k === "x" ? false : Reflect.set(t, k, typeof v === "number" ? v * 2 : v), deleteProperty: () => false })
console.log(attempt(() => { strict.x = 1 }), attempt(() => (strict.y = 4)), strict.y, held.y, attempt(() => delete strict.z), attempt(() => strict.x++), strict.x)
// A revoked proxy.
const revocable = Proxy.revocable<object>({ x: 1, y: 1, tag: "r" } satisfies Point3, {})
const soon: any = revocable.proxy
console.log(norm1(soon), soon.tag)
revocable.revoke()
console.log(attempt(() => norm1(soon)), attempt(() => { soon.x = 1 }), attempt(() => "x" in soon), attempt(() => ({ ...soon })), typeof soon)
// An instance of a class wrapped in a proxy: fields, `instanceof`, keys.
class Acc { total = 0; steps?: number; add(n: number): this { this.total += n; this.steps = (this.steps ?? 0) + 1; return this } get mean(): number { return this.total / (this.steps ?? 1) } }
const acc = new Acc()
const pa = spy(acc)
pa.total = 6; pa.steps = 2
console.log(pa.total, typeof pa.add, flush())
console.log(acc.total, acc.steps, acc.mean, pa instanceof Acc, Object.keys(acc).join(), Object.keys(pa).join(), flush())
// A proxy as the prototype: the traps are called for what the object lacks.
const child: any = Object.create(spy({ x: 5, y: 6, tag: "proto" } satisfies Point3))
child.x = 50
console.log(flush())
console.log(norm1(child), child.tag, "z" in child, Object.keys(child).join(), flush())
const points: any[] = [target, p, copy, child, strict]
let sum = 0
for (let i = 0; i < 60; i++) sum += norm1(points[i % points.length])
console.log(sum, traps.length)
