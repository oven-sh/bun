// `Object.hasOwnProperty.call(o, k)`, as many packages write it: Object inherits the function from Object.prototype. Held to what `Object.prototype.hasOwnProperty.call(o, k)` says, on every kind of receiver and key.
declare const aotOperationCount: undefined | ((name: string) => number);
interface T { a?: number; b: number }
class Base { constructor(public v: number) {} method() { return 1; } static fixed = 1; }
function hide(value: unknown): any { return value; }
function short(o: any, k: any) { return Object.hasOwnProperty.call(o, k); }
function long(o: any, k: any) { return Object.prototype.hasOwnProperty.call(o, k); }
const kept = Object.hasOwnProperty;
function byVariable(o: any, k: any) { return kept.call(o, k); }
function applied(o: any, k: any) { return Object.hasOwnProperty.apply(o, [k]); }
function ofType(o: T, k: string) { return Object.hasOwnProperty.call(o, k); }
function copy(o: any) { const made: any = {}; for (const k in o) { if (Object.hasOwnProperty.call(o, k) === false) continue; made[k] = o[k]; } return made; }
const log: string[] = [];
const say = (make: () => unknown) => { try { return String(make()); } catch (e) { return (e as Error).name; } };
const s = Symbol("s");
const plain = (): any => JSON.parse('{"a":1,"b":2,"0":3}');
const typed: T = { a: 1, b: 2 }, partly: T = { b: 2 }, extended: T = { b: 2 };
hide(extended).zz = 1; hide(extended)[s] = 2;
const child = Object.create(plain()); child.own = 1;
const receivers: [string, unknown][] = [["plain", plain()], ["typed", typed], ["partly", partly], ["extended", extended], ["instance", new Base(1)], ["class", Base], ["child", child], ["array", [1, , 3]], ["string", "ab"], ["number", 5], ["function", function f(_x: number) {}], ["null prototype", Object.assign(Object.create(null), { a: 1 })], ["frozen", Object.freeze({ a: 1, b: 2 } as T)], ["proxy", new Proxy({ a: 1 }, { getOwnPropertyDescriptor(t, k) { log.push("asked " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } })], ["Object", Object], ["Object.prototype", Object.prototype], ["null", null], ["undefined", undefined]];
const keys: unknown[] = ["a", "b", "zz", "own", "v", "method", "fixed", "length", "name", "prototype", "hasOwnProperty", "keys", "0", 0, 1, 2, -0, 1.5, s, Symbol.iterator, "", null, undefined, true, { toString() { log.push("key"); return "a"; } }];
for (const [name, o] of receivers) {
  const rows = [short, long, byVariable, applied].map(f => keys.map(k => { const said = say(() => f(o, k)); return said === "true" ? "1" : said === "false" ? "0" : said[0]; }).join(""));
  console.log(name + ":", rows[0], rows.every(row => row === rows[0]));
}
console.log(log.length, log.slice(0, 6).join());
console.log(ofType(typed, "a"), ofType(partly, "a"), ofType(extended, "zz"), ofType(typed, "toString"));
console.log(Object.hasOwnProperty === Object.prototype.hasOwnProperty, kept === Object.prototype.hasOwnProperty, Object.hasOwnProperty("keys"), Object.hasOwnProperty("hasOwnProperty"), Object.hasOwnProperty.name, Object.hasOwnProperty.length, typeof Object.hasOwnProperty);
console.log(say(() => Object.hasOwnProperty.call(null, { toString() { log.push("first the key"); return "a"; } } as any)), log[log.length - 1]);
console.log(say(() => (Object.hasOwnProperty.call as any)()), say(() => Object.hasOwnProperty.call(typed, undefined as any)), say(() => (Object.hasOwnProperty.call as any)(typed)));
console.log(JSON.stringify([copy(typed), copy(partly), copy(extended), copy(child), copy(new Base(2)), copy([1, 2]), copy("ab")]));
delete typed.a; partly.a = 5;
console.log(short(typed, "a"), short(partly, "a"), JSON.stringify([copy(typed), copy(partly)]));
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const entered = () => counted ? counted("operationAOTHasOwnProperty") : 0;
const before = entered();
let total = 0;
const fresh: { q1: number; q2?: number } = { q1: 1 };
const things: any[] = [fresh, JSON.parse('{"q1":1,"q9":2}')], names = ["q1", "q2", "q3", "q9"];
for (let i = 0; i < 3000; i++) total += +short(things[i & 1], names[i % 4]) + +short(things[(i >> 1) & 1], names[i % 3]);
console.log(total, counted ? entered() - before > 0 && entered() - before < 100 : true);
