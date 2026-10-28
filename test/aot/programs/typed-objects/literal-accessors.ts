// Getters and setters in object literals with a declared type, used at the same sites as plain literals of that type.
interface Temp { celsius: number; fahrenheit: number; label?: string }
const notes: string[] = []
function flush(): string { return notes.splice(0).join(",") }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function thermometer(start: number): Temp {
  return {
    celsius: start,
    get fahrenheit() { notes.push("get"); return this.celsius * 9 / 5 + 32 },
    set fahrenheit(f: number) { notes.push("set"); this.celsius = (f - 32) * 5 / 9 },
  }
}
function kindOf(o: object, k: string): string {
  const d = Object.getOwnPropertyDescriptor(o, k)
  if (d === undefined) return "none"
  return ("value" in d ? "data" : (d.get ? "g" : "") + (d.set ? "s" : "")) + (d.enumerable ? "E" : "") + (d.configurable ? "C" : "") + (d.writable ? "W" : "")
}
function show(t: Temp): string { return [t.celsius, t.fahrenheit, String(t.label), Object.keys(t).join("")].join("/") }
function warm(t: Temp): number { t.fahrenheit += 18; return t.celsius }
const plainTemp: Temp = { celsius: 10, fahrenheit: 50 }
const live = thermometer(100)
console.log(show(plainTemp), show(live), flush())
console.log(warm(plainTemp), warm(live), flush(), show(plainTemp), show(live), flush())
console.log(kindOf(live, "celsius"), kindOf(live, "fahrenheit"), kindOf(plainTemp, "fahrenheit"), kindOf(live, "label"))
// Copies call the getter once and hold a plain value.
const spreadCopy: Temp = { ...live }
const assigned: Temp = Object.assign({ celsius: 0, fahrenheit: 0 }, live)
console.log(flush(), kindOf(spreadCopy, "fahrenheit"), show(spreadCopy), show(assigned), JSON.stringify(live), flush(), Object.entries(live).join(";"), flush())
Object.assign(live, plainTemp)
console.log(flush(), show(live), flush())
// A getter alone: it changes another field between two reads of it; a store to it throws.
const sneaky: Temp = { celsius: 1, get fahrenheit() { this.celsius++; return 0 } }
function sumUp(t: Temp): number { return t.celsius * 100 + t.fahrenheit + t.celsius }
console.log(sumUp(sneaky), sumUp(plainTemp), sumUp(sneaky), attempt(() => { sneaky.fahrenheit = 1 }), attempt(() => warm(sneaky)), sneaky.celsius)
// An optional field as a getter that sometimes has nothing.
let asked = 0
const labelled: Temp = { celsius: 0, fahrenheit: 32, get label() { return ++asked % 2 ? "odd" : undefined } }
console.log(String(labelled.label), String(labelled.label), labelled.label ?? "none", labelled.label ?? "none", "label" in labelled, asked, show(labelled))
// The accessors are inherited: `this` is the heir.
const heir: Temp = Object.create(live)
heir.celsius = 0
console.log(heir.fahrenheit, live.celsius, (heir.fahrenheit = 212), heir.celsius, live.celsius, Object.keys(heir).join(), flush())
// A getter that replaces itself by a plain value.
const once: Temp = {
  celsius: 5,
  get fahrenheit() {
    notes.push("once")
    Object.defineProperty(this, "fahrenheit", { value: 41, writable: true, enumerable: true, configurable: true })
    return 41
  },
}
console.log(once.fahrenheit, once.fahrenheit, warm(once), once.fahrenheit, flush(), kindOf(once, "fahrenheit"), Object.keys(once).join())
// A setter alone.
const sinking = { celsius: 1, set fahrenheit(f: number) { this.celsius = f } }
const asTemp: Temp = sinking
asTemp.fahrenheit = 9
console.log(asTemp.celsius, (asTemp as any).fahrenheit, kindOf(asTemp, "fahrenheit"), JSON.stringify(asTemp), Object.keys(asTemp).join())
// The accessor is deleted and the field stored again: it is a plain field at the end of the keys.
const again = thermometer(1)
delete (again as any).fahrenheit
again.fahrenheit = 7
again.label = "again"
console.log(show(again), kindOf(again, "fahrenheit"), warm(again), flush() === "")
const temps: Temp[] = [plainTemp, live, sneaky, labelled, heir, once, spreadCopy, again]
let acc = 0
for (let round = 0; round < 30; round++) for (const t of temps) acc += t.fahrenheit + t.celsius
console.log(acc, notes.length, sneaky.celsius)
