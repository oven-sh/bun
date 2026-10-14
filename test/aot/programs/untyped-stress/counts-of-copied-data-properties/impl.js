const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1", "--useAOTInlining=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1", "--useAOTDataStubs=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--validateAOTInferredTypes=1", "--validateGraphAtEachPhase=1")
//@ runDefault("--useAOTOperationCounters=1")
//@ runDefault

function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

const isCounting = typeof aotOperationCount === "function" && !!aotRemarks("check") && !!jscOptions().useAOTOperationCounters;
const operation = "operationAOTTryCopyDataProperties";
const endings = ["copied", "source-is-nullish", "source-has-no-properties", "source-is-not-object", "target-is-not-final-object", "target-is-dictionary", "target-is-not-extensible", "target-has-poly-proto", "target-has-typed-fields",
    "source-is-dictionary", "source-has-indexed-properties", "source-has-no-fast-enumeration", "source-has-unreified-static-properties", "no-plan"];

function counts()
{
    const result = { arrivals: isCounting ? aotOperationCount(operation) || 0 : 0 };
    for (const ending of endings)
        result[ending] = isCounting ? aotOperationCount(operation + ":" + ending) || 0 : 0;
    return result;
}

function manyProperties()
{
    const object = { };
    for (let i = 0; i < 300; ++i)
        object["key" + i] = i;
    return object;
}
const dictionary = manyProperties();
const symbol = Symbol("s");

const cases = [
    ["a plain object", () => ({ x: 1, ...{ a: 1, b: 2 } }), "x,a,b", ["copied"]],
    ["two objects", () => ({ ...{ a: 1 }, ...{ b: 2 } }), "a,b", ["copied"]],
    ["a name that the target has", () => ({ a: 0, ...{ a: 1 } }), "a", ["copied"]],
    ["a property that is not enumerable", () => ({ x: 1, ...Object.defineProperty({ a: 1 }, "hidden", { value: 2, enumerable: false }) }), "x,a", ["copied"]],
    ["a symbol", () => ({ x: 1, ...{ [symbol]: 1, a: 2 } }), "x,a,Symbol(s)", ["copied"]],
    ["the rest of an object", () => { const { a, ...others } = { a: 1, b: 2, c: 3 }; return others; }, "b,c", ["copied"]],
    ["null", () => ({ x: 1, ...null }), "x", ["source-is-nullish"]],
    ["undefined", () => ({ x: 1, ...undefined }), "x", ["source-is-nullish"]],
    ["a string", () => ({ x: 1, ..."ab" }), "0,1,x", ["source-is-not-object"]],
    ["a number", () => ({ x: 1, ...5 }), "x", ["source-has-no-properties"]],
    ["an array", () => ({ x: 1, ...[1, 2] }), "0,1,x", ["source-has-indexed-properties"]],
    ["a getter", () => ({ x: 1, ...{ get a() { return 1; } } }), "x,a", ["source-has-no-fast-enumeration"]],
    ["a proxy", () => ({ x: 1, ...new Proxy({ a: 1 }, { }) }), "x,a", ["source-has-no-fast-enumeration"]],
    ["a function", () => ({ x: 1, ...function () { } }), "x", ["source-has-no-fast-enumeration"]],
    ["a getter of the target", () => ({ get a() { return 0; }, ...{ a: 1 } }), "a", ["no-plan"]],
    ["a dictionary", () => Object.keys({ x: 1, ...dictionary }).length, 301, ["source-is-dictionary"]],
    ["an object after a dictionary", () => Object.keys({ x: 1, ...dictionary, ...{ a: 1 } }).length, 302, ["source-is-dictionary", "target-is-dictionary"]],
];

for (const [what, run, expected, expectedEndings] of cases) {
    for (let round = 0; round < 3; ++round) {
        const before = counts();
        const result = run();
        const after = counts();
        check(typeof result === "number" ? result : Reflect.ownKeys(result).map(String).join(), expected, what);
        if (!isCounting)
            continue;
        check(after.arrivals - before.arrivals, expectedEndings.length, what + ": arrivals");
        for (const ending of endings)
            check(after[ending] - before[ending], expectedEndings.filter(expectedEnding => expectedEnding === ending).length, what + ": " + ending);
    }
}
check(({ get a() { return 0; }, ...{ a: 1 } }).a, 1, "the value that replaces a getter");
check(({ x: 1, ...{ get a() { return 7; } } }).a, 7, "the value of a getter");
console.log("passed");
