// Objects made with `Object.create` are used through declared interface types.
interface Conf { host: string; port: number; secure?: boolean; nested: { depth: number } }
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
const defaults: Conf = { host: "localhost", port: 80, nested: { depth: 1 } }
rule("heir of an object of the type", () => { const derived: Conf = Object.create(defaults); return derived.port })
rule("accessor and read-only properties", () => {
  const described: Conf = Object.create(Object.prototype, { host: { value: "fixed", enumerable: true }, port: { get: () => 8080, enumerable: false, configurable: true }, nested: { value: { depth: 5 }, writable: true } } as any)
  return described.port
})
rule("heir of a frozen literal", () => { const locked: Conf = Object.create(Object.freeze({ host: "frozen", port: 1, nested: { depth: 2 } })); return locked.port })
// Plain data without a prototype is taken as it is: identity is kept, and a change through one reference is seen through the other,
// whether an untyped object or a variable alone holds the original.
const box: any = { held: Object.assign(Object.create(null), JSON.parse('{"host":"h","port":1,"nested":{"depth":0}}')) }
const bare: Conf = box.held
bare.port++
console.log(bare === box.held, bare.port, box.held.port, Object.getPrototypeOf(bare) === null, bare.nested === box.held.nested, JSON.stringify(bare))
const source: any = Object.assign(Object.create(null), JSON.parse('{"host":"h","port":1,"nested":{"depth":0}}'))
const local: Conf = source
local.port++
console.log(local === source, local.port, source.port, local.nested === source.nested)
// Accessors on the prototype, with an inheriting object for `this`.
const guardedPrototype = {
  held: 10,
  get port() { return this.held },
  set port(p: number) { this.held = p * 2 },
}
const guarded: any = Object.create(guardedPrototype)
rule("setter of a literal with an heir for this", () => { guarded.port = 4; return "stored" })
rule("getter of a literal with an heir for this", () => guarded.port)
console.log(guardedPrototype.port, Object.keys(guarded).length)
class Service implements Conf {
  host = "svc"; port = 443; nested = { depth: 3 }
  url(): string { return this.host + ":" + this.port + (this.secure ? "s" : "") }
  secure?: boolean
}
const service = new Service()
rule("heir of an instance as the class", () => { const overlay: Service = Object.create(service); return overlay.port })
const overlay: any = Object.create(service)
overlay.port = 8443
rule("method of the class with an heir for this", () => overlay.url())
rule("field of an instance made an accessor", () => { Object.defineProperty(service, "host", { get() { return "dynamic" }, enumerable: true, configurable: true }); return service.host })
console.log(service.url(), overlay.host, overlay.port)
