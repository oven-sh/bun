// Unions discriminated by numbers, enum members, booleans, null and undefined, and bit flags that say which fields an object has.
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
enum Tag { Leaf, Pair, Triple = 5, Neg = -1 }
type Leaf = { tag: Tag.Leaf; v: number }
type Pair = { tag: Tag.Pair; l: Term; r: Term }
type Triple = { tag: Tag.Triple; a: Term; b: Term; c: Term }
type Neg = { tag: Tag.Neg; of: Term }
type Term = Leaf | Pair | Triple | Neg
function evaluate(t: Term): number {
  switch (t.tag) {
    case Tag.Leaf: return t.v
    case Tag.Pair: return evaluate(t.l) + evaluate(t.r)
    case Tag.Triple: return evaluate(t.a) * evaluate(t.b) - evaluate(t.c)
    case Tag.Neg: return -evaluate(t.of)
  }
}
const leaf = (v: number): Leaf => ({ tag: Tag.Leaf, v })
const term: Term = { tag: Tag.Triple, a: { l: leaf(1), r: leaf(2.5), tag: Tag.Pair }, b: { of: leaf(2), tag: Tag.Neg }, c: leaf(0) }
console.log(evaluate(term), Object.is(evaluate({ tag: Tag.Neg, of: leaf(0) }), -0), show(term), Tag[term.tag], Tag[-1], Tag.Neg, typeof term.tag)
const parsedTerm: Term = JSON.parse('{"tag":1,"l":{"tag":0,"v":4},"r":{"tag":-1,"of":{"v":1,"tag":0}}}')
console.log(evaluate(parsedTerm), evaluate({ tag: Tag.Pair, l: parsedTerm, r: term }))

// Number literals, among them a fraction, a negative and zero.
type Versioned = { version: 0; raw: string } | { version: 1; label: string } | { version: 2; label: string; extra: number } | { version: 2.5; label: string; extras: number[] } | { version: -1; broken: true }
function upgrade(v: Versioned): string {
  switch (v.version) {
    case 0: return "raw " + v.raw
    case 1: return "one " + v.label
    case 2: return "two " + v.label + v.extra
    case 2.5: return "two and a half " + v.label + v.extras.length
    case -1: return "broken " + v.broken
  }
}
const versions: Versioned[] = [{ version: 0, raw: "r" }, { label: "a", version: 1 }, { version: 2, extra: 9, label: "b" }, { extras: [1, 2], version: 2.5, label: "c" }, { version: -1, broken: true }, JSON.parse('{"version":2.5,"label":"j","extras":[]}')]
console.log(versions.map(upgrade).join(" ; "), versions.map(v => v.version).join())

// true and false.
type Outcome<T> = { ok: true; value: T } | { ok: false; error: string }
function divide(x: number, y: number): Outcome<number> { return y === 0 ? { ok: false, error: "by zero" } : { value: x / y, ok: true } }
function unwrap<T>(o: Outcome<T>, otherwise: T): T { return o.ok ? o.value : otherwise }
function explain(o: Outcome<unknown>): string { return o.ok === true ? "ok " + typeof o.value : !o.ok ? "error " + o.error.length : "never" }
const outcomes = [divide(1, 2), divide(1, 0), divide(-1, Infinity), divide(0, 5)]
console.log(outcomes.map(o => unwrap(o, -1)).map(n => Object.is(n, -0) ? "-0" : String(n)).join(), outcomes.map(explain).join(), outcomes.map(show).join(" ; "))
const words: Outcome<string>[] = [{ ok: true, value: "" }, { ok: false, error: "" }, { value: "w", ok: true }]
console.log(words.map(o => unwrap(o, "otherwise")).join("|"), words.map(explain).join())

// null and undefined, and a field that is there in one branch only.
type Loaded = { error: null; data: number[] } | { error: string; data?: undefined }
type Perhaps = { present: undefined; fallback: string } | { present: { n: number } }
function dataOf(l: Loaded): string { return l.error === null ? l.data.join("+") : l.error + String(l.data) + ("data" in l) }
function nOf(p: Perhaps): string { return p.present === undefined ? p.fallback : String(p.present.n) }
console.log(([{ error: null, data: [1, 2] }, { error: "bad" }, { error: "", data: undefined }] as Loaded[]).map(dataOf).join(),([{ present: undefined, fallback: "f" }, { present: { n: 3 } }] as Perhaps[]).map(nOf).join())

// Bit flags: the value of a flags field is often not a member of the enum, and larger than all of them. (Casts to the interface that the flags imply, and a value beyond 32 bits: type-rules/numeric-discriminant-unions.)
const enum Has { None = 0, Label = 1, Count = 2, Child = 4, Deep = 1 << 20, Top = 1 << 30 }
interface Flagged { flags: Has }
interface WithLabel extends Flagged { label: string }
interface WithCount extends Flagged { count: number }
interface WithChild extends Flagged { child: Flagged }
type Whatever = Flagged & Partial<WithLabel & WithCount> & { child?: Whatever }
function make(flags: Has): Whatever {
  const made: Whatever = { flags }
  if (flags & Has.Label) made.label = "l" + flags
  if (flags & Has.Count) made.count = flags * 0.5
  if (flags & Has.Child) made.child = make(flags & ~Has.Child)
  return made
}
function inspect(f: Whatever): string {
  let out = String(f.flags)
  if (f.flags & Has.Label) out += " " + f.label
  if (f.flags & Has.Count) out += " " + f.count
  if (f.flags & Has.Child) out += " <" + inspect(f.child!) + ">"
  if (f.flags & (Has.Deep | Has.Top)) out += " high"
  return out
}
const flagged = [Has.None, Has.Label, Has.Label | Has.Count, Has.Label | Has.Count | Has.Child, Has.Child | Has.Deep, Has.Top | Has.Count, Has.Top | Has.Deep | 7].map(make)
console.log(flagged.map(inspect).join(" ; "))
console.log(flagged.map(show).join(" ; "))
for (const f of flagged) { f.flags |= Has.Deep; f.flags &= ~Has.Label }
console.log(flagged.map(inspect).join(" ; "), flagged.map(f => f.flags).join())
flagged[0].flags = ~0
flagged[1].flags = (Has.Top << 1) | Has.Count
flagged[2].flags = flagged[2].flags * 1024
console.log(flagged[0].flags, flagged[1].flags, flagged[2].flags, flagged[0].flags >>> 0, flagged[2].flags & Has.Count)

let total = 0
for (let i = 0; i < 4000; i++) total += evaluate(i & 1 ? term : parsedTerm) + upgrade(versions[i % 6]).length + unwrap(outcomes[i & 3], 1) + (flagged[3 + (i & 3)].flags & 7)
console.log(total)
