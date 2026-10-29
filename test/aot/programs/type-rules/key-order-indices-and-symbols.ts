// The order of own keys of typed objects that also have index and symbol keys.
interface Named { alpha: number; beta?: string; gamma?: number }
const s1 = Symbol("s1"), s2 = Symbol("s2")
function own(o: object): string { return Reflect.ownKeys(o).map(k => typeof k === "symbol" ? "@" + k.description : k).join() }
function show(o: object): string { return own(o) + " | " + Object.keys(o).join() + " | " + JSON.stringify(o) }
const rec: Named = { alpha: 1 }
const open1: any = rec
open1[s2] = "two"; open1[10] = "ten"; rec.gamma = 3; open1[2] = "two"; open1.extra = true; open1[s1] = "one"; rec.beta = "b"; open1["1"] = "one"
console.log(show(rec))
console.log(rec.alpha, rec.beta, rec.gamma, open1.extra)
delete open1[2]; delete open1[s2]; delete rec.gamma
open1[2] = "again"; open1[s2] = "again"; rec.gamma = 33
console.log(show(rec))
function listings(o: object): string {
  const forIn: string[] = []
  for (const k in o) forIn.push(k)
  return [forIn.join(), Object.getOwnPropertyNames(o).join(), Object.entries(o).map(e => e[0]).join(), own({ ...o }), own(Object.assign({}, o)), own(Object.getOwnPropertyDescriptors(o))].join(" | ")
}
console.log(listings(rec))
// An indexed property that is not writable, or an accessor, is defined as in plain Bun.
const hidden: Named = { alpha: 1, beta: "b" }
try { Object.defineProperty(hidden, 3, { value: 3, enumerable: false, configurable: true }); console.log("index, not writable, not enumerable: no error") } catch (e) { console.log("index, not writable, not enumerable:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.defineProperty(hidden, 1, { value: 1, enumerable: true, configurable: true }); console.log("index, not writable: no error") } catch (e) { console.log("index, not writable:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { Object.defineProperty(hidden, 2, { get() { return 2 }, enumerable: true, configurable: true }); console.log("index, getter: no error") } catch (e) { console.log("index, getter:", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(show(hidden))
