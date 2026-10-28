// A proxy of a list, made elsewhere, with a get trap that hands on by Reflect.get, without one, and with one that answers by itself. The length of a list is a value of the list's own, whoever the receiver is.
const log = [];
const told = work => { try { return work(); } catch (error) { return error.constructor.name; } };
const shown = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function " + held.name : typeof held === "symbol" ? String(held) : held);
function say(label, value) { console.log(label + ": " + shown(value) + (log.length ? " | " + log.splice(0).join(" ") : "")); }
const handsOn = { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); } };
const none = {};
const make = (target, handler) => new Proxy(target, handler);
function lengthOf(from) { return from.length; }
function first(from) { return from[0]; }
function at(from, key) { return from[key]; }
class Stack extends Array { get top() { return this[this.length - 1]; } }
const targets = () => [[1, 2, 3], [], [, 2], ["a"], [1.5, 2.5], new Array(5), Object.freeze([1, 2]), Object.defineProperty([1, 2], "length", { writable: false }), Stack.from([7, 8]), Object.setPrototypeOf([1], { get length() { return "never asked"; } }), Object.assign([1, 2], { name: "named" })];
for (let round = 0; round < 3; round++) {
  for (const handler of [handsOn, none]) {
    say("lengths", targets().map(target => lengthOf(make(target, handler))));
    say("elements", targets().map(target => [first(make(target, handler)), at(make(target, handler), 1), at(make(target, handler), "1"), at(make(target, handler), "length"), at(make(target, handler), 9), at(make(target, handler), -1)]));
  }
  say("the lists themselves in the same places", targets().map(target => [lengthOf(target), first(target), at(target, "length")]));
  say("what is no list in the same places", [{ length: 7, 0: "zero" }, "text", new Uint8Array(2), function two(a, b) { }, new Map, { get length() { return "a getter for " + typeof this; } }, null, undefined, 5].map(from => told(() => [lengthOf(from), first(from)])));
  say("proxies of what is no list", [{ length: 7, 0: "zero" }, new Uint8Array(2), function two(a, b) { }, { get length() { return this === undefined ? "nobody" : "a getter"; } }, new String("ab")].map(target => told(() => [lengthOf(make(target, handsOn)), first(make(target, none))])));
  say("a length for another receiver", [[1, 2, 3], Stack.from([1])].map(list => [Reflect.get(list, "length", {}), Reflect.get(list, "length", 5), Reflect.get(list, "length", make(list, none)), Reflect.get(list, "length", list), Reflect.get(list, "length")]));
  say("a getter of a class of lists for the proxy", (() => { const stack = Stack.from([7, 8]); return [make(stack, none).top, make(stack, handsOn).top]; })());
  say("a list that changes", (() => { const list = [1], proxy = make(list, none), said = []; for (let turn = 0; turn < 5; turn++) { said.push(lengthOf(proxy)); list.push(turn); if (turn === 2) list.length = 0; } return said; })());
  say("a trap that answers by itself", lengthOf(make([1, 2], { get(target, key) { return key === "length" ? "mine" : target[key]; } })));
  say("a fixed length and another answer", told(() => lengthOf(make(Object.freeze([1, 2]), { get() { return 9; } }))));
  say("revoked", told(() => { const made = Proxy.revocable([1], none); made.revoke(); return lengthOf(made.proxy); }));
}
const list = [1, 2, 3, 4, 5, 6, 7, 8], reactive = make(list, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } }), bare = make(list, none);
let sum = 0;
for (let i = 0; i < 60000; i++) { sum += lengthOf(reactive) + lengthOf(bare) + first(reactive) + at(bare, i & 7); if ((i & 4095) === 0) list.push(i); }
console.log(sum, list.length);
