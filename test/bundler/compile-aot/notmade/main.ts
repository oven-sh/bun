// Objects whose allocation can be eliminated, and look-alikes that have to be allocated. The output must match the interpreter's.
const say = (what: string, got: unknown) => console.log(what + ": " + (typeof got === "string" ? got : JSON.stringify(got) ?? String(got)));
const log: string[] = []; const noted = <T,>(what: string, v: T): T => { log.push(what); return v; };
const opaque = <T,>(v: T): T => (log.length > 1e9 ? (undefined as T) : v); const keep: unknown[] = [];
type P = { x: number; y: number }; type R = { lo: number; hi: number; name: string }; type K = { kind: string; n: number };
// ---- Only read.
function onTheSpot(x: number, y: number) { const { p, q } = { p: x + 1, q: y * 2 }; return p + q; }
function later(n: number) { const o: R = { lo: n, hi: n + 10, name: "r" + n }; let s = 0; for (let i = o.lo; i < o.hi; i++) s += i; return o.name + s + (o.hi > 5 ? o.lo : o.hi); }
const pair = (a: number, b: string) => ({ first: a, second: b });
function fromAHelper() { const { first, second } = pair(1, "two"); const r = pair(3, "four"); return second + first + r.second + r.first; }
function nested(x: number) { const o = { inner: { deep: x, deeper: { still: x * 2 } }, other: x + 1 }; return o.inner.deep + o.other + o.inner.deeper.still; }
function oneOfMany(x: number) { const o = { a: x, b: x + 1, c: x + 2, d: x + 3, e: x + 4, f: x + 5, g: x + 6, h: x + 7, i: x + 8, j: x + 9, k: x + 10 }; return o.k - o.a + o.f; }
function inOrder() { log.length = 0; const o = { a: noted("a", 1), b: noted("b", 2), c: noted("c", 3) }; return o.b + log.join(); }
function asItWas() { let v = 1; const o = { v }; v = 2; const w = o.v; v = 3; return [w, o.v, v]; }
function numbers(i: number) { const o: P = { x: i, y: i + 0.5 }; return [o.x + 1, o.y * 2, o.x / 2, (o.x | 0) === o.x]; }
function strings() { const o: K = { kind: "te" + ["xt"].join(""), n: 1 }; return [o.kind === "text", o.kind !== "text", o.kind.length]; }
function defaults() { const { a = 5, b = 6, c = 7 } = { a: undefined, b: null, c: 0 } as { a?: number; b?: number | null; c?: number }; return [a, b, c]; }
function notThere() { const { a } = { a: undefined as number | undefined }; return a === undefined; }
function twice(x: number) { const o = { a: x }; return o.a + o.a + o.a; }
say("only read", [onTheSpot(1, 2), later(3), fromAHelper(), nested(4), oneOfMany(5), inOrder(), asItWas(), numbers(7), strings(), defaults(), notThere(), twice(2)]);
// ---- Has to be made: each of these does something to it that shows.
say("returned", ((x: number) => { const o = { a: x }; return o; })(1));
say("passed", ((x: number) => { const o = { a: x }; return [opaque(o).a, o.a]; })(2));
say("kept", ((x: number) => { const o = { a: x }; keep.push(o); return o.a; })(3) + " " + JSON.stringify(keep));
say("written", ((x: number) => { const o = { a: x }; const before = o.a; o.a = 9; return [before, o.a]; })(4));
say("written by a name that is worked out", ((x: number, k: string) => { const o: Record<string, number> = { a: x }; o[k] = 9; return o.a; })(5, "a"));
say("given more", ((x: number) => { const o: { a: number; b?: number } = { a: x }; o.b = 2; return [o.a, o.b]; })(6));
say("taken from", ((x: number) => { const o: { a?: number; b: number } = { a: x, b: 1 }; delete o.a; return [o.a, o.b]; })(7));
say("read by a name that is worked out", ((x: number, k: string) => { const o: Record<string, number> = { a: x }; return o[k]; })(8, "a"));
say("asked for what it has not", ((x: number) => { const o = { a: x } as { a: number; z?: number }; return [o.a, o.z]; })(9));
say("asked for what it inherits", ((x: number) => { const o = { a: x }; return [typeof o.toString, o.hasOwnProperty("a"), String(o), o.a]; })(10));
say("in", ((x: number) => { const o = { a: x }; return ["a" in o, "b" in o, o.a]; })(11));
say("keys", ((x: number) => { const o = { a: x, b: 1 }; return [Object.keys(o), o.a]; })(12));
say("spread", ((x: number) => { const o = { a: x }; const c = { ...o, b: 1 }; return [c, o.a]; })(13));
say("the rest of it", ((x: number) => { const { a, ...rest } = { a: x, b: 1, c: 2 }; return [a, rest]; })(14));
say("gone through", ((x: number) => { const o = { a: x, b: 1 }; let s = ""; for (const k in o) s += k; return s + o.a; })(15));
say("which it is", ((x: number) => { const o = { a: x }, p = { a: x }; const q = o; return [o === q, (o as unknown) === p, o.a]; })(16));
say("what it is", ((x: number) => { const o = { a: x }; return [typeof o, !!o, o ? 1 : 2, o instanceof Object, o.a]; })(17));
say("if it is there", ((x: number) => { const o: { a: number } | undefined = { a: x }; return [o?.a, o.a ?? 5]; })(18));
say("in a closure", ((x: number) => { const o = { a: x }; const f = () => o.a; return f() + o.a; })(19));
say("one of two", ((x: number, c: boolean) => { const o = c ? { a: x } : { a: -x }; return o.a; })(20, true));
say("round a loop", ((x: number) => { let o = { a: x }; for (let i = 0; i < 3; i++) o = { a: o.a + 1 }; return o.a; })(21));
say("with a getter", ((x: number) => { let n = 0; const o = { a: x, get b() { return ++n; } }; return [o.a, o.b, o.b]; })(22));
say("with a method", ((x: number) => { const o = { v: x, f() { return this.v + 1; } }; return [o.f(), o.v]; })(23));
say("a function of it called", ((x: number) => { const o = { v: x, f: function (this: unknown) { return this === undefined ? "nothing" : typeof this; } }; const g = o.f; return [o.f(), g()]; })(24));
say("a name twice", ((x: number) => { const o = { a: x, ["a"]: x + 1 }; const p = eval("({ a: 1, a: 2 })"); return [o.a, p.a]; })(25));
say("a prototype", ((x: number) => { const o: any = { __proto__: { z: 5 }, a: x }; return [o.a, o.z]; })(26));
say("numbers for names", ((x: number) => { const o = { 0: x, 1: x + 1, a: 2 }; return [o[0], o[1], o.a]; })(27));
say("thrown past", ((x: number) => { const o = { a: x }; try { if (x) throw new Error("e"); return 0; } catch { return o.a; } })(28));
say("thrown", ((x: number) => { try { throw { a: x }; } catch (e) { return (e as { a: number }).a; } })(29));
say("frozen", ((x: number) => { const o = Object.freeze({ a: x }); return [o.a, Object.isFrozen(o)]; })(30));
say("printed", ((x: number) => { const o = { a: x }; return `${JSON.stringify(o)} ${o.a}`; })(31));
say("awaited", "see below"); (async (x: number) => { const o = { a: x }; await null; return o.a; })(32).then(v => say("after an await", v));
say("yielded past", [...(function* (x: number) { const o = { a: x }; yield o.a; yield o.a + 1; })(33)]);
// ---- Over and over.
{ let s = 0; for (let i = 0; i < 20000; i++) { const { p, q } = { p: i, q: i + 1 }; const r = pair(p, "x"); s += p + q + r.first; } say("many times", s); }
export {};
