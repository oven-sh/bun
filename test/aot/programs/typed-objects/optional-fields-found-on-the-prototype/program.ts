interface Printable { id: number; toString?: () => string; valueOf?: () => unknown; constructor?: Function; hasOwnProperty?: (key: string) => boolean }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function nameOf(e: unknown): string { return (e as Error).constructor.name }
const plain: Printable = { id: 1 }
const own: Printable = { id: 2, toString() { return "own " + this.id } }
console.log("toString" in plain, Object.hasOwn(plain, "toString"), "toString" in own, Object.hasOwn(own, "toString"), typeof own.toString, own.toString?.(), `${own}`, String(plain), "valueOf" in own, "nothing" in own)
plain.toString = () => "late"
console.log(String(plain), plain.toString(), show(plain), delete plain.toString, String(plain), "toString" in plain, Object.hasOwn(plain, "toString"))

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

// The method, seen through the class and through the interface.
const asDescribable: Describable = withMethod
asDescribable.describe = () => "patched"
console.log(withMethod.describe(), asDescribable.describe?.(), Object.keys(withMethod).join(), new WithMethod().describe())
delete asDescribable.describe
function described(d: Describable) { return d.describe?.() }
console.log(withMethod.describe(), described(asDescribable), "describe" in asDescribable, Object.hasOwn(withMethod, "describe"), asDescribable.describe === WithMethod.prototype.describe)

// Classes whose prototypes stay as they are.
class Labelled { label: string; constructor(label: string) { this.label = label } }
class Derived extends Labelled { extra = 1 }
const before: Describable = new Labelled("before"), derived: Describable = new Derived("derived")
console.log(inspect(before), inspect(derived), inspect({ label: "after" }))
before.tag = "mine"; derived.tag = "too"
console.log(before.tag, derived.tag, show(before), show(derived), delete derived.tag, inspect(derived))

let total = 0
for (let i = 0; i < 3000; i++) { const d = items[i % items.length]; total += (d.size ?? 0) + (d.describe?.().length ?? 0) + (d.tag ?? "").length }
console.log(total)
