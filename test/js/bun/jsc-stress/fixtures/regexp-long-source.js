function shouldBe(actual, expected)
{
    if (actual !== expected)
        throw new Error(`expected ${expected} but got ${actual}`);
}

function shouldBeTooLarge(source, flags)
{
    let error;
    try {
        new RegExp(source, flags);
    } catch (e) {
        error = e;
    }
    shouldBe(error instanceof SyntaxError, true);
    shouldBe(error.message, "Invalid regular expression: regular expression too large");
}

const limit = 1024 * 1024;
const limitWithCharacterClasses = 16 * limit;

// Few terms, long source: nearly all of it is the \u{...} escapes of the ranges.
let ranges = "";
for (let i = 0; i < 2000; ++i) {
    const from = 0xf0000 + i * 4;
    ranges += `\\u{${from.toString(16)}}-\\u{${(from + 1).toString(16)}}`;
}

const count = 40;
let source = "^";
for (let i = 1; i <= count; ++i)
    source += `(?:(?=([${ranges}]*))\\${i})x`;
source += "$";
shouldBe(source.length > limit, true);

for (const flags of ["u", "iu", "giu", "v"]) {
    const regExp = new RegExp(source, flags);
    shouldBe(regExp.source.length, source.length);
    regExp.lastIndex = 0;
    shouldBe(regExp.test("x".repeat(count)), true);
    regExp.lastIndex = 0;
    shouldBe(regExp.test("x".repeat(count - 1)), false);
    regExp.lastIndex = 0;
    shouldBe(regExp.test("\u{f0000}\u{f0005}x" + "x".repeat(count - 1)), true);
    regExp.lastIndex = 0;
    shouldBe(regExp.test("\u{f0002}x" + "x".repeat(count - 1)), false);
}

// What ends a class, and what does not.
const filler = "a".repeat(limit);
shouldBe(new RegExp(`^[${filler}\\]b]$`).test("]"), true);
shouldBe(new RegExp(`^[${filler}[]$`).test("["), true);
shouldBe(new RegExp(`^[${filler}[b]c]$`, "v").test("b"), true);
shouldBe(new RegExp(`^[${filler}\\q{bc}]$`, "v").test("bc"), true);
shouldBe(new RegExp(`^[\\q{${filler}}]$`).test("q"), true);
shouldBeTooLarge(`[b]${filler}`);
shouldBeTooLarge(`[b\\]]${filler}`);
shouldBeTooLarge(`\\[${filler}]`);
shouldBeTooLarge(`[[b]${filler}`);
shouldBeTooLarge(`[[b]]${filler}`, "v");
shouldBeTooLarge(`[\\q{${filler}}]`, "v");

// Outside of classes the limit is what it was.
shouldBeTooLarge("a" + filler);
shouldBeTooLarge("a|".repeat(limit / 2) + "a");
shouldBeTooLarge("[a]".repeat(limit + 1));
shouldBeTooLarge("[" + "[a]".repeat(limit) + "]", "v");

shouldBe(new RegExp("[" + "a".repeat(limitWithCharacterClasses - 2) + "]").test("a"), true);
shouldBeTooLarge("[" + "a".repeat(limitWithCharacterClasses - 1) + "]");
