(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }

    class Textual extends Map {
        has(key) { return super.has(key) ? "present" : ""; }
        get size() { return super.size ? "some" : ""; }
    }
    const plain = new Map([[1, 1]]);
    function tests(map, key) { if (map.has(key)) return "yes"; return "no"; }
    function negates(map, key) { return !map.has(key); }
    function testsBoth(map, key, other) { return map.has(key) && map.has(other) ? "yes" : "no"; }
    function testsInLoop(map, key) { let n = 0; while (map.has(key + n)) n++; return n; }
    function testsDeletion(map, key) { return map.delete(key) ? "yes" : "no"; }
    function testsPattern(pattern, text) { return pattern.test(text) ? "yes" : "no"; }
    function testsWeakSet(set, key) { return set.has(key) ? "yes" : "no"; }
    function keepsResult(map, key) { const result = map.has(key); return result ? result : "no"; }
    function comparesResult(map, key) { return map.has(key) === true; }
    function passesResult(map, key) { return String(map.has(key)); }
    function returning(value) { const map = new Map([[1, 1]]); map.has = () => value; map.delete = () => value; return map; }
    const truthy = [42, "text", { }, [], Symbol(), 1n, -1, Infinity, true], falsy = [0, -0, NaN, "", null, undefined, 0n, false];
    check(tests(plain, 1) + tests(plain, 2), "yesno", "a plain map in a condition");
    check(negates(plain, 1) + "," + negates(plain, 2), "false,true", "a plain map, negated");
    check(testsBoth(plain, 1, 1) + testsBoth(plain, 1, 2) + testsBoth(plain, 2, 1), "yesnono", "two conditions");
    check(testsInLoop(new Map([[1, 1], [2, 2], [3, 3]]), 1), 3, "the condition of a loop");
    check(testsDeletion(new Map([[1, 1]]), 1) + testsDeletion(new Map([[1, 1]]), 2), "yesno", "delete in a condition");
    for (let value of truthy) {
        check(tests(returning(value), 1), "yes", "an own has that returns something truthy");
        check(negates(returning(value), 1), false, "an own has that returns something truthy, negated");
        check(testsBoth(returning(value), 1, 2), "yes", "an own has that returns something truthy, twice");
        check(testsDeletion(returning(value), 1), "yes", "an own delete that returns something truthy");
        check(keepsResult(returning(value), 1), value, "the result itself");
        check(comparesResult(returning(value), 1), value === true, "the result compared with true");
    }
    for (let value of falsy) {
        check(tests(returning(value), 1), "no", "an own has that returns something falsy");
        check(negates(returning(value), 1), true, "an own has that returns something falsy, negated");
        check(testsBoth(returning(value), 1, 2), "no", "an own has that returns something falsy, twice");
        check(testsDeletion(returning(value), 1), "no", "an own delete that returns something falsy");
        check(keepsResult(returning(value), 1), "no", "a falsy result");
        check(comparesResult(returning(value), 1), false, "a falsy result compared with true");
    }
    const masquerader = makeMasquerader();
    check(tests(returning(masquerader), 1), "no", "an own has that returns an object that masquerades as undefined");
    check(passesResult(returning(7), 1) + passesResult(plain, 1), "7true", "the result as an argument");
    function countsCalls(limit) { const map = new Map(); map.calls = 0; map.has = function () { return ++this.calls < limit; }; return map; }
    const counting = countsCalls(3);
    check(testsInLoop(counting, 0), 2, "an own has is called each time");
    check(counting.calls, 3, "and no more often");
    {
        const pattern = /a/;
        pattern.test = () => "";
        check(testsPattern(/a/, "a") + testsPattern(/a/, "b") + testsPattern(pattern, "a"), "yesnono", "RegExp.prototype.test in a condition");
        const set = new WeakSet(), key = { };
        set.add(key);
        const other = new WeakSet();
        other.has = () => 1;
        check(testsWeakSet(set, key) + testsWeakSet(set, { }) + testsWeakSet(other, 5), "yesnoyes", "WeakSet.prototype.has in a condition");
    }
    function testsIncludes(list, value) { return list.includes(value) ? "yes" : "no"; }
    function testsSome(list, limit) { return list.some(value => value > limit) ? "yes" : "no"; }
    function testsEvery(list, limit) { if (!list.every(value => value > limit)) return "no"; return "yes"; }
    function listReturning(value) { const list = [1, 2, 3]; list.includes = () => value; list.some = () => value; list.every = () => value; return list; }
    check(testsIncludes([1, 2, 3], 2) + testsIncludes([1, 2, 3], 4) + testsIncludes([1, , 3], undefined) + testsIncludes([NaN], NaN), "yesnoyesyes", "Array.prototype.includes in a condition");
    check(testsSome([1, 2, 3], 2) + testsSome([1, 2, 3], 3) + testsSome([], 0), "yesnono", "Array.prototype.some in a condition");
    check(testsEvery([1, 2, 3], 0) + testsEvery([1, 2, 3], 1) + testsEvery([], 0), "yesnoyes", "Array.prototype.every in a condition");
    for (let value of truthy)
        check(testsIncludes(listReturning(value), 9) + testsSome(listReturning(value), 9) + testsEvery(listReturning(value), 9), "yesyesyes", "own methods of an array that return something truthy");
    for (let value of falsy)
        check(testsIncludes(listReturning(value), 1) + testsSome(listReturning(value), 0) + testsEvery(listReturning(value), 0), "nonono", "own methods of an array that return something falsy");

    function testsAnything(collection, key) { return collection.has(key) ? "yes" : "no"; }
    function returnsSizeOfAnything(collection) { return collection.size; }
    check(testsAnything(plain, 1) + testsAnything(new Set([1]), 2) + testsAnything({ has() { return "x"; } }, 1), "yesnoyes", "a receiver of any kind");
    check(testsAnything(new Textual([[1, 1]]), 1) + testsAnything(new Textual([[1, 1]]), 2), "yesno", "a subclass that returns strings");
    check(returnsSizeOfAnything(new Textual([[1, 1]])) + returnsSizeOfAnything(new Textual()), "some", "a subclass with its own size");
})();
console.log("passed");
