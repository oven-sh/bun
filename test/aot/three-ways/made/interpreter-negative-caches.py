#!/usr/bin/env python3
"""interpreter-negative-caches.py <folder>: ONE CASE A FOLDER: in code made at run time the interpreter remembers the place of a typed field, and that a field is absent or that no such object has the name: one interpreted site a question, WARMED on the answer "undefined", and then the answer is made another in every way a program has: the optional field stored (typed code, any, by key, Object.assign, defineProperty, the interpreter itself), an extra of that name, deleted again, another object of the same type that has it, a subclass, an heir, a proxy, a plain object of the same names, null-prototype, primitives; getters and methods on the class; names of Object.prototype."""
import os, sys
out = sys.argv[1]
S = '''declare const console: { log(...v: unknown[]): void };
interface Row { a: number; b: string; maybe?: number; other?: Row | null; tag?: "x" | "y"; flag?: boolean; text?: string }
class Kept { a = 1; b = "b"; maybe?: number; other?: Kept | null; get got(): string { return "got"; } method(): number { return 1; } }
class Sub extends Kept { more = 5; nothing2 = "of the subclass"; }
const show = (v: unknown): string => typeof v === "function" ? "function" : typeof v === "object" && v !== null ? "object" : typeof v === "string" ? JSON.stringify(v) : String(v);
const NAMES = ["maybe", "other", "tag", "flag", "text", "nothing", "nothing2", "got", "method", "more", "a", "b", "toString", "constructor", "__proto__", "hasOwnProperty", "valueOf", "length", "0"];
const readers: Record<string, (o: unknown) => unknown> = Object.create(null); for (const n of NAMES) readers["r " + n] = new Function("o", "return o." + (/^[0-9]/.test(n) ? "a, o[" + n + "]" : n) + ";") as (o: unknown) => unknown;
const tests: Record<string, (o: unknown) => unknown> = Object.create(null); for (const n of NAMES) tests["r " + n] = new Function("o", "return o" + (/^[0-9]/.test(n) ? "[" + n + "]" : "." + n) + " !== undefined ? 'there' : 'not there';") as (o: unknown) => unknown;
const storers: Record<string, (o: unknown, v: unknown) => void> = {}; for (const n of ["maybe", "other", "tag", "flag", "text", "nothing"]) storers[n] = new Function("o", "v", "o." + n + " = v;") as (o: unknown, v: unknown) => void;
const all = (o: unknown): string => NAMES.map(n => { try { return n + "=" + show(readers["r " + n]!(o)) + "/" + tests["r " + n]!(o); } catch (e) { return n + "!" + (e as Error).name; } }).join(" ");
const literal = (): Row => ({ a: 1, b: "b" });
for (let i = 0; i < 400; i++) { all(literal()); all(new Kept()); }
const attempt = (name: string, make: () => unknown): void => { let o: unknown; try { o = make(); } catch (e) { console.log(name + ": THE CHANGE IS REFUSED: " + (e as Error).message.slice(0, 60)); return; } console.log(name + ": " + all(o)); console.log(name + ", a fresh one behind it: " + all(literal()).length + " " + all(new Kept()).length); };
attempt("a literal", literal); attempt("a class", () => new Kept()); attempt("a subclass", () => new Sub());
attempt("stored by typed code", () => { const o = literal(); o.maybe = 5; o.tag = "x"; o.flag = false; o.text = ""; o.other = null; return o; });
attempt("stored undefined", () => { const o = literal(); o.maybe = undefined; return o; });
attempt("born with it", (): Row => ({ a: 1, b: "b", maybe: 0, other: { a: 2, b: "in" }, tag: "y", flag: true, text: "t" }));
attempt("stored through any", () => { const o: any = literal(); o.maybe = 6; o.other = literal(); return o; });
attempt("stored by key", () => { const o: any = literal(); for (const k of ["maybe", "flag"]) o[k] = k === "maybe" ? 7 : true; return o; });
attempt("stored by the interpreter", () => { const o = literal(); storers.maybe!(o, 8); storers.tag!(o, "y"); storers.text!(o, "s"); storers.other!(o, literal()); return o; });
attempt("a wrong value by the interpreter", () => { const o = literal(); storers.maybe!(o, "wrong"); return o; });
attempt("an extra by the interpreter", () => { const o = literal(); storers.nothing!(o, "an extra"); return o; });
attempt("an extra through any", () => { const o: any = literal(); o.nothing = "an extra"; o.nothing2 = 2; return o; });
attempt("an extra on a class instance", () => { const o: any = new Kept(); o.nothing = "an extra"; return o; });
attempt("an extra index", () => { const o: any = literal(); o[0] = "zero"; return o; });
attempt("assigned", () => Object.assign(literal(), { maybe: 9, nothing: "assigned" }));
attempt("defined", () => Object.defineProperty(literal(), "maybe", { value: 10, enumerable: true, writable: true, configurable: true }));
attempt("defined as a getter", () => Object.defineProperty(literal(), "nothing", { get() { return "by a getter"; }, configurable: true }));
attempt("stored and deleted", () => { const o = literal(); o.maybe = 5; delete o.maybe; return o; });
attempt("an extra stored and deleted", () => { const o: any = literal(); o.nothing = 1; delete o.nothing; return o; });
attempt("frozen", () => Object.freeze(literal())); attempt("an heir", () => Object.create(Object.assign(literal(), { maybe: 11 }))); attempt("an heir with its own", () => Object.assign(Object.create(literal()), { nothing: "own" }));
attempt("a proxy", () => new Proxy(literal(), { get(t: any, k) { return k === "nothing" ? "from the trap" : t[k]; } }));
attempt("another prototype", () => Object.setPrototypeOf(literal(), { nothing: "inherited", maybe: 12 }));
attempt("a plain object of the same names", () => JSON.parse('{"a":1,"b":"b","nothing":"plain"}')); attempt("no prototype", () => Object.assign(Object.create(null), { a: 1 }));
attempt("a string", () => "str"); attempt("a number", () => 5); attempt("an array", () => ["zero"]); attempt("a function", () => function f() {}); attempt("null", () => null); attempt("undefined", () => undefined);
attempt("a literal again", literal); attempt("a class again", () => new Kept());
'''
os.makedirs(out + "/interpreter-negative-caches", exist_ok=True); open(out + "/interpreter-negative-caches/main.ts", "w").write(S)
print("1 program")
