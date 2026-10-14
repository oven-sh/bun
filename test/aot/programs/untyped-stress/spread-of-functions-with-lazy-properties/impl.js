const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1")
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function remarksOf(f) {
    let remarks = aotRemarks(f.name);
    if (!remarks && isAOTCompiled(f))
        throw new Error("no remarks for " + f.name);
    return remarks;
}
function matches(remark, pattern) { return remark === pattern || remark.startsWith(pattern + ":"); }
function applies(f, ...patterns) {
    let remarks = remarksOf(f);
    for (let pattern of remarks ? patterns : []) {
        if (!remarks.some(remark => matches(remark, pattern)))
            throw new Error(pattern + " does not apply to " + f.name + ": " + remarks.join(" "));
    }
}
function thrownBy(f, ...args) {
    try {
        f(...args);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}

function spreadLast(o) { return { first: 0, ...o }; }
function spreadTwo(o, p) { return { ...o, ...p }; }
function restOf(o) { const { first, ...others } = o; return others; }
for (const f of [spreadLast, spreadTwo, restOf])
    noInline(f);
applies(spreadLast, "copies-data-properties");
applies(spreadTwo, "copies-data-properties");
applies(restOf, "copies-data-properties");

for (let i = 0; i < 100; i++) {
    check(Object.keys(spreadLast({ a: i, b: i })).join(), "first,a,b", "a spread of a plain object");
    check(Object.keys(spreadTwo({ a: i }, { b: i })).join(), "a,b", "a spread of two plain objects");
    check(Object.keys(restOf({ first: i, a: i, b: i })).join(), "a,b", "the rest of a plain object");
}

if (typeof WebAssembly === "object") {
    let tested = 0;
    const copyThenCompare = (copy, source, prefix, what) => {
        const copied = copy(source);
        const expected = Object.keys(source);
        tested += expected.length;
        check(Object.keys(copied).join(), prefix.concat(expected).join(), "the keys of " + what);
        for (const key of expected)
            check(copied[key], source[key], key + " of " + what);
        check(Object.keys(copy(source)).join(), prefix.concat(expected).join(), "the keys of " + what + ", again");
    };
    copyThenCompare(restOf, WebAssembly.Module, [], "the rest of an object whose static properties nobody has looked at");
    copyThenCompare(spreadLast, WebAssembly.Instance, ["first"], "a spread of a constructor without enumerable static properties");
    copyThenCompare(o => spreadTwo({ a: 1 }, o), WebAssembly, ["a"], "a spread of two objects, the second with static properties");
    copyThenCompare(spreadLast, WebAssembly.Module.prototype, ["first"], "a spread of a prototype with static properties");
    check(tested > 3, true, "some object has enumerable static properties");

    check(thrownBy(spreadLast, WebAssembly.Table.prototype), "TypeError", "a spread of an object with a static accessor that refuses its receiver");
    check(thrownBy(spreadLast, WebAssembly.Table.prototype), "TypeError", "the same spread again");
    check(thrownBy(restOf, WebAssembly.Memory.prototype), "TypeError", "the rest of an object with a static accessor that refuses its receiver");
}
console.log("passed");
