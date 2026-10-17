import { inspect, format } from "node:util";
interface T { a?: number; b: number; c?: string; d?: unknown }
class Base { constructor(public v: number) {} method() { return 1; } get twice() { return this.v * 2; } set twice(x: number) { this.v = x / 2; } static made = 1; }
class Heir extends Base { w = "w"; #secret = 1; get secret() { return this.#secret; } own() { return 2; } }
class Deep3 extends Heir { z = 3; get third() { return 3; } }
class Tagged { v = 1; get [Symbol.toStringTag]() { return "MyTag"; } }
class Custom { v = 1; [Symbol.for("nodejs.util.inspect.custom")]() { return "custom!"; } }
class Empty {}
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let v: unknown;
  try { v = make(); } catch (e) { console.log(String(++count).padStart(2, "0"), name + ": THROWN", (e as Error).name); return; }
  const flat = (s: string) => s.replace(/\s+/g, " ");
  console.log(String(++count).padStart(2, "0"), name + ":", flat(Bun.inspect(v)), "|", flat(inspect(v)), "|", flat(inspect(v, { showHidden: true, depth: 4 })), "|", flat(format("%o %O %j", v, v, typeof v === "object" ? 0 : v)), "|", flat(Bun.inspect(v, { sorted: true, compact: true } as any)));
  console.log(v);
}
const plain = (...entries: [string | symbol, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, w] of entries) o[k] = w; return o; };
show("a record", () => ({ b: 1 }) as T);
show("undefined first, in the middle, last", () => [{ a: undefined, b: 1 } as T, { b: 1, c: undefined, d: 2 } as T, { b: 1, d: undefined } as T]);
show("orders differ", () => { const x: T = { b: 1 }; x.c = "c"; x.a = 1; return x; });
show("every kind of value", () => ({ b: 1.5, c: "s", d: [null, true, 10n, Symbol("s"), () => 1, new Date(0), /x/g, new Map([[1, { b: 2 } as T]]), new Set([{ b: 3 } as T])] }) as T);
show("nested four deep", () => ({ b: 1, d: { b: 2, d: { b: 3, d: { b: 4, d: { b: 5 } } } } }) as T);
show("empty", () => [{} as { o?: number }, { o: undefined } as { o?: number }, new Empty()]);
show("an instance", () => new Base(1));
show("an heir: a private field, accessors, methods", () => new Heir(2));
show("three classes deep", () => new Deep3(3));
show("a class with a tag", () => new Tagged());
show("a class with a custom inspector", () => [new Custom(), { b: 1, d: new Custom() } as T]);
show("the classes themselves", () => [Base, Heir]);
show("a prototype with an enumerable name", () => Object.setPrototypeOf({ b: 1 } as T, plain(["zz", 1])));
show("a prototype with an accessor", () => Object.setPrototypeOf({ b: 1 } as T, Object.defineProperty(plain(), "got", { get() { return 1; }, enumerable: true })));
show("a prototype chain of three plain objects", () => Object.setPrototypeOf({ b: 1 } as T, Object.setPrototypeOf(plain(["p1", 1]), Object.setPrototypeOf(plain(["p2", 2]), plain(["p3", 3])))));
show("a prototype that owns a name the object has", () => Object.setPrototypeOf({ b: 1 } as T, plain(["b", 2], ["a", 3])));
show("a typed object as a prototype", () => [Object.create({ b: 1 } as T), Object.setPrototypeOf({ b: 2 } as T, { a: 1, b: 1 } as T)]);
show("a null prototype", () => Object.setPrototypeOf({ b: 1 } as T, null));
show("extras: a string, a symbol, an index", () => { const x: T = { b: 1 }; hide(x).zz = 1; hide(x)[Symbol.for("s")] = 2; hide(x)[0] = "zero"; return x; });
show("extras: non-enumerable, an accessor", () => { const x: T = { b: 1 }; Object.defineProperty(hide(x), "hidden", { value: 1, enumerable: false }); Object.defineProperty(hide(x), "got", { get() { return 1; }, enumerable: true }); return x; });
show("names: constructor, __proto__, toString as fields", () => ({ constructor: 1, toString: 2, valueOf: 3 }) as { constructor: number; toString: number; valueOf: number });
show("names that need quotes", () => ({ "a-b": 1, "1x": 2, "": 3, "ключ": 4, "with space": 5 }));
show("frozen, sealed, closed", () => [Object.freeze({ b: 1 } as T), Object.seal({ b: 2 } as T), Object.preventExtensions({ b: 3 } as T)]);
show("a cycle", () => { const x: T = { b: 1 }; x.d = x; return x; });
show("one object twice", () => { const x: T = { b: 1 }; return [x, x, { b: 2, d: x } as T]; });
show("many fields", () => ({ f01: 1, f02: 2, f03: 3, f04: 4, f05: 5, f06: 6, f07: 7, f08: 8, f09: 9, f10: 10, f11: 11, f12: 12, f13: 13, f14: 14, f15: 15, f16: 16, f17: 17, f18: 18, f19: 19, f20: 20, f21: 21, f22: 22, f23: 23, f24: 24, f25: 25, f26: 26, f27: 27, f28: 28 }));
show("an array of a hundred and five", () => Array.from({ length: 105 }, (_, i) => ({ b: i }) as T));
show("console.table's data", () => { console.table([{ b: 1, c: "x" } as T, { a: 2, b: 3 } as T]); return 0; });
show("an error with typed fields", () => Object.assign(new Error("boom"), { info: { b: 1 } as T }).info);
