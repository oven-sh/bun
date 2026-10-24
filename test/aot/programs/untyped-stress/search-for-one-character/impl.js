function check(actual, expected, what)
{
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(Object.is(actual, -0) ? "-0" : actual) + " instead of " + String(Object.is(expected, -0) ? "-0" : expected));
}

function errorOf(run)
{
    try {
        run();
    } catch (error) {
        return error.constructor;
    }
    return null;
}
function test()
{
    const long = "abcdefghijklmnopqrstuvwxyz0123456789";
    function dash(s) { return s.indexOf("-"); }
    function hasDash(s) { return s.includes("-"); }
    function accent(s) { return s.indexOf("\xe9"); }
    function euro(s) { return s.indexOf("€"); }
    function nothing(s) { return s.indexOf(""); }
    function two(s) { return s.indexOf("--"); }
    function from(s, i) { return s.indexOf("-", i); }
    function variable(s, c) { return s.indexOf(c); }
    function last(s) { return s.lastIndexOf("-"); }
    function ofAnything(x) { return x.indexOf("-"); }
    function afterTypeof(x) { if (typeof x === "string") return x.indexOf("-"); return -2; }

    const strings = [
        ["", -1], ["-", 0], ["a", -1], ["a-", 1], ["-a", 0], ["a-b", 1], ["a-b-c", 1], ["div", -1], ["my-element", 2], ["abcdefgh", -1], ["abcdefg-", 7],
        [long.slice(0, 31) + "-", 31], [long.slice(0, 32), -1], [long.slice(0, 32) + "-", 32], [long + "-", 36], [long + long + long, -1], [long + long + long + "-x", 108], ["-" + long + long, 0],
        ["\xe9-", 1], ["\xff\xfe-", 2], ["€-", 1], ["a€b", -1], ["€" + long + "-", 37], ["‐", -1], ["ĭ", -1], ["－", -1],
    ];
    for (let round = 0; round < 50; ++round) {
        for (const [string, expected] of strings) {
            const s = String(string);
            check(dash(s), expected, "indexOf in " + s);
            check(hasDash(s), expected >= 0, "includes in " + s);
            check(dash(("x" + s + "y").slice(1, -1)), expected, "indexOf in a slice of " + s);
            check(dash("ab" + s), expected < 0 ? -1 : expected + 2, "indexOf in a rope with " + s);
            check(dash(s + "q" + round), expected, "indexOf in a rope that starts with " + s);
            check(afterTypeof(s), expected, "indexOf behind typeof in " + s);
            check(ofAnything(s), expected, "indexOf of anything in " + s);
            check(variable(s, "-"), expected, "indexOf of a variable in " + s);
            check(from(s, 0), expected, "indexOf from 0 in " + s);
        }
        check(accent("caf\xe9"), 3, "a Latin-1 character");
        check(accent("cafe"), -1, "a Latin-1 character");
        check(accent("€caf\xe9"), 4, "a Latin-1 character among wide ones");
        check(accent("é"), -1, "a Latin-1 character and a combining one");
        check(euro("5€"), 1, "a wide character");
        check(euro("5e"), -1, "a wide character in a narrow string");
        check(euro("\xac"), -1, "the low byte of a wide character");
        check(nothing("ab"), 0, "an empty needle");
        check(two("a--b"), 1, "two characters");
        check(two("a-b"), -1, "two characters");
        check(from("a-b-c", 2), 3, "from an index");
        check(last("a-b-c"), 3, "lastIndexOf");
        check(ofAnything(["a", "-"]), 1, "an array");
        check(ofAnything(new String("a-b")), 1, "a String object");
        check(ofAnything({ indexOf() { return "mine"; } }), "mine", "an object with its own indexOf");
        check(afterTypeof(5), -2, "no string");
    }
    for (const length of [33, 65534, 65535, 65536, 65539]) {
        const filler = "x".repeat(length);
        for (const [string, expected] of [[filler, -1], [filler + "ab-", length + 2], ["-" + filler, 0]]) {
            const flat = String(string);
            flat.charCodeAt(0);
            check(dash(flat), expected, "indexOf in a string of " + flat.length + " characters");
            check(hasDash(flat), expected >= 0, "includes in a string of " + flat.length + " characters");
            check(dash(("y" + flat + "y").slice(1, -1)), expected, "indexOf in a slice of " + flat.length + " characters");
        }
    }
    check(errorOf(() => ofAnything(null)), TypeError, "null");
    check(errorOf(() => ofAnything(5)), TypeError, "a number");
}
test();
console.log("passed");
