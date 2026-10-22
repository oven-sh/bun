function refused(label: string, f: () => unknown) { try { f(); console.log(label + ": no error") } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }

// function.
interface Printable { id: number; toString?: () => string; valueOf?: () => unknown; constructor?: Function; hasOwnProperty?: (key: string) => boolean }
const plain: Printable = { id: 1 }
const own: Printable = { id: 2, toString() { return "own " + this.id } }
console.log(typeof plain.toString, plain.toString === Object.prototype.toString, "toString" in plain, Object.hasOwn(plain, "toString"), plain.toString?.(), own.toString?.(), `${own}`, String(plain))
console.log(plain.constructor === Object, typeof plain.valueOf, plain.valueOf?.() === plain, plain.hasOwnProperty?.("id"), plain.hasOwnProperty?.("toString"), own.hasOwnProperty?.("toString"))
plain.toString = () => "late"
console.log(String(plain), show(plain), delete plain.toString, String(plain), plain.toString === Object.prototype.toString)

interface Describable { label: string; describe?: () => string; size?: number; tag?: string }
function inspect(d: Describable): string {
  return [d.label, d.describe?.(), d.size, d.tag, "describe" in d, "size" in d, "tag" in d, Object.hasOwn(d, "size"), Object.hasOwn(d, "tag")].map(String).join("|")
}
class WithValue { label = "v" }
refused("property added to the prototype of a class", () => { (WithValue.prototype as any).tag = "from prototype" })
console.log(inspect(new WithValue()))

const late: Describable = { label: "late" }
refused("another prototype", () => Object.setPrototypeOf(late, { size: 99, describe(this: Describable) { return "inherited by " + this.label }, get tag() { return "getter tag" } }))
console.log(inspect(late), show(late))
refused("a store under a getter without a setter", () => { late.tag = "x" }); late.size = 1
console.log(inspect(late), show(late))
refused("no prototype", () => Object.setPrototypeOf({ label: "cut" } as Describable, null)) // On an object of its own: `late` goes on inheriting.
console.log(late.label, late.size, late.tag, late.describe === undefined, "tag" in late, String(late))

refused("a property defined on Object.prototype", () => Object.defineProperty(Object.prototype, "tag", { value: "polluted", configurable: true, writable: true }))
console.log(inspect({ label: "during" }))
