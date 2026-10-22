//@ runDefault("--useRegExpJIT=false", "--maxRegExpStackSize=16777216")

// The interpreter run of regexp-fixed-width-loop.js: the same cases with a 16MB pool and shorter
// inputs, so the interpreter stays fast. Before the fixed-width loop the searches gave up at about
// 175,000 iterations with this pool.

var BIG = 400000;

function shouldBe(actual, expected, message) {
    if (actual !== expected)
        throw new Error(message + ": bad value: " + actual + ", expected " + expected);
}

function shouldBeArray(actual, expected, message) {
    shouldBe(JSON.stringify(actual), JSON.stringify(expected), message);
}

// [pattern, input, expected [index, length, capture 1 indices]]
var longCases = [
    // The report: a group followed by $ on an input longer than the engine had room for.
    [/^(?:a)*$/, "a".repeat(BIG), [0, BIG]],
    [/(?:a)*$/, "a".repeat(BIG), [0, BIG]],
    [/(?:ab)*$/, "ab".repeat(BIG / 2), [0, BIG]],
    [/^(?:[0-9a-f]{2})+$/, "deadbeef".repeat(BIG / 8), [0, BIG]],
    [/^0x(?:[0-9a-f][0-9a-f])*$/i, "0x" + "0".repeat(BIG), [0, BIG + 2]],
    [/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, "aGVs".repeat(BIG / 4) + "bG8=", [0, BIG + 4]],
    // The group's capture is the last iteration.
    [/(a)*$/d, "a".repeat(BIG), [0, BIG, [BIG - 1, BIG]]],
    [/(ab)*$/d, "ab".repeat(BIG / 2), [0, BIG, [BIG - 2, BIG]]],
    // A bounded or lazy group, and one the search has to give iterations back from.
    [/(?:ab){2,}c/, "ab".repeat(BIG / 2) + "c", [0, BIG + 1]],
    [/(?:ab)*?c/, "ab".repeat(BIG / 2) + "c", [0, BIG + 1]],
    [/(?:ab)*abab$/, "ab".repeat(BIG / 2), [0, BIG]],
    [/(ab)*abab$/d, "ab".repeat(BIG / 2), [0, BIG, [BIG - 6, BIG - 4]]],
    [/^(?:ab)*$/, "ab".repeat(BIG / 2) + "a", null],
    // A body that is two code units wide, and a 16-bit subject.
    [/^(?:\u{1F600})+$/u, "\u{1F600}".repeat(BIG / 2), [0, BIG]],
    [/(?:ab)*\u4e2d/, "ab".repeat(BIG / 2) + "\u4e2d", [0, BIG + 1]],
];

for (var [re, input, expected] of longCases) {
    var m = re.exec(input);
    var actual = m && [m.index, m[0].length, ...(m.indices ? [m.indices[1]] : [])];
    shouldBeArray(actual, expected, re + " exec");
    // test() and search() run the match-only code.
    shouldBe(re.test(input), expected !== null, re + " test");
    shouldBe(input.search(re), expected === null ? -1 : expected[0], re + " search");
}

// Greedy groups give iterations back.
shouldBeArray(/(?:ab)*abc/.exec("ababababc"), ["ababababc"], "give back");
shouldBeArray(/(ab)*abc/.exec("ababababc"), ["ababababc", "ab"], "give back, capture");
shouldBeArray(/(ab)*abc/.exec("abc"), ["abc", null], "give back to zero iterations");
shouldBeArray(/(?:ab){2,3}c/.exec("ababababc"), ["abababc"], "bounded");
shouldBe(/(?:ab){2,}c/.exec("abc"), null, "below the minimum");
shouldBeArray(/(ab){2,4}/.exec("ababababababab"), ["abababab", "ab"], "bounded, capture");
shouldBe(/^(?:ab)*$/.test("abababa"), false, "no match");
shouldBeArray(/^((?:ab)*c)+ababc$/.exec("ababcababc"), ["ababcababc", "ababc"], "give back inside an outer group");

// Lazy groups take iterations on demand.
shouldBeArray(/(?:ab)*?c/.exec("ababc"), ["ababc"], "lazy");
shouldBeArray(/(ab)*?abc/.exec("ababc"), ["ababc", "ab"], "lazy, capture");
shouldBeArray(/(ab)*?$/.exec("abab"), ["abab", "ab"], "lazy to the end");
shouldBeArray(/(?:ab){2,3}?/.exec("abababab"), ["abab"], "lazy bounded");
shouldBe(/(ab)+?b/.exec("abab"), null, "lazy, no match");
shouldBeArray(/(ab)+?b/.exec("ababb"), ["ababb", "ab"], "lazy, one more iteration");
shouldBe(/(?:ab){2,}?c/.exec("abc"), null, "lazy below the minimum");
shouldBe(/(?:ab){1000,1001}?c/.test("ab".repeat(999) + "c"), false, "lazy below a large minimum");
shouldBe(/(?:ab){1000,1001}?c/.test("ab".repeat(1001) + "c"), true, "lazy at a large maximum");
shouldBe(/(?:ab){1000,1001}?c/.test("ab".repeat(1002) + "c"), true, "lazy past a large maximum, later start");

