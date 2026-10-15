function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function is0(s) { return s === ""; }
function is1(s) { return s === "a"; }
function is2(s) { return s === "ab"; }
function is3(s) { return s === "abc"; }
function is4(s) { return s === "abcd"; }
function is5(s) { return s === "abcde"; }
function is6(s) { return s === "abcdef"; }
function is7(s) { return s === "abcdefg"; }
function is8(s) { return s === "abcdefgh"; }
function is9(s) { return s === "abcdefghi"; }
function isNot4(s) { return "abcd" !== s; }
function isHigh(s) { return s === "\xe9\xff"; }
let tests = [is0, is1, is2, is3, is4, is5, is6, is7, is8, is9];
let full = "abcdefghi";
function flat(s) { return JSON.parse(JSON.stringify(s)); }
function rope(s) { return s.length < 2 ? s : flat(s.slice(0, 1)) + flat(s.slice(1)); }
function substring(s) { return flat("xx" + s + "yy").slice(2, 2 + s.length); }
function wide(s) { return flat("ሴ" + s).slice(1); }
for (let round = 0; round < 3; ++round) {
    for (let length = 0; length < tests.length; ++length) {
        let literal = full.slice(0, length);
        for (let make of [flat, rope, substring, wide]) {
            check(tests[length](make(literal)), true, "equal, length " + length + ", " + make.name);
            for (let other = 0; other < tests.length; ++other) {
                if (other != length)
                    check(tests[other](make(literal)), false, "another length, " + length + " and " + other + ", " + make.name);
            }
            for (let at = 0; at < length; ++at) {
                let changed = literal.slice(0, at) + "z" + literal.slice(at + 1);
                check(tests[length](make(changed)), false, "differs at " + at + ", length " + length + ", " + make.name);
            }
        }
        for (let value of [undefined, null, 0, 1.5, true, {}, [], Symbol(), 10n, new String(literal)])
            check(tests[length](value), false, "not a string, length " + length);
    }
    check(isNot4(flat("abcd")), false, "!==, equal");
    check(isNot4(flat("abce")), true, "!==, different");
    check(isHigh(flat("\xe9\xff")), true, "Latin-1 above 127");
    check(isHigh(flat("\xe9\xfe")), false, "Latin-1 above 127, different");
    check(isHigh(wide("\xe9\xff")), true, "Latin-1 above 127, in a 16-bit string");
    check(is2(flat("šb")), false, "a 16-bit character whose low byte matches");
}

function isWide(s) { return s === "\u1234"; }
function isEither(a, b) { return a === b; }
function isLoose(s) { return s == "ab"; }
check(isWide("\u1234"), true, "a 16-bit literal");
check(isWide("4"), false, "a 16-bit literal, and its low byte");
check(isEither("ab", "ab"), true, "two variables");
check(isLoose("ab"), true, "==");
check(isLoose({ toString() { return "ab"; } }), true, "==, with a conversion");
console.log("passed");
