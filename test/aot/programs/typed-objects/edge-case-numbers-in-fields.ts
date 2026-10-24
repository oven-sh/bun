// Numbers in typed fields in edge cases: NaNs with unusual bit patterns, -0, integer overflow.
interface Req { v: number }
interface Opt { v?: number; w?: number }
function sign(x: number): string { return Object.is(x, -0) ? "-0" : String(x) }
function state(o: Opt): string { return ("v" in o ? "own" : "absent") + ":" + (o.v === undefined ? "undefined" : sign(o.v)) }

// NaNs of many bit patterns, made in memory. Each must stay a NaN: never undefined, never absent, never a pointer or an integer.
const bits = new Uint32Array(2), asDouble = new Float64Array(bits.buffer)
function fromBits(hi: number, lo: number): number { bits[0] = lo; bits[1] = hi; return asDouble[0] }
const patterns: [number, number][] = [[0x7ff80000, 0], [0x7ff80000, 1], [0xfff80000, 0], [0xffffffff, 0xffffffff], [0x7fffffff, 0xffffffff], [0x7ff00000, 1], [0xfff00000, 1],
  [0x7ff40000, 0], [0xfffe0000, 0], [0xfffe0000, 2], [0xfffe0000, 10], [0xffff0000, 7], [0x7ffc0000, 0], [0x7ff8dead, 0xbeef0000], [0xfff80000, 0x0000000a], [0x7ff80000, 0x00000002], [0x7ff80000, 0x00000006]]
const out: string[] = []
const kept: number[] = [0.5]
const optionals: Opt[] = []
for (const [hi, lo] of patterns) {
  const x = fromBits(hi, lo)
  const r: Req = { v: x }
  const o: Opt = { v: x }
  const late: Opt = {}
  late.w = x
  kept.push(x)
  optionals.push(o)
  out.push([String(r.v), state(o), String(late.w), "w" in late, "v" in late, r.v === r.v, (r.v as unknown) === undefined, o.v === undefined, o.v ?? "nullish", typeof o.v, Number.isNaN(r.v), r.v + 1, JSON.stringify(o)].join("/"))
}
console.log([...new Set(out)].join(" ; "), out.length)
console.log(kept.map(String).join(), kept.filter(x => x === undefined).length, kept.length, optionals.filter(o => o.v === undefined).length, optionals.filter(o => "v" in o).length)
console.log(fromBits(0x7ff00000, 0), fromBits(0xfff00000, 0), sign(fromBits(0x80000000, 0)), fromBits(0, 1), fromBits(0x3ff00000, 0), fromBits(0x7fefffff, 0xffffffff))

// undefined, absent and NaN are three states of one optional field.
const tri: Opt = {}
const states: string[] = [state(tri)]
tri.v = NaN; states.push(state(tri))
tri.v = undefined; states.push(state(tri))
tri.v = 0; states.push(state(tri))
delete tri.v; states.push(state(tri))
tri.v = -0; states.push(state(tri))
console.log(states.join())

// -0 survives fields, arrays, arithmetic and copies, also where every other value is a small integer.
const zeros: Req[] = [{ v: 0 }, { v: -0 }, { v: 0 * -1 }, { v: -1 * 0 }, { v: Math.round(-0.4) }, { v: -5 % 5 }, { v: 0 / -3 }, { v: -(0) }, { v: 1 - 1 }, { v: Math.min(0, -0) }]
console.log(zeros.map(z => sign(z.v)).join(), zeros.map(z => 1 / z.v).join(), zeros.map(z => sign({ ...z }.v)).join(), JSON.stringify(zeros[1]), sign(zeros[1].v + 0), sign(zeros[1].v * 1), sign(-zeros[0].v))
const counter: Req = { v: 3 }
for (let i = 0; i < 3; i++) counter.v--
console.log(sign(counter.v), sign(counter.v * -1), sign(counter.v * -1 + 0))

// Overflow of 32 bits and of 53 bits by ++, --, += and *= on fields.
const up: Req = { v: 2147483646 }, down: Req = { v: -2147483647 }, wide: Req = { v: 9007199254740990 }, mul: Req = { v: 65536 }, uns: Req = { v: 4294967294 }
const steps: string[] = []
for (let i = 0; i < 4; i++) { up.v++; down.v--; wide.v += 1; mul.v *= 65536; uns.v++; steps.push([up.v, down.v, wide.v, mul.v, uns.v].join("/")) }
console.log(steps.join(" "))
console.log(up.v | 0, down.v | 0, uns.v >>> 0, uns.v | 0, wide.v % 2, mul.v > 2 ** 64, up.v - down.v)

// Values that a reserved integer or a tag might collide with, in optional fields whose other values are small integers.
const special = [-2147483648, 2147483647, -1, 0x7fffffff, 2 ** 31, 2 ** 32, 2 ** 32 - 1, 2 ** 53, -(2 ** 53), 2 ** 52, 0x7ffffffe, -2147483647, 2 ** 31 + 1, 0xfffe, 0xffff0000, 2 ** 49, 2 ** 51 - 1, 1e21, 5e-324, 2.5, -0.5]
const smallFirst: Opt[] = []
for (let i = 0; i < 4; i++) smallFirst.push({ v: i, w: i + 1 })
for (const x of special) smallFirst.push({ v: x }, { w: x, v: 1 })
console.log(smallFirst.map(o => state(o) + ":" + ("w" in o ? sign(o.w ?? NaN) : "-")).join(" "))
const reused: Opt = { v: 1 }
console.log(special.map(x => { reused.v = x; reused.w = x; const same = reused.v === x && reused.w === x && "v" in reused; delete reused.w; return same && !("w" in reused) && reused.w === undefined }).join())

// From integer to fraction and back in one field; a sum that is only integral at the end.
const drift: Req = { v: 1 }
const path: string[] = []
for (const add of [1, 0.5, 0.5, 1e300, -1e300, Infinity, -Infinity, 1]) { drift.v += add; path.push(sign(drift.v)) }
console.log(path.join())
