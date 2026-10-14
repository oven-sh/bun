// A method call through an interface or a base class with several possible targets, on a receiver of the wrong type.
/* expected
view TypeError 0 TypeError 0
base TypeError 0 TypeError 0
exact TypeError 0
right 3 4 3 4
*/
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
interface Sink { put(v: number | string): void }
class A { last = 0; put(v: number) { this.last = v } }
class B { last = 0; put(v: number) { this.last = v + 1 } }
const a = new A(), b = new B()
const sinks: Sink[] = [a, b]
console.log("view", sinks.map(s => attempt(() => { s.put("s"); return "stored" })).map((r, i) => r + " " + [a, b][i].last).join(" "))
class Base { last = 0; put(v: number | string) {} }
class C extends Base { put(v: number) { this.last = v } }
class D extends Base { put(v: number) { this.last = v + 1 } }
const c = new C(), d = new D()
const bases: Base[] = [c, d]
console.log("base", bases.map(s => attempt(() => { s.put("s"); return "stored" })).map((r, i) => r + " " + [c, d][i].last).join(" "))
const e = new A()
console.log("exact", attempt(() => { (e as Sink).put("s"); return "stored" }), e.last)
for (const s of sinks) s.put(3)
for (const s of bases) s.put(3)
console.log("right", a.last, b.last, c.last, d.last)
