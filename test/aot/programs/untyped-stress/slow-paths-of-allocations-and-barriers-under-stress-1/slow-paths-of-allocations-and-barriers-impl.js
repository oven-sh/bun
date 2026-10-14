const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1", "--useAOTInlining=0", "--useMiniVMModeWithoutJIT=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1", "--useAOTInlining=0", "--useMiniVMModeWithoutJIT=0", "--collectContinuously=1")

function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

function readsProperty(o) { return o.property; }
readsProperty({ property: 1 });
const usesDataStubs = typeof aotRemarks === "function" && isAOTCompiled(readsProperty) && (aotRemarks("readsProperty") || []).includes("calls:GetById");
const counts = usesDataStubs && typeof aotOperationCount === "function" && aotOperationCount("operationAOTNewFunction") !== null;

function atMost(actual, limit, what)
{
    if (counts && actual > limit)
        throw new Error(what + ": " + actual + " arrivals, at most " + limit + " expected");
}

function atLeast(actual, limit, what)
{
    if (counts && actual < limit)
        throw new Error(what + ": " + actual + " arrivals, at least " + limit + " expected");
}

(function () {
    let kept;
    function makesFunction() { return function () { return 1; }; }
    function makesFunctionWithCapture(x) { return () => x; }
    function arrivals(detail)
    {
        if (!counts)
            return 0;
        return aotOperationCount("operationAOTNewFunction" + detail) + aotOperationCount("operationAOTNewFunctionWithCaptures" + detail);
    }

    for (let i = 0; i < 1000; ++i) {
        kept = makesFunction();
        kept = makesFunctionWithCapture(i);
        arrivals("");
        arrivals(":valid-cache");
    }

    const rounds = 10;
    const perRound = 20000;
    const allBefore = arrivals("");
    const validBefore = arrivals(":valid-cache");
    for (let round = 0; round < rounds; ++round) {
        for (let i = 0; i < perRound; ++i) {
            kept = makesFunction();
            shouldBe(kept(), 1, "a function");
            kept = makesFunctionWithCapture(i);
            shouldBe(kept(), i, "a function with a capture");
        }
        edenGC();
    }
    const all = arrivals("") - allBefore;
    const valid = arrivals(":valid-cache") - validBefore;
    atLeast(all, rounds, "a collection empties the free lists, so functions are made in C++ now and then");
    atMost(all, rounds * perRound * 2 / 20, "functions are rarely made in C++");
    if (counts)
        shouldBe(valid, all, "a function that is made in C++ only for want of a free cell is made from the cache");
})();

(function () {
    const owner = { field: null, other: 0 };
    const values = [{ }, { }];
    function stores(o, v) { o.field = v; }
    function arrivals() { return counts ? aotOperationCount("operationAOTWriteBarrier") : 0; }

    for (let i = 0; i < 1000; ++i) {
        stores(owner, values[i & 1]);
        arrivals();
    }
    fullGC();

    const stored = 2000000;
    const before = arrivals();
    for (let i = 0; i < stored; ++i)
        stores(owner, values[i & 1]);
    const slow = arrivals() - before;
    shouldBe(owner.field, values[1], "the last value stored");
    atLeast(slow, 1, "the first store into an old object remembers it");
    atMost(slow, stored / 100, "a store into an object that is not black stays out of C++, also while the collector marks");
})();

(function () {
    let made = 0;
    function count() { ++made; }
    class ManyMethods {
        constructor(x)
        {
            count();
            this.first = x;
            this.second = x;
            this.third = x;
            this.fourth = x;
        }
        m0() { return 0; } m1() { return 1; } m2() { return 2; } m3() { return 3; } m4() { return 4; } m5() { return 5; }
        m6() { return 6; } m7() { return 7; } m8() { return 8; } m9() { return 9; } m10() { return 10; } m11() { return this.fourth; }
    }
    function arrivals(detail) { return counts ? aotOperationCount("operationAOTPutProperties" + detail) : 0; }

    const allBefore = arrivals("");
    const oneByOneBefore = arrivals(":one-by-one");
    let sum = 0;
    for (let i = 0; i < 200; ++i)
        sum += new ManyMethods(i).m11();
    shouldBe(sum, 19900, "fields of a class with many methods");
    shouldBe(made, 200, "constructor calls");
    if (arrivals("") - allBefore)
        atMost(arrivals(":one-by-one") - oneByOneBefore, 3, "the properties of an instance of a class with many methods are added together");
})();
console.log("passed");
