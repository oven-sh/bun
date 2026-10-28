// Mapped types (`Partial`, `Required`, `Readonly`, `Pick`, `Omit`, `Record`, and user-defined ones) are further types of the same objects.
interface Settings { width: number; height: number; title: string; dark?: boolean }
type Nullable<T> = { [K in keyof T]: T[K] | null }
type Getters<T> = { [K in keyof T as `get_${string & K}`]: () => T[K] }
type Flags3 = Record<"a" | "b" | "c", boolean>
type Counts = Record<string, number>
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
const base: Settings = { width: 1, height: 2, title: "t" }
const partial: Partial<Settings> = { height: 5 }
const partialOfBase: Partial<Settings> = base
const required: Required<Settings> = { dark: false, title: "r", height: 3, width: 4 }
const readonlyView: Readonly<Settings> = base
const picked: Pick<Settings, "width" | "title"> = base
const pickedFresh: Pick<Settings, "width" | "title"> = { title: "p", width: 6 }
const omitted: Omit<Settings, "title"> = required
const omittedFresh: Omit<Settings, "title" | "dark"> = { height: 7, width: 8 }
function area(s: Partial<Settings>): number { return (s.width ?? 10) * (s.height ?? 10) }
function titleOf(s: Partial<Settings>): string { return s.title ?? "untitled" }
function isDark(s: Partial<Settings>): string { return String(s.dark) + ("dark" in s ? "+" : "-") }
const parts: Partial<Settings>[] = [partial, partialOfBase, required, pickedFresh, omittedFresh, {}]
console.log(parts.map(area).join(), parts.map(titleOf).join(), parts.map(isDark).join())
console.log(parts.map(show).join(" ; "))

partialOfBase.width = 100
partialOfBase.dark = true
picked.title = "picked"
console.log(show(base), readonlyView.width, readonlyView.dark, base.title, Object.isFrozen(readonlyView), picked.width)
delete partialOfBase.dark
console.log(show(base), base.dark, isDark(base), delete partialOfBase.dark)
partial.title = "late"
partial.width = 0
console.log(show(partial), area(partial), titleOf(partial))
omitted.dark = true
omitted.width = -0
console.log(show(required), required.dark, Object.is(required.width, -0), (omitted as Settings).title)

const nullable: Nullable<Settings> = { width: null, height: 2, title: null, dark: null }
const nullableBase: Nullable<Settings> = base
function orZero(n: Nullable<Settings>): string { return [n.width ?? "w", n.height ?? "h", n.title ?? "t", n.dark === null ? "null" : n.dark === undefined ? "none" : n.dark].join("/") }
console.log(orZero(nullable), orZero(nullableBase), show(nullable))
nullable.width = 3
nullable.dark = undefined
console.log(orZero(nullable), show(nullable), "dark" in nullable)

const getters: Getters<Pick<Settings, "width" | "title">> = { get_title: () => base.title, get_width: () => base.width }
console.log(getters.get_width() + 1, getters.get_title().length, Object.keys(getters).join())

// A record over three literal keys has three fields; the keys may still arrive as values. (One of the three deleted through the dictionary: type-rules/mapped-types.)
const flags: Flags3 = { c: true, a: false, b: true }
const order = ["a", "b", "c"] as const
console.log(order.map(k => flags[k]).join(), show(flags))
for (const k of order) flags[k] = !flags[k]
console.log(flags.a, flags.b, flags.c, show(flags))
const asDictionary: Record<string, boolean> = flags
asDictionary.d = true
asDictionary["a"] = false
asDictionary.b = false
delete asDictionary.d
asDictionary.d = true
const seen: string[] = []
for (const k in asDictionary) seen.push(k + "=" + asDictionary[k])
console.log(seen.join(), show(flags), flags.a, flags.b, flags.c)

// A dictionary: any key, keys that look like indices first, a missing key reads as undefined.
const counts: Counts = {}
for (const word of "the cat and the dog and the bird".split(" ")) counts[word] = (counts[word] ?? 0) + 1
const special: string = "toString"
counts[3] = 3; counts["1"] = 1; counts[special] = 9; counts["__x"] = -0
console.log(show(counts), counts.the, counts["and"], counts.missing === undefined, "missing" in counts, (counts.absent || 0) + 1, counts[special] + 1, typeof counts.valueOf)
delete counts.the
counts.the = 1
console.log(Object.keys(counts).join(), Object.values(counts).reduce((x, y) => x + y, 0))

// A mapped type over the keys of a value.
const palette = { red: 1, green: 2, blue: 3 }
type Names = { [K in keyof typeof palette]: string }
const names: Names = { blue: "b", red: "r", green: "g" }
function pairUp(k: keyof typeof palette): string { return names[k] + palette[k] }
console.log((Object.keys(palette) as (keyof typeof palette)[]).map(pairUp).join(), show(names))

let total = 0
for (let i = 0; i < 3000; i++) total += area(parts[i % parts.length]) + titleOf(parts[i % parts.length]).length
console.log(total)
