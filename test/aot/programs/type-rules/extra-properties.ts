// Extra properties on typed objects: string and symbol keys, their order, and an own property with the name of a method of the class.
interface Tagged { id: number; label: string; opt?: string }
const mark = Symbol("mark"), second = Symbol.for("second")
function make(id: number): Tagged { return { id, label: "l" + id } }
function keysOf(o: object): string { return Reflect.ownKeys(o).map(k => String(k)).join() }
function forIn(o: object): string { const out: string[] = []; for (const k in o) out.push(k); return out.join() }
const a = make(1)
const loose: any = a
loose.extra = "e"; loose[2] = "two"; loose[mark] = "m"; a.opt = "late"; loose.more = 1; loose[0] = "zero"; loose[second] = 2; loose["1.5"] = "not an index"; loose[-1] = "minus"
console.log(keysOf(a))
console.log(Object.keys(a).join(), forIn(a), JSON.stringify(a))
console.log(JSON.stringify({ ...a }), keysOf({ ...a }), Object.entries(a).map(e => e.join("=")).join("&"))
delete loose.extra; delete loose[0]; delete a.opt; delete loose[mark]
loose.extra = "again"; a.opt = "again"
console.log(keysOf(a), a.opt, loose.extra)
const crowded = make(3)
for (let i = 1; i < 200; i += 2) (crowded as any)["x" + i] = i
crowded.opt = "after"
console.log(Object.keys(crowded).length, Object.keys(crowded).slice(0, 4).join(), Object.keys(crowded)[101], Object.keys(crowded)[102])
const ordered = make(5)
;(ordered as any).z = 1; ordered.opt = "o"; (ordered as any).y = 2
console.log(Object.keys(ordered).join())
// Exact: an own property with the name of a method of its class, stored through a cast that the compiler sees through.
class Widget { id = 1; render(): string { return "render" + this.id } get wide(): boolean { return this.id > 1 } }
const widget = new Widget()
try { (widget as any).render = function (this: Widget) { return "own" + this.id }; console.log("by the name of a method: no error") } catch (e) { console.log("by the name of a method:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(widget.render(), widget.wide, Object.keys(widget).join())
