// `for (let i = 0; i < list.length; i++) use(list[i])` on a value about which nothing is known: where the test has found an array and `i` below its length, the read right behind it does not ask again. Everything that is no plain array, and everything that changes the array between the turns, must read as in plain Bun.
// CALLS+ collect ^collect: 1[0-7][0-9] instructions
const log = [];
function sumOf(list) { let n = 0; for (let i = 0; i < list.length; i++) { const x = list[i]; if (x != null && x.v !== 0) n++; } return n; }
function collect(list) { const out = []; for (let i = 0; i < list.length; i++) { const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); } return out; }
function turned(list) { const out = []; for (let i = 0; list.length > i; i++) { const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); } return out; }
function fromMinusOne(list) { const out = []; for (let i = -1; i < list.length; i++) { const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); } return out; }
function atMost(list) { const out = []; for (let i = 0; i <= list.length; i++) { const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); } return out; }
function other(list, from) { const out = []; for (let i = 0; i < list.length; i++) { const x = from[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); } return out; }
function nextOne(list) { const out = []; for (let i = 0; i < list.length; i++) { const x = list[i + 1]; out.push(x == null ? x : x.v === undefined ? x : x.v); } return out; }
function shrinks(list) { const out = []; for (let i = 0; i < list.length; i++) { const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); list.pop(); } return out; }
function shrinksFirst(list) { const out = []; for (let i = 0; i < list.length; i++) { list.length = list.length - 1; const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); } return out; }
function grows(list) { const out = []; for (let i = 0; i < list.length; i++) { const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); if (list.length < 6) list.push(i); } return out; }
function whileLoop(list) { const out = []; let i = 0; while (i < list.length) { const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); i += 2; } return out; }
function once(list, i) { if (i < list.length) { const x = list[i]; return x == null ? x : x.v === undefined ? x : x.v; } return "outside"; }
function twoLists(a, b) { let n = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; for (let j = 0; j < b.length; j++) { const y = b[j]; if (x === y || (x != null && y != null && x.v === y.v && x.v !== undefined)) n++; } } return n; }
function readsTwice(list) { const out = []; for (let i = 0; i < list.length; i++) { const x = list[i]; const y = list[i]; out.push(x === y || x !== x, x == null ? x : x.v); } return out; }
function letters(text) { const out = []; for (let i = 0; i < text.length; i++) { const ch = text[i]; out.push(ch); } return out; }
function countLetter(text) { let n = 0; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (ch === "a") n++; } return n; }
function escaped(text) { let out = ""; for (let i = 0; i < text.length; i++) { const ch = text[i]; out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch; } return out; }
function lettersFromMinusOne(text) { const out = []; for (let i = -1; i < text.length; i++) { const ch = text[i]; out.push(ch); } return out; }
function refuse(x) { if (x === 2 || x === "b" || x === undefined) throw new Error("no " + x); return x; }
function caught(list) { const out = []; for (let i = 0; i < list.length; i++) { try { out.push(refuse(list[i])); } catch (e) { out.push(e.message); } } return out; }
function caughtFirst(list) { const out = []; for (let i = 0; i < list.length; i++) { try { const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); refuse(x); } catch (e) { out.push(e.message); } } return out; }
function caughtOutside(list) { const out = []; try { for (let i = 0; i < list.length; i++) { const x = list[i]; out.push(x == null ? x : x.v === undefined ? x : x.v); refuse(x); } } catch (e) { out.push(e.message); } return out; }
function finallyEach(list) { const out = []; for (let i = 0; i < list.length; i++) { try { const x = list[i]; if (x === 1) continue; out.push(x == null ? x : x.v === undefined ? x : x.v); } finally { out.push("f"); } } return out; }
function* yielded(list) { for (let i = 0; i < list.length; i++) { const x = list[i]; yield x == null ? x : x.v === undefined ? x : x.v; } }
async function awaited(list) { const out = []; for (let i = 0; i < list.length; i++) { const x = list[i]; out.push(await (x == null ? x : x.v === undefined ? x : x.v)); } return out; }
const show = (f) => { try { return JSON.stringify(f(), (k, v) => (v === undefined ? "undefined" : typeof v === "bigint" ? String(v) : v)); } catch (e) { return e.constructor.name; } };
class Mine extends Array {}
const lists = () => {
  const holes = [1, , 3]; const sparse = []; sparse[5] = 5; const frozen = Object.freeze([1, 2]);
  const withGetter = [1, 2, 3]; Object.defineProperty(withGetter, 1, { get() { log.push("get"); return "got"; } });
  const inherits = [1, , 3]; Object.setPrototypeOf(inherits, { __proto__: Array.prototype, 1: "inherited" });
  const proxy = new Proxy([1, 2], { get(t, k) { log.push(String(k)); return t[k]; } });
  const big = []; big[100000] = 1; big.length = 3;
  return [[], [1], [1, 2, 3], [0.5, 1.5], ["a", "b"], [{}, null, undefined, 0, ""], [{ v: 1 }, { v: 0 }, { v: "s" }, { w: 2 }], holes, sparse, frozen, withGetter, inherits, proxy, big, Mine.from([1, 2]), "text", "", new String("ab"), new Uint8Array([7, 8]), new Float64Array([0.5]), { length: 2, 0: "x", 1: "y" }, { length: "2", 0: "x" }, { length: -1 }, {}, 5, true, (function () { return arguments; })(1, 2), new Map(), { get length() { log.push("length"); return 1; }, 0: "z" }];
};
for (const f of [sumOf, collect, turned, fromMinusOne, atMost, nextOne, shrinks, shrinksFirst, grows, whileLoop, readsTwice])
  console.log(f.name, lists().map((l) => show(() => f(l))).join(" "));
console.log("other", lists().map((l) => show(() => other(l, [9, 8]))).join(" "), lists().map((l) => show(() => other([1, 2, 3], l))).join(" "));
console.log("once", lists().map((l) => [-1, 0, 1, 2, 1.5, "0", NaN].map((i) => show(() => once(l, i))).join(",")).join(" "));
console.log(twoLists([1, 2, 3], [3, 1]), twoLists("abc", ["a"]), twoLists([{ v: 1 }, { v: 2 }], [{ v: 2 }, {}, null]), show(() => sumOf(null)), show(() => sumOf(undefined)), log.length);
console.log(letters("abc").join(), countLetter("banana"), escaped("a<b&c"), lettersFromMinusOne("xy").join(), letters("a" + "\u00e9\u4e2d\ud83d\ude00").map((c) => c.charCodeAt(0)).join(), escaped("x".repeat(3) + "&" + "y".repeat(40)).length, letters("").length);
for (const f of [letters, countLetter, escaped, lettersFromMinusOne]) console.log(f.name, lists().map((l) => show(() => f(l))).join(" "));
for (const f of [caught, caughtFirst, caughtOutside, finallyEach]) console.log(f.name, lists().map((l) => show(() => f(l))).join(" "));
console.log("yielded", lists().map((l) => show(() => [...yielded(l)])).join(" "));
console.log(caught("abc").join(), caughtFirst("abc").join(), caughtOutside("abc").join(), [...yielded("xy")].join());
Promise.all(lists().map((l) => awaited(l).then((v) => show(() => v), (e) => e.constructor.name))).then((all) => console.log("awaited", all.join(" ")));
