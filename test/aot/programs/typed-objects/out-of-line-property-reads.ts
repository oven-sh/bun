// An object of one subtype is used as a sibling subtype: the sibling's fields have no room in it. They are read over and over at the same sites while they are stored, changed, deleted and redefined.
interface Type { flags: number; id: number }
interface InterfaceType extends Type { typeParameters: string[]; thisType?: Type }
interface WithDeclaredMembers extends InterfaceType { declaredProperties: string[]; declaredCalls: number[]; declaredCount: number; declaredName?: string }
interface GenericType extends InterfaceType { instantiations: Map<string, Type>; variances?: number[] }
interface Cached extends Type { iterationTypes?: string; awaited?: Type; a1?: number; a2?: number; a3?: number; a4?: number; a5?: number; a6?: number; a7?: number; a8?: number }
let nextId = 0
function TypeCtor(this: Type, flags: number) { this.flags = flags; this.id = ++nextId }
const Type = TypeCtor as unknown as new (flags: number) => Type
function createInterface(name: string): InterfaceType { const type = new Type(2) as InterfaceType; type.typeParameters = [name]; return type }
function createGeneric(name: string): GenericType { const type = createInterface(name) as GenericType; type.flags = 1; type.instantiations = new Map(); return type }
function resolveDeclaredMembers(type: InterfaceType): WithDeclaredMembers {
  if (!(type as WithDeclaredMembers).declaredProperties) {
    (type as WithDeclaredMembers).declaredProperties = ["p" + type.id];
    (type as WithDeclaredMembers).declaredCalls = [type.id];
    (type as WithDeclaredMembers).declaredCount = type.id * 2
  }
  return type as WithDeclaredMembers
}
function weigh(type: InterfaceType): number {
  const resolved = resolveDeclaredMembers(type)
  return resolved.declaredProperties.length + resolved.declaredCalls[0] + resolved.declaredCount + (resolved.declaredName ? resolved.declaredName.length : 0)
}
const types: InterfaceType[] = []
for (let i = 0; i < 300; i++) types.push(i % 3 ? createGeneric("T" + i) : createInterface("U" + i))
let total = 0
for (let round = 0; round < 60; round++) for (const type of types) total += weigh(type)
console.log("weighed", total)
const generic = types[1] as GenericType
console.log(Object.keys(generic).join(), JSON.stringify((generic as InterfaceType as WithDeclaredMembers).declaredProperties), generic.instantiations.size)
console.log(Object.keys(types[0]).join())

// What is read changes between the reads.
const seen: string[] = []
const subject = resolveDeclaredMembers(types[4])
for (let i = 0; i < 12; i++) {
  if (i === 2) subject.declaredCount = -1
  if (i === 4) subject.declaredName = "named"
  if (i === 6) delete subject.declaredName
  if (i === 8) (subject as any).declaredCount = 0.5
  if (i === 10) subject.declaredProperties = []
  seen.push(String(weigh(subject)))
}
console.log(seen.join())

// One site, many objects, absent and present by turns.
function iterationTypesOf(type: Type): string | undefined { return (type as Cached).iterationTypes }
function awaitedOf(type: Type): Type | undefined { return (type as Cached).awaited }
let found = 0, missing = 0
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < types.length; i++) {
    if (round === 10 && i % 2) (types[i] as Type as Cached).iterationTypes = "it" + i
    if (round === 20 && i % 4 === 1) delete (types[i] as Type as Cached).iterationTypes
    if (round === 30 && i % 5 === 0) (types[i] as Type as Cached).awaited = types[(i + 1) % types.length]
    iterationTypesOf(types[i]) ? found++ : missing++
    if (awaitedOf(types[i])) found += awaitedOf(types[i])!.id
  }
}
console.log("found", found, "missing", missing)

// More of them than fit in the object that keeps them.
function sumOfCached(type: Type): number { const c = type as Cached; return (c.a1 ?? 0) + (c.a2 ?? 0) + (c.a3 ?? 0) + (c.a4 ?? 0) + (c.a5 ?? 0) + (c.a6 ?? 0) + (c.a7 ?? 0) + (c.a8 ?? 0) }
const crowded = createGeneric("crowded") as Type as Cached
const sums: number[] = []
for (let i = 1; i <= 8; i++) { (crowded as any)["a" + i] = i * 10 ** (i - 1); for (let again = 0; again < 50; again++) sumOfCached(crowded); sums.push(sumOfCached(crowded)) }
console.log(sums.join())
for (let i = 1; i <= 8; i += 2) delete (crowded as any)["a" + i]
console.log(sumOfCached(crowded), Object.keys(crowded).join())

// Hundreds of properties, then a read of a declared name among them.
const dictionary = createGeneric("dictionary") as Type as Cached
for (let i = 0; i < 300; i++) (dictionary as any)["x" + i] = i
dictionary.a3 = 3
for (let i = 0; i < 300; i += 2) delete (dictionary as any)["x" + i]
const reads: (number | undefined)[] = []
for (let i = 0; i < 6; i++) { if (i === 2) delete dictionary.a3; if (i === 4) dictionary.a3 = 33; reads.push((dictionary as Cached).a3, sumOfCached(dictionary)) }
console.log(reads.join())

// Redefined: hidden, read only, then an own data property again.
const redefined = createGeneric("redefined") as Type as Cached
redefined.a1 = 1
const states: string[] = []
const state = () => states.push(sumOfCached(redefined) + ":" + Object.keys(redefined).includes("a1"))
for (let i = 0; i < 30; i++) sumOfCached(redefined)
state()
Object.defineProperty(redefined, "a1", { value: 2, enumerable: false, writable: false, configurable: true }); state()
Object.defineProperty(redefined, "a1", { value: 3, enumerable: true, writable: true, configurable: true }); state()
console.log(states.join())

// The objects die and others take their places.
const host = globalThis as any
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc
let survivors = 0
for (let generation = 0; generation < 6; generation++) {
  const young: InterfaceType[] = []
  for (let i = 0; i < 2000; i++) young.push(createGeneric("y" + i))
  for (let round = 0; round < 3; round++) for (const type of young) survivors += weigh(type) - type.id * 3
  collect()
}
console.log("survivors", survivors)
for (let round = 0; round < 3; round++) { collect(); total = 0; for (const type of types) total += weigh(type); console.log("after a collection", total) }
