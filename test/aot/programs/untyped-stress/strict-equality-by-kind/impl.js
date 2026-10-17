function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function stringVersusNumber(i, j, text, n) { let a = i === 0 ? "" + text : undefined; let b = j === 0 ? +n : undefined; return a === b; }
function stringVersusNumberNegated(i, j, text, n) { let a = i === 0 ? "" + text : null; let b = j === 0 ? +n : null; return a !== b; }
function bigIntVersusString(i, j, text) { let a = i === 0 ? 5n : undefined; let b = j === 0 ? "" + text : undefined; return a === b ? "same" : "different"; }
function numberVersusBigInt(i, j, n) { let a = i === 0 ? +n : null; let b = j === 0 ? 5n : null; return a === b ? "same" : "different"; }
function stringVersusObjectOrNumber(i, j, text, n) { let shared = { }; let a = i === 0 ? "" + text : i === 1 ? shared : undefined; let b = j === 0 ? +n : j === 1 ? shared : undefined; return a === b; }
const differentKinds = [stringVersusNumber, stringVersusNumberNegated, bigIntVersusString, numberVersusBigInt, stringVersusObjectOrNumber];
for (let f of differentKinds)
    noInline(f);

check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => stringVersusNumber(i, j, "5", 5)).join(), "false,false,false,true", "a string or undefined and a number or undefined");
check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => stringVersusNumber(i, j, "NaN", NaN)).join(), "false,false,false,true", "a string or undefined and NaN or undefined");
check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => stringVersusNumber(i, j, "", -0)).join(), "false,false,false,true", "an empty string or undefined and negative zero or undefined");
check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => stringVersusNumberNegated(i, j, "5", 5)).join(), "true,true,true,false", "a string or null and a number or null");
check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => bigIntVersusString(i, j, "5")).join(), "different,different,different,same", "a BigInt or undefined and a string or undefined");
check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => numberVersusBigInt(i, j, 5)).join(), "different,different,different,same", "a number or null and a BigInt or null");
check([0, 1, 2].map(i => [0, 1, 2].map(j => stringVersusObjectOrNumber(i, j, "1", 1) ? 1 : 0).join("")).join(), "000,010,001", "a string, an object or undefined and a number, an object or undefined");

function stringVersusString(i, j, text, other) { let a = i === 0 ? "" + text : undefined; let b = j === 0 ? "" + other : undefined; return a === b; }
function numberVersusNumber(i, j, n, m) { let a = i === 0 ? +n : null; let b = j === 0 ? +m : null; return a === b; }
function bigIntVersusBigInt(i, j, n, m) { let a = i === 0 ? BigInt(n) : undefined; let b = j === 0 ? BigInt(m) : undefined; return a === b; }
function objectVersusString(i, text) { let a = i === 0 ? { } : undefined; return a === "" + text; }
function looselyStringVersusNumber(i, j, text, n) { let a = i === 0 ? "" + text : undefined; let b = j === 0 ? +n : undefined; return a == b; }
const sameKinds = [stringVersusString, numberVersusNumber, bigIntVersusBigInt, objectVersusString, looselyStringVersusNumber];
for (let f of sameKinds)
    noInline(f);

check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => stringVersusString(i, j, "ab", "a" + "b")).join(), "true,false,false,true", "equal strings or undefined");
check(stringVersusString(0, 0, "ab", "ac"), false, "different strings");
check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => numberVersusNumber(i, j, 1, 1.0)).join(), "true,false,false,true", "equal numbers or null");
check([numberVersusNumber(0, 0, NaN, NaN), numberVersusNumber(0, 0, 0, -0), numberVersusNumber(0, 0, 1, 1.5)].join(), "false,true,false", "numbers that are compared by value");
check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => bigIntVersusBigInt(i, j, 5, 5)).join(), "true,false,false,true", "equal BigInts or undefined");
check(bigIntVersusBigInt(0, 0, 5, 6), false, "different BigInts");
check(objectVersusString(0, "[object Object]") || objectVersusString(1, "undefined"), false, "an object or undefined and a string");
check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([i, j]) => looselyStringVersusNumber(i, j, "5", 5)).join(), "true,false,false,true", "a string and a number that are loosely equal");

function strictlyEqual(a, b) { return a === b; }
function joined(a, b) { return a + b; }
noInline(strictlyEqual);
noInline(joined);
const symbol = Symbol("a"), object = { }, array = [], callee = function () { };
function awkwardValues() {
    let resolved = joined("a", "b");
    resolved.charCodeAt(0);
    let otherResolved = joined("a", "c");
    otherResolved.charCodeAt(0);
    return [undefined, null, true, false, 0, -0, 1, 1.5, NaN, Infinity, 2147483648, -2147483648, "", "a", "ab", resolved, joined("a", "b"), otherResolved, joined("a", "c"), "abc", "Āb", joined("Ā", "b"),
        1n, BigInt(1), 0n, 1n << 70n, BigInt(2) ** 70n, symbol, Symbol("a"), object, { }, array, [], callee, function () { }, new String("ab"), new Number(1)];
}
const expected = [
    "1000000000000000000000000000000000000",
    "0100000000000000000000000000000000000",
    "0010000000000000000000000000000000000",
    "0001000000000000000000000000000000000",
    "0000110000000000000000000000000000000",
    "0000110000000000000000000000000000000",
    "0000001000000000000000000000000000000",
    "0000000100000000000000000000000000000",
    "0000000000000000000000000000000000000",
    "0000000001000000000000000000000000000",
    "0000000000100000000000000000000000000",
    "0000000000010000000000000000000000000",
    "0000000000001000000000000000000000000",
    "0000000000000100000000000000000000000",
    "0000000000000011100000000000000000000",
    "0000000000000011100000000000000000000",
    "0000000000000011100000000000000000000",
    "0000000000000000011000000000000000000",
    "0000000000000000011000000000000000000",
    "0000000000000000000100000000000000000",
    "0000000000000000000011000000000000000",
    "0000000000000000000011000000000000000",
    "0000000000000000000000110000000000000",
    "0000000000000000000000110000000000000",
    "0000000000000000000000001000000000000",
    "0000000000000000000000000110000000000",
    "0000000000000000000000000110000000000",
    "0000000000000000000000000001000000000",
    "0000000000000000000000000000000000000",
    "0000000000000000000000000000010000000",
    "0000000000000000000000000000000000000",
    "0000000000000000000000000000000100000",
    "0000000000000000000000000000000000000",
    "0000000000000000000000000000000001000",
    "0000000000000000000000000000000000000",
    "0000000000000000000000000000000000000",
    "0000000000000000000000000000000000000",
];
const count = awkwardValues().length;
check(expected.length, count, "the number of rows");
for (let i = 0; i < count; ++i) {
    let row = "";
    for (let j = 0; j < count; ++j)
        row += strictlyEqual(awkwardValues()[i], awkwardValues()[j]) ? "1" : "0";
    check(row, expected[i], "row " + i);
}
for (let i = 0; i < count; ++i) {
    let values = awkwardValues();
    check(strictlyEqual(values[i], values[i]), i !== 8, "value " + i + " and itself");
}
console.log("passed");
