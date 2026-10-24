function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function described(iterable) {
    let s = "";
    for (const c of iterable) {
        s += c.length;
        for (let i = 0; i < c.length; i++)
            s += ":" + c.charCodeAt(i).toString(16);
        s += ";";
    }
    return s;
}
function firstOf(iterable) {
    for (const c of iterable)
        return c;
    return "nothing";
}
function firstTwo(iterable) {
    const [first, second] = iterable;
    return String(first) + " " + String(second);
}

for (let round = 0; round < 100; round++) {
    check(described("abc"), "1:61;1:62;1:63;", "ASCII");
    check(described("éÿ\u0000"), "1:e9;1:ff;1:0;", "Latin-1");
    check(described(""), "", "the empty string");
}
check(described("aĀb"), "1:61;1:100;1:62;", "a character past Latin-1");
check(described("a\u{1f600}b"), "1:61;2:d83d:de00;1:62;", "a surrogate pair");
check(described("\ud83d"), "1:d83d;", "a lone lead surrogate");
check(described("\ude00\ud83d"), "1:de00;1:d83d;", "surrogates in the wrong order");
check(described("\ud83dx"), "1:d83d;1:78;", "a lead surrogate before something else");
check(described("\u{1f600}\u{1f601}"), "2:d83d:de00;2:d83d:de01;", "two pairs");

{
    let text = "left";
    const rope = text + String(Math.max(1, 2)) + "right-hand side that is long enough";
    check(described(rope).length, rope.length * 5, "a rope");
    check(described(rope).length, rope.length * 5, "a rope that was flattened");
    const part = "a long string of which a part is taken".substring(7, 13);
    check(described(part), "1:73;1:74;1:72;1:69;1:6e;1:67;", "a substring");
}
{
    const iterator = "abcde"[Symbol.iterator]();
    check(firstOf(iterator), "a", "a loop that is left early");
    check(iterator.next().value, "b", "a call of next afterwards");
    check(firstTwo(iterator), "c d", "a pattern on the same iterator");
    check(described(iterator), "1:65;", "the rest");
    check(described(iterator), "", "an iterator that reached the end");
    check(iterator.next().done, true, "an iterator that reached the end, asked directly");
    const direct = "ab"[Symbol.iterator]();
    while (!direct.next().done);
    check(described(direct), "", "an iterator that was exhausted by calls of next");
    check(firstTwo("x"), "x undefined", "a pattern longer than the string");
    check(described(new String("ab")), "1:61;1:62;", "a String object");
    check(firstOf("abc") === "a" && firstOf("abc") === firstOf("a"), true, "the character is an ordinary string");
    const own = "ab"[Symbol.iterator]();
    own.next = function () { return { done: true }; };
    check(described(own), "", "an iterator with its own next");
}
console.log("passed");
