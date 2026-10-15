function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function has(object, key) { return Object.hasOwn(object, key); }
noInline(has);

function ask(object, key, expected, what)
{
    check(has(object, key), expected, what + ", at first");
    for (let i = 0; i < 20; ++i)
        check(has(object, key), expected, what);
}

function test()
{
    const symbol = Symbol("s");
    const plain = { a: 1, b: undefined, [symbol]: 2, get c() { return 3; } };
    ask(plain, "a", true, "a property");
    ask(plain, "b", true, "a property that is undefined");
    ask(plain, "c", true, "a getter");
    ask(plain, symbol, true, "a symbol");
    ask(plain, "z", false, "an absent name");
    ask(plain, Symbol("other"), false, "an absent symbol");
    ask(plain, "toString", false, "a name that is only inherited");
    ask(plain, "a" + String(""), true, "a name that is made at run time");
    ask(plain, { toString() { return "a"; } }, true, "a key that is an object");
    ask(plain, 5, false, "an absent index");
    ask(plain, "5", false, "an absent index as a string");

    ask({ a: 1, b: undefined, [symbol]: 2, get c() { return 3; } }, "a", true, "another object of the same shape");

    plain.z = 1;
    ask(plain, "z", true, "a name that was absent and was added");
    ask({ a: 1, b: undefined, [symbol]: 2, get c() { return 3; } }, "z", false, "the same name on an object that did not get it");
    delete plain.z;
    ask(plain, "z", false, "a name that was deleted");
    ask(plain, "a", true, "a name that stayed when another was deleted");

    const inheritor = Object.create(plain);
    ask(inheritor, "a", false, "a name that the prototype has");
    inheritor.a = 2;
    ask(inheritor, "a", true, "and then the object itself");

    const dictionary = { };
    for (let i = 0; i < 300; ++i)
        dictionary["key" + i] = i;
    ask(dictionary, "key7", true, "a dictionary");
    ask(dictionary, "none", false, "an absent name in a dictionary");
    delete dictionary.key7;
    ask(dictionary, "key7", false, "a name deleted from a dictionary");

    const array = [1, , 3];
    ask(array, "length", true, "the length of an array");
    ask(array, 0, true, "an element");
    ask(array, 1, false, "a hole");
    ask(array, "named", false, "an absent name on an array");

    ask(new String("ab"), "length", true, "the length of a String object");
    ask(new String("ab"), 1, true, "a character of a String object");
    ask(new String("ab"), 2, false, "past the end of a String object");
    ask(new Uint8Array(2), 1, true, "an element of a typed array");
    ask(new Uint8Array(2), 2, false, "past the end of a typed array");
    ask(new Uint8Array(2), "1.5", false, "a canonical numeric string on a typed array");
    ask((function () { return arguments; })(1), "length", true, "the length of arguments");
    ask((function () { return arguments; })(1), 0, true, "an argument");
    ask(function named() { }, "name", true, "the name of a function");
    ask(function named() { }, "prototype", true, "the prototype of a function");
    ask(function named() { }, "caller", false, "caller on a function");
    ask(/a/, "lastIndex", true, "lastIndex");
    ask(globalThis, "Object", true, "a global");
    ask(globalThis, "notThereAtAll", false, "an absent global");

    let traps = 0;
    const proxy = new Proxy({ a: 1 }, { getOwnPropertyDescriptor(target, key) { ++traps; return Reflect.getOwnPropertyDescriptor(target, key); } });
    ask(proxy, "a", true, "a proxy");
    check(traps, 21, "the trap runs each time");
    ask(proxy, "z", false, "an absent name on a proxy");
    check(traps, 42, "the trap runs each time");

    const frozen = Object.freeze({ a: 1 });
    ask(frozen, "a", true, "a frozen object");
    ask(frozen, "z", false, "an absent name on a frozen object");
    ask(Object.create(null), "a", false, "an object without a prototype");

    const survivor = { kept: 1 };
    ask(survivor, "kept", true, "before a collection");
    fullGC();
    ask(survivor, "kept", true, "after a collection");

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
