function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function errorThrownBy(f, ...args) {
    try {
        f(...args);
    } catch (error) {
        return error;
    }
    return null;
}
const other = createGlobalObject();

function codeAt(text, index) { let result = text.charCodeAt(index); return result; }
function pointAt(text, index) { let result = text.codePointAt(index); return result; }
function characterAt(text, index) { let result = text.charAt(index); return result; }
function codeAtInTailPosition(text, index) { "use strict"; return text.charCodeAt(index); }
function pushes(array, value) { let result = array.push(value); return result; }
function pushesIgnoringResult(array, value) { array.push(value); }
function pushesInTailPosition(array, value) { "use strict"; return array.push(value); }
function pops(array) { let result = array.pop(); return result; }
function popsInTailPosition(array) { "use strict"; return array.pop(); }
function isArray(value) { let result = Array.isArray(value); return result; }
function isArrayOf(holder, value) { let result = holder.isArray(value); return result; }
function gets(table, key) { let result = table.get(key); return result; }
function getsInTailPosition(table, key) { "use strict"; return table.get(key); }
function has(table, key) { let result = table.has(key); return result; }
function sets(table, key, value) { let result = table.set(key, value); return result; }
function setsIgnoringResult(table, key, value) { table.set(key, value); }
function setsInTailPosition(table, key, value) { "use strict"; return table.set(key, value); }
function adds(table, key) { let result = table.add(key); return result; }
function addsIgnoringResult(table, key) { table.add(key); }
function addsInTailPosition(table, key) { "use strict"; return table.add(key); }
for (let f of [codeAt, pointAt, characterAt, codeAtInTailPosition, pushes, pushesIgnoringResult, pushesInTailPosition, pops, popsInTailPosition, isArray, isArrayOf, gets, getsInTailPosition, has, sets, setsIgnoringResult, setsInTailPosition, adds, addsIgnoringResult, addsInTailPosition])
    noInline(f);

function ropeOf(a, b) { return a + b; }
noInline(ropeOf);

for (let round = 0; round < 3; ++round) {
    for (let text of ["text", "téxt", "tęxt", ropeOf("te", "xt" + round).slice(0, 4), ropeOf("te", "xt")]) {
        check(codeAt(text, 0), 116, "charCodeAt(0)");
        check(codeAt(text, 3), 116, "charCodeAt(3)");
        check(codeAtInTailPosition(text, 3), 116, "charCodeAt(3) in tail position");
        for (let outside of [4, 5, -1, -0x80000000, 0x7fffffff, 4.5, -1.5, Infinity, -Infinity, 1e10]) {
            check(codeAt(text, outside), NaN, "charCodeAt(" + outside + ")");
            check(codeAtInTailPosition(text, outside), NaN, "charCodeAt(" + outside + ") in tail position");
            check(pointAt(text, outside), undefined, "codePointAt(" + outside + ")");
            check(characterAt(text, outside), "", "charAt(" + outside + ")");
        }
        for (let first of [0.5, -0.5, NaN, undefined, null, "0", -0, { valueOf() { return 0; } }]) {
            check(codeAt(text, first), 116, "charCodeAt of something that becomes 0");
            check(pointAt(text, first), 116, "codePointAt of something that becomes 0");
            check(characterAt(text, first), "t", "charAt of something that becomes 0");
        }
        check(characterAt(text, 1), text[1], "charAt(1)");
        check(pointAt(text, 1), text[1].charCodeAt(0), "codePointAt(1)");
    }
    check(codeAt("", 0), NaN, "charCodeAt(0) of the empty string");
    check(characterAt("", 0), "", "charAt(0) of the empty string");
    check(pointAt("", 0), undefined, "codePointAt(0) of the empty string");
    check(pointAt("a😀", 1), 0x1f600, "codePointAt of a pair of surrogates");
    check(pointAt("a😀", 2), 0xde00, "codePointAt of the second surrogate");
    check(pointAt("a\ud83d", 1), 0xd83d, "codePointAt of a lone surrogate");
    check(codeAt("a😀", 1), 0xd83d, "charCodeAt of a surrogate");
    check(characterAt("a中", 1), "中", "charAt of a character that is not Latin-1");
    check(codeAt({ charCodeAt(index) { return "mine " + index; } }, 9), "mine 9", "charCodeAt of an object");
    check(codeAt(new String("text"), 9), NaN, "charCodeAt(9) of a String object");
    check(errorThrownBy(codeAt, "text", Symbol()) instanceof TypeError, true, "charCodeAt(symbol)");
    check(errorThrownBy(codeAt, "text", { valueOf() { throw new RangeError(); } }) instanceof RangeError, true, "charCodeAt of an index that throws");
}

