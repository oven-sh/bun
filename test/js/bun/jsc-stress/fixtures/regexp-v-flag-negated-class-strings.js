// @bun
// A negated class set is a SyntaxError when MayContainStrings of its contents is true. The Parser decides that from
// the operands alone, so RegExp creation reports it on the path that does not build the class, and so does the
// early error check of a regular expression literal.

function shouldBe(actual, expected, what) {
    if (actual !== expected)
        throw new Error(`${what}: expected ${expected} but got ${actual}`);
}

function errorOf(callback) {
    try {
        callback();
    } catch (error) {
        return error;
    }
    return null;
}

// Each set is tried alone and in a pattern that is long enough for lazy pattern construction.
const filler = "(?:" + "z".repeat(70) + ")?";
const forms = [set => set, set => set + filler, set => filler + set];

function shouldBeRefused(set, message) {
    for (const form of forms) {
        const source = form(set);
        const error = errorOf(() => new RegExp(source, "v"));
        shouldBe(error instanceof SyntaxError, true, `new RegExp of /${set}/v throws a SyntaxError`);
        if (message)
            shouldBe(error.message, message, `message for /${set}/v`);
    }
}

function shouldMatch(set, matching, nonMatching) {
    for (const form of forms) {
        const regExp = new RegExp("^(?:" + form(set) + ")$", "v");
        for (const string of matching)
            shouldBe(regExp.test(string), true, `/${set}/v matches ${JSON.stringify(string)}`);
        for (const string of nonMatching)
            shouldBe(regExp.test(string), false, `/${set}/v matches ${JSON.stringify(string)}`);
    }
}

const mayContainStrings = "Invalid regular expression: negated class set may contain strings";

for (const set of [
    // A class string that is not one character is a string, the empty one included.
    "[^\\q{}]",
    "[^\\q{a|}]",
    "[^\\q{|a}]",
    "[^\\q{a||b}]",
    "[^\\q{ab}]",
    "[^[\\q{}]]",
    "[^[a-z]\\q{}]",
    "[^\\d\\q{ab}]",
    "[[^\\q{}]]",
    "[a[^\\q{}]]",
    "[^\\p{Emoji_Keycap_Sequence}]",
    // A subtraction: its first operand decides.
    "[^\\q{}--a]",
    "[^\\q{}--\\q{}]",
    "[^\\q{ab}--\\q{ab}]",
    "[^[\\q{}]--[\\q{}]]",
    "[^\\p{Emoji_Keycap_Sequence}--\\q{a}]",
    // An intersection: every operand has to be able to contain strings.
    "[^\\q{}&&\\q{}]",
    "[^\\q{ab|c}&&\\q{ab}]",
    "[^\\q{ab}&&\\p{Emoji_Keycap_Sequence}]",
    "[^\\p{RGI_Emoji}&&\\p{RGI_Emoji}]",
    "[^\\p{Emoji_Keycap_Sequence}&&[\\q{ab}]&&\\p{Emoji_Keycap_Sequence}]",
]) {
    shouldBeRefused(set, mayContainStrings);

    // The same early error for a literal, in code that never runs.
    const error = errorOf(() => new Function(`if (false) return /${set}/v;`));
    shouldBe(error instanceof SyntaxError, true, `a literal /${set}/v is an early error`);
}

for (const [set, matching, nonMatching] of [
    ["[^\\q{a}]", ["b"], ["a"]],
    ["[^\\q{a|b}]", ["c"], ["a", "b"]],
    ["[\\q{}]", [""], ["a"]],
    ["[\\q{ab|}]", ["ab", ""], ["a"]],
    // One operand of an intersection that cannot contain strings is enough: a character, a class, a class escape.
    ["[^\\q{ab|a}&&a]", ["b"], ["a", "ab"]],
    ["[^\\q{ab|a}&&\\x61]", ["b"], ["a", "ab"]],
    ["[^a&&\\q{ab|a}]", ["b"], ["a", "ab"]],
    ["[^\\q{ab|a}&&[a-z]]", ["b"], ["a", "ab"]],
    ["[^[a-z]&&\\q{ab|a}]", ["b"], ["a", "ab"]],
    ["[^\\q{ab|1}&&\\d]", ["a"], ["1", "ab"]],
    ["[^\\q{ab|a}&&a&&\\q{ab|a}]", ["b"], ["a", "ab"]],
    ["[^\\p{Emoji_Keycap_Sequence}&&\\q{ab|a}&&a]", ["a"], ["ab"]],
    ["[^\\q{}&&a]", ["a"], [""]],
    // The second operand of a subtraction does not count.
    ["[^[a-z]--\\q{ab|c}]", ["c", "1"], ["a", "b"]],
    ["[^a--\\q{}]", ["b"], ["a"]],
    // Neither does a negated operand.
    ["[^\\q{ab|a}&&[^b]]", ["b"], ["a"]],
    ["[\\q{ab}[^\\q{a}]]", ["ab", "b"], ["a"]],
    // Each class has its own operands: a nested class is one operand of the class around it, whatever is in it
    // and whatever is before it.
    ["[^\\d[\\q{ab}&&\\x61]]", ["x"], ["1", "ab"]],
    ["[^\\d[\\q{ab}&&a]]", ["x"], ["1", "ab"]],
    ["[^[\\q{ab|a}&&a]]", ["b"], ["a", "ab"]],
    ["[^[a\\q{ab}]&&b]", ["a", "b"], ["ab"]],
    ["[^\\q{ab|a}&&[a\\q{ab}]&&a]", ["b"], ["a", "ab"]],
]) {
    shouldMatch(set, matching, nonMatching);
}

// Operands that follow one another and then an operator are outside the grammar. This parser reads some of them as
// a union on the left of the operator. Until it refuses them all, a character after && does not clear the flag
// there, so that a negated one that holds strings stays a SyntaxError.
shouldBeRefused("[^a\\q{ab}&&b]");
shouldBeRefused("[^\\x61\\q{ab}&&\\x62]");
shouldBeRefused("[^\\d\\q{ab}&&b]");
shouldBeRefused("[^\\q{ab}[b]&&a]");
shouldBeRefused("[^a\\q{ab}[x]&&b]");

// Two gaps that stay, written down so that a change to them is seen.
// The grammar has no operator after juxtaposed operands either when the next operand is not a character.
shouldMatch("[^a\\q{ab}&&\\d]", ["a", "1"], ["ab"]);
// A nested class starts in the parser state of the operand before it, and this valid set is refused.
shouldBeRefused("[\\q{ab}[a&&b]]");
