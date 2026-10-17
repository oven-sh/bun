// `new Map()` many times over: each is a Map of its own, empty, ordinary in every way, and survives collections.
const host = globalThis as any
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc
function table(): Map<string, number> { return new Map() }
function tableOfObjects(): Map<object, string> { return new Map<object, string>() }
const kept: Map<string, number>[] = []
let sizes = 0
for (let i = 0; i < 60000; i++) {
  const made = table()
  sizes += made.size
  if (i % 3 === 0) made.set("k" + (i % 7), i)
  if (i % 1000 === 0) kept.push(made)
  if (i % 20000 === 19999) collect()
}
console.log(sizes, kept.length, kept.map(map => [...map].join()).join(";"))
const one = table(), other = table()
console.log(one === other, one.size, one.get("a"), one.has("a"), one.delete("a"), [...one.keys()].length, one instanceof Map, Object.getPrototypeOf(one) === Map.prototype, Object.prototype.toString.call(one), Object.keys(one).length)
one.set("a", 1).set("b", 2)
console.log(other.size, one.size, JSON.stringify([...one]))
;(one as any).extra = "property"
console.log(Object.keys(one).join(), (other as any).extra, Object.isExtensible(other), Object.isFrozen(Object.freeze(other)))
const key = {}
const byObject = tableOfObjects().set(key, "found").set(one, "a map")
console.log(byObject.get(key), byObject.get(one), byObject.get({}), byObject.size)
class Registry { readonly entries = new Map<string, Registry>(); readonly names = new Map<number, string>() }
const registries: Registry[] = []
for (let i = 0; i < 5000; i++) { const registry = new Registry(); if (i) registry.entries.set("previous", registries[i - 1]); registry.names.set(i, "r" + i); registries.push(registry) }
collect()
let depth = 0
for (let at: Registry | undefined = registries[4999]; at; at = at.entries.get("previous")) depth += at.names.size
console.log(depth, registries[17].names.get(17))
