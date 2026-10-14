// Parsed JSON that has every required field is cast to a declared type.
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
interface P { x: number; label: string; ok: boolean; opt?: number; child: { v: number } }
const nulls = JSON.parse('{"x":0,"label":null,"ok":false,"child":null}') as P
const whole = JSON.parse('{"child":{"v":2},"opt":7,"ok":true,"label":"whole","x":-0.5}') as P
const own: P = { x: 5, label: "own", ok: true, child: { v: 1 } }
attempt("a1", () => [whole.x, whole.label, whole.ok, whole.opt, whole.child.v, Object.keys(whole).join("")].map(String).join())
attempt("a3", () => [nulls.x, nulls.label, nulls.ok, nulls.opt, nulls.child].map(String).join())
attempt("a4", () => [nulls.x + 1, nulls.label + "!", nulls.ok ? 1 : 0, typeof nulls.label, nulls.label === null, "label" in nulls, "opt" in nulls, JSON.stringify(nulls)].join())
attempt("a5", () => nulls.label.length)
attempt("a6", () => nulls.child.v)
attempt("a7", () => whole.child?.v)
function sum(items: P[]): number { let s = 0; for (const item of items) s += item.x; return s }
function labels(items: P[]): string { let s = ""; for (const item of items) s += item.label + (item.ok ? "+" : "-"); return s }
attempt("b1", () => [sum([own, own]), sum([own, whole]), sum([own, nulls, own]), sum([nulls])].join())
attempt("b2", () => [labels([own]), labels([whole, own]), labels([own, nulls])].join())
attempt("c1", () => { const { x, label = "dflt", opt = 9 } = whole; return [x, label, opt].map(String).join() })
attempt("c2", () => { const { x, label = "dflt", opt = 9 } = nulls; return [String(x), String(label), String(opt)].join() })
// The value goes on into compiled places.
interface Copy { x: number; label: string }
attempt("d1", () => { const c: Copy = { x: whole.x, label: nulls.label }; return JSON.stringify(c) + Object.keys(c).join() + (c.x + 1) + c.label })
attempt("d2", () => { const c: Copy = { x: 1, label: "l" }; c.x = nulls.x; c.label = nulls.label; return JSON.stringify(c) + (c.x + 1) + c.label })
attempt("d3", () => { const list: string[] = [whole.label, nulls.label, own.label]; return JSON.stringify(list) + list.map(n => n + "1").join() })
// Over null.
attempt("e1", () => { const bare = Object.assign(Object.create(null), JSON.parse('{"x":1,"label":"bare","ok":true,"child":{"v":3}}')) as P; return [bare.x, bare.label, bare.ok, bare.opt, bare.child.v, Object.getPrototypeOf(bare)].map(String).join() })
attempt("e2", () => { const bare = Object.assign(Object.create(null), { x: 1, label: "bare", ok: true, child: { v: 3 } }) as P; return [bare.x, bare.label, bare.ok, bare.opt, bare.child.v, Object.getPrototypeOf(bare)].map(String).join() })
// Arrays, tuples and maps.
const withNull = JSON.parse('["a",null,"c"]') as string[]
attempt("f1", () => [withNull[0], withNull[1], withNull[2], withNull[3]].map(String).join())
attempt("f2", () => { let s = ""; for (const n of withNull) s += n; return s })
attempt("f3", () => { let s = ""; for (let i = 0; i <= withNull.length; i++) s += withNull[i]; return s })
attempt("f4", () => (JSON.parse("[null]") as string[])[0] + "!")
attempt("f5", () => { const t = JSON.parse('[null,2]') as [string, number]; return t[0] + "/" + t[1] })
attempt("f6", () => { const n = JSON.parse("[1,2.5]") as number[]; return n[0] + n[1] + "/" + n[2] })
const byKey = new Map<string, string>()
;(byKey as Map<string, any>).set("n", null).set("u", undefined)
attempt("g1", () => [byKey.get("n"), byKey.get("u"), byKey.get("none")].map(String).join())
// Results of functions from outside.
const parse = JSON.parse as (text: string) => string
attempt("h1", () => [parse("null"), parse("null") + "1", parse('"s"')].map(String).join())
