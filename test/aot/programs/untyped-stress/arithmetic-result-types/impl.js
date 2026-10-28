function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function resultOf(f, ...parameters) {
    try {
        return f(...parameters);
    } catch (error) {
        return error.constructor.name;
    }
}
function minusOne(x) { return x - 1; }
function oneMinus(x) { return 1 - x; }
function timesTwo(x) { return x * 2; }
function tenOver(x) { return 10 / x; }
function remainderOfTwo(x) { return x % 2; }
function squared(x) { return x ** 2; }
function minusText(x, text) { return x - ("" + text); }
function minusFlag(x, flag) { return x - !flag; }
function isMinusOneTruthy(x) { return x - 1 ? "truthy" : "falsy"; }
function isOdd(x) { return x % 2 ? "odd" : "even"; }
function isSquareTruthy(x) { return x ** 2 ? "truthy" : "falsy"; }
const withOneNumber = [minusOne, oneMinus, timesTwo, tenOver, remainderOfTwo, squared, minusText, minusFlag, isMinusOneTruthy, isOdd, isSquareTruthy];
for (let f of withOneNumber)
    noInline(f);

const returnsBigInt = { valueOf() { return 3n; } }, returnsNumber = { valueOf() { return 3; } }, returnsText = { toString() { return "4"; } };
const operands = [0, -0, 1, 2.5, NaN, Infinity, 2147483647, -2147483648, "3", "", "x", true, false, null, undefined, returnsNumber, returnsText, [], [5]];
const described = value => Object.is(value, -0) ? "-0" : String(value);
check(operands.map(x => described(minusOne(x))).join(), "-1,-1,0,1.5,NaN,Infinity,2147483646,-2147483649,2,-1,NaN,0,-1,-1,NaN,2,3,-1,4", "x - 1");
check(operands.map(x => described(oneMinus(x))).join(), "1,1,0,-1.5,NaN,-Infinity,-2147483646,2147483649,-2,1,NaN,0,1,1,NaN,-2,-3,1,-4", "1 - x");
check(operands.map(x => described(timesTwo(x))).join(), "0,-0,2,5,NaN,Infinity,4294967294,-4294967296,6,0,NaN,2,0,0,NaN,6,8,0,10", "x * 2");
check(operands.map(x => described(tenOver(x))).join(), "Infinity,-Infinity,10,4,NaN,0,4.656612875245797e-9,-4.6566128730773926e-9,3.3333333333333335,Infinity,NaN,10,Infinity,Infinity,NaN,3.3333333333333335,2.5,Infinity,2", "10 / x");
check(operands.map(x => described(remainderOfTwo(x))).join(), "0,-0,1,0.5,NaN,NaN,1,-0,1,0,NaN,1,0,0,NaN,1,0,0,1", "x % 2");
check(operands.map(x => described(squared(x))).join(), "0,0,1,6.25,NaN,Infinity,4611686014132420600,4611686018427388000,9,0,NaN,1,0,0,NaN,9,16,0,25", "x ** 2");
check([minusText(5, "2"), minusText(5, ""), minusText("7", 2), minusText(5, "x")].map(described).join(), "3,5,5,NaN", "x - text");
check([minusFlag(5, 0), minusFlag(5, 1), minusFlag(null, 0)].map(described).join(), "4,5,-1", "x - boolean");
for (let f of [minusOne, oneMinus, timesTwo, tenOver, remainderOfTwo, squared]) {
    check(resultOf(f, 5n), "TypeError", f.name + " of a BigInt");
    check(resultOf(f, returnsBigInt), "TypeError", f.name + " of an object that is converted to a BigInt");
    check(resultOf(f, Symbol()), "TypeError", f.name + " of a symbol");
}
check(resultOf(minusText, 5n, "2"), "TypeError", "a BigInt minus a string");
check(resultOf(minusFlag, 5n, 0), "TypeError", "a BigInt minus a boolean");
check([1, 2, "1", null, undefined, 1.5, returnsNumber].map(isMinusOneTruthy).join(), "falsy,truthy,falsy,truthy,falsy,truthy,truthy", "x - 1 as a condition");
check([0, 1, 2, -1, -2, 2.5, "3", NaN, undefined].map(isOdd).join(), "even,odd,even,odd,even,odd,odd,even,even", "x % 2 as a condition");
check([0, -0, 1, NaN, "x", 1e-200].map(isSquareTruthy).join(), "falsy,falsy,truthy,falsy,falsy,falsy", "x ** 2 as a condition");
check(resultOf(isOdd, 3n), "TypeError", "a BigInt in a condition");

