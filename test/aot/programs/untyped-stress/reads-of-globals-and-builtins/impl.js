const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
globalThis.added = 7;

(function () {
    let local = 3;
    function readsAdded() { return added; }
    function readsBoth() { return added + (globalThis === undefined ? 1 : 0); }
    function readsBuiltin() { return JSON; }
    function readsVariable() { return local; }
    check(readsAdded(), 7, "a property added to the global object");
    check(readsBoth(), 7, "two globals");
    check(readsBuiltin(), JSON, "a built-in");
    check(readsVariable(), 3, "a variable");

    const named = name => (aotRemarks(name) || []).filter(remark => remark.startsWith("reads-global:")).sort().join();
    if ((aotRemarks("readsAdded") || []).includes("calls:GetGlobal")) {
        check(named("readsAdded"), "reads-global:added", "the global that is read");
        check(named("readsBoth"), "reads-global:added,reads-global:globalThis", "the globals that are read");
    }
    check(named("readsBuiltin"), "", "a built-in that cannot change is no read");
    check(named("readsVariable"), "", "a variable is no global");
})();
console.log("passed");
