// Several first stores in a row to one typed record under another prototype: they are tested together, and each must still see a setter, a read-only property or a proxy of the chain, before and after the chain changes.
// IR+ ^layout L\d+ .*name="Fields" (?!.*impossibleMutations=\[[^\]]*ChangePrototype)(?!.*isStable=true)
interface Fields { a: number; count?: any; ended?: any; size?: number; late?: any }
const calls: string[] = []
const plainChain: any = Object.create({ count: 0 })
plainChain.ended = false
const settingChain: any = Object.create({ count: 0 })
Object.defineProperty(settingChain, "ended", { get() { return "got" }, set(value) { calls.push("set ended " + value) }, configurable: true })
function make(i: number, chain: any): Fields {
  const record: Fields = { a: i }
  Object.setPrototypeOf(record, chain)
  return record
}
function fill(record: Fields, i: number) {
  record.count = i
  record.ended = true
  record.size = i
  record.late = "late"
}
function countUntyped(record: any) { return record.count }
function endUntyped(record: any) { record.ended = "untyped" }
function describe(record: Fields) {
  return [countUntyped(record), record.count, record.ended, record.size, record.late, Object.keys(record).join(), JSON.stringify(record)].join(" | ")
}
function round(label: string, maker: (i: number, chain: any) => Fields = make) {
  let said = ""
  for (let i = 0; i < 6; i++) {
    const chain = i % 2 ? settingChain : plainChain
    const record = maker(i, chain)
    let outcome = "done"
    try { fill(record, i) } catch (error) { outcome = error instanceof TypeError ? "TypeError" : "another error" }
    if (i >= 4) said += "\n  " + outcome + " | " + describe(record)
  }
  console.log(label + said + "\n  calls " + calls.length + " " + calls.slice(-1).join())
}
round("at first")
Object.defineProperty(plainChain, "size", { set(value) { calls.push("set size " + value) }, configurable: true })
round("a setter appears in the chain that had none")
delete plainChain.size
round("and goes again")
Object.defineProperty(Object.getPrototypeOf(plainChain), "count", { value: 9, writable: false, configurable: true })
round("the upper holder's property is read-only")
Object.defineProperty(Object.getPrototypeOf(plainChain), "count", { value: 9, writable: true, configurable: true })
round("writable again")
delete settingChain.ended
round("the setter is gone")
Object.setPrototypeOf(plainChain, new Proxy({}, { set(target, key, value, receiver) { calls.push("proxy set " + String(key)); return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true }) } }))
round("a proxy above")
const makers = [make]
const closed = makers[0](7, settingChain)
Object.preventExtensions(closed)
let outcome = "done"
try { fill(closed, 7) } catch (error) { outcome = error instanceof TypeError ? "TypeError" : "another error" }
console.log("closed\n  " + outcome + " | " + describe(closed))
const stored = makers[0](8, plainChain)
endUntyped(stored)
fill(stored, 8)
console.log("stored to by untyped code first\n  " + describe(stored))
