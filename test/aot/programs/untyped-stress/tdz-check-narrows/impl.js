function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f, ...parameters) {
    try {
        f(...parameters);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}

function makeAddsStep(start) {
    function addsStep(n) { return (n | 0) + step; }
    const step = start | 0;
    return addsStep;
}
function makeScales(by) {
    function scales(n) { return (n - 0) * factor; }
    const factor = +by;
    return scales;
}
function makeGreets(name) {
    function greets() { return greeting.length; }
    const greeting = "hello " + name;
    return greets;
}
function makeNegates(flag) {
    function negates() { return isSet ? "set" : "clear"; }
    const isSet = !flag;
    return negates;
}
let addsStep = makeAddsStep(5), scales = makeScales(0.5), greets = makeGreets("you"), negates = makeNegates(0);
for (let f of [makeAddsStep, makeScales, makeGreets, makeNegates, addsStep, scales, greets, negates])
    noInline(f);

check(addsStep(1), 6, "a captured Int32");
check(addsStep(2147483647), 2147483652, "a sum that is no Int32");
check(makeAddsStep(-2147483648)(-1), -2147483649, "a sum below the Int32 range");
check(makeAddsStep("7")(1.9), 8, "operands that are converted");
check(scales(3), 1.5, "a captured number");
check(scales(-0), -0, "negative zero times a captured number");
check(makeScales(-0)(5), -0, "a captured negative zero");
check(makeScales(undefined)(5), NaN, "a captured NaN");
check(makeScales("2")(4), 8, "a captured number that was a string");
check(greets(), 9, "a captured string");
check(makeGreets("")(), 6, "a shorter captured string");
check(negates() + makeNegates(1)(), "setclear", "a captured boolean");

function fallsIntoCase(which) {
    switch (which) {
    case 0:
        let value = 7;
    case 1:
        return value + 1;
    }
    return -1;
}
function readsTooEarly() {
    const read = () => early + 1;
    let result = thrownBy(read);
    const early = 5;
    return result + ":" + read();
}
function readsInLoop(count) {
    let results = [];
    for (let i = 0; i < count; ++i) {
        const read = () => late * 2;
        results.push(thrownBy(read));
        const late = i;
        results.push(read());
    }
    return results.join();
}
class Base { constructor() { this.a = 1; } }
class Derived extends Base {
    constructor(callsSuper) {
        if (callsSuper)
            super();
        this.b = 2;
    }
}
function constructsDerived(callsSuper) { let object = new Derived(callsSuper); return object.a + object.b; }
for (let f of [fallsIntoCase, readsTooEarly, readsInLoop, constructsDerived])
    noInline(f);

check(fallsIntoCase(0), 8, "a variable that is initialized");
check(thrownBy(fallsIntoCase, 1), "ReferenceError", "a variable that is not initialized");
check(fallsIntoCase(2), -1, "a variable that is not read");
check(readsTooEarly(), "ReferenceError:6", "a closure called before and after the initialization");
check(readsInLoop(3), "ReferenceError,0,ReferenceError,2,ReferenceError,4", "a variable of each iteration");
check(constructsDerived(true), 3, "this after super");
check(thrownBy(constructsDerived, false), "ReferenceError", "this without super");

function makeReadsAnything(value) {
    function readsAnything() { return anything; }
    const anything = value;
    return readsAnything;
}
function makeReadsOptionalObject(given) {
    function readsOptionalObject() { return optional ? optional.a : 0; }
    const optional = given ? { a: 1 } : undefined;
    return readsOptionalObject;
}
function makeReadsWithoutCheck(start) {
    const initialized = start | 0;
    return function readsWithoutCheck(n) { return (n | 0) + initialized; };
}
function makeCallsHelper() {
    function callsHelper(n) { return helper(n); }
    const helper = x => (x | 0) + 1;
    return callsHelper;
}
let readsAnything = makeReadsAnything(1), readsOptionalObject = makeReadsOptionalObject(true), readsWithoutCheck = makeReadsWithoutCheck(2), callsHelper = makeCallsHelper();
for (let f of [makeReadsAnything, makeReadsOptionalObject, makeReadsWithoutCheck, makeCallsHelper, readsAnything, readsOptionalObject, readsWithoutCheck, callsHelper])
    noInline(f);

check([1, -0, NaN, "", null, undefined, 5n].map(value => Object.is(makeReadsAnything(value)(), value)).join(), "true,true,true,true,true,true,true", "a captured value of any type");
check(readsOptionalObject() + makeReadsOptionalObject(false)(), 1, "a captured object or undefined");
check(readsWithoutCheck(3), 5, "a captured Int32 that needs no check");
check(callsHelper(4), 5, "a captured function");
console.log("passed");
