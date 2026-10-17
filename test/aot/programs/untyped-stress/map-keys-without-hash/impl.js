function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function repeat(f) {
    for (let i = 0; i < 200; i++)
        f(i);
}

function get(map, key) { return map.get(key); }
function has(collection, key) { return collection.has(key); }
function set(map, key, value) { map.set(key, value); }
function setAndReturn(map, key, value) { return map.set(key, value); }
function add(collection, key) { collection.add(key); }
function addAndReturn(collection, key) { return collection.add(key); }
for (const f of [get, has, set, setAndReturn, add, addAndReturn])
    noInline(f);

function rope(i) { return "a key that is long enough, " + i + "," + (i + 1); }
function fresh(i) { return String.fromCharCode(97 + i % 26, 98 + i % 24, 99 + i % 22); }

{
    const map = new Map;
    const seen = new Set;
    repeat(i => {
        check(get(map, rope(i)), undefined, "a rope that is not there");
        check(has(map, rope(i)), false, "whether a rope is there, before");
        check(has(seen, rope(i)), false, "whether a rope is in a set, before");
        set(map, rope(i), i);
        add(seen, rope(i));
        check(get(map, rope(i)), i, "a rope that is there");
        check(has(map, rope(i)), true, "whether a rope is there, after");
        check(has(seen, rope(i)), true, "whether a rope is in a set, after");
    });
    check(map.size, 200, "the size of the map");
    check(seen.size, 200, "the size of the set");
    repeat(i => {
        set(map, rope(i), -i);
        add(seen, rope(i));
        check(get(map, rope(i)), -i, "a rope whose value was replaced");
    });
    check(map.size, 200, "the size of the map after replacing");
    check(seen.size, 200, "the size of the set after adding again");
    check([...map.keys()][3], rope(3), "the order of the keys");
}

{
    const map = new Map;
    repeat(i => {
        set(map, fresh(i), i);
        check(get(map, fresh(i)), i, "a string that has no hash yet");
        check(has(map, fresh(i)), true, "whether a string that has no hash yet is there");
    });
}

{
    const map = new Map([[0, "zero"], [1.5, "one and a half"], [NaN, "not a number"], [2 ** 40, "large"], [10n, "a BigInt"], [2n ** 70n, "a large BigInt"]]);
    const half = 0.5;
    repeat(() => {
        check(get(map, -0), "zero", "negative zero");
        check(get(map, half * 3), "one and a half", "a double");
        check(get(map, half * 2 - 1), "zero", "a double that is zero");
        check(get(map, NaN), "not a number", "NaN");
        check(get(map, 0 / 0), "not a number", "another NaN");
        check(get(map, 2 ** 40), "large", "a number above the int32 range");
        check(get(map, 10n), "a BigInt", "a BigInt");
        check(get(map, 5n + 5n), "a BigInt", "a BigInt that is computed");
        check(get(map, 2n ** 70n), "a large BigInt", "a large BigInt");
        check(get(map, 10), undefined, "a number is not a BigInt");
        check(has(map, -0), true, "whether negative zero is there");
        check(has(map, 2.5), false, "whether a double that is not there is there");
        check(has(map, 11n), false, "whether a BigInt that is not there is there");
    });
    set(map, -0, "replaced");
    check(get(map, 0), "replaced", "a value stored under negative zero");
    check(Object.is([...map.keys()][0], 0), true, "the key stays zero");
    const numbers = new Set;
    add(numbers, -0);
    check(Object.is([...numbers][0], 0), true, "negative zero is added as zero");
    check(has(numbers, 0), true, "zero after negative zero was added");
}

{
    const map = new Map;
    const collection = new Set;
    repeat(i => {
        check(setAndReturn(map, rope(i), i), map, "what set returns");
        check(addAndReturn(collection, rope(i)), collection, "what add returns");
    });
}

{
    const map = new Map([[rope(1), "theirs"]]);
    const overridden = new Map([[rope(1), "theirs"]]);
    overridden.get = function (key) { return "mine: " + Map.prototype.get.call(this, key); };
    overridden.has = () => "mine";
    class Counting extends Map {
        calls = 0;
        get(key) { this.calls++; return super.get(key); }
    }
    const counting = new Counting([[rope(1), "theirs"]]);
    const lookalike = { get(key) { return "an object: " + key.length; }, has() { return "an object"; } };
    repeat(() => {
        check(get(map, rope(1)), "theirs", "a map");
        check(get(overridden, rope(1)), "mine: theirs", "a map that has its own get");
        check(has(overridden, rope(1)), "mine", "a map that has its own has");
        check(get(counting, rope(1)), "theirs", "an instance of a class that overrides get");
        check(get(lookalike, rope(1)), "an object: " + rope(1).length, "an object that is no map");
        check(has(lookalike, rope(1)), "an object", "whether, of an object that is no map");
    });
    check(counting.calls, 200, "calls of the overriding method");
}

{
    const getInTailPosition = (function () { "use strict"; return (map, key) => map.get(key); })();
    const hasInTailPosition = (function () { "use strict"; return (collection, key) => collection.has(key); })();
    const setInTailPosition = (function () { "use strict"; return (map, key, value) => map.set(key, value); })();
    const addInTailPosition = (function () { "use strict"; return (collection, key) => collection.add(key); })();
    for (const f of [getInTailPosition, hasInTailPosition, setInTailPosition, addInTailPosition])
        noInline(f);
    const map = new Map([[NaN, "not a number"], [1.5, "a double"], [10n, "a BigInt"]]);
    const collection = new Set([NaN, 1.5, 10n]);
    const half = 0.5;
    repeat(i => {
        check(setInTailPosition(map, rope(i), i), map, "set in tail position");
        check(addInTailPosition(collection, rope(i)), collection, "add in tail position");
        check(getInTailPosition(map, rope(i)), i, "a rope, in tail position");
        check(hasInTailPosition(map, rope(i)), true, "whether a rope is there, in tail position");
        check(hasInTailPosition(collection, rope(i)), true, "whether a rope is in a set, in tail position");
        check(getInTailPosition(map, NaN), "not a number", "NaN, in tail position");
        check(getInTailPosition(map, half * 3), "a double", "a double, in tail position");
        check(getInTailPosition(map, 10n), "a BigInt", "a BigInt, in tail position");
        check(hasInTailPosition(collection, NaN), true, "whether NaN is in a set, in tail position");
        check(hasInTailPosition(collection, 2.5), false, "whether a double is in a set, in tail position");
    });
    check([rope(1), NaN, 2.5].map(key => hasInTailPosition(collection, key)).join(), "true,true,false", "in tail position, called by a function of the language");
    check([rope(1), NaN, 2.5].map(key => String(getInTailPosition(map, key))).join(), "1,not a number,undefined", "get in tail position, called by a function of the language");
    check([rope(1), NaN].some(hasInTailPosition.bind(null, collection)), true, "in tail position, bound");
}

{
    const weak = new WeakMap;
    const key = {};
    weak.set(key, 1);
    repeat(() => {
        check(get(weak, key), 1, "a WeakMap");
        check(get(weak, rope(1)), undefined, "a WeakMap and a rope");
        check(has(weak, rope(1)), false, "whether a rope is in a WeakMap");
    });
}

{
    const map = new Map;
    for (let round = 0; round < 4; round++) {
        repeat(i => set(map, rope(i) + round, { round, i }));
        fullGC();
        repeat(i => check(get(map, rope(i) + round).i, i, "after a collection"));
    }
    check(map.size, 800, "the size after collections");
}
console.log("passed");
