function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function errorOf(run)
{
    try {
        run();
    } catch (error) {
        return error.constructor;
    }
    return null;
}

function knownTypes()
{
    var isArrayImpl = Array.isArray;

    function isCompiledForSure() { return 0; }
    function deadForArray() { return "dead"; }
    function deadForAliasedArray() { return "dead"; }
    function deadForLiteral() { return "dead"; }
    function deadForFunction() { return "dead"; }
    function deadForMap() { return "dead"; }
    function deadForTypedArray() { return "dead"; }
    function deadForNumber() { return "dead"; }
    function deadForString() { return "dead"; }
    function deadForNothing() { return "dead"; }
    function deadThroughVariable() { return "dead"; }
    function deadBehindNot() { return "dead"; }
    function deadForSecondTest() { return "dead"; }

    function ofArray(x) { if (Array.isArray(x)) return 1; return deadForArray(); }
    function ofAliasedArray(x) { if (isArrayImpl(x)) return 1; return deadForAliasedArray(); }
    function ofLiteral(x) { if (Array.isArray(x)) return deadForLiteral(); return 2; }
    function ofFunction(x) { if (Array.isArray(x)) return deadForFunction(); return 2; }
    function ofMap(x) { if (Array.isArray(x)) return deadForMap(); return 2; }
    function ofTypedArray(x) { if (Array.isArray(x)) return deadForTypedArray(); return 2; }
    function ofNumber(x) { if (Array.isArray(x)) return deadForNumber(); return 2; }
    function ofString(x) { if (isArrayImpl(x)) return deadForString(); return 2; }
    function ofNothing(x) { if (Array.isArray(x)) return deadForNothing(); return 2; }
    function throughVariable(x) { var isArray = Array.isArray(x); if (isArray) return 1; return deadThroughVariable(); }
    function behindNot(x) { if (!Array.isArray(x)) return deadBehindNot(); return 1; }
    function lengthOfArrayOrNumber(x) { if (Array.isArray(x)) return x.length; return -1; }
    function testsTwice(x) { if (Array.isArray(x)) { if (Array.isArray(x)) return 1; return deadForSecondTest(); } return 2; }

    for (let i = 0; i < 100; ++i) {
        check(isCompiledForSure(), 0, "a function that runs");
        check(ofArray([i]), 1, "an array");
        check(ofArray([]), 1, "an array");
        check(ofAliasedArray([i, i]), 1, "an array, by an alias");
        check(ofLiteral({ length: i }), 2, "a literal");
        check(ofFunction(function () { }), 2, "a function");
        check(ofMap(new Map), 2, "a map");
        check(ofTypedArray(new Uint8Array(2)), 2, "a typed array");
        check(ofNumber(i), 2, "a number");
        check(ofString("ab"), 2, "a string");
        check(ofNothing(i & 1 ? null : undefined), 2, "null or undefined");
        check(throughVariable([i]), 1, "through a variable");
        check(behindNot([i]), 1, "behind a not");
        check(lengthOfArrayOrNumber(i & 1 ? [1, 2, 3] : i), i & 1 ? 3 : -1, "an array or a number");
        check(testsTwice(i & 1 ? [1] : i), i & 1 ? 1 : 2, "tested twice");
    }
}
knownTypes();

function numbers()
{
    function deadForInteger() { return "dead"; }
    function deadForStringAsInteger() { return "dead"; }
    function deadForFinite() { return "dead"; }
    function deadForNaN() { return "dead"; }

    function integer(x) { if (Number.isInteger(x)) return 1; return deadForInteger(); }
    function stringAsInteger(x) { if (Number.isInteger(x)) return deadForStringAsInteger(); return 2; }
    function finite(x) { if (Number.isFinite(x)) return 1; return deadForFinite(); }
    function integerAsNaN(x) { if (Number.isNaN(x)) return deadForNaN(); return 2; }
    function anyNumber(x) { if (Number.isInteger(x)) return 1; return 2; }
    function anyNumberAsNaN(x) { if (Number.isNaN(x)) return 1; return 2; }

    for (let i = 0; i < 100; ++i) {
        check(integer(i | 0), 1, "an integer");
        check(stringAsInteger("5"), 2, "a string");
        check(finite(i | 0), 1, "an integer is finite");
        check(integerAsNaN(i | 0), 2, "an integer is not NaN");
        check(anyNumber(i & 1 ? i : i + 0.5), i & 1 ? 1 : 2, "a number");
        check(anyNumber(Infinity), 2, "infinity");
        check(anyNumberAsNaN(i & 1 ? NaN : i + 0.5), i & 1 ? 1 : 2, "a number");
    }
}
numbers();

function unknownTypes()
{
    class Derived extends Array { }
    const revocable = Proxy.revocable([], { });
    revocable.revoke();

    function liveForProxy() { return "a proxy"; }
    function test(x) { if (Array.isArray(x)) return 1; return 2; }
    function value(x) { return Array.isArray(x); }
    function lengthBehind(x) { if (Array.isArray(x)) return x.length; return -1; }
    function elementBehind(x) { if (Array.isArray(x)) return x[0]; return -1; }
    function notBehind(x) { if (!Array.isArray(x)) return typeof x; return "array"; }
    function ofProxy(x) { if (Array.isArray(x)) return liveForProxy(); return 2; }
    function onOnePath(flag) { var x = flag ? [1] : { length: 1 }; if (Array.isArray(x)) return 1; return 2; }
    function withoutArgument() { if (Array.isArray()) return 1; return 2; }
    function withMoreArguments(x, y) { if (Array.isArray(x, y)) return 1; return 2; }
    function ofArguments() { if (Array.isArray(arguments)) return 1; return 2; }

    const arrays = [[], [1], [1.5], ["a"], new Array(3), new Derived, Derived.of(7), new Proxy([], { }), new Proxy(new Proxy([7], { }), { }), new Proxy(new Derived, { }), Array.prototype];
    const others = [0, 1.5, NaN, "", "ab", true, null, undefined, Symbol(), 1n, { }, { length: 0 }, function () { }, class { }, new Map, new Set, /x/, new Date, new Uint8Array(1), new ArrayBuffer(1),
        new Proxy({ }, { }), new Proxy(function () { }, { }), Object.create(Array.prototype), Object.create(null), new String("ab"), Promise.resolve(), new Error, new WeakMap];

    for (let i = 0; i < 50; ++i) {
        for (const array of arrays) {
            check(test(array), 1, "an array");
            check(value(array), true, "an array");
            check(lengthBehind(array), array.length, "the length of an array");
            check(elementBehind(array), array[0], "an element of an array");
            check(notBehind(array), "array", "an array");
            check(withMoreArguments(array, 5), 1, "more arguments");
        }
        for (const other of others) {
            check(test(other), 2, "no array");
            check(value(other), false, "no array");
            check(lengthBehind(other), -1, "no array");
            check(elementBehind(other), -1, "no array");
            check(notBehind(other), typeof other, "no array");
            check(withMoreArguments(other, []), 2, "more arguments");
        }
        check(ofProxy(new Proxy([], { })), "a proxy", "a proxy of an array");
        check(ofProxy(new Proxy({ }, { })), 2, "a proxy of an object");
        check(onOnePath(i & 1), i & 1 ? 1 : 2, "an array on one path");
        check(withoutArgument(), 2, "no argument");
        check(ofArguments(1, 2), 2, "an arguments object");
    }
    check(errorOf(() => test(revocable.proxy)), TypeError, "a revoked proxy");
    check(errorOf(() => value(revocable.proxy)), TypeError, "a revoked proxy");
}
unknownTypes();
console.log("passed");
