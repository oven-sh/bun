function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    function first() { return 2; }
    function second() { return 3; }
    function Item(tag, key, child) {
        this.tag = tag;
        this.key = key;
        this.child = child;
    }
    function build(...pairs) {
        let object = { };
        for (let i = 0; i < pairs.length; i += 2)
            object[pairs[i]] = pairs[i + 1];
        return object;
    }
    let mayBeEmpty;
    var isNeverEmpty;
    let kept = 0, keptInOneStep = 0, keptOfMerged = 0, keptOfMergedVar = 0;
    function keeps(e) { if (e !== undefined && e !== null) kept = e; }
    function keepsInOneStep(e) { if (e != null) keptInOneStep = e; }
    function keepsMerged(e, other, takesFirst) { let merged = takesFirst ? e : other; if (merged !== undefined) keptOfMerged = merged; }
    function keepsMergedVar(e, other, takesFirst) { let merged = takesFirst ? e : other; if (merged !== undefined) keptOfMergedVar = merged; }
    function readsThreeAndKeeps(o) { keeps(mayBeEmpty); return o.tag + o.key + o.child; }
    function readsThreeAndKeepsInOneStep(o) { keepsInOneStep(mayBeEmpty); return o.tag + o.key + o.child; }
    function readsThreeAndKeepsMerged(o, takesFirst) { keepsMerged(mayBeEmpty, second, takesFirst); return o.tag + o.key + o.child; }
    function readsThreeAndKeepsMergedVar(o, takesFirst) { keepsMergedVar(isNeverEmpty, second, takesFirst); return o.tag + o.key + o.child; }

    let expectedOfMerged = 0;
    for (let i = 0; i < 400; ++i) {
        mayBeEmpty = (i & 3) === 0 ? undefined : (i & 3) === 1 ? null : (i & 3) === 2 ? first : second;
        isNeverEmpty = (i & 3) === 0 ? undefined : (i & 3) === 1 ? null : (i & 3) === 2 ? first : second;
        let make = i % 10 == 9 ? () => build("child", 2, "key", 1, "tag", i) : () => new Item(i, 1, 2);
        check(readsThreeAndKeeps(make()), i + 3, "three reads behind a test in two steps");
        check(readsThreeAndKeepsInOneStep(make()), i + 3, "three reads behind a test in one step");
        let expected = i < 2 ? 1 : (i & 3) == 2 ? 2 : (i & 3) == 3 ? 3 : 3;
        check(kept === 0 ? 1 : kept(), expected, "what the test in two steps kept");
        check(keptInOneStep === 0 ? 1 : keptInOneStep(), expected, "what the test in one step kept");
        let takesFirst = i % 7 < 5;
        check(readsThreeAndKeepsMerged(make(), takesFirst), i + 3, "three reads behind a test of a merged value");
        check(readsThreeAndKeepsMergedVar(make(), takesFirst), i + 3, "three reads behind a test of a merged value that is never empty");
        if (!takesFirst || (i & 3))
            expectedOfMerged = !takesFirst ? 3 : (i & 3) === 1 ? -1 : (i & 3) === 2 ? 2 : 3;
        check(keptOfMerged === 0 ? 0 : keptOfMerged === null ? -1 : keptOfMerged(), expectedOfMerged, "what the test of a merged value kept");
        check(keptOfMergedVar === 0 ? 0 : keptOfMergedVar === null ? -1 : keptOfMergedVar(), expectedOfMerged, "what the test of a merged value that is never empty kept");
    }
})();
console.log("passed");
