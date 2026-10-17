interface Printable { id: number; toString?: () => string; valueOf?: () => unknown; constructor?: Function; hasOwnProperty?: (key: string) => boolean }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function nameOf(e: unknown): string { return (e as Error).constructor.name }
const plain: Printable = { id: 1 }
const own: Printable = { id: 2, toString() { return "own " + this.id } }
console.log("toString" in plain, Object.hasOwn(plain, "toString"), own.toString?.(), `${own}`, String(plain))
plain.toString = () => "late"
console.log(String(plain), plain.toString(), show(plain), delete plain.toString, String(plain))

interface Describable { label: string; describe?: () => string; size?: number; tag?: string }
class WithMethod { label = "m"; describe() { return "method of " + this.label } }
class WithGetter { label = "g"; get size() { return this.label.length * 10 } }
class WithBoth extends WithMethod { get size() { return 7 } set size(v: number) { this.label = "set" + v } }
class WithValue { label = "v" }
const withMethod = new WithMethod()
const items: Describable[] = [withMethod, new WithGetter(), new WithBoth(), new WithValue(), { label: "lit" }, { label: "all", describe: () => "own", size: 1, tag: "own tag" }]
function inspect(d: Describable): string {
  return [d.label, d.describe?.(), d.size, d.tag, "describe" in d, "size" in d, "tag" in d, Object.hasOwn(d, "size"), Object.hasOwn(d, "tag")].map(String).join("|")
}
console.log(items.map(inspect).join(" ; "))

// A store finds a setter, an accessor without one, or nothing.
for (const d of items) { try { d.size = 5 } catch (e) { console.log(d.label, nameOf(e)) } }
console.log(items.map(inspect).join(" ; "))
console.log(items.map(show).join(" ; "))
for (const d of items) d.tag = "t:" + d.label
console.log(items.map(d => d.tag).join(), items.map(d => Object.keys(d).join("")).join())
for (const d of items) delete d.tag
console.log(items.map(d => String(d.tag)).join(), items.map(d => "tag" in d).join())

// A method seen through the view and through the class.
const asDescribable: Describable = withMethod
delete asDescribable.describe
function described(d: Describable) { return d.describe?.() }
console.log(withMethod.describe(), described(asDescribable), "describe" in asDescribable, Object.hasOwn(withMethod, "describe"))

const before: Describable = { label: "before" }
const during: Describable = { label: "during" }
console.log(inspect(before), inspect(during), inspect(items[4]), inspect(items[5]))
