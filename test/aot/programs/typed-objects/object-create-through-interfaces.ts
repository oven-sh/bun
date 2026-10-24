// Objects made with `Object.create`, used as `any`: fields inherited from typed objects, property descriptors, and read-only properties on the chain.
interface Conf { host: string; port: number; secure?: boolean; nested: { depth: number } }
const said: string[] = []
function flush(): string { return said.splice(0).join(",") }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function show(c: any): string {
  return [c.host, c.port, String(c.secure), c.nested.depth, "port" in c, Object.hasOwn(c, "port"), "secure" in c, Object.keys(c).join("")].join("/")
}
function allKeys(o: object): string { const out: string[] = []; for (const k in o) out.push(k); return out.join("") }
const defaults: Conf = { host: "localhost", port: 80, nested: { depth: 1 } }
const derived: any = Object.create(defaults)
console.log(show(defaults), show(derived), allKeys(derived))
derived.port++
derived.nested.depth++
console.log(show(defaults), show(derived), allKeys(derived))
defaults.secure = true
defaults.host = "example"
console.log(show(derived), derived.secure === defaults.secure)
derived.secure = false
delete defaults.secure
console.log(show(defaults), show(derived), allKeys(derived))
delete derived.secure
delete derived.port
console.log(show(derived), derived.port + 1)
// No prototype at all: plain data, which a declared type takes.
const bare: Conf = Object.assign(Object.create(null), { host: "h", port: 1, nested: { depth: 0 } })
console.log(show(bare), "toString" in bare, attempt(() => String(bare)), attempt(() => bare + ""), Object.getPrototypeOf(bare) === null, JSON.stringify(bare))
bare.secure = true; bare.port += 0.5
console.log(show(bare), JSON.stringify({ ...bare }))
// Made with descriptors: not writable, an accessor, not enumerable.
const described: any = Object.create(Object.prototype, {
  host: { value: "fixed", enumerable: true },
  port: { get() { said.push("port?"); return 8080 }, enumerable: false, configurable: true },
  nested: { value: { depth: 5 }, writable: true },
})
console.log(show(described), flush(), attempt(() => { described.host = "x" }), attempt(() => { described.port = 1 }), attempt(() => { described.port++ }), flush())
described.nested = { depth: 6 }
described.secure = false
console.log(show(described), JSON.stringify(described), Object.getOwnPropertyNames(described).join())
// Read-only properties on the prototype decide what a store does.
const locked: any = Object.create(Object.freeze({ host: "frozen", port: 1, nested: { depth: 2 } }))
console.log(attempt(() => { locked.host = "mine" }), attempt(() => { locked.port++ }), attempt(() => { locked.secure = true }), show(locked), ++locked.nested.depth)
// A chain of three: a literal, an instance of a class, Object.create on top.
class Service implements Conf {
  host = "svc"; port = 443; nested = { depth: 3 }
  url(): string { return this.host + ":" + this.port + (this.secure ? "s" : "") }
  secure?: boolean
}
const service = new Service()
const overlay: any = Object.create(service)
overlay.port = 8443
console.log(service.url(), overlay instanceof Service, show(overlay), typeof overlay.url)
service.secure = true
console.log(service.url(), overlay.secure, Object.keys(overlay).join(), allKeys(overlay))
const confs: any[] = [defaults, derived, bare, described, locked, service, overlay]
let sum = 0
for (let i = 0; i < 160; i++) { const c = confs[i % confs.length]; sum += c.port + c.nested.depth + c.host.length + (c.secure ? 1 : 0) }
console.log(sum, flush().length)
