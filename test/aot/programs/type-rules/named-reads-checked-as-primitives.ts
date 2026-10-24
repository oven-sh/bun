// What is read by a name out of a value whose type says nothing, or out of an object that only looks like its type, is held to number, string or boolean, with or without undefined and null.
interface Row { id: number; label: string; done: boolean; weight?: number; note?: string; parent: number | null; alias: string | null; score?: number | null; title?: string | null }
class Kept { id = 7; label = "kept"; done = true; weight = 2.5; note = "n"; parent: number | null = null; alias: string | null = "a"; score: number | null = 1; title: string | null = null }
class WithGetters { get id() { return 8 } get label() { return "got" + "ten" } get done() { return false } get weight() { return undefined } get note() { return undefined } get parent() { return 3 } get alias() { return null } get score() { return null } get title() { return "t" } }
function message(error: unknown): string { return error instanceof Error ? error.name : String(error) }
function attempt(what: string, f: () => unknown) { try { console.log(what, String(f())) } catch (error) { console.log(what, "|", message(error)) } }

function idOf(value: any): number { return value.id }
function labelOf(value: any): string { return value.label }
function doneOf(value: any): boolean { return value.done }
function weightOf(value: any): number | undefined { return value.weight }
function noteOf(value: any): string | undefined { return value.note }
function parentOf(value: any): number | null { return value.parent }
function aliasOf(value: any): string | null { return value.alias }
function scoreOf(value: any): number | null | undefined { return value.score }
function titleOf(value: any): string | null | undefined { return value.title }
function written(value: any): string { return (value.id as number) + 1 + "," + (value.label as string).length + "," + ((value.done as boolean) ? "y" : "n") + "," + (value.note as string | undefined) }
function ofRow(row: Row): string { return [row.id, row.label, row.done, row.weight, row.note, row.parent, row.alias, row.score, row.title].join() }
const readers: [string, (value: any) => unknown][] = [["id", idOf], ["label", labelOf], ["done", doneOf], ["weight", weightOf], ["note", noteOf], ["parent", parentOf], ["alias", aliasOf], ["score", scoreOf], ["title", titleOf], ["written", written], ["row", ofRow]]

function wide(i: number): any { const o: any = {}; for (let k = 0; k < i; k++) o["pad" + k] = k; o.id = i + 0.5; o.label = "w" + i; o.done = i % 2 === 0; o.parent = null; o.alias = null; return o }
const literal: Row = { id: 1, label: "one", done: false, parent: null, alias: null }
const full: Row = { id: -0, label: "", done: true, weight: NaN, note: "x".repeat(3) + "y", parent: 2 ** 40, alias: "al", score: Infinity, title: "ti" }
const good: [string, any][] = [
  ["literal", literal], ["full", full], ["kept", new Kept], ["getters", new WithGetters], ["parsed", JSON.parse('{"id":5,"label":"p","done":true,"weight":1e300,"note":"q","parent":null,"alias":null,"score":null,"title":null}')],
  ["heir", Object.create({ id: 9, label: "proto", done: true, parent: 1, alias: "pa" })], ["proxy", new Proxy({ id: 10, label: "px", done: false, parent: null, alias: null }, {})],
  ["wide3", wide(3)], ["wide40", wide(40)], ["wide90", wide(90)], ["function", Object.assign(() => 0, { id: 11, label: "fn", done: true, parent: null, alias: null })], ["array", Object.assign([1], { id: 12, label: "arr", done: false, parent: null, alias: null })],
]
for (let round = 0; round < 3; round++) for (const [name, value] of good) console.log(round, name, readers.map(([, read]) => String(read(value))).join(" ; "))

let sum = 0, text = 0, yes = 0
const many = Array.from({ length: 24 }, (_, i) => wide(i))
for (let i = 0; i < 30000; i++) { const o = many[i % 24]; sum += idOf(o); text += labelOf(o).length; if (doneOf(o)) yes++; if (weightOf(o) === undefined) yes++; if (aliasOf(o) === null) text++ }
console.log(sum, text, yes)

const bad: [string, any][] = [
  ["texts", { id: "1", label: "l", done: "true", weight: "2", note: "n", parent: "p", alias: "a", score: "s", title: "t" }],
  ["numbers", { id: 1, label: 2, done: 1, weight: 3, note: 4, parent: 5, alias: 6, score: 7, title: 8 }],
  ["booleans", { id: true, label: false, done: true, weight: true, note: false, parent: true, alias: false, score: true, title: false }],
  ["nulls", { id: null, label: null, done: null, weight: null, note: null, parent: null, alias: null, score: null, title: null }],
  ["nothing", {}], ["objects", { id: {}, label: [], done: {}, weight: [], note: {}, parent: {}, alias: [], score: {}, title: () => 0 }],
  ["symbols", { id: Symbol.iterator, label: Symbol.iterator, done: Symbol.iterator, weight: 1n, note: 1n, parent: 1n, alias: Symbol.iterator, score: Symbol.iterator, title: 1n }],
  ["getter", { get id() { return "late" }, get label() { return 0 }, get done() { return 0 }, get parent() { return undefined }, get alias() { return undefined } }],
  ["thrower", { get id() { throw new RangeError("id") }, get label() { throw new RangeError("label") }, get done() { throw new RangeError("done") }, get weight() { throw new RangeError("weight") }, get note() { throw new RangeError("note") }, get parent() { throw new RangeError("parent") }, get alias() { throw new RangeError("alias") }, get score() { throw new RangeError("score") }, get title() { throw new RangeError("title") } }],
  ["undefined", undefined], ["null", null], ["seven", 7], ["text", "text"],
]
for (let round = 0; round < 2; round++) for (const [name, value] of bad) for (const [what, read] of readers) attempt(round + " " + name + " " + what, () => read(value))

function inOrder(value: any, log: string[]): string { const first: number = value.first; log.push("between"); const second: string = value.second; return first + second }
for (const value of [{ first: 1, second: "s" }, { first: "no", second: "s" }, { first: 1, second: 2 }]) { const log: string[] = []; attempt("order", () => inOrder(value, log)); console.log(log.join()) }
function caughtHere(value: any): string { try { const n: number = value.id; return "number " + n } catch (error) { return "caught " + message(error) } finally { sum++ } }
console.log(caughtHere({ id: 4 }), "|", caughtHere({ id: "4" }), "|", caughtHere(null), sum)
