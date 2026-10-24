interface T { n: number; i: number; s: string; b: boolean; o?: number; u: number | string; nul: string | null; inner: { v: number } }
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
class Box { count = 0; label = "l"; #hidden = 1; method() { return "m" + this.#hidden; } get got() { return this.count + 1; } set got(v: number) { this.count = v * 2; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => (v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "number" && (v !== v || Object.is(v, -0)) ? "number " + (Object.is(v, -0) ? "-0" : "NaN") : v)); } catch (e) { out = "THROWN " + (e as Error).name; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const make = (): T => ({ n: 1.5, i: 1, s: "s", b: true, u: 1, nul: null, inner: { v: 1 } });
const fn = (...text: string[]) => new Function(...text) as (...args: any[]) => any;
const readAll = fn("o", "return [o.n, o.i, o.s, o.b, o.o, o.u, o.nul, o.inner && o.inner.v, o.missing, typeof o.toString, typeof o.constructor, typeof o.hasOwnProperty]");
const readMany = fn("o", "var t = 0; for (var k = 0; k < 60; k++) t += o.n + o.i + o.s.length + (o.o === undefined ? 0 : o.o); return t");
const write = fn("o", "n", "s", "o.n = n; o.i = n; o.s = s; o.b = !o.b; o.u = s; o.nul = s; return o");
const writeMany = fn("o", "for (var k = 0; k < 60; k++) { o.n = k + 0.5; o.i = k; o.s = 's' + k; o.u = k & 1 ? k : 'u' + k; } return o");
const writeOne = fn("o", "k", "v", "'use strict'; switch (k) { case 'n': o.n = v; break; case 's': o.s = v; break; case 'o': o.o = v; break; case 'inner': o.inner = v; break; case 'extra': o.extra = v; break; case 'kind': o.kind = v; break; case 'r': o.r = v; break; case 'count': o.count = v; break; case 'got': o.got = v; break; } return true");
const check = fn("o", "return typeof o === 'object' && o !== null && typeof o.n === 'number' && typeof o.s === 'string' && typeof o.b === 'boolean' && (o.o === undefined || typeof o.o === 'number')");
const text = fn("o", "return '{\"n\":' + o.n + ',\"s\":\"' + o.s + '\",\"b\":' + o.b + '}'");
const literal = fn("o", "return { n: o.n, s: o.s, ...o }");
const destructured = fn("o", "var { n, s, o: opt = 'default', missing = 'none', ...rest } = o; return [n, s, opt, missing, Object.keys(rest).join()]");
const called = fn("o", "return [o.method(), o.got, o.count, o.label]");
const tried = (f: () => unknown) => { try { return f(); } catch (e) { return (e as Error).name; } };
show("reads", () => readAll(make()));
show("reads, many at one place", () => [readMany(make()), readMany({ ...make(), o: 2 } as T)]);
show("objects of one type in turn: an optional field there and not", () => { const list: T[] = [make(), { ...make(), o: 5 }, make()]; delete list[1].o; list[2].o = undefined; return list.map(x => readAll(x)); });
show("typed and plain in turn at one place", () => [make(), JSON.parse(JSON.stringify(make())), make(), JSON.parse("{}"), new Box(), make()].map(x => readAll(x)));
show("writes, and what typed code then reads", () => { const x = make(); write(x, 2.5, "t"); return [x, x.n + 1, x.s.length, typeof x.u]; });
show("writes, many at one place", () => { const x = make(); writeMany(x); return [x, x.i * 2]; });
show("numbers at the edges", () => [2147483648, -2147483649, -0, NaN, 1e300, 0.1].map(v => { const x = make(); writeOne(x, "n", v); return x.n; }));
show("an optional field: set, undefined, set again", () => { const x = make(); const out: unknown[] = []; for (const v of [1, undefined, 2]) { writeOne(x, "o", v); out.push(x.o, Object.keys(x).join()); } return out; });
show("an object into a field, an extra", () => { const x = make(); writeOne(x, "inner", JSON.parse('{"v":9}')); writeOne(x, "extra", 1); return [x, x.inner.v, Object.keys(x).join(), readAll(x)]; });
show("frozen, sealed, closed", () => [Object.freeze, Object.seal, Object.preventExtensions].map(f => { const x = f(make()) as T; return [tried(() => writeOne(x, "n", 9.5)), tried(() => writeOne(x, "extra", 1)), x.n, readAll(x)]; }));
show("with extras", () => { const x = make(); hide(x).missing = "now here"; return [readAll(x), tried(() => writeOne(x, "n", 3.5)), x.n]; });
show("another prototype: what it has, and a setter of a field's name", () => { const log: unknown[] = []; const proto = Object.defineProperty(JSON.parse('{"missing":"above"}'), "o", { set(v) { log.push(v); }, get() { return "from above"; }, configurable: true }); const x = Object.setPrototypeOf(hide(make()), proto); return [readAll(x), writeOne(x, "o", 1), log, writeOne(x, "n", 4.5), x.n, Object.keys(x).join()]; });
show("an instance: a method, an accessor, fields", () => { const x = new Box(); const out = [called(x)]; writeOne(x, "count", 3); out.push(called(x)); writeOne(x, "got", 4); out.push(called(x)); return out; });
show("a discriminant stays, its neighbor changes", () => { const x: Shape = { kind: "circle", r: 1 }; return [tried(() => writeOne(x, "kind", "circle")), tried(() => writeOne(x, "r", 2.5)), x]; });
show("a validator and a serializer", () => [check(make()), check({ ...make(), o: 1 } as T), text(make())]);
show("a literal with a spread, a pattern with a rest", () => [literal(make()), destructured(make()), destructured({ ...make(), o: 7 } as T)]);
show("not objects", () => [1, "ab", true].map(v => tried(() => readAll(v))).concat([null, undefined].map(v => tried(() => readAll(v)))));
