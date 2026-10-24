// `Object.defineProperty` on fields of typed objects, as long as the field stays a writable, enumerable and configurable data property.
interface Item { id: number; title: string; price: number; stock?: number; tags: string[] }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function make(id: number): Item { return { id, title: "item" + id, price: id * 1.5, tags: ["t" + id] } }
function flagsOf(o: object, k: string): string {
  const d = Object.getOwnPropertyDescriptor(o, k)
  if (d === undefined) return "-"
  return ("value" in d ? "v" : (d.get ? "g" : "") + (d.set ? "s" : "")) + (d.writable ? "W" : "") + (d.enumerable ? "E" : "") + (d.configurable ? "C" : "")
}
function show(i: Item): string {
  return [i.id, i.title, i.price, String(i.stock), i.tags.join("+"), Object.keys(i).join(""), ["id", "title", "price", "stock", "tags"].map(k => flagsOf(i, k)).join(".")].join("/")
}
function raise(i: Item, by: number): number { i.price += by; return i.price }
// A new value, with all attributes, with those that are true already, with none.
const plain = make(1)
Object.defineProperty(plain, "price", { value: 5, writable: true, enumerable: true, configurable: true })
console.log(show(plain), raise(plain, 1))
Object.defineProperty(plain, "price", { value: 99 })
Object.defineProperty(plain, "title", { enumerable: true })
Object.defineProperty(plain, "tags", { writable: true, value: ["new"] })
Object.defineProperty(plain, "id", {})
console.log(show(plain), raise(plain, 0.5), flagsOf(plain, "price"), JSON.stringify(plain))
// An absent optional field is defined: it comes last among the keys.
const stocked = make(2)
Object.defineProperty(stocked, "stock", { value: 1, writable: true, enumerable: true, configurable: true })
stocked.stock = 2
console.log(show(stocked), (stocked.stock ?? 0) + 1, delete stocked.stock, show(stocked), stocked.stock ?? "none")
console.log(Reflect.defineProperty(stocked, "stock", { value: 7, writable: true, enumerable: true, configurable: true }), show(stocked))
// Several at once, through a helper that only knows `object`, and on an object inside a typed field.
function reset(o: object, values: Record<string, unknown>): void { for (const k of Object.keys(values)) Object.defineProperty(o, k, { value: values[k], writable: true, enumerable: true, configurable: true }) }
interface Basket { first: Item; rest: Item[] }
const basket: Basket = { first: make(8), rest: [make(9), make(10)] }
reset(basket.first, { id: 80, tags: [] }); reset(basket.rest[1], { price: 0.25 }); reset(basket, { first: basket.rest[0] })
console.log(basket.first === basket.rest[0], basket.first.id++, basket.first.tags.push("more"), raise(basket.rest[0], 1), raise(basket.rest[1], 1), show(basket.first), show(basket.rest[1]))
Object.defineProperty(basket.rest[0], "id", { value: 900 }); Object.defineProperty(basket.rest[0], "stock", { value: 0, writable: true, enumerable: true, configurable: true }); Object.defineProperty(basket.rest[0], "extra", { value: "x", enumerable: true })
console.log(show(basket.rest[0]), (basket.rest[0].stock ?? -5) + 1, flagsOf(basket.rest[0], "extra"), attempt(() => { (basket.rest[0] as any).extra = "y" }))
// Classes.
class Priced { net = 100; rate = 0.5; gross() { return this.net * (1 + this.rate) } }
const priced = new Priced()
Object.defineProperty(priced, "rate", { value: 0.1 })
console.log(priced.gross(), new Priced().gross(), Object.keys(priced).join(), flagsOf(priced, "rate"), flagsOf(priced, "gross"))
const items: Item[] = [plain, stocked, basket.first, basket.rest[1], make(11)]
let sum = 0
for (let i = 0; i < 100; i++) { const it = items[i % items.length]; sum += it.id + it.price + it.title.length + (it.stock ?? 0) + it.tags.length }
console.log(sum)
