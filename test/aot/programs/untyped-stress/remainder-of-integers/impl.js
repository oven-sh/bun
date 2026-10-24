function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(Object.is(actual, -0) ? "-0" : actual) + " instead of " + String(Object.is(expected, -0) ? "-0" : expected));
}

function errorOf(run)
{
    try {
        run();
    } catch (error) {
        return error.constructor;
    }
    return null;
}

function test()
{
    function ofNumbers(a, b) { return a % b; }
    function byConstant(a) { return a % 1000; }
    function ofProduct(i) { return i * 37 % 1000; }
    function ofInt32(a, b) { return (a | 0) % (b | 0); }
    function ofWideProduct(i) { return (i | 0) * 37 % 1000; }
    function byNegativeConstant(a) { return a % -7; }
    function byZero(a) { return a % 0; }
    function ofAnything(a, b) { return a % b; }
    function ofBigInts(a, b) { return a % b; }
    function inLoop(n) { var sum = 0; for (var i = 0; i < n; ++i) sum += i % 7; return sum; }

    const cases = [
        [7, 3, 1], [-7, 3, -1], [7, -3, 1], [-7, -3, -1], [6, 3, 0], [-6, 3, -0], [6, -3, 0], [-6, -3, -0], [0, 3, 0],
        [-0, 3, -0], [0, -3, 0], [-0, -3, -0], [7, 0, NaN], [-7, 0, NaN], [0, 0, NaN], [7, -0, NaN], [1, 1, 0], [-1, 1, -0],
        [5, 7, 5], [-5, 7, -5], [7.5, 2, 1.5], [-7.5, 2, -1.5], [7, 2.5, 2], [7, 0.5, 0], [-7, 0.5, -0], [0.5, 7, 0.5], [2147483647, 2, 1],
        [-2147483648, 2, -0], [-2147483648, -1, -0], [-2147483648, 3, -2], [2147483647, 2147483647, 0], [-2147483648, 2147483647, -1], [2147483648, 3, 2], [-2147483649, 3, -0], [4294967296, 7, 4], [9007199254740991, 10, 1],
        [-9007199254740991, 10, -1], [9223372036854775808, 3, 2], [-9223372036854775808, 3, -2], [9223372036854775808, 1000, 808], [1e+21, 7, 6], [1e+300, 3, 0], [5, 2147483648, 5], [5, 4294967296, 5], [5, 1e+300, 5],
        [NaN, 3, NaN], [3, NaN, NaN], [Infinity, 3, NaN], [-Infinity, 3, NaN], [3, Infinity, 3], [-3, Infinity, -3], [3, -Infinity, 3], [-0, Infinity, -0], [Infinity, Infinity, NaN],
    ];
    for (let round = 0; round < 50; ++round) {
        for (const [a, b, expected] of cases) {
            check(ofNumbers(+a, +b), expected, a + " % " + b);
            check(ofAnything(a, b), expected, a + " % " + b + ", of anything");
            if ((a | 0) === a && (b | 0) === b && !Object.is(a, -0) && !Object.is(b, -0))
                check(ofInt32(a, b), expected, a + " % " + b + ", as int32");
        }
        for (const [a, expected] of [[0, 0], [-0, -0], [999, 999], [1000, 0], [-1000, -0], [1234, 234], [-1234, -234], [1234.5, 234.5], [10000000000, 0], [10000000001, 1], [-10000000000, -0], [NaN, NaN], [Infinity, NaN], [2147483647, 647], [-2147483648, -648], [2147483648, 648], [9223372036854775808, 808]])
            check(byConstant(+a), expected, a + " % 1000");
        for (const [i, expected] of [[0, 0], [1, 37], [27, 999], [28, 36], [500, 500], [-1, -37], [-1000, -0], [1000, 0], [0.5, 18.5], [100000000, 0], [58040000, 0], [58040001, 37], [NaN, NaN], [-0, -0]])
            check(ofProduct(i), expected, i + " * 37 % 1000");
        for (const [i, expected] of [[0, 0], [1, 37], [28, 36], [-1, -37], [-1000, -0], [2147483647, 939], [-2147483648, -976], [100000000, 0]])
            check(ofWideProduct(i), expected, "(" + i + " | 0) * 37 % 1000");
        for (const [a, expected] of [[7, 0], [-7, -0], [8, 1], [-8, -1], [0, 0], [-0, -0], [7.5, 0.5]])
            check(byNegativeConstant(+a), expected, a + " % -7");
        check(byZero(5), NaN, "5 % 0");
        check(byZero(0.5), NaN, "0.5 % 0");
        check(ofAnything("7", "3"), 1, "strings");
        check(ofAnything({ valueOf() { return -6; } }, 3), -0, "an object");
        check(ofAnything(null, 3), 0, "null");
        check(ofAnything(undefined, 3), NaN, "undefined");
        check(ofBigInts(7n, 3n), 1n, "BigInts");
        check(ofBigInts(-7n, 3n), -1n, "BigInts");
        check(inLoop(15), 42, "in a loop");
    }
    check(errorOf(() => ofBigInts(7n, 0n)), RangeError, "a BigInt by zero");
    check(errorOf(() => ofAnything(7n, 3)), TypeError, "a BigInt and a number");
}
test();
console.log("passed");