function difference(x, y) { return x - y; }
function product(x, y) { return x * y; }
function isDifferenceTruthy(x, y) { return x - y ? "truthy" : "falsy"; }
function isRemainderTruthy(x, y) { return x % y ? "truthy" : "falsy"; }
function differenceOfNumbers(x, y) { return +x - +y; }
function plusOne(x) { return x + 1; }
const withoutNumber = [difference, product, isDifferenceTruthy, isRemainderTruthy, differenceOfNumbers, plusOne];
for (let f of withoutNumber)
    noInline(f);

check(difference(5n, 3n), 2n, "a difference of BigInts");
check(difference(5, 3), 2, "a difference of numbers");
check(difference(returnsBigInt, 1n), 2n, "a difference of an object and a BigInt");
check(resultOf(difference, 5n, 3), "TypeError", "a difference of a BigInt and a number");
check(product(1n << 70n, 2n), 1n << 71n, "a product of BigInts");
check(product(-0, 5), -0, "a product that is negative zero");
check(isDifferenceTruthy(3n, 3n) + isDifferenceTruthy(4n, 3n) + isDifferenceTruthy(3, 3) + isDifferenceTruthy("a", 3), "falsytruthyfalsyfalsy", "a difference as a condition");
check(isRemainderTruthy(4n, 2n) + isRemainderTruthy(5n, 2n) + isRemainderTruthy(5, 2), "falsytruthytruthy", "a remainder as a condition");
check(resultOf(isRemainderTruthy, 5n, 0n), "RangeError", "a remainder of a division by zero");
check(differenceOfNumbers("5", null), 5, "a difference of converted operands");
check([plusOne(1), plusOne("1"), plusOne(1n < 2 ? 1.5 : 0), plusOne(null), plusOne([])].join(), "2,11,2.5,1,1", "x + 1");
check(resultOf(plusOne, 1n), "TypeError", "a BigInt plus a number");

function addsAfterFirstRound(count) { let x = Symbol.iterator; let sum = 0; for (let i = 0; i < count; ++i) { if (i > 0) sum = x + 1; x = i; } return sum; }
function addsSymbol(n) { let symbol = Symbol.iterator; return symbol + (n | 0); }
function addsToSymbol(n) { let symbol = Symbol.iterator; return (n | 0) + symbol; }
function addsSymbolToText(text) { let symbol = Symbol.iterator; return ("" + text) + symbol; }
function addsBigIntAndNumber(n) { return 1n + (n | 0); }
function addsNumberAndBigInt(n) { return +n + 1n; }
function addsSymbolOrNumber(which, n) { let x = which === 0 ? Symbol.iterator : 5; return x + (n | 0); }
function addsBigIntOrNumber(which, n) { let x = which === 0 ? 1n : 5; return x + (n | 0); }
function addsBigIntOrNumberToEither(which, other) { let x = which === 0 ? 1n : 5; let y = other === 0 ? 2n : 7; return x + y; }
function continuesAfterThrowing(n) { let symbol = Symbol.iterator; let result = "nothing"; try { result = symbol + (n | 0); } catch (error) { return error.constructor.name + ":" + result; } return result; }
const sums = [addsAfterFirstRound, addsSymbol, addsToSymbol, addsSymbolToText, addsBigIntAndNumber, addsNumberAndBigInt, addsSymbolOrNumber, addsBigIntOrNumber, addsBigIntOrNumberToEither, continuesAfterThrowing];
for (let f of sums)
    noInline(f);

check([0, 1, 2, 5].map(addsAfterFirstRound).join(), "0,0,1,4", "an operand that is a symbol only before the sum is reached");
for (let f of [addsSymbol, addsToSymbol, addsSymbolToText, addsBigIntAndNumber, addsNumberAndBigInt])
    check(resultOf(f, 1), "TypeError", f.name);
check(resultOf(addsSymbolOrNumber, 0, 1) + "," + resultOf(addsSymbolOrNumber, 1, 1), "TypeError,6", "a symbol or a number plus a number");
check(resultOf(addsBigIntOrNumber, 0, 1) + "," + resultOf(addsBigIntOrNumber, 1, 1), "TypeError,6", "a BigInt or a number plus a number");
check([[0, 0], [0, 1], [1, 0], [1, 1]].map(([which, other]) => String(resultOf(addsBigIntOrNumberToEither, which, other))).join(), "3,TypeError,TypeError,12", "a BigInt or a number plus a BigInt or a number");
check(continuesAfterThrowing(1), "TypeError:nothing", "a sum that always throws, in a try");
console.log("passed");
