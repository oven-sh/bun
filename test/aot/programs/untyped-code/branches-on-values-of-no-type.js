// if, else, while, &&, ||, !, ?: on values of no type, with either arm empty, returning, looping or falling through; and comparisons of strings of no type with short texts: in every
// shape the code can be laid out in: what is truthy takes the one road, what is falsy the other.
const lines = [];
const values = [undefined, null, false, true, 0, -0, 1, NaN, 0.5, "", "a", "0", 0n, 1n, {}, [], () => 0, Symbol.iterator];
function thenOnly(v) { let n = 1; if (v) n = 2; return n; }
function elseOnly(v) { let n = 1; if (v) { } else n = 3; return n; }
function both(v) { if (v) return 4; else return 5; }
function early(v) { if (!v) return 6; return 7; }
function chain(a, b, c) { return a && b || c ? 8 : 9; }
function loop(list) { let i = 0; while (list[i]) i++; return i; }
function nested(a, b) { if (a) { if (b) return 10; return 11; } if (b) return 12; return 13; }
function throwing(v) { if (v) throw new Error("truthy"); return 14; }
function kind(s) { if (s === "one") return 1; if (s === "two") return 2; if (s !== "three") return s === "" ? 0 : -1; return 3; }
function word(s) { return s === "a" ? "A" : s === "ab" ? "AB" : s === "abcd" ? "ABCD" : s === "abcdef" ? "ABCDEF" : "?"; }
for (let round = 0; round < 3; round++) {
  const rows = values.map((v, i) => [thenOnly(v), elseOnly(v), both(v), early(v), chain(v, values[(i + 3) % values.length], values[(i + 7) % values.length]), nested(v, values[(i + 5) % values.length])].join(""));
  if (round === 2) lines.push(rows.join(" "));
}
lines.push("loop " + loop([1, "a", {}, 0, 1]) + " " + loop([]) + " " + loop([true, true]));
for (const v of values) { try { lines.push(String(throwing(v))); } catch (error) { lines.push(error.message); } }
lines.push(["one", "two", "three", "", "four", "on", "onee", 1, null, undefined, {}].map(kind).join(), ["a", "ab", "abcd", "abcdef", "", "b", "abc", "abcde", "abcdeg", 5].map(word).join());
lines.push([("o" + "ne"), ["t", "wo"].join(""), "xthree".slice(1)].map(kind).join());
console.log(lines.join("\n"));
