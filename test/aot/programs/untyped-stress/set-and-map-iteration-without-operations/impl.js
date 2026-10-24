function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function joined(iterable) {
    let s = "";
    for (const x of iterable)
        s += String(x) + ";";
    return s;
}
function joinedPairs(iterable) {
    let s = "";
    for (const [key, value] of iterable)
        s += String(key) + "=" + String(value) + ";";
    return s;
}
function joinedWhile(iterable, during) {
    let s = "";
    for (const x of iterable) {
        s += String(x) + ";";
        during(x);
    }
    return s;
}
function firstOf(iterable) {
    for (const x of iterable)
        return x;
    return "nothing";
}
function firstTwo(iterable) {
    const [first, second] = iterable;
    return String(first) + " " + String(second);
}

function range(count) {
    const result = [];
    for (let i = 0; i < count; i++)
        result.push(i);
    return result;
}

{
    const set = new Set(range(100));
    const map = new Map(range(100).map(i => [i, "v" + i]));
    const expectedKeys = range(100).join(";") + ";";
    const expectedValues = range(100).map(i => "v" + i).join(";") + ";";
    for (let round = 0; round < 10; round++) {
        check(joined(set), expectedKeys, "a set");
        check(joined(set.values()), expectedKeys, "the values of a set");
        check(joined(set.keys()), expectedKeys, "the keys of a set");
        check(joined(map.keys()), expectedKeys, "the keys of a map");
        check(joined(map.values()), expectedValues, "the values of a map");
    }
    check(joinedPairs(map), range(100).map(i => i + "=v" + i).join(";") + ";", "a map");
    check(joinedPairs(set.entries()), range(100).map(i => i + "=" + i).join(";") + ";", "the entries of a set");
    check(joinedPairs(map.entries()), range(100).map(i => i + "=v" + i).join(";") + ";", "the entries of a map");
    const pairs = [];
    for (const pair of map)
        pairs.push(pair);
    check(pairs.length, 100, "the pairs of a map");
    check(Array.isArray(pairs[7]) && pairs[7].length === 2 && Object.getPrototypeOf(pairs[7]) === Array.prototype, true, "a pair is an array of two");
    check(pairs[7] !== pairs[8] && pairs[7][0] === 7 && pairs[7][1] === "v7", true, "each pair is its own array");
    pairs[7].push("more");
    check(pairs[7].join(), "7,v7,more", "a pair can grow");
    const shrinking = new Map(range(6).map(i => [i, i * 2]));
    let seen = "";
    for (const [key, value] of shrinking) {
        seen += key + "=" + value + ";";
        shrinking.delete(key + 1);
    }
    check(seen, "0=0;2=4;4=8;", "the next entry deleted while pairs are made");
}
{
    const object = {}, symbol = Symbol("s");
    const set = new Set([1, 1.5, "text", object, symbol, null, undefined, true, NaN, -0, 10n]);
    const seen = [];
    for (const x of set)
        seen.push(x);
    check(seen.length, 11, "a set of anything");
    check(seen[3], object, "an object in a set");
    check(seen[4], symbol, "a symbol in a set");
    check(seen[6], undefined, "undefined in a set");
    check(seen[8], NaN, "NaN in a set");
    check(seen[9], 0, "negative zero in a set");
    const map = new Map([["undefined", undefined], ["null", null], ["zero", 0]]);
    check(joined(map.values()), "undefined;null;0;", "values of a map that look like nothing");
}
{
    check(joined(new Set), "", "an empty set");
    check(joined(new Map().keys()), "", "the keys of an empty map");
    const set = new Set;
    const early = set.values();
    set.add("late");
    check(joined(early), "late;", "an iterator made while the set was empty");
    const emptied = new Set([1]);
    emptied.delete(1);
    check(joined(emptied), "", "a set that lost its only element");
}
{
    const set = new Set([0]);
    check(joinedWhile(set, x => { if (x < 40) set.add(x + 1); }), range(41).join(";") + ";", "a set that grows while it is iterated over");
    const map = new Map([[0, 0]]);
    check(joinedWhile(map.keys(), x => { if (x < 40) map.set(x + 1, 0); }), range(41).join(";") + ";", "a map that grows while it is iterated over");
}
{
    let set = new Set(range(6));
    check(joinedWhile(set, x => set.delete(x)), "0;1;2;3;4;5;", "each element deleted when it is seen");
    check(set.size, 0, "each element deleted when it is seen");
    set = new Set(range(6));
    check(joinedWhile(set, x => set.delete(x + 1)), "0;2;4;", "the next element deleted");
    set = new Set(range(6));
    check(joinedWhile(set, x => { if (x) set.delete(x - 1); }), "0;1;2;3;4;5;", "the previous element deleted");
    set = new Set(range(6));
    check(joinedWhile(set, x => { if (x === 2) { set.delete(0); set.add(0); } }), "0;1;2;3;4;5;0;", "an element deleted and added again");
    set = new Set(range(6));
    check(joinedWhile(set, x => { if (x === 2) set.clear(); }), "0;1;2;", "a set cleared while it is iterated over");
    set = new Set(range(6));
    check(joinedWhile(set, x => { if (x === 2) { set.clear(); set.add("a"); set.add("b"); } }), "0;1;2;a;b;", "a set cleared and refilled");
    set = new Set(range(200));
    check(joinedWhile(set, x => { if (x === 10) { for (let i = 0; i < 190; i++) set.delete(i); } }), range(11).join(";") + ";" + range(200).slice(190).join(";") + ";", "a set that shrinks while it is iterated over");
    const map = new Map(range(6).map(i => [i, i * 2]));
    check(joinedWhile(map.values(), x => map.delete(x / 2 + 1)), "0;4;8;", "the next entry of a map deleted");
}
{
    const set = new Set(range(100));
    const iterator = set.values();
    check(firstOf(iterator), 0, "a loop that is left early");
    check(firstOf(iterator), 1, "the same iterator afterwards");
    check(firstTwo(iterator), "2 3", "a pattern on the same iterator");
    check(joined(iterator), range(100).slice(4).join(";") + ";", "the rest");
    check(joined(iterator), "", "an iterator that reached the end");
    set.add("more");
    check(joined(iterator), "", "an iterator that reached the end, after an addition");
    check(firstOf(iterator), "nothing", "an iterator that reached the end, once more");
    check(iterator.next().done, true, "an iterator that reached the end, asked directly");

    const direct = set.values();
    while (!direct.next().done);
    check(joined(direct), "", "an iterator that was exhausted by calls of next");
    const mixed = set.values();
    check(mixed.next().value, 0, "a call of next");
    check(firstOf(mixed), 1, "a loop after a call of next");
    check(mixed.next().value, 2, "a call of next after a loop");
    check(firstTwo(new Set([1])), "1 undefined", "a pattern longer than the set");
    check(firstTwo(new Map([[1, 2]]).values()), "2 undefined", "a pattern longer than the map");
}
{
    class Sub extends Set { }
    check(joined(new Sub([1, 2])), "1;2;", "an instance of a subclass of Set");
    class Reversed extends Set {
        *[Symbol.iterator]() { yield* [...super.values()].reverse(); }
    }
    check(joined(new Reversed([1, 2])), "2;1;", "a subclass with its own iterator");
    const own = new Set([1, 2]).values();
    own.next = function () { return { done: true }; };
    check(joined(own), "", "an iterator with its own next");
}
console.log("passed");