// The capture, a backreference, and the groups after it see the last iteration.
shouldBeArray(/(ab)*\1/.exec("ababab"), ["ababab", "ab"], "backreference");
shouldBeArray(/(ab)*\1c/.exec("ababc"), ["ababc", "ab"], "backreference after a give-back");
shouldBeArray(/(ab)*(ab)c/.exec("ababc"), ["ababc", "ab", "ab"], "group after");
shouldBeArray(/(ab)*(ab)?c/.exec("ababc"), ["ababc", "ab", null], "optional group after");
shouldBe(/(?<p>ab)*c/.exec("ababc").groups.p, "ab", "named group");
shouldBe(/^(?:(?<p>ab)*c|(?<p>cd)*e)$/.exec("cdcde").groups.p, "cd", "duplicate named group, second");
shouldBe(/^(?:(?<p>ab)*c|(?<p>cd)*e)$/.exec("ababc").groups.p, "ab", "duplicate named group, first");
shouldBe("ababababc".replace(/(ab)*c/, "[$1]"), "[ab]", "replace");
shouldBeArray(Array.from("ababc ababc".matchAll(/(ab)*c/g)).map(m => [m[0], m[1], m.index]), [["ababc", "ab", 0], ["ababc", "ab", 6]], "matchAll");
shouldBeArray("ab ab abab x".split(/(?:ab)+/), ["", " ", " ", " x"], "split");
shouldBeArray("ababxab".match(/(?:ab)*/g), ["abab", "", "ab", ""], "global with empty matches");
var sticky = /(?:ab)*c/y;
sticky.lastIndex = 1;
shouldBeArray(sticky.exec("xababc"), ["ababc"], "sticky");
sticky.lastIndex = 2;
shouldBe(sticky.exec("xababc"), null, "sticky at a wrong index");
sticky.lastIndex = 2;
shouldBe(sticky.test("xababc"), false, "sticky test at a wrong index");

// Assertions and wide characters in the body.
shouldBe(/^(?:a\B)*a$/.test("aaaa"), true, "\\B in the body");
shouldBeArray(/(?:\bab)*$/.exec("ab ab"), ["ab"], "\\b in the body");
shouldBeArray(/(?:\u{1F600}a)*$/u.exec("\u{1F600}a\u{1F600}a"), ["\u{1F600}a\u{1F600}a"], "astral character in the body");
shouldBeArray(/(?:[\u{1F600}\u{1F601}])+b/u.exec("\u{1F600}\u{1F601}b"), ["\u{1F600}\u{1F601}b"], "astral class in the body");
shouldBeArray(/(?:\u{1F600}){2,3}b/u.exec("\u{1F600}\u{1F600}\u{1F600}\u{1F600}b"), ["\u{1F600}\u{1F600}\u{1F600}b"], "bounded astral body");
shouldBeArray(/(?:AB)*c/i.exec("ababC"), ["ababC"], "case insensitive");
shouldBe(/(?:(?i:a)b)*c/.exec("AbabC"), null, "modifier in the body, no match");
shouldBeArray(/(?:(?i:a)b)*c/.exec("AbAbc"), ["AbAbc"], "modifier in the body");
shouldBeArray(/(?i:(?:ab)*c)d/.exec("ABABCd"), ["ABABCd"], "modifier around the group");

// Nested in other groups and assertions, and next to the other group shapes.
shouldBeArray(/((?:ab)*c)+$/.exec("ababcabcc"), ["ababcabcc", "c"], "inside a repeated capture");
shouldBeArray(/(?:x(?:ab)*)?y/.exec("xababy"), ["xababy"], "inside an optional group");
shouldBeArray(/(?=(?:ab)*c)ab/.exec("ababc"), ["ab"], "inside a lookahead");
shouldBeArray(/(?<=x(?:ab)*)c/.exec("xababc"), ["c"], "inside a lookbehind");
shouldBeArray(/^(?:abc(?:de)*f|abc(?:de)*g|abc(?:de)*dh)$/.exec("abcdededh"), ["abcdededh"], "in alternatives with a shared prefix");
shouldBeArray(/(a)*b|^x/.exec("aab"), ["aab", "a"], "next to a BOL alternative");
shouldBeArray(/(?:ab)*(?:ab)*c/.exec("ababc"), ["ababc"], "two in a row");
shouldBeArray(/(?:ab)+(?:ab)+c/.exec("ababc"), ["ababc"], "two in a row with minimums");
shouldBeArray(/^(?:\d{3}-)*\d{4}$/.exec("123-456-7890"), ["123-456-7890"], "fixed-count class in the body");
