// Neighbouring alternatives of one character become one class, and finishing a class can take time in proportion to the square
// of its size: 0.33 seconds for 40,000 alternatives that took 0.05. A long run now becomes several classes.

function shouldBe(actual, expected)
{
    if (actual !== expected)
        throw new Error(`expected ${expected} but got ${actual}`);
}

// A range of two characters, then the character after it, then one that is left out.
const first = index => 0x10000 + 4 * (index >> 1) + (index & 1 ? 2 : 0);
const escaped = codePoint => `\\u{${codePoint.toString(16)}}`;
const alternative = index => index & 1 ? escaped(first(index)) : `[${escaped(first(index))}-${escaped(first(index) + 1)}]`;

for (const count of [2, 1000, 1023, 1024, 1025, 1026, 2047, 2048, 2049, 2050, 50000]) {
    for (const [before, after] of [["^(?:", ")+$"], ["^(?:", ")*"], ["^(?:xy|", "|z)+$"]].slice(0, count > 3000 ? 1 : 3)) {
        const regExp = new RegExp(before + Array.from({ length: count }, (_, index) => alternative(index)).join("|") + after, "u");
        let members = "";
        for (const index of [0, 1, 1022, 1023, 1024, 1025, 2046, 2047, 2048, 2049, count >> 1, count - 2, count - 1]) {
            if (index < count)
                members += String.fromCodePoint(first(index));
        }
        shouldBe(regExp.exec(members)[0], members);
        shouldBe(regExp.exec(members + members)[0], members + members);
        // The character that each group of four leaves out, and the one after the last alternative.
        const leftOut = String.fromCodePoint(first(0) + 3), pastTheEnd = String.fromCodePoint(first(count - 1) + 4);
        for (const other of [leftOut, pastTheEnd]) {
            const result = regExp.exec(members + other);
            shouldBe(after === ")*" ? result[0] : result, after === ")*" ? members : null);
        }
    }
}
