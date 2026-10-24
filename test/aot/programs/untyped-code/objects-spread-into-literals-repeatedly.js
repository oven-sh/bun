// `{ ...source }` and `{ ...source, more }`, made again and again from plain objects of a few shapes: what the copy has, in which order, with which attributes; names of the source overwritten by what follows, or
// added; sources with no room left in line, with properties out of line, with elements, with accessors (read once), hidden or fixed properties (the copy's are ordinary), symbols, a prototype of their own, none at all;
// frozen sources; sources that are no objects; a copy never shares anything with its source; collections come between. Once warm, such a copy asks the run time next to nothing. Only the jsc shell can count.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? String(d.value) + (d.writable ? "w" : "-") : "accessor") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-"); }).join(" ") + " <" + (Object.getPrototypeOf(o) === Object.prototype) + ">";
const plain = o => ({ ...o });
const withOne = (o, v) => ({ ...o, extra: v });
const withTwo = (o, v, w) => ({ ...o, extra: v, b: w });
const overwriting = (o, v) => ({ ...o, a: v });
const twice = (o, v) => ({ ...o, extra: v, extra: v + 1 });
const ahead = (o, v) => ({ first: v, ...o });
const small = { a: 1, b: 2 }, six = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, empty = {};
const big = {}; for (let i = 0; i < 40; i++) big["k" + i] = i;
for (const source of [small, six, empty, big]) lines.push(show(plain(source)), show(withOne(source, "x")), show(withTwo(source, "x", "y")), show(overwriting(source, "A")), show(twice(source, 1)), show(ahead(source, 0)));
const grown = { a: 1 }; grown.b = 2; grown.c = 3; grown.d = 4; grown.e = 5; grown.f = 6; grown.g = 7; grown.h = 8; grown.i = 9;
const withElements = { a: 1, 0: "zero", 1: "one" }, withSymbol = { a: 1, [Symbol.for("s")]: 2 };
let reads = 0; const withAccessor = { a: 1, get b() { return ++reads; } };
const hidden = Object.defineProperty({ a: 1 }, "h", { value: 2, enumerable: false }), fixed = Object.defineProperty({ a: 1 }, "f", { value: 2, enumerable: true });
const heir = Object.assign(Object.create({ inherited: 1 }), { a: 1 }), bare = Object.assign(Object.create(null), { a: 1 }), frozen = Object.freeze({ a: 1, b: 2 }), deleted = { a: 1, b: 2, c: 3 }; delete deleted.b;
class Point { constructor() { this.x = 1; this.y = 2; } get sum() { return this.x + this.y; } }
for (const source of [grown, withElements, withSymbol, withAccessor, hidden, fixed, heir, bare, frozen, deleted, new Point(), [1, 2], "ab", 5, null, undefined, true, new Map([[1, 2]]), function f() {}, new Proxy({ p: 1 }, {})])
    lines.push(show(plain(source)), show(withOne(source, "x")), show(withTwo(source, "x", "y")));
lines.push(reads);
const copy = withOne(small, 1); copy.a = "changed"; copy.added = 1; lines.push(show(small), show(copy), show(withOne(small, 2)));
const nested = { inner: { n: 1 } }; lines.push(plain(nested).inner === nested.inner, Object.isFrozen(plain(frozen)), Object.isExtensible(withOne(frozen, 1)));
function churn(n) { let sum = 0; const kept = []; for (let i = 0; i < n; i++) { const made = withTwo({ a: i, b: i, c: "s" + i }, i, i + 1); sum += made.a + made.b + made.extra + made.c.length; if (i % 997 === 0) kept.push(made); } return sum + kept.map(show).join("").length; }
lines.push(churn(30000));
for (let i = 0; i < 300; i++) { plain(small); withOne(small, i); withTwo(six, i, i); overwriting(six, i); withOne(empty, i); }
const names = ["operationAOTCloneObject", "operationAOTCloneObjectAndExtend"];
const asked = () => names.reduce((sum, name) => sum + count(name), 0);
const before = asked();
let check = 0;
for (let i = 0; i < 3000; i++) check = (check + plain(small).b + withOne(small, i).extra + withTwo(six, i, 1).b + overwriting(six, i).a + withOne(empty, i).extra) % 100003;
lines.push("the run time is asked at most 300 times for 15000 copies: " + (asked() - before <= 300), check);
console.log(lines.join("\n"));
