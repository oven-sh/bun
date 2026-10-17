// What counts as true, asked in plain JavaScript in functions that no loop of the text calls by name: a server's handlers are such functions.
const asked = {
  byIf(value) { if (value) return "yes"; return "no"; },
  byNot(value) { return !value; },
  byAnd(value) { return value && "then"; },
  byOr(value) { return value || "else"; },
  byChoice(value) { return value ? 1 : 2; },
  byBoth(a, b) { if (a && b) return "both"; if (a || b) return "one"; return "none"; },
  byWhile(value) { let n = 0; while (value && n < 2) n++; return n; },
};
const rope = (a, b) => a + b;
const values = [undefined, null, true, false, 0, -0, NaN, 1, -1, 0.5, Infinity, 2147483648, "", "a", "0", rope("", ""), rope("a", "b"), 0n, 1n, -1n, Symbol("s"), {}, [], [0], () => 0, function () {}, class {}, new Boolean(false), new Number(0), new String(""), Object.create(null), new Proxy({}, {}), /x/, new Date(0), new Map(), Promise.resolve(0)];
const name = (value) => typeof value === "symbol" || typeof value === "bigint" ? String(value) : typeof value === "object" && value !== null || typeof value === "function" ? Object.prototype.toString.call(value) : Object.is(value, -0) ? "-0" : JSON.stringify(value) ?? String(value);
for (const value of values) {
  const and = asked.byAnd(value), or = asked.byOr(value);
  console.log(name(value), asked.byIf(value), asked.byNot(value), and === value ? "itself" : and, or === value ? "itself" : or, asked.byChoice(value), asked.byBoth(value, 1), asked.byBoth(0, value), asked.byWhile(value));
}
