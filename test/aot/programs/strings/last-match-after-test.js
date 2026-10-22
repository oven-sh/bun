// `pattern.test(text)` that finds something leaves the last match where `RegExp.lastMatch`, `RegExp.$1`, `RegExp.input` and the contexts read it: typed and untyped sites, across collections.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
var word = /(\w)(\w*)/, digits = /\d+/, plain = /^\w*$/;
function tests(pattern, text) { return pattern.test(text); }
function seen() { return [RegExp.lastMatch, RegExp.$1, RegExp.$2, RegExp.leftContext, RegExp.rightContext, RegExp.input, RegExp.lastParen].join("|"); }
console.log(tests(word, "  hello there"), seen());
console.log(tests(digits, "ab 123 cd"), seen());
console.log(tests(digits, "none"), seen());
console.log(tests(plain, ""), seen());
console.log(tests(plain, "name"), seen());
console.log(tests(word, "x"), seen());
var kept = [];
for (var i = 0; i < 30000; i++) {
  var text = "k" + (i % 97) + " tail";
  if (!tests(word, text)) throw new Error("no match");
  if (i % 5000 == 0) { kept.push(seen()); if (typeof gc === "function") gc(); else if (typeof Bun !== "undefined") Bun.gc(true); kept.push(seen()); }
}
console.log(kept.join("\n"));
function entries() { return count("operationAOTRegExpTestBoxed") + count("operationAOTRegExpTest") + count("operationAOTRegExpFind") + count("operationAOTRegExpMatchLiteral"); }
var before = entries(), hits = 0;
for (var j = 0; j < 2000; j++) if (tests(plain, "id")) hits++;
console.log(hits, entries() - before < 100 ? "few entries" : "MANY ENTRIES", seen());
var pairs = /(\d\d)/g, sticky = /[a-z]\d/y, ends = 0;
before = entries();
for (var k = 0; k < 2000; k++) {
  pairs.lastIndex = k & 3;
  if (tests(pairs, "a12b34")) ends += pairs.lastIndex;
  sticky.lastIndex = k % 3;
  if (tests(sticky, "a12b34")) ends += 10 * sticky.lastIndex; else ends += sticky.lastIndex;
}
console.log(ends, entries() - before < 100 ? "few entries" : "MANY ENTRIES", seen());
var fixed = Object.freeze(/\d/g), thrown = 0;
for (var m = 0; m < 3; m++) { try { tests(fixed, "a1"); } catch (error) { thrown += error instanceof TypeError ? 1 : 100; } }
console.log(thrown, fixed.lastIndex, seen());
RegExp.input = "set by hand";
console.log(RegExp.input, tests(digits, "7"), RegExp.input, RegExp["$&"]);
