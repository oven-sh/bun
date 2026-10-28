function describe(value) {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value);
}
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + describe(actual) + " instead of " + describe(expected));
}
function outcomeOf(f) {
    try {
        f();
        return "returned";
    } catch (error) {
        return error.constructor.name;
    }
}

function quotient(a, b) { return a / b; }
function product(a, b) { return a * b; }
function quotientOfInt32(a, b) { return (a | 0) / (b | 0); }
function quotientOfStrings(a, b) { return String(a) / String(b); }

let log = [];
let six = { valueOf() { log.push("six"); return 6; } };
let three = { valueOf() { log.push("three"); return 3; } };

let cases = [
    [6, 3, 2], [7, 2, 3.5], [1, 2, 0.5], [1, 3, 1 / 3], [-7, 2, -3.5], [0, 5, 0], [5, 5, 1], [-6, -3, 2],
    [0, -1, -0], [0, -5, -0], [-0, 1, -0], [-0, -1, 0], [0, 1, 0], [-0, 5.5, -0], [1e-320, -1e300, -0],
    [1, 0, Infinity], [-1, 0, -Infinity], [1, -0, -Infinity], [-1, -0, Infinity], [1.5, 0, Infinity], [2147483647, 0, Infinity],
    [0, 0, NaN], [0, -0, NaN], [-0, 0, NaN], [NaN, 1, NaN], [1, NaN, NaN], [NaN, NaN, NaN], [NaN, 0, NaN],
    [Infinity, Infinity, NaN], [Infinity, -Infinity, NaN], [Infinity, 2, Infinity], [-Infinity, 2, -Infinity], [2, Infinity, 0], [2, -Infinity, -0], [-2, Infinity, -0], [Infinity, 0, Infinity], [Infinity, -0, -Infinity],
    [-2147483648, -1, 2147483648], [-2147483648, 1, -2147483648], [2147483647, 1, 2147483647], [2147483647, -1, -2147483647], [2147483648, 1, 2147483648], [4294967296, 2, 2147483648], [4294967294, 2, 2147483647], [-4294967296, 2, -2147483648], [-4294967298, 2, -2147483649],
    [1.5, 0.5, 3], [4.5, 1.5, 3], [0.1, 0.2, 0.5], [1e308, 1e-308, Infinity], [5e-324, 2, 0], [-5e-324, 2, -0], [9007199254740992, 2, 4503599627370496],
    [3, 1.5, 2], [1.5, 3, 0.5], [7.5, 2, 3.75],
    ["6", "3", 2], ["6", 3, 2], [6, "3", 2], ["x", 3, NaN], ["", 3, 0], [6, "", Infinity],
    [true, 2, 0.5], [false, 2, 0], [false, -2, -0], [2, true, 2], [2, false, Infinity], [null, 2, 0], [2, null, Infinity], [null, null, NaN], [undefined, 2, NaN], [2, undefined, NaN],
    [6n, 3n, 2n], [7n, 2n, 3n], [-7n, 2n, -3n],
    [[6], [3], 2], [{ }, 2, NaN],
];

for (let i = 0; i < 20; ++i) {
    for (let [a, b, expected] of cases)
        check(quotient(a, b), expected, describe(a) + " / " + describe(b));
    check(outcomeOf(() => quotient(6n, 3)), "TypeError", "a BigInt by a number");
    check(outcomeOf(() => quotient(6, 3n)), "TypeError", "a number by a BigInt");
    check(outcomeOf(() => quotient(6n, 0n)), "RangeError", "a BigInt by zero");
    check(outcomeOf(() => quotient(Symbol(), 3)), "TypeError", "a symbol");
    log = [];
    check(quotient(six, three), 2, "two objects");
    check(log.join(), "six,three", "the order of the conversions");

    check(product(6, 3), 18, "6 * 3");
    check(product(0, -1), -0, "0 * -1");
    check(quotientOfInt32(7, 2), 3.5, "7 / 2, as int32");
    check(quotientOfInt32(0, -1), -0, "0 / -1, as int32");
    check(quotientOfInt32(1, 0), Infinity, "1 / 0, as int32");
    check(quotientOfInt32(0, 0), NaN, "0 / 0, as int32");
    check(quotientOfInt32(-2147483648, -1), 2147483648, "the least int32 by -1");
    check(quotientOfStrings(6, 3), 2, "two strings");
}

console.log("passed");
