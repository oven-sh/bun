const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault
//@ runDefault("--compileMainScriptAheadOfTime=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--failEveryNthAOTGuardForTesting=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTDataStubs=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--contradictAOTAnalysisForTesting=2")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--contradictAOTAnalysisForTesting=2")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--contradictAOTAnalysisForTesting=1")

function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const options = typeof jscOptions === "function" ? jscOptions() : { };
const remarksOf = name => typeof aotRemarks === "function" && aotRemarks(name) || null;
const isOn = !!remarksOf("check") && !!options.useAOTDataStubs;

(function () {
    function first() { return 2; }
    function second() { return 3; }
    function Item(tag, key, child) {
        this.tag = tag;
        this.key = key;
        this.child = child;
    }
    function build(...pairs) {
        let object = { };
        for (let i = 0; i < pairs.length; i += 2)
            object[pairs[i]] = pairs[i + 1];
        return object;
    }
    let mayBeEmpty;
    var isNeverEmpty;
    let kept = 0, keptInOneStep = 0, keptOfMerged = 0, keptOfMergedVar = 0;
    function keeps(e) { if (e !== undefined && e !== null) kept = e; }
    function keepsInOneStep(e) { if (e != null) keptInOneStep = e; }
    function keepsMerged(e, other, takesFirst) { let merged = takesFirst ? e : other; if (merged !== undefined) keptOfMerged = merged; }
    function keepsMergedVar(e, other, takesFirst) { let merged = takesFirst ? e : other; if (merged !== undefined) keptOfMergedVar = merged; }
    function readsThreeAndKeeps(o) { keeps(mayBeEmpty); return o.tag + o.key + o.child; }
    function readsThreeAndKeepsInOneStep(o) { keepsInOneStep(mayBeEmpty); return o.tag + o.key + o.child; }
    function readsThreeAndKeepsMerged(o, takesFirst) { keepsMerged(mayBeEmpty, second, takesFirst); return o.tag + o.key + o.child; }
    function readsThreeAndKeepsMergedVar(o, takesFirst) { keepsMergedVar(isNeverEmpty, second, takesFirst); return o.tag + o.key + o.child; }

    let expectedOfMerged = 0;
    for (let i = 0; i < 400; ++i) {
        mayBeEmpty = (i & 3) === 0 ? undefined : (i & 3) === 1 ? null : (i & 3) === 2 ? first : second;
        isNeverEmpty = (i & 3) === 0 ? undefined : (i & 3) === 1 ? null : (i & 3) === 2 ? first : second;
        let make = i % 10 == 9 ? () => build("child", 2, "key", 1, "tag", i) : () => new Item(i, 1, 2);
        check(readsThreeAndKeeps(make()), i + 3, "three reads behind a test in two steps");
        check(readsThreeAndKeepsInOneStep(make()), i + 3, "three reads behind a test in one step");
        let expected = i < 2 ? 1 : (i & 3) == 2 ? 2 : (i & 3) == 3 ? 3 : 3;
        check(kept === 0 ? 1 : kept(), expected, "what the test in two steps kept");
        check(keptInOneStep === 0 ? 1 : keptInOneStep(), expected, "what the test in one step kept");
        let takesFirst = i % 7 < 5;
        check(readsThreeAndKeepsMerged(make(), takesFirst), i + 3, "three reads behind a test of a merged value");
        check(readsThreeAndKeepsMergedVar(make(), takesFirst), i + 3, "three reads behind a test of a merged value that is never empty");
        if (!takesFirst || (i & 3))
            expectedOfMerged = !takesFirst ? 3 : (i & 3) === 1 ? -1 : (i & 3) === 2 ? 2 : 3;
        check(keptOfMerged === 0 ? 0 : keptOfMerged === null ? -1 : keptOfMerged(), expectedOfMerged, "what the test of a merged value kept");
        check(keptOfMergedVar === 0 ? 0 : keptOfMergedVar === null ? -1 : keptOfMergedVar(), expectedOfMerged, "what the test of a merged value that is never empty kept");
    }

    if (!isOn)
        return;
    const reasons = name => remarksOf(name).filter(remark => remark.startsWith("no-guards-over-whole-function")).join();
    const has = (name, remark) => remarksOf(name).includes(remark);
    const forced = options.contradictAOTAnalysisForTesting | 0;
    for (const name of ["readsThreeAndKeeps", "readsThreeAndKeepsInOneStep", "readsThreeAndKeepsMergedVar"]) {
        check(has(name, "guards-over-whole-function"), !forced, name + " has guards over the whole function");
        check(reasons(name), forced ? "no-guards-over-whole-function:contradicts-analysis-of-result" : "", "why " + name + " has no guards");
        check(has(name, "contradicts-analysis-without-guards"), forced == 2, name + " contradicts the analysis without guards");
    }
    check(has("readsThreeAndKeepsMerged", "guards-over-whole-function"), !reasons("readsThreeAndKeepsMerged"), "readsThreeAndKeepsMerged has guards over the whole function or says why not");
    if (forced)
        check(has("readsThreeAndKeepsMerged", "guards-over-whole-function"), false, "readsThreeAndKeepsMerged has guards over the whole function");
    if (forced == 2)
        check(has("readsThreeAndKeepsMerged", "contradicts-analysis-without-guards"), true, "readsThreeAndKeepsMerged contradicts the analysis without guards");
})();
console.log("passed");
