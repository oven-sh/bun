// @bun
// A class is a function, and a static accessor called "name" or "length" takes the place of the property that every
// function has. bind() gives its result the name and the length that the accessor answers when bind() runs. That holds
// where the accessor is defined by itself too: in front of a member under a key in brackets, or under such a key.

function shouldBe(actual, expected, what) {
    if (actual !== expected)
        throw new Error(what + ": expected " + JSON.stringify(expected) + " but got " + JSON.stringify(actual));
}

const key = "member";

// [what the class has, a function that makes the class, the name of the bound class, its length]
const rows = [
    ["a getter called length in front of a member under a key in brackets", () => class C { constructor(a, b) { } static get length() { return 9; } [key]() { } }, "bound C", 9],
    ["a getter under the key \"length\" in brackets", () => class C { constructor(a, b) { } static get ["length"]() { return 9; } }, "bound C", 9],
    ["a getter called length behind a member under a key in brackets", () => class C { constructor(a, b) { } [key]() { } static get length() { return 9; } }, "bound C", 9],
    ["a getter called length and no key in brackets", () => class C { constructor(a, b) { } static get length() { return 9; } }, "bound C", 9],
    ["a getter and a setter called length in front of a member under a key in brackets", () => class C { constructor(a, b) { } static get length() { return 9; } static set length(value) { } [key]() { } }, "bound C", 9],
    ["a setter called length in front of a member under a key in brackets", () => class C { constructor(a, b) { } static set length(value) { } [key]() { } }, "bound C", 0],
    ["a setter under the key \"length\" in brackets", () => class C { constructor(a, b) { } static set ["length"](value) { } }, "bound C", 0],
    ["a getter called name in front of a member under a key in brackets", () => class C { constructor(a, b) { } static get name() { return "custom"; } [key]() { } }, "bound custom", 2],
    ["a getter under the key \"name\" in brackets", () => class C { constructor(a, b) { } static get ["name"]() { return "custom"; } }, "bound custom", 2],
    ["a getter called name behind a member under a key in brackets", () => class C { constructor(a, b) { } [key]() { } static get name() { return "custom"; } }, "bound custom", 2],
    ["a getter called name and no key in brackets", () => class C { constructor(a, b) { } static get name() { return "custom"; } }, "bound custom", 2],
    ["a setter called name in front of a member under a key in brackets", () => class C { constructor(a, b) { } static set name(value) { } [key]() { } }, "bound ", 2],
    ["a getter called name that answers a number", () => class C { constructor(a, b) { } static get name() { return 42; } [key]() { } }, "bound ", 2],
    ["getters called name and length in front of a member under a key in brackets", () => class C { constructor(a, b) { } static get name() { return "custom"; } static get length() { return 9; } [key]() { } }, "bound custom", 9],
    ["a static method under a key in brackets and nothing called name or length", () => class C { constructor(a, b) { } static [key]() { } }, "bound C", 2],
];

function boundClass(C) {
    return C.bind(null);
}

function checkRow([what, make, name, length], renamed) {
    const C = make();
    if (renamed) {
        // The program gives the class another name. The accessor called length stays.
        Object.defineProperty(C, "name", { value: "renamed" });
        name = "bound renamed";
        what += ", and the class gets another name";
    }
    const bound = boundClass(C);
    shouldBe(bound.length, length, what + ", the length");
    shouldBe(bound.name, name, what + ", the name");
    shouldBe(boundClass(C).name + "," + boundClass(C).length, name + "," + length, what + ", bound again");
    shouldBe(bound.bind(null).name, "bound " + name, what + ", bound twice");
}

for (const row of rows) {
    checkRow(row, false);
    checkRow(row, true);
}
for (let i = 0; i < testLoopCount; i++)
    checkRow(rows[i % rows.length], Math.floor(i / rows.length) % 2 === 1);

// bind() calls each getter once. A read of the name or the length of its result calls none.
function checkCalls(renamed) {
    let calls = "";
    class C {
        constructor(a, b) { }
        static get name() { calls += "name,"; return "custom"; }
        static get length() { calls += "length,"; return 9; }
        [key]() { }
    }
    if (renamed)
        Object.defineProperty(C, "name", { value: "renamed" });
    const bound = boundClass(C);
    const expected = renamed ? "length," : "length,name,";
    shouldBe(calls, expected, "the calls in bind()");
    shouldBe(bound.name + "," + bound.length + "," + bound.name, (renamed ? "bound renamed" : "bound custom") + ",9," + (renamed ? "bound renamed" : "bound custom"), "what the getters answered");
    shouldBe(calls, expected, "the calls behind the reads");
}
for (let i = 0; i < testLoopCount; i++)
    checkCalls(i % 2 === 1);

// A getter that throws makes bind() throw.
function checkThrow(renamed, which) {
    class C {
        constructor(a, b) { }
        static get [which]() { throw new RangeError("from the getter"); }
        [key]() { }
    }
    if (renamed && which === "length")
        Object.defineProperty(C, "name", { value: "renamed" });
    let error;
    try {
        boundClass(C);
    } catch (caught) {
        error = caught;
    }
    shouldBe(error instanceof RangeError && error.message, "from the getter", "a getter called " + which + " that throws");
}
for (let i = 0; i < testLoopCount; i++)
    checkThrow(i % 2 === 1, i % 4 < 2 ? "length" : "name");
