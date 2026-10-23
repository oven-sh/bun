function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
// What `f` returns is read: a text that nobody reads need not be made, however long it would be.
function throws(f, constructor, what) {
    let result;
    try {
        result = f();
    } catch (error) {
        if (!(error instanceof constructor))
            throw new Error(what + ": threw " + String(error));
        return;
    }
    throw new Error(what + ": did not throw, " + String(result).length + " characters");
}

function add(a, b) { return a + b; }
function subtract(a, b) { return a - b; }
function addIntegers(a, b) { return (a | 0) + (b | 0); }
function addToInteger(a, b) { return a + (b | 0); }
let text = "";
function append(piece) { text += piece; }

function codes(s) {
    let result = [];
    for (let i = 0; i < s.length; ++i)
        result.push(s.charCodeAt(i));
    return result.join();
}

const narrow = ["a", "bc", "item 123", "\xe9\xff", "x".repeat(40)];
const wide = ["中", "文字", "aĀ", "😀", "Ж".repeat(40)];
for (let round = 0; round < 300; ++round) {
    for (let left of [...narrow, ...wide]) {
        for (let right of [...narrow, ...wide]) {
            let joined = add(left, right);
            check(typeof joined, "string", "the kind of a join");
            check(joined.length, left.length + right.length, "the length of a join");
            check(codes(joined), codes(left) + "," + codes(right), "the characters of a join");
        }
    }
}

for (let s of [...narrow, ...wide]) {
    check(add("", s), s, "nothing and a string");
    check(add(s, ""), s, "a string and nothing");
    let rope = add(s, s);
    check(add("", rope).length, 2 * s.length, "nothing and a rope");
    check(add(rope, ""), s + s, "a rope and nothing");
}
check(add("", ""), "", "nothing and nothing");

for (let round = 0; round < 200; ++round) {
    let pieces = [], fromLeft = "", fromRight = "";
    for (let i = 0; i < 60; ++i) {
        let piece = i % 7 ? "p" + round + "." + i : "中" + i;
        pieces.push(piece);
        fromLeft = add(fromLeft, piece);
        fromRight = add(piece, fromRight);
    }
    let both = add(fromLeft, fromRight);
    check(both.length, fromLeft.length + fromRight.length, "the length of two ropes joined");
    check(fromLeft, pieces.join(""), "a rope grown at its end");
    check(fromRight, pieces.reverse().join(""), "a rope grown at its start");
    check(both, fromLeft + fromRight, "two ropes joined");
}

{
    let long = "0123456789".repeat(20);
    let part = long.substring(15, 150);
    check(add(part, "!"), long.slice(15, 150) + "!", "a substring and a string");
    check(add("!", part), "!" + long.slice(15, 150), "a string and a substring");
    check(add(part, part).length, 270, "two substrings");
}

text = "";
let expected = [];
for (let i = 0; i < 20000; ++i) {
    let piece = i % 11 ? "<td>" : "cell " + i;
    append(piece);
    expected.push(piece);
}
check(text.length, expected.join("").length, "the length of a text built piece by piece");
check(text, expected.join(""), "a text built piece by piece");

check(add(1, 2), 3, "integers");
check(add(2147483647, 1), 2147483648, "integers whose sum is no int32");
check(add(-2147483648, -1), -2147483649, "integers whose sum is no int32");
check(add(1.5, 2), 3.5, "a double and an integer");
check(add(0.1, 0.2), 0.1 + 0.2, "doubles");
check(add(-0, -0), -0, "negative zeros");
check(add(NaN, 1), NaN, "not a number");
check(add("a", 1), "a1", "a string and an integer");
check(add(1, "a"), "1a", "an integer and a string");
check(add("a", 1.5), "a1.5", "a string and a double");
check(add("a", -0), "a0", "a string and negative zero");
check(add("a", null), "anull", "a string and null");
check(add(undefined, "a"), "undefineda", "undefined and a string");
check(add("a", true), "atrue", "a string and a boolean");
check(add(null, 1), 1, "null and an integer");
check(add(undefined, 1), NaN, "undefined and an integer");
check(add("a", 10n), "a10", "a string and a BigInt");
check(add(1n, 2n), 3n, "BigInts");
throws(() => add(1n, 2), TypeError, "a BigInt and a number");
throws(() => add("a", Symbol()), TypeError, "a string and a symbol");
throws(() => add(Symbol(), "a"), TypeError, "a symbol and a string");
check(add(new String("a"), "b"), "ab", "a String object and a string");
check(add("a", new String("b")), "ab", "a string and a String object");
check(add(new String("a"), new String("b")), "ab", "two String objects");
check(add("a", {}), "a[object Object]", "a string and an object");
check(add({}, "a"), "[object Object]a", "an object and a string");
check(add("a", [1, 2]), "a1,2", "a string and an array");
check(add([], []), "", "two arrays");
check(add("a", { toString() { return "t"; } }), "at", "an object with toString");
check(add("a", { valueOf() { return 7; }, toString() { return "t"; } }), "a7", "an object with valueOf");
check(add({ [Symbol.toPrimitive](hint) { return hint; } }, "!"), "default!", "an object with Symbol.toPrimitive");
throws(() => add("a", { toString() { throw new RangeError("thrown"); } }), RangeError, "an object whose toString throws");
{
    let order = [];
    let result = add({ toString() { order.push("left"); return "l"; } }, { toString() { order.push("right"); return "r"; } });
    check(result + ":" + order.join(), "lr:left,right", "the order of conversions");
}
check(subtract("5", "3"), 2, "strings subtracted");
check(addIntegers("5", "3"), 8, "strings made integers");
check(addToInteger("5", "3"), "53", "a string and an integer made of a string");

{
    let powers = ["x"];
    for (let i = 1; i <= 30; ++i)
        powers.push(add(powers[i - 1], powers[i - 1]));
    for (let i = 0; i <= 30; ++i)
        check(powers[i].length, 2 ** i, "a rope of a power of two");
    let allButOne = powers[0];
    for (let i = 1; i < 30; ++i)
        allButOne = add(allButOne, powers[i]);
    check(allButOne.length, 2 ** 30 - 1, "a rope one short of a power of two");
    let longest = add(powers[30], allButOne);
    check(longest.length, 2147483647, "a rope of the greatest length");
    check(add(allButOne, powers[30]).length, 2147483647, "a rope of the greatest length, the other way round");
    check(add(longest, "").length, 2147483647, "the longest rope and nothing");
    check(add("", longest).length, 2147483647, "nothing and the longest rope");
    throws(() => add(longest, "x"), RangeError, "one more than the greatest length");
    throws(() => add("x", longest), RangeError, "one more than the greatest length, the other way round");
    throws(() => add(powers[30], powers[30]), RangeError, "twice two to the thirtieth");
    throws(() => add(longest, longest), RangeError, "twice the greatest length");
}

console.log("passed");
