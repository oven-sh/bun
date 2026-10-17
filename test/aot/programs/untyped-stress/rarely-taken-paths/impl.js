(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }
    function messageOf(f) {
        try {
            f();
        } catch (error) {
            return error.constructor.name + ": " + error.message;
        }
        return "nothing was thrown";
    }

    let log = [];
    function fails(message) {
        log.push("fails");
        throw new RangeError(message);
    }
    function failsThroughAnother(message) {
        log.push("through");
        fails(message + "!");
    }
    function failsOnEveryPath(kind) {
        if (kind === 1)
            throw new TypeError("one");
        if (kind === 2)
            fails("two");
        throw new SyntaxError("other");
    }
    function failsSometimes(message, really) {
        if (really)
            throw new RangeError(message);
        return message.length;
    }
    function notes(message) {
        log.push(message);
    }

    function throwsWhenNegative(x) {
        if (x < 0)
            throw new RangeError("negative: " + x);
        return x * 2;
    }
    check(throwsWhenNegative(21), 42, "the usual path beside a throw");
    check(messageOf(() => throwsWhenNegative(-1)), "RangeError: negative: -1", "the path that throws");

    function preparesBeforeThrowing(x) {
        if (x < 0) {
            let text = "negative";
            if (x < -10)
                text = "very " + text;
            else
                text = "slightly " + text;
            throw new RangeError(text);
        }
        return x + 1;
    }
    check(preparesBeforeThrowing(1), 2, "the usual path beside several blocks that lead to a throw");
    check(messageOf(() => preparesBeforeThrowing(-11)), "RangeError: very negative", "one way to the throw");
    check(messageOf(() => preparesBeforeThrowing(-1)), "RangeError: slightly negative", "the other way to the throw");

    function callsFails(x) {
        if (x < 0)
            fails("negative");
        return x * 2;
    }
    check(callsFails(4), 8, "the usual path beside a call that never returns");
    check(messageOf(() => callsFails(-4)), "RangeError: negative", "the call that never returns");

    function usesResultOfFails(x) {
        let result = x < 0 ? fails("no result") : x;
        return result + 1;
    }
    check(usesResultOfFails(4), 5, "the usual path beside a call whose result would be used");
    check(messageOf(() => usesResultOfFails(-4)), "RangeError: no result", "the call whose result would be used");

    function callsFailsThroughAnother(x) {
        if (x < 0)
            failsThroughAnother("deep");
        return x * 3;
    }
    check(callsFailsThroughAnother(4), 12, "the usual path beside two levels of calls that never return");
    check(messageOf(() => callsFailsThroughAnother(-4)), "RangeError: deep!", "two levels of calls that never return");

    function callsFailsOnEveryPath(x) {
        if (x > 0)
            failsOnEveryPath(x);
        return "fine";
    }
    check(callsFailsOnEveryPath(0), "fine", "the usual path beside a function that fails on every path");
    check(messageOf(() => callsFailsOnEveryPath(1)), "TypeError: one", "its first path");
    check(messageOf(() => callsFailsOnEveryPath(2)), "RangeError: two", "its second path");
    check(messageOf(() => callsFailsOnEveryPath(3)), "SyntaxError: other", "its last path");

    function callsFailsSometimes(x) {
        let length = 0;
        if (x < 0)
            length = failsSometimes("sometimes", x < -10);
        return x + length;
    }
    check(callsFailsSometimes(1), 1, "no call");
    check(callsFailsSometimes(-1), 8, "a call that returns");
    check(messageOf(() => callsFailsSometimes(-11)), "RangeError: sometimes", "the same call throws");

    function callsNotes(x) {
        if (x < 0)
            notes("negative");
        return x * 2;
    }
    log = [];
    check(callsNotes(-2), -4, "a call that returns nothing");
    check(log.join(), "negative", "it ran");

    function catchesOwnFailure(x) {
        try {
            if (x < 0)
                fails("caught");
            return "no failure";
        } catch (error) {
            return error.message;
        } finally {
            log.push("finally");
        }
    }
    log = [];
    check(catchesOwnFailure(1), "no failure", "nothing to catch");
    check(catchesOwnFailure(-1), "caught", "a failure caught in the same function");
    check(log.join(), "finally,fails,finally", "the finally block runs both times");

    function continuesAfterFailures(n) {
        let caught = 0, sum = 0;
        for (let i = 0; i < n; i++) {
            try {
                if (i % 3 === 0)
                    fails("every third");
                sum += i;
            } catch (error) {
                caught++;
            }
        }
        return caught + ":" + sum;
    }
    check(continuesAfterFailures(10), "4:27", "a loop that goes on after failures");

    function throwsInLoop(values) {
        let sum = 0;
        for (let i = 0; i < values.length; i++) {
            if (values[i] < 0)
                throw new RangeError("at " + i);
            sum += values[i];
        }
        return sum;
    }
    check(throwsInLoop([1, 2, 3]), 6, "a loop beside a throw");
    check(messageOf(() => throwsInLoop([1, -2, 3])), "RangeError: at 1", "the throw inside the loop");

    function rethrows(x) {
        try {
            return throwsWhenNegative(x);
        } catch (error) {
            log.push("rethrows");
            throw error;
        }
    }
    log = [];
    check(rethrows(3), 6, "nothing to rethrow");
    check(messageOf(() => rethrows(-3)), "RangeError: negative: -3", "an error thrown again");
    check(log.join(), "rethrows", "the handler ran once");

    function switchesWithFailure(kind) {
        switch (kind) {
        case 0: return "zero";
        case 1: return "one";
        case 2: return "two";
        default: return fails("unknown kind " + kind);
        }
    }
    check(switchesWithFailure(0) + switchesWithFailure(1) + switchesWithFailure(2), "zeroonetwo", "the cases that return");
    check(messageOf(() => switchesWithFailure(3)), "RangeError: unknown kind 3", "the default that never returns");

    function onlyReturns(x) {
        if (x < 0)
            return -x;
        return x;
    }
    check(onlyReturns(-5) + onlyReturns(5), 10, "no throw at all");
})();
console.log("passed");
