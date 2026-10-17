// Lookup keys built with `+` (`a + "," + b`) and used at once in a Map, a Set or an object.
declare const console: { log(...args: unknown[]): void }
interface Item { name: string; other: string; n: number }
const seen: string[] = []
function note<T>(tag: string, v: T): T { seen.push(tag); return v }
const long = "L".repeat(70), rope = "ro" + "pe".slice(0) + String(1), part = "a part of this".slice(2, 6), wide = "Ж日"
const texts: unknown[] = ["a", "", "bc", long, rope, part, wide, "é", "undefined", "null", undefined, null, "0", "-1"]
const numbers: number[] = [0, -0, 1, -1, 10, 2147483647, -2147483648, 4294967296, 0.5, -0.25, 1e21, 1e-7, NaN, Infinity]
const map = new Map<string, string>(), set = new Set<string>(), record: Record<string, string> = {}
for (const a of texts) for (const b of texts) { const k = String(a) + "," + String(b); map.set(k, "m:" + k); set.add(k); record[k] = "r:" + k }
for (const a of texts) for (const n of numbers) { const k = String(a) + "#" + String(n); map.set(k, "m:" + k); set.add(k); record[k] = "r:" + k }
for (const a of texts) for (const b of texts) { const k = String(a) + "/" + String(b) + "/" + String(a); map.set(k, "m3:" + k) }
let rows = 0, lines = 0
function say(name: string, v: unknown): void { rows++; const text = typeof v === "string" && v.length > 60 ? v.length + ":" + v.slice(0, 12) : String(v); console.log(name + " -> " + text + (seen.length ? " after " + seen.join() : "")); seen.length = 0; lines++ }
for (let turn = 0; turn < 2; turn++) {
  for (let i = 0; i < texts.length; i++) for (let j = 0; j < texts.length; j++) {
    const it: Item = { name: texts[i] as string, other: texts[j] as string, n: numbers[j] }
    const at = i + "," + j
    say("get " + at, map.get(it.name + "," + it.other))
    say("has " + at, set.has(it.name + "," + it.other))
    say("record " + at, record[it.name + "," + it.other])
    say("get three " + at, map.get(it.name + "/" + it.other + "/" + it.name))
    say("get # " + at, map.get(it.name + "#" + it.n))
    say("has # " + at, set.has(it.name + "#" + it.n))
    say("record # " + at, record[it.name + "#" + it.n])
    say("a template " + at, map.get(`${it.name},${it.other}`))
    say("with effects " + at, map.get(note("first", it.name) + "," + note("second", it.other)))
    say("a miss " + at, map.get(it.name + ";" + it.other))
    say("number first " + at, map.get(it.n + "," + it.other))
    say("kept too " + at, (() => { const k = it.name + "," + it.other; return map.get(k) + "|" + k.length })())
  }
}
function thing(tag: string, v: unknown): unknown { return { valueOf() { seen.push(tag + ".valueOf"); return v }, toString() { seen.push(tag + ".toString"); return "T" + tag } } }
function onlyText(tag: string, v: string): unknown { return { toString() { seen.push(tag + ".toString"); return v } } }
class Holder { constructor(private tag: string, private v: unknown) {} get part(): any { seen.push(this.tag + ".part"); return this.v } }
function attempt(name: string, f: () => unknown): void { let r: unknown; try { r = f() } catch (e) { r = "throws " + (e as Error).name } say(name, r) }
const kinds: [string, (tag: string) => unknown][] = [["a text", () => "a"], ["a number", () => 1], ["valueOf a text", t => thing(t, "a")], ["valueOf a number", t => thing(t, 1)], ["valueOf an object", t => thing(t, {})], ["toString alone", t => onlyText(t, "bc")], ["undefined", () => undefined], ["null", () => null], ["a bigint", () => 10n], ["true", () => true]]
for (let turn = 0; turn < 2; turn++) for (const [x, makeX] of kinds) for (const [y, makeY] of kinds) {
  const a: any = makeX("a"), b: any = makeY("b"), ha = new Holder("ha", a), hb = new Holder("hb", b)
  attempt("any: " + x + " , " + y, () => map.get(a + "," + b))
  attempt("any, three: " + x + " / " + y, () => map.get(a + "/" + b + "/" + a))
  attempt("getters: " + x + " , " + y, () => map.get(ha.part + "," + hb.part))
  attempt("a template: " + x + " , " + y, () => map.get(`${a},${b}`))
  attempt("a record: " + x + " , " + y, () => record[a + "," + b])
  attempt("a text first: " + x + " , " + y, () => set.has("a" + "," + a + b))
}
const nothing: Item[] = []
function beyond(a: Item, i: number): string { try { return String(map.get(a.name + "," + nothing[i].name)) } catch (e) { return "throws " + (e as Error).name } }
say("the second holder is not there", beyond({ name: "a", other: "", n: 0 }, 3))
console.log(rows + " rows")
