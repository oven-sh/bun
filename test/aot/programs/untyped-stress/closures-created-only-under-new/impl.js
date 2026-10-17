(function () {
    function shouldBe(actual, expected, what) {
        if (actual !== expected)
            throw new Error(what + ": " + actual + " instead of " + expected);
    }
    function Differs() { return new.target ? function constructed(x) { return x + 1; } : function called(x) { return x + 2; }; }
    function Guarded(start) {
        if (!new.target)
            return new Guarded(start);
        this.next = function next(step) { return start + step; };
    }
    for (let i = 0; i < 20; ++i) {
        shouldBe(new Differs()(1), 2, "the function that only the construct code makes");
        shouldBe(Differs()(1), 3, "the function that only the call code makes");
        shouldBe(new Guarded(i).next(1), i + 1, "a closure made after a test of new.target, constructed");
        shouldBe(Guarded(i).next(2), i + 2, "a closure made after a test of new.target, called");
    }
})();
console.log("passed");
