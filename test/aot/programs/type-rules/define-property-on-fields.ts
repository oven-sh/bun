// `Object.defineProperty` and `Reflect.defineProperty` make a field of a typed object an accessor, read-only, non-enumerable or non-configurable as in plain JavaScript. A value of another kind is defined too, and the next typed read of that field throws a TypeError.
interface Item { id: number; title: string; price: number; stock?: number; tags: string[] }
const calls: string[] = []
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
const dynamic = make(1)
let base = 10
try { Object.defineProperty(dynamic, "price", { get() { calls.push("get"); return base }, set(x: number) { calls.push("set" + x); base = x * 2 }, enumerable: true, configurable: true }); console.log("accessor: no error") } catch (e) { console.log("accessor:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(show(dynamic), raise(dynamic, 1), calls.length, JSON.stringify(dynamic)) } catch (e) { console.log("line 17:", e instanceof TypeError ? "TypeError" : "other " + e) }
const fixedPrice = make(3)
try { Object.defineProperty(fixedPrice, "price", { writable: false }); console.log("read-only: no error") } catch (e) { console.log("read-only:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(show(fixedPrice), raise(fixedPrice, 1)) } catch (e) { console.log("line 20:", e instanceof TypeError ? "TypeError" : "other " + e) }
const hidden = make(4)
try { Object.defineProperty(hidden, "title", { enumerable: false }); console.log("hidden: no error") } catch (e) { console.log("hidden:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(show(hidden), JSON.stringify(hidden)) } catch (e) { console.log("line 23:", e instanceof TypeError ? "TypeError" : "other " + e) }
const pinned = make(5)
try { Object.defineProperty(pinned, "id", { configurable: false }); console.log("pinned: no error") } catch (e) { console.log("pinned:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.defineProperty(pinned, "stock", { value: 1, writable: true, enumerable: true, configurable: false }); console.log("absent, pinned: no error") } catch (e) { console.log("absent, pinned:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(show(pinned)) } catch (e) { console.log("line 27:", e instanceof TypeError ? "TypeError" : "other " + e) }
const minimal = make(6)
try { Object.defineProperty(minimal, "stock", { value: 7 }); console.log("absent, with the defaults: no error") } catch (e) { console.log("absent, with the defaults:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(show(minimal), (minimal.stock ?? 0) + 1) } catch (e) { console.log("line 30:", e instanceof TypeError ? "TypeError" : "other " + e) }
const lazyStock = make(7)
try { Object.defineProperty(lazyStock, "stock", { get() { calls.push("stock?"); return undefined }, configurable: true, enumerable: true }); console.log("absent, accessor: no error") } catch (e) { console.log("absent, accessor:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(show(lazyStock), "stock" in lazyStock, calls.length) } catch (e) { console.log("line 33:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Through a helper that only knows `object`, and on an object inside a typed field.
function harden(o: object, keys: string[]): void { for (const k of keys) Object.defineProperty(o, k, { writable: false, configurable: false }) }
interface Basket { first: Item; rest: Item[] }
const basket: Basket = { first: make(8), rest: [make(9), make(10)] }
try { harden(basket.first, ["id", "tags"]); console.log("through object: no error") } catch (e) { console.log("through object:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { harden(basket, ["first"]); console.log("the holder: no error") } catch (e) { console.log("the holder:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { basket.first.id++; basket.first.tags = []; basket.first = basket.rest[0] } catch (e) { console.log("line 40:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(show(basket.first), flagsOf(basket, "first")) } catch (e) { console.log("line 41:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Reflect.defineProperty(basket.first, "id", { get: () => 900, enumerable: true }); console.log("Reflect.defineProperty: no error") } catch (e) { console.log("Reflect.defineProperty:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.defineProperty(basket.first, "price", { value: "free" }); console.log("a value that does not fit: no error") } catch (e) { console.log("a value that does not fit:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.defineProperty(basket.first, "stock", { value: null, writable: true, enumerable: true, configurable: true }); console.log("absent, a value that does not fit: no error") } catch (e) { console.log("absent, a value that does not fit:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(show(basket.first)) } catch (e) { console.log("line 45:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Classes: an own accessor over a field.
class Priced { net = 100; rate = 0.5; gross() { return this.net * (1 + this.rate) } }
const priced = new Priced()
try { Object.defineProperty(priced, "rate", { get(this: Priced) { calls.push("rate"); return this.net / 1000 }, configurable: true }); console.log("accessor on an instance: no error") } catch (e) { console.log("accessor on an instance:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { priced.rate = 1 } catch (e) { console.log("line 50:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(priced.gross(), Object.keys(priced).join(), calls.length) } catch (e) { console.log("line 51:", e instanceof TypeError ? "TypeError" : "other " + e) }
