// Arrays, maps and sets that another realm made have that realm's prototypes, which are not locked: a loop of the compiled program over them follows what that realm has made of its iterators. And what the host iterates itself.
import vm from "node:vm";
const walk = iterable => { const seen = []; for (const value of iterable) seen.push(String(value)); return seen.join(" "); };
const pairs = iterable => { const seen = []; for (const [key, value] of iterable) seen.push(key + "=" + value); return seen.join(" "); };
const values = x => { const seen = []; for (const value of x.values()) seen.push(String(value)); return seen.join(" "); };
const entries = x => { const seen = []; for (const [key, value] of x.entries()) seen.push(key + "=" + value); return seen.join(" "); };
const all = made => [walk(made.array), pairs(made.map), walk(made.set), values(made.array), values(made.map), values(made.set), entries(made.map), entries(made.set)].join(" | ");
const context = vm.createContext({});
const theirs = vm.runInContext("({ array: [1, 2], map: new Map([['a', 1]]), set: new Set(['b']) })", context);
const ours = { array: [1, 2], map: new Map([["a", 1]]), set: new Set(["b"]) };
console.log("as made:", all(theirs));
vm.runInContext("Map.prototype[Symbol.iterator] = function* () { yield 'xy'; }; Set.prototype[Symbol.iterator] = function* () { yield 'their set'; }; Map.prototype.values = Set.prototype.values = () => ['their values']; Map.prototype.entries = Set.prototype.entries = () => ['zw'];", context);
console.log("maps and sets changed:", all(theirs));
vm.runInContext("Array.prototype[Symbol.iterator] = function* () { yield 'their array'; }; Array.prototype.values = () => 'v';", context);
console.log("arrays changed:", all(theirs));
console.log("ours:", all(ours));
console.log("what the host iterates:", [pairs(new URLSearchParams("a=1&b=2")), values(new URLSearchParams("a=1&b=2")), entries(new URLSearchParams("a=1&b=2")), pairs(new Headers({ a: "1", b: "2" })), values(new Headers({ a: "1" })), entries(new Headers({ a: "1" }))].join(" | "));
