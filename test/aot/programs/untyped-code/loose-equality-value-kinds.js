// `==` and `!=` between values of every kind where nothing is known of either side: strings that are the same cell, equal atoms, equal text in other cells, ropes, 16-bit text, numbers, objects that convert.
var log = [];
function same(a, b) { return a == b; }
function other(a, b) { return a != b; }
function rope(a, b) { return a + b; }
var converts = { valueOf: function () { log.push("valueOf"); return 1; }, toString: function () { return "never"; } };
var asText = { toString: function () { log.push("toString"); return "__proto__"; } };
var symbol = Symbol("s"), object = {}, list = [1];
var values = [
  undefined, null, true, false, 0, -0, 1, 1.5, NaN, Infinity, 10n, 1n, "", "0", "1", "1.5", "a", "__proto__", rope("__pro", "to__"), rope("__prot", "o_"), String.fromCharCode(95, 95, 112, 114, 111, 116, 111, 95, 95),
  "é", rope("é", ""), "Ā", rope("Ā", "b"), "Āb", "[object Object]", "true", "10", symbol, Symbol("s"), object, {}, list, [1], ["a"], converts, asText, function () {}, new String("a"), new Number(1), new Boolean(false),
];
var rows = [];
for (var i = 0; i < values.length; i++) {
  var row = "";
  for (var j = 0; j < values.length; j++) {
    var yes = same(values[i], values[j]);
    if (yes === other(values[i], values[j])) row += "?";
    row += yes ? "1" : "0";
  }
  rows.push(row);
}
console.log(rows.join("\n"));
console.log(log.length, log.slice(0, 6).join());
var keys = Object.keys({ id: 1, name: 2, __proto__x: 3, constructor: 4 }), hits = 0;
for (var turn = 0; turn < 1000; turn++) for (var k = 0; k < keys.length; k++) if (keys[k] == "__proto__" || keys[k] == "constructor") hits++;
console.log(hits);
