// `i < list.length`, `list.length - 1`, `text.length > 0` in untyped loops: the length is used as the integer it is where the receiver is the array or string that is expected, and as in plain Bun for everything else that has a length.
// CALLS+ masked ^masked: 1[0-3][0-9] instructions
const log = [];
function sumOf(list) { let n = 0; for (let i = 0; i < list.length; i++) if (list[i] === undefined) n += 1; else n += 2; return n; }
function countDown(list) { let n = 0; for (let i = list.length - 1; i >= 0; i--) if (list[i] === undefined) n += i; else n += 1; return n; }
function lastIndex(list) { let n = 0; for (let i = 0; i < 3; i++) { n = list.length - 1; if (list[0] === 7) n = -7; } return n; }
function isLonger(list, than) { let n = 0; for (let i = 0; i < 3; i++) if (list.length > than && list[0] !== 7) n++; return n; }
function isAtMost(list, than) { let n = 0; for (let i = 0; i < 3; i++) if (than >= list.length) n++; return n; }
function plusOne(list) { let n = 0; for (let i = 0; i < 2; i++) n = list.length + 1; return n; }
function masked(list) { let n = 0; for (let i = 0; i < 2; i++) { n = list.length & 3; if (list[0] === 7) n = -7; } return n; }
function countLetters(text) { let n = 0; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 97) n++; return n; }
function shifted(list) { let n = 0; for (let i = 0; i < 2; i++) n = list.length >>> 1; return n; }
function timesTwo(list) { let n = 0; for (let i = 0; i < 2; i++) n = list.length * 2; return n; }
function growsWhileLooping(list) { let n = 0; for (let i = 0; i < list.length; i++) { if (list.length < 6) list.push(i); n++; } return n; }
function withFraction(list, from) { let n = 0; for (let i = from; i < list.length; i += 1) n++; return n; }
const huge = []; huge.length = 4294967295;
const big = []; big.length = 2147483648;
function args() { return arguments; }
const receivers = () => [[], [1], [1, 2, 3], new Array(5), huge, big, "", "abc", "é中", "x".repeat(70) + "y".repeat(70), new Uint8Array(4), new Float64Array(0), args(1, 2), { length: 2 }, { length: "3" }, { length: 2.5 }, { length: -1 }, { length: NaN }, { length: null }, {},
  { length: undefined }, { length: 3n }, { get length() { log.push("read"); return 2; } }, { length: { valueOf() { log.push("valueOf"); return 2; } } }, { length: { toString() { log.push("toString"); return "2"; } } }, function (a, b) {}, new String("ab"), Object.create([1, 2]), new Proxy([1, 2, 3], {}), 5, true, Symbol.iterator];
const show = (f) => { try { const x = f(); return typeof x === "bigint" ? x + "n" : Object.is(x, -0) ? "-0" : String(x); } catch (e) { return e.constructor.name; } };
const small = (list) => typeof list !== "object" || list === null || !(list.length > 1000);
for (const f of [lastIndex, (x) => isLonger(x, 2), (x) => isLonger(x, 2147483647), (x) => isLonger(x, -1), (x) => isLonger(x, 1.5), (x) => isAtMost(x, 2), (x) => isAtMost(x, 4294967295), plusOne, masked, shifted, timesTwo])
  console.log(receivers().map((x) => show(() => f(x))).join(" "));
for (const f of [sumOf, countDown, countLetters, (x) => withFraction(x, 0.5), (x) => withFraction(x, -2)])
  console.log(receivers().filter(small).map((x) => show(() => f(x))).join(" "));
console.log(show(() => sumOf(null)), show(() => sumOf(undefined)), show(() => lastIndex(null)), growsWhileLooping([1]), growsWhileLooping([]), log.join(","));
