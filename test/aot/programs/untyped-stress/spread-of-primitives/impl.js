const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1", "--useAOTInlining=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1", "--useAOTDataStubs=0")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTOperationCounters=1", "--validateGraphAtEachPhase=1", "--validateAOTInferredTypes=1")
//@ runDefault("--compileMainScriptAheadOfTime=1", "--useAOTInlining=0", "--verifyGC=1", "--scribbleFreeCells=1", "--useZombieMode=1", "--slowPathAllocsBetweenGCs=50")
//@ runDefault

function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function afterMember(value) { return { first: 1, ...value }; }
function betweenMembers(value) { return { first: 1, ...value, last: 2 }; }
function afterSpread(object, value) { return { ...object, ...value }; }
function restOf(value) { const { first, ...rest } = value; return rest; }
function whenTrue(condition, object) { return { first: 1, ...(condition && object) }; }
for (let f of [afterMember, betweenMembers, afterSpread, restOf, whenTrue])
    noInline(f);

const operation = "operationAOTTryCopyDataProperties";
const isCounting = typeof aotOperationCount === "function" && !!aotRemarks("check") && !!jscOptions().useAOTOperationCounters && (aotRemarks("afterMember") || []).includes("copies-data-properties");
function count(ending) { return isCounting ? aotOperationCount(ending ? operation + ":" + ending : operation) || 0 : 0; }
function during(f) {
    const names = ["", "source-has-no-properties", "source-is-not-object", "source-is-nullish", "copied"];
    const before = names.map(count), generic = isCounting ? aotOperationCount("guest:host-callee") || 0 : 0;
    f();
    const [arrivals, nothing, notObject, nullish, copied] = names.map((name, i) => count(name) - before[i]);
    return { arrivals, nothing, notObject, nullish, copied, generic: (isCounting ? aotOperationCount("guest:host-callee") || 0 : 0) - generic };
}

for (const prototype of [Boolean.prototype, Number.prototype, Symbol.prototype, BigInt.prototype, String.prototype, Object.prototype]) {
    try {
        prototype.inheritedAndEnumerable = "must not be copied";
    } catch { }
}

const keys = o => Reflect.ownKeys(o).map(String).join();
const withoutProperties = [false, true, 0, 1, -1, 1.5, -0, NaN, Infinity, 2 ** 40, Symbol("s"), Symbol.iterator, 10n, -3n, 2n ** 70n];
const rounds = 200;

const primitives = during(() => {
    for (let round = 0; round < rounds; ++round) {
        for (const value of withoutProperties) {
            check(keys(afterMember(value)), "first", "a member, then a value without properties");
            check(keys(betweenMembers(value)), "first,last", "a value without properties between members");
            check(keys(afterSpread({ a: 1 }, value)), "a", "an object, then a value without properties");
            check(keys(restOf(value)), "", "the rest of a value without properties");
        }
        check(keys(whenTrue(false, { a: 1 })), "first", "a condition that is false");
        check(keys(whenTrue(0, { a: 1 })), "first", "a condition that is zero");
    }
});
const strings = during(() => {
    for (let round = 0; round < rounds; ++round) {
        check(keys(afterMember("ab")), "0,1,first", "a member, then a string");
        check(afterMember("ab")[1], "b", "a character of the string");
        check(keys(afterMember("")), "first", "a member, then the empty string");
        check(keys(restOf("xyz")), "0,1,2", "the rest of a string");
        check(keys(afterSpread({ a: 1 }, "q" + round)).startsWith("0,1"), true, "an object, then a rope");
    }
});
const others = during(() => {
    for (let round = 0; round < rounds; ++round) {
        check(keys(afterMember(null)), "first", "a member, then null");
        check(keys(afterMember(undefined)), "first", "a member, then undefined");
        check(keys(whenTrue(true, { a: 1 })), "first,a", "a condition that is true");
        check(keys(afterMember(new Boolean(false))), "first", "a member, then a wrapper");
        check(keys(afterMember(Object.assign(new Number(5), { own: 1 }))), "first,own", "a member, then a wrapper with a property");
        check(keys(afterMember([7])), "0,first", "a member, then an array");
    }
});
let thrown = 0;
for (const value of [null, undefined]) {
    try {
        restOf(value);
    } catch (error) {
        thrown += error instanceof TypeError;
    }
}
check(thrown, 2, "the rest of null and of undefined");

if (isCounting) {
    const expected = rounds * (withoutProperties.length * 4 + 2);
    check(primitives.arrivals, expected, "copies of values without properties: arrivals");
    check(primitives.nothing, expected, "copies of values without properties: nothing to copy");
    check(primitives.notObject, 0, "copies of values without properties: left to the generic function");
    check(primitives.generic, 0, "copies of values without properties: calls of host functions");
    check(strings.nothing, 0, "copies of strings: nothing to copy");
    check(strings.notObject, rounds * 5, "copies of strings: left to the generic function");
    check(others.nothing, 0, "copies of null, undefined and objects: nothing to copy");
    check(others.nullish, rounds * 2, "copies of null and undefined");
}
console.log("passed");
