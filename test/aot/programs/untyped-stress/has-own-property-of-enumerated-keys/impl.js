function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function test()
{
    var hasOwnProperty = Object.prototype.hasOwnProperty;

    function ownKeysByAlias(object)
    {
        var keys = "";
        for (var key in object) {
            if (hasOwnProperty.call(object, key))
                keys += key;
        }
        return keys;
    }

    function ownKeysByPath(object)
    {
        var keys = "";
        for (var key in object) {
            if (Object.prototype.hasOwnProperty.call(object, key))
                keys += key;
        }
        return keys;
    }

    function ownKeysWhileDeleting(object, doomed)
    {
        var keys = "";
        for (var key in object) {
            delete object[doomed];
            if (hasOwnProperty.call(object, key))
                keys += key;
        }
        return keys;
    }

    function ownKeysWhileAdding(object)
    {
        var keys = "";
        for (var key in object) {
            object["added" + key] = 1;
            if (hasOwnProperty.call(object, key))
                keys += key;
        }
        return keys;
    }

    function keysOwnedByAnother(object, another)
    {
        var keys = "";
        for (var key in object) {
            if (hasOwnProperty.call(another, key))
                keys += key;
        }
        return keys;
    }

    function changedKeys(object)
    {
        var keys = "";
        for (var key in object) {
            if (hasOwnProperty.call(object, key + "x"))
                keys += key;
        }
        return keys;
    }

    function outerKeysOwnedByInner(outer, inner)
    {
        var keys = "";
        for (var outerKey in outer) {
            for (var innerKey in inner) {
                if (hasOwnProperty.call(inner, outerKey))
                    keys += outerKey + innerKey;
            }
        }
        return keys;
    }

    function keyKeptAfterTheLoop(object)
    {
        var last;
        for (var key in object)
            last = key;
        delete object[last];
        return hasOwnProperty.call(object, last);
    }

    function withoutKey(object)
    {
        var count = 0;
        for (var key in object) {
            if (hasOwnProperty.call(object))
                ++count;
        }
        return count;
    }

    function Inherits() { this.own = 1; }
    Inherits.prototype.inherited = 2;

    for (let i = 0; i < 200; ++i) {
        for (const ownKeys of [ownKeysByAlias, ownKeysByPath]) {
            check(ownKeys({ a: 1, b: i, c: null }), "abc", "a literal");
            check(ownKeys({}), "", "an empty object");
            check(ownKeys({ ["k" + (i & 3)]: 1, z: 2 }), "k" + (i & 3) + "z", "several shapes");
            check(ownKeys(new Inherits), "own", "an inherited key");
            check(ownKeys(Object.create({ above: 1 }, { here: { value: 1, enumerable: true } })), "here", "an inherited key");
            check(ownKeys([7, 8]), "01", "an array");
            check(ownKeys(Object.assign([7], { named: 1 })), "0named", "an array with a named property");
            check(ownKeys("ab"), "01", "a string");
            check(ownKeys(5), "", "a number");
            check(ownKeys(null), "", "null");
            check(ownKeys(undefined), "", "undefined");
            check(ownKeys(new Proxy({ p: 1, q: 2 }, { getOwnPropertyDescriptor(target, key) { return key == "q" ? undefined : Reflect.getOwnPropertyDescriptor(target, key); } })), "p", "a proxy");
        }
        check(ownKeysWhileDeleting({ a: 1, b: 2, c: 3 }, "a"), "bc", "the first key is deleted");
        check(ownKeysWhileDeleting({ a: 1, b: 2, c: 3 }, "c"), "ab", "the last key is deleted");
        check(ownKeysWhileDeleting({ a: 1, b: 2, c: 3 }, "absent"), "abc", "nothing is deleted");
        check(ownKeysWhileAdding({ a: 1, b: 2 }), "ab", "keys are added");
        check(keysOwnedByAnother({ a: 1, b: 2 }, { b: 1 }), "b", "another object");
        check(keysOwnedByAnother({ a: 1, b: 2 }, { a: 1, b: 2 }), "ab", "another object of the same shape");
        check(keysOwnedByAnother({ a: 1, b: 2 }, {}), "", "another object");
        check(changedKeys({ a: 1, ax: 2 }), "a", "another key");
        check(outerKeysOwnedByInner({ a: 1, b: 2 }, { b: 1, c: 2 }), "bbbc", "the key of an outer loop");
        check(keyKeptAfterTheLoop({ a: 1, b: 2 }), false, "a key kept after the loop");
        check(withoutKey({ a: 1, undefined: 2 }), 2, "no key");
        check(withoutKey({ a: 1 }), 0, "no key");
    }

    const dictionary = {};
    for (let i = 0; i < 200; ++i)
        dictionary["key" + i] = i;
    delete dictionary.key7;
    check(ownKeysByAlias(dictionary).length, ownKeysByPath(dictionary).length, "a dictionary");
    check(ownKeysByAlias(dictionary).includes("key7key"), false, "a dictionary");
    check(ownKeysByAlias(dictionary).startsWith("key0key1key2"), true, "a dictionary");
}
test();
console.log("passed");
