const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function has(name, remark) {
    let remarks = aotRemarks(name);
    return remarks && remarks.length ? remarks.some(other => other === remark) : undefined;
}
function says(name, remark) { check(has(name, remark) !== false, true, name + " has " + remark); }
function doesNotSay(name, remark) { check(has(name, remark) !== true, true, name + " has no " + remark); }

(function () {
function tiny(a, b, c) { return (a + b) * c; }
function little(a, b, c) { return (a + b) * c - a + b; }
function middling(a, b, c) { return (a + b) * c - a + b * c; }
function once(x) { return tiny(x, 1, 2) + little(x, 1, 2) + middling(x, 1, 2); }
function again(x) { return tiny(x, 3, 4) + little(x, 3, 4) + middling(x, 3, 4); }
check(once(5), 12 + 8 + 9, "callees of three sizes, called outside a loop");
check(again(6), 36 + 33 + 42, "callees of three sizes, their second site");
for (let name of ["once", "again"]) {
    says(name, "inlined-call:tiny");
    says(name, "inlined-call:little");
    doesNotSay(name, "callee-is-too-big-to-inline:little");
    says(name, "callee-is-too-big-to-inline:middling");
    doesNotSay(name, "inlined-call:middling");
    says(name, "direct-call:middling");
}
})();
console.log("passed");
