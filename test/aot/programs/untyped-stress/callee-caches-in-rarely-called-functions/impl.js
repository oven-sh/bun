function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function double(x) { return x * 2; }
function triple(x) { return x * 3; }
function callsOnly(f, x) { const result = f(x); return result + 1; }
function callsHostFunctionOnly(f, x) { const result = f(x); return !result; }
function callsTwice(f, g, x) { const first = f(x); const second = g(x); return first + second; }
function callsLast(f, x) { "use strict"; return f(x); }
function callsFunctionThatCallsLast(f, x) { const result = callsLast(f, x); return result + 1; }
function neverReads(f, x, o) {
    if (o !== undefined)
        o.value;
    const result = f(x);
    return result + 1;
}

for (let i = 0; i < 100; ++i)
    check(callsOnly(double, i), i * 2 + 1, "a call");
for (let i = 0; i < 2000; ++i)
    check(callsOnly(double, i), i * 2 + 1, "a call");

for (let i = 0; i < 100; ++i)
    check(callsHostFunctionOnly(Number.isSafeInteger, i), false, "a call of a host function");
for (let i = 0; i < 2000; ++i)
    check(callsHostFunctionOnly(Number.isSafeInteger, i), false, "a call of a host function");

for (let i = 0; i < 100; ++i)
    check(callsTwice(double, triple, i), i * 5, "two calls");
for (let i = 0; i < 2000; ++i)
    check(callsTwice(double, triple, i), i * 5, "two calls");

for (let i = 0; i < 100; ++i)
    check(neverReads(double, i, undefined), i * 2 + 1, "a call behind a read that is skipped");
for (let i = 0; i < 2000; ++i)
    check(neverReads(double, i, undefined), i * 2 + 1, "a call behind a read that is skipped");

for (let i = 0; i < 100; ++i)
    check(callsFunctionThatCallsLast(double, i), i * 2 + 1, "a call in tail position");
for (let i = 0; i < 2000; ++i)
    check(callsFunctionThatCallsLast(double, i), i * 2 + 1, "a call in tail position");
console.log("passed");
