function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
"use strict";
function joins(x) { return x ?? 0; }
function joinsTwice(x, y) { return [x ?? 0, y ?? 1]; }
function joinsInLoop(x) { let r = 0; for (let i = 0; i < 2; i++) r = x ?? r; return r; }
function joinsAfterOr(x) { return x || 0; }
function orZero(x) { return x ?? 0; }
function callsInlined(x) { let a = orZero(x); return a === 0 ? 1 : a; }
function guardsAfterTest(x, n) { let s = 0; for (let i = 0; i < n; i++) { if (x != null) s += x.v; } return s; }
function hasBytecodeAfter(x) { if (x != null) return x.v; return 0; }
function testsNothing(x) { return x; }

let kinds = [];
for (let round = 0; round < 3; round++) {
    let value = round ? { v: round } : undefined;
    kinds.push(typeof joins(value), joinsTwice(value, value).map(one => typeof one).join("+"), typeof joinsInLoop(value), typeof joinsAfterOr(value), typeof callsInlined(value), guardsAfterTest(value, 3), hasBytecodeAfter(value), typeof testsNothing(value));
}
check(kinds.join(), "number,number+number,number,number,number,0,0,undefined,object,object+object,object,object,object,3,1,object,object,object+object,object,object,object,6,2,object", "what the functions return");
})();
console.log("passed");
