interface Named { name: string; length: number; prototype?: string; id: number }
interface Maybe { name?: string; length?: number; id: number }
class Thing { name = "thing"; length = 3; static label = "s"; method() { return 1; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = JSON.stringify(make()); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
const bits = (list: boolean[]) => list.map(b => (b ? "1" : "0")).join("");
function literal(x: any) { return bits(["name" in x, "length" in x, "prototype" in x, "__proto__" in x, "id" in x]); }
const keys = ["name", "length", "prototype", "__proto__", "id", "na" + "me", ["len", "gth"].join("")];
function computed(x: any) { return bits(keys.map(k => k in x)); }
function looped(x: any) { let n = 0; for (let i = 0; i < 50; i++) for (const k of keys) n += k in x ? 1 : 0; return n; }
function reflected(x: any) { return bits(keys.map(k => Reflect.has(x, k))); }
const every = (x: unknown) => [literal(x), computed(x), looped(x), reflected(x)];
const named = (): Named => ({ name: "n", length: 2, id: 1 });
const maybe = (): Maybe => ({ id: 1 });
show("fields called name and length", () => every(named()));
show("an optional field called prototype: absent, set, deleted", () => { const x = named(); const out = [every(x)]; x.prototype = "p"; out.push(every(x)); delete x.prototype; out.push(every(x)); return out; });
show("optional name and length: absent, set, undefined, deleted", () => { const x = maybe(); const out = [every(x)]; x.name = "n"; x.length = 1; out.push(every(x)); x.name = undefined; out.push(every(x)); delete x.name; delete x.length; out.push(every(x)); return out; });
show("objects of one shape in turn, one site", () => { const list: Maybe[] = [{ id: 1 }, { name: "n", id: 1 }, { id: 1 }, { length: 1, id: 1 }, { name: "n", length: 1, id: 1 }, { id: 1 }]; return list.map(every); });
show("an instance, its class, a method", () => { const x = new Thing(); return [every(x), every(Thing), every(x.method)]; });
show("typed objects, functions, arrays and strings' wrappers in turn, one site", () => [named(), function f(a: number, b: number) { return a + b; }, maybe(), [1, 2], named(), () => 1, Object("ab"), class K {}, maybe(), JSON.parse('{"name":1}'), JSON.parse("{}"), new Map(), named()].map(every));
show("a function that has lost its name and length", () => { const f = function g(a: number) { return a; }; const out = [every(f)]; delete hide(f).name; delete hide(f).length; out.push(every(f)); return out; });
show("absent here, the prototype has them", () => { const proto = JSON.parse('{"name":1,"length":2}'); const x = Object.setPrototypeOf(hide(maybe()), proto); const out = [every(x)]; delete proto.name; out.push(every(x)); x.name = "own"; out.push(every(x)); return out; });
show("a null prototype", () => [every(Object.setPrototypeOf(hide(named()), null)), every(Object.setPrototypeOf(hide(maybe()), null))]);
show("extras called name and length on a type without them", () => { const x: { id: number } = { id: 1 }; const out = [every(x)]; hide(x).name = 1; hide(x).length = 2; out.push(every(x)); delete hide(x).name; out.push(every(x)); return out; });
show("frozen", () => [every(Object.freeze(named())), every(Object.freeze(maybe()))]);
show("a typed object as the prototype", () => [every(Object.create(named())), every(Object.create(maybe()))]);
