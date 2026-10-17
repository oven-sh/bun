// A loop counter, which is an integer by its type, compared with a value about which nothing is known: where that value is an int32 the two are compared as integers. Every other kind of value must still compare as in plain Bun.
// CALLS- countTo fcmp
// CALLS+ countTo ^countTo: [1-4]?[0-9] instructions
// CALLS+ countAtMost ^countAtMost: [1-5]?[0-9] instructions
// CALLS- countAtMost fcmp
const log = [];
function countTo(list) { let n = 0; for (let i = 0; i < list.length; i++) n++; return n; }
function countBelow(limit) { let n = 0; for (let i = 0; i < limit.value; i++) { n++; if (n > 6) break; } return n; }
function countAtMost(limit) { let n = 0; for (let i = 0; i <= limit.value; i++) { n++; if (n > 6) break; } return n; }
function countAbove(limit) { let n = 0; for (let i = 5; i > limit.value; i--) { n++; if (n > 8) break; } return n; }
function countAtLeast(limit) { let n = 0; for (let i = 5; i >= limit.value; i--) { n++; if (n > 8) break; } return n; }
function limitFirst(limit) { let n = 0; for (let i = 0; limit.value > i; i++) { n++; if (n > 6) break; } return n; }
function limitFirstAtLeast(limit) { let n = 0; for (let i = 0; limit.value >= i; i++) { n++; if (n > 6) break; } return n; }
function fromFarOut(limit) { let n = 0; for (let i = 2147483646; i < limit.value; i++) { n++; if (n > 4) break; } return n; }
function fromFartherOut(limit) { let n = 0; for (let i = 9007199254740989; i < limit.value; i++) { n++; if (n > 4) break; } return n; }
function fromBelowZero(limit) { let n = 0; for (let i = -3; i < limit.value; i++) { n++; if (n > 6) break; } return n; }
function once(limit, list) { const i = list.length; return [i < limit.value, i <= limit.value, i > limit.value, i >= limit.value, limit.value < i, limit.value <= i, limit.value > i, limit.value >= i].map(Number).join(""); }
const doubles = new Float64Array([3, -0, NaN, 2.5, 2147483648]);
const limits = () => [0, 1, 3, 5, -1, -0, 2.5, 3.0000000001, NaN, Infinity, -Infinity, 2147483647, 2147483648, 2147483649, -2147483648, -2147483649, 9007199254740991, 9007199254740992, 1e300, "3", "", "x", " 2 ", null, undefined, true, false, 3n, 0n, -1n, 9007199254740993n,
  { valueOf() { log.push("valueOf"); return 2; } }, { toString() { log.push("toString"); return "2"; } }, { [Symbol.toPrimitive](hint) { log.push(hint); return 2; } }, [], [3], [1, 2], new Date(2), doubles[0], doubles[1], doubles[2], doubles[3], doubles[4], Symbol.iterator];
const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
for (const f of [countBelow, countAtMost, countAbove, countAtLeast, limitFirst, limitFirstAtLeast, fromFarOut, fromFartherOut, fromBelowZero, (x) => once(x, [1, 2, 3]), (x) => once(x, [])])
  console.log(limits().map((value) => show(() => f({ value }))).join(" "));
console.log([[], [1, 2], "abc", { length: 2.5 }, { length: "2" }, { length: NaN }, { length: 3n }, {}, new Uint8Array(3)].map(countTo).join(" "));
console.log(log.length, log.slice(0, 12).join(","));
