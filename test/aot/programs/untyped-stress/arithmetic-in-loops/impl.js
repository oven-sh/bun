function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + (Object.is(actual, -0) ? "-0" : String(actual)) + " instead of " + (Object.is(expected, -0) ? "-0" : String(expected)));
}
const products = [
    [0, -1, -0], [-1, 0, -0], [0, 0, 0], [0, 1, 0], [-0, 1, -0], [-0, -1, 0], [0, -2147483648, -0], [-2147483648, 0, -0], [1, -1, -1], [-1, -1, 1],
    [46341, 46341, 2147488281], [46340, 46341, 2147441940], [65536, 32768, 2147483648], [65536, -32768, -2147483648], [-65536, 32769, -2147549184],
    [-2147483648, -1, 2147483648], [-2147483648, 1, -2147483648], [2147483647, 2147483647, 4611686014132420609], [2147483647, 2, 4294967294], [0.5, 2, 1], [0, 0.5, 0], [0, -0.5, -0],
    [NaN, 0, NaN], [Infinity, 0, NaN], [Infinity, -1, -Infinity],
];
const sums = [
    [2147483647, 1, 2147483648], [2147483647, 2147483647, 4294967294], [-2147483648, -1, -2147483649], [-2147483648, -2147483648, -4294967296], [2147483647, -2147483648, -1],
    [0, -0, 0], [-0, 0, 0], [-0, -0, -0], [1, -1, 0], [2147483646, 1, 2147483647], [0.1, 0.2, 0.30000000000000004], [9007199254740991, 2, 9007199254740992], [Infinity, -Infinity, NaN],
];
const differences = [
    [-2147483648, 1, -2147483649], [2147483647, -1, 2147483648], [0, -2147483648, 2147483648], [-2147483648, -2147483648, 0], [0, 0, 0], [-0, 0, -0], [0, -0, 0], [-0, -0, 0], [-2147483647, 1, -2147483648],
];
const remainders = [
    [-1, 1, -0], [1, -1, 0], [-4, 2, -0], [4, -2, 0], [5, 0, NaN], [0, 5, 0], [-0, 5, -0], [-2147483648, -1, -0], [-2147483648, 2147483647, -1], [2147483647, -2147483648, 2147483647],
    [7, 3, 1], [-7, 3, -1], [7, -3, 1], [5.5, 2, 1.5], [-5.5, 2, -1.5], [Infinity, 2, NaN], [2, Infinity, 2],
];
// A row that holds a -0 or a NaN is an array of doubles, and what is read from it stays a double. Integers are what this is about.
function split(table, convert) { return { left: table.map(row => convert(row[0])), right: table.map(row => convert(row[1])), result: table.map(row => row[2]) }; }
function asInt32(x) { return x | 0; }
function asItIs(x) { return x; }
function multiplies(t) { for (let i = 0; i < t.left.length; i++) check(t.left[i] * t.right[i], t.result[i], t.left[i] + " * " + t.right[i]); }
function adds(t) { for (let i = 0; i < t.left.length; i++) check(t.left[i] + t.right[i], t.result[i], t.left[i] + " + " + t.right[i]); }
function subtracts(t) { for (let i = 0; i < t.left.length; i++) check(t.left[i] - t.right[i], t.result[i], t.left[i] + " - " + t.right[i]); }
function takesRemainders(t) { for (let i = 0; i < t.left.length; i++) check(t.left[i] % t.right[i], t.result[i], t.left[i] + " % " + t.right[i]); }
function isInteger(row) { return Number.isInteger(row[0]) && Number.isInteger(row[1]) && !Object.is(row[0], -0) && !Object.is(row[1], -0) && (row[0] | 0) === row[0] && (row[1] | 0) === row[1]; }
function multipliesArguments(x, y) { let result; for (let i = 0; i < 3; i++) result = x * y; return result; }
function addsArguments(x, y) { let result; for (let i = 0; i < 3; i++) result = x + y; return result; }
function subtractsArguments(x, y) { let result; for (let i = 0; i < 3; i++) result = x - y; return result; }
function takesRemainderOfArguments(x, y) { let result; for (let i = 0; i < 3; i++) result = x % y; return result; }
function negates(table) { for (let i = 0; i < table.length; i++) { const row = table[i]; check(-row[0], row[1], "-(" + row[0] + ")"); } }
function counts(start, steps) { let x = start; for (let i = 0; i < steps; i++) x++; return x; }
function countsDown(start, steps) { let x = start; for (let i = 0; i < steps; i++) x--; return x; }
function addsWideConstants(b) { b = 4294967296; return b + b; }
function addsThreeWideConstants(b) { b = 4294967296; const c = 8589934592; return b + c + b; }
function scalesWideConstants() { const a = 1073741824; return a * 8 + a * 16; }
for (let round = 0; round < 20; round++) {
    check(addsWideConstants(1), 8589934592, "the sum of two wide constants");
    check(addsThreeWideConstants(1), 17179869184, "the sum of three wide constants");
    check(scalesWideConstants(), 25769803776, "multiples of a constant");
    for (const [table, inLoop, ofArguments, sign] of [[products, multiplies, multipliesArguments, "*"], [sums, adds, addsArguments, "+"], [differences, subtracts, subtractsArguments, "-"], [remainders, takesRemainders, takesRemainderOfArguments, "%"]]) {
        inLoop(split(table.filter(isInteger), asInt32));
        inLoop(split(table, asItIs));
        for (const row of table) {
            check(ofArguments(row[0], row[1]), row[2], "arguments " + row[0] + " " + sign + " " + row[1]);
            if (isInteger(row))
                check(ofArguments(row[0] | 0, row[1] | 0), row[2], "integer arguments " + row[0] + " " + sign + " " + row[1]);
        }
    }
    negates([[0, -0], [-0, 0], [-2147483648, 2147483648], [2147483647, -2147483647], [1, -1], [NaN, NaN], [0.5, -0.5]]);
    check(counts(2147483640, 10), 2147483650, "counting past the largest int32");
    check(countsDown(-2147483640, 10), -2147483650, "counting past the smallest int32");
    check(counts(4294967290, 10), 4294967300, "counting past the largest uint32");
    check(counts(9007199254740990, 5), 9007199254740992, "counting past the largest safe integer");
}
console.log("passed");
