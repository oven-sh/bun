// Intersection types: an object created as `A & B` is read and written as `A`, as `B` and as the intersection.
type HasId = { id: number }
type HasLabel = { label: string; note?: string }
type Stamps = { created: number; updated?: number }
type Entity = HasId & HasLabel
type Stored = Entity & Stamps
type Overlap = { id: number; shared: number | string } & { shared: number; extra: boolean }
interface Walker { legs: number; walk(): string }
interface Swimmer { fins: number; swim(): string }
type Amphibian = Walker & Swimmer
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function idOf(h: HasId): number { return h.id }
function labelOf(h: HasLabel): string { return h.label + (h.note === undefined ? "" : "/" + h.note) }
function age(t: Stamps): number { return (t.updated ?? t.created) - t.created }
const entity: Entity = { label: "e", id: 1 }
const stored: Stored = { created: 100, id: 2, label: "s" }
const both: Stored = { updated: 5, note: "n", label: "b", created: 6, id: 3 }
const ids: HasId[] = [entity, stored, both, { id: 4 }]
const labels: HasLabel[] = [entity, stored, both, { label: "only" }]
const stamps: Stamps[] = [stored, both, { created: 1 }]
console.log(ids.map(idOf).join(), labels.map(labelOf).join(), stamps.map(age).join())
console.log([entity, stored, both].map(show).join(" ; "))
const storedAsLabel: HasLabel = stored
const storedAsStamps: Stamps = stored
storedAsStamps.updated = 150
storedAsLabel.note = "late"
ids[1].id = 20
console.log(show(stored), stored.id, stored.note, stored.updated, age(stored), labelOf(stored))
delete storedAsStamps.updated
storedAsStamps.updated = 101
console.log(show(stored), "updated" in entity, (entity as Partial<Stored>).updated)

const overlap: Overlap = { shared: 2, id: 1, extra: true }
const leftHalf: { id: number; shared: number | string } = overlap
const rightHalf: { shared: number; extra: boolean } = overlap
rightHalf.shared += 0.5
console.log(leftHalf.shared, overlap.shared * 2, typeof leftHalf.shared, show(overlap))

const frog: Amphibian = { legs: 4, fins: 0, walk() { return "walk " + this.legs }, swim() { return "swim " + this.fins + "/" + this.legs } }
const walker: Walker = frog
const swimmer: Swimmer = frog
walker.legs = 2
swimmer.fins = 1
console.log(frog.walk(), frog.swim(), walker.walk(), swimmer.swim(), Object.keys(swimmer).join())

// The two halves are put together by a generic function.
function merge<A extends object, B extends object>(x: A, y: B): A & B { return { ...x, ...y } }
const merged = merge(stored, { extra: [1], id: 77 })
console.log(show(merged), merged.id, merged.extra.length, merged.created, stored.id, idOf(merged), age(merged))
// The second half arrives after creation, by Object.assign. (Such an object seen as that half alone, or cast from any: type-rules/intersection-types.)
function withId<T extends object>(value: T, id: number): T & HasId { return Object.assign(value, { id }) }
const labelled: HasLabel = { label: "grown" }, direct: HasLabel = { label: "direct" }
const grown = withId(labelled, 9), grownDirectly: HasLabel & HasId = Object.assign(direct, { id: 8 })
console.log(grown.id, grown.label, show(labelled), (grown as object) === labelled, grownDirectly.id, show(direct))

// An intersection distributes over a union.
type Painted = ({ kind: "c"; r: number } | { kind: "s"; side: number }) & { colour: string }
function paint(p: Painted): string { return p.colour + (p.kind === "c" ? " circle " + p.r : " square " + p.side) }
const painted: Painted[] = [{ kind: "c", r: 1, colour: "red" }, { colour: "blue", side: 2, kind: "s" }]
const colours: { colour: string }[] = painted
colours[0].colour = "green"
console.log(painted.map(paint).join(), painted.map(show).join(" ; "))

// A branded primitive is a primitive: the object half of the intersection exists in the checker only.
type Brand<T, B extends string> = T & { readonly __brand: B }
type UserId = Brand<number, "user">
type Slug = Brand<string, "slug">
function userId(n: number): UserId { return n as UserId }
function slug(s: string): Slug { return s as Slug }
const users: UserId[] = [userId(5), userId(2.5), userId(-0), userId(NaN)]
const account: { owner: UserId; path: Slug; previous?: UserId } = { owner: users[0], path: slug("a-b") }
console.log(users.map(u => typeof u + (u + 1)).join(), account.owner * 2, account.path.length, account.path.toUpperCase(), account.path + "!", show(account), Object.is(users[2], -0))
account.previous = account.owner
account.owner = userId(account.owner + 1)
console.log(account.owner, account.previous, account.owner > account.previous, new Map<UserId, Slug>([[account.owner, account.path]]).get(userId(6)), `${account.path}/${account.owner}`)

let total = 0
for (let i = 0; i < 3000; i++) total += idOf(ids[i & 3]) + labelOf(labels[i & 3]).length + age(stamps[i % 3])
console.log(total)
