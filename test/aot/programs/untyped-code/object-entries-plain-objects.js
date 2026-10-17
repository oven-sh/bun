// Object.entries() of ordinary objects of many shapes: the pairs are ordinary arrays that can be grown, changed, frozen and kept across collections.
const show = value => JSON.stringify(value, (key, held) => typeof held === "function" ? "function" : typeof held === "symbol" ? "symbol" : held === undefined ? "undefined" : typeof held === "bigint" ? held + "n" : held);
function entriesOf(object) { return Object.entries(object); }
const hidden = Object.defineProperty({ a: 1, c: 3 }, "b", { value: 2, enumerable: false });
const withGetter = { a: 1, get b() { return this.a + 1; }, c: 3 };
const changing = { a: 1, get b() { delete this.c; this.d = 4; return 2; }, c: 3 };
const withSymbol = { a: 1, [Symbol("s")]: 2, b: 3 };
const indexed = { b: 1, 2: "two", a: 2, 0: "zero" };
const inherited = Object.create({ up: 1 }); inherited.own = 2;
const deleted = { a: 1, b: 2, c: 3 }; delete deleted.b; deleted.e = 5; deleted.b = 6;
const many = {}; for (let i = 0; i < 40; i++) many["k" + i] = i;
const dictionary = {}; for (let i = 0; i < 300; i++) dictionary["k" + i] = i; for (let i = 0; i < 290; i++) delete dictionary["k" + i];
const values = { u: undefined, n: null, f() {}, s: Symbol.iterator, big: 10n, d: 1.5, z: -0, o: { p: 1 }, l: [1, 2] };
const samples = { empty: {}, one: { a: 1 }, six: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, hidden, withGetter, changing, withSymbol, indexed, inherited, deleted, many, dictionary, values,
  array: ["x", "y"], text: "ab", number: 5, frozen: Object.freeze({ a: 1, b: 2 }), nullPrototype: Object.assign(Object.create(null), { a: 1 }), proxy: new Proxy({ a: 1, b: 2 }, {}), fn: Object.assign(function () {}, { a: 1 }) };
for (const name of Object.keys(samples)) {
  for (let round = 0; round < 3; round++) console.log(name, round, show(entriesOf(samples[name])));
}
for (const bad of [undefined, null]) { try { entriesOf(bad); } catch (e) { console.log(String(bad), e instanceof TypeError); } }
const kept = [];
for (let i = 0; i < 20000; i++) {
  const list = entriesOf({ a: i, b: "t" + i, c: { i } });
  if (i % 4000 === 0) kept.push(list);
}
(globalThis.gc ?? (() => globalThis.Bun.gc(true)))();
console.log(show(kept));
const pairs = entriesOf({ a: 1, b: 2 });
console.log(Array.isArray(pairs), Array.isArray(pairs[0]), pairs.length, pairs[0].length, Object.getPrototypeOf(pairs[0]) === Array.prototype, 2 in pairs[0], Object.keys(pairs[0]).join());
pairs[0].push("more", "and more", "still more"); pairs[0][9] = "far"; pairs[1].length = 1; pairs[1].unshift(0.5); pairs.push(["c", 3]);
console.log(show(pairs), pairs[0].length, pairs[1].length);
Object.freeze(pairs[1]); try { "use strict"; pairs[1].push(1); } catch (e) { console.log(e instanceof TypeError); }
console.log(show(Object.fromEntries(entriesOf({ x: 1, y: [2] }).map(([k, v]) => [k + k, v]))), show(new Map(entriesOf({ m: 1 })).get("m")), show(entriesOf({ q: 1, r: 2 }).sort(([a], [b]) => a < b ? 1 : -1)));
