const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--useMiniVMModeWithoutJIT=0", "--aotTypeCoveragePath=")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--useMiniVMModeWithoutJIT=0", "--aotTypeCoveragePath=", "--collectContinuously=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--useMiniVMModeWithoutJIT=0", "--aotTypeCoveragePath=", "--forceFencedBarrier=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--useMiniVMModeWithoutJIT=0", "--aotTypeCoveragePath=", "--verifyGC=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--useMiniVMModeWithoutJIT=0", "--aotTypeCoveragePath=", "--useZombieMode=1", "--sweepSynchronously=1", "--scribbleFreeCells=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--useMiniVMModeWithoutJIT=0", "--aotTypeCoveragePath=", "--smallHeapSize=65536", "--largeHeapSize=65536", "--useZombieMode=1", "--sweepSynchronously=1")
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function makeHolder() {
    let held = null;
    function storesIntoEnvironment(value) { held = value; }
    function readsFromEnvironment() { return held; }
    return { storesIntoEnvironment, readsFromEnvironment };
}
function makeHolderOfAnything() {
    let held = 0;
    function storesAnythingIntoEnvironment(value) { held = value; }
    function readsAnythingFromEnvironment() { return held; }
    return { storesAnythingIntoEnvironment, readsAnythingFromEnvironment };
}
function storesIntoFields(objects, round) {
    for (let i = 0; i < objects.length; ++i)
        objects[i].field = { payload: round * 1000 + i };
}
function storesIntoElements(array, round) {
    for (let i = 0; i < array.length; ++i)
        array[i] = { payload: round * 1000 + i };
}
const { storesIntoAllFields, storesIntoAllElements } = (function () {
    function storesIntoFieldsOneByOne(objects, index, round) {
        if (index >= objects.length)
            return;
        objects[index].field = { payload: round * 1000 + index };
        storesIntoFieldsOneByOne(objects, index + 1, round);
    }
    function storesIntoElementsOneByOne(array, index, round) {
        if (index >= array.length)
            return;
        array[index] = { payload: round * 1000 + index };
        storesIntoElementsOneByOne(array, index + 1, round);
    }
    function storesIntoAllFields(objects, round) { storesIntoFieldsOneByOne(objects, 0, round); }
    function storesIntoAllElements(array, round) { storesIntoElementsOneByOne(array, 0, round); }
    return { storesIntoAllFields, storesIntoAllElements };
})();
function storesNumbersIntoEnvironment() {
    let held = 0;
    function storesNumber(value) { held = value | 0; }
    return storesNumber;
}
function makesGarbage(count) {
    let last = null;
    for (let i = 0; i < count; ++i)
        last = { payload: -1 - (i & 1) };
    return last;
}

const numberOfOwners = 64;
const holders = [], holdersOfAnything = [], objects = [], array = [], otherObjects = [], otherArray = [];
for (let i = 0; i < numberOfOwners; ++i) {
    holders.push(makeHolder());
    holdersOfAnything.push(makeHolderOfAnything());
    objects.push({ field: null });
    array.push(null);
    otherObjects.push({ field: null });
    otherArray.push(null);
}
const storesNumber = storesNumbersIntoEnvironment();
fullGC();
fullGC();

for (let round = 1; round <= 30; ++round) {
    for (let i = 0; i < numberOfOwners; ++i) {
        holders[i].storesIntoEnvironment({ payload: round * 1000 + i });
        holdersOfAnything[i].storesAnythingIntoEnvironment(i & 1 ? { payload: round * 1000 + i } : round * 1000 + i);
        storesNumber(i);
    }
    storesIntoFields(objects, round);
    storesIntoElements(array, round);
    storesIntoAllFields(otherObjects, round);
    storesIntoAllElements(otherArray, round);
    edenGC();
    makesGarbage(20000);
    edenGC();
    makesGarbage(20000);
    for (let i = 0; i < numberOfOwners; ++i) {
        const expected = round * 1000 + i;
        check(holders[i].readsFromEnvironment().payload, expected, "a young object in an old environment");
        const anything = holdersOfAnything[i].readsAnythingFromEnvironment();
        check(i & 1 ? anything.payload : anything, expected, "a young object or a number in an old environment");
        check(objects[i].field.payload, expected, "a young object in a field of an old object");
        check(array[i].payload, expected, "a young object in an element of an old array");
        check(otherObjects[i].field.payload, expected, "a young object in a field of an old object, stored by a recursive function");
        check(otherArray[i].payload, expected, "a young object in an element of an old array, stored by a recursive function");
    }
    if (!(round % 10))
        fullGC();
}

function readsProperty(o) { return o.property; }
readsProperty({ property: 1 });
const usesDataStubs = typeof aotRemarks === "function" && isAOTCompiled(readsProperty) && (aotRemarks("readsProperty") || []).includes("calls:GetById");
function outcomesOf(name) {
    const lines = aotTypeCoverage(name);
    if (!lines)
        throw new Error("no coverage for " + name);
    return lines.flatMap(line => line.split(" ").slice(7));
}
if (usesDataStubs) {
    for (const name of ["storesIntoEnvironment", "storesAnythingIntoEnvironment", "storesIntoFieldsOneByOne", "storesIntoElementsOneByOne"]) {
        check(outcomesOf(name).includes("calls:WriteBarrier"), false, name + " calls the stub on the usual path");
        check(outcomesOf(name).includes("rarely-calls:WriteBarrier"), true, name + " calls the stub off the usual path");
    }
    check(outcomesOf("storesNumber").some(outcome => outcome.endsWith("calls:WriteBarrier")), false, "a number needs a barrier");
}
console.log("passed");
