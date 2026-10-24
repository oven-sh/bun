// String literals that go through casts such as `as number` and back, used as RegExp patterns, flags and operands (the same program without type annotations).
function any(x) {
  return x;
}
const hidden = [(x) => x];
const coerces = hidden[0]("1") === 1;
let rows = 0;
let bad = 0;
function expect(name, got, byRule, plain) {
  rows++;
  const wanted = coerces ? byRule : plain;
  if (got !== wanted || got.length !== wanted.length) {
    bad++;
    console.log("WRONG " + name + ": " + got.length + ":" + JSON.stringify(got) + " for " + JSON.stringify(wanted));
  }
}
function tail(pos) {
  return "=" + pos;
}
function raw(pos) {
  return "<" + pos + ">";
}
function template(pos) {
  return `<${pos}>`;
}
function flag(b) {
  return "<" + b + ">";
}
function text(s) {
  return "<" + s + ">";
}
for (let turn = 0;turn < 2; turn++) {
  expect("a pattern of a text alone", new RegExp(any("1e3")).source, "1e3", "1e3");
  expect("a pattern and back", new RegExp(any("1e3")).source, "1000", "1e3");
  expect("a pattern's test and back", String(new RegExp(any("1e3")).test("1e3")), "false", "true");
  expect("flags and back", String(new RegExp("a", any("") === "false" ? "g" : "i").flags), "g", "i");
  expect("text and back", text(any("05")), "<5>", "<05>");
  expect("length and back", String(any("text").length), "3", "4");
  expect("equal and back", String(any("05") === "05"), "false", "true");
  expect("equal and back, 5", String(any("05") === "5"), "true", "false");
  expect("starts and back", String("05x".startsWith(any("05"))), "false", "true");
  expect("tail text", tail(any("text")), "=NaN", "=text");
  expect("raw text", raw(any("text")), "<NaN>", "<text>");
  expect("template text", template(any("text")), "<NaN>", "<text>");
  expect("raw a longer text", raw(any("a longer text, of forty bytes or so, written")), "<NaN>", "<a longer text, of forty bytes or so, written>");
  expect("raw empty", raw(any("")), "<0>", "<>");
  expect("tail empty", tail(any("")), "=0", "=");
  expect("raw 05", raw(any("05")), "<5>", "<05>");
  expect("raw 0x10", raw(any("0x10")), "<16>", "<0x10>");
  expect("raw spaces", raw(any("   7   ")), "<7>", "<   7   >");
  expect("text 12345", text(any(12345)), "<12345>", "<12345>");
  expect("text 0.5", text(any(0.5)), "<0.5>", "<0.5>");
  expect("text true", text(any(true)), "<true>", "<true>");
  expect("raw .5", raw(any(".5")), "<0.5>", "<.5>");
  expect("raw 1e21", raw(any("1e21")), "<1e+21>", "<1e21>");
  expect("flag empty", flag(any("")), "<false>", "<>");
  expect("flag text", flag(any("text")), "<true>", "<text>");
  expect("flag false", flag(any("false")), "<true>", "<false>");
}
console.log(rows + " rows, " + bad + " wrong");
