const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
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

const kinds = ["CallCachedMiss:same-code", "CallCachedMiss:other-code", "CallCachedMiss:other-kind-of-callee", "CallCachedMiss:cache-in-shared-data"];
const countsMisses = typeof aotOperationCount === "function" && aotOperationCount(kinds[0]) !== null && isAOTCompiled(callsOneFunction) && (aotRemarks("callsOneFunction") || []).includes("cached-call");
const before = [0, 0, 0, 0];
const after = [0, 0, 0, 0];
function checkWindow(expected, what) {
    for (let i = 0; i < 4; ++i) {
        const count = after[i] - before[i];
        if (count < expected[i][0] || count > expected[i][1])
            throw new Error(what + ": " + count + " of " + kinds[i] + ", not " + expected[i][0] + " to " + expected[i][1]);
    }
}
const none = [0, 0];
for (let i = 0; i < 50; ++i) {
    checkWindow([none, none, none, none], "a helper");
    check(i, i, "a helper");
    makeClosure(i);
}

for (let k = 0; countsMisses && k < 4; ++k)
    before[k] = aotOperationCount(kinds[k]);
for (let i = 0; i < 50; ++i) {
    checkWindow([none, none, none, none], "a helper");
    check(i, i, "a helper");
    makeClosure(i);
}
for (let k = 0; countsMisses && k < 4; ++k)
    after[k] = aotOperationCount(kinds[k]);
checkWindow([none, none, none, none], "the helpers and the readings at the top level");

for (let k = 0; countsMisses && k < 4; ++k)
    before[k] = aotOperationCount(kinds[k]);
for (let i = 0; i < 100; ++i)
    check(callsOneFunction(returnsOne), 2, "a call of one function");
for (let k = 0; countsMisses && k < 4; ++k)
    after[k] = aotOperationCount(kinds[k]);
if (countsMisses)
    checkWindow([none, [1, 3], [0, 1], [1, 6]], "a function that starts cold, whose callee is linked by its first call, and that then fills its cache");

for (let k = 0; countsMisses && k < 4; ++k)
    before[k] = aotOperationCount(kinds[k]);
for (let i = 0; i < 1000; ++i)
    check(callsOneFunction(returnsOne), 2, "a call of one function");
for (let k = 0; countsMisses && k < 4; ++k)
    after[k] = aotOperationCount(kinds[k]);
checkWindow([none, none, none, none], "a cache that hits");

for (let i = 0; i < 100; ++i)
    check(callsNewClosures(makeClosure(i)), i + 1, "a call of a new closure");
for (let k = 0; countsMisses && k < 4; ++k)
    before[k] = aotOperationCount(kinds[k]);
for (let i = 0; i < 1000; ++i)
    check(callsNewClosures(makeClosure(i)), i + 1, "a call of a new closure");
for (let k = 0; countsMisses && k < 4; ++k)
    after[k] = aotOperationCount(kinds[k]);
if (countsMisses)
    checkWindow([[1000, 1000], none, none, none], "the same code in a new function object every time");

for (let i = 0; i < 100; ++i)
    check(callsTwoFunctions(i & 1 ? returnsOne : returnsTwo), i & 1 ? 2 : 3, "a call of one of two functions");
for (let k = 0; countsMisses && k < 4; ++k)
    before[k] = aotOperationCount(kinds[k]);
for (let i = 0; i < 1000; ++i)
    check(callsTwoFunctions(i & 1 ? returnsOne : returnsTwo), i & 1 ? 2 : 3, "a call of one of two functions");
for (let k = 0; countsMisses && k < 4; ++k)
    after[k] = aotOperationCount(kinds[k]);
if (countsMisses)
    checkWindow([[0, 500], [500, 1000], none, none], "two functions in turn");

for (let i = 0; i < 100; ++i)
    check(callsHostFunctions(i & 1 ? Number.isSafeInteger : Number.isNaN, i), !(i & 1), "a call of one of two host functions");
for (let k = 0; countsMisses && k < 4; ++k)
    before[k] = aotOperationCount(kinds[k]);
for (let i = 0; i < 1000; ++i)
    check(callsHostFunctions(i & 1 ? Number.isSafeInteger : Number.isNaN, i), !(i & 1), "a call of one of two host functions");
for (let k = 0; countsMisses && k < 4; ++k)
    after[k] = aotOperationCount(kinds[k]);
if (countsMisses)
    checkWindow([none, none, [500, 1000], none], "two host functions in turn");
console.log("passed");
