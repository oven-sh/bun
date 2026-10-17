// The key order of typed objects with integer keys and symbols: indices ascending, then names in creation order, then symbols in creation order.
interface Named { alpha: number; beta?: string; gamma?: number }
const s1 = Symbol("s1"), s2 = Symbol("s2"), s3 = Symbol.for("s3")
function own(o: object): string { return Reflect.ownKeys(o).map(k => typeof k === "symbol" ? "@" + k.description : k).join() }
function show(o: object): string { return own(o) + " | " + Object.keys(o).join() + " | " + JSON.stringify(o) }

// With a name that the type does not declare among them: see type-rules/key-order-indices-and-symbols.
const rec: Named = { alpha: 1 }
const open1: any = rec
open1[s2] = "two"; open1[10] = "ten"; rec.gamma = 3; open1[2] = "two"; open1[s1] = "one"; rec.beta = "b"; open1["1"] = "one"
console.log(show(rec))
console.log(rec.alpha, rec.beta, rec.gamma, open1[1], open1["2"], open1[10], open1[s1], open1[s2])

// What looks like an index and what does not.
const edge: any = { alpha: 0 } as Named
for (const k of ["4294967294", "4294967295", "4294967296", "-1", "01", "1.5", "0", "1e3", " 2", "9007199254740991", "3"]) edge[k] = k.length
console.log(show(edge))

// Deleting and creating again: an index goes back to its sorted place, a name and a symbol go to the end.
delete open1[2]; delete open1[s2]; delete rec.gamma
open1[2] = "again"; open1[s2] = "again"; rec.gamma = 33
console.log(show(rec))

// A type that declares numeric names and a symbol name.
const tag: unique symbol = Symbol("tag")
interface Numbered { 1: string; 0: string; label: string; [tag]: number; 7?: number }
const numbered: Numbered = { label: "l", 1: "one", [tag]: 5, 0: "zero" }
console.log(show(numbered), numbered[0], numbered[1], numbered["0"], numbered.label, numbered[tag], numbered[7])
numbered[7] = 70
numbered[tag]++
console.log(show(numbered), numbered[7], numbered[tag], 7 in numbered, "7" in numbered, tag in numbered, 8 in numbered)

// Class instances.
class Holder { z = 1; a = 2; [s3] = "sym field"; 5 = "five" }
const holder = new Holder()
const open2: any = holder
open2[0] = "zero"; open2.b = 3; open2[s1] = 1
console.log(show(holder), holder.z, holder.a, holder[5], holder[s3])

// Every listing: for-in and the string listings skip symbols; the symbol listing has only them.
function listings(o: object): string {
  const forIn: string[] = []
  for (const k in o) forIn.push(k)
  return [forIn.join(), Object.getOwnPropertyNames(o).join(), Object.getOwnPropertySymbols(o).map(k => k.description).join(), Object.entries(o).map(e => e[0]).join(),
    own({ ...o }), own(Object.assign({}, o)), own(Object.getOwnPropertyDescriptors(o))].join(" | ")
}
console.log(listings(rec))
console.log(listings(numbered))
console.log(listings(holder))

// Symbols that are not enumerable are not copied; indices that are not enumerable are skipped in place. Indices that are not writable: see type-rules/key-order-indices-and-symbols.
const hidden: Named = { alpha: 1, beta: "b" }
Object.defineProperty(hidden, s1, { value: 1, enumerable: false, configurable: true })
Object.defineProperty(hidden, 3, { value: 3, writable: true, enumerable: false, configurable: true })
Object.defineProperty(hidden, s2, { value: 2, enumerable: true, configurable: true })
Object.defineProperty(hidden, 1, { value: 1, writable: true, enumerable: true, configurable: true })
console.log(show(hidden), own({ ...hidden }), hidden.alpha, hidden.beta)

// Many objects of the type: only some have indices and symbols, and one site reads the fields of all.
const many: Named[] = []
for (let i = 0; i < 9; i++) {
  const o: Named = i % 2 ? { alpha: i, beta: "b" + i } : { beta: "b" + i, alpha: i }
  if (i % 3 === 0) (o as any)[i] = i
  if (i % 4 === 0) (o as any)[s1] = i
  if (i % 3 === 1) o.gamma = i
  many.push(o)
}
console.log(many.map(o => own(o) + "=" + (o.alpha + (o.gamma ?? 0)) + o.beta).join(" "))
