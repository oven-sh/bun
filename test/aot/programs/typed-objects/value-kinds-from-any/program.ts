function attempt(label: string, f: () => unknown) {
  try { console.log(label, String(f())) } catch (e) { console.log(label, (e as Error).constructor.name) }
}
const hide = (v: unknown): any => v
interface P { x: number }
const made: P = { x: 4 }
attempt("a1", () => { const p: P = hide(made); return [typeof p, p.x, p === made].join() })
attempt("a2", () => { const p: P = JSON.parse('{"x":5}'); return [typeof p, p.x, Object.keys(p).join()].join() })
attempt("a7", () => typeof (hide(made) as P))
attempt("b1", () => { const p: P = hide(null); return p === null })
attempt("b2", () => { const p: P = hide(undefined); return p === undefined })
attempt("b3", () => { const p: P = hide(null); return p.x })
type Fn = (n: number) => number
attempt("c3", () => { const f: Fn = hide((n: number) => n + 1); return f(1) })
attempt("c4", () => { const f: Fn = hide(class {}); return typeof f })
attempt("c5", () => { const f: Fn = hide(Math.abs); return f(-2) })
attempt("c6", () => { const f: Fn = hide(function (this: unknown, n: number) { return n * 2 }.bind(null)); return f(4) })
attempt("c7", () => { const f: Fn = hide(null); return f(1) })
// Built-in classes.
attempt("d1", () => { const a: number[] = hide([7, 8]); return a.length + "/" + a[0] + "/" + Array.isArray(a) })
attempt("d5", () => { const m: Map<string, number> = hide(new Map([["a", 1]])); return m.size + "/" + m.get("a") + "/" + m.get("b") })
attempt("d6", () => { const s: Set<string> = hide(new Set(["a"])); return s.size + "/" + s.has("a") })
attempt("d7", () => { const a: number[] = hide(undefined); return a.length })
class C { v = 1; m() { return this.v } }
class D extends C { w = 2 }
attempt("e1", () => { const c: C = hide(new C()); return c.v + "/" + c.m() + "/" + (c instanceof C) })
attempt("e2", () => { const c: C = hide(new D()); return c.v + "/" + c.m() + "/" + (c instanceof D) })
// Classes are types like any other: a literal that has all a C has is assignable to C.
attempt("e3", () => { const c: C = hide({ v: 2, m() { return 9 } }); return c.v + "/" + c.m() + "/" + (c instanceof C) })
attempt("f1", () => { const o: object = hide(made); return typeof o })
attempt("f2", () => { const o: object = hide([]); return typeof o })
attempt("f3", () => { const o: object = hide(Math.abs); return typeof o })
attempt("f4", () => { const o: object = hide(new Date(0)); return typeof o + Object.keys(o).length })
// Into fields, parameters and results of object type.
interface Owner { item: P }
const owner: Owner = { item: { x: 1 } }
function describe(p: P): string { return typeof p }
attempt("g1", () => { owner.item = hide(made); return "stored" })
attempt("g2", () => (describe as any)(made))
attempt("g3", () => (describe as any)(null) + (describe as any)())
attempt("g4", () => owner.item.x)
// The parts of a union with primitives.
attempt("i1", () => { const u: P | number = hide(5); return typeof u })
attempt("i2", () => { const u: Fn | string = hide("s"); return typeof u })
attempt("i3", () => { const u: number[] | boolean | null = hide(false); return typeof u })
attempt("i4", () => typeof (hide(undefined) as object | undefined))
attempt("i5", () => [5, made].map(v => { const u: P | number = hide(v); return typeof u === "number" ? u + 1 : typeof u === "object" ? u.x : "neither" }).join())
interface Mixed { either: P | number; call?: Fn | string }
attempt("i6", () => { const m = JSON.parse('{"either":{"x":1},"call":"text"}') as Mixed; return typeof m.either + typeof m.call })
attempt("i7", () => { const m: Mixed = { either: 1 }; m.either = hide(made); m.call = hide(Math.abs); return typeof m.either + typeof m.call + JSON.stringify(m) })
function mixed(v: P | number): string { return typeof v }
attempt("i8", () => (mixed as any)(1) + mixed(hide(made)))
