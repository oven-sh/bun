#!/usr/bin/env python3
"""copy-of-narrower-object.py <folder>: A copy made with a spread has the room of the type it is written as, also where the layout of its source at run time is narrower than that type. One road a program, because types that rows share change what is laid out. Each line is `<row>: <what plain Bun shows>`, or `<row>: TypeError`."""
import os, re, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
HEAD = '''declare const console: { log(...values: any[]): void };
export { };
function show(o: unknown): string { return JSON.stringify(o) + " [" + Object.keys(o as object).join() + "]"; }
function row(name: string, f: () => unknown): void { let said: string; try { said = String(f()); } catch (e) { said = (e as Error).name; } console.log(name + ": " + said); }
type Failures = { last: number | null; count: number };
type Fresh = { last: null; count: number };
function fresh(): Fresh { return { last: null, count: 0 }; }
function used(): Failures { return { last: 5, count: 2 }; }
'''
R = {
# (1) a store that comes LATER than the literal
'a01_a_store_in_the_next_statement': 'function bump(f: Failures, n: number): Failures { const c: Failures = { ...f }; c.last = n; return c; }\nrow("fresh", () => show(bump(fresh(), 7))); row("used", () => show(bump(used(), 7)));',
'a02_a_store_in_another_function': 'function put(c: Failures, n: number): void { c.last = n; }\nfunction bump(f: Failures, n: number): Failures { const c: Failures = { ...f }; put(c, n); return c; }\nrow("fresh", () => show(bump(fresh(), 7))); row("used", () => show(bump(used(), 7)));',
'a03_a_store_through_an_array': 'function bump(f: Failures, n: number): Failures[] { const all: Failures[] = [{ ...f }]; all[0]!.last = n; return all; }\nrow("fresh", () => show(bump(fresh(), 7))); row("used", () => show(bump(used(), 7)));',
'a04_object_assign_on_the_copy': 'function bump(f: Failures, n: number): Failures { return Object.assign({ ...f }, { last: n }); }\nrow("fresh", () => show(bump(fresh(), 7))); row("used", () => show(bump(used(), 7)));',
'a05_a_generic_copy': 'function clone<T extends object>(x: T): T { return { ...x }; }\nfunction bump(f: Failures, n: number): Failures { const c = clone<Failures>(f); c.last = n; return c; }\nrow("fresh", () => show(bump(fresh(), 7))); row("used", () => show(bump(used(), 7)));',
'a06_a_spread_that_may_be_empty': 'function bump(f: Failures, n: number): Failures { return { ...f, ...(n > 0 ? { last: n } : {}) }; }\nrow("fresh 7", () => show(bump(fresh(), 7))); row("fresh 0", () => show(bump(fresh(), 0))); row("used", () => show(bump(used(), 7)));',
'a07_a_computed_key': 'function bump(f: Failures, k: "last" | "count", n: number): Failures { return { ...f, [k]: n }; }\nrow("fresh last", () => show(bump(fresh(), ("la" + "st") as "last", 7))); row("fresh count", () => show(bump(fresh(), ("cou" + "nt") as "count", 7)));',
'a08_nested': 'type Outer = { name: string; inner: Failures };\nfunction bump(o: Outer, n: number): Outer { return { ...o, inner: { ...o.inner, last: n } }; }\nrow("fresh", () => show(bump({ name: "o", inner: fresh() }, 7))); row("used", () => show(bump({ name: "o", inner: used() }, 7)));',
'a09_two_spreads': 'function both(a: Failures, b: Failures): Failures { return { ...a, ...b }; }\nrow("fresh used", () => show(both(fresh(), used()))); row("used fresh", () => show(both(used(), fresh()))); row("fresh fresh", () => show(both(fresh(), fresh())));',
'a10_a_union_as_the_source': 'function bump(f: Fresh | Failures, n: number): Failures { return { ...f, last: n }; }\nrow("fresh", () => show(bump(fresh(), 7))); row("used", () => show(bump(used(), 7)));',
'a11_as_const': 'const Z = { last: null, count: 0 } as const;\nfunction bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("as const", () => show(bump({ ...Z }, 7))); row("straight", () => { const c: Failures = { ...Z, last: 3 }; return show(c); });',
'a12_optional': 'type Wide = { last?: number; count: number }; type Narrow = { last?: undefined; count: number };\nfunction narrow(): Narrow { return { count: 1 }; }\nfunction bump(f: Wide, n: number): Wide { return { ...f, last: n }; }\nrow("narrow", () => show(bump(narrow(), 7))); row("wide", () => show(bump({ last: 1, count: 2 }, 7)));',
'a13_compound': 'function bump(f: Failures): Failures { const c: Failures = { ...f }; c.count += 1; c.last ??= 4; return c; }\nrow("fresh", () => show(bump(fresh()))); row("used", () => show(bump(used())));',
'a14_in_a_loop': 'function run(n: number): Failures { let f: Failures = fresh(); for (let i = 0; i < n; ++i) f = { ...f, last: i, count: f.count + 1 }; return f; }\nrow("0", () => show(run(0))); row("1", () => show(run(1))); row("5", () => show(run(5)));',
'a15_in_try': 'function bump(f: Failures, n: number): string { try { return show({ ...f, last: n } as Failures); } catch { return "went another way"; } }\nrow("fresh", () => bump(fresh(), 7)); row("used", () => bump(used(), 7));',
'a16_the_rest_of_a_destructuring': 'function bump(f: Failures, n: number): { last: number | null } { const { count, ...rest } = f; return { ...rest, last: n + count }; }\nrow("fresh", () => show(bump(fresh(), 7))); row("used", () => show(bump(used(), 7)));',
'a17_a_field_of_a_class': 'class Holder { f: Failures = fresh(); set(n: number): void { this.f = { ...this.f, last: n }; } }\nrow("once", () => { const h = new Holder(); h.set(7); return show(h.f); }); row("twice", () => { const h = new Holder(); h.set(7); h.set(8); return show(h.f); });',
'a18_narrow_in_the_literal_wide_later': 'function bump(f: Failures, n: number): Failures { const c: Failures = { ...f, last: null }; c.last = n; return c; }\nrow("fresh", () => show(bump(fresh(), 7))); row("used", () => show(bump(used(), 7)));',
'a19_a_number_field_takes_a_text': 'type Wide = { v: string | number; w: number }; type Narrow = { v: number; w: number };\nfunction narrow(): Narrow { return { v: 1.5, w: 2 }; }\nfunction put(f: Wide, s: string): Wide { return { ...f, v: s }; }\nrow("narrow", () => show(put(narrow(), "text"))); row("later", () => { const c: Wide = { ...(narrow() as Wide) }; c.v = "later"; return show(c); });',
'a20_true_takes_false': 'type Wide = { ok: boolean; n: number }; type Narrow = { ok: true; n: number };\nfunction narrow(): Narrow { return { ok: true, n: 1 }; }\nfunction put(f: Wide, b: boolean): Wide { return { ...f, ok: b }; }\nrow("narrow", () => show(put(narrow(), false)));',
'a21_a_discriminant': 'type A = { kind: "a"; n: number }; type Either = { kind: "a" | "b"; n: number };\nfunction a(): A { return { kind: "a", n: 1 }; }\nfunction put(f: Either, k: "a" | "b"): Either { return { ...f, kind: k }; }\nrow("a to b", () => show(put(a(), ("" + "b") as "b")));',
'a22_a_field_that_holds_an_object': 'type Narrow = { inner: { x: number }; n: number }; type Wide = { inner: { x: number; y?: number } | null; n: number };\nfunction narrow(): Narrow { return { inner: { x: 1 }, n: 1 }; }\nfunction put(f: Wide): Wide[] { return [{ ...f, inner: { x: 2, y: 3 } }, { ...f, inner: null }]; }\nrow("narrow", () => show(put(narrow())));',
'a23_an_empty_array': 'type Narrow = { xs: never[]; n: number }; type Wide = { xs: number[]; n: number };\nfunction narrow(): Narrow { return { xs: [], n: 1 }; }\nfunction put(f: Wide): Wide { return { ...f, xs: [1, 2] }; }\nrow("narrow", () => show(put(narrow())));',
'a24_the_copy_is_read_as_the_narrow_type': 'function same(f: Fresh): Fresh { return { ...f }; }\nfunction bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("narrow stays", () => show(same(fresh()))); row("then wide", () => show(bump(same(fresh()), 7))); row("the source is as it was", () => { const s = fresh(); bump(s, 7); return show(s); });',
# (2) what plain Bun shows of a copy that is now ordinary
'b01_the_store_ahead_of_the_spread': 'function bump(f: Partial<Failures>, n: number): Failures { return { last: n, count: -1, ...f }; }\nrow("fresh", () => show(bump(fresh(), 7))); row("used", () => show(bump(used(), 7))); row("empty", () => show(bump({}, 7)));',
'b02_extra_members': 'const more = { last: null, count: 0, extra: "e" };\nfunction bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("more", () => show(bump(more, 7))); row("more, null again", () => show(bump(more, 0).last === 0 ? bump(more, 1) : 0));',
'b03_a_frozen_source': 'function bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("frozen", () => { const c = bump(Object.freeze(fresh()), 7); c.count = 9; return show(c) + Object.isFrozen(c); }); row("sealed", () => { const c = bump(Object.seal(fresh()), 7); return show(c) + Object.isSealed(c) + Object.isExtensible(c); });',
'b04_symbols': 'const S = Symbol("s");\nfunction bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("symbol", () => { const s = Object.assign(fresh(), { [S]: 1 }); const c = bump(s, 7); return show(c) + Object.getOwnPropertySymbols(c).length + String((c as any)[S]); });',
'b05_descriptors': 'function bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("descriptors", () => JSON.stringify(Object.getOwnPropertyDescriptors(bump(fresh(), 7))));',
'b06_not_enumerable': 'function bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("hidden", () => { const s = fresh(); Object.defineProperty(s, "hidden", { value: 1, enumerable: false }); const c = bump(s, 7); return show(c) + ("hidden" in c); });',
'b07_a_member_deleted_from_the_source': 'function bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("deleted", () => { const s = fresh(); delete (s as any).count; return show(bump(s, 7)); });',
'b08_an_object_of_a_class': 'class K { last: null = null; count = 0; m(): number { return 1; } }\nfunction bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("class", () => { const c = bump(new K(), 7); return show(c) + (c instanceof K) + (Object.getPrototypeOf(c) === Object.prototype) + ("m" in c); });',
'b09_parsed_json': 'function bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("json", () => show(bump(JSON.parse(\'{"zzz":1,"last":null,"count":0,"2":"two","1":"one"}\') as Failures, 7)));',
'b10_no_prototype': 'function bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("null prototype", () => { const c = bump(Object.assign(Object.create(null), fresh()) as Failures, 7); return show(c) + (Object.getPrototypeOf(c) === Object.prototype); });',
'b11_a_proxy': 'function bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("proxy", () => { const log: string[] = []; const p = new Proxy(fresh(), { ownKeys(t) { log.push("keys"); return Reflect.ownKeys(t); }, get(t, k) { log.push("get " + String(k)); return Reflect.get(t, k); }, getOwnPropertyDescriptor(t, k) { log.push("desc " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } }); return show(bump(p, 7)) + log.join(); });',
'b12_a_getter_on_the_source': 'function bump(f: Failures, n: number): Failures { return { ...f, count: n }; }\nrow("getter", () => { let asked = 0; const s = fresh(); Object.defineProperty(s, "last", { get() { ++asked; return null; }, enumerable: true, configurable: true }); const c = bump(s, 7); return show(c) + asked + JSON.stringify(Object.getOwnPropertyDescriptor(c, "last")); });',
'b13_null_and_undefined_sources': 'function bump(f: Failures | null | undefined, n: number): Partial<Failures> { return { ...f, last: n }; }\nrow("null", () => show(bump(null, 7))); row("undefined", () => show(bump(undefined, 7))); row("fresh", () => show(bump(fresh(), 7)));',
'b14_the_copy_is_its_own_object': 'function bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("own", () => { const s = fresh(); const c = bump(s, 7); c.count = 5; return show(s) + show(c) + (s === (c as unknown)); });',
'b15_many_copies_under_the_collector': 'function bump(f: Failures, n: number): Failures { return { ...f, last: n }; }\nrow("many", () => { let t = 0; const kept: Failures[] = []; for (let i = 0; i < 20000; ++i) { const c = bump(i % 3 ? fresh() : used(), i); if (i % 997 === 0) kept.push(c); t = (t + (c.last ?? 0) + c.count) % 1000003; } return t + show(kept.slice(0, 3)); });',
}
X = {
'c01_jsx_classic': '''/* @jsx h */
/* @jsxRuntime classic */
declare const console: { log(...values: any[]): void };
export { };
type Failures = { last: number | null; count: number };
type Fresh = { last: null; count: number };
function fresh(): Fresh { return { last: null, count: 0 }; }
function used(): Failures { return { last: 5, count: 2 }; }
function h(tag: (p: Failures) => string, props: Failures): string { return tag(props); }
declare global { namespace JSX { type Element = string; interface IntrinsicElements { [name: string]: any } } }
function Box(p: Failures): string { return JSON.stringify(p) + " [" + Object.keys(p).join() + "]"; }
function row(name: string, f: () => unknown): void { let said: string; try { said = String(f()); } catch (e) { said = (e as Error).name; } console.log(name + ": " + said); }
function render(f: Failures, n: number): string { return <Box {...f} last={n} />; }
function two(f: Failures, g: Failures): string { return <Box {...f} {...g} />; }
row("fresh", () => render(fresh(), 7)); row("used", () => render(used(), 7)); row("two", () => two(fresh(), used())); row("two the other way", () => two(used(), fresh()));
''',
}
for f in os.listdir('.'):
    if re.match(r'^[abc]\d\d_.*\.tsx?$', f): os.remove(f)
for k, v in R.items(): open(k + '.ts', 'w').write('// ' + k[4:].replace('_', ' ') + '\n' + HEAD + v + '\n')
for k, v in X.items(): open(k + '.tsx', 'w').write(v)
print(len(R), 'programs +', len(X), 'with JSX')
