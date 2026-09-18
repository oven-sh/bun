// Regression test for the YARR JIT surrogate mask. Surrogates occupy U+D800..U+DFFF
// and must be isolated with the mask 0xFC00 (bits 15..10). The JIT used 0xDC00, which
// drops bit 13, so ordinary BMP code units in U+F800..U+FFFF were misclassified as
// surrogates and two of them were fused into a single code point. All of these are
// plain BMP scalars, so each string below is two code points, never one.

function shouldBe(actual, expected, msg) {
    if (actual !== expected)
        throw new Error(`FAIL: ${msg}: expected ${expected}, got ${actual}`);
}

let loop = typeof testLoopCount !== "undefined" ? testLoopCount : 200;
let cc = String.fromCharCode;

// [firstUnit, secondUnit, codePoints]: only a genuine pair (lead 0xD800..0xDBFF followed
// by trail 0xDC00..0xDFFF) is a single code point. The "fake" variants set bit 13 and are
// two ordinary BMP code points.
let cases = [
    [0xd800, 0xdc00, 1], // genuine surrogate pair -> one code point
    [0xdbff, 0xdfff, 1], // genuine pair, top of range
    [0xf800, 0xfc00, 2], // fake lead + fake trail (both bit 13 set)
    [0xd800, 0xfc00, 2], // real lead + fake trail
    [0xf800, 0xdc00, 2], // fake lead + real trail
    [0xfbff, 0xffff, 2], // fake pair, top of range
    [0x0041, 0x0042, 2], // plain BMP control
];

for (let i = 0; i < loop; i++) {
    for (let [a, b, cps] of cases) {
        let s = cc(a, b);
        let tag = `[${a.toString(16)},${b.toString(16)}]`;

        // Spread is the correct code-point segmentation reference.
        shouldBe([...s].length, cps, `codepoints ${tag}`);

        // In /u mode a dot matches exactly one code point.
        shouldBe(/^.$/u.test(s), cps === 1, `single dot ${tag}`);
        shouldBe(/^..$/u.test(s), cps === 2, `double dot ${tag}`);

        // Greedy variable-width class match (forward advance uses the same mask).
        let fwd = new RegExp("([^X]*)Z", "u").exec(s + "Z");
        shouldBe(fwd !== null, true, `greedy match ${tag}`);
        shouldBe(fwd[1], s, `greedy capture ${tag}`);

        // Greedy variable-width class backtracking: the class eats everything, then must
        // give back exactly one code point so the trailing literal (the second code unit)
        // can match. This only works if the last matched code point is one unit wide, i.e.
        // the two units were not fused into a bogus pair.
        if (cps === 2) {
            let re = new RegExp("([^X]*)" + cc(b), "u");
            let m = re.exec(s);
            shouldBe(m !== null, true, `backtrack match ${tag}`);
            shouldBe(m[1], cc(a), `backtrack capture ${tag}`);
        }
    }

    // Genuine pairs must still be treated as one code point after the fix.
    shouldBe(/^.$/u.test("\u{10000}"), true, "astral single dot");
    shouldBe(/^.$/u.test("\u{10ffff}"), true, "astral max single dot");
}
