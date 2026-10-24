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
    function addsInts(x, y, z) { return (x + y | 0) + z | 0; }
    function addsDoubles(x, y, z) { return x * 0.5 + y * 0.5 + z * 0.5; }
    function tests(x, flag) { return flag ? x > 1 : x < 1; }
    function Pair(x, y) {
        this.x = x;
        this.y = y;
    }

    function callsWithInts(o) { let first = o.a | 0; return addsInts(first, o.b | 0, o.c | 0) + 1; }
    function callsWithDoubles(o) { let first = +o.a; return addsDoubles(first, +o.b, +o.c) + 1; }
    function callsWithBoolean(o) { let first = o.a | 0; return tests(first, o.b === 2) === (o.c === 3) ? 1 : 0; }
    function tailCallsWithInts(o) { let first = o.a | 0; return addsInts(first, o.b | 0, o.c | 0); }
    function usesTailCallWithInts(o) { return tailCallsWithInts(o) * 2 | 0; }
    function tailCallsWithDoubles(o) { let first = +o.a; return addsDoubles(first, +o.b, +o.c); }
    function usesTailCallWithDoubles(o) { return tailCallsWithDoubles(o) * 2; }
    function constructs(o) { let first = o.a | 0; let pair = new Pair(first, o.b | 0); return pair.x + pair.y + o.c; }

    const receivers = [
        () => new Item(1, 2, 3),
        () => build("c", 3, "b", 2, "a", 1),
        () => build("a", 1, "c", 3, "b", 2),
        () => build("a", 1, "b", 2, "other", 0, "c", 3),
    ];
    for (let i = 0; i < 400; ++i) {
        let make = receivers[i % 9 < receivers.length ? i % 9 : 0];
        check(callsWithInts(make()), 7, "integers are passed");
        check(callsWithDoubles(make()), 4, "doubles are passed");
        check(callsWithBoolean(make()), 0, "a boolean is passed");
        check(usesTailCallWithInts(make()), 12, "a tail call returns an integer");
        check(usesTailCallWithDoubles(make()), 6, "a tail call returns a double");
        check(constructs(make()), 6, "integers are passed to a constructor");
    }
})();
console.log("passed");
