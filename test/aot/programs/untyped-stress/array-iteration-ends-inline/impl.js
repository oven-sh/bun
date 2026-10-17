function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
(function () {
    function joined(a) {
        let s = "";
        for (const x of a)
            s += String(x) + ";";
        return s;
    }
    function indexedOnly(a) {
        let s = "";
        for (let i = 0; i < a.length; i++)
            s += String(a[i]) + ";";
        return s;
    }
    function grown(a, limit) {
        let s = "";
        for (const x of a) {
            s += x + ";";
            if (a.length < limit)
                a.push(x + 1);
        }
        return s;
    }
    function truncated(a, length) {
        let s = "";
        for (const x of a) {
            s += x + ";";
            a.length = length;
        }
        return s;
    }
    function emptiedAndRefilled(a) {
        let s = "";
        for (const x of a) {
            s += x + ";";
            if (x === 1) {
                a.length = 0;
                a.push("a", "b", "c");
            }
        }
        return s;
    }
    function afterTheEnd(a) {
        const [first, second = (a.push("late"), "default"), third] = a;
        return first + " " + second + " " + third + " " + a.length;
    }
    function pairs(a) {
        let s = "";
        for (const x of a) {
            for (const y of a)
                s += x + y + ";";
        }
        return s;
    }
    function untilTwo(a) {
        let count = 0;
        for (const x of a) {
            if (x === 2)
                return count;
            count++;
        }
        return -1;
    }
    function turnedIntoDoubles(a) {
        let s = "";
        for (const x of a) {
            s += x + ";";
            a[a.length - 1] = 0.5;
        }
        return s;
    }

    check(joined([]), "", "an empty array");
    check(joined([1]), "1;", "one element");
    check(joined([1, 2, 3]), "1;2;3;", "integers");
    check(joined(["a", {}, null]), "a;[object Object];null;", "anything");
    check(joined([1.5, 2.5]), "1.5;2.5;", "doubles");
    check(joined([1, , 3]), "1;undefined;3;", "a hole");
    check(joined([, ]), "undefined;", "only a hole");
    check(joined(new Array(2)), "undefined;undefined;", "an array of holes");
    check(joined(Object.freeze([1, 2])), "1;2;", "a frozen array");
    const sparse = [1];
    sparse[100000] = 2;
    sparse.length = 2;
    check(joined(sparse), "1;undefined;", "an array that was sparse");
    check(grown([1], 4), "1;2;3;4;", "an array that grows while it is iterated over");
    check(grown([1], 1), "1;", "an array that does not grow");
    check(truncated([1, 2, 3], 1), "1;", "an array that is truncated");
    check(truncated([1, 2, 3], 0), "1;", "an array that is emptied");
    check(truncated([1, 2, 3], 2), "1;2;", "an array that loses its last element");
    check(emptiedAndRefilled([1, 2]), "1;b;c;", "an array that is emptied and refilled");
    check(afterTheEnd([1]), "1 default undefined 2", "an element added after the end was reached");
    check(afterTheEnd([]), "undefined default undefined 1", "an element added to an empty array after the end was reached");
    check(afterTheEnd([1, 2, 3]), "1 2 3 3", "a pattern as long as the array");
    check(pairs(["a", "b"]), "aa;ab;ba;bb;", "nested loops over one array");
    check(untilTwo([1, 2, 3]), 1, "a loop that is left early");
    check(untilTwo([1, 3]), -1, "a loop that is not left early");
    check(turnedIntoDoubles([1, 2, 3]), "1;2;0.5;", "integers that become doubles");
    check(joined("ab"), "a;b;", "a string");
    check(joined(new Set([1, 2])), "1;2;", "a set");
    check(joined([1, 2].values()), "1;2;", "an array iterator");
    check(joined({ *[Symbol.iterator]() { yield 7; } }), "7;", "a generator");
    check(indexedOnly([1, 2]), "1;2;", "an indexed loop");

    const doubles = [0.5, 1.5, 2.5, -0, Infinity];
    doubles[0] = 3.5;
    for (let round = 0; round < 100; round++)
        check(joined(doubles), "3.5;1.5;2.5;0;Infinity;", "doubles, many times");
    let negativeZero;
    for (const x of doubles) {
        if (x === 0)
            negativeZero = x;
    }
    check(negativeZero, -0, "negative zero among doubles");
    check(joined([0.5, , 2.5]), "0.5;undefined;2.5;", "a hole among doubles");
})();
console.log("passed");