for (let round = 0; round < 3; ++round) {
    let grown = [];
    for (let i = 0; i < 100; ++i)
        check(pushes(grown, i), i + 1, "push onto an array that grows");
    check(grown.join(), Array.from({ length: 100 }, (unused, i) => i).join(), "an array that has grown");
    let objects = [];
    for (let i = 0; i < 100; ++i)
        pushesIgnoringResult(objects, { i });
    check(objects.every((o, i) => o.i === i), true, "an array of objects that has grown");
    let doubles = [0.5];
    check(pushes(doubles, 1.5), 2, "push of a double onto doubles");
    check(pushes(doubles, 2), 3, "push of an integer onto doubles");
    check(pushes(doubles, "text"), 4, "push of a string onto doubles");
    check(doubles.join(), "0.5,1.5,2,text", "what was an array of doubles");
    let integers = [1];
    check(pushes(integers, 2), 2, "push onto an array literal");
    check(pushes(integers, 2.5), 3, "push of a double onto integers");
    check(pushes(integers, {}), 4, "push of an object onto what were integers");
    check(integers.length, 4, "what was an array of integers");
    check(pushes(new Array(), 1), 1, "push onto new Array()");
    check(pushes(new Array(3), 1), 4, "push onto new Array(3)");
    check(pushesInTailPosition([1, 2, 3], 4), 4, "push onto an array literal in tail position");
    let sparse = [];
    sparse[100000] = 1;
    check(pushes(sparse, 2), 100002, "push onto a sparse array");
    check(sparse[100001], 2, "a sparse array");
    let full = [];
    full.length = 0xffffffff;
    check(errorThrownBy(pushes, full, 1) instanceof RangeError, true, "push onto an array of the maximum length");
    check(errorThrownBy(pushesInTailPosition, full, 1) instanceof RangeError, true, "push onto an array of the maximum length in tail position");
    check(errorThrownBy(pushes, Object.freeze([1]), 2) instanceof TypeError, true, "push onto a frozen array");
    check(errorThrownBy(pushes, Object.freeze([]), 2) instanceof TypeError, true, "push onto an empty frozen array");
    check(errorThrownBy(pushes, Object.preventExtensions([1]), 2) instanceof TypeError, true, "push onto an array that cannot be extended");
    let foreign = new other.Array();
    check(pushes(foreign, 1), 1, "push onto an array of another realm");
    for (let i = 0; i < 20; ++i)
        pushes(foreign, { i });
    check(foreign.length, 21, "an array of another realm");
    check(errorThrownBy(pushes, other.Object.freeze(new other.Array(1, 2)), 3) instanceof other.TypeError, true, "the realm of the error for a frozen array of another realm");
    check(errorThrownBy(pops, other.Object.freeze(new other.Array(1, 2))) instanceof other.TypeError, true, "the realm of the error for a frozen array of another realm");
    class Stack extends Array { push(value) { return "pushed " + super.push(value); } pop() { return "popped " + super.pop(); } }
    class Plain extends Array { }
    check(pushes(new Stack(), 5), "pushed 1", "push of a subclass");
    check(pops(Stack.of(5)), "popped 5", "pop of a subclass");
    check(pushes(new Plain(), 5), 1, "push inherited by a subclass");
    check(pops(Plain.of(5)), 5, "pop inherited by a subclass");
    let own = [1];
    own.push = function (value) { return "own " + value; };
    own.pop = function () { return "own"; };
    check(pushes(own, 2), "own 2", "push that is an own property");
    check(pops(own), "own", "pop that is an own property");
    check(pushes({ push: Array.prototype.push, length: 3 }, 1), 4, "push on an object");
    check(pops({ pop: Array.prototype.pop, length: 1, 0: "last" }), "last", "pop on an object");

    check(pops([]), undefined, "pop of an empty array");
    check(popsInTailPosition([]), undefined, "pop of an empty array in tail position");
    check(pops([1, 2, 3]), 3, "pop of an array literal");
    check(pops([0.5, 1.5]), 1.5, "pop of doubles");
    check(pops([1, , ]), undefined, "pop of a hole");
    check(popsInTailPosition([1, , ]), undefined, "pop of a hole in tail position");
    check(pops(new Array(3)), undefined, "pop of new Array(3)");
    let shrinking = [{ a: 1 }, "text", 3];
    pushes(shrinking, 4);
    check(pops(shrinking), 4, "pop");
    check(pops(shrinking), 3, "pop");
    check(pops(shrinking), "text", "pop");
    check(pops(shrinking).a, 1, "pop");
    check(pops(shrinking), undefined, "pop of an array that has become empty");
    check(shrinking.length, 0, "an array that has become empty");
    check(pops(sparse), 2, "pop of a sparse array");
    check(errorThrownBy(pops, Object.freeze([1])) instanceof TypeError, true, "pop of a frozen array");
    check(errorThrownBy(pops, Object.freeze([])) instanceof TypeError, true, "pop of an empty frozen array");

    check(isArray([]), true, "Array.isArray(array)");
    check(isArray(new Plain()), true, "Array.isArray of a subclass");
    check(isArray(new other.Array()), true, "Array.isArray of an array of another realm");
    check(isArray({}), false, "Array.isArray(object)");
    check(isArray(1), false, "Array.isArray(1)");
    check(isArray(new Proxy([], {})), true, "Array.isArray of a proxy of an array");
    check(isArray(new Proxy({}, {})), false, "Array.isArray of a proxy of an object");
    for (let holder of [Array, other.Array]) {
        check(isArrayOf(holder, []), true, "isArray(array)");
        check(isArrayOf(holder, new Proxy([], {})), true, "isArray of a proxy of an array");
        let revocable = Proxy.revocable([], {});
        revocable.revoke();
        check(errorThrownBy(isArrayOf, holder, revocable.proxy) instanceof (holder === Array ? TypeError : other.TypeError), true, "isArray of a revoked proxy");
    }
    check(isArrayOf({ isArray() { return "mine"; } }, []), "mine", "isArray of an object");
}

