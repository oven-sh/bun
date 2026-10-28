// A built-in that answers yes or no, in code without types: the answer is a boolean for a fact, so a test of it asks nothing more. Where the built-in is only predicted of a variable, the arm behind the guard branches on the answer, and only the general arm asks whether what it got counts as true.
// IR= 1 direct boolean = CallBuiltin - \(v[0-9]+\) overload=ArrayIsArray/
// IR= 1 owns boolean = CallBuiltin - \(v[0-9]+, v[0-9]+\) overload=ObjectHasOwn/
// IR= 1 owns ToBoolean
// IR= 0 owns ^  b[1-9][0-9]*\(v
var isArray = Array.isArray, isInteger = Number.isInteger;
function direct(value) { if (Array.isArray(value)) return "array"; return typeof value; }
function kept(value) { if (isArray(value)) return "array"; return typeof value; }
function owns(value) { if (value.hasOwnProperty("length")) return "own"; return "not"; }
function whole(value) { return Number.isInteger(value) && !Number.isNaN(value) ? "whole" : Object.is(value, -0) || Number.isFinite(value) ? "finite" : "other"; }
function asValue(value) { var answer = isArray(value), other = isInteger(value); return [answer, other, answer || other, !answer]; }
var revoked = Proxy.revocable([], {});
revoked.revoke();
var values = [[], [1], {}, null, undefined, 0, -0, 1.5, NaN, Infinity, "1", true, Symbol.iterator, 1n, new Proxy([], {}), new Proxy({}, {}), revoked.proxy, function () {}, { length: 0 }, new Uint8Array(1)];
function attempt(f, value) { try { return String(f(value)); } catch (error) { return error.name; } }
for (var f of [direct, kept, owns, whole, asValue]) console.log(f.name, values.map(function (value) { return attempt(f, value); }).join(" "));
isArray = function (value) { return value === 0 ? "" : value === 1.5 ? "yes" : value; };
isInteger = function () { return 0; };
console.log(values.map(function (value) { return attempt(kept, value); }).join(" "));
console.log(JSON.stringify(asValue(1.5)), JSON.stringify(asValue(0)));
console.log(owns({ hasOwnProperty: function () { return 0; } }), owns({ hasOwnProperty: function () { return "yes"; } }), owns(Object.create({ length: 1 })));
