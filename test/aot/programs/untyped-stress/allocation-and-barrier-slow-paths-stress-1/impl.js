function shouldBe(actual, expected, what)
{
    if (actual !== expected)
        throw new Error(what + ": " + actual + " instead of " + expected);
}

(function () {
    let kept;
    function makesFunction() { return function () { return 1; }; }
    function makesFunctionWithCapture(x) { return () => x; }

    for (let i = 0; i < 1000; ++i) {
        kept = makesFunction();
        kept = makesFunctionWithCapture(i);
    }

    const rounds = 10;
    const perRound = 20000;
    for (let round = 0; round < rounds; ++round) {
        for (let i = 0; i < perRound; ++i) {
            kept = makesFunction();
            shouldBe(kept(), 1, "a function");
            kept = makesFunctionWithCapture(i);
            shouldBe(kept(), i, "a function with a capture");
        }
        edenGC();
    }
})();

(function () {
    const owner = { field: null, other: 0 };
    const values = [{ }, { }];
    function stores(o, v) { o.field = v; }

    for (let i = 0; i < 1000; ++i) {
        stores(owner, values[i & 1]);
    }
    fullGC();

    const stored = 2000000;
    for (let i = 0; i < stored; ++i)
        stores(owner, values[i & 1]);
    shouldBe(owner.field, values[1], "the last value stored");
})();

(function () {
    let made = 0;
    function count() { ++made; }
    class ManyMethods {
        constructor(x)
        {
            count();
            this.first = x;
            this.second = x;
            this.third = x;
            this.fourth = x;
        }
        m0() { return 0; } m1() { return 1; } m2() { return 2; } m3() { return 3; } m4() { return 4; } m5() { return 5; }
        m6() { return 6; } m7() { return 7; } m8() { return 8; } m9() { return 9; } m10() { return 10; } m11() { return this.fourth; }
    }

    let sum = 0;
    for (let i = 0; i < 200; ++i)
        sum += new ManyMethods(i).m11();
    shouldBe(sum, 19900, "fields of a class with many methods");
    shouldBe(made, 200, "constructor calls");
})();
console.log("passed");
