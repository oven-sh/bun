const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;

function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

const isCounting = typeof aotOperationCount === "function" && !!aotRemarks("check") && !!jscOptions().useAOTOperationCounters;

function answeredFromCache()
{
    return isCounting ? aotOperationCount("operationAOTHasOwnProperty:cached") || 0 : 0;
}

function arrivals()
{
    return isCounting ? aotOperationCount("operationAOTHasOwnProperty") || 0 : 0;
}

function has(object, key) { return Object.hasOwn(object, key); }
noInline(has);

function ask(object, key, expected, isCacheable, what)
{
    check(has(object, key), expected, what + ", at first");
    const cachedBefore = answeredFromCache(), arrivalsBefore = arrivals();
    for (let i = 0; i < 20; ++i)
        check(has(object, key), expected, what);
    if (!isCounting)
        return;
    check(arrivals() - arrivalsBefore, 20, what + ": arrivals at the operation");
    const cached = answeredFromCache() - cachedBefore;
    if (isCacheable === true)
        check(cached >= 15, true, what + ": most answers come from the cache (" + cached + " of 20)");
    else if (isCacheable === false)
        check(cached, 0, what + ": answers from the cache");
}

function test()
{
    const symbol = Symbol("s");
    const plain = { a: 1, b: undefined, [symbol]: 2, get c() { return 3; } };
    ask(plain, "a", true, true, "a property");
    ask(plain, "b", true, true, "a property that is undefined");
    ask(plain, "c", true, true, "a getter");
    ask(plain, symbol, true, true, "a symbol");
    ask(plain, "z", false, true, "an absent name");
    ask(plain, Symbol("other"), false, true, "an absent symbol");
    ask(plain, "toString", false, true, "a name that is only inherited");
    ask(plain, "a" + String(""), true, true, "a name that is made at run time");
    ask(plain, { toString() { return "a"; } }, true, undefined, "a key that is an object");
    ask(plain, 5, false, false, "an absent index");
    ask(plain, "5", false, false, "an absent index as a string");

    ask({ a: 1, b: undefined, [symbol]: 2, get c() { return 3; } }, "a", true, true, "another object of the same shape");

    plain.z = 1;
    ask(plain, "z", true, true, "a name that was absent and was added");
    ask({ a: 1, b: undefined, [symbol]: 2, get c() { return 3; } }, "z", false, true, "the same name on an object that did not get it");
    delete plain.z;
    ask(plain, "z", false, undefined, "a name that was deleted");
    ask(plain, "a", true, undefined, "a name that stayed when another was deleted");

    const inheritor = Object.create(plain);
    ask(inheritor, "a", false, undefined, "a name that the prototype has");
    inheritor.a = 2;
    ask(inheritor, "a", true, undefined, "and then the object itself");

    const dictionary = { };
    for (let i = 0; i < 300; ++i)
        dictionary["key" + i] = i;
    ask(dictionary, "key7", true, false, "a dictionary");
    ask(dictionary, "none", false, false, "an absent name in a dictionary");
    delete dictionary.key7;
    ask(dictionary, "key7", false, false, "a name deleted from a dictionary");

    const array = [1, , 3];
    ask(array, "length", true, undefined, "the length of an array");
    ask(array, 0, true, false, "an element");
    ask(array, 1, false, false, "a hole");
    ask(array, "named", false, undefined, "an absent name on an array");

    ask(new String("ab"), "length", true, undefined, "the length of a String object");
    ask(new String("ab"), 1, true, false, "a character of a String object");
    ask(new String("ab"), 2, false, false, "past the end of a String object");
    ask(new Uint8Array(2), 1, true, false, "an element of a typed array");
    ask(new Uint8Array(2), 2, false, false, "past the end of a typed array");
    ask(new Uint8Array(2), "1.5", false, undefined, "a canonical numeric string on a typed array");
    ask((function () { return arguments; })(1), "length", true, undefined, "the length of arguments");
    ask((function () { return arguments; })(1), 0, true, false, "an argument");
    ask(function named() { }, "name", true, undefined, "the name of a function");
    ask(function named() { }, "prototype", true, undefined, "the prototype of a function");
    ask(function named() { }, "caller", false, undefined, "caller on a function");
    ask(/a/, "lastIndex", true, undefined, "lastIndex");
    ask(globalThis, "Object", true, undefined, "a global");
    ask(globalThis, "notThereAtAll", false, undefined, "an absent global");

    let traps = 0;
    const proxy = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(target, key) { ++traps; return Reflect.getOwnPropertyDescriptor(target, key); } });
    ask(proxy, "a", true, false, "a proxy");
    check(traps, 21, "the trap runs each time");
    ask(proxy, "z", false, false, "an absent name on a proxy");
    check(traps, 42, "the trap runs each time");

    const frozen = Object.freeze({ a: 1 });
    ask(frozen, "a", true, true, "a frozen object");
    ask(frozen, "z", false, true, "an absent name on a frozen object");
    ask(Object.create(null), "a", false, undefined, "an object without a prototype");

    const survivor = { kept: 1 };
    ask(survivor, "kept", true, true, "before a collection");
    fullGC();
    ask(survivor, "kept", true, true, "after a collection");

    let thrown = null;
    try {
        has(plain, { toString() { throw new RangeError("no key"); } });
    } catch (error) {
        thrown = error.constructor;
    }
    check(thrown, RangeError, "a key whose conversion throws");
}
test();
console.log("passed");
