// Object.assign and: the key order of fields and extra properties, fields that are redefined, mixins that add to the prototype of a class.
interface Conf { host: string; port: number; secure?: boolean; tags?: string[] }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function conf(): Conf { return { host: "h", port: 80 } }
const trace: string[] = []
// Silent: late fields list before the extra properties, whatever the order the source gives them in.
const c2 = conf()
Object.assign(c2, { extra1: 1, tags: [], extra2: 2, secure: false } as any)
console.log(show(c2), c2.secure, c2.tags?.length, (c2 as any).extra1 + (c2 as any).extra2)
// Silent: an accessor of a literal is no field: it lists, and is read, after the fields.
const c9 = conf()
const throwing = { host: "one", get port(): number { throw new RangeError("x") }, secure: true }
console.log(Object.keys(throwing).join(), attempt(() => Object.assign(c9, throwing as any)), show(c9))
const c5 = conf()
try { Object.defineProperty(c5, "port", { set(v: number) { trace.push("own setter " + v) }, get() { return 99 }, enumerable: true, configurable: true }); console.log("field made an accessor: no error") } catch (e) { console.log("field made an accessor:", e instanceof TypeError ? "TypeError" : "other " + e) }
Object.assign(c5, { port: 5, host: "after" } as any)
console.log(c5.port, c5.host, trace.length, show(c5))
const c7 = conf()
try { Object.defineProperty(c7, "port", { writable: false }); console.log("field made read-only: no error") } catch (e) { console.log("field made read-only:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(attempt(() => Object.assign(c7, { host: "written", port: 2, secure: true } as any) === c7), show(c7), c7.port, c7.host, c7.secure)
class Point2 { x = 0; y = 0; norm() { return Math.hypot(this.x, this.y) } }
const p = new Point2()
p.x = 3; p.y = 4
try { Object.assign(Point2.prototype, { double(this: Point2) { return this.x * 2 } }); console.log("method added to the prototype of a class: no error") } catch (e) { console.log("method added to the prototype of a class:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log("double" in p, p.norm(), new Point2().norm(), Object.keys(p).join())
