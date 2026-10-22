// `JSON.parse(text) as Rec` passes any object, and a field that holds another kind than `Rec` writes throws a TypeError at its first typed read: a read through the value of the cast, in the function where the cast stands, wherever the result would go. A type that the checker has only inferred decides nothing: a closure that captures the unannotated `r`, a default of a parameter, a class field and a spread copy read what is there, and the places they fill hold whatever the language makes of it.
type Rec = { a: number; b: string };
const one = (x: unknown): string => x === undefined ? "<undefined>" : x === null ? "<null>" : typeof x === "number" ? (x !== x ? "<NaN>" : String(x)) + ":number" : typeof x === "string" ? JSON.stringify(x) : typeof x === "object" ? JSON.stringify(x) : String(x);
const say = (label: string, f: () => unknown): void => { let r: string; try { r = one(f()); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); };
const text = '{"a":"1","b":"x"}';
say("read", () => { const r = JSON.parse(text) as Rec; return r.a; });
say("a const", () => { const r = JSON.parse(text) as Rec; const v = r.a; return v; });
say("a let", () => { const r = JSON.parse(text) as Rec; let v = r.a; return v; });
say("a let stored to later", () => { const r = JSON.parse(text) as Rec; let v = 0; v = r.a; return v; });
say("a sum", () => { const r = JSON.parse(text) as Rec; return r.a + 1; });
say("a sum in a const", () => { const r = JSON.parse(text) as Rec; const v = r.a + 1; return v; });
say("s += in a let that begins at 0", () => { const r = JSON.parse(text) as Rec; let s = 0; s += r.a; return s; });
say("s = s + in a let that begins at 0", () => { const r = JSON.parse(text) as Rec; let s = 0; s = s + r.a; return s; });
say("s += in a loop", () => { const r = JSON.parse(text) as Rec; let s = 0; for (let i = 0; i < 3; i++) s += r.a; return s; });
say("s -= (a number whatever comes)", () => { const r = JSON.parse(text) as Rec; let s = 0; s -= r.a; return s; });
say("a pattern", () => { const { a } = JSON.parse(text) as Rec; return a; });
say("a pattern, then a sum", () => { const { a } = JSON.parse(text) as Rec; return a + 1; });
say("a literal's field", () => { const r = JSON.parse(text) as Rec; const o = { v: r.a }; return o.v; });
say("a literal's field, listed", () => { const r = JSON.parse(text) as Rec; const o = { v: r.a }; return JSON.stringify(o); });
say("an array literal", () => { const r = JSON.parse(text) as Rec; const l = [r.a]; return l[0]; });
say("an array literal beside a number", () => { const r = JSON.parse(text) as Rec; const l = [1, r.a]; return l[1]; });
say("pushed on an inferred number[]", () => { const r = JSON.parse(text) as Rec; const l = [1]; l.push(r.a); return l[1]; });
say("the result of an arrow without a written type", () => { const r = JSON.parse(text) as Rec; const f = () => r.a; return f(); });
say("the result of a function without a written type", () => { const r = JSON.parse(text) as Rec; function f() { return r.a; } return f(); });
say("an argument of a generic function", () => { const r = JSON.parse(text) as Rec; const same = <T,>(x: T): T => x; return same(r.a); });
say("a default of a parameter", () => { const r = JSON.parse(text) as Rec; const f = (x = r.a) => x; return f(); });
say("a conditional", () => { const r = JSON.parse(text) as Rec; const v = r.b ? r.a : 0; return v; });
say("??", () => { const r = JSON.parse(text) as Rec; const v = r.a ?? 0; return v; });
say("a spread copy", () => { const r = JSON.parse(text) as Rec; const c = { ...r }; return c.a; });
say("a class field without a written type", () => { const r = JSON.parse(text) as Rec; class C { v = r.a; } return new C().v; });
say("a Map's value, inferred", () => { const r = JSON.parse(text) as Rec; const m = new Map([["k", r.a]]); return m.get("k"); });
say("captured and stored by a closure", () => { const r = JSON.parse(text) as Rec; let v = 0; const set = () => { v = r.a; }; set(); return v; });
say("a template", () => { const r = JSON.parse(text) as Rec; return `${r.a}!`; });
say("compared", () => { const r = JSON.parse(text) as Rec; return [r.a === 1, r.a == 1, r.a < 2]; });
say("Math.max", () => { const r = JSON.parse(text) as Rec; return Math.max(r.a, 0); });
say("toFixed", () => { const r = JSON.parse(text) as Rec; return r.a.toFixed(1); });
say("a loop in a function that is called where it is written", () => { const r = JSON.parse(text) as Rec; return (() => { let s = 0; for (let i = 0; i < 3; i++) s += r.a; return s; })(); });
say("s = r.a + s", () => { const r = JSON.parse(text) as Rec; let s = 0; s = r.a + s; return s; });
say("s = s * 1 + r.a", () => { const r = JSON.parse(text) as Rec; let s = 0; s = s * 1 + r.a; return s; });
say("a let stored to in a branch", () => { const r = JSON.parse(text) as Rec; let v = 0; if (r.b) v = r.a; return v; });
say("a var", () => { const r = JSON.parse(text) as Rec; var v = 0; v = r.a; return v; });
say("two lets in a chain", () => { const r = JSON.parse(text) as Rec; let v = 0, w = 0; v = r.a; w = v; return w; });
say("a let of strings given a number", () => { const r = JSON.parse('{"a":1,"b":2}') as Rec; let t = ""; t = r.b; return t; });
say("a let of booleans", () => { const r = JSON.parse('{"ok":"no"}') as { ok: boolean }; let ok = false; ok = r.ok; return ok; });
say("a default that is a sum", () => { const r = JSON.parse(text) as Rec; const f = (x = r.a + 1) => x; return f(); });
say("a counter that stays a number", () => { const r = JSON.parse(text) as Rec; let n = 0; for (let i = 0; i < 3; i++) n += i; return [n, r.a]; });
const later: [string, () => Promise<unknown>][] = [
  ["a function called where it is written, under a written Promise<unknown>", async (): Promise<unknown> => { const r = JSON.parse(text) as Rec; return (() => r.a)(); }],
  ["the same with a sum in a let", async (): Promise<unknown> => { const r = JSON.parse(text) as Rec; return (() => { let s = 0; s += r.a; return s; })(); }],
  ["the same with a loop", async (): Promise<unknown> => { const r = JSON.parse(text) as Rec; return (() => { let s = 0; for (let i = 0; i < 3; i++) s += r.a; return s; })(); }],
];
for (const [label, f] of later) { let r: string; try { r = one(await f()); } catch (e) { r = "throws " + (e as Error).constructor.name; } console.log(label + " ==> " + r); }
