// @bun
// A path of a pattern that needs more input than a string can hold (String::MaxLength, 2^31 - 1 code units)
// can never match. It fails like any other path. The pattern is not a SyntaxError, at creation or at a match.

function shouldBe(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": expected " + expected + " but got " + actual);
}

// null, or the index, the match and the captures.
function show(values) {
    if (values === null)
        return "null";
    return values.map(value => value === undefined ? "undefined" : JSON.stringify(value)).join(",");
}

function exec(regExp, string) {
    const match = regExp.exec(string);
    return show(match && [match.index, ...match]);
}

const filler = "x".repeat(80);
const letters = "bcdefghijklmnopqr".split("");
// Nine alternatives with the same first character. The pattern build merges them under it.
const merged = letters.slice(0, 9).map(letter => "a" + letter).join("|");
// Seventeen alternatives with different first characters. The pattern build folds them into one group.
const folded = letters.map(letter => letter + "1").join("|");
const mergedCannotMatch = letters.slice(0, 9).map(letter => "a" + letter + "{4294967295}z").join("|");
const foldedCannotMatch = letters.map(letter => letter + "x{4294967295}y").join("|");
const foldedPairs = letters.map(letter => letter + "1|" + letter + "2x{4294967295}y").join("|");

// [source, flags, subject, expected]. expected is null, or the index, the match and the captures.
const rows = [
    // The byte compiler's sums pass UINT_MAX: the error came at the first match.
    ["(?:z)?x{4294967295}", "", "", null],
    ["(?:z)?x{4294967295}", "", "x", null],
    ["(?:z)?x{4294967295}", "", "zx", null],
    ["(?:zy)*a{4294967294,}", "", "", null],
    ["(?:zy)*a{4294967294,}", "", "zya", null],
    ["(?:z)?x{4294967295}|q", "", "q", [0, "q"]],
    ["(?:z)?x{4294967295}|q", "", "x", null],
    ["(?<=a{4294967295})b", "", "b", null],
    ["(?<=a{4294967295})b", "", "ab", null],
    ["(?<!a{4294967295})b", "", "b", [0, "b"]],
    ["(?<!a{4294967295})b", "", "ab", [1, "b"]],
    ["(?:q)?b{9007199254740991}", "", "", null],
    ["(?:q)?b{9007199254740991}", "", "qb", null],
    [filler + "(?:a|b{4294967215})c", "", filler + "ac", [0, filler + "ac"]],
    [filler + "(?:a|b{4294967215})c", "", filler + "bc", null],
    ["(?:(?:a{2147483647})*b{2147483647})*c{2147483647}", "", "", null],
    ["(?:(?:a{2147483647})*b{2147483647})*c{2147483647}", "", "c", null],
    ["(?:(?:a{2147483647})+b{2147483647})+c{2147483647}", "", "", null],
    ["(?:(?:a{2147483647})+b{2147483647})+c{2147483647}", "", "abc", null],
    ["(?:(?:(a{2147483647}))?b{2147483647})?c{2147483647}\\1", "", "", null],
    ["(?:(?:(a{2147483647}))?b{2147483647})?c{2147483647}\\1", "", "c", null],
    ["(?:a{2147483648}|)a{2147483648}|bc", "", "x", null],
    ["(?:a{2147483648}|)a{2147483648}|bc", "", "bc", [0, "bc"]],
    ["(?<!(?<=a{4294967295})b|c)d", "", "d", [0, "d"]],
    ["(?<!(?<=a{4294967295})b|c)d", "", "cd", null],
    ["(?<!(?<=a{4294967295})b|c)d", "", "bd", [1, "d"]],
    ["b(?<!a{4294967294}c)|(?:z)?x{4294967295}", "", "b", [0, "b"]],
    ["b(?<!a{4294967294}c)|(?:z)?x{4294967295}", "", "acb", [2, "b"]],
    ["b(?<!a{4294967294}c)|(?:z)?x{4294967295}", "", "zx", null],
    [merged + "|a(?:z)?x{4294967294}", "", "aj", [0, "aj"]],
    [merged + "|a(?:z)?x{4294967294}", "", "azx", null],

    // The pattern build's offsets pass UINT_MAX: the error came at creation.
    ["a{4294967295}b", "", "", null],
    ["a{4294967295}b", "", "ab", null],
    ["A{4294967295}X", "", "AAX", null],
    ["b{9007199254740991}c", "", "bc", null],
    ["(?:a{4294967295}b)?c", "", "c", [0, "c"]],
    ["(?:a{4294967295}b)?c", "", "abc", [2, "c"]],
    ["c|a{4294967295}b", "", "c", [0, "c"]],
    ["c|a{4294967295}b", "", "ab", null],
    ["\\b[^a][a-c]{4294967295,}?|aa*", "", "a", [0, "a"]],
    ["\\b[^a][a-c]{4294967295,}?|aa*", "", "baa", [1, "aa"]],
    ["a{2147483649,2147483650}a{2147483649,2147483650}", "", "aaaa", null],
    ["x{4294967295}(?:z)?|q", "", "q", [0, "q"]],
    ["x{4294967295}(?:z)?|q", "", "x", null],
    ["^(?:a{4294967295}b|c)$", "", "c", [0, "c"]],
    ["^(?:a{4294967295}b|c)$", "", "ab", null],
    ["^a{4294967295}b|^c|d", "m", "c", [0, "c"]],
    ["^a{4294967295}b|^c|d", "m", "ab\nd", [3, "d"]],
    ["^a{4294967295}b|c", "", "xc", [1, "c"]],
    ["^a{4294967295}b|^c", "", "xc", null],
    ["^a{4294967295}b|^c", "", "c", [0, "c"]],

    // A group that has to match, and cannot.
    ["x(?:a{4294967295})", "", "x", null],
    ["x(?:a{4294967295})", "", "xa", null],
    ["x{4294967295}(y)", "", "x", null],
    ["x{4294967295}(y)", "", "xy", null],
    ["(?:a{4294967295}(?:b|c)d)?e", "", "e", [0, "e"]],
    ["(?:a{4294967295}(?:b|c)d)?e", "", "abde", [3, "e"]],
    ["(?:(?:a{4294967295}b))?c", "", "c", [0, "c"]],
    ["(?:(?:a{4294967295}b)|d)c", "", "c", null],
    ["(?:(?:a{4294967295}b)|d)c", "", "dc", [0, "dc"]],
    ["(?:a{4294967295}b){2}|c", "", "c", [0, "c"]],
    ["(?:a{4294967295}b)+|c", "", "c", [0, "c"]],
    ["(?:a{4294967295}b)*c", "", "c", [0, "c"]],
    ["(?:a{4294967295}b)*?c", "", "c", [0, "c"]],

    // Captures and backreferences into an alternative that cannot match.
    ["(a{4294967295}b)?c\\1", "", "c", [0, "c", undefined]],
    ["(a{4294967295}b|c)\\1", "", "cc", [0, "cc", "c"]],
    ["(a{4294967295}b|c)\\1", "", "ab", null],
    ["(?:(x)a{4294967295}b|(y))\\1\\2", "", "yy", [0, "yy", undefined, "y"]],
    ["(?:(x)a{4294967295}b|(y))\\1\\2", "", "xab", null],
    ["\\1(a{4294967295}b)?c", "", "c", [0, "c", undefined]],
    ["(?<n>a)|(?<n>b{4294967295}c)", "", "a", [0, "a", "a", undefined]],
    ["(?<n>a)|(?<n>b{4294967295}c)", "", "bc", null],
    ["(?:(?<n>b{4294967295}c)|(?<n>a))\\k<n>", "", "aa", [0, "aa", undefined, "a"]],
    ["(?:(?<n>b{4294967295}c)|(?<n>a))\\k<n>", "", "bc", null],

    // Assertions.
    ["b(?=a{4294967295}c)", "", "b", null],
    ["b(?!a{4294967295}c)", "", "b", [0, "b"]],
    ["b(?<=a{4294967295}c)", "", "b", null],
    ["b(?<=a{4294967295}c)", "", "acb", null],
    ["b(?<!a{4294967295}c)", "", "b", [0, "b"]],
    ["b(?<!a{4294967295}c)", "", "acb", [2, "b"]],
    ["(?=a{4294967295}b|c)c", "", "c", [0, "c"]],
    ["(?!a{4294967295}b|c).", "", "c", null],
    ["(?!a{4294967295}b|c).", "", "d", [0, "d"]],
    ["(?<=a{4294967295}b|c)d", "", "cd", [1, "d"]],
    ["(?<=a{4294967295}b|c)d", "", "bd", null],
    ["(?<!a{4294967295}b|c)d", "", "cd", null],
    ["(?<!a{4294967295}b|c)d", "", "bd", [1, "d"]],
    ["(?<=(?:a{4294967295}b)?)c", "", "c", [0, "c"]],
    ["(?<!(?:a{4294967295}b))c", "", "c", [0, "c"]],
    ["(?<!(?:a{4294967295}b)|d)c", "", "c", [0, "c"]],
    ["(?<!(?:a{4294967295}b)|d)c", "", "dc", null],
    ["(?<=a{4294967295}b(?<=c))d", "", "d", null],
    ["(?<!(?=a{4294967295}b)c)d", "", "d", [0, "d"]],
    ["(?<!(?=a{4294967295}b)c)d", "", "cd", [1, "d"]],
    ["(?=a{4294967295}b|d)de", "", "de", [0, "de"]],
    ["(?=a{4294967295}b|d)de", "", "ae", null],
    ["(?!a{4294967295}b|d)[cd]e", "", "ce", [0, "ce"]],
    ["(?!a{4294967295}b|d)[cd]e", "", "de", null],
    ["(?<=a{4294967295}b|cc|d)e", "", "cce", [2, "e"]],
    ["(?<=a{4294967295}b|cc|d)e", "", "de", [1, "e"]],
    ["(?<=a{4294967295}b|cc|d)e", "", "ce", null],
    ["(?<!a{4294967295}b|cc|d)e", "", "xce", [2, "e"]],
    ["(?<!a{4294967295}b|cc|d)e", "", "cce", null],

    // Code points outside the BMP count as two code units with the u or v flag.
    ["\\u{10405}{2147483648}", "u", "\u{10405}", null],
    ["\\u{10405}{2147483648}|k", "u", "k", [0, "k"]],
    ["\\u{10234}{2147483647}\\u{10100}", "u", "\u{10234}\u{10100}", null],
    ["\\u{10234}{2147483647}\\u{10100}|k", "u", "k", [0, "k"]],
    ["[\\u{10405}\\u{10406}]{2147483648}|k", "u", "k", [0, "k"]],
    ["[\\u{10405}\\u{10406}]{2147483648}|k", "u", "\u{10405}", null],
    ["[\\u{10405}\\u{10406}]{2147483648}|k", "v", "k", [0, "k"]],
    ["[\\u{10405}\\u{10406}]{2147483648}|k", "v", "\u{10405}", null],
    ["(?:[\\u{10405}\\u{10406}]{2147483648}b)?\\u{10405}", "iu", "\u{10405}", [0, "\u{10405}"]],

    // Nine alternatives with the same first character are merged under it, and seventeen with different ones are folded into one group, before the offsets are set up.
    [merged + "|ax{4294967295}y", "", "aj", [0, "aj"]],
    [merged + "|ax{4294967295}y", "", "axy", null],
    ["ax{4294967295}y|" + merged, "", "zaj", [1, "aj"]],
    ["abx{4294967295}y|" + merged, "", "abxy", [0, "ab"]],
    [mergedCannotMatch + "|q", "", "abz", null],
    [mergedCannotMatch + "|q", "", "q", [0, "q"]],
    ["(?:" + merged + "|a(x)x{4294967295}y)\\1", "", "ab", [0, "ab", undefined]],
    ["(" + merged + "|ax{4294967295}y)\\1", "", "acac", [0, "acac", "ac"]],
    ["^(?:" + merged + "|ax{4294967295}y)$", "", "ad", [0, "ad"]],
    ["^(?:" + merged + "|ax{4294967295}y)$", "", "axy", null],
    [folded + "|zx{4294967295}y", "", "r1", [0, "r1"]],
    [folded + "|zx{4294967295}y", "", "zxy", null],
    ["zx{4294967295}y|" + folded, "", "b1", [0, "b1"]],
    [folded + "|z(x)x{4294967295}y", "", "c1", [0, "c1", undefined]],
    ["^x{4294967295}y|^k|" + folded, "", "zd1", [1, "d1"]],
    [foldedCannotMatch, "", "bxy", null],
    [foldedCannotMatch + "|q", "", "q", [0, "q"]],
    [foldedPairs, "", "r2xy", null],
    [foldedPairs, "", "r1", [0, "r1"]],
];

