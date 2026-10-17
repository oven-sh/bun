// Null and undefined can enter variables declared `string`, object, function or array through `any`, `unknown` and casts, and flow on as in plain JavaScript.
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): any => v
attempt("a3", () => { const s: string = hide(undefined); return s + "!" })
attempt("a4", () => { const s: string = hide(null); return s + "!" })
attempt("a7", () => { const s: string = hide(undefined); return [typeof s, s === undefined, s == null, s ?? "default", s === s].join() })
attempt("a8", () => { const s: string = hide(null); return [typeof s, s === null, s == undefined, s ?? "default", s > "a", `${s}`].map(String).join() })
attempt("a9", () => { const s: string = hide(undefined); return s.length })
attempt("b3", () => `${hide(null) as string}/${hide(undefined) as string}`)
attempt("b4", () => (hide(undefined) as string) === undefined)
attempt("b5", () => { const o: { x: number } = hide(null); const f: () => void = hide(undefined); const a: number[] = hide(null); return [o, f, a].map(String).join() })
attempt("b6", () => { const o: { x: number } = hide(null); return o.x })
attempt("b7", () => { const f: () => void = hide(undefined); return f() })
attempt("b8", () => { const a: number[] = hide(null); return a.length })
// On into fields, elements, parameters, results.
interface Rec { n: number; s: string; o: { x: number }; m?: number; u: number | undefined; l: boolean | null }
const rec: Rec = { n: 1, s: "s", o: { x: 1 }, u: 1, l: true }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
attempt("c1", () => { rec.s = hide(undefined); return show(rec) + " " + rec.s + " " + ("s" in rec) })
attempt("c2", () => { rec.s = hide(null); return show(rec) + " " + rec.s + " " + (rec.s + "1") })
attempt("c3", () => { rec.o = hide(undefined); return show(rec) + " " + rec.o })
attempt("c4", () => { rec.m = hide(undefined); rec.u = hide(undefined); rec.l = hide(null); return show(rec) + " " + rec.m + rec.u + rec.l })
attempt("c5", () => { rec.n = 2; rec.s = "t"; rec.o = { x: 2 }; return show(rec) + " " + (rec.n + 1) + rec.s + rec.o.x })
attempt("c6", () => { const made: Rec = { n: 0, s: hide(null), o: hide(undefined), u: hide(undefined), l: hide(null) }; return show(made) + " " + made.s + made.o + made.u + made.l })
const texts: string[] = ["a", "b"]
attempt("d1", () => { texts[1] = hide(undefined); texts[2] = hide(null); return texts.length + " " + JSON.stringify(texts) + " " + (texts[1] + "1") + " " + (texts[2] + "1") })
attempt("d2", () => { let s = ""; for (const t of texts) s += t; return s })
function exclaim(s: string): string { return s + "!" }
function withDefault(s: string = "d", n: number = 10): string { return s + "/" + n }
function back(v: any): string { return v }
attempt("e1", () => [exclaim(hide(undefined)), exclaim(hide(null)), withDefault(hide(undefined), hide(undefined)), withDefault(hide(null))].join())
attempt("e2", () => [back(undefined), back(null), back(undefined) + "1", back(null) + "1"].map(String).join())
attempt("e3", () => [(exclaim as any)(), (exclaim as any)(null), (withDefault as any)(), (withDefault as any)(null)].join())
class Label { constructor(public text: string, public unit: string = "C") {} all() { return this.text + "/" + this.unit } }
attempt("e4", () => new (Label as any)().all() + " " + show(new (Label as any)()) + " " + new (Label as any)(null, null).all())
// Captured variables and loops.
attempt("f1", () => { let acc: string = ""; const set = (v: any) => { acc = v }; set(undefined); const seen = String(acc); set("3"); return seen + acc })
attempt("f2", () => { let out = ""; for (const v of ["1", undefined, "2", null, "3"] as any[]) { const s: string = v; out += (s + "1") + "," } return out })
attempt("f3", () => { const u: number | undefined = hide(undefined); const w: string | null = hide(undefined); const x: boolean | null = hide(null); return String(u) + String(w) + String(x) })
