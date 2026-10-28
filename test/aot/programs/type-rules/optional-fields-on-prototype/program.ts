interface Printable { id: number; toString?: () => string; valueOf?: () => unknown; constructor?: Function; hasOwnProperty?: (key: string) => boolean }
const plain: Printable = { id: 1 }
const own: Printable = { id: 2, toString() { return "own " + this.id } }
console.log(typeof plain.toString, plain.toString === Object.prototype.toString, plain.toString?.())
console.log(plain.constructor === Object, typeof plain.valueOf, plain.valueOf?.() === plain, plain.hasOwnProperty?.("id"), plain.hasOwnProperty?.("toString"), own.hasOwnProperty?.("toString"))
plain.toString = () => "late"
delete plain.toString
function toStringOf(p: Printable) { return p.toString }
console.log(toStringOf(plain) === Object.prototype.toString, toStringOf(plain))
function peek(o: any, k: string): string { return typeof o[k] }
console.log(peek(plain, "toString"), peek(plain, "constructor"), String(plain))

interface Describable { label: string; describe?: () => string; size?: number; tag?: string }
function inspect(d: Describable): string { return [d.label, d.describe?.(), d.size, d.tag].map(String).join("|") }
// The prototype object of a class of the program can change in every way.
class WithValue { label = "v" }
try { (WithValue.prototype as any).tag = "from prototype"; console.log("a property added by a store: no error") } catch (e) { console.log("a property added by a store:", e instanceof TypeError ? "TypeError" : "other " + e) }
class Labelled { label: string; constructor(label: string) { this.label = label } }
try { Object.defineProperty(Labelled.prototype, "tag", { value: "polluted", configurable: true, writable: true }); console.log("by defineProperty: no error") } catch (e) { console.log("by defineProperty:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.defineProperty(Labelled.prototype, "tag", { get() { return "got" }, set(v: string) {}, configurable: true }); console.log("an accessor: no error") } catch (e) { console.log("an accessor:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(inspect(new WithValue()), inspect(new Labelled("l")), "tag" in Labelled.prototype)
// A prototype given after creation, also to a literal that was just made.
const late: Describable = { label: "late" }
try { Object.setPrototypeOf(late, { size: 99, describe(this: Describable) { return "inherited by " + this.label }, get tag() { return "getter tag" } }); console.log("setPrototypeOf: no error") } catch (e) { console.log("setPrototypeOf:", e instanceof TypeError ? "TypeError" : "other " + e) }
const given: object = {}
try { const made: Describable = Object.setPrototypeOf({ label: "made" }, given); console.log(made.label); console.log("setPrototypeOf on a fresh literal: no error") } catch (e) { console.log("setPrototypeOf on a fresh literal:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(inspect(late))
const created: object = {}
try { const made: Describable = Object.assign(Object.create(created), { label: "made" }); console.log(made.label); console.log("made under Object.create: no error") } catch (e) { console.log("made under Object.create:", e instanceof TypeError ? "TypeError" : "other " + e) }
