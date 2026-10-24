(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }

    let log = [];
    function effect(x) { try { log.push(x); } catch { } return x; }
    function changes(o) { try { o.debug = true; o.added = 1; } catch { } return o; }

    function afterReplacement(a) { const o = { x: a, y: undefined }; if (o.y !== undefined) return effect(o.y); return o.x; }
    function absentProperty(a) { const o = { x: a }; if (o.missing !== undefined) return effect(o); return o.x; }
    function earlyReturnInDeadArm(d) { const pick = (v, d) => { if (v === undefined) return d; return effect(v); }; return pick(undefined, d); }
    function truthinessOfConstant(a) { const run = (a, verbose) => { if (verbose) effect(a); return a; }; return run(a, false); }
    function nullTestOfLiteral(a) { const o = { x: a }; if (o == null) return effect(0); return o.x; }
    function switchOnConstant(a) { const by = (kind, a) => { switch (kind) { case 0: return effect(a); case 1: return a + 1; default: return effect(-a); } }; return by(1, a); }
    function typeofClosure(a) { const call = (f, a) => typeof f === "function" ? f(a) : effect(a); return call(x => x + 1, a); }
    function notFused(a) { const o = { y: undefined, x: a }; const has = o.y !== undefined; if (has) return effect(a); return o.x; }
    function destructuringDefault(a) { const { x, y = effect(1) } = { x: a, y: 2 }; return x + y; }
    function escapesOnlyInDeadArm(a) { const o = { x: a, debug: false }; if (o.debug) effect(o); return o.x; }
    function numbers(a) { const by = (n, a) => { if (n === 0) return effect(a); if (!n) return effect(a); if (n !== 1.5) return effect(a); return a; }; return by(1.5, a); }
    function keepsOneOfTwo(a) { const pick = (c, a) => { let o; if (c) o = { v: a }; else o = effect({ v: -a }); return o.v; }; return pick(true, a); }
    function loopInDeadArm(a) { const run = (verbose, a) => { if (verbose) { for (let i = 0; i < a; ++i) effect(i); } return a; }; return run(false, a); }
    function tryInDeadArm(a) { const o = { on: false }; if (o.on) { try { effect(a); } catch { return -1; } } return a; }
    function liveArmInTry(a) { const o = { on: false }; try { if (o.on) effect(a); return a; } catch { return -1; } }
    function deadArmInLoop(n) { const o = { on: false }; let sum = 0; for (let i = 0; i < n; ++i) { if (o.on) effect(i); sum += i; } return sum; }
    function loopLosesItsBackEdge(a) { const o = { once: true }; let n = 0; for (;;) { n += a; if (o.once) break; effect(n); } return n; }
    function* yieldInDeadArm(a) { const o = { on: false }; if (o.on) yield effect(a); yield a; }
    function stringTags(a) { const by = (tag, a) => { if (tag === "image") return effect(a); if (tag !== "text") return effect(-a); if (tag === 1 || tag === undefined || tag == null) return effect(0); return a + 1; }; return by("text", a); }
    function emptyString(a) { const run = (s, a) => { if (s) return effect(a); return a + 1; }; return run("", a); }
    function integerSwitch(a) { const by = (k, a) => { switch (k) { case 0: return effect(a); case 1: return effect(a + 1); case 2: return a + 2; case 3: return effect(a + 3); case 4: return effect(a + 4); default: return effect(-a); } }; return by(2, a); }
    function integerSwitchDefault(a) { const by = (k, a) => { switch (k) { case 0: return effect(a); case 1: return effect(a + 1); case 2: return effect(a + 2); case 3: return effect(a + 3); case 4: return effect(a + 4); default: return -a; } }; return by(7, a) + by(2.5, a) + by("2", a) + by(undefined, a) + by(NaN, a); }
    function negativeZeroSwitch(a) { const by = (k, a) => { switch (k) { case 0: return a; case 1: return effect(a + 1); case 2: return effect(a + 2); case 3: return effect(a + 3); case 4: return effect(a + 4); default: return effect(-a); } }; return by(-0, a); }
    function stringSwitch(a) { const by = (k, a) => { switch (k) { case "zero": return effect(a); case "one": return effect(a + 1); case "two": return a + 2; case "three": return effect(a + 3); case "four": return effect(a + 4); default: return effect(-a); } }; return by("two", a); }
    function stringSwitchDefault(a) { const by = (k, a) => { switch (k) { case "zero": return effect(a); case "one": return effect(a + 1); case "two": return effect(a + 2); case "three": return effect(a + 3); case "four": return effect(a + 4); default: return -a; } }; return by("five", a) + by(2, a) + by(null, a); }
    function characterSwitch(a) { const by = (k, a) => { switch (k) { case "a": return effect(a); case "b": return effect(a + 1); case "c": return a + 2; case "d": return effect(a + 3); case "e": return effect(a + 4); default: return effect(-a); } }; return by("c", a); }
    function characterSwitchDefault(a) { const by = (k, a) => { switch (k) { case "a": return effect(a); case "b": return effect(a + 1); case "c": return effect(a + 2); case "d": return effect(a + 3); case "e": return effect(a + 4); default: return -a; } }; return by("cc", a) + by("", a) + by("z", a) + by(99, a); }
    function fallsThrough(a) { const by = (k, a) => { let n = a; switch (k) { case 0: n += effect(1); case 1: n += effect(10); case 2: n += 100; case 3: n += 1000; break; case 4: n += effect(10000); } return n; }; return by(2, a); }
    function nested(a) { const outer = (c, a) => { const inner = (c, a) => { if (c) return effect(a); return a + 1; }; if (c) return effect(a); return inner(c, a) + 1; }; return outer(false, a); }

    check(afterReplacement(5), 5, "a property that is undefined");
    check(absentProperty(5), 5, "a property that is absent");
    check(earlyReturnInDeadArm(5), 5, "the arm that is left returns");
    check(truthinessOfConstant(5), 5, "false");
    check(nullTestOfLiteral(5), 5, "an object is not null");
    check(switchOnConstant(5), 6, "switch");
    check(typeofClosure(5), 6, "typeof");
    check(notFused(5), 5, "a comparison kept in a variable");
    check(destructuringDefault(5), 7, "a default value that is not needed");
    check(escapesOnlyInDeadArm(5), 5, "an object that is only passed on in the dead arm");
    check(numbers(5), 5, "numbers");
    check(keepsOneOfTwo(5), 5, "a variable that keeps one of two values");
    check(loopInDeadArm(5), 5, "a loop in the dead arm");
    check(tryInDeadArm(5), 5, "a handler in the dead arm");
    check(liveArmInTry(5), 5, "the branch is in a try block");
    check(deadArmInLoop(4), 6, "the branch is in a loop");
    check(loopLosesItsBackEdge(5), 5, "a loop that runs once");
    check([...yieldInDeadArm(5)].join(), "5", "a yield in the dead arm");
    check(stringTags(5), 6, "strings that are compared");
    check(emptyString(5), 6, "the empty string");
    check(integerSwitch(5), 7, "a switch on an integer");
    check(integerSwitchDefault(5), -25, "what is no case of a switch on integers");
    check(negativeZeroSwitch(5), 5, "negative zero is case 0");
    check(stringSwitch(5), 7, "a switch on a string");
    check(stringSwitchDefault(5), -15, "what is no case of a switch on strings");
    check(characterSwitch(5), 7, "a switch on a character");
    check(characterSwitchDefault(5), -20, "what is no case of a switch on characters");
    check(fallsThrough(5), 1105, "cases that fall through");
    check(nested(5), 7, "inlined twice");
    check(log.length, 0, "no dead arm ran");

    function unknownValue(a, c) { if (c) return effect(a); return a + 1; }
    function notANumber(a) { const same = (x, y, a) => { if (x === y) return effect(a); return a + 1; }; return same(NaN, NaN, a); }
    function zeros(a) { const same = (x, y, a) => { if (x === y) return effect(a); return a + 1; }; return same(0, -0, a); }
    function unknownString(a, s) { if (s === "text") return effect(a); if (s) return a + 1; return a + 2; }
    function unknownSwitch(a, k) { switch (k) { case 0: return effect(a); case 1: return a + 1; case 2: return a + 2; case 3: return a + 3; case 4: return a + 4; default: return -a; } }
    function stringThatIsNotEmpty(a) { const run = (s, a) => { if (s) return effect(a); return a + 1; }; return run("s", a); }
    function changedBeforeTheRead(a) { const o = { x: a, debug: false }; changes(o); if (o.debug) return effect(a); return a + 1; }
    function addedBeforeTheRead(a) { const o = { x: a }; changes(o); if (o.added !== undefined) return effect(a); return a + 1; }
    function storedBeforeTheRead(a, c) { const o = { x: a, debug: false }; o.debug = c; if (o.debug) return effect(a); return a + 1; }
    function inheritedName(a) { const o = { x: a }; if (o.toString !== undefined) return effect(a); return a + 1; }
    function getter(a) { const o = { get debug() { return a > 0; } }; if (o.debug) return effect(a); return a + 1; }
    function bothArmsInLoop(n) { let sum = 0; for (let i = 0; i < n; ++i) { const o = { odd: i & 1 }; if (o.odd) sum += effect(i); else sum -= 1; } return sum; }
    log = [];
    check(unknownValue(5, true) + unknownValue(5, false), 11, "a value that is not known");
    check(notANumber(5), 6, "NaN is not equal to itself");
    check(zeros(5), 5, "the zeros are equal");
    check(unknownString(5, "text") + unknownString(5, "other") + unknownString(5, ""), 18, "a string that is not known");
    check(unknownSwitch(5, 0) + unknownSwitch(5, 3) + unknownSwitch(5, "0"), 8, "a switch on a value that is not known");
    check(stringThatIsNotEmpty(5), 5, "a string that is not empty");
    check(changedBeforeTheRead(5), 5, "a property changed by a callee");
    check(addedBeforeTheRead(5), 5, "a property added by a callee");
    check(storedBeforeTheRead(5, true) + storedBeforeTheRead(5, false), 11, "a property stored to");
    check(inheritedName(5), 5, "an inherited property");
    check(getter(5) + getter(-5), 1, "a getter");
    check(bothArmsInLoop(4), 2, "both arms run");
    check(log.join(), "5,5,5,5,5,5,5,5,5,5,1,3", "the live arms ran");

    function undefinedOnly(x) { try { } catch { } if (x !== undefined) return effect(x); return 0; }
    function nullOnly(x) { try { } catch { } if (x === null) return 0; return effect(x); }
    function objectOnly(o) { try { } catch { } if (!o) return effect(0); return 1; }
    function objectIsNotNull(o) { try { } catch { } if (o == null) return effect(0); return 1; }
    function numberIsNoString(n) { try { } catch { } if (typeof n === "string") return effect(n); return n + 1; }
    function testedTwice(x) { try { } catch { } if (x === undefined) return 0; if (x === undefined) return effect(x); return x + 1; }
    function optionalParameter(a, options) { try { } catch { } let sum = a; if (options !== undefined) { for (let name in options) sum += effect(options[name]); } return sum; }
    function undefinedOrNumber(x) { try { } catch { } if (x !== undefined) return effect(x); return 0; }
    function objectOrNull(o) { try { } catch { } if (!o) return effect(0); return 1; }
    function functionIsComparedWithNull(f) { try { } catch { } if (f == null) return effect(0); return 1; }
    function numberMayBeZero(n) { try { } catch { } if (!n) return effect(n); return 1; }
    log = [];
    check(undefinedOnly(undefined) + undefinedOnly(), 0, "only undefined is passed");
    check(nullOnly(null), 0, "only null is passed");
    check(objectOnly({ }) + objectOnly([]), 2, "only objects are passed");
    check(objectIsNotNull({ }), 1, "an object is not null");
    check(numberIsNoString(1) + numberIsNoString(1.5), 4.5, "only numbers are passed");
    check(testedTwice(1) + testedTwice(undefined), 2, "the same test again");
    check(optionalParameter(1) + optionalParameter(2, undefined), 3, "a parameter that is never passed");
    check(log.length, 0, "no dead arm ran");
    check(undefinedOrNumber(undefined) + undefinedOrNumber(3), 3, "undefined or a number");
    check(objectOrNull({ }) + objectOrNull(null), 1, "an object or null");
    check(functionIsComparedWithNull(() => 1), 1, "a function is not told from one that masquerades as undefined");
    check(numberMayBeZero(0) + numberMayBeZero(2), 1, "a number may be zero");
    check(log.join(), "3,0,0", "the live arms ran");
})();
console.log("passed");
