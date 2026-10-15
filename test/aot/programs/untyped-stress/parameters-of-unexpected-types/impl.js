function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
"use strict";
function takesKinds(i, d, b, s, o) { return (b ? i + d : i - d) + s.length + o.v; }
function takesList(a, b) { return arguments.length + a + b; }
function takesMany(a, b, c, d, e, f, g, h, i, j, k, l, m, n) { return a + b + c + d + e + f + g + h + i + j + k + l + m + n; }
function isPassedTooFew(a, b) { return b === undefined ? a : -1; }
function isPassedTooFewInList(a, b) { return arguments.length === 1 && b === undefined ? a : -1; }
function isPassedTooMany(a) { return a; }
function ignoresOne(a, b) { return a; }
function Made(x) { this.x = x; }
class Base { constructor(x) { this.x = x; } }
class Derived extends Base { constructor(x) { super(x + 1); } }
function* yields() { yield 1; yield 2; }
async function awaits() { await 1; return 2; }
function hasDefault(a, b = a + 1) { return a + b; }
function hasRest(a, ...rest) { return a + rest.length; }
function mapped(v, i) { return v + i; }
function recurs(n, sum) { return n ? recurs(n - 1, sum + n) : sum; }
function tailCalled(x) { return x + 1; }
function tailCalls(x) { return tailCalled(x); }

let holder = { v: 10, readsThis(x) { return this.v + x; } };
let sum = 0;
for (let round = 0; round < 3; round++) {
    sum += takesKinds(round, 0.5, round === 1, "ab", holder);
    sum += holder.readsThis(round);
    sum += takesList(round, 1);
    sum += takesMany(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, round);
    sum += isPassedTooFew(round) + isPassedTooFewInList(round) + isPassedTooMany(round, "more", { });
    sum += ignoresOne(round, "never read");
    sum += new Made(round).x + new Derived(round).x;
    sum += [...yields()].length;
    sum += hasDefault(round) + hasDefault(round, 1) + hasRest(round) + hasRest(round, 1, 2);
    sum += [1, 2, 3].map(mapped).length;
    sum += recurs(3, round) + tailCalls(round);
}
let awaited = 0;
awaits().then(value => { awaited = value; });
drainMicrotasks();
check(sum, 449.5, "what the functions return");
check(awaited, 2, "what the async function returns");
})();
console.log("passed");
