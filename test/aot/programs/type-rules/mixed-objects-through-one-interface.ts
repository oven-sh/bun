// Typed and untyped objects are used through the same interface type at the same sites.
interface Reading { at: number; value: number; unit: string; ok?: boolean }
function rule(label: string, f: () => unknown) { try { console.log(label + ": no error", f()) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
function valueOf1(r: Reading): number { return r.value }
rule("heir of a literal", () => valueOf1(Object.create({ at: 1, value: 1, unit: "p" })))
rule("proxy of a literal", () => valueOf1(new Proxy<Reading>({ at: 1, value: 2, unit: "x" }, {})))
const g: Reading = { at: 1, value: 0, unit: "g" }
rule("field made an accessor", () => valueOf1(Object.defineProperty<Reading>(g, "value", { get: () => 4, set() {}, enumerable: true, configurable: true })))
const d: Reading = { at: 1, value: 5, unit: "d", ok: true }
rule("required field deleted", () => delete (d as any).at)
const o = { at: 1, value: 6, unit: "o" } satisfies Reading
rule("another prototype", () => valueOf1(Object.setPrototypeOf(o, { ok: false })))
class Sample implements Reading { constructor(public at: number, public value: number, public unit = "s") {} }
class Checked extends Sample { ok = true }
function clearOk(r: Reading): boolean { return delete r.ok }
const c = new Checked(1, 2)
rule("field that is optional in the interface and required in the class, deleted", () => clearOk(c))
console.log(JSON.stringify([g, d, o, c]), Object.getPrototypeOf(o) === Object.prototype)
