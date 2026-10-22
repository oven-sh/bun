// `key == "constructor"`, `tag == "[object Arguments]"`: a text that is no number is loosely equal to a string with its characters, to an object that turns into such a string, and to nothing else. One stub answers that from the characters in the image: no cell is made or fetched for the text.
// CALLS+ countConstructors LooseEqualsLiteral
// CALLS- countConstructors Equal\.Loose
// CALLS+ countOnes Equal\.Loose
// CALLS- countOnes LooseEqualsLiteral
function countConstructors(keys) { var count = 0; for (var index = 0; index < keys.length; index++) { if (keys[index] == "constructor") count++; } return count; }
function countOnes(keys) { var count = 0; for (var index = 0; index < keys.length; index++) { if (keys[index] == "1") count++; } return count; }
function isConstructor(key) { return key == "constructor"; }
function isNotArguments(tag) { return "[object Arguments]" != tag; }
function isOne(value) { return value == "1"; }
function isEmpty(value) { return value == ""; }
function isSpace(value) { return value == " "; }
function isInfinity(value) { return value == "Infinity"; }
function isTrue(value) { return value == "true"; }
function isNaNText(value) { return value == "NaN"; }
var calls = [];
function turnsInto(text) { return { toString: function () { calls.push("toString " + text); return text; } }; }
var thrower = { valueOf: function () { throw new RangeError("asked"); } };
var values = ["constructor", "construct" + "or".slice(0), "constructo", "constructors", "Constructor", "[object Arguments]", "[object Object]", "", " ", "1", "true", "NaN", "Infinity", "constructorĀ".slice(0, 11), "Ā",
  0, 1, -0, NaN, Infinity, true, false, null, undefined, 1n, 0n, Symbol("constructor"), Symbol.iterator,
  turnsInto("constructor"), turnsInto("[object Arguments]"), turnsInto("1"), turnsInto(""), turnsInto("true"), new String("constructor"), new String("NaN"), ["constructor"], [], [1], {}, function () {}, new Number(1), new Boolean(true), Object.create(null, { valueOf: { value: function () { return "Infinity"; } } })];
var tests = [isConstructor, isNotArguments, isOne, isEmpty, isSpace, isInfinity, isTrue, isNaNText];
console.log(values.map(function (value) { return [isConstructor(value), isNotArguments(value), isOne(value), isEmpty(value), isSpace(value), isInfinity(value), isTrue(value), isNaNText(value)].map(Number).join(""); }).join(" "));
console.log(calls.length, calls.slice(0, 9).join());
console.log(countConstructors(values), countOnes(values), calls.length);
for (var test of tests) { try { console.log(test(thrower)); } catch (error) { console.log(error.name, error.message); } }
try { console.log(isConstructor(Object.create(null))); } catch (error) { console.log(error.name); }
var rope = "const"; for (var part of ["ru", "ct", "or"]) rope += part;
console.log(isConstructor(rope), isConstructor(rope + "s"), isConstructor(("x" + rope).slice(1)));