// Over 64 characters a RegExp is created without its YarrPattern (--useLazyRegExpPatternConstruction).
const longPrefix = "(?:" + "y".repeat(70) + ")?";

for (const [source, flags, subject, expected] of rows) {
    for (const text of [source, longPrefix + source]) {
        const what = "/" + text + "/" + flags + " on " + JSON.stringify(subject);
        const regExp = new RegExp(text, flags);
        shouldBe(exec(regExp, subject), show(expected), what);
        shouldBe(regExp.test(subject), expected !== null, what + ", test()");
        // The same text again: RegExpCache gives the RegExp that ran the matches above. An error that a match
        // left in that RegExp made this creation throw.
        const again = new RegExp(text, flags);
        shouldBe(again.test(subject), expected !== null, what + ", created again, test()");
        shouldBe(exec(again, subject), show(expected), what + ", created again");
        // The d flag gives another RegExp for the same pattern, one that has not run. Its first call is test().
        const unused = new RegExp(text, flags + "d");
        shouldBe(unused.test(subject), expected !== null, what + ", d flag, test() first");
        shouldBe(exec(unused, subject), show(expected), what + ", d flag");
    }
}

// One RegExp, first in JIT code and then in the interpreter. No alternative of these patterns needs more than
// String::MaxLength, so they get JIT code, which answers "ac". On "c" an iteration of the first group matches
// nothing: the JIT code gives the match to the interpreter, and the sums of the byte compiler pass UINT_MAX for
// the lookbehind. The same object then answered "ac" with a SyntaxError.
{
    const head = "(?:(a)|b*)+?c";
    const max = "2147483647";
    // [lookbehind, flags, expected for "ac", "c", "bc", "\u0100ac", "\u0100c"]
    const tails = [
        [`(?<!(?<=(?<=x{${max}})y{${max}})z{${max}})`, "", '0,"ac","a"', '0,"c",undefined', '0,"bc",undefined', '1,"ac","a"', '1,"c",undefined'],
        [`(?<=(?<=(?<=x{${max}})y{${max}})z{${max}}|ac)`, "", '0,"ac","a"', "null", "null", '1,"ac","a"', "null"],
        [`(?<=(?<=(?<!x{${max}})y{${max}})z{${max}}|(a)c)`, "", '0,"ac","a","a"', "null", "null", '1,"ac","a","a"', "null"],
        [`(?<!(?<=(?<!x{${max}})y{${max}})z{${max}}|bc)`, "", '0,"ac","a"', '0,"c",undefined', "null", '1,"ac","a"', '1,"c",undefined'],
        [`(?<=(?<=(?<=q|x{${max}})y{${max}})z{${max}}|ac)`, "", '0,"ac","a"', "null", "null", '1,"ac","a"', "null"],
        [`(?<!(?<=(?<=q|x{${max}})y{${max}})z{${max}}|bc)`, "i", '0,"ac","a"', '0,"c",undefined', "null", '1,"ac","a"', '1,"c",undefined'],
    ];
    for (const [tail, flags, ac, c, bc, wideAc, wideC] of tails) {
        const regExp = new RegExp(head + tail, flags);
        const what = "/" + regExp.source + "/" + flags;
        shouldBe(regExp.test("ac"), true, what + ", test(), JIT code");
        shouldBe(exec(regExp, "ac"), ac, what + ", JIT code");
        shouldBe(exec(regExp, "c"), c, what + ", interpreter");
        shouldBe(exec(regExp, "ac"), ac, what + ", after the interpreter ran");
        shouldBe(regExp.test("ac"), true, what + ", test(), after the interpreter ran");
        shouldBe(exec(regExp, "bc"), bc, what + ", interpreter again");
        shouldBe(exec(regExp, "\u0100ac"), wideAc, what + ", 16-bit");
        shouldBe(exec(regExp, "\u0100c"), wideC, what + ", 16-bit, interpreter");
        // RegExpCache gives the same RegExp for the same text. With the SyntaxError in it, this creation threw.
        shouldBe(exec(new RegExp(regExp.source, flags), "ac"), ac, what + ", created again");
    }
}

