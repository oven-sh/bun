function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
let asked = 0;
function convertsToIterator() {
    const o = { [Symbol.toPrimitive]() { ++asked; return Symbol.iterator; } };
    return [o == Symbol.iterator, Symbol.iterator == o, o != Symbol.iterator, o == Symbol.hasInstance];
}
check(convertsToIterator().join(), "true,true,false,false", "an object that converts to a symbol");
check(asked, 4, "conversions");

function branches() {
    const o = { valueOf() { ++asked; return Symbol.iterator; } };
    let taken = "";
    if (o == Symbol.iterator) taken += "a";
    if (o != Symbol.iterator) taken += "b";
    if (Symbol.iterator == o) taken += "c";
    return taken;
}
asked = 0;
check(branches(), "ac", "in conditions");
check(asked, 3, "conversions in conditions");

function throwsWhenAsked() {
    const o = { [Symbol.toPrimitive]() { throw new RangeError("asked"); } };
    try {
        return o == Symbol.iterator;
    } catch (error) {
        return error.constructor.name;
    }
}
check(throwsWhenAsked(), "RangeError", "a conversion that throws");

function inLoop(n) {
    const o = { [Symbol.toPrimitive]() { ++asked; return Symbol.iterator; } };
    let equal = 0;
    for (let i = 0; i < n; ++i) {
        if (o == Symbol.iterator)
            ++equal;
    }
    return equal;
}
asked = 0;
check(inLoop(100), 100, "in a loop");
check(asked, 100, "conversions in a loop");

function sameKinds() {
    const a = {}, b = {}, s = Symbol.iterator, t = Symbol.hasInstance;
    return [a == a, a == b, s == s, s == t, a != b, s != t];
}
check(sameKinds().join(), "true,false,true,false,true,true", "two objects, two symbols");

function wrapper() { return [Object(Symbol.iterator) == Symbol.iterator, Symbol.iterator == Object(Symbol.iterator), Object(Symbol.iterator) == Symbol.hasInstance]; }
check(wrapper().join(), "true,true,false", "a Symbol object");
console.log("passed");
