// One access site sees many kinds of object through one interface: typed objects of several types, parsed JSON, frozen and sealed objects, a function.
interface Reading { at: number; value: number; unit: string; ok?: boolean }
class Sample implements Reading {
  ok?: boolean
  constructor(public at: number, public value: number, public unit = "s") {}
  scaled(): number { return this.value * 2 }
}
class Checked extends Sample { override ok?: boolean = true; extra = "x" }
const wide = (i: number) => ({ unit: "w", value: i, note: "wide", at: i, more: [i] })
const makers: ((i: number) => Reading)[] = [
  i => ({ at: i, value: i + 0.5, unit: "a" }),
  i => ({ unit: "b", ok: i % 2 === 0, value: i, at: i }),
  wide,
  i => new Sample(i, i * 2),
  i => new Checked(i, i * 3, "c"),
  i => JSON.parse('{"value":' + i + ',"at":' + i + ',"unit":"j"}'),
  i => Object.freeze<Reading>({ at: i, value: 3, unit: "f" }),
  i => { const r: Reading = { at: i, value: 5, unit: "d", ok: true }; delete r.ok; r.at = i + 1; return r },
  i => Object.assign(Object.create(null), { at: i, value: 7, unit: "n" }),
  i => Object.assign(() => i, { at: i, value: 8, unit: "fn" }),
  i => Object.seal<Reading>({ at: i, value: 9, unit: "z" }),
  i => Object.preventExtensions<Reading>({ at: i, value: 10, unit: "e", ok: false }),
]
function readAll(list: Reading[]): string {
  let at = 0, value = 0, units = "", oks = 0, has = 0
  for (const r of list) { at += r.at; value += r.value; units += r.unit; if (r.ok) oks++; if ("ok" in r) has++ }
  return [at, value, units, oks, has].join("/")
}
function bump(r: Reading, by: number): string {
  let done = ""
  try { r.value += by; done += "v" } catch (e) { done += "!" }
  try { r.at++; done += "a" } catch (e) { done += "!" }
  try { r.ok = !r.ok; done += "o" } catch (e) { done += "!" }
  try { r.unit = r.unit + by; done += "u" } catch (e) { done += "!" }
  return done
}
const first = makers.map(make => make(1))
console.log(readAll(first))
console.log(first.map(r => bump(r, 2)).join())
console.log(readAll(first))
console.log(first.map(r => Object.keys(r).join("")).join())
console.log(first.map(r => String(JSON.stringify(r))).join(""))
console.log(first.map(r => r instanceof Sample ? r.scaled() : -1).join())
// The same sites, hot, with the kinds arriving in a different order each round.
let digest = 0
for (let round = 0; round < 40; round++) {
  const list: Reading[] = []
  for (let k = 0; k < makers.length; k++) list.push(makers[(k * 7 + round) % makers.length](round))
  const before = readAll(list)
  let moved = 0
  for (const r of list) moved += bump(r, round % 3).length
  const after = readAll(list)
  digest = (digest * 31 + before.length * 7 + after.length + moved) % 1000003
  for (const r of list) digest = (digest + r.at * 3 + Math.floor(r.value) + r.unit.length + (r.ok === undefined ? 5 : r.ok ? 1 : 0)) % 1000003
}
console.log(digest)
// One function per operation, each first trained on compiled objects alone and then given the rest.
function valueOf1(r: Reading): number { return r.value }
function setValue(r: Reading, x: number): void { r.value = x }
function clearOk(r: Reading): boolean { return delete r.ok }
let trained = 0
for (let i = 0; i < 200; i++) { const r = makers[i % 5](i); setValue(r, i); trained += valueOf1(r); clearOk(r) }
console.log(trained)
const rest = makers.map(make => make(3))
console.log(rest.map(r => { try { setValue(r, 1.25); return valueOf1(r) } catch (e) { return (e as Error).constructor.name + valueOf1(r) } }).join())
console.log(rest.map(r => { try { return clearOk(r) } catch (e) { return (e as Error).constructor.name } }).join(), rest.map(r => String(r.ok)).join())
