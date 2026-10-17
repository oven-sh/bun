(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }

    function readsLiteralInLoop(n) { const o = { start: 1, step: 2 }; let sum = o.start; for (let i = 0; i < n; ++i) sum += o.step; return sum; }
    function readsMergedInLoop(c, n) { const o = c ? { step: 1 } : { step: 2.5 }; let sum = 0; for (let i = 0; i < n; ++i) sum += o.step; return sum; }
    function readsInNestedLoops(n) { const o = { a: 1, b: 10 }; let sum = 0; for (let i = 0; i < n; ++i) { for (let j = 0; j < n; ++j) sum += o.a; sum += o.b; } return sum; }
    function carriesState(n) { let s = { p: 0, q: 1 }; for (let i = 0; ; ++i) { if (i >= n) return s.p; s = { p: s.q, q: s.p + s.q }; } }
    function swaps(n) { let o = { a: "a", b: "b" }; let i = 0; while (true) { if (i++ >= n) break; o = { a: o.b, b: o.a }; } return o.a + o.b; }
    function rotates(n) { let o = { a: 1, b: 2, c: 3 }; for (let i = 0; ; ++i) { if (i >= n) break; o = { a: o.b, b: o.c, c: o.a }; } return o.a * 100 + o.b * 10 + o.c; }
    function lags(n) { let s = { current: 0, previous: -1 }; for (let i = 1; ; ++i) { if (i > n) return s.current + ":" + s.previous; s = { current: i, previous: s.current }; } }

    check(readsLiteralInLoop(0), 1, "no iteration");
    check(readsLiteralInLoop(3), 7, "three iterations");
    check(readsMergedInLoop(true, 4), 4, "the first literal");
    check(readsMergedInLoop(false, 4), 10, "the second literal");
    check(readsInNestedLoops(3), 39, "nested loops");
    check(carriesState(0), 0, "no iteration");
    check(carriesState(10), 55, "ten iterations");
    check(carriesState(80), 23416728348467684, "numbers that are no integers any more");
    check(swaps(0), "ab", "not swapped");
    check(swaps(1), "ba", "swapped once");
    check(swaps(4), "ab", "swapped four times");
    check(rotates(0), 123, "not rotated");
    check(rotates(1), 231, "rotated once");
    check(rotates(2), 312, "rotated twice");
    check(rotates(3), 123, "rotated three times");
    check(lags(0), "0:-1", "no iteration");
    check(lags(7), "7:6", "the value of the iteration before");

    function readsProperty(o) { return o.x; }
    function readsGivenInLoop(o, n) { let sum = 0; for (let i = 0; i < n; ++i) sum += o.step; return sum; }
    function readsBothInLoop(o, n) { const own = { step: 1 }; let sum = 0; for (let i = 0; i < n; ++i) sum += own.step + o.step; return sum; }
    function escapesInLoop(n, kept) { const o = { step: 1 }; let sum = 0; for (let i = 0; i < n; ++i) { sum += o.step; kept.last = o; } return sum; }
    check(readsProperty({ x: 1 }) + readsProperty({ y: 1, x: 2 }), 3, "the probe");
    check(readsGivenInLoop({ step: 2 }, 3) + readsGivenInLoop({ other: 0, step: 3 }, 3), 15, "an object that is given");
    check(readsBothInLoop({ step: 2 }, 3) + readsBothInLoop({ other: 0, step: 3 }, 3), 21, "one of each");
    let kept = { };
    check(escapesInLoop(3, kept) + kept.last.step, 4, "an object that is kept");
})();
console.log("passed");