// An 8-bit subject, then a 16-bit one, and the other order.
{
    const first = new RegExp("(?:z)?x{4294967295}|q");
    shouldBe(first.test("q"), true, "8-bit");
    shouldBe(first.test("\u0100q"), true, "16-bit after 8-bit");
    shouldBe(first.test("\u0100x"), false, "16-bit after 8-bit, no match");
    const second = new RegExp("(?<!a{4294967295})b|(?:w)?x{4294967295}");
    shouldBe(exec(second, "\u0100ab"), '2,"b"', "16-bit");
    shouldBe(exec(second, "ab"), '1,"b"', "8-bit after 16-bit");
}

// Sticky, from a lastIndex past the start.
{
    const sums = new RegExp("(?:z)?x{4294967295}|(?<!a{4294967295})c", "y");
    sums.lastIndex = 2;
    shouldBe(exec(sums, "zxc"), '2,"c"', "sticky from 2");
    shouldBe(sums.lastIndex, 3, "sticky, lastIndex after a match");
    sums.lastIndex = 1;
    shouldBe(sums.test("zxc"), false, "sticky from 1");
    shouldBe(sums.lastIndex, 0, "sticky, lastIndex after no match");
    const offsets = new RegExp("a{4294967295}b|c", "y");
    offsets.lastIndex = 1;
    shouldBe(exec(offsets, "xc"), '1,"c"', "sticky from 1");
    offsets.lastIndex = 0;
    shouldBe(offsets.test("xc"), false, "sticky from 0");
}

