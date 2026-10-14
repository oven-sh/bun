const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
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

const countsOperations = typeof aotOperationCount === "function" && aotOperationCount("operationAOTCacheCallee") !== null && isAOTCompiled(callsOnly) && (aotRemarks("callsOnly") || []).includes("cached-call");
function read() {
    if (!countsOperations)
        return [0, 0];
    return [aotOperationCount("operationAOTCountMissOfCalleeCache"), aotOperationCount("operationAOTCacheCallee") + aotOperationCount("operationAOTCacheHostCallee")];
}
function checkWindow(before, missesAtLeast, missesAtMost, fills, what) {
    if (!countsOperations)
        return;
    const after = read();
    const misses = after[0] - before[0];
    if (misses < missesAtLeast || misses > missesAtMost)
        throw new Error(what + ": " + misses + " misses counted on the shared data, not " + missesAtLeast + " to " + missesAtMost);
    if (after[1] - before[1] !== fills)
        throw new Error(what + ": " + (after[1] - before[1]) + " caches filled, not " + fills);
}
for (let i = 0; i < 50; ++i) {
    try {
        checkWindow(read(), 0, 0, 0, "the helpers, which have caches of their own to fill");
    } catch { }
    check(i, i, "a helper");
}
checkWindow(read(), 0, 0, 0, "the helpers, once they have filled their own caches");

// Only code at the top level, whose own calls have no caches, runs between two readings: a helper that is new to a window would fill its caches there.
const slotsOfCalleeCache = 2;
const missBudget = 4;
let before = read();
for (let i = 0; i < 100; ++i)
    check(callsOnly(double, i), i * 2 + 1, "a call");
checkWindow(before, 1, slotsOfCalleeCache + missBudget, 1, "the first calls of a function that only calls");
before = read();
for (let i = 0; i < 2000; ++i)
    check(callsOnly(double, i), i * 2 + 1, "a call");
checkWindow(before, 0, 0, 0, "later calls of a function that only calls");

before = read();
for (let i = 0; i < 100; ++i)
    check(callsHostFunctionOnly(Number.isSafeInteger, i), false, "a call of a host function");
checkWindow(before, 1, slotsOfCalleeCache + missBudget, 1, "the first calls of a function that only calls a host function");
before = read();
for (let i = 0; i < 2000; ++i)
    check(callsHostFunctionOnly(Number.isSafeInteger, i), false, "a call of a host function");
checkWindow(before, 0, 0, 0, "later calls of a function that only calls a host function");

before = read();
for (let i = 0; i < 100; ++i)
    check(callsTwice(double, triple, i), i * 5, "two calls");
checkWindow(before, 1, 2 * slotsOfCalleeCache + missBudget + 1, 2, "the first calls of a function that calls twice");
before = read();
for (let i = 0; i < 2000; ++i)
    check(callsTwice(double, triple, i), i * 5, "two calls");
checkWindow(before, 0, 0, 0, "later calls of a function that calls twice");

before = read();
for (let i = 0; i < 100; ++i)
    check(neverReads(double, i, undefined), i * 2 + 1, "a call behind a read that is skipped");
checkWindow(before, 1, slotsOfCalleeCache + 2 + missBudget, 1, "the first calls of a function whose property read never runs");
before = read();
for (let i = 0; i < 2000; ++i)
    check(neverReads(double, i, undefined), i * 2 + 1, "a call behind a read that is skipped");
checkWindow(before, 0, 0, 0, "later calls of a function whose property read never runs");

// The return address of a call in tail position is not in the function that makes it. Its misses are charged to nobody, and above all not without end.
before = read();
for (let i = 0; i < 100; ++i)
    check(callsFunctionThatCallsLast(double, i), i * 2 + 1, "a call in tail position");
checkWindow(before, 1, slotsOfCalleeCache + missBudget, 1, "the first calls of a function that calls one that calls in tail position");
before = read();
for (let i = 0; i < 2000; ++i)
    check(callsFunctionThatCallsLast(double, i), i * 2 + 1, "a call in tail position");
checkWindow(before, 0, 0, 0, "later calls in tail position");
console.log("passed");
