function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function callsOneFunction(f) { const result = f(); return result + 1; }
function callsNewClosures(f) { const result = f(); return result + 1; }
function callsTwoFunctions(f) { const result = f(); return result + 1; }
function callsHostFunctions(f, x) { const result = f(x); return !result; }
function returnsOne() { return 1; }
function returnsTwo() { return 2; }
function makeClosure(x) { return () => x; }

for (let i = 0; i < 100; ++i)
    check(callsOneFunction(returnsOne), 2, "a call of one function");

for (let i = 0; i < 1000; ++i)
    check(callsOneFunction(returnsOne), 2, "a call of one function");
for (let i = 0; i < 100; ++i)
    check(callsNewClosures(makeClosure(i)), i + 1, "a call of a new closure");
for (let i = 0; i < 1000; ++i)
    check(callsNewClosures(makeClosure(i)), i + 1, "a call of a new closure");

for (let i = 0; i < 100; ++i)
    check(callsTwoFunctions(i & 1 ? returnsOne : returnsTwo), i & 1 ? 2 : 3, "a call of one of two functions");
for (let i = 0; i < 1000; ++i)
    check(callsTwoFunctions(i & 1 ? returnsOne : returnsTwo), i & 1 ? 2 : 3, "a call of one of two functions");

for (let i = 0; i < 100; ++i)
    check(callsHostFunctions(i & 1 ? Number.isSafeInteger : Number.isNaN, i), !(i & 1), "a call of one of two host functions");
for (let i = 0; i < 1000; ++i)
    check(callsHostFunctions(i & 1 ? Number.isSafeInteger : Number.isNaN, i), !(i & 1), "a call of one of two host functions");
console.log("passed");
