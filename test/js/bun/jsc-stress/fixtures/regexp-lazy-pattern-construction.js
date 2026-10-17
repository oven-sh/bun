// @bun
// Patterns longer than RegExp's eager-construction threshold are only syntax-checked and
// capture-counted at creation; the YarrPattern is first built when the RegExp is compiled.

function shouldBe(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": expected " + expected + " but got " + actual);
}

function shouldThrowSyntaxError(source, flags, message) {
    let error = null;
    try {
        new RegExp(source, flags);
    } catch (e) {
        error = e;
    }
    if (!(error instanceof SyntaxError))
        throw new Error("expected SyntaxError at construction for /" + source.slice(0, 40) + "/" + flags);
    if (message !== undefined)
        shouldBe(error.message, "Invalid regular expression: " + message, "message for /" + source.slice(0, 40) + "/" + flags);
}

let filler = "x".repeat(80);

// Capture count comes from the syntax-only pass and must agree with the later compile.
{
    let re = new RegExp("(a)(?:b)(c)(" + filler + ")?|(d)");
    let m = re.exec("abc");
    shouldBe(m.length, 5, "captures");
    shouldBe(m[1], "a", "m[1]");
    shouldBe(m[2], "c", "m[2]");
    shouldBe(m[3], undefined, "m[3]");
    shouldBe("zzd".replace(re, "[$4]"), "zz[d]", "replace $4");
}

// Named groups still take the full construction path.
{
    let re = new RegExp("(?<year>\\d{4})-(?<month>\\d{2})" + "(?:" + filler + ")?", "u");
    let m = re.exec("2026-09");
    shouldBe(m.groups.year, "2026", "year");
    shouldBe(m.groups.month, "09", "month");
    let dup = new RegExp("(?<n>a)" + filler + "|(?<n>b)");
    shouldBe(dup.exec("b").groups.n, "b", "duplicate named group");
}

// A long literal pattern: atom fast paths kick in once compiled; results must not change.
{
    let literal = "abcdefghij".repeat(8);
    let re = new RegExp(literal, "g");
    let subject = "--" + literal + "--" + literal;
    shouldBe(subject.replace(re, "R"), "--R--R", "replace literal");
    shouldBe(subject.split(new RegExp(literal)).length, 3, "split literal");
    shouldBe((subject.match(re) || []).length, 2, "match literal");
}

// Parser-detected errors are still thrown at construction.
shouldThrowSyntaxError("(" + filler, "");
shouldThrowSyntaxError(filler + "\\2(a)", "u");
shouldThrowSyntaxError(filler + "[b-a]", "");
shouldThrowSyntaxError(filler + "\\k<nope>(?<yes>a)", "u");
shouldThrowSyntaxError("[^\\q{ab}]" + filler, "v");
shouldThrowSyntaxError(filler + "a{2,1}", "");

// A negated class set that may contain strings is one of them, whatever makes the string.
{
    let negated = "negated class set may contain strings";
    shouldThrowSyntaxError("[^\\q{}]" + filler, "v", negated);
    shouldThrowSyntaxError("[^\\q{a|}]" + filler, "v", negated);
    shouldThrowSyntaxError(filler + "[^[\\q{}]]", "v", negated);
    shouldThrowSyntaxError("[^\\p{RGI_Emoji}&&\\p{RGI_Emoji}]" + filler, "v", negated);
}

// So are the errors that only building the YarrPattern finds. YarrPatternConstructor::setupOffsets refuses input
// positions that do not fit in 32 bits, and a pattern whose quantifier counts can get there is built eagerly.
{
    let tooLong = "pattern exceeds string length limits";
    // Twice: the second creation must not depend on what the first one left in the RegExp cache.
    for (let i = 0; i < 2; ++i) {
        shouldThrowSyntaxError(filler + "y{4294967295}", "", tooLong);
        shouldThrowSyntaxError(filler + "y{4294967296}", "", tooLong);
        shouldThrowSyntaxError("a{2147483647}".repeat(3) + filler, "", tooLong);
        shouldThrowSyntaxError(filler + "[y]{4294967295}", "", tooLong);
        shouldThrowSyntaxError(filler + "(y{4294967295})?", "", tooLong);
        shouldThrowSyntaxError(filler + "y{4294967294,4294967295}", "", tooLong);
        shouldThrowSyntaxError(filler + "\\u{1F600}{2147483648}", "u", tooLong);
    }

    // The same counts where the YarrPattern can be built.
    shouldBe(new RegExp(filler + "(?:y){4294967295}").test(filler + "y"), false, "huge count on a group");
    shouldBe(new RegExp(filler + "y{0,4294967295}").test(filler), true, "huge maximum, no minimum");
    shouldBe(new RegExp(filler + "y{16777216}").test(filler + "y"), false, "large count that fits");
    shouldBe(new RegExp(filler + "y{3}z{2,}").test(filler + "yyyzz"), true, "small counts");

    // setupOffsets numbers the body of a group from what is before the group. The byte compiler also counts what
    // follows it, and reports its own limit at the first match, with the option on or off.
    shouldBe(new RegExp(filler + "(?:a|b{4294967215})").test(filler), false, "alternative at the limit");
    let followed = new RegExp(filler + "(?:a|b{4294967215})c");
    let error = null;
    try {
        followed.test(filler);
    } catch (e) {
        error = e;
    }
    shouldBe(String(error), "SyntaxError: Invalid regular expression: " + tooLong, "alternative at the limit, then one more character");
    shouldThrowSyntaxError(filler + "(?:a|b{4294967216})", "", tooLong);
}

