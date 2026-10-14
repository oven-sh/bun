const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1")
function throwsValue() { throw 1; }
function catchesValue() { try { throwsValue(); } catch (e) { return 1; } return 0; }
function atDepth(depth, count) {
    if (depth > 0)
        return atDepth(depth - 1, count) + 0;
    let sum = 0;
    for (let i = 0; i < count; i++)
        sum += catchesValue();
    return sum;
}
function secondsFor(depth) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
        const start = preciseTime();
        if (atDepth(depth, 3000) !== 3000)
            throw new Error("wrong count");
        best = Math.min(best, preciseTime() - start);
    }
    return best;
}
const shallow = secondsFor(200);
const deep = secondsFor(20000);
if (deep > shallow * 6)
    throw new Error("a throw costs " + (deep / shallow).toFixed(1) + " times as much below 20000 frames as below 200");
console.log("passed");
