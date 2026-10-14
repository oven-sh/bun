const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;

function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const options = typeof jscOptions === "function" ? jscOptions() : { };
const remarksOf = name => typeof aotRemarks === "function" && aotRemarks(name) || null;
const isOn = !!remarksOf("check") && !!options.useAOTDataStubs && !options.useAOTInlining;

(function () {
    "use strict";
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
    let kept;
    function takesString(s) { return s.length; }
    function takesAnything(x) { return x === undefined ? 0 : x.length; }

    function passesTestedValue(o, x) { let sum = o.a + o.b + o.c; if (x !== undefined) sum += takesString(x); return sum; }
    function passesTestedValueBehindGuard(o, x) { let sum = o.a + o.b; if (x !== undefined) { sum += o.c; sum += takesString(x); } else sum += 3; return sum; }
    function storesInCodeNeverReached(o, n) { let sum = o.a + o.b + o.c; if (typeof n === "string") kept = o; return sum + n; }
    function returnsTestedValue(o, v) { let sum = o.a + o.b + o.c; return typeof v === "boolean" ? v : sum > 3; }
    function usesResult(o, v) { return returnsTestedValue(o, v) ? 1 : 0; }
    function agrees(o, x) { let sum = o.a + o.b + o.c; return sum + takesAnything(x); }

    for (let i = 0; i < 400; ++i) {
        let make = i % 10 == 9 ? () => build("c", 3, "b", 2, "a", 1) : i % 10 == 8 ? () => Object.defineProperty(new Item(1, 0, 3), "b", { get() { return 2; } }) : () => new Item(1, 2, 3);
        let text = i & 1 ? "four" : undefined;
        check(passesTestedValue(make(), text), i & 1 ? 10 : 6, "a tested value is passed");
        check(passesTestedValueBehindGuard(make(), text), i & 1 ? 10 : 6, "a tested value is passed behind a guard");
        check(storesInCodeNeverReached(make(), i), 6 + i, "a store that is never reached");
        check(kept, undefined, "the variable that is never stored to");
        check(usesResult(make(), i % 3 ? true : i), 1, "a tested value is returned");
        check(usesResult(make(), false), 0, "a tested value is returned");
        check(agrees(make(), text), i & 1 ? 10 : 6, "nothing is narrowed");
    }

    if (!isOn)
        return;
    const refused = { passesTestedValue: "argument", passesTestedValueBehindGuard: "argument", storesInCodeNeverReached: "store", returnsTestedValue: "result" };
    const forced = options.contradictAOTAnalysisForTesting | 0;
    const reasonsOf = name => remarksOf(name).filter(remark => remark.startsWith("no-guards-over-whole-function")).join();
    for (const [name, what] of Object.entries(refused)) {
        check(remarksOf(name).includes("guards-over-whole-function"), false, name + " has guards over the whole function");
        if (!forced)
            check(reasonsOf(name), "no-guards-over-whole-function:contradicts-analysis-of-" + what, "why " + name + " has no guards");
        check(remarksOf(name).includes("contradicts-analysis-without-guards"), forced == 2, name + " contradicts the analysis without guards");
    }
    check(remarksOf("agrees").includes("guards-over-whole-function"), !forced, "agrees has guards over the whole function");
    check(reasonsOf("agrees"), forced ? "no-guards-over-whole-function:contradicts-analysis-of-result" : "", "why agrees has no guards");
    check(remarksOf("agrees").includes("contradicts-analysis-without-guards"), forced == 2, "agrees contradicts the analysis without guards");
})();
console.log("passed");
