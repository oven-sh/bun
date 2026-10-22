// A function that callers from outside reach has a version whose parameter is only expected to have the layouts of its written type.
// Objects of one of them never get to a store of the optional fields, so they have no room for them, and somebody reads the fields of such an object.
interface Filled { id: number; late?: string; count?: number }
interface Bare { id: number; late?: string; count?: number }
type Entry = Filled | Bare

function filled(id: number): Filled {
  const entry: Filled = { id }
  entry.late = "first" + id
  entry.count = id
  return entry
}
function bare(id: number): Bare { return { id } }

function replace(entry: Entry, value: string | undefined): number {
  if (entry.late !== undefined) entry.late = value
  return entry.id
}
function bump(entry: Entry, by: number): number {
  const id = entry.id
  entry.count = (entry.count ?? 0) + by
  return id
}
function show(entry: Filled): string { return entry.id + ":" + entry.late + ":" + entry.count + ":" + Object.keys(entry).join("") }

const kept = bare(7)
const registry: Record<string, unknown> = structuredClone({})
registry.replace = replace
registry.bump = bump

const list: Filled[] = [filled(1), filled(2), filled(3)]
let sum = 0
for (const entry of list) sum += replace(entry, "x" + entry.id) + bump(entry, 10)
console.log(sum, list.map(show).join(" "))

const copies: Filled[] = structuredClone(list)
copies.push(structuredClone({ id: 4 }))
for (const entry of copies) sum += (registry.replace as typeof replace)(entry, "y" + entry.id) + (registry.bump as typeof bump)(entry, 100)
console.log(sum, copies.map(show).join(" "))

for (const entry of list) sum += replace(entry, undefined) + bump(entry, 1000)
console.log(sum, list.map(show).join(" "))
for (const entry of list) sum += replace(entry, "z" + entry.id)
console.log(sum, list.map(show).join(" "), kept.id, kept.late, kept.count)
