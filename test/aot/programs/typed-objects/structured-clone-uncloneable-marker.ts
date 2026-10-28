// structuredClone and postMessage of typed objects marked with markAsUncloneable, of class prototypes whose members were never read, and of objects with 14 fields: errors, key order and identity inside the message are plain Bun's.
import { markAsUncloneable, MessageChannel, receiveMessageOnPort } from "node:worker_threads";

interface Flat { id: number; name: string; ok: boolean }
interface Wrapper { label: string; inner: unknown }
interface Wide { a: number; b: string; c: boolean; d: null; e: number; f: string; g: number; h: string; i: number; j: string; k: number; l: string; m: number; n: string; list?: number[]; self?: Wide }
class P { #hidden = 1; constructor(public x: number, public y: string) {} get sum() { return this.x + this.#hidden; } method() { return 1; } }
class Unread { constructor(public x: number) {} first() { return this.x; } get second() { return 2; } static third() { return 3; } }
function hide(value: unknown): any { return value; }
let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { const v = make(); out = Bun.inspect(v, { depth: 6, sorted: false }).replace(/\s+/g, " "); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}
function post(value: unknown): any {
  const { port1, port2 } = new MessageChannel();
  try { port1.postMessage(value); return receiveMessageOnPort(port2)?.message; } finally { port1.close(); port2.close(); }
}
const flat = (id: number): Flat => ({ id, name: "n" + id, ok: true });
const wrap = (inner: unknown): Wrapper => ({ label: "l", inner });
const wide = (seed: number): Wide => ({ a: seed, b: "b", c: true, d: null, e: 1.5, f: "", g: -0, h: "значение", i: 2147483648, j: "j".repeat(3) + seed, k: 11, l: "l", m: 13, n: "n" });
const copiers: [string, (value: unknown) => any][] = [["structuredClone", value => structuredClone(value)], ["postMessage", post]];

function showMarked(kind: string, marked: unknown, unmarked: unknown) {
  for (const [via, copy] of copiers) {
    show(`${via}, marked ${kind}`, () => copy(marked));
    show(`${via}, marked ${kind} in an array`, () => copy([marked]));
    show(`${via}, marked ${kind} last in an array`, () => copy([flat(2), 1, marked]));
    show(`${via}, marked ${kind} in a field`, () => copy(wrap(marked)));
    show(`${via}, marked ${kind} in a map`, () => copy(new Map([[1, marked]])));
    show(`${via}, unmarked ${kind}`, () => [copy(unmarked), copy([unmarked]), copy([flat(2), 1, unmarked]), copy(wrap(unmarked)), copy(new Map([[1, unmarked]]))]);
  }
}
const literal = flat(1), instance = new P(1, "y");
show("before the mark", () => [structuredClone(literal), structuredClone([instance]), post(wrap(literal))]);
markAsUncloneable(literal);
markAsUncloneable(instance);
showMarked("literal", literal, flat(1));
showMarked("instance", instance, new P(1, "y"));
show("the mark is invisible", () => [Reflect.ownKeys(literal), JSON.stringify(literal), literal.name, Reflect.ownKeys(instance), instance.sum, instance.method()]);
show("a spread copy has no mark", () => structuredClone({ ...literal }));
show("marked twice", () => { markAsUncloneable(literal); return structuredClone(literal); });
show("marked, then a field redefined", () => { Object.defineProperty(hide(literal), "name", { writable: false }); return [Object.keys(literal), literal.name]; });
show("the mark outlives the redefinition", () => structuredClone([literal]));
show("marked, then an index added", () => { hide(instance)[0] = "zero"; return structuredClone(instance); });

show("prototype with unread members", () => { const c = structuredClone(Unread.prototype); return [c, Object.keys(c), Object.getPrototypeOf(c) === Object.prototype]; });
show("prototype in a field, posted", () => post(wrap(Unread.prototype)));
show("members after the clone", () => { const u = new Unread(3); return [u.first(), u.second, Unread.third(), Object.getOwnPropertyNames(Unread.prototype)]; });
show("prototype with an enumerable property", () => { hide(P.prototype).tag = "t"; return [structuredClone(P.prototype), structuredClone(new P(2, "z"))]; });
show("class", () => structuredClone(Unread));
show("class in a field", () => structuredClone(wrap(P)));
show("class in an array, posted", () => post([Unread]));

for (const [via, copy] of copiers) {
  show(`${via}, 14 fields`, () => copy(wide(1)));
  show(`${via}, 14 fields and a list`, () => { const w = wide(2); w.list = [1, 2]; return copy(w); });
  show(`${via}, twice in an array`, () => { const w = wide(3); w.list = []; const c = copy([w, w]); return [c.length, c[0] === c[1], c[0] === w, Object.keys(c[0]).join()]; });
  show(`${via}, in two fields`, () => { const w = wide(4); w.list = []; const c = copy({ first: w, second: wrap(w) }); return [c.first === c.second.inner, Object.keys(c.first).join()]; });
  show(`${via}, a cycle`, () => { const w = wide(5); w.self = w; const c = copy(w); return [c.self === c, c === w, Object.keys(c).join()]; });
  show(`${via}, a cycle of two`, () => { const w = wide(6), o = wide(7); w.self = o; o.self = w; const c = copy(w); return [c.self.self === c, c.self === c, c.a, c.self.a, Object.keys(c.self).join()]; });
  show(`${via}, changed on arrival`, () => { const w = wide(8); w.list = []; const c = copy(w); c.late = 1; delete c.a; c.b += "!"; return [c, Object.isExtensible(c), Object.getPrototypeOf(c) === Object.prototype]; });
}
