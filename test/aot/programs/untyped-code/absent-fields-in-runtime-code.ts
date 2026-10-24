// `o.name` in functions made with `new Function`, o an object of a type of the program: the field is optional and absent, or no such object has the name. Each read is made twelve times over, so that what the interpreter remembers at the place is used, and objects that answer otherwise come to the same place in turn.
interface Inner { v: number }
interface Maybe { always: number; number?: number; fraction?: number; text?: string; flag?: boolean; inner?: Inner; anything?: unknown; list?: number[]; both?: number | string }
class Point { constructor(public x: number, public y: number, public label?: string) {} get sum() { return this.x + this.y; } norm() { return this.x * this.x + this.y * this.y; } }
function hide(value: unknown): any { return value; }
let count = 0;
const say = (v: unknown): unknown => v === undefined ? "undefined" : typeof v === "function" ? "function" : typeof v === "number" && v !== v ? "NaN" : v;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make(), (_k, v) => say(v)); } catch (e) { out = "throws " + (e as Error).name; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const optional = ["number", "fraction", "text", "flag", "inner", "anything", "list", "both"];
const readers: Record<string, (o: unknown) => unknown> = {};
for (const name of [...optional, "always", "nothing", "other", "label", "x", "sum", "norm", "toString", "constructor", "hasOwnProperty", "then", "toJSON", "length"]) readers[name] = new Function("o", "return o." + name) as (o: unknown) => unknown;
const readPrototype = new Function("o", "return o.__proto__") as (o: unknown) => unknown;
const again = (name: string, o: unknown) => { let last: unknown, same = true; for (let i = 0; i < 12; i++) { const v = readers[name](o); if (i && !Object.is(v, last)) same = false; last = v; } return same ? say(last) : "CHANGES"; };
const all = (o: unknown, which = optional) => which.map(n => again(n, o));
const plain = (...list: [string, unknown][]): any => { const o = JSON.parse("{}"); for (const [k, v] of list) o[k] = v; return o; };
const empty = (): Maybe => ({ always: 1 });
const full = (): Maybe => ({ always: 1, number: 2, fraction: 2.5, text: "t", flag: false, inner: { v: 3 }, anything: null, list: [4], both: "b" });
show("every optional field absent", () => all(empty()));
show("every optional field there", () => all(full()));
show("absent and there in turn, one place", () => { const a = empty(), b = full(), out: unknown[] = []; for (let round = 0; round < 3; round++) out.push(all(a), all(b)); return out; });
show("one read each, in turn", () => { const a = empty(), b = full(), out: unknown[] = []; for (let i = 0; i < 8; i++) out.push(optional.map(n => say(readers[n](i & 1 ? b : a)))); return out; });
show("set, undefined, deleted, set again", () => { const x = empty(), out = [all(x)]; Object.assign(x, full()); out.push(all(x)); for (const n of optional) hide(x)[n] = undefined; out.push(all(x)); for (const n of optional) delete hide(x)[n]; out.push(all(x)); x.number = 0; x.text = ""; x.flag = true; x.fraction = NaN; out.push(all(x)); return out; });
show("names that no such object has", () => all(empty(), ["nothing", "other", "then", "toJSON", "length"]));
show("names that are inherited", () => { const x = empty(); return [typeof readers["toString"](x), readers["constructor"](x) === Object, typeof readers["hasOwnProperty"]!(x), readPrototype(x) === Object.prototype, readPrototype(x) === Object.prototype]; });
show("a name that comes as an extra, and goes", () => { const x = empty(), y = empty(), out = [again("nothing", x), again("nothing", y)]; hide(x).nothing = "extra"; out.push(again("nothing", x), again("nothing", y)); delete hide(x).nothing; out.push(again("nothing", x), again("nothing", y)); hide(y).other = 1; out.push(again("nothing", y), again("other", y), again("text", y), again("other", x)); return out; });
show("an extra that is an accessor", () => { const x = empty(); let calls = 0; const before = again("nothing", x); Object.defineProperty(hide(x), "nothing", { get() { calls++; return "got"; }, configurable: true }); return [before, again("nothing", x), calls, again("text", x)]; });
show("a given prototype has the names, loses them, gets them again", () => { const x = empty(), y = empty(), proto = plain(["text", "above"], ["nothing", "above too"]); const out = [again("text", x), again("nothing", x)]; Object.setPrototypeOf(hide(x), proto); out.push(again("text", x), again("nothing", x), again("text", y), again("nothing", y)); delete proto.text; delete proto.nothing; out.push(again("text", x), again("nothing", x)); proto.text = "back"; proto.nothing = "back too"; out.push(again("text", x), again("nothing", x)); x.text = "own"; out.push(again("text", x)); delete x.text; out.push(again("text", x)); return out; });
show("the prototype of a given prototype gets the names", () => { const x = empty(), far = plain(), near = Object.create(far); Object.setPrototypeOf(hide(x), near); const out = [again("text", x), again("nothing", x)]; far.text = "far"; far.nothing = "far too"; out.push(again("text", x), again("nothing", x)); return out; });
show("a null prototype", () => { const x = Object.setPrototypeOf(hide(empty()), null); return [all(x), again("nothing", x), again("toString", x), again("always", x)]; });
show("frozen, sealed, closed", () => [Object.freeze(empty()), Object.seal(empty()), Object.preventExtensions(empty())].map(x => [all(x), again("nothing", x)]));
show("instances", () => { const p = new Point(1, 2), q = new Point(3, 4, "l"); const out: unknown[] = []; for (let round = 0; round < 3; round++) out.push([again("label", p), again("label", q), again("nothing", p), again("sum", p), typeof readers.norm(q), again("x", q)]); return out; });
show("typed, plain and primitives in turn, one place", () => { const list: unknown[] = [empty(), plain(), full(), plain(["text", "p"], ["nothing", 1]), new Point(1, 2), "string", 5, [1], empty(), () => 1]; const out: unknown[] = []; for (let round = 0; round < 2; round++) for (const o of list) out.push([say(readers.text(o)), say(readers.nothing(o)), say(readers.length(o))]); return out; });
show("a typed object as the prototype of a plain one", () => { const x = empty(), heir = Object.create(hide(x)); const out = [again("text", heir), again("nothing", heir), again("always", heir)]; x.text = "from above"; out.push(again("text", heir)); heir.text = "own"; out.push(again("text", heir), again("text", x)); return out; });
show("null and undefined", () => [null, undefined].map(o => { try { return readers.text(o); } catch (e) { return (e as Error).name; } }));
show("many objects, garbage between", () => { let n = 0, kept: unknown; for (let i = 0; i < 4000; i++) { const x: Maybe = i & 1 ? { always: i, number: i, text: "t" } : { always: i }; kept = { i }; n += (readers.number(x) === undefined ? 1 : 2) + (readers.text(x) === undefined ? 10 : 20) + (readers.nothing(x) === undefined ? 100 : 200); } return [n, kept !== undefined]; });
