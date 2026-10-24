(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }
    let everything = [];

    function addsOne(x) { try { } catch { } return x + 1; }
    function passesNumber(a, options) { try { } catch { } if (options !== undefined) return addsOne("text" + a); return addsOne(a); }
    check(passesNumber(1) + passesNumber(2, undefined), 5, "the arm that passes a string is never reached");

    function isOnlyCalledFromDeadArm(x) { try { } catch { } return x * 2; }
    function neverGetsThere(a, options) { try { } catch { } if (options !== undefined) return isOnlyCalledFromDeadArm(a); return a; }
    check(neverGetsThere(1), 1, "the only call is never reached");

    let count = 0;
    function readsCount() { try { } catch { } return count + 1; }
    function storesCount(a, options) { try { } catch { } if (options !== undefined) count = "text"; else count = a | 0; }
    storesCount(4);
    check(readsCount(), 5, "the arm that stores a string is never reached");

    function staysHere(x) { try { } catch { } return x + 1; }
    function letsOutInDeadArm(a, options) { try { } catch { } if (options !== undefined) everything.push(staysHere); return staysHere(a); }
    check(letsOutInDeadArm(1), 2, "the arm that lets the function out is never reached");

    function returnsNumber(a, options) { try { } catch { } if (options !== undefined) return "text"; return a | 0; }
    function usesResult(a) { try { } catch { } return returnsNumber(a) + 1; }
    check(usesResult(1), 2, "the arm that returns a string is never reached");

    function mergesNumber(a, options) { try { } catch { } let merged; if (options !== undefined) merged = "text"; else merged = a | 0; return addsOneToMerged(merged); }
    function addsOneToMerged(x) { try { } catch { } return x + 1; }
    check(mergesNumber(1), 2, "a variable that only gets a number");

    function chainEnd(x) { try { } catch { } return x + 1; }
    function chainMiddle(x, options) { try { } catch { } if (options !== undefined) return chainEnd("text"); return chainEnd(x); }
    function chainStart(x, options) { try { } catch { } if (options !== undefined) return chainMiddle(x, { }); return chainMiddle(x); }
    check(chainStart(1), 2, "an arm that is dead because another one is");

    function addsOneToAnything(x) { try { } catch { } return x + 1; }
    function passesEither(a, options) { try { } catch { } if (options !== undefined) return addsOneToAnything("text" + a); return addsOneToAnything(a); }
    check(passesEither(1) + passesEither(2, { }), "2text21", "one caller passes the options");

    function isCalledAfterAll(x) { try { } catch { } return x * 2; }
    function getsThere(a, options) { try { } catch { } if (options !== undefined) return isCalledAfterAll(a); return a; }
    check(getsThere(1) + getsThere(1, null), 3, "null is not undefined");

    function getsOut(x) { try { } catch { } return x + 1; }
    function letsOut(a, options) { try { } catch { } if (options !== undefined) everything.push(getsOut); return getsOut(a); }
    check(letsOut(1) + letsOut(1, true), 4, "the function gets out");
    check(everything[0]("text"), "text1", "and is called with anything");

    function returnsEither(a, options) { try { } catch { } if (options !== undefined) return "text"; return a | 0; }
    function usesEither(a, options) { try { } catch { } return returnsEither(a, options) + 1; }
    check(usesEither(1) + usesEither(1, 0), "2text1", "both arms return");

    function makesPair(a) { try { } catch { } return { first: a, second: a + 1 }; }
    function keepsPairInDeadArm(a, options) { try { } catch { } const pair = makesPair(a); if (options !== undefined) everything.push(pair); return pair.first + pair.second; }
    check(keepsPairInDeadArm(1), 3, "an object that is only kept in an arm that is never reached");
})();
console.log("passed");
