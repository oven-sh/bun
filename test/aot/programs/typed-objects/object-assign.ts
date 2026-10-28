// `Object.assign` with typed objects as target and as source: it writes fields, adds optional fields, runs setters, and stops at an exception.
interface Conf { host: string; port: number; secure?: boolean; tags?: string[] }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function conf(): Conf { return { host: "h", port: 80 } }

// Typed target: values of the declared kinds arrive from literals, typed objects and parsed text.
const c1 = conf()
const same = Object.assign(c1, { port: 8080 })
console.log(same === c1, c1.port + 1, c1.host, show(c1))
Object.assign(c1, { secure: true }, { tags: ["a"] }, { host: "second" }, { host: "third" })
console.log(show(c1), c1.secure, c1.tags?.length, c1.host.length)
Object.assign(c1, JSON.parse('{"port": 1.5, "host": "json", "secure": false}'))
console.log(c1.port * 2, c1.host + "!", c1.secure === false, show(c1))

// A late field that is given undefined exists.
const c3 = conf()
Object.assign(c3, { secure: undefined })
console.log(show(c3), "secure" in c3, c3.secure)

// Typed source: own enumerable fields only, absent ones skipped, in the source's order.
const src: Conf = { port: 1, host: "src" }
console.log(show(Object.assign({}, src)), show(Object.assign({ host: "kept place" }, src)), show(Object.assign({}, src, conf())), show(Object.assign(Object.create(null), src)))
const typedCopy: Conf = Object.assign({}, src)
typedCopy.port++
console.log(typedCopy.port, src.port, typedCopy.secure, show(typedCopy))

// Typed to typed, of other types that share names.
interface Addr { host: string; path?: string }
const addr: Addr = { host: "addr", path: "/p" }
const c4 = conf()
Object.assign(c4, addr)
console.log(show(c4), c4.host, (c4 as Conf & Addr).path)

// Sources that are null, undefined or primitives; a string gives indices.
console.log(show(Object.assign(conf(), null, undefined, 5, true, "ab")), attempt(() => Object.assign(null as any, conf())))

// Getters of the source run; setters of the target run; the order is source by source, key by key.
const trace: string[] = []
const getterSource = { get port() { trace.push("get port"); return 7 }, get host() { trace.push("get host"); return "g" } }
class Watched { #port = 0; host = "w"; get port() { return this.#port } set port(v: number) { trace.push("set port " + v); this.#port = v * 2 } }
const watched = new Watched()
Object.assign(watched, getterSource, { port: 1 })
console.log(watched.port, watched.host, trace.join(), show(watched))

// A throw in the middle leaves what was done before it.
const c6 = Object.freeze(conf())
console.log(attempt(() => Object.assign(c6, { port: 1 })), show(c6), attempt(() => Object.assign(c6, {})), attempt(() => Object.assign(c6, { extra: 1 })))
const c8 = Object.preventExtensions(conf())
console.log(attempt(() => Object.assign(c8, { port: 3, secure: true, host: "not reached" })), show(c8), c8.secure, "secure" in c8)

// Symbols are copied after the strings; non-enumerable properties are not copied.
const sym = Symbol("s")
const withSym: any = conf()
withSym[sym] = "sym"
Object.defineProperty(withSym, "ghost", { value: 1, enumerable: false })
const got: any = Object.assign(conf(), withSym)
console.log(got[sym], "ghost" in got, Reflect.ownKeys(got).length)

// Instances as targets and sources.
class Point2 { x = 0; y = 0; norm() { return Math.hypot(this.x, this.y) } }
const p = Object.assign(new Point2(), { x: 3, y: 4 })
console.log(p.norm(), p instanceof Point2, show(p), show(Object.assign({}, p)), "norm" in Object.assign({}, p))
// A mixin that replaces a method of the class: the program is seen to do it, so the method is called by name.
Object.assign(Point2.prototype, { norm(this: Point2) { return -1 } })
console.log(p.norm(), new Point2().norm(), Object.keys(p).join(), Object.hasOwn(p, "norm"))

// Many targets of one type in a loop, sources of several shapes.
const sources: Partial<Conf>[] = [{ port: 1 }, { host: "x", port: 2 }, { secure: true }, {}, { tags: ["t"], host: "y" }]
let text = ""
for (let i = 0; i < 10; i++) { const t = Object.assign(conf(), sources[i % 5], sources[(i + 2) % 5]); text += t.host + t.port + (t.secure ?? "-") + (t.tags?.length ?? "-") + Object.keys(t).length + " " }
console.log(text)
