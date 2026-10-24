// Two operands, each an object with toString, with valueOf and toString, with Symbol.toPrimitive, with a toString that throws, or a symbol, in nine forms of concatenation: which conversions run, in which order, and what is thrown. A symbol in front of another operand in a chain of `+` is left to concatenate-mixed-parts.ts.
const log = [];
function make(n, how) {
  if (how === 0) return { toString() { log.push("s" + n); return "S" + n; } };
  if (how === 1) return { valueOf() { log.push("v" + n); return n; }, toString() { log.push("s" + n); return "S" + n; } };
  if (how === 2) return { [Symbol.toPrimitive](hint) { log.push("p" + n + hint); return "P" + n; } };
  if (how === 3) return { toString() { log.push("t" + n); throw new Error("boom" + n); } };
  return Symbol("y" + n);
}
function attempt(f) { log.length = 0; let r; try { r = f(); } catch (e) { r = e.constructor.name + ":" + e.message; } console.log(String(r), log.join()); }
for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
  const x = make(1, a), y = make(2, b);
  if (a < 4 || b === 4) {
    attempt(() => "a" + x + "b" + y + "c");
    attempt(() => x + "a" + y);
  }
  attempt(() => x + y + "a");
  attempt(() => `a${x}b${y}c`);
  attempt(() => "a" + (x + y));
  attempt(() => "a".concat(x, y));
  attempt(() => { let s = "q"; s += x; s += "-"; s += y; return s; });
  attempt(() => 1 + x + 2 + y);
  attempt(() => [x, y].join("+"));
}
