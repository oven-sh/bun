const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function double(x) { return x * 2; }
function reads(o) { return o.value; }
function readsThree(o) { return o.first + o.second + o.third; }
function readsAndCalls(o, f, x) { const result = f(x); return result + o.value; }
function readsAndCallsInLoop(o, f, n) {
    let sum = 0;
    for (let i = 0; i < n; ++i)
        sum += f(o.value);
    return sum;
}
function readsAfterRecursion(o, depth) {
    if (depth)
        return readsAfterRecursion(o, depth - 1) + o.value;
    return o.value;
}

const countsOperations = typeof aotOperationCount === "function" && aotOperationCount("operationAOTGetById") !== null && isAOTCompiled(reads) && (aotRemarks("reads") || []).includes("calls:GetById");
function read() {
    if (!countsOperations)
        return [0, 0];
    return [aotOperationCount("operationAOTGetById"), aotOperationCount("operationAOTCacheCallee")];
}
// A callee cache can only be filled in a function's own data, and only by C++: a fill proves that the function has left the shared data.
function checkWindow(before, readsAtMost, fillsAtLeast, fillsAtMost, what) {
    if (!countsOperations)
        return 0;
    const after = read();
    if (after[0] - before[0] > readsAtMost)
        throw new Error(what + ": " + (after[0] - before[0]) + " reads reached C++, not at most " + readsAtMost);
    const fills = after[1] - before[1];
    if (fills < fillsAtLeast || fills > fillsAtMost)
        throw new Error(what + ": " + fills + " callee caches filled, not " + fillsAtLeast + " to " + fillsAtMost);
    return fills;
}
for (let i = 0; i < 50; ++i) {
    try {
        checkWindow(read(), 0, 0, 0, "the helpers, which have caches of their own to fill");
    } catch { }
    check(i, i, "a helper");
}
checkWindow(read(), 0, 0, 0, "the helpers, once they have filled their own caches");

// Only code at the top level, whose own calls have no caches, runs between two readings: a helper that is new to a window would fill its caches there.
const warmUp = 200;
let o = { unrelated: 0, value: 3 };
let before = read();
for (let i = 0; i < warmUp; ++i)
    check(reads(o), 3, "a read in a function that starts cold");
checkWindow(before, warmUp / 4, 0, 0, "the first reads");
before = read();
for (let i = 0; i < 2000; ++i)
    check(reads(o), 3, "a read in a function that has its own caches");
checkWindow(before, 0, 0, 0, "later reads");

o = { first: 1, other: 0, second: 2, third: 4 };
before = read();
for (let i = 0; i < warmUp; ++i)
    check(readsThree(o), 7, "three reads in a function that starts cold");
checkWindow(before, warmUp / 4, 0, 0, "the first reads of three properties");
before = read();
for (let i = 0; i < 2000; ++i)
    check(readsThree(o), 7, "three reads in a function that has its own caches");
checkWindow(before, 0, 0, 0, "later reads of three properties");

o = { withCall: 0, value: 5 };
before = read();
for (let i = 0; i < warmUp; ++i)
    check(readsAndCalls(o, double, i), i * 2 + 5, "a read and a call in a function that starts cold");
checkWindow(before, warmUp / 4, 1, 1, "the first reads and calls");
before = read();
for (let i = 0; i < 2000; ++i)
    check(readsAndCalls(o, double, i), i * 2 + 5, "a read and a call in a function that has its own caches");
checkWindow(before, 0, 0, 0, "later reads and calls");

o = { inLoop: 0, value: 2 };
before = read();
check(readsAndCallsInLoop(o, double, 5000), 20000, "reads and calls in the loop of a function that is entered once");
checkWindow(before, warmUp / 4, 1, 1, "a loop in the first activation of a function");

o = { recursive: 0, value: 1 };
before = read();
check(readsAfterRecursion(o, 400), 401, "reads in activations that began before the function had its own caches");
let fills = checkWindow(before, 401, 0, 1, "activations that began cold");
before = read();
check(readsAfterRecursion(o, 400), 401, "reads in activations that began afterwards");
fills += checkWindow(before, 1, 0, 1, "activations that began afterwards");
if (countsOperations)
    check(fills, 1, "the callee cache of a recursive function is filled once");
before = read();
check(readsAfterRecursion(o, 400), 401, "reads in still later activations");
checkWindow(before, 0, 0, 0, "still later activations");
console.log("passed");
