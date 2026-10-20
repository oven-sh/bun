//@ skip if not $jitTests
//@ skip if $architecture != "arm64" and $architecture != "x86_64"
//@ runDefault

// Nothing backtracks into a lookaround that has matched, so the JIT code never freed the state of the groups in it. A search
// kept that state from one start position to the next and ran out of stack. The interpreter then started over, reached its
// limit on steps, and reported that there was no match.

function shouldBe(actual, expected)
{
    if (actual !== expected)
        throw new Error(`expected ${expected} but got ${String(actual).slice(0, 80)}`);
}

// Every start position in the filler fails after its lookaround has matched. The only match starts after the filler.
function test(regExp, filler, tail, offset, expected)
{
    const result = regExp.exec(filler + tail);
    shouldBe(JSON.stringify(result), JSON.stringify(expected));
    shouldBe(result.index, filler.length + offset);
}

const filler = "ab".repeat(4096);

test(/(?=((?:ab|c)+))\1x/, filler, "yabx", 1, ["abx", "ab"]);
test(/(?=((?:(a)b)+))\1x/, filler, "yabx", 1, ["abx", "ab", "a"]);
test(/(?<!y)(?=((?:\w(b)?)+))\1!/, filler, " b!", 1, ["b!", "b", null]);
test(/(?=((?:ab|c)+))\1x/g, filler, "yabx", 1, ["abx", "ab"]);
test(/(?=((?:ab|c)+))\1x/u, filler, "yabx", 1, ["abx", "ab"]);
test(/(?=((?:ab|c)+))\1x/i, filler, "yABX", 1, ["ABX", "AB"]);

// A negative lookahead fails when what is in it matches.
test(/(?!(?:(a)|(b))+y)[ab]+?z/, filler, "y bz", 2, ["bz", null, null]);

// More than one alternative, and one that is only tried at the start.
test(/(?=((?:ab|c)+))\1x|(?=((?:ba|c)+))\2z/, filler, "ybaz", 1, ["baz", null, "ba"]);
test(/^q|(?=((?:ab|c)+))\1x/, filler, "yabx", 1, ["abx", "ab"]);

// 16-bit input.
test(/(?=((?:ab|c)+))\1x/, filler, "あabx", 1, ["abx", "ab"]);

// The groups outside of the lookaround keep their state within one attempt.
test(/(?:(a)(?=((?:b|ab)+))b|(b)(?=(a)))+x/, "ab".repeat(128), "yabx", 1, ["abx", "a", "b", null, null]);

// No match at all.
shouldBe(/(?=((?:ab|c)+))\1x/.exec(filler), null);
