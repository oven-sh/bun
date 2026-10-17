import { isDeepStrictEqual } from "node:util";
import { deepEqual, deepStrictEqual } from "node:assert";
interface T { a?: number; b: number; c?: string; d?: number }
function hide(value: unknown): any { return value; }
const plain = (...entries: [string | symbol, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of entries) o[k] = v; return o; };
const how: Record<string, (x: object) => object> = { frozen: Object.freeze, sealed: Object.seal, closed: Object.preventExtensions, open: x => x };
const withExtra = (value: T, ...extras: [string | symbol, unknown][]): T => { for (const [k, v] of extras) hide(value)[k] = v; return value; };
const ok = (f: () => void) => { try { f(); return "T"; } catch { return "f"; } };
const say = (b: boolean) => (b ? "T" : "f");
const safe = (f: () => unknown) => { try { return f(); } catch (e) { return (e as Error).name; } };
function row(name: string, l: unknown, r: unknown) {
  console.log("ROW", name + ":", say(Bun.deepEquals(l, r)) + say(Bun.deepEquals(r, l)), say(Bun.deepEquals(l, r, true)) + say(Bun.deepEquals(r, l, true)), say(isDeepStrictEqual(l, r)) + say(isDeepStrictEqual(r, l)), ok(() => deepEqual(l, r)) + ok(() => deepEqual(r, l)), ok(() => deepStrictEqual(l, r)) + ok(() => deepStrictEqual(r, l)), safe(() => JSON.stringify(l)), safe(() => JSON.stringify(l, null, 1).length), safe(() => JSON.stringify([new Date(0), l]).length), safe(() => Object.keys(l as object).join()), safe(() => JSON.stringify(Object.entries(l as object))), safe(() => JSON.stringify({ ...(l as object) })), safe(() => JSON.stringify(structuredClone(l))), safe(() => new URLSearchParams(hide(l)).toString()));
}
for (const [name, make] of Object.entries(how)) {
  row(name + ": an extra, undefined first", make(withExtra({ a: undefined, b: 1 }, ["zz", 1])), withExtra({ b: 1 }, ["zz", 1]));
  row(name + ": an extra, undefined in the middle", make(withExtra({ b: 1, c: undefined, d: 2 }, ["zz", 1])), withExtra({ b: 1, d: 2 }, ["zz", 1]));
  row(name + ": an extra, undefined last", make(withExtra({ b: 1, d: undefined }, ["zz", 1])), withExtra({ b: 1 }, ["zz", 1]));
  row(name + ": an undefined extra", make(withExtra({ b: 1 }, ["zz", undefined])), { b: 1 } as T);
  row(name + ": an extra, against plain", make(withExtra({ a: undefined, b: 1 }, ["zz", 1])), plain(["b", 1], ["zz", 1]));
  row(name + ": a symbol extra", make(withExtra({ a: undefined, b: 1 }, [Symbol.for("s"), 1])), withExtra({ b: 1 }, [Symbol.for("s"), 1]));
  row(name + ": an extra and an inherited name", make(Object.setPrototypeOf(withExtra({ b: 1 }, ["zz", 1]), plain(["up", 1]))), withExtra({ b: 1 }, ["zz", 1]));
  row(name + ": both sides", make(withExtra({ a: undefined, b: 1 }, ["zz", 1])), make(withExtra({ b: 1 }, ["zz", 1])));
  row(name + ": two extras in another order", make(withExtra({ b: 1 }, ["zz", 1], ["yy", 2])), make(withExtra({ b: 1 }, ["yy", 2], ["zz", 1])));
}
row("a field made read-only", (() => { const x: T = { a: undefined, b: 1 }; Object.defineProperty(hide(x), "b", { writable: false }); return x; })(), { b: 1 } as T);
row("a field made read-only, with an extra", (() => { const x = withExtra({ a: undefined, b: 1 }, ["zz", 1]); Object.defineProperty(hide(x), "b", { writable: false }); return x; })(), withExtra({ b: 1 }, ["zz", 1]));
row("a field made non-configurable", (() => { const x: T = { a: undefined, b: 1 }; Object.defineProperty(hide(x), "b", { configurable: false }); return x; })(), { b: 1 } as T);
