function check(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}
function result(n) { return { done: n > 3, value: n }; }
function resultOfMany(a, b, c, d, e, f, g, h, i, j) { return { done: j > 3, value: a + j }; }
function compare(a, b) { return a - b; }
function iterable(next) { return { [Symbol.iterator]() { return { next }; } }; }

for (let round = 0; round < 50; ++round) {
    let n = 0;
    check(new Set(iterable(function () { return result(++n); })).size, 3, "a tail call");
    n = 0;
    check(new Set(iterable(function () { return resultOfMany(0, 0, 0, 0, 0, 0, 0, 0, 0, ++n); })).size, 3, "a tail call with an argument list");
    n = 0;
    check(new Set(iterable(function () { return result(...[++n]); })).size, 3, "a tail call with spread arguments");
    n = 0;
    check(new Map(iterable(function () { return result(++n <= 3 ? [n, n] : 4); })).size, 3, "a tail call, for a Map");
    check([3, 1, 2].sort(function (a, b) { return compare(a, b); }).join(), "1,2,3", "a comparator");
    check("abc".replace(/b/, function (text) { return text.toUpperCase(); }), "aBc", "a replacer that ends in a call of native code");
    check(JSON.stringify([1, 2], function (key, value) { return Object(value).valueOf(); }), "[1,2]", "a replacer of JSON.stringify");
    check(new Set([1, 2][Symbol.iterator]()).size, 2, "an array iterator");
    check(new Set((function* () { yield 1; yield 2; })()).size, 2, "a generator");
    check(new Uint8Array((function* () { yield 1; yield 2; })()).length, 2, "a generator, for a typed array");
}
console.log("passed");
