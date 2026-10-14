const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function makesWithReturn(i) { return { return: i, besideReturn: i }; }
function readsReturn(o) { return o.return + o.besideReturn; }
function readsReturnAlone(o) { return o.return; }
function closesIterator(list) {
    for (let element of list) {
        if (element)
            return element;
    }
    return 0;
}

function makesWithNamesOfObjectPrototype(i) {
    return { constructor: 1, hasOwnProperty: 2, isPrototypeOf: 3, propertyIsEnumerable: 4, toLocaleString: 5, toString: 6, valueOf: 7, __defineGetter__: 8, __defineSetter__: 9, __lookupGetter__: 10, __lookupSetter__: 11, behindEleven: i, behindTwelve: i + 1, behindThirteen: i + 2 };
}
function readsNamesOfObjectPrototype(o) {
    return o.constructor + o.hasOwnProperty + o.isPrototypeOf + o.propertyIsEnumerable + o.toLocaleString + o.toString + o.valueOf + o.__defineGetter__ + o.__defineSetter__ + o.__lookupGetter__ + o.__lookupSetter__;
}
function readsBehindEleven(o) { return o.behindEleven; }
function readsAllBehindEleven(o) { return [o.behindEleven, o.behindTwelve, o.behindThirteen].join(); }

for (let i = 0; i < 100; i++) {
    check(readsReturn(makesWithReturn(i)), 2 * i, "a field named return");
    check(readsReturnAlone(makesWithReturn(i)), i, "a field named return, alone");
    check(closesIterator([0, i, 7]), i || 7, "a loop that is left early");
    check(readsNamesOfObjectPrototype(makesWithNamesOfObjectPrototype(i)), 66, "own properties with the names of Object.prototype");
    check(readsBehindEleven(makesWithNamesOfObjectPrototype(i)), i, "a property behind them");
    check(typeof readsNamesOfObjectPrototype({ }), "string", "the properties of Object.prototype");
}
{
    let closed = 0;
    let iterable = { [Symbol.iterator]() { return { return() { closed++; return { }; }, next() { return { done: false, value: 1 }; }, besideNext: 1 }; } };
    check(closesIterator(iterable), 1, "an iterator of the program");
    check(closed, 1, "the iterator is closed once");
}
{
    let countOf = detail => typeof aotOperationCount === "function" && aotOperationCount("Family::guard:" + detail) || 0;
    let exits = () => countOf("exits-with-another-number") + countOf("exits-without-number") + countOf("exits-not-a-cell") + countOf("exits-departed");
    let before = [countOf("passes"), exits()];
    for (let i = 0; i < 100; i++)
        check(readsAllBehindEleven(makesWithNamesOfObjectPrototype(i)), [i, i + 1, i + 2].join(), "the properties behind names that get no place");
    if (jscOptions().useAOTOperationCounters && jscOptions().useAOTDataStubs) {
        check(countOf("passes") - before[0] >= 100, true, "the guard passes objects with names that get no place");
        check(exits() - before[1], 0, "the guard fails on an object with names that get no place");
    }
    let parsed = JSON.parse('{"valueOf":1,"toString":2}');
    check(parsed.valueOf + parsed.toString, 3, "parsed properties with the names of Object.prototype");
}
if (aotRemarks("readsReturn") && jscOptions().useAOTDataStubs) {
    let has = (name, remark) => aotRemarks(name).includes(remark);
    let applies = (name, remark) => {
        if (!has(name, remark))
            throw new Error(remark + " does not apply to " + name + ": " + aotRemarks(name).join(" | "));
    };
    let doesNotApply = (name, remark) => {
        if (has(name, remark))
            throw new Error(remark + " applies to " + name + ": " + aotRemarks(name).join(" | "));
    };
    applies("readsReturn", "guessed-place:return");
    applies("readsReturnAlone", "no-guess:no-family");
    doesNotApply("readsReturnAlone", "no-guess:disagree");
    doesNotApply("readsReturnAlone", "no-guess:same-names-born-in-another-module");
    doesNotApply("closesIterator", "guessed-place:return");
    doesNotApply("closesIterator", "no-guess:disagree");
    doesNotApply("closesIterator", "no-guess:no-family");
    for (let name of ["constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"])
        doesNotApply("readsNamesOfObjectPrototype", "guessed-place:" + name);
    applies("readsNamesOfObjectPrototype", "no-guess:no-shape");
    applies("readsBehindEleven", "guessed-place:behindEleven");
    applies("readsAllBehindEleven", "guards-over-whole-function");
    for (let name of ["behindEleven", "behindTwelve", "behindThirteen"])
        applies("readsAllBehindEleven", "family-guards-read:" + name);
    doesNotApply("readsNamesOfObjectPrototype", "guards-over-whole-function");
}
console.log("passed");
