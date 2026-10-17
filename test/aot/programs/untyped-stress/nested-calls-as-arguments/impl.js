function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
(function () {
    function wrap(a) { try { return a; } catch (e) { return 0; } }
    function wrap3(a, b, c) { try { return a + b + c; } catch (e) { return 0; } }
    function throwsIf(flag) { if (flag) throw new Error("thrown"); return 0; }

    function nestedBeforeForOf(a) { try { return a + 1; } catch (e) { return 0; } }
    function argumentOfMethodBeforeForOf(a) { try { return a + 1; } catch (e) { return 0; } }
    function firstOfThreeBeforeForOf(a) { try { return a + 1; } catch (e) { return 0; } }
    function lastOfThreeBeforeForOf(a) { try { return a + 1; } catch (e) { return 0; } }
    function nestedNextToBigLiteral(a) { try { return a + 1; } catch (e) { return 0; } }
    function nestedInForOf(a) { try { return a + 1; } catch (e) { return 0; } }
    function nestedBetweenForOfs(a) { try { return a + 1; } catch (e) { return 0; } }
    function u1(xs) { let t = wrap(nestedBeforeForOf(1)); for (const x of xs) t += x; return t; }
    function u2(xs) { xs.push(argumentOfMethodBeforeForOf(1)); let t = 0; for (const x of xs) t += x; return t; }
    function u3(xs) { let t = wrap3(firstOfThreeBeforeForOf(1), 2, 3); for (const x of xs) t += x; return t; }
    function u4(xs) { let t = wrap3(1, 2, lastOfThreeBeforeForOf(3)); for (const x of xs) t += x; return t; }
    function u5(x) { let t = wrap(nestedNextToBigLiteral(1)); return [x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x].length + t; }
    function u6(xs) { let t = 0; for (const x of xs) t += wrap(nestedInForOf(x)); return t; }
    function u7(xs) { let t = 0; for (const x of xs) t += x; t += wrap3(1, nestedBetweenForOfs(1), 3); for (const x of xs) t += x; return t; }
    check(u1([1, 2]), 5, "a nested call before for-of");
    check(u2([1]), 3, "an argument of a method call before for-of");
    check(u3([1]), 8, "the first of three arguments");
    check(u4([1]), 8, "the last of three arguments");
    check(u5(1), 36, "next to a literal with 34 elements");
    check(u6([1, 2]), 5, "in for-of");
    check(u7([1]), 8, "between two for-ofs");

    function oneOfTwoFirst(a) { try { return a + 1; } catch (e) { return 0; } }
    function oneOfTwoSecond(a) { try { return a + 2; } catch (e) { return 0; } }
    function elementOfBigLiteral(a) { try { return a + 1; } catch (e) { return 0; } }
    function readByHandler(flag, later) { let f = oneOfTwoFirst; try { throwsIf(flag); f = oneOfTwoSecond; throwsIf(later); } catch (e) { return f(1); } return f(10); }
    function u8(x) { return [x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,elementOfBigLiteral,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x,x]; }
    check(readByHandler(true, false), 2, "the handler reads the first function");
    check(readByHandler(false, true), 3, "the handler reads the second function");
    check(readByHandler(false, false), 12, "no exception");
    check(u8(1)[17](1) + elementOfBigLiteral(1), 4, "a function that is an element of a literal with 34 elements");
    function keepsEveryStore(flag, later) { let a = 1; try { throwsIf(flag); a = 2; throwsIf(later); a = 3; } catch (e) { return a; } return a; }
    function hasNoHandler(a) { return wrap3(wrap(a), wrap(a), wrap(a)); }
    check([keepsEveryStore(true, false), keepsEveryStore(false, true), keepsEveryStore(false, false)].join(), "1,2,3", "each value a handler can see");
    check(hasNoHandler(1), 3, "no handler");

    function closesIterator(log, flag) {
        const iterable = { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { log.push("closed"); return { }; } }; } };
        let t = wrap3(wrap(1), wrap(2), wrap(3));
        try {
            for (const x of iterable) { t += wrap3(x, wrap(x), throwsIf(flag)); if (t > 20) break; }
        } catch (e) { log.push(e.message); }
        return t;
    }
    let log = [];
    check(closesIterator(log, true) + log.join(), "6closed,thrown", "an exception in for-of closes the iterator");
    log = [];
    check(closesIterator(log, false) + log.join(), "22closed", "break closes the iterator");
    function finallyKeepsValues(flag) {
        let a = wrap(1), b = wrap3(wrap(1), wrap(1), wrap(1)), seen = "";
        try { a = wrap(a + 1); throwsIf(flag); b = wrap(b + 1); } catch (e) { seen = "caught " + a + " " + b; } finally { seen += " finally " + a + " " + b; }
        return seen;
    }
    check(finallyKeepsValues(true), "caught 2 3 finally 2 3", "values at the time of the exception");
    check(finallyKeepsValues(false), " finally 2 4", "values without an exception");
})();
console.log("passed");
