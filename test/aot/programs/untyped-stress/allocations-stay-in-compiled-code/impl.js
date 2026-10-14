const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1")

function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

function remarksOf(f)
{
    return typeof aotRemarks === "function" && isAOTCompiled(f) ? aotRemarks(f.name) : null;
}

function readsProperty(o) { return o.property; }
readsProperty({ property: 1 });
const usesDataStubs = (remarksOf(readsProperty) || []).includes("calls:GetById");
const counts = usesDataStubs && typeof aotOperationCount === "function" && aotOperationCount("operationAOTNewArray") !== null;

(function () {
    const kept = [null, null, null, null];

    class Point {
        constructor(x, y)
        {
            this.x = x;
            this.y = y;
        }
    }

    function makesEmptyArrays(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = [];
        return kept[0].length;
    }

    function makesArrays(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = [i, kept];
        return kept[0].length;
    }

    function makesLongerArrays(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = [i, kept, i, kept, i, kept, i];
        return kept[0].length;
    }

    function makesObjects(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = { first: 2, second: kept };
        return kept[0].first;
    }

    function makesEmptyObjects(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = {};
        return Object.keys(kept[0]).length;
    }

    function makesClosures(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = () => i - i + 3;
        return kept[0]();
    }

    function makesInstances(count)
    {
        for (let i = 0; i < count; ++i)
            kept[i & 3] = new Point(4, kept);
        return kept[0].x;
    }

    const cases = [
        [makesEmptyArrays, 0, ["operationAOTNewArray"]],
        [makesArrays, 2, ["operationAOTNewArray"]],
        [makesLongerArrays, 7, ["operationAOTNewArray"]],
        [makesObjects, 2, ["operationAOTNewObjectLiteral"]],
        [makesEmptyObjects, 0, ["operationAOTNewObject", "operationAOTNewObjectLiteral"]],
        [makesClosures, 3, ["operationAOTNewFunction", "operationAOTNewFunctionWithCaptures", "operationAOTCreateLexicalEnvironment"]],
        [makesInstances, 4, ["operationAOTCreateThisWithProperties"]],
    ];

    function arrivalsOf(operations)
    {
        let sum = 0;
        for (const operation of operations)
            sum += aotOperationCount(operation);
        return sum;
    }

    for (const [make, expected, operations] of cases) {
        for (let i = 0; i < 200; ++i)
            shouldBe(make(10), expected, make.name);
        for (let collection = 0; collection < 3; ++collection) {
            if (collection)
                gc();
            const before = counts ? arrivalsOf(operations) : 0;
            for (let i = 0; i < 100; ++i)
                shouldBe(make(100), expected, make.name);
            const arrivals = counts ? arrivalsOf(operations) - before : 0;
            if (arrivals > 150)
                throw new Error(make.name + " reached " + operations.join(" or ") + " " + arrivals + " times in 10000 allocations after " + collection + " collections");
        }
    }
})();
console.log("passed");
