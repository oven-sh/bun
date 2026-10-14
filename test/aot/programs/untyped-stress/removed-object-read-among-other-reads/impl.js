const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--failEveryNthAOTGuardForTesting=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--failEveryNthAOTGuardForTesting=2")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--failEveryNthAOTGuardForTesting=3")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--validateGraphAtEachPhase=1", "--validateAOTInferredTypes=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTGuardsAtEveryGuessedPlaceForTesting=1", "--useAOTInlining=0")
//@ runDefault

function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const options = typeof jscOptions === "function" ? jscOptions() : { };
const remarksOf = name => typeof aotRemarks === "function" && aotRemarks(name) || null;
const isCompiled = !!remarksOf("check");
const isOn = isCompiled && !!options.useAOTDataStubs && !options.useAOTInlining;

(function makesConstantObject() {
    "use strict";
    const readInFront = { limit: 5, scale: 2, name: "config" };
    const readBetween = { limit: 5, scale: 2, name: "config" };
    const readInLoop = { limit: 5, scale: 2, name: "config" };
    const readEachTime = { limit: 5, scale: 2, name: "config" };
    function Item(a, b, c) {
        this.a = a;
        this.b = b;
        this.c = c;
    }
    function build(...pairs) {
        let object = { };
        for (let i = 0; i < pairs.length; i += 2)
            object[pairs[i]] = pairs[i + 1];
        return object;
    }
    function readsObjectInFrontOfGuards(o) { const c = readInFront; let sum = o.a + o.b + o.c; return sum + c.limit * c.scale; }
    function readsObjectBetweenGuards(o) { let sum = o.a; const c = readBetween; sum += o.b; sum += c.limit; sum += o.c; return sum + c.scale + c.name.length; }
    function readsObjectInLoop(o) { let sum = 0; for (let i = 0; i < 2; ++i) { sum += o.a; const c = readInLoop; sum += o.b + c.limit; sum += o.c + c.scale; } return sum; }
    function readsObjectEachTime(o) { return o.a + readEachTime.limit + o.b + readEachTime.scale + o.c + readEachTime.name.length; }
    function readsNoSuchObject(o) { return o.a + o.b + o.c; }

    const receivers = [
        () => new Item(1, 2, 3),
        () => build("c", 3, "b", 2, "a", 1),
        () => build("a", 1, "c", 3, "b", 2),
        () => build("a", 1, "b", 2, "other", 0, "c", 3),
    ];
    for (let i = 0; i < 400; ++i) {
        let make = receivers[i % 9 < receivers.length ? i % 9 : 0];
        check(readsObjectInFrontOfGuards(make()), 16, "the object is read in front of the guards");
        check(readsObjectBetweenGuards(make()), 19, "the object is read between the guards");
        check(readsObjectInLoop(make()), 26, "the object is read in a loop");
        check(readsObjectEachTime(make()), 19, "the object is read each time");
        check(readsNoSuchObject(make()), 6, "no such object is read");
    }

    if (isCompiled) {
        for (const name of ["readInFront", "readBetween", "readEachTime"])
            check(remarksOf("makesConstantObject").includes("does-not-allocate-constant-object:" + name), true, name + " is never allocated");
    }
    if (!isOn)
        return;
    for (const name of ["readsObjectInFrontOfGuards", "readsObjectBetweenGuards", "readsObjectEachTime"]) {
        check(remarksOf(name).includes("guards-over-whole-function"), false, name + " has guards over the whole function");
        check(remarksOf(name).filter(remark => remark.startsWith("no-guards-over-whole-function")).join(), "no-guards-over-whole-function:reads-object-that-is-never-allocated", "why " + name + " has no guards");
    }
    check(remarksOf("readsNoSuchObject").includes("guards-over-whole-function"), true, "readsNoSuchObject has guards over the whole function");
})();
console.log("passed");
