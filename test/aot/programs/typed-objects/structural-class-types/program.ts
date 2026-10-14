class Vec {
  x: number; y: number
  constructor(x: number, y: number) { this.x = x; this.y = y }
  len2(): number { return this.x * this.x + this.y * this.y }
  plus(o: Vec): Vec { return new Vec(this.x + o.x, this.y + o.y) }
  get sum(): number { return this.x + this.y }
}
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function norm(v: Vec): string { return [v.x, v.y, v.len2(), v.sum, v instanceof Vec, Object.keys(v).join("")].join() }
const real = new Vec(1, 2)
const plain: Vec = { x: 3, y: 4, len2() { return -1 }, plus(o) { return o }, sum: 100 }
const respread: Vec = { ...real, len2: real.len2, plus: real.plus, sum: 0 }
console.log(norm(real), norm(plain), norm(respread))
real.y = 7
console.log(norm(real.plus(plain)), norm(plain.plus(real)), norm(real.plus(respread)))
// Methods and getters of the class with a `this` that the class did not make.
console.log(norm(real.plus.call(plain, respread)), Reflect.apply(Vec.prototype.len2, plain, []), Vec.prototype.len2.call(respread))
const getSum = Object.getOwnPropertyDescriptor(Vec.prototype, "sum")!.get!
console.log(getSum.call(plain), getSum.call(real), getSum.call(respread))
console.log(attempt(() => (0, real.len2)()), attempt(() => Vec.prototype.len2.call(null as unknown as Vec)))
// Two classes of one structure, and a literal of it.
class Celsius { degrees = 1; unit() { return "C" } }
class Kelvin { degrees = 274; unit() { return "K" } }
function reading(c: Celsius): string { return c.degrees + c.unit() + (c instanceof Celsius ? "+" : "-") }
const temps: Celsius[] = [new Celsius(), new Kelvin(), { degrees: 0, unit: () => "?" }]
console.log(temps.map(t => reading(t)).join())
for (const t of temps) t.degrees += 0.5
console.log(temps.map(t => reading(t)).join(), JSON.stringify(temps))
// A class with an optional field, as a class and as a literal.
class Opts { verbose?: boolean; depth = 1; describe() { return String(this.verbose) + this.depth } }
const given: Opts = { depth: 2, describe: Opts.prototype.describe }
const loud: Opts = { verbose: true, depth: 3, describe() { return "mine" } }
console.log(given.describe(), loud.describe(), new Opts().describe(), Opts.prototype.describe.call(loud), "verbose" in given)
given.verbose = false
const fresh = new Opts()
fresh.verbose = true
console.log(given.describe(), Object.keys(given).join(), fresh.describe(), Object.keys(fresh).join())
const vecs: Vec[] = [real, plain, respread]
let acc = 0
for (let i = 0; i < 120; i++) { const v = vecs[i % vecs.length]; acc += v.len2() + v.sum + v.x; v.x += 1 }
console.log(acc, vecs.map(v => v.x).join())
