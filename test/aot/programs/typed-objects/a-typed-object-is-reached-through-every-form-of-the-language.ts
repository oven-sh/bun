// One interface, read and written through patterns, defaults, optional chains, loops, callbacks, Maps, Sets, records, awaits, generators, spreads, mapped and intersection types, type parameters, assertions, closures, conditionals, tuples, rest parameters and a declared this.
const launder: <T>(x: T) => T = (globalThis as any).launder ?? ((x: any) => x);
interface Q { r: number; s: string }
interface P { a: number; b: string; q: Q; list: Q[]; opt?: Q; cb: (x: number) => number; m(x: number): number }
const mk = (i: number): P => ({ a: i, b: "b" + i, q: { r: i, s: "s" }, list: [{ r: 1, s: "x" }], cb: x => x + i, m(x) { return x * i; } });
let out = 0; const use = (x: number | string | undefined | boolean) => { out += typeof x === "number" ? x : typeof x === "string" ? x.length : 1; };

function paramPattern({ a, q: { r }, list: [first] }: P) { use(a); use(r); use(first.r); }
function paramDefault(p: P = mk(1)) { use(p.a); use(p.q.r); }
function localPattern(p: P) { const { a, b, q } = p; use(a); use(b); use(q.r); const { r, s } = q; use(r); use(s); }
function restPattern(p: P) { const { a, ...rest } = p; use(a); use(rest.b); use(rest.q.r); }
function chain(p: P | undefined) { use(p?.a); use(p?.q.r); use(p?.opt?.r); use(p?.m(1)); use(p?.cb(1)); use(p?.list[0]?.r); }
function forOfPattern(ps: P[]) { for (const { a, q } of ps) { use(a); use(q.r); } for (const p of ps) { use(p.b); } }
function forIndex(ps: P[]) { for (let i = 0; i < ps.length; i++) { const p = ps[i]; use(p.a); use(ps[i].q.r); } }
function callbacks(ps: P[]) { use(ps.map(p => p.a).length); ps.forEach(p => use(p.q.r)); use(ps.reduce((t, p) => t + p.a, 0)); const f = ps.find(p => p.a > 0); use(f?.a); use(ps.filter(p => p.a > 0)[0].b); use(ps.some(p => p.q.r > 0)); }
function maps(m: Map<string, P>, s: Set<P>) { const p = m.get("k"); if (p) { use(p.a); use(p.q.r); } for (const [k, v] of m) { use(k); use(v.a); } for (const v of m.values()) use(v.b); for (const v of s) use(v.a); m.forEach(v => use(v.a)); }
function records(r: Record<string, P>, k: string) { const p = r[k]; if (p) use(p.a); for (const key in r) use(r[key].a); for (const v of Object.values(r)) use(v.a); for (const [key, v] of Object.entries(r)) { use(key); use(v.a); } }
async function awaits(pp: Promise<P>, f: () => Promise<P>) { const p = await pp; use(p.a); use((await f()).q.r); const [x, y] = await Promise.all([pp, f()]); use(x.a); use(y.b); }
function* gen(ps: P[]): Generator<P, void, Q | undefined> { for (const p of ps) { const sent = yield p; if (sent) use(sent.r); } }
function useGen(ps: P[]) { for (const p of gen(ps)) use(p.a); const g = gen(ps); const n = g.next(); if (!n.done) use(n.value.a); }
function spreads(p: P) { const c = { ...p, c: 1 }; use(c.a); use(c.c); use(c.q.r); const d = { ...p }; use(d.b); const e = Object.assign({}, p); use(e.a); const l = [...p.list]; use(l[0].r); }
type AB = { a: number } & { b: string }; type Part = Partial<P>; type RO = Readonly<P>; type Pk = Pick<P, "a" | "q">; type Om = Omit<P, "list">; type Req = Required<P>;
function aliases(ab: AB, pa: Part, ro: RO, pk: Pk, om: Om, rq: Req, qq: P["q"]) { use(ab.a); use(ab.b); use(pa.a); use(pa.q?.r); use(ro.a); use(ro.q.r); use(pk.a); use(pk.q.r); use(om.a); use(om.q.r); use(rq.opt.r); use(qq.r); }
function keyed<K extends keyof P>(p: P, k: K, k2: "a" | "b") { const v = p[k]; use(typeof v); use(p[k2]); use(p["a"]); }
function generic<T extends P>(t: T, ts: T[]) { use(t.a); use(t.q.r); use(ts[0].a); for (const x of ts) use(x.b); }
function generic2<T extends { q: Q }>(t: T) { use(t.q.r); }
function asserted(x: unknown, y: any, z: P | null) { use((x as P).a); use((y as P).q.r); use(z!.a); const w = y as P; use(w.b); const v: P = y; use(v.a); use((<P>x).b); use((x as P satisfies P).a); }
function caught() { try { throw mk(1); } catch (e) { use((e as P).a); } }
function closures(p: P) { const f = () => p.a; const g = () => { use(p.q.r); }; use(f()); g(); return function () { return p.b; }; }
function conditional(p: P, q: P, c: boolean) { const x = c ? p : q; use(x.a); const y = c && p; if (y) use(y.a); const z = p.opt ?? p.q; use(z.r); const w = p.opt || p.q; use(w.s); let v = p; if (c) v = q; use(v.a); }
function returned(): P { return launder(mk(3)); }
function results() { use(returned().a); use(returned().q.r); const r = returned(); use(r.b); use(r.m(1)); use(r.cb(2)); }
function tuples(t: [P, Q], u: readonly [number, P?], v: [a: P, ...rest: Q[]]) { use(t[0].a); use(t[1].r); const [p, q] = t; use(p.a); use(q.r); use(u[1]?.a); use(v[0].a); use(v[1].r); const [h, ...rest] = v; use(h.a); use(rest[0].r); }
function switches(p: P) { switch (p.a) { case 1: use(p.b); break; default: use(p.q.r); } }
function whiles(p: P | undefined, next: (p: P) => P | undefined) { while (p) { use(p.a); p = next(p); } }
function nested(p: P) { use(p.list[0].r); use(p.list.length); use(p.q.s.length); use(p.list.map(x => x.r)[0]); use(p.b.charCodeAt(0)); }
function stores(p: P, q: Q) { p.a = 1; p.q = q; p.q.r = 2; p.opt = q; p.list[0] = q; p.list.push(q); p.a += 2; p.a++; p.q.r ||= 3; p.opt ??= q; }
function templates(p: P) { use(`${p.a}-${p.q.s}`); }
function comma(p: P) { use((use(0), p).a); use((p).a); }
function args(...ps: P[]) { use(ps[0].a); for (const p of ps) use(p.b); }
function thisParam(this: P, x: number) { use(this.a + x); use(this.q.r); }

