function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function narrow() { return "a narrow literal"; }
function wide() { return "中文 a wide literal"; }
function empty() { return ""; }
function big() { return 123456789012345678901234567890n; }
function twice(which) { return which ? "the same literal" : "the same " + "literal"; }
function several(i) {
    switch (i) {
    case 0: return "zero";
    case 1: return "one";
    case 2: return "two";
    case 3: return "three";
    default: return "many";
    }
}
function compares(s) { return s === "wanted" ? "yes" : "no"; }
function asKey(o) { return o["a key that is no identifier"]; }
function asDefault(s = "the default") { return s; }
function inLiteral() { return { kind: "literal", list: ["first", "second"] }; }
function joins(s) { return "<" + s + ">"; }
function elsewhere() { return "a narrow literal"; }
function calledOnce() { return "used by a function that runs once"; }
function calledThrice() { return "used by a function that runs three times"; }
function inLoop(n) {
    let count = 0;
    let last = "";
    for (let i = 0; i < n; ++i) {
        last = i & 1 ? "odd in a loop" : "even in a loop";
        count += last.length;
    }
    return count + last;
}
function immediates(i) { return i === 0 ? 1 : i === 1 ? 1.5 : i === 2 ? true : i === 3 ? null : i === 4 ? undefined : -0; }
function arrayOfImmediates() { return [1, 1.5, true, false, null, undefined, -0]; }
function arrayOfIntegers() { return [1, 2, 3]; }
function arrayOfDoubles() { return [1.5, 2.5]; }
function matchesLiteral(text) { return text.match(/(\d+)-(\d+)/); }
function execsLiteral(text) { return /(\w+)=(\w+)/.exec(text); }
function testsLiteralInCallback(list) { return list.filter(function (item) { return /^a/.test(item); }); }
function onRarePath(o) {
    if (o.rare)
        throw new Error("a literal on a path that is rarely taken: " + o.rare);
    return o.usual;
}
function tagged(strings) { return strings; }
function template() { return tagged`a template ${1} object`; }
function inTry() { try { return "in a try block"; } catch (e) { return "caught"; } }
function thrown() { try { throw "a thrown literal"; } catch (e) { return e; } }

check(matchesLiteral("first 3-4")[1], "3", "the first use of a regular expression literal passed to match");
check(execsLiteral("a=b")[1], "a", "the first use of a regular expression literal that is the receiver");
check(testsLiteralInCallback(["a", "b"]).length, 1, "the first use of a regular expression literal in a callback");
check(calledOnce(), "used by a function that runs once", "a function that runs once");
for (let i = 0; i < 3; ++i)
    check(calledThrice(), "used by a function that runs three times", "a function that runs three times");

const names = ["zero", "one", "two", "three", "many", "many"];
let firstTemplate = template();
for (let round = 0; round < 3000; ++round) {
    check(narrow(), "a narrow literal", "a narrow literal");
    check(wide(), "中文 a wide literal", "a wide literal");
    check(wide().charCodeAt(0), 0x4e2d, "the first character of a wide literal");
    check(empty(), "", "the empty literal");
    check(big(), 123456789012345678901234567890n, "a BigInt literal");
    check(big() + 1n, 123456789012345678901234567891n, "arithmetic on a BigInt literal");
    check(twice(round & 1), "the same literal", "a literal that occurs twice");
    check(several(round % 6), names[round % 6], "several literals in one function");
    check(compares(round & 1 ? "wanted" : "other"), round & 1 ? "yes" : "no", "a literal that is compared");
    check(asKey({ "a key that is no identifier": round }), round, "a literal used as a key");
    check(asDefault(), "the default", "a literal as a default");
    check(asDefault("given"), "given", "a default that is not used");
    let made = inLiteral();
    check(made.kind + made.list.join(), "literalfirst,second", "literals in literals");
    check(joins("x" + round), "<x" + round + ">", "literals that are joined");
    check(elsewhere(), narrow(), "equal literals of two functions");
    check(inTry(), "in a try block", "a literal in a try block");
    check(thrown(), "a thrown literal", "a literal that is thrown");
    check(immediates(round % 6), [1, 1.5, true, null, undefined, -0][round % 6], "values that are no cells");
    check(arrayOfImmediates().length, 7, "an array literal of values of several kinds");
    check(arrayOfIntegers().join(), "1,2,3", "an array literal of integers");
    check(arrayOfIntegers() === arrayOfIntegers(), false, "each evaluation of an array literal makes an array");
    check(arrayOfDoubles().join(), "1.5,2.5", "an array literal of doubles");
    check(matchesLiteral("x 12-" + round)[2], String(round), "a regular expression literal passed to match");
    check(execsLiteral("key=v" + round)[2], "v" + round, "a regular expression literal that is the receiver");
    check(testsLiteralInCallback(["a" + round, "b", "ab"]).length, 2, "a regular expression literal in a callback");
    check(onRarePath({ usual: round }), round, "the usual path");
    if (!(round % 500)) {
        let message = "";
        try {
            onRarePath({ rare: "r" + round });
        } catch (e) {
            message = e.message;
        }
        check(message, "a literal on a path that is rarely taken: r" + round, "a literal on a path that is rarely taken");
    }
    check(template(), firstTemplate, "a template object is the same each time");
    if (round === 1000 || round === 2000) {
        gc();
        if (typeof fullGC === "function")
            fullGC();
    }
}
check(inLoop(1001), 13 * 500 + 14 * 501 + "even in a loop", "literals in a loop");
check(inLoop(20000), 13 * 10000 + 14 * 10000 + "odd in a loop", "literals in a long loop");
check(firstTemplate.join("|") + firstTemplate.raw.length, "a template | object2", "a template object");

console.log("passed");
