// Class fields that are read before they are assigned.
function kind(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : typeof v }
function plusOne(n: number): number { return n + 1 }
function shout(s: string): string { return s + "!" }
function withDefault(n: number = 42): number { return n }

// The constructor reads its own fields before it stores them.
class Early {
  n: number; s: string; b: boolean; o: Early | null; list: number[]
  seen: string
  constructor() {
    const me: Early = this
    this.seen = [kind(me.s), kind(me.o), kind(me.list)].join()
    this.seen += " " + shout(me.s) + " " + (me.s === undefined) + " " + (me.list ?? [0]).length + " " + (me.o ? "yes" : "no")
    this.n = 1; this.s = "s"; this.b = true; this.o = null; this.list = []
    this.seen += " " + plusOne(me.n) + " " + (me.b ? "yes" : "no") + " " + withDefault(me.n) + " " + (me.n === undefined) + " " + Number.isNaN(me.n)
  }
}
const early = new Early()
console.log(early.seen, early.n, early.s, early.b, early.o, early.list.length)

// `!:` promises an assignment that comes later, or never.
class Promised {
  count!: number; label!: string; flag!: boolean; next!: Promised
  init() { this.count = 5; this.label = "l"; this.flag = false; this.next = this; return this }
  total() { return this.count * 2 }
}
const bare = new Promised()
console.log(bare.label, kind(bare.next), bare.label + "x", bare.label == null, typeof bare.label, bare.next === undefined)
console.log(JSON.stringify(bare), Object.keys(bare).length <= 4, bare.label ?? "none", (bare.next ?? bare) === bare)
bare.init()
console.log(bare.count, bare.label, bare.flag, bare.next === bare, bare.total(), JSON.stringify(Object.keys(bare).sort()))
console.log(bare.count + 1, bare.count > 0, bare.count < 0, bare.count == null, typeof bare.count, bare.flag === false, bare.count ?? "none", bare.flag ?? "none")

// The base constructor calls a method of the derived class, whose initializers have not run.
class Shape0 { text: string; constructor() { this.text = this.compute() } compute(): string { return "" } }
class Square0 extends Shape0 { unit = "cm"; sides = [3, 3]; compute() { return this.unit + "/" + kind(this.sides) } all() { return this.text + " " + this.compute() } }
const sq = new Square0()
console.log(sq.text, sq.unit, sq.compute(), sq.all())

// What was read too early is stored in typed fields, arrays and variables, and comes out unchanged.
interface Sink { n: number; s: string; b: boolean }
class Leaky {
  value: number; word: string; on: boolean
  constructor(out: Sink, words: string[]) {
    const me: Leaky = this
    out.s = me.word
    words.push(me.word); words[3] = me.word
    this.value = 7; this.word = "w"; this.on = true
  }
}
const sink: Sink = { n: 0, s: "", b: false }
const words: string[] = ["a"]
const leaky = new Leaky(sink, words)
console.log(sink.n, sink.s, sink.b, JSON.stringify(sink), Object.keys(sink).join(), JSON.stringify(words), words.length, 2 in words, 3 in words, leaky.value)
console.log(sink.s + "", words[1] === undefined, (words as (string | undefined)[]).indexOf(undefined), (words as (string | undefined)[]).includes(undefined))
sink.n = 2; sink.s = "t"; sink.b = true
console.log(sink.n + 1, sink.s.length, sink.b)

// Some paths assign, some do not: the read sees what was stored.
class Sometimes {
  x!: number; y!: number
  constructor(mode: number) { if (mode > 0) this.x = mode; if (mode > 1) this.y = mode * 2; if (mode < 0) { this.y = -1; return } }
  sum() { return this.x + this.y }
}
console.log([-1, 0, 1, 2].map(m => JSON.stringify(new Sometimes(m))).join(" "), new Sometimes(2).sum(), new Sometimes(-1).y, new Sometimes(1).x)

// A real NaN beside a missing number.
class Two { missing!: number; nan = NaN }
const two = new Two()
console.log(two.nan, (two.nan as unknown) === undefined, Number.isNaN(two.nan), String(two.nan), two.nan ?? "d", JSON.stringify(two), Object.keys(two).join())

// Many objects, half of them initialized, one site.
const half: Promised[] = []
for (let i = 0; i < 10; i++) half.push(i % 2 ? new Promised().init() : new Promised())
let known = 0, unknown = 0
for (const p of half) { if (p.label === undefined) unknown++; else known += p.count }
console.log(known, unknown, half.map(p => p.next ? p.total() : "-").join())
