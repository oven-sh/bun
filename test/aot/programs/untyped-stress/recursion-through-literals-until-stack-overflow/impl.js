const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function has(name, remark) {
    let remarks = aotRemarks(name);
    return remarks && remarks.length ? remarks.some(other => other === remark || other.startsWith(remark + ":")) : undefined;
}
function outcomeOf(run) {
    try {
        return run();
    } catch (error) {
        return error instanceof RangeError ? "RangeError" : String(error);
    }
}
(function () {
const throughLiteral = function (x) { return x > 0 ? ({ again: throughLiteral }).again(x - 1) + 1 : 0; };
function warmsThroughLiteral() { let sum = 0; for (let i = 0; i < 50; i++) sum += throughLiteral(i); return sum; }
check(warmsThroughLiteral(), 1225, "a function that calls itself through an object literal");
check(outcomeOf(() => throughLiteral(10000000)), "RangeError", "and does so too often");

let kept = [];
const throughArray = function (x) { return x > 0 ? kept[0](x - 1) + 1 : 0; };
kept.push(throughArray);
function warmsThroughArray() { let sum = 0; for (let i = 0; i < 50; i++) sum += throughArray(i); return sum; }
check(warmsThroughArray(), 1225, "a function that calls itself through an array");
check(outcomeOf(() => throughArray(10000000)), "RangeError", "and does so too often");

function leaf(x) { return x > 1e9 ? kept.length : x + 1; }
function callsLeaf(x) { return x === -5 ? leaf(0) : leaf(x) + kept.length; }
function warmsCallsLeaf() { let sum = 0; for (let i = 0; i < 50; i++) sum += callsLeaf(i); return sum; }
check(warmsCallsLeaf(), 1325, "functions that do not escape");

const remark = "relies-on-stack-check-of-caller";
check(has("throughLiteral", remark) !== true, true, "no body of a function that escapes relies on its caller: throughLiteral");
check(has("throughArray", remark) !== true, true, "no body of a function that escapes relies on its caller: throughArray");
})();
console.log("passed");
