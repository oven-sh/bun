function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
(function () {
    "use strict";
    let kept;
    function work(x) { let sum = 0; for (let i = 0; i < 3; i++) sum += x ^ i; return sum; }
    function describe(object) { return JSON.stringify(object) + Object.keys(object).join() + (Object.getPrototypeOf(object) === Object.prototype); }

    function makesPair(i) { return { first: work(i), second: i + 1 }; }
    function readsPair(i) { const { first, second } = makesPair(i); return first + second; }
    function readsOneOfPair(i) { return makesPair(i).second + 0; }
    function keepsPair(i) { const pair = makesPair(i); kept = pair; return pair.first; }
    function returnsPairOn(i) { const pair = makesPair(i); return pair; }
    function passesPairOn(i) { return describe(makesPair(i)) + ""; }
    function comparesPairs(i) { const one = makesPair(i), other = makesPair(i); return (one === other) + "," + (one === one) + "," + typeof one; }
    function writesToPair(i) { const pair = makesPair(i); pair.first = "written"; pair.third = 3; return describe(pair) + ""; }
    function mergesPairs(i, which) { const pair = which ? makesPair(i) : makesPair(i + 10); return pair.second + Object.keys(pair).length; }
    function keepsPairForHandler(i, fails) {
        let pair;
        try {
            pair = makesPair(i);
            if (fails)
                throw new Error("thrown");
            return "none";
        } catch (error) {
            return describe(pair) + error.message;
        }
    }
    function keepsPairsInLoop(count) {
        const all = [];
        for (let i = 0; i < count; i++)
            all.push(makesPair(i));
        return all;
    }

    check(readsPair(5), work(5) + 6, "both are read");
    check(readsOneOfPair(5), 6, "one is read");
    check(keepsPair(5), work(5), "a property of the object that is kept");
    check(describe(kept), '{"first":' + work(5) + ',"second":6}first,secondtrue', "the object that is kept");
    const before = kept;
    keepsPair(5);
    check(before === kept, false, "every call makes another object");
    check(describe(returnsPairOn(7)), '{"first":' + work(7) + ',"second":8}first,secondtrue', "the object that is returned on");
    check(passesPairOn(7), '{"first":' + work(7) + ',"second":8}first,secondtrue', "the object that is passed on");
    check(comparesPairs(1), "false,true,object", "identity");
    check(writesToPair(1), '{"first":"written","second":2,"third":3}first,second,thirdtrue', "the object is written to");
    check(mergesPairs(1, true), 4, "one of two");
    check(mergesPairs(1, false), 14, "the other of two");
    check(keepsPairForHandler(2, false), "none", "no exception");
    check(keepsPairForHandler(2, true), '{"first":' + work(2) + ',"second":3}first,secondtruethrown', "the handler reads the object");
    const many = keepsPairsInLoop(20000);
    let sum = 0;
    for (const pair of many)
        sum += pair.second;
    check(sum, 20000 * 20001 / 2, "many objects");
    check(new Set(many).size, 20000, "all of them different");

    function makesEveryKind(x) { return { int32: work(x) | 0, double: x / 2 + 0.25, boolean: x > 1, string: "s" + x, object: [x] }; }
    function readsEveryKind(x) { const all = makesEveryKind(x); return all.int32 + all.double + all.string + all.boolean + all.object.length; }
    function keepsEveryKind(x) { kept = makesEveryKind(x); return kept.int32; }
    check(readsEveryKind(2), (work(2) + 1.25) + "s2" + "true1", "values of every kind are read");
    keepsEveryKind(2);
    check(JSON.stringify(kept), '{"int32":' + work(2) + ',"double":1.25,"boolean":true,"string":"s2","object":[2]}', "values of every kind are kept");
    keepsEveryKind(1);
    check(JSON.stringify(kept), '{"int32":' + work(1) + ',"double":0.75,"boolean":false,"string":"s1","object":[1]}', "other values");

    function makesOtherKinds(x) { return { nothing: undefined, none: null, number: work(x) > 3 ? 1.5 : 1 }; }
    function readsOtherKinds(x) { const all = makesOtherKinds(x); return "" + all.nothing + all.none + all.number; }
    function keepsOtherKinds(x) { kept = makesOtherKinds(x); return 0; }
    check(readsOtherKinds(2), "undefinednull" + (work(2) > 3 ? 1.5 : 1), "undefined, null and a number are read");
    keepsOtherKinds(2);
    check(Object.keys(kept).join() + kept.nothing + kept.none + kept.number, "nothing,none,numberundefinednull" + (work(2) > 3 ? 1.5 : 1), "undefined, null and a number are kept");
    keepsOtherKinds(0);
    check(kept.number, work(0) > 3 ? 1.5 : 1, "the other number");

    function returnsInTwoPlaces(x) {
        if (x > 1)
            return { low: 1, high: work(x) };
        return { low: work(x), high: 1 };
    }
    function readsFromTwoPlaces(x) { const { low, high } = returnsInTwoPlaces(x); return low * 1000 + high; }
    function keepsFromTwoPlaces(x) { kept = returnsInTwoPlaces(x); return 0; }
    check(readsFromTwoPlaces(2), 1000 + work(2), "the first return is read");
    check(readsFromTwoPlaces(1), work(1) * 1000 + 1, "the second return is read");
    keepsFromTwoPlaces(2);
    check(JSON.stringify(kept), '{"low":1,"high":' + work(2) + '}', "the first return is kept");
    keepsFromTwoPlaces(1);
    check(JSON.stringify(kept), '{"low":' + work(1) + ',"high":1}', "the second return is kept");

    function calledInTailPosition(x) { return { a: work(x), b: 2 }; }
    function callsInTailPosition(x) { return calledInTailPosition(x); }
    function readsWhatIsAlsoTailCalled(x) { const { a, b } = calledInTailPosition(x); return a + b; }
    check(JSON.stringify(callsInTailPosition(3)), '{"a":' + work(3) + ',"b":2}', "a tail call");
    check(readsWhatIsAlsoTailCalled(3), work(3) + 2, "a read of what another function calls in tail position");

    function returnsNineValues(x) { return { a: work(x), b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 }; }
    function readsNineValues(x) { const all = returnsNineValues(x); return all.a + all.i; }
    check(readsNineValues(1), work(1) + 9, "nine values");

    function sometimesReturnsNothing(x) {
        if (x > 1)
            return undefined;
        return { a: work(x), b: 2 };
    }
    function keepsWhatMayBeNothing(x) { kept = sometimesReturnsNothing(x); return 0; }
    keepsWhatMayBeNothing(2);
    check(kept, undefined, "nothing");
    keepsWhatMayBeNothing(1);
    check(JSON.stringify(kept), '{"a":' + work(1) + ',"b":2}', "something");

    function makesInner(x) { return { depth: work(x), below: null }; }
    function returnsInnerInLiteral(x) { const below = makesInner(x); return { depth: 1, below }; }
    function readsInnerInLiteral(x) { const { depth, below } = returnsInnerInLiteral(x); return depth + below.depth; }
    function keepsInnerInLiteral(x) { kept = returnsInnerInLiteral(x); return 0; }
    check(JSON.stringify(returnsInnerInLiteral(3)), '{"depth":1,"below":{"depth":' + work(3) + ',"below":null}}', "a returned literal holds what another function returns");
    check(readsInnerInLiteral(3), 1 + work(3), "its caller reads both");
    keepsInnerInLiteral(2);
    check(JSON.stringify(kept), '{"depth":1,"below":{"depth":' + work(2) + ',"below":null}}', "its caller keeps it");

    function callsItself(depth) {
        if (!depth)
            return { depth: 0, below: null };
        const below = callsItself(depth - 1);
        return { depth: work(depth), below };
    }
    let chain = callsItself(3);
    check(JSON.stringify(chain), '{"depth":' + work(3) + ',"below":{"depth":' + work(2) + ',"below":{"depth":' + work(1) + ',"below":{"depth":0,"below":null}}}}', "a function that keeps what it returns itself");
})();
console.log("passed");
