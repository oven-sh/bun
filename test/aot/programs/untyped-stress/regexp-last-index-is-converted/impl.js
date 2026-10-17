let count = 0;
const counting = () => ({ valueOf() { count++; return 0; } });
function shouldBe(name, actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        throw new Error(name + ": " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
}

function replace() { const r = /b/; r.lastIndex = counting(); return "abc".replace(r, "x"); }
function split() { const r = /b/; r.lastIndex = counting(); return "abc".split(r); }
function match() { const r = /b/; r.lastIndex = counting(); return "abc".match(r)[0]; }
function search() { const r = /b/; r.lastIndex = counting(); return "abc".search(r); }
function test() { const r = /b/; r.lastIndex = counting(); return r.test("abc"); }
function exec() { const r = /b/; r.lastIndex = counting(); return r.exec("abc")[0]; }
function replaceGlobal() { const r = /b/g; r.lastIndex = counting(); return ["abcb".replace(r, "x"), r.lastIndex]; }
function replaceAllGlobal() { const r = /b/g; r.lastIndex = counting(); return ["abcb".replaceAll(r, "x"), r.lastIndex]; }
function matchGlobal() { const r = /b/g; r.lastIndex = counting(); return ["abcb".match(r), r.lastIndex]; }
function testGlobal() { const r = /b/g; r.lastIndex = counting(); return [r.test("abcb"), r.lastIndex]; }
function execGlobal() { const r = /b/g; r.lastIndex = counting(); return [r.exec("abcb")[0], r.lastIndex]; }
function replaceSticky() { const r = /a/y; r.lastIndex = counting(); return ["abcb".replace(r, "x"), r.lastIndex]; }
function testSticky() { const r = /a/y; r.lastIndex = counting(); return [r.test("abcb"), r.lastIndex]; }

const expected = {
    replace: ["axc", 1], split: [["a", "c"], 0], match: ["b", 1], search: [1, 0], test: [true, 1], exec: ["b", 1],
    replaceGlobal: [["axcx", 0], 0], replaceAllGlobal: [["axcx", 0], 0], matchGlobal: [[["b", "b"], 0], 0],
    testGlobal: [[true, 2], 1], execGlobal: [["b", 2], 1], replaceSticky: [["xbcb", 1], 1], testSticky: [[true, 1], 1],
};
for (let i = 0; i < 3; i++) {
    for (const f of [replace, split, match, search, test, exec, replaceGlobal, replaceAllGlobal, matchGlobal, testGlobal, execGlobal, replaceSticky, testSticky]) {
        count = 0;
        const result = f();
        shouldBe(f.name, [result, count], expected[f.name]);
    }
}
console.log("passed");
