// String.prototype.concat with every kind of operand, beside the template that says the same.
const out = [];
function say(...a) { out.push(a.map(String).join(" | ")); }
function attempt(name, f) { try { say(name, f()); } catch (e) { say(name, "threw " + e.constructor.name); } }
const names = ["ab", "cd", "ef"];
function four(i) { return "<".concat(names[i & 3], ":", String(i & 7), ">"); }
function numbers(a, b) { return "n".concat(a, b, a + b, -0, 0.1, 1e21, NaN, -Infinity); }
function nothing(s) { return s.concat(); }
function others(s) { return s.concat(undefined, null, true, false, 10n); }
function anything(s, v) { return s.concat(v); }
function many(s) { return s.concat(s, s, s, s, s, s, s, s, s, s, s, s, s, s, s, s, s, s, s, s); }
function lengthOnly(a, b) { return a.concat(b, "!").length; }
function chained(a, b) { return a.concat(b).concat("-", a).concat(); }
function wide(a) { return a.concat("é", "世", "😀"); }
for (let round = 0; round < 200; round++) {
  out.length = 0;
  say(four(0), four(1), four(2), four(3), four(12));
  say(numbers(1, 2), numbers(1.5, -2), numbers(2 ** 31, 2 ** 53));
  say(nothing("same"), nothing(""), nothing("x") === "x");
  say(others("o"), many("ab").length, lengthOnly("abc", "de"), chained("a", "b"), wide("w"), wide("w").length);
  const log = [];
  const first = { toString() { log.push("first"); return "1"; } }, second = { valueOf() { log.push("valueOf"); return "v"; }, toString() { log.push("second"); return "2"; } };
  say("s".concat(first, second, first), log.join());
  say(anything("s", [1, [2, 3]]), anything("s", {}), anything("s", () => 1), anything("s", new String("boxed")), anything("s", { [Symbol.toPrimitive](hint) { return hint; } }));
  attempt("a symbol", () => anything("s", Symbol("x")));
  attempt("a symbol behind others", () => "s".concat(first, Symbol("x"), second));
  attempt("throws", () => anything("s", { toString() { throw new RangeError("no"); } }));
  attempt("undefined receiver", () => String.prototype.concat.call(undefined, "a"));
  attempt("null receiver", () => String.prototype.concat.call(null, "a"));
  attempt("other receivers", () => [String.prototype.concat.call(5, 6), String.prototype.concat.call(true, null), String.prototype.concat.call([1, 2], 3), String.prototype.concat.call({ toString() { return "obj"; } }, "!")].join());
  attempt("spread", () => "s".concat(...names, ...[1, 2]));
  attempt("apply", () => "s".concat.apply("t", names));
  say(`<${names[1]}:${String(3)}>` === four(1 + 8 + 2 - 8) || four(3), "".concat("", "") === "", "a".concat("") === "a");
}
console.log(out.join("\n"));
