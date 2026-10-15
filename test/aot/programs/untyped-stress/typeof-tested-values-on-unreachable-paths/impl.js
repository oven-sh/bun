function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    "use strict";
    function Item(a, b, c) {
        this.a = a;
        this.b = b;
        this.c = c;
    }
    function build(...pairs) {
        let object = { };
        for (let i = 0; i < pairs.length; i += 2)
            object[pairs[i]] = pairs[i + 1];
        return object;
    }
    let kept;
    function takesString(s) { return s.length; }
    function takesAnything(x) { return x === undefined ? 0 : x.length; }

    function passesTestedValue(o, x) { let sum = o.a + o.b + o.c; if (x !== undefined) sum += takesString(x); return sum; }
    function passesTestedValueBehindGuard(o, x) { let sum = o.a + o.b; if (x !== undefined) { sum += o.c; sum += takesString(x); } else sum += 3; return sum; }
    function storesInCodeNeverReached(o, n) { let sum = o.a + o.b + o.c; if (typeof n === "string") kept = o; return sum + n; }
    function returnsTestedValue(o, v) { let sum = o.a + o.b + o.c; return typeof v === "boolean" ? v : sum > 3; }
    function usesResult(o, v) { return returnsTestedValue(o, v) ? 1 : 0; }
    function agrees(o, x) { let sum = o.a + o.b + o.c; return sum + takesAnything(x); }

    for (let i = 0; i < 400; ++i) {
        let make = i % 10 == 9 ? () => build("c", 3, "b", 2, "a", 1) : i % 10 == 8 ? () => Object.defineProperty(new Item(1, 0, 3), "b", { get() { return 2; } }) : () => new Item(1, 2, 3);
        let text = i & 1 ? "four" : undefined;
        check(passesTestedValue(make(), text), i & 1 ? 10 : 6, "a tested value is passed");
        check(passesTestedValueBehindGuard(make(), text), i & 1 ? 10 : 6, "a tested value is passed behind a guard");
        check(storesInCodeNeverReached(make(), i), 6 + i, "a store that is never reached");
        check(kept, undefined, "the variable that is never stored to");
        check(usesResult(make(), i % 3 ? true : i), 1, "a tested value is returned");
        check(usesResult(make(), false), 0, "a tested value is returned");
        check(agrees(make(), text), i & 1 ? 10 : 6, "nothing is narrowed");
    }
})();
console.log("passed");
