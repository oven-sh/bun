#!/usr/bin/env python3
"""typed-functions-by-value.py <folder>: A typed function reached BY VALUE (through `any`, the host, bind, call, apply) is handed what contradicts its parameters. Every line but "control" throws."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
PRE = '''const say = (what: string, f: () => unknown) => { let said: string; try { said = String(f()); } catch (x) { said = "THROWS " + (x as Error).constructor.name; } console.log(what + ": " + said); };
const loose = <F>(f: F): any => { const box: any[] = [f]; return box[0]; };
'''
ROWS = {
 'e1_how_many_arguments': '''
function two(a: number, b: number): string { return typeof a + typeof b + arguments.length + (a + b); }
function plainTwo(a: number, b: number): string { return typeof a + typeof b + (a + b); }
for (let i = 0; i < 50; i++) { two(i, i); plainTwo(i, i); }
say("control", () => loose(two)(1, 2) + loose(plainTwo)(1, 2));
say("the first is wrong", () => loose(two)("x", 2) + loose(plainTwo)("x", 2));
say("the second is wrong", () => loose(two)(1, "y") + loose(plainTwo)(1, "y"));
say("both", () => loose(two)("x", "y") + loose(plainTwo)("x", "y"));
say("one is lacking", () => loose(two)(1) + loose(plainTwo)(1));
say("none is there", () => loose(two)() + loose(plainTwo)());
say("one too many, the first wrong", () => loose(two)("x", 2, 3) + loose(plainTwo)("x", 2, 3));
say("null and undefined", () => loose(two)(null, undefined) + loose(plainTwo)(null, undefined));
say("length and name", () => loose(two).length + loose(two).name);
''',
 'e2_defaults_optional_rest': '''
function def(a: number, b: number = a + 1): string { return typeof a + typeof b + (a + b); }
function opt(a: number, b?: number): string { return typeof a + typeof b + (a + (b ?? 0)); }
function rest(a: number, ...more: number[]): string { return typeof a + more.length + more.map((m) => typeof m).join() + (a + more.length); }
function pattern({ x }: { x: number }, [y]: number[], z: number): string { return typeof x + typeof y + typeof z; }
for (let i = 0; i < 50; i++) { def(i); opt(i); rest(i, i); pattern({ x: i }, [i], i); }
say("control", () => loose(def)(1) + loose(opt)(1) + loose(rest)(1, 2) + loose(pattern)({ x: 1 }, [1], 1));
say("default, first wrong", () => loose(def)("x"));
say("default, second wrong", () => loose(def)(1, "y"));
say("default, second null", () => loose(def)(1, null));
say("optional wrong", () => loose(opt)(1, "y") + loose(opt)("x"));
say("rest, first wrong", () => loose(rest)("x", 1, 2));
say("rest, a later one wrong", () => loose(rest)(1, 2, "z"));
say("pattern, the last wrong", () => loose(pattern)({ x: 1 }, [1], "z"));
say("pattern, within", () => loose(pattern)({ x: "s" }, ["t"], 1));
''',
 'e3_this_and_captures': '''
class Counter { count = 0; add(n: number): string { this.count += 1; return typeof n + this.count + (n + 1); } static twice(n: number): string { return typeof n + (n + n); } }
function free(this: { tag: string }, n: number): string { return this.tag + typeof n + (n + 1); }
const makeAdder = (base: number) => { let calls = 0; return (n: number): string => { calls += 1; return typeof n + calls + (base + n); }; };
for (let i = 0; i < 50; i++) { new Counter().add(i); Counter.twice(i); free.call({ tag: "t" }, i); makeAdder(i)(i); }
say("control", () => { const c = new Counter(); return loose(c).add(1) + loose(Counter).twice(1) + loose(free).call({ tag: "t" }, 1) + loose(makeAdder(1))(1); });
say("method", () => { const c = new Counter(); const a = loose(c).add("x"); return a + c.add(1) + loose(c).add("y") + c.count; });
say("method taken off", () => { const c = new Counter(); const add = loose(c.add); return add.call(c, "x") + c.count; });
say("static", () => loose(Counter).twice("x"));
say("this parameter", () => loose(free).call({ tag: "t" }, "x") + loose(free).apply({ tag: "u" }, ["y"]) + loose(free).bind({ tag: "v" })("z") + loose(free).bind({ tag: "w" }, "b")());
say("captures are shared", () => { const add = makeAdder(10); return loose(add)("x") + add(1) + loose(add)("y") + add(2); });
say("two closures", () => { const a = makeAdder(1), b = makeAdder(2); return loose(a)("x") + loose(b)("y") + a(1) + b(1); });
''',
 'e4_beside_an_object': '''
interface P { x: number; y: number }
const makeP = (n: number): P => ({ x: n, y: n });
function both(p: P, n: number): string { p.x = p.x + 1; return typeof n + p.x + (p.y + n); }
function last(n: number, p: P): string { p.x = p.x + 1; return typeof n + p.x + (p.y + n); }
for (let i = 0; i < 50; i++) { both(makeP(i), i); last(i, makeP(i)); }
say("control", () => loose(both)(makeP(1), 1) + loose(last)(1, makeP(1)));
say("a made object, a wrong number", () => { const p = makeP(1); return loose(both)(p, "x") + p.x + loose(last)("x", p) + p.x; });
say("plain data, a wrong number", () => { const p = JSON.parse(String.fromCharCode(123) + String.fromCharCode(34) + "x" + String.fromCharCode(34) + ":1," + String.fromCharCode(34) + "y" + String.fromCharCode(34) + ":2}"); return loose(both)(p, "x") + p.x + loose(last)("x", p) + p.x; });
say("a literal, a wrong number", () => { const p: any = { x: 1, y: 2 }; return loose(both)(p, "x") + p.x + loose(last)("x", p) + p.x; });
say("no object at all", () => loose(both)(5, 1));
say("no object and a wrong number", () => loose(both)(5, "x") + loose(last)("x", 5));
say("an object that lies", () => loose(both)({ x: "s", y: "t" }, 1));
''',
 'e5_async_generators_constructors': '''
async function later(n: number): Promise<string> { return typeof n + (n + 1); }
function* gen(n: number): Generator<string> { yield typeof n; yield String(n + 1); }
class Made { v: string; constructor(n: number) { this.v = typeof n + (n + 1); } set w(n: number) { this.v = "set" + typeof n + (n + 1); } }
class Sub extends Made { constructor(n: number, public s: string) { super(n); } }
for (let i = 0; i < 50; i++) { later(i); [...gen(i)]; new Made(i).w = i; new Sub(i, "s"); }
say("control", () => [...loose(gen)(1)].join() + new (loose(Made))(1).v + new (loose(Sub))(1, "s").v);
say("generator", () => [...loose(gen)("x")].join());
say("constructor", () => new (loose(Made))("x").v);
say("constructor, instanceof", () => { const m = new (loose(Made))("x"); return (m instanceof Made) + Object.keys(m).join(); });
say("derived", () => { const s = new (loose(Sub))("x", 5); return s.v + typeof s.s + (s instanceof Sub) + (s instanceof Made); });
say("setter", () => { const m = new Made(1); loose(m).w = "x"; return m.v; });
say("Reflect.construct", () => (Reflect.construct(loose(Made), ["x"]) as any).v);
loose(later)("x").then((s: string) => console.log("async: " + s), (e: Error) => console.log("async: REJECTS " + e.constructor.name));
''',
 'e6_hosts_call': '''
const double = (n: number): number => n + n;
const shout = (s: string): string => s + "!";
const pick = (s: string, i: number): string => s + i;
const less = (a: number, b: number): number => a - b;
for (let i = 0; i < 50; i++) { double(i); shout("s"); pick("s", i); less(i, i); }
say("control", () => [1, 2].map(double).join() + ["a"].map(pick).join());
say("map", () => (["a", "b"] as any[]).map(double).join() + ([1, 2] as any[]).map(shout).join());
say("map, many", () => { const list: any[] = []; for (let i = 0; i < 25; i++) list.push(i % 2 ? i : "s" + i); return list.map(double).join(); });
say("sort", () => (["b", "a", "c"] as any[]).sort(less).join());
say("replace", () => "a-b".replace(/-/, double as any));
say("from", () => Array.from({ length: 2 }, shout as any).join());
say("forEach of a Map", () => { const out: string[] = []; new Map<any, any>([[1, 2]]).forEach(((v: string) => { out.push(shout(v as any)); }) as any); return out.join(); });
say("JSON reviver", () => JSON.stringify(JSON.parse("[1,2]", ((k: string, v: string) => (typeof v === "number" ? shout(v as any) : v)) as any)));
say("toString", () => String({ toString: double }) + `${{ toString: shout }}`);
say("valueOf", () => +({ valueOf: double } as any) + "");
''',
 'e7_kinds_of_types': '''
const u = (v: number | string): string => typeof v; const lit = (v: "a" | "b"): string => v + "!"; const big = (v: bigint): string => typeof v; const sym = (v: symbol): string => typeof v;
const bool = (v: boolean): string => typeof v + !v; const nul = (v: null): string => String(v); const und = (v: undefined): string => String(v); const nn = (v: number | null): string => String(v);
const fn = (v: () => number): string => typeof v; const arr = (v: number[]): string => typeof v + Array.isArray(v); const tup = (v: [number, string]): string => typeof v; const en = (v: 1 | 2 | 3): string => String(v + 1);
for (let i = 0; i < 50; i++) { u(i); lit("a"); big(1n); sym(Symbol.iterator); bool(true); nul(null); und(undefined); nn(i); fn(() => 1); arr([i]); tup([i, "s"]); en(1); }
say("control", () => loose(u)(1) + loose(lit)("a") + loose(big)(1n) + loose(bool)(true) + loose(nn)(null) + loose(en)(2));
say("union", () => loose(u)(true) + loose(u)(null) + loose(u)({}));
say("literal", () => loose(lit)("c") + loose(lit)(1));
say("bigint, symbol", () => loose(big)(1) + loose(sym)("s"));
say("boolean", () => loose(bool)(0) + loose(bool)("") + loose(bool)(null));
say("null, undefined", () => loose(nul)(undefined) + loose(und)(null) + loose(nn)(undefined) + loose(nn)("s"));
say("function", () => loose(fn)(1) + loose(fn)({}));
say("array, tuple", () => loose(arr)(1) + loose(arr)("s") + loose(arr)({ length: 0 }) + loose(tup)(1));
say("numbers as literals", () => loose(en)(4) + loose(en)("1") + loose(en)(1.5));
''',
 'e8_what_comes_of_it': '''
const inc = (n: number): number => n + 1;
const twice = (f: (n: number) => number, n: number): number => f(f(n));
function fact(n: number): number { return n <= 1 ? 1 : n * fact(n - 1); }
function thrower(n: number): number { if (typeof n !== "number") throw new RangeError("mine"); return n; }
function outer(n: number): string { const inner = (m: number): string => typeof n + typeof m + (n + m); return loose(inner)("i") + inner(1); }
for (let i = 0; i < 50; i++) { inc(i); twice(inc, i); fact(3); thrower(i); outer(i); }
say("control", () => loose(inc)(1) + "" + loose(twice)(inc, 1) + loose(fact)(4) + loose(outer)(1));
say("the result is no number", () => { const r: number = loose(inc)("x"); return typeof r + r; });
say("the result goes on into typed code", () => { const r = loose(inc)("x"); return typeof inc(r as number); });
say("a function value within", () => String(loose(twice)(inc, "x")));
say("recursion", () => String(loose(fact)("4")) + loose(fact)("x"));
say("its own throw", () => loose(thrower)("x"));
say("nested", () => loose(outer)("o"));
say("where it threw", () => { try { loose(thrower)("x"); return "no"; } catch (e) { return String((e as Error).stack).split(String.fromCharCode(10)).slice(0, 2).map((l) => l.replace(/[(@].*[/]/, "@")).join("|"); } });
''',
}
for name, body in ROWS.items():
    open(name + '.ts', 'w').write(PRE + body.lstrip('\n') + 'export {}\n')
