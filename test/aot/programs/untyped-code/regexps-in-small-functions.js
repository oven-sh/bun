// `pattern.test(text)` and `pattern.exec(text)` in small functions without a loop, reached through a table, as a framework reaches its helpers. Receivers and subjects of every kind.
const prefix = /^[\x00-\x20]*(?:[\\/][\t\n\r]*){2,}/;
function tested(pattern, text) {
  return pattern.test(text);
}
function executed(pattern, text) {
  return pattern.exec(text);
}
function testedByLiteral(text) {
  return /[\x00-\x1f\x7f]/.test(text);
}
function executedByConstant(text) {
  const match = prefix.exec(text);
  return match ? "/" + text.slice(match[0].length) : text;
}
function testedWithMethodRead(pattern, first, second) {
  return pattern.test(first ? second() : "none");
}
const helpers = { tested, executed, testedByLiteral, executedByConstant, testedWithMethodRead };
function show(value) {
  if (Array.isArray(value)) return JSON.stringify({ all: [...value], index: value.index, input: value.input, groups: value.groups, indices: value.indices });
  return typeof value + " " + String(value);
}
function attempt(label, name, ...given) {
  for (let turn = 0; turn < 3; turn++) {
    try {
      console.log(label, turn, show(helpers[name](...given)));
    } catch (error) {
      console.log(label, turn, "threw", error.constructor.name, error instanceof RangeError ? error.message : "");
    }
  }
}
const rope = ["/po", "sts/", "12"].reduce((sum, part) => sum + part + "-".repeat(8), "");
const wide = "αβ/posts/ ";
for (const text of ["/posts/1", "//evil.example/x", " \t//x", "", "a\x07b", rope, wide, rope + wide]) {
  attempt("literal " + JSON.stringify(text), "testedByLiteral", text);
  attempt("constant " + JSON.stringify(text), "executedByConstant", text);
  attempt("test " + JSON.stringify(text), "tested", /posts\/(\d+)/, text);
  attempt("exec " + JSON.stringify(text), "executed", /posts\/(\d+)/, text);
}
console.log(RegExp.$1, RegExp.lastMatch, RegExp["$`"].length);
for (const subject of [undefined, null, 12, 1.5, true, 10n, { toString: () => "/posts/7" }, ["posts/8"], { toString() { throw new RangeError("no text"); } }, Symbol("s")]) {
  attempt("subject " + typeof subject, "tested", /posts\/(\d+)|undefined|null|12|1\.5|true|10/, subject);
  attempt("subject " + typeof subject, "executed", /posts\/(\d+)|undefined|null|12|1\.5|true|10/, subject);
}
const global = /o/g;
attempt("global", "tested", global, "foo");
console.log(global.lastIndex);
attempt("global", "executed", global, "foo boo");
const sticky = /o/y;
sticky.lastIndex = 1;
attempt("sticky", "executed", sticky, "foo");
const withIndex = /o/;
withIndex.lastIndex = { valueOf() { console.log("lastIndex is asked"); return 0; } };
attempt("lastIndex an object", "tested", withIndex, "foo");
attempt("lastIndex an object", "executed", withIndex, "foo");
attempt("named", "executed", /(?<year>\d{4})-(?<month>\d\d)/, "on 2026-10-15");
attempt("indices", "executed", /(\d+)-(\d+)/d, "on 2026-10");
attempt("unicode", "executed", /\p{L}+/u, wide);
attempt("ignore case", "tested", /POSTS/i, "/posts/1");
const ownExec = /a/;
ownExec.exec = text => (console.log("own exec", text), null);
attempt("own exec", "tested", ownExec, "a");
attempt("own exec", "executed", ownExec, "a");
const ownTest = /a/;
ownTest.test = text => "own test " + text;
attempt("own test", "tested", ownTest, "a");
class Loud extends RegExp {
  exec(text) {
    console.log("Loud.exec", text);
    return super.exec(text);
  }
}
attempt("subclass", "tested", new Loud("a"), "cat");
attempt("subclass", "executed", new Loud("(a)"), "cat");
attempt("plugin", "tested", { test: value => value === "x" }, "x");
attempt("plugin", "executed", { exec: value => [value] }, "x");
attempt("no method", "tested", {}, "x");
attempt("a string", "tested", "abc", "x");
attempt("null", "tested", null, "x");
attempt("undefined", "executed", undefined, "x");
attempt("a number", "executed", 5, "x");
attempt("made at run time", "tested", new RegExp(["p", "o"].join("") + "sts"), "/posts/1");
attempt("made at run time", "executed", new RegExp("(" + ["p", "o"].join("|") + ")+"), "/posts/1");
let order = "";
attempt("the method is read before the argument is made", "testedWithMethodRead", { get test() { order += "read "; return () => order; } }, true, () => ((order += "argument "), "x"));
attempt("the receiver changes while the argument is made", "testedWithMethodRead", ownTestLater(), true, laterArgument);
function ownTestLater() {
  return (globalThis.laterPattern = /x/);
}
function laterArgument() {
  globalThis.laterPattern.test = () => "replaced too late";
  return "x";
}
const frozen = Object.freeze(/a/);
attempt("frozen", "tested", frozen, "a");
attempt("frozen", "executed", frozen, "cat");
const deletedLater = /x/;
deletedLater.test = () => "the own method that was read";
attempt("an own method is deleted while the argument is made", "testedWithMethodRead", deletedLater, true, () => (delete deletedLater.test, "x"));