let oldArray = [];
let oldObjects = [{}];
let oldMap = new Map([["key", null], [1, null]]);
for (let round = 0; round < 4; ++round) {
    gc();
    for (let i = 0; i < 40; ++i) {
        check(pushes(oldArray, { round, i }), round * 40 + i + 1, "push of a new object onto an old array");
        pushesIgnoringResult(oldObjects, [i]);
        check(sets(oldMap, "key", { round, i }), oldMap, "set of a new object in an old map");
        setsIgnoringResult(oldMap, 1, [round, i]);
        if (!(i % 8)) {
            edenGC();
            check(oldArray[oldArray.length - 1].i, i, "a new object in an old array after a collection");
            check(oldObjects[oldObjects.length - 1][0], i, "a new array in an old array after a collection");
            check(oldMap.get("key").i, i, "a new object in an old map after a collection");
            check(oldMap.get(1)[1], i, "a new array in an old map after a collection");
        }
    }
}
check(oldArray.every((o, index) => o.round === Math.floor(index / 40) && o.i === index % 40), true, "an old array");

const big = 2n ** 70n;
const symbol = Symbol();
const object = {};
function keys(round) {
    return [
        ["text", "text"], [ropeOf("te", "xt"), "text"], ["context".substring(3), "text"], [ropeOf("long text that is a rope ", String(round)), "long text that is a rope " + round],
        ["中文", ropeOf("中", "文")], ["téxt", ropeOf("té", "xt")], ["", ropeOf("", "")],
        [1, 1], [1.5, 1.5], [-0, 0], [0, -0], [NaN, NaN], [2 ** 31, 2147483648], [-(2 ** 31), -2147483648], [1e300, 1e300], [round + 0.5 - 0.5, round],
        [big, 2n ** 70n], [7n, 7n], [symbol, symbol], [object, object], [undefined, undefined], [null, null], [true, true], [false, false],
    ];
}
for (let round = 0; round < 3; ++round) {
    for (let [makeMap, makeSet] of [[() => new Map(), () => new Set()], [() => new other.Map(), () => new other.Set()]]) {
        let map = makeMap(), set = makeSet(), size = 0;
        for (let [key, same] of keys(round)) {
            let isNew = !map.has(same);
            check(has(map, key), !isNew, "has of a map before set");
            check(gets(map, key), isNew ? undefined : map.get(same), "get before set");
            check(has(set, key), !isNew, "has of a set before add");
            check(sets(map, key, size), map, "set");
            check(adds(set, key), set, "add");
            size += isNew;
            check(map.size, size, "the size of a map");
            check(set.size, size, "the size of a set");
            check(has(map, same), true, "has of a map");
            check(has(set, same), true, "has of a set");
            check(gets(map, same), size - isNew, "get");
            check(getsInTailPosition(map, same), size - isNew, "get in tail position");
            check(setsInTailPosition(map, same, "again"), map, "set in tail position");
            check(addsInTailPosition(set, same), set, "add in tail position");
            setsIgnoringResult(map, key, size);
            addsIgnoringResult(set, key);
            check(gets(map, same), size, "get after another set");
            check(map.size, size, "the size of a map after setting the same key");
            check(set.size, size, "the size of a set after adding the same key");
        }
        check([...map.keys()].some(key => Object.is(key, -0)), false, "-0 as a key of a map becomes 0");
        check([...set].some(key => Object.is(key, -0)), false, "-0 as a key of a set becomes 0");
        check(sets(sets(map, "a", 1), ropeOf("b", "c"), 2).get("bc"), 2, "a chain of set");
        check(adds(adds(set, 1.25), ropeOf("b", "c")).has("bc"), true, "a chain of add");
        for (let i = 0; i < 200; ++i) {
            check(sets(map, "key" + i, i), map, "set of a new rope");
            check(adds(set, i + 0.5), set, "add of a new double");
        }
        for (let i = 0; i < 200; ++i) {
            check(gets(map, "key" + i), i, "get of a rope");
            check(has(set, i + 0.5), true, "has of a double");
            check(has(set, i + 0.125), false, "has of a double that is absent");
            check(gets(map, "nokey" + i), undefined, "get of a rope that is absent");
        }
    }
    class Table extends Map { get(key) { return "got " + super.get(key); } set(key, value) { super.set(key, value); return "set"; } has(key) { return "has " + super.has(key); } }
    class Bag extends Set { add(key) { super.add(key); return "added"; } has(key) { return "has " + super.has(key); } }
    class PlainTable extends Map { }
    class PlainBag extends Set { }
    check(sets(new Table(), 1.5, 2), "set", "set of a subclass");
    check(gets(new Table([[1.5, 2]]), 1.5), "got 2", "get of a subclass");
    check(has(new Table(), 1.5), "has false", "has of a subclass of Map");
    check(adds(new Bag(), 1.5), "added", "add of a subclass");
    check(has(new Bag([1.5]), 1.5), "has true", "has of a subclass of Set");
    let plainTable = new PlainTable(), plainBag = new PlainBag();
    check(sets(plainTable, ropeOf("a", "b"), 1), plainTable, "set inherited by a subclass");
    check(gets(plainTable, "ab"), 1, "get inherited by a subclass");
    check(adds(plainBag, ropeOf("a", "b")), plainBag, "add inherited by a subclass");
    check(has(plainBag, "ab"), true, "has inherited by a subclass");
    check(gets({ get(key) { return "mine " + key; } }, 1), "mine 1", "get of an object");
    check(gets(new WeakMap([[object, 1]]), object), 1, "get of a WeakMap");
    check(has(new WeakSet([object]), object), true, "has of a WeakSet");
    check(errorThrownBy(gets, { get: Map.prototype.get }, 1) instanceof TypeError, true, "Map.prototype.get on an object");
    let swapped = new Map([[1.5, "map"]]);
    swapped.get = Set.prototype.has;
    check(errorThrownBy(gets, swapped, 1.5) instanceof TypeError, true, "Set.prototype.has as the get of a map");
}
console.log("passed");
