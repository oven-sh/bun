// One generic interface is instantiated with numbers, strings, booleans, objects, functions, unions and itself.
interface Box<T> { value: T }
interface Pair<A, B> { first: A; second: B }
interface Cell<T = number> { value: T; next?: Cell<T> }
type Maybe<T> = { has: true; value: T } | { has: false }
function text(v: unknown): string { return Object.is(v, -0) ? "-0" : typeof v === "object" ? JSON.stringify(v) : typeof v === "function" ? "fn" : String(v) }
function unbox<T>(b: Box<T>): T { return b.value }
function rebox<T>(b: Box<T>, v: T): Box<T> { b.value = v; return b }
function box<T>(value: T): Box<T> { return { value } }
function swap<A, B>(p: Pair<A, B>): Pair<B, A> { return { first: p.second, second: p.first } }
function mapBox<T, U>(b: Box<T>, f: (v: T) => U): Box<U> { return { value: f(b.value) } }
const edges = [0, -0, 1, -1, 2.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 9007199254740992, 1e21, 5e-324]
const numbers: Box<number>[] = edges.map(value => ({ value }))
const generic: Box<number>[] = edges.map(box)
const strings: Box<string>[] = ["", "a", "undefined", "0", "long " + "rope ".repeat(3)].map(value => ({ value }))
const booleans: Box<boolean>[] = [{ value: true }, { value: false }]
console.log(numbers.map(unbox).map(text).join(), generic.map(unbox).map(text).join())
console.log(numbers.every((b, i) => Object.is(unbox(b), edges[i]) && Object.is(b.value, generic[i].value)), strings.map(unbox).join("|"), booleans.map(unbox).join())
console.log(numbers.map(b => unbox(b) + 1).map(text).join(), strings.map(b => unbox(b) + 1).join("|"), booleans.map(b => !unbox(b)).join())

// Every other sort of argument.
const nothing: Box<undefined> = { value: undefined }
const nil: Box<null> = { value: null }
const perhaps: Box<number | undefined>[] = [{ value: 1 }, { value: undefined }, { value: NaN }]
const nested: Box<Box<number>> = { value: { value: 7 } }
const deeper: Box<Box<Box<string>>> = box(box(box("deep")))
const list: Box<number[]> = { value: [1, 2] }
const thunk: Box<() => number> = { value: () => 42 }
const big: Box<bigint> = { value: 12345678901234567890n }
const either: Box<number | string>[] = [{ value: 1 }, { value: "one" }]
console.log(text(unbox(nothing)), text(unbox(nil)), perhaps.map(unbox).map(text).join(), unbox(unbox(nested)) + 1, unbox(unbox(unbox(deeper))).length, unbox(list).length, unbox(thunk)(), String(unbox(big)), either.map(unbox).map(v => typeof v).join())
console.log("value" in nothing, Object.keys(nothing).join(), JSON.stringify(nothing), JSON.stringify(nil), JSON.stringify(nested), JSON.stringify(deeper))

// All of them through Box<unknown>, read only.
const all: Box<unknown>[] = [...numbers.slice(0, 5), ...strings.slice(0, 2), ...booleans, nothing, nil, nested, list, thunk, big, ...either]
console.log(all.map(b => typeof b.value).join(), all.map(unbox).map(v => typeof v === "bigint" ? "big" : text(v)).join("|"))

// Stores through the generic function: the representation of a number changes under it.
const changing: Box<number> = { value: 1 }
const seen: string[] = []
for (const v of edges) seen.push(text(rebox(changing, v).value), text(changing.value * 1))
console.log(seen.join())
console.log(rebox(strings[0], "set").value, strings[0].value, rebox(booleans[0], false) === booleans[0], booleans[0].value, rebox(nested, { value: -0 }).value.value === 0, Object.is(nested.value.value, -0))
rebox(perhaps[0], undefined); rebox(perhaps[1], 5); rebox(either[0], "now a string"); rebox(either[1], 2)
console.log(perhaps.map(b => text(b.value)).join(), perhaps.map(b => "value" in b).join(), either.map(b => text(b.value)).join())

const pair: Pair<number, string> = { first: 1.5, second: "s" }
const swapped = swap(pair)
const twice = swap(swapped)
console.log(swapped.first + "!", swapped.second + 1, twice.first + 1, twice.second + "!", Object.keys(swapped).join(), JSON.stringify(swap({ first: { a: 1 }, second: [2] })), JSON.stringify(swap(swap({ second: null, first: undefined }))))
console.log(mapBox(numbers[4], n => n * 2).value, mapBox(numbers[4], n => "n" + n).value, mapBox(strings[1], s => s.length).value + 1, mapBox(mapBox(booleans[1], b => (b ? 1 : 0)), n => box(n)).value.value)

// A default type argument, a recursive instantiation, a discriminated generic.
const cells: Cell = { value: 1, next: { value: 2, next: { value: 3.5 } } }
const words: Cell<string> = { next: { value: "b" }, value: "a" }
function fold<T, R>(c: Cell<T> | undefined, start: R, f: (r: R, v: T) => R): R { for (; c !== undefined; c = c.next) start = f(start, c.value); return start }
console.log(fold(cells, 0, (r, v) => r + v), fold(words, "", (r, v) => r + v), fold(words, 0, (r, v) => r + v.length), fold<number, number>(undefined, -1, r => r))
function orElse<T>(m: Maybe<T>, d: T): T { return m.has ? m.value : d }
const maybes: Maybe<number>[] = [{ has: true, value: 0 }, { has: false }, { value: -0, has: true }]
console.log(maybes.map(m => text(orElse(m, 9))).join(), orElse<string>({ has: false }, "d"), orElse({ has: true, value: "v" }, "d"), orElse<number[]>({ has: true, value: [] }, [1]).length)

let total = 0
let letters = 0
for (let i = 0; i < 5000; i++) { total += unbox(numbers[i % 5]) + unbox(generic[i % 5]); letters += unbox(strings[i % strings.length]).length; if (unbox(booleans[i & 1])) total++ }
console.log(total, letters)
