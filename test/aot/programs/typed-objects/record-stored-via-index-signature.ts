// A type literal has an implicit index signature: a record may be held as a dictionary whose values are of more kinds than its fields, and be stored to through that. The store is taken. A typed read of a field that then holds another kind throws a TypeError; null, a deleted field and a value of the field's own kind read as in plain Bun.
// IR+ ^layout L\d+ .*name="Lit" (?!.*isStable=true)
// IR+ ^layout L\d+ .*name="Loose" (?!.*isStable=true)
// IR+ ^layout L\d+ .*name="Kept" .*isStable=true
// IR+ ^layout L\d+ .*name="Copied" .*isStable=true
// IR+ ^layout L\d+ .*name="Even" .*isStable=true
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
type Lit = { v: number }
const lit: Lit = { v: 1 }
const dict: { [k: string]: number | string } = lit
attempt("a1", () => { dict["v"] = "d"; return lit.v })
attempt("a2", () => { dict["w"] = "extra"; dict["v"] = 2; return lit.v + Object.keys(lit).join() })
attempt("a3", () => JSON.stringify(lit))
type Named = { v: number; name: string }
const named: Named = { v: 1, name: "n" }
const record: Record<string, number | string> = named
attempt("b1", () => { record.v = "r"; return named.v })
attempt("b2", () => { record.name = 5; return named.name })
attempt("b3", () => { const key = ["v", "name"][Object.keys(named).length - 2]; record[key] = "k"; return named.v })
attempt("b4", () => { record.v = 3; record.name = "back"; return named.v + 1 + named.name })
type Flagged = { v: number; on: boolean }
function put(into: { [k: string]: number | boolean | null }, key: string, value: number | boolean | null) { into[key] = value }
const flagged: Flagged = { v: 1, on: true }
attempt("c1", () => { put(flagged, "v", false); return flagged.v })
attempt("c2", () => { put(flagged, "on", null); return flagged.on })
attempt("c3", () => { put(flagged, "v", 7); put(flagged, "on", true); return flagged.v + 1 + String(flagged.on) })
type Kept = { kept: number }
const kept: Kept = { kept: 1 }
const seen: { readonly [k: string]: number | string } = kept
attempt("d1", () => [seen.kept, seen["kept"], Object.keys(seen).join(), kept.kept + 1].join())
type Copied = { copied: number }
const copied: Copied = { copied: 1 }
const copy: { [k: string]: number | string } = { ...copied }
attempt("e1", () => { copy.copied = "c"; return [copy.copied, copied.copied + 1].join() })
type Item = { v: number }
const items: Item[] = [{ v: 1 }, { v: 2 }]
const dicts: { [k: string]: number | string }[] = items
attempt("f1", () => { dicts[0].v = "n"; return items[0].v })
attempt("f2", () => items[1].v + 1)
type Loose = { v: number; inner: { w: number } }
const loose: Loose = { v: 1, inner: { w: 2 } }
const anything: Record<string, unknown> = loose
attempt("g1", () => { anything.v = [1, 2]; return loose.v })
attempt("g2", () => { anything.inner = "gone"; return loose.inner })
type Even = { even: number; odd: number }
const even: Even = { even: 2, odd: 1 }
const numbers: { [k: string]: number } = even
attempt("h1", () => { numbers.even = 4; numbers["odd"] = 3; numbers.more = 5; return even.even + even.odd + Object.keys(even).join() })
type Gone = { v: number; rest: number }
const gone: Gone = { v: 1, rest: 2 }
const emptied: { [k: string]: number | string } = gone
attempt("i1", () => { delete emptied.v; return [String(gone.v), "v" in gone, Object.keys(gone).join()].join() })
type Free = { v: number }
const free: Free = { v: 1 }
const whatever: { [k: string]: any } = free
attempt("k1", () => { whatever.v = "any"; return free.v })