// RegExp.prototype.compile() refuses such a pattern as well, and leaves the RegExp as it was.
{
    let re = /keep/g;
    re.lastIndex = 2;
    let threw = false;
    try {
        re.compile(filler + "y{4294967295}");
    } catch (e) {
        threw = e instanceof SyntaxError;
    }
    shouldBe(threw, true, "compile() with a pattern that construction refuses");
    shouldBe(re.source, "keep", "source after the refused compile()");
    shouldBe(re.lastIndex, 2, "lastIndex after the refused compile()");
}

// A literal of such a pattern throws when it is evaluated, not at its first match.
{
    let makeLiteral = new Function("return /" + filler + "y{4294967295}/;");
    let threw = false;
    try {
        makeLiteral();
    } catch (e) {
        threw = e instanceof SyntaxError;
    }
    shouldBe(threw, true, "evaluating a literal that construction refuses");
}

// Back references are validated against the counted captures (non-unicode: octal escape fallback).
shouldBe(new RegExp("(a)" + filler.slice(2) + "|\\1b").test("b"), true, "backreference to an unmatched group matches empty");
shouldBe(new RegExp(filler + "\\8").test(filler + "8"), true, "\\8 without captures is a literal");

// lastIndex / sticky / multiline behave the same on the lazy path.
{
    let re = new RegExp("^(" + filler.slice(0, 70) + ")$", "gm");
    let subject = filler.slice(0, 70) + String.fromCharCode(10) + filler.slice(0, 70);
    shouldBe((subject.match(re) || []).length, 2, "multiline");
}

// Lookbehind captures, modifier groups and non-capturing groups are counted like YarrPatternConstructor does.
{
    let re = new RegExp("(?<=(a)b)(?i:c)(?:d)(e)" + "(?:" + filler + ")?", "d");
    let m = re.exec("abcde");
    shouldBe(m.length, 3, "lookbehind/modifier captures");
    shouldBe(m[1], "a", "lookbehind capture");
    shouldBe(m[2], "e", "trailing capture");
    shouldBe(m.indices.length, 3, "hasIndices shape");
    shouldBe(m.indices[1][0], 0, "hasIndices lookbehind start");
    shouldBe(re.exec("abCdE"), null, "modifier group scope");
}

// /v set operations and class strings on the lazy path.
{
    let re = new RegExp("[\\p{L}--[a-z]][\\q{xy|z}]" + "(?:" + filler + ")?", "v");
    shouldBe(re.test("Axy"), true, "v set difference + class string");
    shouldBe(re.test("axy"), false, "v set difference excludes");
    shouldBe(re.test("Bz"), true, "v class string single");
}

// Shared Unicode property classes under /iu (case-closure of a shared class must not disturb the base class).
{
    let upper = new RegExp("\\p{Lu}" + "(?:" + filler + ")?", "u");
    let upperIgnoreCase = new RegExp("\\p{Lu}" + "(?:" + filler + ")?", "iu");
    let notUpper = new RegExp("\\P{Lu}" + "(?:" + filler + ")?", "u");
    shouldBe(upper.test("a"), false, "\\p{Lu} u");
    shouldBe(upperIgnoreCase.test("a"), true, "\\p{Lu} iu");
    shouldBe(upper.test("a"), false, "\\p{Lu} u after iu compile");
    shouldBe(notUpper.test("a"), true, "\\P{Lu} u");
    shouldBe(/\p{Lu}/u.test("a"), false, "short \\p{Lu} shares the class");
}

// Deeply nested long patterns take the eager path, so where they throw does not depend on the option.
// Running out of stack while building or compiling one is a clean throw of either kind (see
// regexp-quantify-atom-copy-term-out-of-stack.js); with enough stack nothing throws.
{
    let depth = 20000;
    let source = "(?:".repeat(depth) + "a" + ")".repeat(depth);
    let outOfStack = [
        "SyntaxError: Invalid regular expression: regular expression too large",
        "RangeError: Out of memory: Invalid regular expression: too many nested disjunctions",
    ];
    let constructed = null;
    try {
        constructed = new RegExp(source);
    } catch (e) {
        shouldBe(outOfStack.includes(String(e)), true, "deeply nested pattern construction error: " + e);
    }
    if (constructed) {
        let result = true;
        try {
            result = constructed.test("a");
        } catch (e) {
            shouldBe(outOfStack.includes(String(e)), true, "deeply nested pattern compile error: " + e);
        }
        shouldBe(result, true, "deeply nested pattern runs");
    }
}
