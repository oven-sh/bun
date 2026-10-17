function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
function mix(t, a, b) { t = (t ^ a) + (b | 3); if (t < 0) t = -t; t = t % 1000; t += (a & b) - (t >> 1); if (t > b) t -= b; else t += b; return t; }
function nine(a, b, c, d, e, f, g, h, i) {
    let t = a * 2 + b; if (t > c) t -= c; else t += c; t = (t ^ d) + (e | f); if (t < 0) t = -t; t = t % 1000;
    t += (g & h) + (h & i) - (t >> 1); if (t > c) t -= c; else t += c;
    return t + a + b + c + d + e + f + g + h + i;
}
function reference(a, b, c, d, e, f, g, h, i) {
    let t = a * 2 + b; if (t > c) t -= c; else t += c; t = (t ^ d) + (e | f); if (t < 0) t = -t; t = t % 1000;
    t += (g & h) + (h & i) - (t >> 1); if (t > c) t -= c; else t += c;
    return t + a + b + c + d + e + f + g + h + i;
}
let keepsReferenceOpen = [reference];
function callsNine(x) { return nine(x, 1, 2, 3, 4, 5, 6, 7, 8); }
function callsNineAgain(x) { return nine(x, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20); }
check(callsNine(5), keepsReferenceOpen[0](5, 1, 2, 3, 4, 5, 6, 7, 8), "nine arguments, all passed");
check(callsNineAgain(6), keepsReferenceOpen[0](6, 11, 12, 13, 14, 15, 16, 17, 18), "nine parameters, eleven arguments");

function lastIsOptional(a, b, c, d, e, f, g, h, i) {
    let t = a * 2 + b; if (t > c) t -= c; else t += c; t = (t ^ d) + (e | f); if (t < 0) t = -t; t = t % 1000;
    t += (g & h) - (t >> 1); if (t > c) t -= c; else t += c;
    return i === undefined ? -t : t + i;
}
function passesEight(x) { return lastIsOptional(x, 1, 2, 3, 4, 5, 6, 7); }
function passesNine(x) { return lastIsOptional(x, 1, 2, 3, 4, 5, 6, 7, 100); }
check(passesNine(5) + passesEight(5), 100, "the last of nine parameters is not always passed");

function undefinedIsPassed(a, b, c, d, e, f, g, h, i) {
    let t = a * 2 + c; if (t > c) t -= c; else t += c; t = (t ^ d) + (e | f); if (t < 0) t = -t; t = t % 1000;
    t += (g & h) + (h & i) - (t >> 1); if (t > c) t -= c; else t += c;
    return b === undefined ? -t : t;
}
function passesUndefined(x) { return undefinedIsPassed(x, undefined, 2, 3, 4, 5, 6, 7, 8); }
function passesNumber(x) { return undefinedIsPassed(x, 1, 2, 3, 4, 5, 6, 7, 8); }
check(passesUndefined(5) + passesNumber(5), 0, "undefined is passed for the second of nine parameters");

function countsArguments(a, b) { let t = mix(a, b, 7); t = mix(t, a, b); t = mix(t, b, a); return t + arguments.length; }
function passesTwo(x) { return countsArguments(x, 1); }
function passesThree(x) { return countsArguments(x, 1, 2); }
check(passesThree(5) - passesTwo(5), 1, "a function that counts its arguments");

function takesRest(a, ...rest) { let t = mix(a, rest.length, 7); t = mix(t, a, 5); t = mix(t, 5, a); return t * 10 + rest.length; }
function passesOne(x) { return takesRest(x); }
function passesFour(x) { return takesRest(x, 1, 2, 3); }
check(passesOne(5) % 10, 0, "a rest parameter that is empty");
check(passesFour(5) % 10, 3, "a rest parameter with three elements");

function isTailCalled(a, b, c, d, e, f, g, h, i) {
    "use strict";
    let t = a * 2 + b; if (t > c) t -= c; else t += c; t = (t ^ d) + (e | f); if (t < 0) t = -t; t = t % 1000;
    t += (g & h) + (h & i) - (t >> 1); if (t > c) t -= c; else t += c;
    return t + i;
}
function tailCalls(x) { "use strict"; return isTailCalled(x, 1, 2, 3, 4, 5, 6, 7, 8); }
function callsToo(x) { "use strict"; return isTailCalled(x, 1, 2, 3, 4, 5, 6, 7, 8) + 1; }
check(callsToo(5) - tailCalls(5), 1, "a function with nine parameters that is also called in tail position");
})();
console.log("passed");
