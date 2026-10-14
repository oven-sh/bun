const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;

function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

function callsHostFunction(f, x) { const result = f(x); return result; }
function callsInternalFunction(f, x) { const result = f(x); return result; }
function callsBoundFunction(f, x) { const result = f(x); return result; }
function callsFunctionOfProgram(f, x) { const result = f(x); return result; }
function doubles(x) { return x * 2; }

const isCounting = typeof aotOperationCount === "function" && aotOperationCount("operationAOTCacheHostCallee") !== null && isAOTCompiled(callsHostFunction) && (aotRemarks("callsHostFunction") || []).includes("cached-call");
const bound = Math.max.bind(null, 5);

function runs(count)
{
    for (let i = 0; i < count; ++i) {
        shouldBe(callsHostFunction(Number.isSafeInteger, i), true, "a host function");
        shouldBe(callsInternalFunction(String, i), String(i), "an internal function");
        shouldBe(callsBoundFunction(bound, i), i > 5 ? i : 5, "a bound function");
        shouldBe(callsFunctionOfProgram(doubles, i), i * 2, "a function of the program");
    }
}

runs(100);
if (isCounting) {
    const noted = aotOperationCount("guest:host-callee");
    const arrived = aotOperationCount("operationAOTCacheHostCallee");
    const filled = aotOperationCount("operationAOTCacheCallee");
    runs(200);
    shouldBe(aotOperationCount("guest:host-callee") - noted, 0, "nothing is noted where no file is to be written");
    shouldBe(aotOperationCount("operationAOTCacheHostCallee") - arrived, 0, "the caches are filled or given up");
    shouldBe(aotOperationCount("operationAOTCacheCallee") - filled, 0, "and so is the cache for a function of the program");
}
console.log("passed");
