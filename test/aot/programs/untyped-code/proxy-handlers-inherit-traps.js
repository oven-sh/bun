// Reads by name of proxies whose handler is an object of a class, so that it inherits `get` (as the reactive objects of a well-known framework do); handlers with a `get` of their own, with none, with one that is an
// accessor, that is no function, that is undefined or null; a handler that is itself a proxy; a trap exchanged on the prototype or shadowed on the handler while the program runs; a prototype exchanged; a revoked proxy;
// what the invariants of [[Get]] refuse; receivers that inherit from a proxy. Once warm, such a read asks the general operation next to nothing. Only the jsc shell can count; elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
class Base { constructor(tag) { this.tag = tag; } get(target, key, receiver) { return this.tag + ":" + String(key) + ":" + Reflect.get(target, key, receiver) + ":" + (receiver !== target); } }
class Deeper extends Base { set(target, key, value) { target[key] = value; return true; } }
class Deepest extends Deeper {}
const target = { a: 1, b: 2, name: "n" };
function readA(o) { return o.a; }
function readB(o) { return o.b; }
function readMissing(o) { return o.missing; }
const inherited = new Proxy(target, new Base("base")), deeper = new Proxy(target, new Deeper("deeper")), deepest = new Proxy(target, new Deepest("deepest"));
lines.push(readA(inherited), readB(deeper), readMissing(deepest), readA(deepest));
lines.push(readA(new Proxy(target, { get: (t, k) => "own " + k })), readA(new Proxy(target, {})), readA(new Proxy(target, Object.create(null))), readA(new Proxy(target, Object.create({ get: (t, k) => "from a plain prototype " + k }))));
let asked = 0;
lines.push(readA(new Proxy(target, { get get() { asked++; return (t, k) => "through an accessor " + k; } })), asked, readA(new Proxy(target, Object.create({ get get() { asked++; return undefined; } }))), asked);
lines.push(attempt(() => readA(new Proxy(target, { get: 5 }))), attempt(() => readA(new Proxy(target, Object.create({ get: "text" })))), readA(new Proxy(target, { get: undefined })), readA(new Proxy(target, Object.create({ get: null }))));
const seen = [];
lines.push(readA(new Proxy(target, new Proxy(new Base("behind a proxy"), { get(t, k, r) { seen.push(String(k)); return Reflect.get(t, k, r); } }))), seen.join());
class Changing { get(t, k) { return "first " + k; } }
const changing = new Proxy(target, new Changing());
lines.push(readA(changing)); Changing.prototype.get = (t, k) => "second " + k; lines.push(readA(changing));
const handler = new Changing(), shadowed = new Proxy(target, handler);
lines.push(readA(shadowed)); handler.get = (t, k) => "shadowed " + k; lines.push(readA(shadowed)); delete handler.get; lines.push(readA(shadowed));
Object.setPrototypeOf(handler, { get: (t, k) => "another prototype " + k }); lines.push(readA(shadowed)); Object.setPrototypeOf(handler, null); lines.push(readA(shadowed));
delete Changing.prototype.get; lines.push(readA(changing));
const revocable = Proxy.revocable(target, new Base("revocable")); lines.push(readA(revocable.proxy)); revocable.revoke(); lines.push(attempt(() => readA(revocable.proxy)));
const fixed = Object.defineProperty({}, "a", { value: 1 }); class Lies { get() { return 2; } } class Truth { get() { return 1; } }
lines.push(attempt(() => readA(new Proxy(fixed, new Lies()))), readA(new Proxy(fixed, new Truth())), attempt(() => readA(new Proxy(Object.defineProperty({}, "a", { set(v) {} }), new Lies()))));
const heir = Object.create(inherited); heir.own = 1; lines.push(readA(heir), heir.own);
class Throws { get() { throw new RangeError("in the trap"); } } lines.push(attempt(() => readA(new Proxy(target, new Throws()))));
class Counts { n = 0; get(t, k) { return ++this.n; } } const counts = new Proxy(target, new Counts()); lines.push(readA(counts), readB(counts), readA(counts));
for (let i = 0; i < 300; i++) { readA(inherited); readB(deeper); readMissing(deepest); }
const before = count("operationAOTGetByIdAndCache");
let length = 0;
for (let i = 0; i < 3000; i++) length += readA(inherited).length + readB(deeper).length + readMissing(deepest).length;
lines.push("the general operation is asked at most 60 times for 9000 reads: " + (count("operationAOTGetByIdAndCache") - before <= 60), length);
console.log(lines.join("\n"));
