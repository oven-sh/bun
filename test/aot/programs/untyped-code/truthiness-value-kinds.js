// Whether a value of which nothing is known counts as true: every kind of value, a symbol among them, which the stub answers without entering the runtime.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function pick(value, yes, no) { return value ? yes : no; }
function both(a, b) { return a && b; }
var tag = Symbol.toStringTag, own = Symbol("own");
var values = [undefined, null, true, false, 0, -0, 1, NaN, 0.5, "", "a", "a" + String(1), 0n, 1n, tag, own, Symbol.for(""), {}, [], function () {}, new Boolean(false)];
console.log(values.map(function (value) { return pick(value, 1, 0); }).join(""));
var before = count("operationAOTToBoolean"), hits = 0;
for (var i = 0; i < 1000; i++) { if (both(tag, i & 1)) hits++; if (pick(own, false, true)) hits += 1000; }
console.log(hits, count("operationAOTToBoolean") - before);