shouldBe("abc".replace(/(?:z)?x{4294967295}/, "y"), "abc", "replace");
shouldBe("abc".split(/(?:z)?x{4294967295}/).length, 1, "split");
shouldBe("abc".search(/(?:z)?x{4294967295}/), -1, "search");
shouldBe("abc".search(/(?<!a{4294967295})c/), 2, "search with a lookbehind");
shouldBe("abc".replace(/a{4294967295}b|b/g, "y"), "ayc", "replace, g");
shouldBe("abc".split(/a{4294967295}b|b/).join(), "a,c", "split at the other alternative");
shouldBe("abc".match(/x{4294967295}(y)/), null, "match");
shouldBe([..."abcb".matchAll(/a{4294967295}c|b/g)].length, 2, "matchAll");

function errorOf(run) {
    try {
        run();
    } catch (error) {
        return String(error);
    }
    return "no error";
}

function testNoInline(regExp, string) {
    return regExp.test(string);
}
noInline(testNoInline);

// What a first match still refuses, and every match after it: an error that only the pattern build reports, for
// a pattern over 64 characters. It is that error at creation or at each use, never a result.
{
    const refused = "SyntaxError: Invalid regular expression: negated class set may contain strings";
    let regExp = null;
    const atCreation = errorOf(() => { regExp = new RegExp("abc[^\\q{}](?:" + "y".repeat(70) + ")?", "v"); });
    if (!regExp)
        shouldBe(atCreation, refused, "refused at creation");
    else {
        for (let i = 0; i < 100; ++i)
            shouldBe(errorOf(() => testNoInline(regExp, "x")), refused, "refused, test()");
        shouldBe(errorOf(() => regExp.exec("abcd")), refused, "refused, exec()");
        shouldBe(errorOf(() => "x".replace(regExp, "y")), refused, "refused, replace");
    }
}

