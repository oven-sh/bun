function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    function isFourWithTwoNulls(x) { return x === "ab\0\0"; }
    function isFiveWithTwoNulls(x) { return x === "abc\0\0"; }
    function isSixWithTwoNulls(x) { return x === "abcd\0\0"; }
    function isSevenWithTwoNulls(x) { return x === "abcde\0\0"; }
    function isEightWithTwoNulls(x) { return x === "abcdef\0\0"; }
    function isEightWithThreeNulls(x) { return "abcde\0\0\0" === x; }
    function isNotFourWithTwoNulls(x) { return x !== "ab\0\0"; }
    function isOrdinary(x) { return x === "abcdefgh"; }
    function which(x) {
        switch (x) {
        case "ab\0\0":
            return 1;
        case "abcdef\0\0":
            return 2;
        case "abcd":
            return 3;
        default:
            return 0;
        }
    }
    function join(a, b) { return a + b; }

    const all = [isFourWithTwoNulls, isFiveWithTwoNulls, isSixWithTwoNulls, isSevenWithTwoNulls, isEightWithTwoNulls, isEightWithThreeNulls, isOrdinary];
    const strings = ["ab\0\0", "abc\0\0", "abcd\0\0", "abcde\0\0", "abcdef\0\0", "abcde\0\0\0", "abcdefgh"];
    for (let i = 0; i < all.length; ++i) {
        for (let j = 0; j < strings.length; ++j) {
            const half = strings[j].length >> 1;
            check(all[i](strings[j]), i === j, all[i].name + " of literal " + j);
            check(all[i](join(strings[j].slice(0, half), strings[j].slice(half))), i === j, all[i].name + " of rope " + j);
        }
        check(all[i]("ab"), false, all[i].name + " of a prefix");
        check(all[i]("ab\0"), false, all[i].name + " of a prefix with one null");
        check(all[i]("ab\0\0\0\0\0\0\0"), false, all[i].name + " of a longer string");
        check(all[i](undefined), false, all[i].name + " of undefined");
        check(all[i](0x626100006261), false, all[i].name + " of a number");
    }
    check(isNotFourWithTwoNulls(join("ab", "\0\0")), false, "isNotFourWithTwoNulls of an equal string");
    check(isNotFourWithTwoNulls(join("ab", "\0\x01")), true, "isNotFourWithTwoNulls of another string");
    check(which(join("ab", "\0\0")), 1, "which of four");
    check(which(join("abcd", "ef\0\0")), 2, "which of eight");
    check(which(join("ab", "cd")), 3, "which without nulls");
    check(which(join("ab", "\0")), 0, "which of three");
})();
console.log("passed");
