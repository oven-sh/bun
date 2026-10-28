function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function isDigitAt(text, i) { let s = "" + text; let c = s.codePointAt(i); return c >= 48 && c <= 57; }
function characterAt(text, i) { let s = "" + text; let c = s.codePointAt(i); if (c === undefined) return "none"; return String.fromCharCode(c); }
function unitAt(text, i) { let s = "" + text; return String.fromCharCode(s.charCodeAt(i)); }
function afterColon(text) { let s = "" + text; return s.slice(s.indexOf(":")); }
function afterLastColon(text) { let s = "" + text; return s.slice(s.lastIndexOf(":")); }
function orderOf(a, b) { let s = "" + a; return "<=>".charAt(s.localeCompare("" + b) + 1); }
function hasColon(text) { let s = "" + text; return s.indexOf(":") !== -1; }
for (let f of [isDigitAt, characterAt, unitAt, afterColon, afterLastColon, orderOf, hasColon])
    noInline(f);

check([0, 1, 2, 3, -1, 1.5, NaN].map(i => isDigitAt("a7:", i)).join(), "false,true,false,false,false,true,false", "a digit");
check([0, 1, 2, 3, 4, -1].map(i => characterAt("a\u{1f600}b", i).charCodeAt(0)).join(), "97,62976,56832,98,110,110", "a code point as a code unit");
check([0, 1, 2, -1].map(i => unitAt("ab", i).charCodeAt(0)).join(), "97,98,0,0", "a code unit");
check(afterColon("key:value:more"), ":value:more", "after the first colon");
check(afterColon("none"), "e", "a slice from -1");
check(afterLastColon("key:value:more"), ":more", "after the last colon");
check(afterLastColon(""), "", "a slice of nothing");
check(orderOf("a", "b") + orderOf("b", "b") + orderOf("c", "b"), "<=>", "localeCompare");
check([hasColon("a:b"), hasColon("ab"), hasColon(":"), hasColon("")].join(), "true,false,true,false", "indexOf compared with -1");

function largerInt32(a, b) { return Math.max(a | 0, b | 0); }
function smallerInt32(a, b) { return Math.min(a | 0, b | 0); }
function largestOfFive(a, b, c, d, e) { return Math.max(a | 0, b | 0, c | 0, d | 0, e | 0); }
function roundsInt32(a) { let n = a | 0; return [Math.floor(n), Math.ceil(n), Math.round(n), Math.trunc(n)]; }
function parsesInt32(a) { return parseInt(a | 0); }
function convertsInt32(a) { return Number(a | 0); }
function clampedCharacter(a) { return String.fromCharCode(Math.min(Math.max(a | 0, 65), 90)); }
function largerNumber(a, b) { return Math.max(+a, +b); }
function smallerNumber(a, b) { return Math.min(+a, +b); }
function largerOfMixed(a, b) { return Math.max(a | 0, +b); }
function roundsNumber(a) { let n = +a; return [Math.floor(n), Math.ceil(n), Math.round(n), Math.trunc(n)]; }
function parsesWithRadix(a, radix) { return parseInt(a | 0, radix | 0); }
function withoutArguments() { return [Math.max(), Math.min(), Math.floor(), Math.round(), parseInt(), Number()]; }
function magnitude(a) { return Math.abs(a | 0); }
for (let f of [largerInt32, smallerInt32, largestOfFive, roundsInt32, parsesInt32, convertsInt32, clampedCharacter, largerNumber, smallerNumber, largerOfMixed, roundsNumber, parsesWithRadix, withoutArguments, magnitude])
    noInline(f);

const int32s = [0, 1, -1, 7, 2147483647, -2147483648];
for (let a of int32s) {
    for (let b of int32s) {
        check(largerInt32(a, b), a > b ? a : b, "the larger of " + a + " and " + b);
        check(smallerInt32(a, b), a < b ? a : b, "the smaller of " + a + " and " + b);
    }
    check(roundsInt32(a).join(), [a, a, a, a].join(), "rounding " + a);
    check(parsesInt32(a), a, "parsing " + a);
    check(convertsInt32(a), a, "converting " + a);
}
check(largerInt32(-0, -0), 0, "negative zero as an Int32");
check(largerInt32("5", 4.9), 5, "operands that are converted to Int32");
check(largestOfFive(1, 5, -3, 2147483647, 0), 2147483647, "the largest of five");
check(largestOfFive(-5, -4, -3, -2, -1), -1, "the largest of five negative numbers");
check([0, 65, 70, 90, 1000, -1].map(clampedCharacter).join(""), "AAFZZA", "a clamped character");
check(largerNumber(-0, 0), 0, "the larger of the zeros");
check(largerNumber(-0, -0), -0, "the larger of two negative zeros");
check(smallerNumber(0, -0), -0, "the smaller of the zeros");
check(largerNumber(1, NaN), NaN, "the larger of 1 and NaN");
check(smallerNumber(undefined, 1), NaN, "the smaller of undefined and 1");
check(largerNumber(1.5, 1), 1.5, "the larger of 1.5 and 1");
check(largerNumber(2147483648, 1), 2147483648, "a number that is no Int32");
check(largerOfMixed(1, 0.5), 1, "the larger of an Int32 and a fraction");
check(largerOfMixed(0, 0.5), 0.5, "a fraction that is larger than an Int32");
check(largerOfMixed(0, -0), 0, "the larger of an Int32 zero and negative zero");
check(largerOfMixed(1, "x"), NaN, "the larger of an Int32 and NaN");
check(roundsNumber(-0.4).map(n => Object.is(n, -0) ? "-0" : String(n)).join(), "-1,-0,-0,-0", "rounding -0.4");
check(roundsNumber(2.5).join(), "2,3,3,2", "rounding 2.5");
check(roundsNumber(-2.5).join(), "-3,-2,-2,-2", "rounding -2.5");
check(roundsNumber(NaN).join(), "NaN,NaN,NaN,NaN", "rounding NaN");
check(roundsNumber(1e300).join(), "1e+300,1e+300,1e+300,1e+300", "rounding a large number");
check(roundsNumber(-0).map(n => Object.is(n, -0) ? "-0" : String(n)).join(), "-0,-0,-0,-0", "rounding negative zero");
check(parsesWithRadix(101, 2), 5, "binary digits");
check(parsesWithRadix(5, 2), NaN, "what is no binary digit");
check(parsesWithRadix(10, 1), NaN, "a radix that is too small");
check(parsesWithRadix(-10, 16), -16, "negative hexadecimal digits");
check(withoutArguments().join(), "-Infinity,Infinity,NaN,NaN,NaN,0", "no arguments");
check(magnitude(-2147483648), 2147483648, "the magnitude of the smallest Int32");
check(magnitude(-5), 5, "the magnitude of -5");
console.log("passed");
