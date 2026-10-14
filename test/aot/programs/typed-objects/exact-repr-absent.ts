// Absent, undefined, null and every falsy value are distinct states of a field, for each kind of field: boolean, string, number, object, function, union.
interface Inner { id: number }
interface All {
  b?: boolean; s?: string; n?: number; o?: Inner; f?: () => string
  bn: boolean | null; sn: string | null; nn: number | null; on: Inner | null
  bu: boolean | undefined; su: string | undefined; nu: number | undefined; ou: Inner | undefined
  mix?: number | string | boolean | null
}
function text(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" ? "object" : typeof v === "function" ? "function" : Object.is(v, -0) ? "-0" : String(v) }
function st(o: All, k: keyof All): string { return (k in o ? "" : "~") + text(o[k]) }
function fresh(): All { return { bn: null, sn: null, nn: null, on: null, bu: undefined, su: undefined, nu: undefined, ou: undefined } }
const optionalKeys: ("b" | "s" | "n" | "o" | "f" | "mix")[] = ["b", "s", "n", "o", "f", "mix"]
const allKeys: (keyof All)[] = ["b", "s", "n", "o", "f", "bn", "sn", "nn", "on", "bu", "su", "nu", "ou", "mix"]
function dump(o: All): string { return allKeys.map(k => st(o, k)).join() + " [" + Object.keys(o).join() + "] " + JSON.stringify(o) }

const a = fresh()
console.log(dump(a))
console.log(a.b, a.s, a.n, text(a.o), text(a.f), a.bn, a.sn, a.nn, a.on, a.bu, a.su, a.nu, a.ou, a.mix)

// Falsy values.
a.b = false; a.s = ""; a.n = 0; a.bn = false; a.sn = ""; a.nn = 0; a.bu = false; a.su = ""; a.nu = 0; a.mix = 0
console.log(dump(a))
console.log(a.b === false, a.s === "", a.n === 0, a.b ?? "d", a.s ?? "d", a.n ?? "d", a.b || "d", a.s || "d", a.n || "d", a.bn ?? "d", a.sn ?? "d", a.nn ?? "d", !a.b, !a.s, !a.n)

// An explicit undefined is a key.
a.b = undefined; a.s = undefined; a.n = undefined; a.o = undefined; a.f = undefined; a.mix = undefined
console.log(dump(a))
for (const k of optionalKeys) delete a[k]
console.log(dump(a))

// Truthy values, then null where the type has it.
a.b = true; a.s = "s"; a.n = -0; a.o = { id: 1 }; a.f = () => "f"; a.bn = true; a.sn = "null"; a.nn = NaN; a.on = { id: 2 }; a.bu = true; a.su = "undefined"; a.nu = NaN; a.ou = { id: 3 }; a.mix = null
console.log(dump(a), a.o.id, a.f(), a.on.id, a.ou.id)
a.bn = null; a.sn = null; a.nn = null; a.on = null; a.bu = undefined; a.su = undefined; a.nu = undefined; a.ou = undefined
console.log(dump(a))

// The union field goes through every kind.
const seen: string[] = []
for (const v of [0, "", false, null, undefined, 1.5, "x", true, NaN, -0, 2 ** 40] as (number | string | boolean | null | undefined)[]) { a.mix = v; seen.push(st(a, "mix") + typeof a.mix) }
delete a.mix; seen.push(st(a, "mix"))
console.log(seen.join())

// null and undefined compare, add and convert differently.
const z = fresh()
console.log(z.nn == undefined, z.nn === undefined, z.nu == null, z.nu === null, (z.nn ?? 0) + 1, Number(z.nn), Number(z.nu), String(z.sn) + String(z.su), `${z.bn}${z.bu}`, typeof z.on, typeof z.ou, z.on?.id, z.ou?.id)

// Optional chaining and calls on each state.
function call(o: All): string { return [o.f?.(), o.o?.id, o.on?.id, o.s?.length, o.n?.toFixed(1), o.b?.toString()].map(text).join() }
console.log(call(fresh()), call({ ...fresh(), f: () => "called", o: { id: 7 }, on: { id: 8 }, s: "", n: 0, b: false }), call({ ...fresh(), f: undefined, o: undefined, s: undefined }))

// Literals that spell out undefined against literals that leave the field out, read at one site.
const list: All[] = [fresh(), { ...fresh(), n: undefined }, { ...fresh(), n: 0 }, { ...fresh(), n: NaN }, { n: 5, ...fresh() }]
console.log(list.map(o => st(o, "n") + ":" + Object.keys(o).indexOf("n") + ":" + Object.hasOwn(o, "n") + ":" + (o.n === undefined) + ":" + ((o.n ?? 1) + 1)).join(" "))

// Classes.
class Node0 { left: Node0 | null = null; right?: Node0; weight: number | undefined = undefined; tag?: string; live?: boolean }
const n0 = new Node0()
const show0 = () => [text(n0.left), ("right" in n0) + text(n0.right), ("weight" in n0) + text(n0.weight), text(n0.tag), text(n0.live), JSON.stringify(n0)].join()
console.log(show0())
n0.right = new Node0(); n0.left = n0.right; n0.weight = 0; n0.tag = ""; n0.live = false
console.log(show0().length, n0.left === n0.right, n0.weight, text(n0.tag), n0.live)
delete n0.right; n0.left = null; n0.weight = undefined; delete n0.tag; n0.live = undefined
console.log(show0(), "live" in n0, "tag" in n0)
