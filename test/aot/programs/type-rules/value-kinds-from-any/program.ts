function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
const hide = (v: unknown): any => v
interface P { x: number }
attempt("a1", () => { const p: P = hide(5); return typeof p })
attempt("a2", () => { const p: P = hide("s"); return typeof p })
attempt("a3", () => { const p: P = hide(true); return typeof p })
attempt("a4", () => { const p: P = hide({ y: 1 }); return typeof p })
attempt("a5", () => { const p: P = hide([]); return typeof p })
attempt("a6", () => { const p: P = hide(() => 1); return typeof p })
attempt("a7", () => typeof (hide(5) as P))
attempt("a8", () => { const p: P = hide(Symbol("p")); return typeof p })
attempt("a9", () => { const p: P = hide(5n); return typeof p })
type Fn = (n: number) => number
attempt("c1", () => { const f: Fn = hide(5); return typeof f })
attempt("c2", () => { const f: Fn = hide({}); return typeof f })
attempt("c6", () => { const f: Fn = hide("abs"); return typeof f })
// Built-in classes: what merely has the members is none.
attempt("d1", () => { const a: number[] = hide({ length: 2, 0: 7 }); return a.length })
attempt("d2", () => { const a: number[] = hide({ length: 2, 0: 7 }); return a[0] })
attempt("d3", () => { const a: number[] = hide(5); return typeof a })
attempt("d4", () => { const a: number[] = hide("ab"); return a.length })
attempt("d5", () => { const m: Map<string, number> = hide(new Set(["a"])); return m.size })
attempt("d6", () => { const m: Map<string, number> = hide({}); return m.get("a") })
attempt("d7", () => { const a: number[] = hide({ length: 2 }); return Array.isArray(a) })
class C { v = 1; m() { return this.v } }
attempt("e1", () => { const c: C = hide({ v: 2 }); return c.v })
attempt("e2", () => { const c: C = hide({ v: 2 }); return c.m() })
attempt("e4", () => { const c: C = hide(3); return typeof c })
attempt("e5", () => { const c: C = hide({ v: 2 }); return c instanceof C })
attempt("f1", () => { const o: object = hide(5); return typeof o })
// Into fields, parameters and results of object type.
interface Owner { item: P }
const owner: Owner = { item: { x: 1 } }
function describe(p: P): string { return typeof p }
attempt("g1", () => { owner.item = hide(7); return "stored" })
attempt("g2", () => (describe as any)(new Date(0)))
attempt("g3", () => (describe as any)("text"))
attempt("g4", () => owner.item.x)
// It is thrown where the value enters, before any use.
attempt("h1", () => { const p: P = hide(5); return p.x })
attempt("h2", () => { const p: P = hide("abc"); return String(p.x) + (p as unknown as { length: number }).length })
attempt("h3", () => { const p: P = hide(5); p.x = 1; return "stored" })
attempt("h4", () => { const p: P = hide(true); return "x" in p })
attempt("h5", () => { const f: Fn = hide(5); return f(1) })
attempt("h6", () => { const f: Fn = hide({}); return f(1) })
attempt("h7", () => { const c: C = hide(3); return c.v })
attempt("h8", () => { const c: C = hide("s"); return c.m() })
attempt("h9", () => { const m: Map<string, number> = hide("ab"); return m.size })
attempt("h10", () => { const p: P = hide(5); return Object.keys(p).length + JSON.stringify(p) + String(p) })
// A union with primitives admits its own parts only.
attempt("i1", () => { const u: P | number = hide("s"); return typeof u })
attempt("i2", () => { const u: Fn | string = hide(5); return typeof u })
attempt("i3", () => { const u: number[] | boolean | null = hide(5n); return typeof u })
attempt("i4", () => typeof (hide(Symbol.iterator) as object | undefined))
attempt("i5", () => { const u: P | number = hide("s"); return typeof u === "number" ? u + 1 : typeof u === "object" ? u.x : "neither" })
interface Mixed { either: P | number; call?: Fn | string }
attempt("i6", () => { const m = JSON.parse('{"either":"text","call":5}') as Mixed; return typeof m.either + typeof m.call })
attempt("i7", () => { const m: Mixed = { either: 1 }; m.either = hide(true); m.call = hide(7); return typeof m.either + typeof m.call + JSON.stringify(m) })
function mixed(v: P | number): string { return typeof v }
attempt("i8", () => (mixed as any)("text") + mixed(hide(false)))
