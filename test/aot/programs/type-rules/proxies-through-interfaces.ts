// Proxies are used through declared interface types, and the traps they see are listed.
interface Point3 { x: number; y: number; z?: number; tag: string }
const traps: string[] = []
function flush(): string { return traps.splice(0).join(" ") }
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
const handler: ProxyHandler<any> = {
  get(t, k, r) { traps.push("get:" + String(k)); return Reflect.get(t, k, r) },
  set(t, k, x, r) { traps.push("set:" + String(k)); return Reflect.set(t, k, x, r) },
  deleteProperty(t, k) { traps.push("delete:" + String(k)); return Reflect.deleteProperty(t, k) },
}
function spy<T extends object>(target: T): T { return new Proxy(target, handler) }
function norm1(q: Point3): number { return q.x + q.y + (q.z ?? 0) }
const target: Point3 = { x: 1, y: 2, tag: "t" }
rule("proxy from a generic function, as its target's type", () => norm1(spy(target)))
rule("new Proxy<Point3>", () => new Proxy<Point3>({ x: 0, y: 0, tag: "s" }, {}).x)
rule("Proxy.revocable<Point3>", () => Proxy.revocable<Point3>({ x: 1, y: 1, tag: "r" }, {}).proxy.x)
rule("an empty literal cast to the type, for a proxy that exists only in its traps", () => new Proxy({} as Point3, { get: () => 7 }).x)
const untyped: any = new Proxy<object>(target, handler)
rule("proxy as an argument", () => norm1(untyped))
rule("proxy into an annotated variable", () => { const q: Point3 = untyped; return q.x })
rule("proxy cast", () => (untyped as Point3).x)
rule("proxy into a field", () => { const pair: { first: Point3 } = { first: untyped }; return pair.first.x })
rule("heir of a proxy", () => { const child: Point3 = Object.create(untyped); return child.x })
console.log(flush() === "")
class Acc { total = 0; steps?: number; add(n: number): this { this.total += n; this.steps = (this.steps ?? 0) + 1; return this } get mean(): number { return this.total / (this.steps ?? 1) } }
const acc = new Acc()
const pa: any = new Proxy<object>(acc, handler)
rule("method of a class with a proxy for this", () => pa.add(2))
rule("getter of a class with a proxy for this", () => pa.mean)
console.log(flush(), acc.total, acc.mean)
rule("store through the traps that does not fit the field", () => { untyped.x = "ten"; return "stored" })
rule("required field deleted through the traps", () => delete untyped.tag)
console.log(flush(), JSON.stringify(target))
