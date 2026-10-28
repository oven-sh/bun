function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function ends(s) { return s.endsWith("abc"); }
function starts(s) { return s.startsWith("abc"); }
noInline(ends);
noInline(starts);
function flat(s) { s.charCodeAt(0); return s; }

for (let length of [0, 1, 2, 3, 4, 100, 65531, 65532, 65533, 65534, 65535, 65536, 65537, 65538, 70000, 131072, 1 << 20]) {
    check(ends(flat("x".repeat(length) + "abc")), true, "ends with it after " + length);
    check(ends(flat("x".repeat(length) + "abd")), false, "does not end with it after " + length);
    check(ends(flat("x".repeat(length) + "abc" + "y")), false, "one more character after " + length);
    check(starts(flat("abc" + "x".repeat(length))), true, "starts with it, then " + length);
    check(starts(flat("xabc" + "x".repeat(length))), false, "does not start with it, then " + length);
}
check(ends(flat("x".repeat(65532) + "abc" + "y".repeat(100))), false, "it is where a length of 65535 would end");
check(ends(flat("x".repeat(65532) + "abc" + "y".repeat(100) + "abc")), true, "there and at the end");
let long = flat("x".repeat(70000) + "abc" + "z".repeat(10));
check(ends(long.slice(0, 70003)), true, "a substring that ends with it");
check(ends(long.slice(5, 70002)), false, "a substring that does not");
check(ends("Ā".repeat(70000) + "abc"), true, "16-bit");
check(ends("x".repeat(70000) + "abc"), true, "a rope");
console.log("passed");
