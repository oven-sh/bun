// Each function is named once, where it goes into a table, a list, a Map, a Set or a WeakMap. It comes out under a key or a position that is computed, after the container has been changed in between.
function a() { return "a table"; } function b() { return "a symbol key"; } function c() { return "a number key"; } function d() { return "push and pop"; }
function e() { return "unshift and shift"; } function f() { return "splice"; } function g() { return "concat and flat"; } function h() { return "reverse and at"; }
function i() { return "find"; } function j() { return "a Map"; } function k() { return "a Set"; } function l() { return "a WeakMap"; }
function m() { return "a nested list"; } function n() { return "sort"; } function o() { return "fill"; } function p() { return "a typed key from a number"; }

const name = parts => parts.join("");
const table = {};
table[name(["o", "n", "e"])] = a;
console.log(table[name(["on", "e"])]());
const symbol = Symbol("s");
console.log({ [symbol]: b }[[symbol][0]]());
console.log({ 7: c }[3 + 4]());
const list = [];
list.push(d);
console.log(list.pop()());
list.unshift(e);
console.log(list.shift()());
list.splice(0, 0, f);
console.log(list.splice(0, 1)[0]());
console.log([[]].concat([[g]]).flat()[0]());
console.log([h, null].reverse().at(-1)());
console.log([1, "x", i].find(value => typeof value === "function")());
console.log(new Map([[name(["k"]), j]]).get("k")());
console.log([...new Set([k])][0]());
const owner = {};
console.log(new WeakMap([[owner, l]]).get(owner)());
console.log([[[m]]][0][0][0]());
console.log([{ rank: 2, run: () => "second" }, { rank: 1, run: n }].sort((x, y) => x.rank - y.rank)[0].run());
console.log(new Array(3).fill(o)[2]());
console.log({ 10: p }[String(5 * 2)]());
