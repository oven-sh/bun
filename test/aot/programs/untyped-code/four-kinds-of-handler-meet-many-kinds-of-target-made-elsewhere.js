// Reads, tests and stores in functions of their own, handed proxies that were made elsewhere with four kinds of handler and many kinds of target, the targets themselves, and what is no object. What a proxy holds for its target may be a proxy again.
const told = work => { try { return work(); } catch (error) { return error.constructor.name; } };
const out = [];
const symbol = Symbol("s");
let calls = 0;
const full = { get(target, key, receiver) { calls++; return Reflect.get(target, key, receiver); }, has(target, key) { calls++; return key in target; }, set(target, key, value, receiver) { calls++; return Reflect.set(target, key, value, receiver); } };
const empty = {};
class Handler { get(target, key) { calls++; return key === "alpha" ? "class" : target[key]; } }
const ofClass = new Handler;
const handlers = [full, empty, ofClass, new Proxy(full, empty), undefined, null, 5];
const make = (target, handler) => new Proxy(target, handler);
const makeOrNot = (target, handler) => { let held; try { held = new Proxy(target, handler); } catch { } return held; };
function read(from) { return from.alpha; }
function test(from) { return "alpha" in from; }
function store(from, value) { from.alpha = value; return from.alpha; }
function readKey(from, key) { return from[key]; }
function testKey(from, key) { return key in from; }
function storeKey(from, key, value) { from[key] = value; return from[key]; }
function all(from, key, value) { return [told(() => read(from)), told(() => test(from)), told(() => store(from, value)), told(() => readKey(from, key)), told(() => testKey(from, key)), told(() => storeKey(from, key, value))]; }
const targets = () => [{ alpha: 1 }, { alpha: 2, beta: 3 }, Object.freeze({ alpha: 4 }), Object.defineProperty({ alpha: 0 }, "alpha", { value: 6, writable: false, configurable: false }), Object.preventExtensions({ beta: 1 }), { get alpha() { return this === undefined ? "none" : "getter"; }, set alpha(value) { calls++; } }, [1, 2], function named() { }, new Map, Object.create({ alpha: "above" }), undefined, null, 5, "text"];
const keys = ["alpha", "beta", symbol, 0, {}, { toString() { return "alpha"; } }, null, undefined];
for (let round = 0; round < 3; round++)
  for (const handler of handlers)
    for (const target of targets())
      for (const key of keys) {
        out.push(JSON.stringify([told(() => all(make(target, handler), key, round)), all(makeOrNot(target, handler), key, round), all(target, key, round), calls], (name, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : typeof held === "symbol" ? "symbol" : held));
      }
const changing = { get(target, key) { return "first"; } };
const later = make({ alpha: 1 }, changing);
out.push(read(later)); changing.get = () => "second"; out.push(read(later)); delete changing.get; out.push(String(read(later))); changing.get = 5; out.push(told(() => read(later))); Object.setPrototypeOf(changing, { has() { return false; } }); delete changing.get; out.push(String(test(later)));
const { proxy, revoke } = Proxy.revocable({ alpha: 1 }, full);
out.push(JSON.stringify(all(proxy, "alpha", 1))); revoke(); out.push(JSON.stringify(all(proxy, "alpha", 1)));
let sum = 0;
const often = make({ alpha: 1 }, full), plain = { alpha: 1 };
for (let i = 0; i < 40000; i++) sum += read(i & 1 ? often : plain) + (test(i & 2 ? often : plain) ? 1 : 0) + store(i & 4 ? often : plain, 1);
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, hash, sum, calls);
console.log(out.filter((line, index) => index % 211 === 0 || index > out.length - 8).join("\n"));
