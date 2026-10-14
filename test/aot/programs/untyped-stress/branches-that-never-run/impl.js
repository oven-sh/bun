const aotRemarks = () => null, isAOTCompiled = () => false, aotFunctionsNamed = () => [], aotOperationCount = () => 0, aotTypeCoverage = () => null, aotSetFamily = () => undefined, aotFamilyOf = () => 0, aotHasDepartedFamily = () => false;
//@ runDefault("--compileMainScriptAheadOfTime=1")
(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }
    function matches(remark, pattern) { return remark === pattern || remark.startsWith(pattern + ":"); }
    function applies(name, ...patterns) {
        let remarks = aotRemarks(name);
        for (let pattern of remarks ? patterns : []) {
            if (!remarks.some(remark => matches(remark, pattern)))
                throw new Error(pattern + " does not apply to " + name + ": " + remarks.join(" "));
        }
    }
    function remarksOnGeneralBody(name) {
        let remarks = aotRemarks(name);
        let start = remarks ? remarks.indexOf("is-general-body") : -1;
        if (start < 0)
            return remarks;
        let end = remarks.indexOf("compiled", start);
        return remarks.slice(start, end < 0 ? remarks.length : end);
    }
    function doesNotApply(name, ...patterns) {
        let remarks = remarksOnGeneralBody(name);
        for (let pattern of remarks ? patterns : []) {
            if (remarks.some(remark => matches(remark, pattern)))
                throw new Error(pattern + " applies to " + name + ": " + remarks.join(" "));
        }
    }
    const integers = "integer-arithmetic", closed = "function-does-not-escape", compiled = "compiled";
    let everything = [];

    function addsOne(x) { try { } catch { } return x + 1; }
    function passesNumber(a, options) { try { } catch { } if (options !== undefined) return addsOne("text" + a); return addsOne(a); }
    check(passesNumber(1) + passesNumber(2, undefined), 5, "the arm that passes a string is never reached");
    applies("addsOne", integers);

    function isOnlyCalledFromDeadArm(x) { try { } catch { } return x * 2; }
    function neverGetsThere(a, options) { try { } catch { } if (options !== undefined) return isOnlyCalledFromDeadArm(a); return a; }
    check(neverGetsThere(1), 1, "the only call is never reached");
    doesNotApply("isOnlyCalledFromDeadArm", compiled);

    let count = 0;
    function readsCount() { try { } catch { } return count + 1; }
    function storesCount(a, options) { try { } catch { } if (options !== undefined) count = "text"; else count = a | 0; }
    storesCount(4);
    check(readsCount(), 5, "the arm that stores a string is never reached");
    applies("readsCount", integers);

    function staysHere(x) { try { } catch { } return x + 1; }
    function letsOutInDeadArm(a, options) { try { } catch { } if (options !== undefined) everything.push(staysHere); return staysHere(a); }
    check(letsOutInDeadArm(1), 2, "the arm that lets the function out is never reached");
    applies("staysHere", closed, integers);

    function returnsNumber(a, options) { try { } catch { } if (options !== undefined) return "text"; return a | 0; }
    function usesResult(a) { try { } catch { } return returnsNumber(a) + 1; }
    check(usesResult(1), 2, "the arm that returns a string is never reached");
    applies("usesResult", integers);

    function mergesNumber(a, options) { try { } catch { } let merged; if (options !== undefined) merged = "text"; else merged = a | 0; return addsOneToMerged(merged); }
    function addsOneToMerged(x) { try { } catch { } return x + 1; }
    check(mergesNumber(1), 2, "a variable that only gets a number");
    applies("addsOneToMerged", integers);

    function chainEnd(x) { try { } catch { } return x + 1; }
    function chainMiddle(x, options) { try { } catch { } if (options !== undefined) return chainEnd("text"); return chainEnd(x); }
    function chainStart(x, options) { try { } catch { } if (options !== undefined) return chainMiddle(x, { }); return chainMiddle(x); }
    check(chainStart(1), 2, "an arm that is dead because another one is");
    applies("chainEnd", integers);

    function addsOneToAnything(x) { try { } catch { } return x + 1; }
    function passesEither(a, options) { try { } catch { } if (options !== undefined) return addsOneToAnything("text" + a); return addsOneToAnything(a); }
    check(passesEither(1) + passesEither(2, { }), "2text21", "one caller passes the options");
    doesNotApply("addsOneToAnything", integers);

    function isCalledAfterAll(x) { try { } catch { } return x * 2; }
    function getsThere(a, options) { try { } catch { } if (options !== undefined) return isCalledAfterAll(a); return a; }
    check(getsThere(1) + getsThere(1, null), 3, "null is not undefined");
    applies("isCalledAfterAll", compiled);

    function getsOut(x) { try { } catch { } return x + 1; }
    function letsOut(a, options) { try { } catch { } if (options !== undefined) everything.push(getsOut); return getsOut(a); }
    check(letsOut(1) + letsOut(1, true), 4, "the function gets out");
    check(everything[0]("text"), "text1", "and is called with anything");
    doesNotApply("getsOut", closed, integers);

    function returnsEither(a, options) { try { } catch { } if (options !== undefined) return "text"; return a | 0; }
    function usesEither(a, options) { try { } catch { } return returnsEither(a, options) + 1; }
    check(usesEither(1) + usesEither(1, 0), "2text1", "both arms return");
    doesNotApply("usesEither", integers);

    function makesPair(a) { try { } catch { } return { first: a, second: a + 1 }; }
    function keepsPairInDeadArm(a, options) { try { } catch { } const pair = makesPair(a); if (options !== undefined) everything.push(pair); return pair.first + pair.second; }
    check(keepsPairInDeadArm(1), 3, "an object that is only kept in an arm that is never reached");
})();
console.log("passed");
