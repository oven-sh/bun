// A typed object gets null or undefined in a required field of a reference type and is then read through its type.
function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
interface Rec { n: number; s: string; b: boolean; tail: number }
function fresh(): Rec { return { n: 1, s: "s", b: true, tail: 9 } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function poke(o: any, k: string, v: unknown) { o[k] = v }
attempt("b1", () => { const r = fresh(); poke(r, "s", undefined); return [r.s, r.s + "!", "s" in r, show(r)].map(String).join(" ") })
attempt("b2", () => { const r = fresh(); poke(r, "s", null); return [r.s, r.s + "!", r.s === null, show(r)].map(String).join(" ") })
attempt("b3", () => { const r = fresh(); poke(r, "s", null); poke(r, "n", 2.5); poke(r, "b", false); return [r.s, r.b, r.n + 1, !r.b, show(r)].map(String).join(" ") })
attempt("b4", () => { const r = fresh(); poke(r, "s", undefined); r.s += "x"; return r.s + show(r) })
attempt("b5", () => { const r = fresh(); poke(r, "s", null); return r.s.length })
// No any and no cast: a view in which the field is optional, or may be null.
interface Looser { n?: number; s?: string | null }
attempt("c3", () => { const r = fresh(); const l: Looser = r; l.s = null; return [r.s, r.s + "!", show(r)].map(String).join(" ") })
attempt("c4", () => { const r = fresh(); const l: Looser = r; l.s = undefined; l.n = 4; return [r.s, r.n + 1, "s" in r, show(r)].map(String).join(" ") })
attempt("c5", () => { const patch: Partial<Rec> = { s: undefined, n: 5 }; const merged = { ...fresh(), ...patch }; return [merged.s, merged.s + "!", merged.n + 1, show(merged)].map(String).join(" ") })
class Acc { total = 0; label = "acc"; add(n: number) { this.total += n; return this.total } }
attempt("e3", () => { const a = new Acc(); poke(a, "label", undefined); return [a.label, a.label + "!", a.add(1), show(a)].map(String).join(" ") })
// One access site, objects in every state.
function totalOf(list: Rec[]): string { let t = 0, text = ""; for (const r of list) { t += r.n; text += r.s } return t + text }
attempt("f1", () => { const a = fresh(), b = fresh(), c = fresh(), d = fresh(); poke(b, "s", undefined); poke(c, "s", null); return totalOf([a, b, c, d]) })
