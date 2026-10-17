// Each object literal keeps its own key order, whatever the order of the fields in its declared type.
interface Rec { a: number; b: string; c?: boolean; d?: number; e: number }
function show(o: object): string { return Object.keys(o).join("") + " " + JSON.stringify(o) }
const declared: Rec = { a: 1, b: "b", c: true, d: 4, e: 5 }
const reversed: Rec = { e: 5, d: 4, c: true, b: "b", a: 1 }
const shuffled: Rec = { c: false, a: 1, e: 5, b: "b" }
const least: Rec = { e: 0, a: 0, b: "" }
console.log(show(declared), show(reversed), show(shuffled), show(least))

function pick(n: number): Rec {
  switch (n % 6) {
    case 0: return { a: n, b: "0", e: n }
    case 1: return { b: "1", a: n, e: n }
    case 2: return { e: n, b: "2", a: n }
    case 3: return { d: n, a: n, b: "3", e: n }
    case 4: return { a: n, d: n, c: true, b: "4", e: n }
    default: return { c: false, e: n, d: n, b: "5", a: n }
  }
}
const picked: string[] = []
for (let i = 0; i < 12; i++) picked.push(Object.keys(pick(i)).join(""))
console.log(picked.join())

// One access site over all orders: the values do not follow the order.
function total(list: Rec[]): string { let s = 0, t = ""; for (const r of list) { s += r.a * 100 + r.e + (r.d ?? 0.5); t += r.b + (r.c === undefined ? "-" : r.c ? "T" : "F") } return s + t }
const all: Rec[] = []
for (let i = 0; i < 12; i++) all.push(pick(i))
console.log(total(all), total([declared, reversed, shuffled, least]))

// An explicit undefined is a key; a field left out is not.
const explicit: Rec = { a: 1, c: undefined, b: "x", d: undefined, e: 2 }
console.log(Object.keys(explicit).join(""), JSON.stringify(explicit), "c" in explicit, "c" in least, Object.hasOwn(explicit, "d"), Object.hasOwn(least, "d"), explicit.c, least.c)

// A name written twice keeps its first place and its last value; the values are evaluated in the order written.
const trace: string[] = []
function step<T>(label: string, v: T): T { trace.push(label); return v }
const evaluated: Rec = { e: step("e", 1), a: step("a", 2), b: step("b", "s"), d: step("d", 3) }
console.log(trace.join(), show(evaluated))
const source: { a?: number; b: string } = { a: 7, b: "src" }
const twice: Rec = { e: 1, ...source, a: 9, d: 2 }
const before: Rec = { a: 0, ...source, e: 3 }
console.log(show(twice), show(before))

// Computed names that are constants, shorthand, methods and quoted names take part in the same order.
const keyD = "d" as const
const a = 11, e = 12
const mixed: Rec = { [keyD]: 1, e, "b": "q", a }
console.log(show(mixed), Object.entries(mixed).map(p => p.join("=")).join("&"))

// Nested literals: each level has its own order.
interface Outer { first: Rec; second?: Rec; tag: string }
const nested: Outer = { tag: "t", second: { e: 1, a: 2, b: "n" }, first: { b: "m", e: 3, a: 4, c: true } }
console.log(show(nested), Object.keys(nested.first).join(""), Object.keys(nested.second ?? {}).join(""))

// The conditional operator, a logical operator and a function result between literals of several orders.
function choose(x: boolean, y: boolean): Rec { return x ? (y ? { a: 1, e: 2, b: "xy" } : { e: 2, a: 1, b: "x" }) : (y && { b: "y", e: 2, a: 1 }) || { b: "", a: 1, c: true, e: 2 } }
console.log([choose(true, true), choose(true, false), choose(false, true), choose(false, false)].map(o => Object.keys(o).join("")).join())

// Every way of listing agrees.
function listings(o: Rec): string {
  const forIn: string[] = []
  for (const k in o) forIn.push(k)
  return [Object.keys(o).join(""), forIn.join(""), Reflect.ownKeys(o).join(""), Object.getOwnPropertyNames(o).join(""), Object.entries(o).map(p => p[0]).join(""),
    Object.keys({ ...o }).join(""), Object.keys(Object.assign({}, o)).join(""), Object.keys(JSON.parse(JSON.stringify(o))).join(""), Object.keys(Object.getOwnPropertyDescriptors(o)).join("")].join("|")
}
console.log(listings(reversed), listings(shuffled), listings(pick(5)), listings(explicit))
