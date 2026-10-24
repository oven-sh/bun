// What is read by a name out of a value whose type says nothing is held to an array type, with or without undefined and null.
class Heir extends Array<number> { sum(): number { let s = 0; for (const n of this) s += n; return s } }
function message(error: unknown): string { return error instanceof Error ? error.name : String(error) }
function attempt(what: string, f: () => unknown) { try { console.log(what, String(f())) } catch (error) { console.log(what, "|", message(error)) } }
function show(list: readonly unknown[] | null | undefined): string { return list == null ? String(list) : list.length + ":" + Array.prototype.join.call(list, "/") }

function numbersOf(value: any): number[] { return value.list }
function textsOf(value: any): string[] | undefined { return value.list }
function anyOf(value: any): unknown[] | null { return value.list }
function eitherOf(value: any): unknown[] | null | undefined { return value.list }
function written(value: any): number { return (value.list as number[]).length }
const readers: [string, (value: any) => unknown][] = [["numbers", v => show(numbersOf(v))], ["texts", v => show(textsOf(v))], ["any", v => show(anyOf(v))], ["either", v => show(eitherOf(v))], ["written", written]]

const sparse: number[] = []; sparse[5000] = 1; sparse.length = 3
const reparented = [1, 2]; Object.setPrototypeOf(reparented, { join: Array.prototype.join })
const withGetter = [1, 2, 3]; Object.defineProperty(withGetter, 1, { get() { return 20 } })
const lists: [string, unknown][] = [
  ["empty", []], ["numbers", [1, 2.5, -0]], ["texts", ["a", "b"]], ["mixed", [1, "a", null]], ["holes", [1, , 3]], ["heir", Heir.from([1, 2, 3])], ["sparse", sparse], ["reparented", reparented], ["getter", withGetter],
  ["frozen", Object.freeze([7])], ["named", Object.assign([1], { extra: 2 })], ["made", new Array(2)], ["undefined", undefined], ["null", null],
  ["typed array", new Uint8Array(2)], ["like", { length: 1, 0: "x" }], ["text", "ab"], ["number", 3], ["true", true], ["proxy", new Proxy([1], {})], ["arguments", (function (...rest: number[]) { return arguments })(1, 2)], ["set", new Set([1])], ["function", () => 0], ["symbol", Symbol.iterator],
]
for (let round = 0; round < 2; round++) for (const [name, list] of lists) for (const [what, read] of readers) {
  attempt(round + " " + name + " own " + what, () => read({ list }))
  attempt(round + " " + name + " inherited " + what, () => read(Object.create({ list })))
  attempt(round + " " + name + " getter " + what, () => read({ get list() { return list } }))
}
let total = 0
const holders = Array.from({ length: 12 }, (_, i) => { const o: any = {}; for (let k = 0; k < i; k++) o["p" + k] = k; o.list = i % 3 ? [i] : Heir.of(i, i); return o })
for (let i = 0; i < 30000; i++) total += numbersOf(holders[i % 12]).length + (textsOf(holders[i % 12]) === undefined ? 1 : 0)
console.log(total)
