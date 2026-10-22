function hide(value: unknown): any { return value; }
function set(o: unknown, k: PropertyKey, v: unknown): any { hide(o)[k] = v; return o; }
function del(o: unknown, k: PropertyKey): any { delete hide(o)[k]; return o; }
function define(o: unknown, k: PropertyKey, d: PropertyDescriptor): any { Object.defineProperty(hide(o), k, d); return o; }
function freeze(o: unknown): any { return Object.freeze(hide(o)); }
function seal(o: unknown): any { return Object.seal(hide(o)); }
function keys(o: unknown): string { return Object.keys(hide(o)).join(); }
interface P { a: number; b?: string; c?: P | null; list?: P[] }
class K { x = 1; y?: string; constructor(public z: number) {} }
class WithToJSON { v = 1; toJSON() { return "from toJSON " + this.v; } }
const mk = (a = 1): P => ({ a });
let count = 0;
function show(name: string, make: () => unknown, ...rest: [unknown?, unknown?]) {
  let out: string;
  try { const value = make(); out = String(JSON.stringify(value, rest[0] as any, rest[1] as any)) + (value && typeof value === "object" ? " | " + keys(value) : ""); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
show("one extra", () => set(mk(), "z", 1));
show("an extra, then an optional field", () => { const o = set(mk(), "z", 1) as P; o.b = "later"; return o; });
show("an optional field, an extra, another field", () => { const o = mk(); o.b = "first"; set(o, "z", 1); o.c = null; return o; });
show("three extras in order", () => set(set(set(mk(), "z", 1), "m", 2), "aa", 3));
show("an extra deleted and added again", () => set(del(set(set(mk(), "z", 1), "m", 2), "z"), "z", 3));
show("every extra deleted", () => del(set(mk(), "z", 1), "z"));
show("an optional field deleted and set again behind an extra", () => { const o = mk(); o.b = "x"; set(o, "z", 1); del(o, "b"); o.b = "y"; return o; });
show("extra undefined", () => set(set(mk(), "u", undefined), "z", 1));
show("extra function", () => set(set(mk(), "f", () => 1), "z", 1));
show("extra symbol value", () => set(set(mk(), "s", Symbol("s")), "z", 1));
show("extra symbol key", () => set(set(mk(), Symbol("k"), 1), "z", 1));
show("extra null, boolean, double, negative zero, NaN", () => set(set(set(set(set(mk(), "n", null), "t", true), "d", 1.5), "nz", -0), "nan", NaN));
show("extra non-enumerable", () => set(define(mk(), "hidden", { value: 1, enumerable: false, writable: true, configurable: true }), "z", 1));
show("extra read-only", () => set(define(mk(), "ro", { value: 1, enumerable: true, writable: false, configurable: true }), "z", 1));
show("extra getter", () => set(define(mk(), "g", { get() { return "got"; }, enumerable: true, configurable: true }), "z", 1));
show("extra getter that adds a property", () => { const o = mk(); return set(define(o, "g", { get() { set(o, "late", 1); return "got"; }, enumerable: true, configurable: true }), "z", 1); });
show("extra toJSON, callable", () => set(mk(), "toJSON", () => "own toJSON"));
show("extra toJSON, not callable", () => set(mk(), "toJSON", 5));
show("extra toJSON, callable, non-enumerable", () => define(mk(), "toJSON", { value: () => "hidden toJSON", enumerable: false, configurable: true, writable: true }));
show("extra index keys", () => set(set(set(mk(), "10", "ten"), "z", 1), "2", "two"));
show("extra __proto__ by define", () => define(mk(), "__proto__", { value: 1, enumerable: true, writable: true, configurable: true }));
show("extra name that needs escaping", () => set(set(mk(), 'q"uote', 1), "back\\slash", 2));
show("extra name with a control character", () => set(mk(), "tab\there", 1));
show("extra 16-bit name", () => set(mk(), "ключ", 1));
show("extra 16-bit value", () => set(mk(), "z", "значение"));
show("extra empty name", () => set(mk(), "", 1));
show("extra bigint", () => set(mk(), "big", 1n));
show("extra holds a plain object", () => set(mk(), "z", { q: 1, r: [1, 2, { s: 3 }] }));
show("extra holds a typed object with extras", () => set(mk(1), "z", set(mk(2), "y", set(mk(3), "x", 4))));
show("extra holds the object itself", () => { const o = mk(); return set(o, "self", o); });
show("extra holds an object with toJSON", () => set(mk(), "z", new WithToJSON()));
show("extra holds a Date, a Map, a boxed number", () => set(set(set(mk(), "d", new Date(0)), "m", new Map([[1, 2]])), "n", new Number(5)));
show("typed field holds a typed object with extras", () => { const o = mk(1); o.c = set(mk(2), "z", 1) as P; return o; });
show("a list of typed objects, some with extras", () => { const o = mk(0); o.list = [mk(1), set(mk(2), "z", 1) as P, mk(3), set(set(mk(4), "y", 1), "x", 2) as P]; return o; });
show("in a plain array", () => [set(mk(), "z", 1), mk(), set(mk(), "y", 2)]);
show("in a plain object", () => ({ first: set(mk(), "z", 1), second: mk() }));
show("a class instance with extras", () => set(set(new K(3), "extra", 1), "more", "m"));
show("a class instance, optional field behind an extra", () => { const k = set(new K(3), "extra", 1) as K; k.y = "late"; return k; });
show("an instance of a class with toJSON, with extras", () => set(new WithToJSON(), "z", 1));
show("frozen with extras", () => freeze(set(mk(), "z", 1)));
show("sealed with extras", () => seal(set(mk(), "z", 1)));
show("indent 2", () => set(set(mk(), "z", { q: [1, set(mk(2), "y", 1)] }), "e", {}), undefined, 2);
show("indent tab", () => set(mk(), "z", [set(mk(2), "y", 1)]), undefined, "\t");
show("indent, every extra skipped", () => set(set({ } as P, "u", undefined), "f", () => 1), undefined, 2);
show("replacer list", () => set(set(mk(), "z", 1), "y", 2), ["z", "a"]);
show("replacer function", () => set(set(mk(), "z", 1), "y", 2), (k: string, v: unknown) => (k === "y" ? undefined : v));
show("longer than the first buffer", () => { const o = mk(0); o.list = []; for (let i = 0; i < 400; i++) o.list.push(set(mk(i), "extra" + (i % 7), "value " + i) as P); return JSON.stringify(o).length + " " + JSON.stringify(o).slice(-60); });
show("longer than the first buffer, 16-bit at the end", () => { const o = mk(0); o.list = []; for (let i = 0; i < 400; i++) o.list.push(set(mk(i), "extra" + (i % 7), i === 399 ? "конец" : "value " + i) as P); return JSON.stringify(o).length + " " + JSON.stringify(o).slice(-60); });
show("longer than the first buffer, a getter at the end", () => { const o = mk(0); o.list = []; for (let i = 0; i < 400; i++) o.list.push((i === 399 ? define(mk(i), "g", { get() { return "got"; }, enumerable: true }) : set(mk(i), "e", i)) as P); return JSON.stringify(o).length + " " + JSON.stringify(o).slice(-60); });
show("many extras", () => { const o = mk(); for (let i = 0; i < 40; i++) set(o, "k" + i, i); return o; });
show("many extras between fields", () => { const o = mk(); for (let i = 0; i < 12; i++) set(o, "k" + i, i); o.b = "b"; for (let i = 12; i < 24; i++) set(o, "k" + i, i); o.c = null; return o; });