function testLiteral(string) {
    return /(?:z)?x{4294967295}|q/.test(string);
}
noInline(testLiteral);

function execLiteral(string) {
    return /(?<!a{4294967295})b|(?:w)?(x{4294967295})/.exec(string);
}
noInline(execLiteral);

function testCreated(source, string) {
    return new RegExp(source).test(string);
}
noInline(testCreated);

const createdSources = [];
const createdSubjects = [];
for (let i = 0; i < 8; ++i) {
    createdSources.push("(?:c" + i + ")?a{4294967295}|d" + i);
    createdSubjects.push(i & 1 ? "d" + i : "c" + i + "a");
}

// The DFG and the FTL give the result of a constant RegExp on a constant string at compile time, and answer
// test() and exec() from the first character for a sticky RegExp and for one whose alternatives all start
// with ^ (Yarr::computeFirstCharacterBitmap).
function execFolded() {
    return /c|a{4294967295}b/.exec("c");
}
noInline(execFolded);

function replaceFolded() {
    return "abcb".replace(/a{4294967295}c|(b)/g, "[$1]");
}
noInline(replaceFolded);

function testAnchored(string) {
    return /^(?:a{4294967295}b|c)d/.test(string);
}
noInline(testAnchored);

function testSticky(string, lastIndex) {
    const regExp = /(a{4294967295}b)|(c)d/y;
    regExp.lastIndex = lastIndex;
    const match = regExp.exec(string);
    return match ? match.index + "," + match[1] + "," + match[2] + "," + regExp.lastIndex : "null," + regExp.lastIndex;
}
noInline(testSticky);