const ps = launder([mk(1), mk(2)]); const p0 = launder(mk(5));
paramPattern(launder(p0)); paramDefault(launder(p0)); paramDefault(); localPattern(launder(p0)); restPattern(launder(p0)); chain(launder(p0)); chain(undefined); forOfPattern(ps); forIndex(ps); callbacks(ps);
maps(launder(new Map([["k", p0]])), launder(new Set([p0]))); records(launder({ k: p0 }), "k"); useGen(ps); spreads(launder(p0));
aliases(launder({ a: 1, b: "b" }), launder(p0), launder(p0), launder(p0), launder(p0), launder({ ...p0, opt: p0.q }), launder(p0.q)); keyed(launder(p0), "a", "b"); generic(launder(p0), ps); generic2(launder(p0));
asserted(launder(p0), launder(p0), launder(p0)); caught(); use(closures(launder(p0))()); conditional(launder(p0), launder(p0), out > 0); results();
tuples(launder([p0, p0.q]), launder([1, p0]), launder([p0, p0.q])); switches(launder(p0)); whiles(launder(p0), () => undefined); nested(launder(p0)); stores(launder(mk(9)), launder({ r: 1, s: "s" })); templates(launder(p0)); comma(launder(p0)); args(...ps); thisParam.call(launder(p0), 1);
awaits(Promise.resolve(launder(p0)), async () => launder(p0)).then(() => console.log(out));
