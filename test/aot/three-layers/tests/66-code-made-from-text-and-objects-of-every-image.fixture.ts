import { check } from "../src/show";
import { codeFromText, makeTheirs, Theirs } from "fake-merge";
import { codeFromTextInTheMiddle, makers, odd, Settings, sources, Wide, type Maker } from "../src/settings";
const F = "66";
class Mine { a?: number; b?: string; mode: "on" | "off" = "on"; n = 66; constructor(i = 0) { if (i & 1) this.a = i; } get twice() { return this.n * 2; } m() { return this.n; } }
const mine: Record<string, Maker> = { myLiteral: i => ({ a: i, b: "s", n: 1.5, flag: true, c: { x: i } }), myOptional: i => (i & 1 ? { a: i, n: 2 } : { n: 3 }), mine: i => new Mine(i), mySubclass: i => new (class extends Settings { own = i })(i), theirs: makeTheirs, theirClass: i => new Theirs(i) };
const all = Object.entries({ ...makers, ...sources, ...odd, ...mine });
const attempt = (body: () => unknown) => { try { return body(); } catch (error: any) { return "threw " + error.constructor.name; } };
// Code that is made from text at run time is interpreted. One site of it sees objects of the three images, the same kind many times and all kinds in turn.
for (const [where, make] of [["the package", codeFromText], ["the application", codeFromTextInTheMiddle], ["the test file", (parameters: string[], body: string) => new Function(...parameters, body)]] as const) {
  const read = make(["o"], "return [o.a, o.b, o.n, o.c, o.flag, o.mode, o.list, o.nothing, o.f0, o.h0, o.k1, o.late, o.twice, typeof o.m, typeof o.call];");
  const readDeep = make(["o"], "return [o.c && o.c.x, o.nested && o.nested.p, o.c?.z, o.i4, o.i5 && o.i5[0]];");
  const byKey = make(["o", "keys"], "return keys.map(k => o[k]);");
  const has = make(["o"], "return ['a' in o, 'b' in o, 'nothing' in o, 'toString' in o, Object.hasOwn(o, 'n'), o.hasOwnProperty('c')];");
  const write = make(["o", "v"], "o.a = v; o.n = v; o.fresh = v; o.b = 'text'; return [o.a, o.n, o.fresh, o.b, Object.keys(o).length];");
  const remove = make(["o"], "const before = Object.keys(o).length; delete o.a; delete o.nothing; return [before, Object.keys(o).length, o.a];");
  const list = make(["o"], "const names = []; for (const k in o) names.push(k); return [names, Object.keys(o), Object.values(o).length, JSON.stringify(o)];");
  const call = make(["o"], "return [o.m ? o.m() : 0, o.call ? o.call() : 0, o.method ? o.method() : 0];");
  const copy = make(["o"], "return [{ ...o }, Object.assign({ first: 1 }, o)];");
  const kinds = make(["o", "classes"], "return classes.map(C => o instanceof C);");
  const each = (body: (object: any, i: number) => unknown) => [1, 2, 3].map(i => all.map(([, maker]) => attempt(() => body(maker(i), i))));
  check(F, `reads in ${where}`, () => each(o => read(o)));
  check(F, `reads of what lies deeper in ${where}`, () => each(o => readDeep(o)));
  check(F, `one kind many times in ${where}`, () => all.map(([, maker]) => { let last: unknown; for (let i = 0; i < 40; i++) last = attempt(() => read(maker(3))); return last; }));
  check(F, `reads by key in ${where}`, () => each(o => byKey(o, ["a", "n", "c", "nothing", 0, "k0", "m3", "length"])));
  check(F, `presence in ${where}`, () => each(o => has(o)));
  check(F, `stores in ${where}`, () => each((o, i) => [write(o, i), write(o, "other type"), o]));
  check(F, `deletions in ${where}`, () => each(o => [remove(o), o]));
  check(F, `lists of names in ${where}`, () => each(o => list(o)));
  check(F, `calls in ${where}`, () => each(o => call(o)));
  check(F, `copies in ${where}`, () => each(o => copy(o)));
  check(F, `instanceof in ${where}`, () => each(o => kinds(o, [Settings, Wide, Mine, Theirs, Object, Array])));
  check(F, `what such code makes in ${where}`, () => make(["i"], "const k = i * 2, f = () => k; return [[i, k, 'x'], { a: i, b: [k] }, f(), 'left ' + i + ' right', new Promise(() => {}) instanceof Promise, [i].concat([k]).map(x => x + 1)];")(21));
}