for (let i = 0; i < testLoopCount; ++i) {
    shouldBe(testLiteral("zx"), false, "literal, no match");
    shouldBe(testLiteral("aq"), true, "literal");
    const match = execLiteral("ab");
    shouldBe(match.index, 1, "literal, exec(), index");
    shouldBe(match[1], undefined, "literal, exec(), capture");
    shouldBe(execLiteral("wx"), null, "literal, exec(), no match");
    shouldBe(testCreated(createdSources[i & 7], createdSubjects[i & 7]), !!(i & 1), "created in a loop");
    shouldBe(execFolded().index, 0, "constant string, exec()");
    shouldBe(replaceFolded(), "a[b]c[b]", "constant string, replace");
    shouldBe(testAnchored("cd"), true, "anchored");
    shouldBe(testAnchored(i & 1 ? "ab" : "xcd"), false, "anchored, no match");
    shouldBe(testSticky("xcd", 1), "1,undefined,c,3", "sticky literal");
    shouldBe(testSticky(i & 1 ? "xab" : "xcd", i & 1), "null,0", "sticky literal, no match");
}

// Last in the file: compile() makes the DFG and the FTL stop treating a RegExp of this realm as a constant.
{
    const regExp = /abc/;
    regExp.compile("(?:z)?x{4294967295}|q");
    shouldBe(regExp.source, "(?:z)?x{4294967295}|q", "compile(), source");
    shouldBe(regExp.test("q"), true, "compile(), test()");
    regExp.compile("c|a{4294967295}b", "g");
    shouldBe(regExp.test("c"), true, "compile() again, test()");
    shouldBe(regExp.test("ab"), false, "compile() again, no match");
}
