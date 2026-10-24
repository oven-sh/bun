// `o.hasOwnProperty(k)` where nothing is known of `k`. Held to what `Object.prototype.hasOwnProperty.call(o, k)` says on every kind of receiver and key, also where the object has a method of its own by the name, and where the key is an object that is converted by code of the program.
declare const aotOperationCount: undefined | ((name: string) => number);
function method(o: any, k: any) { return o.hasOwnProperty(k); }
function called(o: any, k: any) { return Object.prototype.hasOwnProperty.call(o, k); }
const log: string[] = [];
const say = (make: () => unknown) => { try { return String(make()); } catch (e) { return (e as Error).name; } };
const s = Symbol("s");
interface T { a?: number; b: number }
class Base { constructor(public v: number) {} method() { return 1; } }
const typed: T = { a: 1, b: 2 }, partly: T = { b: 2 };
const child = Object.create(JSON.parse('{"a":1}')); child.own = 1;
const receivers: [string, unknown][] = [["plain", JSON.parse('{"a":1,"b":2,"0":3}')], ["typed", typed], ["partly", partly], ["instance", new Base(1)], ["class", Base], ["child", child], ["array", [1, , 3]], ["string", "ab"], ["number", 5], ["boolean", true], ["symbol", s], ["function", function f(_x: number) {}], ["frozen", Object.freeze({ a: 1 })], ["proxy", new Proxy({ a: 1 }, { getOwnPropertyDescriptor(t, k) { log.push("asked " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } })], ["map", new Map()], ["Object.prototype", Object.prototype]];
const keys: unknown[] = ["a", "b", "own", "v", "method", "length", "name", "prototype", "hasOwnProperty", "0", 0, 1, 2, -0, 1.5, s, Symbol.iterator, "", null, undefined, true, 10n, { toString() { log.push("key"); return "a"; } }, { [Symbol.toPrimitive]() { log.push("primitive"); return "b"; } }, ["a"], { toString() { throw new RangeError("no key"); } }];
for (const [name, o] of receivers) {
  const rows = [method, called].map(f => keys.map(k => { const said = say(() => f(o, k)); return said === "true" ? "1" : said === "false" ? "0" : said[0]; }).join(""));
  console.log(name + ":", rows[0], rows[0] === rows[1]);
}
console.log(log.length, log.slice(0, 8).join());
const own = { hasOwnProperty(k: unknown) { return "mine " + String(k); } };
const nothing = Object.create(null);
const shadowed = Object.create({ hasOwnProperty: () => "inherited" });
console.log(say(() => method(own, "a")), say(() => method(nothing, "a")), say(() => method(shadowed, "a")), say(() => method(null, "a")), say(() => method(undefined, { toString() { log.push("never"); return "a"; } })), log.includes("never"));
console.log(say(() => (typed as any).hasOwnProperty()), say(() => (typed as any).hasOwnProperty("a", "b")), say(() => (typed as any).hasOwnProperty(...["b"])));
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTHasOwnProperty") : 0;
const things: any[] = [{ q1: 1 } as { q1: number; q2?: number }, JSON.parse('{"q1":1,"q9":2}')], names: unknown[] = ["q1", "q2", "q3", "q9"];
const before = entered();
let total = 0;
for (let i = 0; i < 3000; i++) total += (method(things[i & 1], names[i % 4]) ? 1 : 0) + (method(things[(i >> 1) & 1], names[i % 3]) ? 1 : 0);
console.log(total, counted ? entered() - before > 0 && entered() - before < 100 : true);
