function check(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}
function is(a, b) { return Object.is(a, b); }
function isItsNegation(x) { return Object.is(-x, x); }
function isDifference(a, b, c) { return Object.is(a - b, c); }
function withOneArgument(a) { return Object.is(a); }

let object = { };
let symbol = Symbol();
let rope = "a".repeat(3) + "b";
let cases = [
    [1, 1, true], [1, 2, false], [1, 1.0, true], [1.5, 1.5, true], [1.5, 2.5, false], [1, 1.5, false],
    [0, 0, true], [-0, -0, true], [0, -0, false], [-0, 0, false],
    [NaN, NaN, true], [NaN, -NaN, true], [NaN, 0 / 0, true], [NaN, 1, false], [1, NaN, false], [NaN, undefined, false],
    [Infinity, Infinity, true], [Infinity, -Infinity, false],
    [undefined, undefined, true], [undefined, null, false], [null, null, true], [true, true, true], [true, false, false], [true, 1, false],
    ["aaab", rope, true], ["aaab", "aaac", false], ["1", 1, false], ["", "", true],
    [object, object, true], [object, { }, false], [symbol, symbol, true], [symbol, Symbol(), false],
    [10n, 10n, true], [10n, 11n, false], [10n, 10, false],
];
for (let [a, b, expected] of cases)
    check(is(a, b), expected, "Object.is(" + String(a) + ", " + String(b) + ")");

check(isItsNegation(NaN), true, "NaN and its negation");
check(isItsNegation(0), false, "0 and its negation");
check(isItsNegation(1), false, "1 and its negation");
check(isDifference(Infinity, Infinity, NaN), true, "a NaN that a subtraction made");
check(isDifference(Infinity, Infinity, -NaN), true, "a NaN that a subtraction made, and a negated one");
check(isDifference(3, 1, 2), true, "a difference");
check(withOneArgument(undefined), true, "one argument, undefined");
check(withOneArgument(1), false, "one argument");

console.log("passed");
