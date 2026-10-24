// A field declared `number` or `boolean` is read before anything was assigned to it: it reads undefined, which passes every written type and stays undefined.
function kind(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : typeof v }
function plusOne(n: number): number { return n + 1 }
function withDefault(n: number = 42): number { return n }
class Promised {
  count!: number; label!: string; flag!: boolean; next!: Promised
  init() { this.count = 5; this.label = "l"; this.flag = false; this.next = this; return this }
  total() { return this.count * 2 }
}
const bare = new Promised()
try { console.log(bare.count); console.log("number, printed: no error") } catch (e) { console.log("number, printed:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.flag); console.log("boolean, printed: no error") } catch (e) { console.log("boolean, printed:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { kind(bare.count); console.log("number, to unknown: no error") } catch (e) { console.log("number, to unknown:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { bare.total(); console.log("number, in a method: no error") } catch (e) { console.log("number, in a method:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.count + 1); console.log("number, added to: no error") } catch (e) { console.log("number, added to:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.count > 0); console.log("number, compared: no error") } catch (e) { console.log("number, compared:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.count == null); console.log("number == null: no error") } catch (e) { console.log("number == null:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.count === undefined); console.log("number === undefined: no error") } catch (e) { console.log("number === undefined:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(typeof bare.count); console.log("typeof number: no error") } catch (e) { console.log("typeof number:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.count ?? "none"); console.log("number ?? x: no error") } catch (e) { console.log("number ?? x:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.count || 7); console.log("number || x: no error") } catch (e) { console.log("number || x:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.flag === false); console.log("boolean === false: no error") } catch (e) { console.log("boolean === false:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.flag ? "yes" : "no"); console.log("boolean, tested: no error") } catch (e) { console.log("boolean, tested:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(bare.flag ?? "none"); console.log("boolean ?? x: no error") } catch (e) { console.log("boolean ?? x:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { plusOne(bare.count); console.log("number, as an argument: no error") } catch (e) { console.log("number, as an argument:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { withDefault(bare.count); console.log("number, as an argument with a default: no error") } catch (e) { console.log("number, as an argument with a default:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { const c: number | undefined = bare.count; console.log(c); console.log("number, to number | undefined: no error") } catch (e) { console.log("number, to number | undefined:", e instanceof TypeError ? "TypeError" : "other " + e) }
// Untyped code and reflection see what ECMAScript sees.
console.log((bare as any).count, (bare as any).flag, JSON.stringify(bare), Object.keys(bare).join(), "count" in bare)

// The constructor reads its own fields before it stores them.
class Early {
  n: number; b: boolean; seen = ""
  constructor(which: number) {
    const me: Early = this
    if (which === 0) this.seen = kind(me.n)
    if (which === 1) this.seen = me.b ? "yes" : "no"
    this.n = 1; this.b = true
  }
}
try { new Early(0); console.log("own number in the constructor: no error") } catch (e) { console.log("own number in the constructor:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { new Early(1); console.log("own boolean in the constructor: no error") } catch (e) { console.log("own boolean in the constructor:", e instanceof TypeError ? "TypeError" : "other " + e) }
try { console.log(new Early(2).n); console.log("neither: no error") } catch (e) { console.log("neither:", e instanceof TypeError ? "TypeError" : "other " + e) }

// The base constructor calls a method of the derived class, whose initializers have not run. ECMAScript: NaN.
class Shape0 { area: number; constructor() { this.area = this.compute() } compute(): number { return 0 } }
class Square0 extends Shape0 { side = 3; unit = "cm"; compute() { return this.side * this.side } text() { return this.area + this.unit } }
try { new Square0(); console.log("initializer that has not run: no error") } catch (e) { console.log("initializer that has not run:", e instanceof TypeError ? "TypeError" : "other " + e) }

// What was read too early is stored in typed fields and arrays: undefined passes there too.
interface Sink { n: number; b: boolean }
class Leaky {
  value: number; on: boolean
  constructor(out: Sink, list: number[], which: number) {
    const me: Leaky = this
    if (which === 0) out.n = me.value
    if (which === 1) out.b = me.on
    if (which === 2) list.push(me.value)
    if (which === 3) list[3] = me.value
    this.value = 7; this.on = true
  }
}
const sink: Sink = { n: 0, b: false }
const numbers: number[] = [1.5]
for (let which = 0; which < 4; which++) try { new Leaky(sink, numbers, which); console.log("stored on " + which + ": no error") } catch (e) { console.log("stored on " + which + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
console.log(JSON.stringify(sink), JSON.stringify(numbers))

// Some paths assign, some do not. `this.x = this.x ?? -5` is how a field is given its default late.
class Sometimes {
  x!: number; y!: number
  constructor(mode: number) { if (mode > 0) this.x = mode; if (mode > 1) this.y = mode * 2; if (mode < 0) { this.y = -1; return } this.x = this.x ?? -5 }
  sum() { return this.x + this.y }
}
for (const mode of [-1, 0, 1, 2]) try { console.log(JSON.stringify(new Sometimes(mode))); console.log("made with " + mode + ": no error") } catch (e) { console.log("made with " + mode + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
for (const mode of [-1, 1, 2]) try { console.log(new Sometimes(mode).sum()); console.log("summed with " + mode + ": no error") } catch (e) { console.log("summed with " + mode + ":", e instanceof TypeError ? "TypeError" : "other " + e) }

// Many objects, half of them initialized, one site.
const half: Promised[] = []
for (let i = 0; i < 10; i++) half.push(i % 2 ? new Promised().init() : new Promised())
let known = 0, missing = 0, refused = 0
for (const p of half) try { if (p.count === undefined) missing++; else known += p.count } catch (e) { if (e instanceof TypeError) refused++ }
console.log(known, missing, refused)
