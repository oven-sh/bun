// `v === "literal"` in a loop gives the same answer however the string was created: literals, property keys, JSON.parse results, slices, ropes, 16-bit strings.
declare const console: { log(...args: unknown[]): void }
interface R { kind: string }
const base = "xx-b-text-a longer one!-Жb"
function made(text: string): string[] {
  const rope = text.slice(0, 1) + text.slice(1), flat = text.slice(0, 1) + text.slice(1); flat.charCodeAt(0)
  const padded = "<" + text + ">", part = padded.slice(1, 1 + text.length)
  const parsed = JSON.parse(JSON.stringify({ v: text, [text]: 1 })) as Record<string, unknown>
  const key = Object.keys(parsed)[1], wide = ("Ж" + text).slice(1), joined = [text.slice(0, 1), text.slice(1)].join("")
  return [text, rope, flat, part, parsed.v as string, key, wide, joined, String(text), text.toLowerCase(), text + "", `${text}`, Symbol.for(text).description as string]
}
const names = ["written", "a rope", "a concatenation read once", "a slice", "out of JSON.parse", "a key of an object", "a slice of 16 bits", "joined", "String()", "toLowerCase()", "+ nothing", "a template", "a symbol's description"]
const texts = ["b", "text", "a longer one!", "c", "texu", "a longer one?", "", "bb", "B"]
const lists: string[][] = texts.map(made)
let rows = 0
function countB(rs: R[]): number { let n = 0; for (let j = 0; j < rs.length; j++) if (rs[j].kind === "b") n++; return n }
function countText(rs: R[]): number { let n = 0; for (let j = 0; j < rs.length; j++) if (rs[j].kind === "text") n++; return n }
function countLong(rs: R[]): number { let n = 0; for (let j = 0; j < rs.length; j++) if (rs[j].kind === "a longer one!") n++; return n }
function valuesB(rs: R[]): string { let s = ""; for (let j = 0; j < rs.length; j++) { const is = rs[j].kind === "b"; s += is ? "1" : "0" } return s }
function valuesText(rs: R[]): string { let s = ""; for (let j = 0; j < rs.length; j++) { const is = rs[j].kind === "text"; s += is ? "1" : "0" } return s }
function valuesLong(rs: R[]): string { let s = ""; for (let j = 0; j < rs.length; j++) { const is = "a longer one!" === rs[j].kind; s += is ? "1" : "0" } return s }
function notText(rs: R[]): number { let n = 0; for (let j = 0; j < rs.length; j++) if (rs[j].kind !== "text") n++; return n }
function anything(vs: unknown[]): string { let s = ""; for (let j = 0; j < vs.length; j++) s += vs[j] === "text" ? "1" : vs[j] === "b" ? "2" : "0"; return s }
function elements(vs: string[]): number { let n = 0; for (let j = 0; j < vs.length; j++) if (vs[j] === "text") n++; return n }
for (let turn = 0; turn < 3; turn++) {
  for (let t = 0; t < texts.length; t++) for (let k = 0; k < names.length; k++) {
    const rs: R[] = [{ kind: lists[t][k] }, { kind: "b" }, { kind: lists[t][k] }, { kind: "text" }, { kind: lists[(t + 1) % texts.length][k] }, { kind: "a longer one!" }]
    rows++
    console.log(JSON.stringify(texts[t]) + " " + names[k] + " -> " + countB(rs) + " " + countText(rs) + " " + countLong(rs) + " " + valuesB(rs) + " " + valuesText(rs) + " " + valuesLong(rs) + " " + notText(rs) + " " + elements(rs.map(r => r.kind)))
  }
  const mixed: unknown[] = ["text", "b", 1, null, undefined, {}, [], true, Symbol("text"), 10n, lists[1][1], lists[1][3], lists[0][4], new String("text"), () => "text", lists[1][6]]
  rows++
  console.log("anything -> " + anything(mixed))
  const holes: R[] = [{ kind: "text" }, { kind: undefined as unknown as string }, { kind: null as unknown as string }, { kind: lists[1][1] }]
  rows++
  console.log("nil -> " + countText(holes) + " " + valuesText(holes) + " " + notText(holes))
}
console.log(rows + " rows " + base.length)
