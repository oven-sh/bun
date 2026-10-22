interface A { i: number; d: number; s: string; t: boolean; n: null; o?: string; p?: number; child?: A | null; list?: A[] }
interface B { kind: "b"; x: number; y: number }
interface C { kind: "c"; label: string }
interface Empty { o?: string }
interface Dated { id: number; at: Date; name: string; inner?: Dated }
interface Odd { "quo\"te": number; "ключ": number; plain: number }
class Point { #hidden = 5; constructor(public x: number, public y: number) {} get sum() { return this.x + this.y + this.#hidden; } norm() { return 0; } }
class Point3 extends Point { z = 3; }
class Jsonable { v = 1; toJSON(key: string) { return { from: "toJSON", key, v: this.v }; } }
class Heir extends Jsonable { w = 2; }
class OwnToJSON { toJSON: unknown; v = 2; constructor(f: unknown) { this.toJSON = f; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown, ...rest: [unknown?, unknown?]) {
  let out: string;
  try { out = String(JSON.stringify(make(), rest[0] as any, rest[1] as any)); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const a = (i: number): A => ({ i, d: i + 0.5, s: "s" + i, t: (i & 1) === 1, n: null });
const tree = (): A => { const x = a(1); x.child = a(2); x.child.list = [a(3), a(4)]; x.list = []; x.o = "o"; return x; };
const mixed = (): unknown[] => [a(1), { kind: "b", x: 1, y: 2 } as B, JSON.parse('{"z":1,"y":[{}]}'), { kind: "c", label: "l" } as C, [], {}, {} as Empty, new Point(1, 2), new Point3(3, 4), null, [a(5)]];

for (const gap of [2, "\t", 1, 10, 11, 0, "", "ab", "abcdefghijklmnop", -1, 2.9, "  ", true, null, {}, new Number(3), new String("--")] as unknown[]) {
  show("tree, space " + (typeof gap === "object" && gap ? "object " : "") + JSON.stringify(gap), tree, null, gap);
  show("mixed, space " + (typeof gap === "object" && gap ? "object " : "") + JSON.stringify(gap), mixed, undefined, gap);
}
show("space: no property is written", () => [{} as Empty, { o: undefined } as Empty, [{} as Empty]], null, 2);
show("space: only the second property is written", () => { const x: { o?: string; p?: number; q?: number } = { o: undefined, p: 1, q: undefined }; return x; }, null, 2);
show("space: names that need escaping, a 16-bit name", () => ({ 'quo"te': 1, "ключ": 2, plain: 3 }) as Odd, null, 2);
show("space: 16-bit values", () => [{ ...a(1), s: "значение" }, a(2)] as A[], null, 2);
show("space: an extra property", () => { const x = a(1); hide(x).extra = [a(2)]; return [x, a(3)]; }, null, 2);
show("space: frozen, sealed, closed", () => [Object.freeze(a(1)), Object.seal(a(2)), Object.preventExtensions(a(3)), a(4)], null, 2);
show("space: deep", () => { let x = a(0); for (let i = 1; i < 40; i++) { const y = a(i); y.child = x; x = y; } return x; }, null, 3);
show("space: at the first buffer's edge", () => { const out: number[] = []; for (let n = 60; n < 90; n++) { const list: B[] = []; for (let i = 0; i < n; i++) list.push({ kind: "b", x: i, y: -i }); out.push(JSON.stringify(list, null, 4).length); } return out; });
show("space: a cycle", () => { const x = a(1); x.child = x; return x; }, null, 2);
show("space: toJSON of a class among others", () => [new Point(1, 2), new Jsonable(), new Heir(), new Point(3, 4)], null, 2);

const seen: string[] = [];
function noting(this: unknown, key: string, value: unknown) { seen.push(key + "=" + (value === undefined ? "undefined" : typeof value === "object" ? (value === null ? "null" : Array.isArray(value) ? "array" : "object") : String(value)) + (typeof this === "object" && this !== null && key in this ? "" : "!")); return value; }
show("function: what it is handed", () => { seen.length = 0; const x = tree(); x.p = undefined; return x; }, noting);
console.log("   ", seen.join(" "));
show("function: with space", () => { seen.length = 0; return mixed(); }, noting, 2);
console.log("   ", seen.join(" "));
show("function: undefined made something", () => { const x = a(1); x.o = undefined; x.p = undefined; return x; }, (_k: string, v: unknown) => v === undefined ? "was undefined" : v);
show("function: numbers dropped", tree, (_k: string, v: unknown) => typeof v === "number" ? undefined : v);
show("function: objects replaced by typed objects", () => [a(1), a(2)], (k: string, v: unknown) => k === "0" ? ({ kind: "b", x: 1, y: 2 } as B) : v);
show("function: this is the holder", () => { const x = a(1); x.child = a(2); return x; }, function (this: unknown, k: string, v: unknown) { return k === "i" ? (this as A).s + "/" + Object.keys(this as object).length : v; });
show("function: deletes a later optional field", () => { const x = a(1); x.o = "o"; x.p = 1; return x; }, function (this: unknown, k: string, v: unknown) { if (k === "i") delete (this as A).p; return v; });
show("function: sets a later field", () => a(1), function (this: unknown, k: string, v: unknown) { if (k === "i") (this as A).s = "changed"; return v; });
show("function: adds an optional field", () => a(1), function (this: unknown, k: string, v: unknown) { if (k === "i") (this as A).o = "late"; return v; });
show("function: adds an extra property", () => a(1), function (this: unknown, k: string, v: unknown) { if (k === "i") hide(this).extra = "late"; return v; });
show("function: deletes and sets again, so the order moves", () => { const x = a(1); x.o = "o"; x.p = 1; return x; }, function (this: unknown, k: string, v: unknown) { if (k === "i") { const h = this as A; delete h.o; h.o = "again"; } return v; });
show("function: freezes the holder", () => a(1), function (this: unknown, k: string, v: unknown) { if (k === "i") Object.freeze(this); return v; });
show("function: throws", () => a(1), (k: string, v: unknown) => { if (k === "s") throw new RangeError("from the replacer"); return v; });
show("function: a cycle", () => { const x = a(1); x.child = x; return x; }, (_k: string, v: unknown) => v);
show("function: class instances", () => [new Point(1, 2), new Point3(3, 4), new Jsonable(), new Heir()], (_k: string, v: unknown) => v);
show("function: frozen, sealed, extras", () => { const x = a(3); hide(x).extra = 1; return [Object.freeze(a(1)), Object.seal(a(2)), x]; }, (_k: string, v: unknown) => v);

show("list: some names", tree, ["i", "s", "child", "list"]);
show("list: order of the list, a name twice, a name nobody has", tree, ["s", "i", "s", "nobody", "child"]);
show("list: with space", tree, ["child", "list", "d"], 2);
show("list: numbers and boxed names", () => ({ ...a(1), list: [a(2)] }) as A, ["list", 0, new String("i"), new Number(1)]);
show("list: an inherited accessor and a method", () => [new Point(1, 2), new Point3(3, 4)], ["x", "sum", "norm", "z"]);
show("list: an optional field absent, undefined, set", () => { const x = a(1), y = a(2), z = a(3); y.o = undefined; z.o = "o"; return [x, y, z]; }, ["o", "i"]);
show("list: an extra property", () => { const x = a(1); hide(x).extra = "e"; return [x, a(2)]; }, ["extra", "i"]);
show("list: an extra accessor", () => { const x = a(1); Object.defineProperty(hide(x), "extra", { get() { return "got " + this.i; }, enumerable: true }); return [x]; }, ["extra", "i"]);
show("list: a name of Object.prototype", () => a(1), ["constructor", "toString", "i"]);
show("list: empty", tree, []);
show("list: mixed", mixed, ["x", "y", "z", "kind", "i"]);
show("list: toJSON of a class", () => [new Jsonable(), new Heir()], ["v", "from", "w"]);

const date = new Date(86400000);
show("a Date among typed objects", () => { const x: Dated = { id: 1, at: date, name: "n" }; x.inner = { id: 2, at: date, name: "m" }; return [x, x.inner]; });
show("a Date, with space", () => ({ id: 1, at: date, name: "n" }) as Dated, null, 2);
show("toJSON is handed the key", () => ({ first: new Jsonable(), list: [new Jsonable(), new Heir()] }));
show("own toJSON: callable, not callable, undefined", () => [new OwnToJSON(function (this: OwnToJSON, k: string) { return "called " + k + " " + this.v; }), new OwnToJSON(5), new OwnToJSON(undefined)]);
show("toJSON as an extra property", () => { const x = a(1); hide(x).toJSON = () => "from an extra"; return [x, a(2)]; });
show("toJSON as an extra, after one without", () => { const x = a(1), y = a(2); hide(y).toJSON = () => "from an extra"; return [date, x, y, a(3)]; });
show("toJSON put on a class's prototype late", () => { class Late { v = 1; } const one = new Late(), two = new Late(); const out = [JSON.stringify([date, one])]; hide(Late.prototype).toJSON = function () { return "late"; }; out.push(JSON.stringify([date, two, one])); return out; });
show("toJSON that changes what follows", () => { const x = a(1), y = a(2); const list: unknown[] = [{ toJSON() { y.s = "changed"; y.o = "added"; return 0; } }, x, y]; return list; });
show("toJSON returns a typed object", () => [{ toJSON() { return a(7); } }, { toJSON() { return new Point(1, 2); } }]);
show("a BigInt in a typed object", () => ({ id: 1, big: 10n }) as { id: number; big: bigint });
show("a BigInt behind a Date", () => [date, { id: 1, big: 10n } as { id: number; big: bigint }]);
show("boxed primitives in fields", () => ({ n: new Number(1), s: new String("s"), b: new Boolean(false) }) as { n: unknown; s: unknown; b: unknown }, (_k: string, v: unknown) => v);
show("functions and symbols in fields", () => [date, { v: 1, f: () => 1, y: Symbol("y") } as { v: number; f: unknown; y: unknown }, [() => 1, Symbol("z")]]);
show("numbers in the general way", () => [date, { ...a(0), i: -0, d: NaN }, { ...a(0), i: 2147483648, d: 1e21 }, { ...a(0), i: -2147483648, d: 5e-324 }] as unknown[]);
show("many of one shape in the general way", () => { const list: unknown[] = [date]; for (let i = 0; i < 40; i++) list.push({ kind: "b", x: i, y: -i } as B); return list; });
show("a prototype that gets toJSON late and loses it", () => { const proto = JSON.parse("{}"); const x = a(1), y = a(2); Object.setPrototypeOf(x, proto); Object.setPrototypeOf(y, proto); const out = [JSON.stringify([date, x, y]), JSON.stringify([x, y])]; proto.toJSON = function (this: A) { return "late " + this.i; }; out.push(JSON.stringify([date, x, y]), JSON.stringify([x, y]), JSON.stringify([x], null, 1), JSON.stringify([y], ["i"])); delete proto.toJSON; out.push(JSON.stringify([date, x, y]), JSON.stringify([x, y])); return out; });
show("a prototype's prototype gets toJSON late", () => { const top = JSON.parse("{}"), proto = Object.create(top); const x = a(1); Object.setPrototypeOf(x, proto); const out = [JSON.stringify([date, x])]; top.toJSON = () => "from the top"; out.push(JSON.stringify([date, x]), JSON.stringify(x)); return out; });
show("a prototype with a toJSON accessor", () => { const proto = Object.defineProperty(JSON.parse("{}"), "toJSON", { get(this: A) { const i = this.i; return () => "got for " + i; } }); const x = a(1); Object.setPrototypeOf(x, proto); return [date, x, a(2)]; });
show("a null prototype", () => { const x = a(1); Object.setPrototypeOf(x, null); return [date, x, a(2)]; });
show("a null prototype, the fast way, a space, a list", () => { const x = a(1); Object.setPrototypeOf(x, null); return [JSON.stringify(x), JSON.stringify(x, null, 1), JSON.stringify(x, ["i", "toString"])]; });
show("a replacer gives the next object's prototype a toJSON", () => { const proto = JSON.parse("{}"); const x = a(1), y = a(2); Object.setPrototypeOf(x, proto); Object.setPrototypeOf(y, proto); return { x, y, proto }; }, function (this: unknown, k: string, v: unknown) { if (k === "n" && (this as A).i === 1) hide(Object.getPrototypeOf(this)).toJSON = () => "put there under way"; return v; });
