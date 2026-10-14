const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const all = ["open-function-has-no-direct-call", "direct-calls-of-open-function-pass-unboxed-values", "direct-calls-of-open-function-pass-known-kinds", "direct-calls-of-open-function-pass-anything"];
function says(name, expected) {
    let remarks = aotRemarks(name);
    if (!remarks || !remarks.length)
        return;
    check(remarks.filter(remark => all.includes(remark)).join(), expected, name);
}
let kept = [];
function keep(value) { kept.push(value); return value; }
noInline(keep);
(function (anything) {
    function closed(a) { return a + 1; }
    function neverCalledDirectly(a) { return a + 1; }
    function takesInt32(a, b) { return a + b; }
    function takesDoubleAndAnything(a, b) { return a * 0.5 + String(b).length; }
    function takesString(a) { return a.length; }
    function takesObjectOrUndefined(a) { return a ? a.x : 0; }
    function takesAnything(a) { return String(a).length; }
    function takesNumberOrString(a) { return String(a).length; }
    for (let f of [neverCalledDirectly, takesInt32, takesDoubleAndAnything, takesString, takesObjectOrUndefined, takesAnything, takesNumberOrString])
        keep(f);
    check(closed(1) + takesInt32(1, 2) + takesDoubleAndAnything(1.5, anything) + takesString("abc") + takesObjectOrUndefined({ x: 1 }) + takesObjectOrUndefined(undefined) + takesAnything(anything) + takesNumberOrString(1) + takesNumberOrString("ab"), 2 + 3 + 1.75 + 3 + 1 + 0 + 1 + 1 + 2, "direct calls");
})(keep(7));
check(kept[1](1) + kept[2]("a", "b") + kept[4]([1, 2]), "2ab2", "the same functions from outside");
says("closed", "");
says("neverCalledDirectly", "open-function-has-no-direct-call");
says("takesInt32", "direct-calls-of-open-function-pass-unboxed-values");
says("takesDoubleAndAnything", "direct-calls-of-open-function-pass-unboxed-values");
says("takesString", "direct-calls-of-open-function-pass-known-kinds");
says("takesObjectOrUndefined", "direct-calls-of-open-function-pass-known-kinds");
says("takesAnything", "direct-calls-of-open-function-pass-anything");
says("takesNumberOrString", "direct-calls-of-open-function-pass-anything");
console.log("passed");
