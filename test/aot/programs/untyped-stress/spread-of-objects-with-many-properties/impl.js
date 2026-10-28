function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function spreadLast(o) { return { z: 0, ...o }; }
function spreadTwo(o, p) { return { ...o, ...p }; }
function restOf(o) { const { k0, k1, k2, k3, k4, k5, k6, k7, k8, k9, ...rest } = o; return rest; }
for (const f of [spreadLast, spreadTwo, restOf])
    noInline(f);

function makeDictionary(hidden, visible) {
    const result = {};
    for (let i = 0; i < hidden; i++)
        Object.defineProperty(result, "h" + i, { value: i, enumerable: false, writable: true, configurable: true });
    for (let i = 0; i < visible; i++)
        result["k" + i] = i;
    return result;
}
function keysOf(o) { return Object.keys(o).length; }

{
    const map = makeDictionary(20, 115);
    check(keysOf(spreadLast(map)), 116, "a spread of an object with many properties");
    check(keysOf(spreadLast(map)), 116, "the same spread again");
    map["extra"] = 1;
    check(keysOf(spreadLast(map)), 117, "a spread after a property was added");
    check(spreadLast(map).extra, 1, "the property that was added");
    map["another"] = 2;
    map["k3"] = "changed";
    const copy = spreadLast(map);
    check(keysOf(copy), 118, "a spread after a second property was added");
    check(copy.another, 2, "the second property that was added");
    check(copy.k3, "changed", "a property that was changed");
    check(copy.h3, undefined, "a property that is not enumerable");
    delete map.k7;
    check(keysOf(spreadLast(map)), 117, "a spread after a property was deleted");
    check("k7" in spreadLast(map), false, "the property that was deleted");
}

{
    const map = makeDictionary(30, 105);
    const small = { a: 1 };
    check(keysOf(spreadTwo(small, map)), 106, "a spread of two objects");
    map["extra"] = 1;
    check(keysOf(spreadTwo(small, map)), 107, "a spread of two objects after a property was added to the second");
    check(spreadTwo(small, map).extra, 1, "the property that was added to the second");
}

{
    const map = makeDictionary(0, 135);
    check(map.k0, 0, "a read that may flatten the object");
    for (let i = 0; i < 3; i++)
        map["more" + i] = i;
    check(keysOf(restOf(map)), 128, "the rest of an object with many properties");
    map["extra"] = 1;
    check(keysOf(restOf(map)), 129, "the rest after a property was added");
    check(restOf(map).extra, 1, "the property that was added, in the rest");
}

{
    class Methods { first() { } second() { } }
    check(Object.keys(spreadLast(Methods.prototype)).join(), "z", "a spread of a prototype with methods only");
    Methods.prototype.added = 1;
    check(Object.keys(spreadLast(Methods.prototype)).join(), "z,added", "a spread of a prototype after a property was added");
    Methods.prototype.alsoAdded = 2;
    check(Object.keys(spreadLast(Methods.prototype)).join(), "z,added,alsoAdded", "a spread of a prototype after a second property was added");
}

{
    for (let i = 0; i < 100; i++) {
        const plain = { a: i, b: i + 1 };
        const copy = spreadLast(plain);
        check(Object.keys(copy).join(), "z,a,b", "a spread of a plain object");
        check(copy.b, i + 1, "a property of a plain object");
        plain.c = i;
        check(Object.keys(spreadLast(plain)).join(), "z,a,b,c", "a spread of a plain object after a property was added");
    }
}
console.log("passed");
