(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }
    let calls = 0;
    const called = { f() { ++calls; } };

    function is1(a) { return a === "a"; }
    function is3(a) { return a === "abc"; }
    function is7(a) { return a === "abcdefg"; }
    function is8(a) { return a === "abcdefgh"; }
    function is9(a) { return a === "abcdefghi"; }
    function is10(a) { return a === "abcdefghij"; }
    function is12(a) { return a === "abcdefghijkl"; }
    function is15(a) { return a === "abcdefghijklmno"; }
    function is16(a) { return a === "abcdefghijklmnop"; }
    function is17(a) { return a === "abcdefghijklmnopq"; }
    function is23(a) { return a === "abcdefghijklmnopqrstuvw"; }
    function is24(a) { return a === "abcdefghijklmnopqrstuvwx"; }
    function is25(a) { return a === "abcdefghijklmnopqrstuvwxy"; }
    function count1(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "a")
                ++count;
        }
        return count;
    }
    function count3(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abc")
                ++count;
        }
        return count;
    }
    function count7(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefg")
                ++count;
        }
        return count;
    }
    function count8(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefgh")
                ++count;
        }
        return count;
    }
    function count9(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefghi")
                ++count;
        }
        return count;
    }
    function count10(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefghij")
                ++count;
        }
        return count;
    }
    function count12(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefghijkl")
                ++count;
        }
        return count;
    }
    function count15(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefghijklmno")
                ++count;
        }
        return count;
    }
    function count16(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefghijklmnop")
                ++count;
        }
        return count;
    }
    function count17(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefghijklmnopq")
                ++count;
        }
        return count;
    }
    function count23(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefghijklmnopqrstuvw")
                ++count;
        }
        return count;
    }
    function count24(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefghijklmnopqrstuvwx")
                ++count;
        }
        return count;
    }
    function count25(list) {
        let count = 0;
        for (let i = 0; i < list.length; ++i) {
            called.f();
            if (list[i] === "abcdefghijklmnopqrstuvwxy")
                ++count;
        }
        return count;
    }
    const cases = [
        ["a", is1, count1],
        ["abc", is3, count3],
        ["abcdefg", is7, count7],
        ["abcdefgh", is8, count8],
        ["abcdefghi", is9, count9],
        ["abcdefghij", is10, count10],
        ["abcdefghijkl", is12, count12],
        ["abcdefghijklmno", is15, count15],
        ["abcdefghijklmnop", is16, count16],
        ["abcdefghijklmnopq", is17, count17],
        ["abcdefghijklmnopqrstuvw", is23, count23],
        ["abcdefghijklmnopqrstuvwx", is24, count24],
        ["abcdefghijklmnopqrstuvwxy", is25, count25],
    ];

    function copyOf(text) { return String.fromCharCode(...Array.from(text, character => character.charCodeAt(0))); }
    function sliceOf(text, offset) { return ("#".repeat(offset) + text + "################").slice(offset, offset + text.length); }
    function wideSliceOf(text) { return (text + "\u2603 and more text behind it").slice(0, text.length); }
    function ropeOf(text) { return copyOf(text.slice(0, text.length >> 1)) + copyOf(text.slice(text.length >> 1)); }
    function withCharacter(text, at, character) { return copyOf(text.slice(0, at) + character + text.slice(at + 1)); }

    for (let [text, is, count] of cases) {
        let equal = [text, copyOf(text), wideSliceOf(text), ropeOf(text)];
        for (let offset = 0; offset < 9; ++offset)
            equal.push(sliceOf(text, offset));
        let atom = copyOf(text);
        ({ })[atom] = 1;
        equal.push(atom);
        let different = [text + "z", copyOf(text + "z"), text.slice(1), copyOf(text.slice(0, -1)), "", undefined, null, 0, text.length, true, { }, [text], Symbol(text), { toString() { return text; } }];
        for (let at = 0; at < text.length; ++at) {
            different.push(withCharacter(text, at, "Z"), withCharacter(text, at, "\0"), withCharacter(text, at, "\xff"), withCharacter(text, at, "\u2603"));
            different.push(sliceOf(withCharacter(text, at, "Z"), at % 5));
            different.push(ropeOf(withCharacter(text, at, "Z")));
        }
        for (let round = 0; round < 2; ++round) {
            for (let i = 0; i < equal.length; ++i)
                check(is(equal[i]), true, text + " and equal operand " + i);
            for (let i = 0; i < different.length; ++i)
                check(is(different[i]), false, text + " and different operand " + i);
        }
        let fresh = [ropeOf(text), wideSliceOf(text), sliceOf(text, 3), copyOf(text), ropeOf(withCharacter(text, text.length - 1, "Z"))];
        check(count(fresh), 4, text + " in a loop, operands never seen before");
        check(count(equal), equal.length, text + " in a loop, equal operands");
        check(count(different), 0, text + " in a loop, different operands");
    }
    check(calls > 0, true, "the loops call something");
})();
console.log("passed");
