// `value === "literal"` outside loops, for values of every kind and strings of every internal representation.
declare const console: { log(...args: unknown[]): void }
interface R { kind: string; maybe?: string; any: unknown }
function made(text: string): string[] {
  const rope = text.slice(0, 1) + text.slice(1), flat = text.slice(0, 1) + text.slice(1); flat.charCodeAt(0)
  const padded = "<" + text + ">", part = padded.slice(1, 1 + text.length)
  const parsed = JSON.parse(JSON.stringify({ v: text, ["k" + text]: 1 })) as Record<string, unknown>
  const key = Object.keys(parsed)[1].slice(1), wide = ("Ж" + text).slice(1), joined = [text.slice(0, 1), text.slice(1)].join("")
  return [text, rope, flat, part, parsed.v as string, key, wide, joined, String(text), text + "", `${text}`, Symbol.for(text).description as string]
}
const names = ["written", "a rope", "a concatenation read once", "a slice", "out of JSON.parse", "a slice of a key", "a slice of 16 bits", "joined", "String()", "+ nothing", "a template", "a symbol's description"]
const texts = ["b", "text", "a longer one!", "c", "texu", "a longer one?", "", "bb", "B", "tex", "texts", "Ж", "teЖt"]
const asValue = (s: string): boolean => s === "text"
const onTheLeft = (s: string): boolean => "text" === s
const isNot = (s: string): boolean => s !== "text"
const branched = (s: string): number => { if (s === "text") return 1; return 2 }
const one = (s: string): number => { if (s === "b") return 1; return 2 }
const long = (s: string): number => { if (s === "a longer one!") return 1; return 2 }
const chain = (s: string): number => { if (s === "b") return 1; else if (s === "text") return 2; else if (s === "texu") return 3; return 4 }
const chosen = (s: string): number => { switch (s) { case "text": return 1; case "bb": return 2; case "a longer one!": return 3; case "": return 4; default: return 5 } }
const starts = (s: string): string => (s.startsWith("te") ? "s" : "-") + (s.endsWith("xt") ? "e" : "-") + s.slice(1, 3) + "|" + s.substring(2) + "|" + s.slice(-2)
const truth = (s: string): number => s ? 1 : 0
const ofString: ((s: string) => unknown)[] = [asValue, onTheLeft, isNot, branched, one, long, chain, chosen, starts, truth]
const maybeValue = (r: R): boolean => r.maybe === "text"
const maybeBranched = (r: R): number => { if (r.maybe === "text") return 1; return 2 }
const field = (r: R): number => { if (r.kind === "text") return 1; return 2 }
const anyValue = (r: R): boolean => r.any === "text"
const anyBranched = (r: R): number => { if (r.any === "text") return 1; else if (r.any === "b") return 2; return 3 }
const anyNot = (r: R): boolean => "text" !== r.any
const anyTruth = (r: R): number => r.any ? 1 : 0
const notTruth = (r: R): boolean => !r.any
const ofRecord: ((r: R) => unknown)[] = [maybeValue, maybeBranched, field, anyValue, anyBranched, anyNot, anyTruth, notTruth]
let rows = 0
for (let turn = 0; turn < 2; turn++) {
  for (let t = 0; t < texts.length; t++) {
    const list = made(texts[t])
    for (let k = 0; k < names.length; k++) {
      let line = ""
      for (let f = 0; f < ofString.length; f++) line += " " + ofString[f](list[k])
      const r: R = { kind: list[k], maybe: list[k], any: list[k] }
      for (let f = 0; f < ofRecord.length; f++) line += " " + ofRecord[f](r)
      line += " " + asValue(list[k]) + branched(list[k]) + chain(list[k]) + anyValue(r) + anyBranched(r)
      rows++
      console.log(JSON.stringify(texts[t]) + " " + names[k] + " ->" + line)
    }
  }
  const others: unknown[] = [0, 1, -0, NaN, 1.5, null, undefined, true, false, {}, [], ["text"], Symbol("text"), 10n, 0n, new String("text"), () => "text", /text/, new Date(0), { toString() { return "text" } }]
  for (let k = 0; k < others.length; k++) {
    const r: R = { kind: "text", maybe: k & 1 ? undefined : (null as unknown as string), any: others[k] }
    let line = ""
    for (let f = 0; f < ofRecord.length; f++) line += " " + ofRecord[f](r)
    rows++
    console.log("other " + k + " ->" + line)
  }
  const nils: string[] = [undefined as unknown as string, null as unknown as string]
  for (const nil of nils) { rows++; console.log("nil ->" + " " + asValue(nil) + " " + onTheLeft(nil) + " " + isNot(nil) + " " + branched(nil) + " " + chain(nil) + " " + chosen(nil) + " " + truth(nil)) }
}
console.log(rows + " rows")
