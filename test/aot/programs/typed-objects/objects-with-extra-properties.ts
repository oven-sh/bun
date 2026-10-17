// Structural subtyping: objects with more properties than the type through which they are used.
interface Narrow { id: number }
function keysOf(x: Narrow): string { return Object.keys(x).join() }
function copy(x: Narrow): Narrow { return { ...x } }
function json(x: Narrow): string { return JSON.stringify(x) }
function forIn(x: Narrow): string { const out: string[] = []; for (const k in x) out.push(k); return out.join() }
function rest(x: Narrow): string { const { id, ...others } = x; return id + JSON.stringify(others) + Object.keys(others).length }
function entries(x: Narrow): string { return Object.entries(x).map(([k, v]) => k + "=" + JSON.stringify(v)).join("&") }
function override(x: Narrow): string { return JSON.stringify({ ...x, id: -1 }) + JSON.stringify({ id: -1, ...(x as Partial<Narrow>) }) }
function idOnly({ id }: Narrow): number { return id }
class Row { cells = ["a"]; hidden?: string; constructor(public id: number, public owner: string) {} width() { return this.cells.length } }
class WideRow extends Row { more = true }
const wide = { id: 1, label: "w", nested: { deep: true }, list: [1, 2] }
const row = new Row(2, "r")
const wideRow = new WideRow(2, "wr")
const grown: Narrow = { id: 4 }
;(grown as any).added = "later"
;(grown as any)[7] = "seven"
;(grown as any)[Symbol.for("extra")] = "symbol"
const foreign: Narrow = JSON.parse('{"id":5,"z":0,"a":[{"id":6}]}')
const exact: Narrow = { id: 7 }
const all: Narrow[] = [wide, row, wideRow, grown, foreign, exact]
for (const f of [keysOf, json, forIn, rest, entries, override]) console.log(all.map(f).join(" ; "))
console.log(all.map(idOnly).join(), all.map(x => keysOf(copy(x))).join(" ; "))

// A copy is a plain object with the same own properties, and shares what they refer to.
const copied = copy(wide) as typeof wide
console.log(copied.label, copied.nested === wide.nested, copied.list === wide.list, copied === wide, copied.id)
const copiedRow = copy(row)
console.log(copiedRow instanceof Row, "width" in copiedRow, Reflect.get(copiedRow, "owner"), Reflect.get(copiedRow, "cells") === row.cells, Object.getPrototypeOf(copiedRow) === Object.prototype)
console.log(Object.getOwnPropertySymbols(copy(grown)).length, (copy(grown) as any)[7], Reflect.ownKeys(copy(grown)).map(String).join())

// A store through the narrow type leaves the rest alone; one through the wide type is seen by the narrow one.
function bump(x: Narrow): void { x.id += 10 }
all.forEach(bump)
console.log(all.map(json).join(" ; "))
wide.id = 0.5
row.id = -0
console.log(idOnly(wide), Object.is(idOnly(row), -0), wide.label, row.width(), wideRow.more, wideRow.id)

// An optional field of the class that was never set is not there; set, it comes last.
console.log(keysOf(row), "hidden" in row, row.hidden)
row.hidden = "shown"
console.log(keysOf(row), rest(row), json(copy(row)))

// Narrow types of narrow types, down to the empty one.
interface Narrower { }
function count(x: Narrower): number { return Object.keys(x).length }
function spreadCount(x: Narrower): number { return Object.keys({ ...x }).length }
console.log(all.map(count).join(), all.map(spreadCount).join(), count("str"), spreadCount("str"), count(5), spreadCount([1, 2]))

// Sorting, finding and grouping by the narrow type move whole objects.
const sorted = [...all].sort((x, y) => y.id - x.id)
console.log(sorted.map(json).join(" ; "))
const found = all.find(x => x.id === 15)
console.log(found === foreign, found === undefined ? "none" : keysOf(found), all.indexOf(wideRow), all.includes(exact))
const byParity: Record<string, Narrow[]> = {}
for (const x of all) (byParity[String(Math.floor(x.id) % 2 === 0)] ??= []).push(x)
console.log(Object.keys(byParity).join(), JSON.stringify(byParity))

// The result of a function that promises the narrow type and returns a literal with more, through a variable.
function build(id: number): Narrow { const made = { id, secret: "s" + id, at: [id] }; return made }
const built = [build(1), build(2)]
console.log(built.map(json).join(), built.map(rest).join(), built.map(x => { const more = { ...x, id: 0 }; return keysOf(more) }).join(" ; "))

let total = 0
for (let i = 0; i < 3000; i++) { const x = all[i % all.length]; total += idOnly(x) + count(x) }
console.log(total)
